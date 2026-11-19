// AI gods (his calls 12 Nov). Every seat but North Pole's belongs to an AI god: a real NEAR account with its
// own key (derived from the operator key, engine/aigods-chain), acting only through the calls a player's god
// panel sends (src/live/calls.js). Claude (Sonnet, the gods' own $0.25 pot) decides WHAT; this file decides
// what is ALLOWED, checks the plan, and spreads the actions over the 2 hours to the next turn.
// His rules: they work to recover the nations that fell away. Since 16 Nov they can do what a player's god can:
// take their whole stake out (withdraw: they leave that nation, and a nation whose last god leaves ends) and buy a
// seat someone has listed (a plain payment to the escrow, nothing else). Anything else still can't be signed.
// Tested in engine/test-aigods.mjs and engine/test-16nov.mjs.
import { createHash } from "node:crypto";
import { NETWORKS } from "./config.mjs";

// ---- the guard: every call an AI god signs passes through here first ----
const WORLD_METHODS = new Set(["bless", "withdraw"]); // putting NEAR in, and (16 Nov) taking its whole stake out
const POWER_METHODS = new Set(["whisper", "smite", "rule", "root_out"]); // council motions it may raise
const isDao = (acct) => /\.sputnikv2\.testnet$|\.sputnik-dao\.near$/.test(String(acct));
const b64json = (s) => { try { return JSON.parse(Buffer.from(String(s), "base64").toString()); } catch { return null; } };
/** Throws unless `call` is one an AI god may send. world: the world contract (defaults to this network's). */
export function guard(call, world = NETWORKS.testnet.world) {
  const no = (why) => { throw new Error(`not allowed for an AI god: ${why}`); };
  if (!call || typeof call !== "object") no("no call");
  if (call.receiver === world) {
    if (!WORLD_METHODS.has(call.method)) no(`${call.method} on the world`);
    return true;
  }
  if (!isDao(call.receiver)) no(`a call to ${call.receiver}`);
  if (BigInt(call.deposit ?? 0) > 10n ** 23n) no("a large deposit to a council"); // a motion bond is 0.01
  if (call.method === "act_proposal") {
    if (call.args?.action !== "VoteApprove" && call.args?.action !== "VoteReject") no(`a ${call.args?.action} vote`); // 13 Nov: it judges co-gods' motions
    return true;
  }
  if (call.method !== "add_proposal") no(`${call.method} on a council`);
  const fc = call.args?.proposal?.kind?.FunctionCall;
  if (!fc || fc.receiver_id !== world || fc.actions?.length !== 1) no("a motion that isn't one world power");
  const inner = fc.actions[0];
  if (!POWER_METHODS.has(inner.method_name) || String(inner.deposit ?? "0") !== "0") no(`a motion to ${inner.method_name}`);
  if (inner.method_name === "root_out") { const a = typeof inner.args === "string" ? b64json(inner.args) : inner.args; if (a && typeof a.point === "string" && !a.point.startsWith("act of god:")) no("rooting out research"); }
  return true;
}

/** A plain payment an AI god may make (16 Nov): only to the escrow (buying a listed seat), only a positive amount
 *  no bigger than the most a seat can ask. Throws otherwise. */
export function guardPay(to, yocto, escrow) {
  if (!escrow || to !== escrow) throw new Error(`not allowed for an AI god: a payment to ${to}`);
  const y = BigInt(yocto ?? 0);
  if (y <= 0n || y > 10000n * 10n ** 24n) throw new Error("not allowed for an AI god: that amount");
  return true;
}

// ---- judging a co-god's motion (his call 13 Nov) ----
// A nation can hold AI gods and other gods at once (a human bought one AI seat, or blessed in). A motion there needs a
// majority, so an AI god reads each one a co-god raises and votes yes or no. The rule, plain: it backs anything that
// helps the nation (whispers, rulings on gifts, stunting a Trickster, an Act of God on a rival) and blocks what takes
// from it (rooting out its own research, sending its staking away, anything that isn't one of the world's powers).
const APPROVED = new Set(["whisper", "rule", "smite"]);
const argsOf = (a) => { try { return typeof a === "string" ? JSON.parse(Buffer.from(a, "base64").toString()) : a || {}; } catch { return {}; } };
export function judgeMotion({ motion, world }) {
  const fc = motion?.kind?.FunctionCall;
  if (!fc || fc.receiver_id !== world || fc.actions?.length !== 1) return { approve: false, why: "it isn't one of the world's powers" };
  const act = fc.actions[0], args = argsOf(act.args);
  if (APPROVED.has(act.method_name)) return { approve: true, why: `a ${act.method_name} helps the nation` };
  if (act.method_name === "root_out") return String(args.point || "").startsWith("act of god:") ? { approve: true, why: "an Act of God on a rival" } : { approve: false, why: "it would root out the nation's own research" };
  if (act.method_name === "release_staking") return { approve: false, why: "it would send the nation's staking away" };
  return { approve: false, why: `it doesn't back a motion to ${act.method_name}` };
}
/** The motions `me` has to judge: still open, raised by someone who isn't an AI god, not yet voted on by `me`. */
export const motionsToJudge = (proposals, me, ai) => proposals.filter((p) => p.status === "InProgress" && !ai.has(p.proposer) && !(p.votes && me in p.votes));

