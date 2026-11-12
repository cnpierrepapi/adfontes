// Phase D on chain, on the v2d test world (never w6): one seat moves to an AI god; the AI god blesses and
// whispers with real transactions; withdrawing is refused before anything is sent. Re-runnable on the same
// world (reuses the AI god if it's already there). Logs to debug/aigods-proof.log. Exits 1 on any failure.
//   node scripts/aigods-proof.mjs [clanId=3]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CLAN = Number(process.argv[2]) || 3;
const WORLD = "v2d.adf-pool1-hf0w8.testnet", OPF = ".keys/v2dop.adf-pool1-hf0w8.testnet.json";
const opk = JSON.parse(fs.readFileSync(OPF, "utf8")); // never printed
const env = { ...process.env, ADF_WORLD: WORLD, OPERATOR_ACCOUNT_ID: opk.account_id, OPERATOR_PRIVATE_KEY: opk.private_key, ADF_STATE_DIR: "debug/ai-v2d", DATABASE_URL: "" };
Object.assign(process.env, env);
const LOG = "debug/aigods-proof.log";
fs.writeFileSync(LOG, "");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
let bad = 0;
const ok = (c, m) => { log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { connect } = await import("../engine/chain.mjs");
const store = await import("../engine/store.mjs");
const C = await import("../src/live/calls.js");
const { callsFor } = await import("../engine/aiact.mjs");
const chain = connect("testnet");
ok(chain.world === WORLD, `talking to the test world ${chain.world}`);

// 1. The takeover (one seat).
const before = (await chain.clans()).find((c) => c.id === CLAN);
let god = (await store.aiGods("testnet")).find((g) => before.gods.some((x) => x.account === g.account))?.account;
if (!god || !before.gods.some((g) => g.account === god)) {
  const r = spawnSync(process.execPath, ["scripts/ai-takeover.mjs", "--world", WORLD, "--only", String(CLAN), "--send"], { env, encoding: "utf8" });
  log(r.stdout.trim()); if (r.status !== 0) log(r.stderr.slice(-800));
  await sleep(3000);
  god = (await store.aiGods("testnet")).at(-1)?.account;
}
const clan = (await chain.clans()).find((c) => c.id === CLAN);
ok(!!god && clan.gods.some((g) => g.account === god), `the seat in "${clan.name}" belongs to the AI god ${god}`);
ok(!clan.gods.some((g) => before.gods.some((b) => b.account === g.account && b.account !== god)), "the old god holds no seat there now");
const stake = await chain.stake(CLAN, god);
ok(BigInt(stake.put_in) > 0n, `the stake came with the seat (put in ${Number(BigInt(stake.put_in) / 10n ** 18n) / 1e6} NEAR)`);
const pol = await chain.dao(clan.dao, "get_policy");
ok(pol.roles.some((r) => r.kind?.Group?.includes(god)), "the AI god sits on the nation's council");

// 2. It blesses (NEAR in).
const put0 = BigInt(clan.gods.find((g) => g.account === god).put_in);
const b = await chain.aiSend(god, await callsFor(chain, { kind: "bless", clan: CLAN, near: 0.1 }, clan));
await sleep(3000);
const put1 = BigInt((await chain.clans()).find((c) => c.id === CLAN).gods.find((g) => g.account === god).put_in);
ok(put1 - put0 === 10n ** 23n, `a blessing of 0.1 NEAR landed (tx ${b.hash})`);

// 3. It whispers (a council motion, passed by its own yes vote).
const w = await chain.aiSend(god, await callsFor(chain, { kind: "whisper", clan: CLAN, text: "Feed the hungry first, then the papers." }, clan));
await sleep(3000);
const prop = w.proposal != null ? await chain.dao(clan.dao, "get_proposal", { id: Number(w.proposal) }) : null;
ok(prop?.status === "Approved" && prop.proposer === god && /whisper/.test(prop.description), `its whisper passed the council (motion #${w.proposal}, ${prop?.status})`);

// 4. It can never take money out: refused before anything is sent.
for (const [label, call] of [["withdraw", C.withdraw(WORLD, CLAN)], ["claim_owed", C.claimOwed(WORLD)]]) {
  let refused = false;
  try { await chain.aiSend(god, [call]); } catch (e) { refused = /not allowed/i.test(String(e.message)); }
  ok(refused, `${label} is refused by the guard`);
}
await sleep(3000);
const after = (await chain.clans()).find((c) => c.id === CLAN);
ok(after.alive && after.gods.some((g) => g.account === god) && BigInt(after.gods.find((g) => g.account === god).put_in) === put1, "the nation is alive and the stake is untouched");
log(bad ? `${bad} FAILED` : "ALL PASS");
await store.close();
process.exitCode = bad ? 1 : 0;
