// The cooldown (his call 16 Nov): a nation that came out of a war, or that an Act of God fell on, can't be attacked
// again, by war or by a god's fire, for 21 turns. The clock starts the turn the war ended (peace or a fall) or the
// fire landed, and counts scheduled turns only (the engine's turn number; instant turns don't move it). Every Act of
// God counts: one a god called, the heavens' own, and the fire that lands on a bully as it declares war. The heavens
// still strike a hoarder whatever the clock says: that isn't one nation doing it to another.
// Pure functions; engine/war.mjs (declarations) and engine/run.mjs (fire) ask here. Tested in engine/test-16nov.mjs.

export const COOLDOWN = { turns: 21 };

/** The last thing that hit nation `id`: { day, why } (the war that ended latest, or the fire that landed latest), or null. */
export function lastHit(s, id) {
  let best = null;
  for (const w of Object.values(s.wars || {})) {
    if (w.status === "on" || w.endedDay == null || (w.a !== id && w.b !== id)) continue;
    if (!best || w.endedDay > best.day) best = { day: w.endedDay, why: "came out of a war" };
  }
  const f = s.fire?.landed?.[id];
  if (f != null && (!best || f > best.day)) best = { day: f, why: "took an Act of God" };
  return best;
}

/** Is nation `id` protected on turn `day`? { until, left, why } (it can be attacked again from turn `until`), or null. */
export function shield(s, id, day) {
  const h = lastHit(s, id);
  if (!h) return null;
  const until = h.day + COOLDOWN.turns;
  return day < until ? { until, left: until - day, why: `${h.why} on turn ${h.day}` } : null;
}

/** Fire that landed, read back from sealed turns (the first run after this rule went live): { [clan]: last turn }.
 *  days: [{ day, records }]. */
export function firesFrom(days) {
  const out = {};
  for (const d of days) for (const r of d.records || []) if (r.kind === "fire" && r.clan != null) out[r.clan] = Math.max(out[r.clan] ?? -Infinity, d.day);
  return out;
}

/** Plain words for a refusal. */
export const refusal = (name, sh) => `${name} ${sh.why} and is protected for ${sh.left} more turn${sh.left === 1 ? "" : "s"} (until turn ${sh.until})`;
