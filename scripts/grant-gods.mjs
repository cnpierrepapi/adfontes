// His call 16 Nov: every god with a seat, AI gods and Brahma (North Pole's god) alike, gets 7 grace (testnet NEAR) in
// its own wallet, from the sponsor pool. AI gods can spend it like a player: bless, or buy a seat (engine/aiact.mjs).
// Dry run unless --send. Each payment is written to debug/grant-16nov.json as it lands, so a rerun skips who's paid.
//   node scripts/grant-gods.mjs            # who would get what
//   node scripts/grant-gods.mjs --send     # pay them (testnet only)
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

const SEND = process.argv.includes("--send"), EACH = 7, POOL = "adf-pool1-hf0w8.testnet";
const LOG = "debug/grant-16nov.json";
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const W = await (await fetch("https://adfontes.fun/api/world?net=testnet")).json();
const clans = await provider.callFunction({ contractId: W.world, method: "list_clans", args: { limit: 100 } });
const gods = [...new Set(clans.filter((c) => c.alive).flatMap((c) => c.gods.map((g) => g.account)))].sort();
const done = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
const todo = gods.filter((a) => !done[a]);
const poolNear = Number(BigInt((await provider.viewAccount({ accountId: POOL })).amount) / 10n ** 21n) / 1000;
console.log(`${gods.length} gods with a seat (${gods.filter((a) => W.ai.includes(a)).length} AI); ${Object.keys(done).length} already paid; ${todo.length} to pay ${EACH} grace each = ${todo.length * EACH}. Pool holds ${poolNear}.`);
for (const a of todo) console.log(`  ${W.names[a] ?? "?"}${W.ai.includes(a) ? " (AI)" : ""}: ${a}`);
if (!SEND) { console.log("\nDry run. Add --send to pay."); process.exit(0); }
if (poolNear < todo.length * EACH + 5) throw new Error("the pool can't cover it with 5 to spare");
const key = JSON.parse(fs.readFileSync(`.keys/${POOL}.json`, "utf8"));
const pool = new Account(POOL, provider, key.private_key);
fs.mkdirSync("debug", { recursive: true });
for (const a of todo) {
  const r = await pool.transfer({ receiverId: a, amount: BigInt(EACH) * 10n ** 24n });
  const hash = r?.transaction?.hash ?? null;
  done[a] = { near: EACH, tx: hash, at: new Date().toISOString() };
  fs.writeFileSync(LOG, JSON.stringify(done, null, 1));
  console.log(`  paid ${W.names[a] ?? a}: ${hash}`);
}
console.log(`done: ${Object.keys(done).length} gods paid`);
