// AI gods take every seat but North Pole's (his calls 12 Nov). DRY RUN unless --send.
// For each seat: an AI god account <name>.<operator> (key derived from the operator key, engine/aigods.mjs),
// funded by the operator; its name fixed in god_names; registered in ai_gods; then the world's OWNER calls
// move_god(clan, old, new): the stake, grant, reverence and DAO seat all move to the AI god.
//   node scripts/ai-takeover.mjs [--world <account>] [--owner-key <file>] [--only <clanId>] [--send]
// Never moves North Pole's seat or any seat of --keep accounts (default: his olive-codex-852).
// Needs: the owner's key file on this PC (default .keys/<world>.json); the operator key (env or env.txt);
// DATABASE_URL for the live world's tables (ai_gods, god_names), else local files.
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEND = process.argv.includes("--send");
if (arg("--world")) process.env.ADF_WORLD = arg("--world");
const { connect } = await import("../engine/chain.mjs");
const store = await import("../engine/store.mjs");
const { nameFor } = await import("../engine/godnames.mjs");
const A = await import("../engine/aigods.mjs");
const { temperamentOf } = await import("../engine/aiact.mjs");

const chain = connect("testnet");
const world = chain.world, op = chain.operator;
const KEEP = new Set((arg("--keep", "olive-codex-852.adf-pool1-hf0w8.testnet")).split(","));
const only = arg("--only") ? Number(arg("--only")) : null;
const clans = (await chain.clans()).filter((c) => c.alive && (only == null || c.id === only));
// Names already given: this store's, and the live world's (its database is only reachable inside Railway).
const taken = new Set(await store.takenNames());
if (world === "w6.adf-pool1-hf0w8.testnet") for (const n of Object.values((await (await fetch("https://adfontes.fun/api/world")).json()).names || {})) taken.add(n);
const plan = [];
for (const c of clans) {
  if (/^north pole$/i.test(c.name)) continue;
  for (const g of c.gods) {
    if (KEEP.has(g.account) || (await store.aiGods("testnet")).some((x) => x.account === g.account)) continue;
    // A name from anywhere in the pool (every culture), picked by the seat, never one already given.
    const name = nameFor(`${c.id}|${g.account}`, new Set([...taken, ...plan.map((p) => p.name)]));
    plan.push({ clan: c.id, nation: c.name, from: g.account, name, to: A.accountFor(name, op) });
  }
}
console.log(`world ${world}, operator ${op}: ${plan.length} seat(s) to move${SEND ? "" : " (DRY RUN: add --send)"}`);
for (const p of plan) console.log(`  ${String(p.clan).padStart(2)} ${p.nation.padEnd(16)} ${p.from.slice(0, 26).padEnd(26)} -> ${p.name} (${p.to})`);
if (!SEND || !plan.length) { await store.close(); } else {

const ownerFile = arg("--owner-key", `.keys/${world}.json`);
const ok = JSON.parse(fs.readFileSync(ownerFile, "utf8")); // never printed
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" }); // steadier than dRPC for sends (12 Nov: two 500s)
const owner = new Account(ok.account_id, provider, ok.private_key);
if (ok.account_id !== (await chain.config()).owner) throw new Error(`${ownerFile} is not the world's owner`);
for (const p of plan) {
  process.stdout.write(`  ${p.nation}: `);
  await chain.aiEnsure(p.to, 0.6);
  if (!(await store.claimGodName(p.to, p.name))) console.log(`(name ${p.name} was already given; kept)`);
  await store.addAiGod("testnet", p.to, p.name, temperamentOf(p.name));
  // An RPC error after sending (a 500 on a move that landed, 12 Nov): look on chain before trying again.
  const movedNow = async () => (await chain.clans()).find((c) => c.id === p.clan).gods.some((g) => g.account === p.to);
  let r = null;
  try { r = await A.sendChecked({ send: () => owner.callFunctionRaw({ contractId: world, methodName: "move_god", args: { clan_id: p.clan, from: p.from, to: p.to }, deposit: 2n * 10n ** 22n, gas: 200n * 10n ** 12n }), landed: async () => ((await movedNow()) ? { transaction: { hash: "(landed)" }, receipts_outcome: [] } : null) }); }
  catch (e) { console.log(`FAILED ${String(e.message || e).slice(0, 200)}`); continue; }
  const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
  if (fail) { console.log(`FAILED ${JSON.stringify(fail.outcome.status.Failure).slice(0, 200)}`); continue; }
  await new Promise((res) => setTimeout(res, 3000)); // testnet views lag a write
  const now = (await chain.clans()).find((c) => c.id === p.clan);
  const moved = now.gods.some((g) => g.account === p.to) && !now.gods.some((g) => g.account === p.from);
  console.log(`${moved ? "moved" : "NOT MOVED"} (tx ${r.transaction.hash})`);
}
await store.close();
}