// ---- checking Claude's plan ----
const KINDS = new Set(["whisper", "bless", "smite", "rule", "fire", "pitch", "ask", "list", "withdraw"]); // "buy" is checked on its own (its nation isn't one of the god's)
export const SEAT_RESERVE = 0.3; // grace an AI god keeps after buying a seat, for its motions' bonds and gas
export const MAX_ACTIONS = 10; // per god per turn
export const MIN_BLESS = 0.1; // under 0.1 a blessing moves nobody (reverence rules, 9 Nov)
// Each whisper costs a Claude call when the citizens judge it: 2 a turn, 8 a UTC day per god (12 Nov).
export const WHISPERS_PER_TURN = 2, WHISPERS_PER_DAY = 8;
/** sit = { god, allowance (NEAR left today), clans: [ids it holds], reports: {clan: [{id, accused}]},
 *  gifts: {clan: [{id}]}, aogToday }. Returns the actions that may run, cleaned. */
export function validatePlan(plan, sit) {
  const out = [];
  let left = Math.max(0, Number(sit.allowance) || 0), fires = Number(sit.aogToday) || 0;
  let whispers = 0, whisperRoom = sit.whisperRoom != null ? Math.max(0, Number(sit.whisperRoom)) : Math.max(0, WHISPERS_PER_DAY - (Number(sit.whispersToday) || 0)); // paced over the day (aiact.paced)
  const locked = new Set(sit.locked || []); // powers its milestones haven't opened (engine/milestones.mjs)
  const POWER = { rule: "rule", smite: "smite", fire: "fire", list: "list" };
  let wallet = Math.max(0, Number(sit.wallet) || 0);
  for (const a of Array.isArray(plan) ? plan : []) {
    if (out.length >= MAX_ACTIONS) break;
    // Buying a seat (16 Nov): only a listing it was shown (never in a nation it already sits in), one a turn, paid
    // from its own wallet with SEAT_RESERVE left over for its motions.
    if (a?.kind === "buy") {
      const l = (sit.listings || []).find((x) => Number(x.id) === Number(a.listing));
      if (l && !sit.clans.includes(Number(l.clan)) && !out.some((x) => x.kind === "buy") && l.price + SEAT_RESERVE <= wallet) { out.push({ kind: "buy", clan: Number(l.clan), listing: Number(l.id), price: l.price }); wallet -= l.price; }
      continue;
    }
    if (!a || !KINDS.has(a.kind) || !sit.clans.includes(Number(a.clan))) continue;
    // Taking its whole stake out of a nation (16 Nov): at most one a turn.
    if (a.kind === "withdraw") { if (!out.some((x) => x.kind === "withdraw")) out.push({ kind: "withdraw", clan: Number(a.clan) }); continue; }
    if (POWER[a.kind] && locked.has(POWER[a.kind])) continue;
    const clan = Number(a.clan);
    if (a.kind === "whisper") {
      const text = String(a.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (text && whispers < WHISPERS_PER_TURN && whispers < whisperRoom) { out.push({ kind: "whisper", clan, text }); whispers++; }
    } else if (a.kind === "bless") {
      const near = Math.round(Math.min(Number(a.near) || 0, left) * 100) / 100;
      if (near >= MIN_BLESS) { out.push({ kind: "bless", clan, near }); left -= near; }
    } else if (a.kind === "smite") {
      // Ask the accused first (PLAN_13NOV step 2): a stunt only once they've answered.
      const r = (sit.reports?.[clan] || []).find((x) => x.id === a.report);
      if (r?.answer) out.push({ kind: "smite", clan, report: r.id, agent: r.accused, verdict: a.verdict === "Kill" ? "Kill" : "Stunt" });
    } else if (a.kind === "list") {
      // Whispering to the Broker (PLAN_13NOV step 3): only what this nation can sell, 1-3, one request a nation.
      const can = new Set((sit.sellable?.[clan] || []).map((x) => x.token));
      const tokens = [...new Set((Array.isArray(a.tokens) ? a.tokens : []).filter((t) => can.has(t)))].slice(0, 3);
      if (tokens.length && !out.some((x) => x.kind === "list" && x.clan === clan)) out.push({ kind: "list", clan, tokens });
    } else if (a.kind === "ask") {
      const r = (sit.reports?.[clan] || []).find((x) => x.id === a.report);
      if (r && !r.asked && !r.answer && !out.some((x) => x.kind === "ask" && x.report === r.id)) out.push({ kind: "ask", clan, report: r.id });
    } else if (a.kind === "rule") {
      const g = (sit.gifts?.[clan] || []).find((x) => Number(x.id) === Number(a.gift));
      if (g && a.reward !== false) out.push({ kind: "rule", clan, gift: Number(g.id), reward: true });
    } else if (a.kind === "pitch") {
      // The Scholars' pitch (PLAN_13NOV step 1): one pick a nation, only a point it was pitched. Free: stored as a choice.
      if ((sit.pitch?.[clan] || []).includes(a.point) && !out.some((x) => x.kind === "pitch" && x.clan === clan)) out.push({ kind: "pitch", clan, point: a.point });
    } else if (a.kind === "fire") {
      const target = Number(a.target);
      // Never on a nation under the cooldown (16 Nov, engine/cooldown.mjs): sit.shielded lists them.
      if (fires < 1 && Number.isInteger(target) && !sit.clans.includes(target) && !(sit.shielded || []).includes(target)) { out.push({ kind: "fire", clan, target }); fires++; }
    }
  }
  // A god leaving a nation does nothing else there this turn.
  const gone = out.find((x) => x.kind === "withdraw")?.clan;
  return gone == null ? out : out.filter((x) => x.clan !== gone || x.kind === "withdraw");
}

/** One smite per report per plan (his call 19 Nov): gods sharing a nation each smote the same report and each paid
 *  the stunt. all = [{ god, kind, clan, report, ... }] across every god; sits gives each god's reverence per nation.
 *  The smite kept is the one from the god with the most reverence in that nation (it can best afford the stunt). */
export function oneSmitePerReport(all, sits) {
  const rev = (god, clan) => Number(sits.find((x) => x.god === god)?.nations?.find((n) => n.id === clan)?.myReverence) || 0;
  const best = new Map();
  for (const a of all) {
    if (a.kind !== "smite") continue;
    const k = `${a.clan}|${a.report}`, cur = best.get(k);
    if (!cur || rev(a.god, a.clan) > rev(cur.god, cur.clan)) best.set(k, a);
  }
  return all.filter((a) => a.kind !== "smite" || best.get(`${a.clan}|${a.report}`) === a);
}

// ---- planning in batches (16 Nov) ----
// One Claude call for every AI god at once failed as the gods grew past 30: a cut-off answer about one turn in three,
// and the answers that parsed planned a handful of actions for 40 gods. Now the gods are planned a few at a time;
// a batch whose call fails gets the stand-in plan (fakePlan) instead, so no god is ever left without a plan.
export const PLAN_BATCH = 6;
/** plan(batch) -> { [god]: actions }. Returns { plans, failed: [errors] }; never throws. */
export async function planInBatches(sits, plan, { size = PLAN_BATCH, fallback = fakePlan, log = () => {} } = {}) {
  const plans = {}, failed = [];
  for (let i = 0; i < sits.length; i += size) {
    const batch = sits.slice(i, i + size);
    let got = null;
    try { got = await plan(batch); } catch (e) { failed.push(String(e.message || e).slice(0, 160)); log(`  AI gods: batch ${i / size + 1} failed (${failed.at(-1)}); the stand-in plan covers it`); }
    for (const sit of batch) {
      const mine = got?.[sit.god];
      plans[sit.god] = Array.isArray(mine) && mine.length ? mine : fallback(sit);
    }
  }
  return { plans, failed };
}

// ---- one god per call (19 Nov) ----
// In batches of 6, Claude left gods out of its answer (never the first of a batch; ~5 a plan: debug/plan-cost). One
// call per god leaves nobody out, at about twice the planner's cost (his call: worth it). A god whose answer is
// missing, empty or failed is asked once more before it gets the stand-in.
export const PLAN_CONC = 5; // calls in flight at once
/** plan([sit]) -> { [god]: actions }. Returns { plans, outcomes: { god: planned|retried|stand-in }, failed }; never throws. */
export async function planEach(sits, plan, { conc = PLAN_CONC, fallback = fakePlan, log = () => {} } = {}) {
  const plans = {}, outcomes = {}, failed = [];
  const ask = async (sit) => {
    try {
      const got = (await plan([sit])) || {};
      const keys = Object.keys(got);
      // One god asked, one entry back: it is that god's, whatever name Claude wrote on it.
      const mine = got[sit.god] ?? (keys.length === 1 ? got[keys[0]] : undefined);
      return Array.isArray(mine) && mine.length ? mine : null;
    } catch (e) { failed.push(String(e.message || e).slice(0, 160)); return null; }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(conc, sits.length) }, async () => {
    while (next < sits.length) {
      const sit = sits[next++];
      let mine = await ask(sit), how = "planned";
      if (!mine) { mine = await ask(sit); how = "retried"; }
      if (!mine) { mine = fallback(sit); how = "stand-in"; log(`  AI gods: ${sit.god.split(".")[0]} got no plan twice; the stand-in plan covers it`); }
      plans[sit.god] = mine;
      outcomes[sit.god] = how;
    }
  }));
  return { plans, outcomes, failed };
}
/** The plan's one log line: who was planned, re-asked or stood in, actions kept and dropped, and Claude's cost. */
export function planSummary(outcomes, { actions = 0, dropped = 0, usd = 0 } = {}) {
  const by = (k) => Object.entries(outcomes).filter(([, v]) => v === k).map(([g]) => g.split(".")[0]);
  const re = by("retried"), st = by("stand-in");
  return `  AI gods: ${by("planned").length} planned, ${re.length} re-asked, ${st.length} stand-in; ${actions} actions kept, ${dropped} dropped by the checks; Claude $${usd.toFixed(4)}` +
    (re.length ? `; re-asked: ${re.join(", ")}` : "") + (st.length ? `; stand-in: ${st.join(", ")}` : "");
}

