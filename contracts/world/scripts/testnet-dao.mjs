// Testnet: the world contract's DAO paths against REAL Sputnik (sputnikv2.testnet).
// Usage (from adfontes/): node contracts/world/scripts/testnet-dao.mjs <world> <god1> <god2> <operator>
// a. deploy + god1 founds  b. god2 blesses -> gets a DAO seat automatically
// c. both gods vote: DAO releases the staking fund  d. god2 withdraws -> loses its seat
// e. operator records a gift; god1 (now alone) stunts an agent by DAO vote  f. solvency
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

const [WORLD, GOD1, GOD2, OPERATOR] = process.argv.slice(2);
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const acct = (id) => {
  const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8"));
  return new Account(k.account_id, provider, k.private_key);
};
const N = (x) => (BigInt(Math.round(x * 1000)) * 10n ** 21n).toString();
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (t) => (BigInt(t) * 10n ** 12n).toString();
const fails = (r) => r.receipts_outcome.filter((o) => o.outcome.status.Failure).map((o) => o.outcome.executor_id + ": " + JSON.stringify(o.outcome.status.Failure).slice(0, 220));
const logs = (r) => r.receipts_outcome.flatMap((o) => o.outcome.logs);
const gods = async (dao) => (await view(dao, "get_policy")).roles.find((r) => r.name === "gods").kind.Group;
const check = (label, ok) => console.log(ok ? "PASS" : "FAIL", label);

const world = acct(WORLD), g1 = acct(GOD1), g2 = acct(GOD2), op = acct(OPERATOR);

// a. deploy + found
await world.deployContract(fs.readFileSync("contracts/world/target/near/world.wasm"));
await world.callFunction({
  contractId: WORLD, methodName: "new", gas: T(100),
  args: { owner: WORLD, operator: OPERATOR, treasury: OPERATOR, dao_factory: "sputnikv2.testnet",
          dao_deposit: N(5.5), staking_deposit: N(1.2), min_found: N(7) },
});
const rf = await g1.callFunctionRaw({ contractId: WORLD, methodName: "found_clan", args: { name: "DAO Path" }, deposit: N(7.5), gas: T(300) });
const clan = (await view(WORLD, "list_clans")).at(-1);
const DAO = clan.dao;
check(`a. founded clan ${clan.id} with DAO ${DAO}`, fails(rf).length === 0 && !!DAO);

// b. second god gets a DAO seat automatically
const rb = await g2.callFunctionRaw({ contractId: WORLD, methodName: "bless", args: { clan_id: clan.id }, deposit: N(1), gas: T(200) });
await sleep(3000);
const seatsB = await gods(DAO);
check(`b. god2 seated in DAO: ${JSON.stringify(seatsB)}`, seatsB.includes(GOD2) && seatsB.includes(GOD1));
if (fails(rb).length) console.log("   failures:", fails(rb));

// c. both gods vote to release the staking fund to god1's account (stand-in for a staking account)
const kindC = { FunctionCall: { receiver_id: WORLD, actions: [{ method_name: "release_staking",
  args: Buffer.from(JSON.stringify({ clan_id: clan.id, to: GOD1 })).toString("base64"), deposit: "0", gas: T(60) }] } };
const pid = await g1.callFunction({ contractId: DAO, methodName: "add_proposal",
  args: { proposal: { description: "release staking fund", kind: kindC } }, deposit: N(0.01), gas: T(50) });
const g1b = BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: GOD1 })).amount);
await g1.callFunction({ contractId: DAO, methodName: "act_proposal", args: { id: pid, action: "VoteApprove", proposal: kindC }, gas: T(150) });
const one = await view(DAO, "get_proposal", { id: pid });
check(`c1. one vote of two is not enough (status ${one.status})`, one.status === "InProgress");
const rc = await g2.callFunctionRaw({ contractId: DAO, methodName: "act_proposal", args: { id: pid, action: "VoteApprove", proposal: kindC }, gas: T(150) });
await sleep(3000);
const cC = await view(WORLD, "get_clan", { clan_id: clan.id });
const g1a = BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: GOD1 })).amount);
check(`c2. both voted -> fund released (fund now ${fmt(cC.staking_fund)}, god1 +${fmt(g1a - g1b)})`, cC.staking_fund === "0" && g1a - g1b > BigInt(N(1.1)));
if (fails(rc).length) console.log("   failures:", fails(rc));

// d. god2 withdraws and loses its seat
await g2.callFunction({ contractId: WORLD, methodName: "withdraw", args: { clan_id: clan.id }, gas: T(200) });
await sleep(3000);
const seatsD = await gods(DAO);
check(`d. god2 removed from DAO: ${JSON.stringify(seatsD)}`, !seatsD.includes(GOD2) && seatsD.includes(GOD1));

// e. gift + ruling: god1 alone stunts an agent through the DAO
await op.callFunction({ contractId: WORLD, methodName: "spawn_agent", args: { clan_id: clan.id, name: `Wren Okafor ${Date.now() % 1000}`, role: "Drafter" }, gas: T(30) });
const agent = (await view(WORLD, "list_agents", { clan_id: clan.id })).at(-1).name;
const gid = await op.callFunction({ contractId: WORLD, methodName: "gift", args: { clan_id: clan.id, draft_hash: "ab".repeat(32), warden_passed: true, top_contributor: clan.id }, gas: T(30) });
const kindE = { FunctionCall: { receiver_id: WORLD, actions: [{ method_name: "rule",
  args: Buffer.from(JSON.stringify({ gift_id: gid, reward: false, verdict: "Stunt", agent })).toString("base64"), deposit: "0", gas: T(30) }] } };
const pidE = await g1.callFunction({ contractId: DAO, methodName: "add_proposal", args: { proposal: { description: "stunt", kind: kindE } }, deposit: N(0.01), gas: T(50) });
await g1.callFunction({ contractId: DAO, methodName: "act_proposal", args: { id: pidE, action: "VoteApprove", proposal: kindE }, gas: T(150) });
await sleep(3000);
const a = await view(WORLD, "get_agent", { name: agent });
const gift = await view(WORLD, "get_gift", { gift_id: gid });
check(`e. ${agent} stunted until day ${a.stunted_until}, gift ${gift.status}`, a.stunted_until === 3 && gift.status === "Punished");

// f. solvency
const t = await view(WORLD, "get_totals");
const free = BigInt(t.balance) - BigInt(t.liabilities) - BigInt(t.storage_locked);
check(`f. solvent: balance ${fmt(t.balance)} liabilities ${fmt(t.liabilities)} storage ${fmt(t.storage_locked)}`, free >= 0n);
