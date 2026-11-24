// Keeps every testnet account the live world spends from funded, so nothing stalls for want of testnet NEAR
// (24 Nov 2026: the operator ran dry and the world sat still for 11 hours). Runs once an hour as the Railway cron
// service "keeper" (it starts, does its work, exits; nothing kept on disk). Each run, in order:
//   1. refill: ask NEAR's testnet helper for new accounts (10 testnet NEAR each) and delete each one into the pool.
//      The helper allows 10 per 12 hours per address; when it says no, the run just moves on.
//   2. operator: under OP_MIN, the pool tops it up to OP_TO. The operator signs every turn, DAO and world top-ups and
//      new AI gods' arrivals; it's the one account whose emptiness stops the world.
//   3. gods: on every 7th turn (turn number divisible by 7, ~every 14 h), each AI god with a seat is topped back up to
//      7 testnet NEAR (his call 24 Nov). Topping up is safe to repeat: a second run in the same turn only sends what a
//      god spent in between. Never takes the pool under RESERVE, which is kept for the operator.
// Everything is sent by the POOL, never the operator (the engine signs with the operator; a second sender races its
// nonce). Keys come from SPONSOR_ACCOUNT_ID / SPONSOR_PRIVATE_KEY (on your own machine: .keys/<pool>.json).
//   node scripts/keep-funded.mjs            # dry run
//   node scripts/keep-funded.mjs --send
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import fs from "node:fs";

const SEND = process.argv.includes("--send");
const POOL = process.env.SPONSOR_ACCOUNT_ID || "adf-pool1-hf0w8.testnet", OP = "adfontes-mw1fjpfx.testnet";
const HELPER = "https://helper.testnet.near.org/account";
const OP_MIN = 150, OP_TO = 400;   // operator floor and top-up target
const RESERVE = OP_TO;             // the gods' top-up never takes the pool under this
const GOD_TO = 7, EVERY = 7;       // top each AI god up to 7 NEAR on every 7th turn
const provider = new JsonRpcProvider({ url: process.env.RPC || "https://near-testnet.drpc.org" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = async (id) => { try { return Number(BigInt((await provider.viewAccount({ accountId: id })).amount) / 10n ** 18n) / 1e6; } catch (e) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e.message))) return null; throw e; } };
const yocto = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const poolKey = process.env.SPONSOR_PRIVATE_KEY || JSON.parse(fs.readFileSync(`.keys/${POOL}.json`, "utf8")).private_key;
const pool = new Account(POOL, provider, poolKey);
const send = async (to, n) => {
  const r = await pool.transfer({ receiverId: to, amount: yocto(n) });
  if (r?.receipts_outcome?.some((o) => o.outcome.status.Failure)) throw new Error(`transfer failed: ${r?.transaction?.hash}`);
};

// 1. Helper accounts into the pool.
async function refill() {
  if (!SEND) return "would ask the helper for up to 10 accounts";
  let made = 0, swept = 0, said = "";
  const fresh = [];
  for (let i = 0; i < 10; i++) {
    const id = `adf-fill${Date.now().toString(36)}${i}.testnet`, kp = KeyPair.fromRandom("ed25519");
    const res = await fetch(HELPER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) }).catch((e) => ({ ok: false, status: String(e.message) }));
    if (!res.ok) { said = `, then the helper said ${res.status}`; break; }
    made++; fresh.push({ id, key: kp.toString() });
  }
  for (const a of fresh) {
    for (let t = 0; t < 40 && (await near(a.id)) == null; t++) await sleep(1500); // up to a minute to show up
    try { await new Account(a.id, provider, a.key).deleteAccount(POOL); swept++; }
    catch (e) {
      // 24 Nov: a delete that landed can still come back as an error; if the account is gone, its NEAR is in the pool.
      if ((await near(a.id)) == null) swept++;
      else console.log(`  couldn't sweep ${a.id}: ${String(e.message).slice(0, 100)}`);
    }
  }
  return `${made} made, ${swept} swept${said}`;
}

// 2. The operator.
async function operator() {
  const op = await near(OP), p = await near(POOL);
  if (op >= OP_MIN) return `operator ${op.toFixed(1)}, fine`;
  const give = +Math.min(OP_TO - op, Math.max(0, p - 3)).toFixed(4);
  if (!SEND) return `operator ${op.toFixed(1)}, would send ${give}`;
  if (give < 1) return `operator ${op.toFixed(1)} is LOW and the pool can't cover it (${p})`;
  await send(OP, give);
  return `operator ${op.toFixed(1)}, sent ${give}`;
}

// 3. The AI gods.
async function gods() {
  const W = await (await fetch("https://adfontes.fun/api/world?net=testnet")).json();
  const turn = W.day;
  if (!Number.isInteger(turn)) return "no turn number from /api/world";
  if (turn % EVERY !== 0) return `turn ${turn}, next top-up at turn ${turn + EVERY - (turn % EVERY)}`;
  const clans = await provider.callFunction({ contractId: W.world, method: "list_clans", args: { limit: 100 } });
  const list = [...new Set(clans.filter((c) => c.alive).flatMap((c) => c.gods.map((g) => g.account)))].filter((a) => W.ai.includes(a)).sort();
  let room = (await near(POOL)) - RESERVE, sent = 0, topped = 0, short = 0;
  for (const a of list) {
    const need = +(GOD_TO - ((await near(a)) ?? 0)).toFixed(4);
    if (need < 0.05) continue;
    if (room < need + 1) { short++; continue; }
    if (!SEND) { topped++; sent += need; continue; }
    try { await send(a, need); topped++; sent += need; room -= need; }
    catch (e) { console.log(`  top-up for ${a}: ${String(e.message).slice(0, 100)}`); }
  }
  return `turn ${turn}: ${topped} of ${list.length} gods topped up to ${GOD_TO} (${sent.toFixed(2)} NEAR)${short ? `, ${short} left for the next run (pool at its reserve)` : ""}`;
}

const out = [];
for (const [name, step] of [["refill", refill], ["operator", operator], ["gods", gods]]) {
  try { out.push(`${name}: ${await step()}`); } catch (e) { out.push(`${name}: ERROR ${String(e.message).slice(0, 140)}`); }
}
console.log(`${new Date().toISOString().slice(0, 16)} ${SEND ? "" : "(dry run) "}${out.join(" | ")} | pool ${(await near(POOL))?.toFixed(1)}`);