// ---- the trickle: spread over the 2 hours to the next turn ----
function rng(seed) {
  let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Times for each action: one slot each, evenly spaced across [start, start+span), a little seeded jitter
 *  (never enough to leave a gap over a minute when there are enough actions), gods interleaved so one god's
 *  transactions are at least 20 s apart. Same seed, same times. */
export function schedule(actions, start, span, seed) {
  const R = rng(seed);
  // Interleave gods round-robin (in a seeded order) so the same god never takes two slots in a row.
  const byGod = new Map();
  for (const a of actions) { if (!byGod.has(a.god)) byGod.set(a.god, []); byGod.get(a.god).push(a); }
  const gods = [...byGod.keys()].sort().sort(() => R() - 0.5);
  const order = [];
  for (let round = 0; order.length < actions.length; round++) for (const g of gods) { const list = byGod.get(g); if (round < list.length) order.push(list[round]); }
  const n = order.length, sp = span / Math.max(1, n);
  const jitter = sp < 60e3 ? Math.max(0, Math.min(sp * 0.4, (60e3 - sp) / 2)) : sp * 0.4;
  const out = order.map((a, i) => ({ ...a, at: Math.round(start + sp * (i + 0.5) + (R() * 2 - 1) * jitter) }));
  out.sort((x, y) => x.at - y.at);
  return out;
}

// ---- accounts and keys ----
/** An AI god's NEAR account: its name, made safe ("Ahura Mazda" -> ahura-mazda.<parent>). */
export function accountFor(name, parent) {
  const slug = String(name).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "god";
  return `${slug}.${parent}`;
}
/** The 32-byte seed of an AI god's key: from the operator key, so no new secret exists anywhere. */
export const godSeed = (opKey, world, account) => createHash("sha256").update(`adf-god|${opKey}|${world}|${account}`).digest();

// ---- recovery first ----
/** Nations in the order an AI god should tend them: the most fallen-away first. */
export function recoveryOrder(nations) {
  const score = (n) => (30 - Math.min(30, Number(n.standing) || 0)) * 2 + (n.tricksters || 0) * 10 + (n.mood === "hungry" ? 15 : 0) + (n.openGifts || 0) * 5;
  return [...nations].sort((a, b) => score(b) - score(a) || a.id - b.id);
}
/** The stand-in plan (tests and sims, ADF_FAKE_LLM): rule waiting gifts, whisper, feed the hungriest. */
export function fakePlan(sit) {
  const out = [];
  let left = sit.allowance;
  for (const n of recoveryOrder(sit.nations || [])) {
    for (const g of sit.gifts?.[n.id] || []) out.push({ kind: "rule", clan: n.id, gift: g.id, reward: true });
    // A recovery whisper names what's wrong right now (hunger, a Trickster, the war), as a real god's would.
    const parts = [n.mood === "hungry" ? "You are hungry: eat before you read" : "You are fed: read deeper", (n.tricksters || 0) ? "a trickster walks among you, check every citation" : "keep checking every citation", n.war ? `hold the walls against ${n.war} in this war` : ""].filter(Boolean);
    out.push({ kind: "whisper", clan: n.id, text: `${parts.join("; ")}. I am still here.` });
    // Feed it to its daily need (what's missing from the last 24 h), at least the 0.1 that moves reverence.
    const feed = Math.min(left, Math.max(0.15, +((n.need || 0) - (n.fed24h || 0)).toFixed(2)));
    if (n.mood === "hungry" && feed >= 0.1) { out.push({ kind: "bless", clan: n.id, near: feed }); left -= feed; }
  }
  return out;
}

// ---- sending through a flaky RPC (12 Nov: a 500 on a motion that had in fact landed) ----
const REFUSED = /panicked|not allowed|ERR_|refused|Not a god|insufficient|Not enough balance/i;
/** send(): sends once. landed(): looks on chain, returns the result if it's there, else null. A contract
 *  refusal fails at once; any other error: look, then send once more, then look again, then fail. */
export async function sendChecked({ send, landed, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await send(); } catch (e) {
      lastErr = e;
      if (REFUSED.test(String(e.message || e))) throw e;
      await sleep(4000);
      const seen = await landed().catch(() => null);
      if (seen) return seen;
    }
  }
  throw lastErr;
}

