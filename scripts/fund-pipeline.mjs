// His call 17 Nov: every account the live world pays storage or gas from gets enough testnet NEAR that nothing
// fails for want of it again. Found on 16 Nov: the nations' DAOs had 0.001-0.08 NEAR spare over their storage, so
// the world's vote to seat Ahti, Akka and Zao Jun failed (LackBalanceForState) and their motions were refused.
// All from the sponsor pool, never the operator (the engine signs with the operator; a second sender would race its nonce).
//   - each live nation's DAO: +1 NEAR (a DAO's NEAR is no game number: florins live in the world contract)
//   - the world contract: +2 NEAR of spare (the engine only tops it up under 0.3)
//   - the operator: up to 150 NEAR (it pays every turn, the AI gods' top-ups and arrivals, which need 36 on hand)
//   - each Broker and Patron wallet: up to 0.5 NEAR (the engine keeps them over 0.1)
// Not the named accounts: whatever lands there is forwarded to the nation's treasury as grace.
// Dry run unless --send. Each payment goes to debug/fund-17nov.json as it lands, so a rerun skips who's paid.
//   node scripts/fund-pipeline.mjs [--send]
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

const SEND = process.argv.includes("--send"), POOL = "adf-pool1-hf0w8.testnet", OP = "adfontes-mw1fjpfx.testnet";
const LOG = "debug/fund-17nov.json";
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const W = await (await fetch("https://adfontes.fun/api/world?net=testnet")).json();
const near = async (id) => Number(BigInt((await provider.viewAccount({ accountId: id })).amount) / 10n ** 18n) / 1e6;
const upTo = async (id, to) => Math.max(0, +(to - (await near(id))).toFixed(4));

const plan = [];
for (const c of W.clans.filter((x) => x.alive)) {
  plan.push({ id: c.dao, near: 1, why: `${c.name}'s DAO` });
  for (const [role, id] of Object.entries(c.wallets || {})) { const n = await upTo(id, 0.5); if (n > 0.01) plan.push({ id, near: n, why: `${c.name}'s ${role}` }); }
}
plan.push({ id: W.world, near: 2, why: "the world contract's spare" });
const opNeed = await upTo(OP, 150);
if (opNeed > 0.01) plan.push({ id: OP, near: opNeed, why: "the operator" });

const done = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
const todo = plan.filter((p) => !done[p.id]);
const total = +todo.reduce((s, p) => s + p.near, 0).toFixed(4);
const poolNear = await near(POOL);
console.log(`${plan.length} accounts, ${Object.keys(done).length} already paid, ${todo.length} to pay, ${total} NEAR in all. Pool holds ${poolNear}.`);
for (const p of todo) console.log(`  ${p.near.toFixed(4).padStart(9)}  ${p.why}: ${p.id}`);
if (!SEND) { console.log("\nDry run. Add --send to pay."); process.exit(0); }
if (poolNear < total + 50) throw new Error("the pool can't cover it with 50 to spare");
const key = JSON.parse(fs.readFileSync(`.keys/${POOL}.json`, "utf8"));
const pool = new Account(POOL, provider, key.private_key);
fs.mkdirSync("debug", { recursive: true });
for (const p of todo) {
  const r = await pool.transfer({ receiverId: p.id, amount: BigInt(Math.round(p.near * 1e6)) * 10n ** 18n });
  const ok = !r?.receipts_outcome?.some((o) => o.outcome.status.Failure);
  if (!ok) { console.log(`  FAILED ${p.why}: ${r?.transaction?.hash}`); continue; }
  done[p.id] = { near: p.near, why: p.why, tx: r?.transaction?.hash ?? null, at: new Date().toISOString() };
  fs.writeFileSync(LOG, JSON.stringify(done, null, 1));
  console.log(`  paid ${p.why}: ${p.near} (${done[p.id].tx})`);
}
console.log(`done: ${Object.keys(done).length} of ${plan.length} paid`);
