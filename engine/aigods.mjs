// AI gods (his calls 12 Nov). Every seat but North Pole's belongs to an AI god: a real NEAR account with its
// own key (derived from the operator key, engine/aigods-chain), acting only through the calls a player's god
// panel sends (src/live/calls.js). Claude (Sonnet, the gods' own $0.25 pot) decides WHAT; this file decides
// what is ALLOWED, checks the plan, and spreads the actions over the 2 hours to the next turn.
// His rules: they work to recover the nations that fell away; they can never take their stake out (no
// withdraw, no claims, no leaving), so a nation under AI gods only ends by falling in war.
// Tested in engine/test-aigods.mjs.
import { createHash } from "node:crypto";
import { NETWORKS } from "./config.mjs";

// ---- the guard: every call an AI god signs passes through here first ----
const WORLD_METHODS = new Set(["bless"]); // the only world call: putting NEAR IN
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
const KINDS = new Set(["whisper", "bless", "smite", "rule", "fire", "pitch", "ask", "list"]);
export const MAX_ACTIONS = 10; // per god per turn
export const MIN_BLESS = 0.1; // under 0.1 a blessing moves nobody (reverence rules, 9 Nov)
// Each whisper costs a Claude call when the citizens judge it: 2 a turn, 8 a UTC day per god (12 Nov).
export const WHISPERS_PER_TURN = 2, WHISPERS_PER_DAY = 8;
/** sit = { god, allowance (NEAR left today), clans: [ids it holds], reports: {clan: [{id, accused}]},
 *  gifts: {clan: [{id}]}, aogToday }. Returns the actions that may run, cleaned. */
export function validatePlan(plan, sit) {
  const out = [];
  let left = Math.max(0, Number(sit.allowance) || 0), fires = Number(sit.aogToday) || 0;
  let whispers = 0, whisperRoom = Math.max(0, WHISPERS_PER_DAY - (Number(sit.whispersToday) || 0));
  for (const a of Array.isArray(plan) ? plan : []) {
    if (out.length >= MAX_ACTIONS) break;
    if (!a || !KINDS.has(a.kind) || !sit.clans.includes(Number(a.clan))) continue;
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
      if (fires < 1 && Number.isInteger(target) && !sit.clans.includes(target)) { out.push({ kind: "fire", clan, target }); fires++; }
    }
  }
  return out;
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
