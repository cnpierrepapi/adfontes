// Testnet proof of the god panel's transactions (SPEC §12j). Signs the very objects that
// src/live/calls.js builds for the panel, with the testnet god keys, against the live testnet world.
// Usage (from adfontes/): node contracts/world/scripts/testnet-gods.mjs <clan id> <its god> <a new god>
//  a. a new god blesses -> god + DAO seat       b. the god whispers (propose + vote): 1 of 2, still open
//  c. the new god approves it from the open list -> whisper set   d. the new god withdraws -> seat gone
//  e. the god (alone again) stunts a citizen: passes at once     f. rule / claim_owed / claim_gift reach
//     the contract with the panel's argument shapes (refused for the expected reason)
// Found on the first run: this Sputnik doesn't check a vote's `proposal` kind, so votes are bound
// to the id add_proposal returned (calls.js daoPower), never a guessed next id.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";
import * as C from "../../../src/live/calls.js";

const WORLD = "w5.adf-god6-77978.testnet";
const [CLAN, GOD, NEWGOD] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const acct = (id) => { const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8")); return new Account(k.account_id, provider, k.private_key); };
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const fails = (r) => [r.transaction_outcome, ...r.receipts_outcome].filter((o) => o.outcome.status.Failure).map((o) => JSON.stringify(o.outcome.status.Failure).match(/panicked: ([^"\\]+)|"(ERR_[A-Z_]+)/)?.slice(1).find(Boolean) ?? JSON.stringify(o.outcome.status.Failure).slice(0, 160));
let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", label); };
// Send one panel call exactly as built (args object, deposit, gas). Failures come back, not thrown.
async function send(a, c) {
  try { return fails(await a.callFunctionRaw({ contractId: c.receiver, methodName: c.method, args: c.args, deposit: c.deposit, gas: c.gas })); }
  catch (e) { return [String(e.message || e).match(/panicked: ([^"\\]+)|(ERR_[A-Z_]+)/)?.slice(1).find(Boolean) ?? String(e.message || e).slice(0, 160)]; }
}
// A DAO power exactly as wallet.js sends it: propose, read the id it got, bind the vote to it.
async function power(a, [propose, yes]) {
  const r = await a.callFunctionRaw({ contractId: propose.receiver, methodName: propose.method, args: propose.args, deposit: propose.deposit, gas: propose.gas });
  const f = fails(r);
  if (f.length) return { f, id: null };
  const id = C.returned(r);
  return { id, f: await send(a, yes.bind(id)) };
}
const seats = async (dao) => (await view(dao, "get_policy")).roles.find((r) => r.name === "gods").kind.Group;

const god = acct(GOD), fresh = acct(NEWGOD);
let clan = await view(WORLD, "get_clan", { clan_id: CLAN });
const DAO = clan.dao;
console.log(`clan ${CLAN} ${clan.name}, DAO ${DAO}, gods ${clan.gods.map((g) => g.account)}`);

// a. bless as a new god
const fa = await send(fresh, C.bless(WORLD, CLAN, 2n * 10n ** 23n));
await sleep(4000);
clan = await view(WORLD, "get_clan", { clan_id: CLAN });
check(`a. ${NEWGOD} blessed 0.2: god ${clan.gods.some((g) => g.account === NEWGOD)}, seated ${(await seats(DAO)).includes(NEWGOD)} ${fa.join(" ")}`, !fa.length && clan.gods.some((g) => g.account === NEWGOD) && (await seats(DAO)).includes(NEWGOD));

// b. whisper: propose + vote yes (2 gods now, so it stays open)
const text = "Check every citation twice before you draft.";
const policy = await view(DAO, "get_policy");
const { id: next, f: fb } = await power(god, C.daoPower(WORLD, DAO, policy.proposal_bond, "whisper", { clan_id: CLAN, text }, `AD FONTES: whisper to ${clan.name}: "${text}"`));
await sleep(3000); // views read final blocks: give the vote time to land
const pb = await view(DAO, "get_proposal", { id: next });
const yesB = Object.values(pb.votes).filter((v) => v === "Approve").length;
check(`b. proposal #${next} ${pb.status}, ${yesB} yes, needs ${C.needed(2, yesB)} more ${fb.join(" ")}`, !fb.length && pb.status === "InProgress" && C.needed(2, yesB) === 1);

// c. the new god finds it in the open list and approves
const last = await view(DAO, "get_last_proposal_id");
const open = (await view(DAO, "get_proposals", { from_index: Math.max(0, last - 15), limit: 15 })).filter((p) => p.status === "InProgress");
const mine = open.find((p) => p.id === next);
const fc = mine ? await send(fresh, C.vote(DAO, mine, "VoteApprove")) : ["not in the open list"];
await sleep(4000);
clan = await view(WORLD, "get_clan", { clan_id: CLAN });
check(`c. approved -> ${(await view(DAO, "get_proposal", { id: next })).status}, whisper now ${JSON.stringify(clan.whisper)} ${fc.join(" ")}`, !fc.length && clan.whisper === text);

// d. the new god withdraws
const before = BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: NEWGOD })).amount);
const fd = await send(fresh, C.withdraw(WORLD, CLAN));
await sleep(4000);
const after = BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: NEWGOD })).amount);
clan = await view(WORLD, "get_clan", { clan_id: CLAN });
check(`d. withdrew (+${fmt(after - before)} NEAR), god ${clan.gods.some((g) => g.account === NEWGOD)}, seated ${(await seats(DAO)).includes(NEWGOD)} ${fd.join(" ")}`, !fd.length && !clan.gods.some((g) => g.account === NEWGOD) && !(await seats(DAO)).includes(NEWGOD) && after > before);

// e. alone again: a stunt passes on the god's own vote
const day = (await view(WORLD, "get_config")).day;
const living = (await view(WORLD, "list_agents", { clan_id: CLAN, limit: 100 })).filter((a) => a.alive && a.role !== "Patron");
const agent = living.find((a) => a.stunted_until > day) ?? living[0]; // re-stunt one already stunted: no new harm
const { id: n2, f: fe } = await power(god, C.daoPower(WORLD, DAO, policy.proposal_bond, "smite", { clan_id: CLAN, agent: agent.name, verdict: "Stunt" }, `AD FONTES: stunt ${agent.name} of ${clan.name}`));
await sleep(4000);
const ag = await view(WORLD, "get_agent", { name: agent.name });
check(`e. ${agent.name} stunted until day ${ag.stunted_until} (today ${day}), proposal ${(await view(DAO, "get_proposal", { id: n2 })).status} ${fe.join(" ")}`, !fe.length && ag.stunted_until === day + 3);

// f. the other shapes reach the contract and are refused for the expected reason
const r1 = await send(god, { receiver: WORLD, method: "rule", args: { gift_id: 1, reward: true, verdict: null, agent: null }, deposit: 0n, gas: 30n * C.TGAS });
check(`f1. rule (reward shape) refused: ${r1[0]}`, /Only the clan's DAO|already settled/.test(r1[0] || ""));
const r2 = await send(god, C.claimOwed(WORLD));
check(`f2. claim_owed refused: ${r2[0]}`, /Nothing owed/.test(r2[0] || ""));
const r3 = await send(god, C.claimGift(WORLD, 1));
check(`f3. claim_gift refused: ${r3[0]}`, /already settled|still have time|top contributing/.test(r3[0] || ""));
console.log(bad ? `${bad} FAILED` : "ALL PASS");
