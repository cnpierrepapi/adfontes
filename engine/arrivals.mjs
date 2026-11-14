// Phase E (PLAN_REBUILD_12NOV, his answers 12 Nov): new AI gods arrive at random times, replayable from a seed.
// Mean gap 2 h for the first 48 h, then 4 h widening 15 min a real day, never past 6 h, never two within 30 min.
// Each newcomer founds a nation (Claude names it) or blesses one. At 100 living nations, or when the operator can't
// pay a founding and keep its floor, it blesses; with too little even for that, it waits. It blesses only nations
// with no human god: a blessing seats the blesser on the nation's council, and a human's council stays theirs.
// engine/aiact.mjs arrive() does the rest; engine/loop.mjs starts it when due. Tested in test-arrivals.mjs.
import { createHash } from "node:crypto";

export const ARRIVE = { fastHours: 48, fastMean: 2, slowMean: 4, widenPerDay: 0.25, maxMean: 6, maxFactor: 3, minGapMs: 30 * 60e3, cap: 100, foundNear: 6, keepNear: 30, blessNear: 1 };
const H = 3600e3;
const unit = (seed) => parseInt(createHash("sha256").update(String(seed)).digest("hex").slice(0, 12), 16) / 2 ** 48;

/** The mean gap (hours) this far after arrivals began. */
export function meanGapHours(sinceStartMs) {
  const h = sinceStartMs / H;
  if (h < ARRIVE.fastHours) return ARRIVE.fastMean;
  return Math.min(ARRIVE.maxMean, ARRIVE.slowMean + ARRIVE.widenPerDay * Math.floor((h - ARRIVE.fastHours) / 24));
}
/** Arrivals state: { start, last, n, seed }. */
export const init = (now, seed) => ({ start: now, last: now, n: 0, seed: String(seed) });
/** When the next one comes: an exponential gap (seeded), at least 30 min, at most 3x the mean. */
export function nextAt(a) {
  const mean = meanGapHours(a.last - a.start) * H;
  const g = -Math.log(1 - Math.min(0.999999, unit(`${a.seed}|${a.n}`))) * mean;
  return a.last + Math.round(Math.max(ARRIVE.minGapMs, Math.min(mean * ARRIVE.maxFactor, g)));
}
export const advance = (a, at) => ({ ...a, last: at, n: a.n + 1 });
export const due = (a, now) => !!a && now >= nextAt(a);

/** Found, bless or wait. alive = living nations; opNear = the operator's grace; wantsFound = the newcomer's wish. */
export function decide({ alive, opNear, wantsFound }) {
  if (opNear < ARRIVE.blessNear + 1) return { kind: "wait", why: "not enough grace even to bless" };
  if (alive >= ARRIVE.cap) return { kind: "bless", why: `the world already holds ${ARRIVE.cap} nations` };
  if (opNear < ARRIVE.foundNear + ARRIVE.keepNear) return { kind: "bless", why: "not enough grace to found a nation just now" };
  return wantsFound ? { kind: "found", why: "it wanted a nation of its own" } : { kind: "bless", why: "it chose to join a nation" };
}
/** A free god name, picked by the seed. Null when every name is taken. */
export function pickName(names, taken, seed) {
  const free = names.filter((n) => !taken.has(n));
  return free.length ? free[Math.floor(unit(`name|${seed}`) * free.length)] : null;
}
/** A nation name: letters, digits, spaces, ' and -, 3 to 32 characters, not already a nation's. */
export function cleanNationName(s, existing = []) {
  const t = String(s ?? "").replace(/[^\p{L}\p{N} '\-]/gu, "").replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 32) return null;
  if (existing.some((e) => String(e).toLowerCase() === t.toLowerCase())) return null;
  return t;
}
/** Nations a newcomer may bless: living, every god an AI god. */
export const blessTargets = (clans, ai) => clans.filter((c) => c.alive !== false && (c.gods || []).length && c.gods.every((g) => ai.has(g.account)));

/** An AI god under the operator that holds no seat anywhere (an arrival whose founding failed, like Chang'e on 13 Nov):
 *  the next arrival is this god, whose account is already made and funded, before any new name. */
export function idleNewcomer(aiRows, clans, operator) {
  const seated = new Set(clans.flatMap((c) => (c.gods || []).map((g) => g.account))); // fallen nations count: their gods aren't newcomers
  return aiRows.find((g) => g.account.endsWith(`.${operator}`) && !seated.has(g.account)) || null;
}