// ---- votes that don't wait on the motion (19 Nov) ----
// The yes vote that passes a motion also runs it; waiting for every receipt (EXECUTED_OPTIMISTIC) kept the RPC call
// open ~90 s after all of them had executed (within 3 s: debug/receipt-times.mjs). A vote now returns once it's in a
// final block; then only the DAO's own receipt is read, to catch a refusal.
/** send() -> { hash } (sent with INCLUDED_FINAL). status(hash) -> the tx outcome with receipts_outcome, or null when the
 *  node doesn't know yet. Returns { hash } or { hash, unconfirmed: true } after `tries` looks; throws on a refusal. */
export async function confirmVote({ send, status, dao, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 12 }) {
  const { hash } = await send();
  for (let i = 0; i < tries; i++) {
    await sleep(1000);
    const o = await status(hash).catch(() => null);
    const mine = o?.receipts_outcome?.find((x) => x.outcome?.executor_id === dao);
    if (!mine) continue;
    const st = mine.outcome.status || {};
    if (st.Failure) throw new Error(`act_proposal refused: ${JSON.stringify(st.Failure).slice(0, 200)}`);
    if ("SuccessValue" in st || "SuccessReceiptId" in st) return { hash };
  }
  return { hash, unconfirmed: true };
}
/** The AI co-gods who should vote yes on `proposer`'s motion: only as many as it still needs (Sputnik RoleWeight 1/2:
 *  floor(n/2)+1 of the council's n), none once it's passed. A vote after that is refused (ERR_PROPOSAL_NOT_READY_FOR_VOTE). */
