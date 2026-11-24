// Keeps every testnet account the live world spends from funded, so nothing stalls for want of testnet NEAR
// (24 Nov 2026: the operator ran dry and the world sat still for 11 hours). Runs every 20 minutes from Windows Task
// Scheduler (task "ADF keep funded"); each run does four steps, in this order:
//   1. sweep: any helper account we made earlier and couldn't sweep yet (its key is on disk) is swept into the pool.
//   2. refill: make new accounts with NEAR's testnet helper (10 testnet NEAR each) and sweep them into the pool.
//      The key is written to .keys/fill/ BEFORE asking the helper, so an account that shows up late is swept by a later
//      run instead of being lost (the engine's own refill lost 57 of 90 accounts this way, 20-24 Nov).
//      When the helper refuses (its rate limit), we wait until the reset time it gives.
//   3. operator: under OP_MIN, the pool tops it up to OP_TO. The operator signs every turn, DAO and world top-ups and
//      new AI gods' arrivals; it's the one account whose emptiness stops the world.
//   4. grant: every AI god gets 7 testnet NEAR in its own wallet every 7 turns (~14 h; his call 24 Nov). Pays only
//      from what's above the pool's reserve for the operator.
// Everything is sent by the POOL, never the operator (the engine signs with the operator; a second sender races its
// nonce). Keys are read from .keys and never printed. Log: debug/keep-funded.log. State: debug/keep-funded.json.
//   node scripts/keep-funded.mjs            # dry run: what each step would do
//   node scripts/keep-funded.mjs --send
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SEND = process.argv.includes("--send");
const POOL = "adf-pool1-hf0w8.testnet", OP = "adfontes-mw1fjpfx.testnet";
const HELPER = "https://helper.testnet.near.org/account", FILL = ".keys/fill";
const OP_MIN = 150, OP_TO = 400;           // operator floor and top-up target
const RESERVE = OP_TO;                      // the grant never takes the pool below this: the operator comes first
const EACH = 7, EVERY = 7, MIN_HOURS = 13;  // grant: 7 NEAR, every 7 turns, never twice within 13 h
const STATE = "debug/keep-funded.json", LOCK = "debug/keep-funded.lock";
const provider = new JsonRpcProvider({ url: process.env.RPC || "https://near-testnet.drpc.org" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const say = (s) => console.log(`${stamp()} ${s}`);
const near = async (id) => { try { return Number(BigInt((await provider.viewAccount({ accountId: id })).amount) / 10n ** 18n) / 1e6; } catch (e) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e.message))) return null; throw e; } };
const yocto = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;

if (SEND) {
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60e3) { say("another run holds the lock; skipping"); process.exit(0); }
  fs.writeFileSync(LOCK, String(process.pid));
  process.on("exit", () => { try { fs.unlinkSync(LOCK); } catch {} });
}
const S = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { refillNextAt: 0, swept: 0, lost: 0, grant: { last: null, rounds: {} } };
// The grant's history from its first script (debug/god-grant.mjs, round 1 paid 24 Nov 20:38 UTC).
if (!S.grant.rounds || !Object.keys(S.grant.rounds).length) {
  const old = "debug/god-grant.json";
  if (fs.existsSync(old)) S.grant = JSON.parse(fs.readFileSync(old, "utf8"));
}
const save = () => SEND && fs.writeFileSync(STATE, JSON.stringify(S, null, 1));
const poolKey = JSON.parse(fs.readFileSync(`.keys/${POOL}.json`, "utf8")).private_key;
const pool = new Account(POOL, provider, poolKey);
const send = async (to, n) => {
  const r = await pool.transfer({ receiverId: to, amount: yocto(n) });
  if (r?.receipts_outcome?.some((o) => o.outcome.status.Failure)) throw new Error(`transfer failed: ${r?.transaction?.hash}`);
  return r?.transaction?.hash ?? null;
};

// 1. Sweep helper accounts we hold keys for.
async function sweepSaved() {
  if (!fs.existsSync(FILL)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(FILL)) {
    const file = path.join(FILL, f), k = JSON.parse(fs.readFileSync(file, "utf8"));
    const bal = await near(k.account_id);
    if (bal == null) {
      // Gone: either swept already (24 Nov: a delete that landed can still come back as an error, and the RPC's retry
      // then says "Signer does not exist") or the helper never made it. Either way there's nothing left to sweep.
      if (SEND && Date.now() - fs.statSync(file).mtimeMs > 10 * 60e3) fs.unlinkSync(file);
      continue;
    }
    if (!SEND) { say(`  would sweep ${k.account_id} (${bal})`); continue; }
    try { await new Account(k.account_id, provider, k.private_key).deleteAccount(POOL); fs.unlinkSync(file); n++; S.swept++; }
    catch (e) {
      if (/does not exist/i.test(String(e.message)) && (await near(k.account_id)) == null) { fs.unlinkSync(file); n++; S.swept++; continue; }
      say(`  couldn't sweep ${k.account_id} yet: ${String(e.message).slice(0, 100)}`);
    }
  }
  return n;
}