export function coVoters(clan, proposer, ai, proposal) {
  if (proposal?.status !== "InProgress") return [];
  // The proposer has just voted yes (aiSend's second call); a lagging read may not show it yet, so it counts anyway.
  const n = (clan.gods || []).length, votes = { ...(proposal.votes || {}), [proposer]: "Approve" };
  let need = Math.max(0, Math.floor(n / 2) + 1 - Object.keys(votes).length);
  const out = [];
  for (const g of clan.gods || []) {
    if (need <= 0) break;
    if (g.account === proposer || !ai.has(g.account) || g.account in votes) continue;
    out.push(g.account); need--;
  }
  return out;
}

/** Gifts the Warden passed are always rewarded (13 Nov): the plan gets a ruling for every one it forgot. The god
 *  still signs it like any motion; a gift the Warden failed is left to the god's judgement. */
export function withPassedGifts(actions, sit) {
  const out = [...actions];
  for (const [clan, gifts] of Object.entries(sit.gifts || {})) {
    if (!sit.clans.includes(Number(clan))) continue;
    for (const g of gifts) if (g.warden_passed && !out.some((a) => a.kind === "rule" && a.gift === Number(g.id))) out.unshift({ kind: "rule", clan: Number(clan), gift: Number(g.id), reward: true });
  }
  return out;
}