// 2. New helper accounts, keys saved first.
async function refill() {
  if (Date.now() < (S.refillNextAt || 0)) return `next try ${new Date(S.refillNextAt).toISOString().slice(11, 16)} UTC`;
  if (!SEND) return "would ask the helper for up to 10 accounts";
  fs.mkdirSync(FILL, { recursive: true });
  let made = 0;
  for (let i = 0; i < 10; i++) {
    const id = `adf-fill${Date.now().toString(36)}${i}.testnet`, kp = KeyPair.fromRandom("ed25519");
    const file = path.join(FILL, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ account_id: id, private_key: kp.toString() }));
    const res = await fetch(HELPER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) }).catch((e) => ({ ok: false, status: String(e.message), headers: new Map() }));
    if (!res.ok) {
      fs.unlinkSync(file);
      const reset = Number(res.headers.get?.("x-ratelimit-reset")) || 0;
      S.refillNextAt = reset ? reset * 1000 + 60e3 : Date.now() + 3600e3;
      return `${made} made, then the helper said ${res.status}; next try ${new Date(S.refillNextAt).toISOString().slice(11, 16)} UTC`;
    }
    made++;
  }
  S.refillNextAt = Date.now() + 20 * 60e3; // the helper took all 10: try again next run
  return `${made} made`;
}

// 3. The operator.
async function operator() {
  const op = await near(OP), p = await near(POOL);
  if (op >= OP_MIN) return `operator ${op.toFixed(1)}: fine`;
  const want = +(OP_TO - op).toFixed(4), give = Math.min(want, Math.max(0, p - 3));
  if (!SEND) return `operator ${op.toFixed(1)}: would send ${give}`;
  if (give < 1) return `operator ${op.toFixed(1)}: LOW and the pool can't cover it (${p})`;
  await send(OP, give);
  return `operator ${op.toFixed(1)}: sent ${give}`;
}

// 4. The AI gods' grant.
async function grant() {
  const G = S.grant;
  const W = await (await fetch("https://adfontes.fun/api/world?net=testnet")).json();
  const turn = W.day;
  if (!Number.isInteger(turn)) return `no turn number from /api/world`;
  let at = Object.entries(G.rounds).find(([, r]) => !r.done)?.[0];
  if (!at) {
    const hours = G.last == null ? Infinity : (Date.now() - Date.parse(G.rounds[G.last]?.finished ?? 0)) / 3600e3;
    if (G.last != null && !(turn - G.last >= EVERY && hours >= MIN_HOURS)) return `turn ${turn}: next round at turn ${G.last + EVERY} (${hours.toFixed(1)} h since the last)`;
    at = String(turn);
  }
  const clans = await provider.callFunction({ contractId: W.world, method: "list_clans", args: { limit: 100 } });
  const gods = [...new Set(clans.filter((c) => c.alive).flatMap((c) => c.gods.map((g) => g.account)))].filter((a) => W.ai.includes(a)).sort();
  const round = G.rounds[at] ?? { started: new Date().toISOString(), paid: {} };
  const todo = gods.filter((a) => !round.paid[a]);
  let room = (await near(POOL)) - RESERVE;
  if (!SEND) return `round at turn ${at}: would pay ${todo.length} gods ${EACH} each (${todo.length * EACH}); pool has ${room.toFixed(1)} above the reserve`;
  let short = 0;
  for (const a of todo) {
    if (room < EACH + 1) { short++; continue; }
    try { round.paid[a] = (await send(a, EACH)) ?? true; room -= EACH; G.rounds[at] = round; save(); }
    catch (e) { say(`  grant to ${a}: ${String(e.message).slice(0, 120)}`); }
  }
  const paid = gods.filter((a) => round.paid[a]).length;
  // A short round stays open: the next runs finish it as the refill brings NEAR in.
  if (paid === gods.length) { round.done = true; round.finished = new Date().toISOString(); G.last = Number(at); }
  G.rounds[at] = round; save();
  return `round at turn ${at}: ${paid}/${gods.length} paid${short ? `, ${short} waiting for the pool` : ""}`;
}

const out = [];
for (const [name, step] of [["sweep", sweepSaved], ["refill", refill], ["operator", operator], ["grant", grant]]) {
  try { out.push(`${name}: ${await step()}`); } catch (e) { out.push(`${name}: ERROR ${String(e.message).slice(0, 140)}`); }
  save();
}
// Sweep again: accounts the helper just made are usually on chain by now.
if (SEND && fs.existsSync(FILL) && fs.readdirSync(FILL).length) { await sleep(20e3); try { out.push(`sweep again: ${await sweepSaved()}`); } catch {} save(); }
say(`${out.join(" | ")} | pool ${(await near(POOL))?.toFixed(1)}, helper accounts swept so far ${S.swept}`);
