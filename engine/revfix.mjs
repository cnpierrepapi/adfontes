// One-time correction (his go, 9 Nov): until commit ccdd44d an instant turn re-scored every record
// since the last full day, so a passed gift's +3 ("the nation's gift passed the Warden") was paid
// again on every instant turn, and the whisper bonus (flourish: points for how the nation did since a
// god last whispered) was counted the same way. This walks every record in order, counts each gift
// and corpus once, and works out what each god was overpaid. Pure: records in, corrections out.
import { REV } from "./reverence.mjs";

// Gods moved to a new account by move_god (9 Nov): an old account's overpayment lands on the new one.
export const MOVED = {
  "6:007a360d75dcdd1ed6a635adb12f0a44fdfcd130f10f51bdb5523e1d3a1fa3bf": "russet-tallow-962.adf-pool1-hf0w8.testnet",
  "1:8d287ed16deb9deeb65bca026d2719c0df0da16a197cc8ef2c4b13e21afb614a": "russet-tallow-962.adf-pool1-hf0w8.testnet",
  "4:8d287ed16deb9deeb65bca026d2719c0df0da16a197cc8ef2c4b13e21afb614a": "russet-tallow-962.adf-pool1-hf0w8.testnet",
};
const BONUS = /\(\+([\d.]+) for how the nation did\)/;

/** records: every record of the season in order (sealed days, then pending). Returns
 *  { over: {clan: {god: reverence overpaid}}, flourish: {clan: {god: true unpaid points}}, detail }. */
export function overpaid(records) {
  const over = {}, fl = {}, turnPts = {}, giftsPassed = {}, giftPaid = {}, detail = [];
  const add = (clan, god, d, why) => {
    if (!(d > 1e-9)) return;
    const g = MOVED[`${clan}:${god}`] ?? god;
    ((over[clan] ||= {})[g] = (over[clan][g] || 0) + d);
    detail.push({ clan, god: g, d: +d.toFixed(2), why });
  };
  for (const r of records) {
    const c = r.clan;
    if (r.kind === "corpus" && !r.fake) turnPts[c] = (turnPts[c] || 0) + 1;
    else if (r.kind === "gift" && r.passed) { turnPts[c] = (turnPts[c] || 0) + 3; giftsPassed[c] = (giftsPassed[c] || 0) + 1; }
    else if (r.kind === "warden") turnPts[c] = (turnPts[c] || 0) - 1;
    if (r.kind !== "reverence") continue;
    const gods = (fl[c] ||= {});
    for (const g of Object.keys(r.gods || {})) gods[g] ??= 0;
    for (const ch of r.changes || []) {
      // A gift bonus beyond one per passed gift so far was a repeat.
      if (/gift passed the Warden/.test(ch.why || "")) {
        giftPaid[c] = (giftPaid[c] || 0) + 1;
        if (giftPaid[c] > (giftsPassed[c] || 0)) add(c, ch.god, ch.d, "a passed gift's +3 paid again");
      }
      // A whisper's bonus: paid vs what the nation really did since that god last whispered.
      const m = BONUS.exec(ch.why || "");
      if (m && /^whisper/.test(ch.why)) {
        const paid = Number(m[1]), due = Math.min(REV.flourishMax, (gods[ch.god] || 0) * REV.flourishPerPoint);
        add(c, ch.god, paid - due, `whisper bonus +${paid}, due +${+due.toFixed(2)}`);
        gods[ch.god] = 0;
      } else if (/^whisper/.test(ch.why || "")) gods[ch.god] = 0;
    }
    // This turn's points reach every god's tally after the turn's whispers were paid (as run.mjs does).
    for (const g of Object.keys(gods)) gods[g] = Math.max(0, gods[g] + (turnPts[c] || 0));
    turnPts[c] = 0;
  }
  const flourish = {};
  for (const [c, gods] of Object.entries(fl)) for (const [g, v] of Object.entries(gods)) { const to = MOVED[`${c}:${g}`] ?? g; (flourish[c] ||= {})[to] = Math.max(flourish[c][to] || 0, v); }
  return { over, flourish, detail };
}

// His call 12 Nov (~22:35 UTC): reverence was too low for most gods after the AI takeover. One time only:
// every god holding a seat in a living, unfallen nation gets at least 35, spread 35-45 by a seeded roll so
// some sit higher; anyone already at 35 or more keeps theirs; outside gods and fallen nations are untouched.
// Each nation then follows its most revered god again. Returns { [clan]: changes } for the sealed record.
export const FLOOR = { min: 35, spread: 10 };
export function floorReverence(s, onchain, seed) {
  let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const roll = () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = {};
  for (const c of [...onchain].sort((a, b) => a.id - b.id)) {
    const rv = s.rev?.[c.id];
    if (!c.alive || !rv || s.clans?.[c.id]?.fallen) continue;
    const changes = [];
    for (const g of c.gods || []) {
      const me = rv.gods[g.account];
      if (!me || me.outsider || me.r >= FLOOR.min) continue;
      const to = +(FLOOR.min + roll() * FLOOR.spread).toFixed(1);
      changes.push({ god: g.account, d: +(to - me.r).toFixed(2), why: `reverence floor (12 Nov): raised from ${+me.r.toFixed(1)} to ${to}` });
      me.r = to;
    }
    if (!changes.length) continue;
    // Follow the most revered god again (an outside claimer below the seated gods steps back).
    const top = Object.entries(rv.gods).sort((a, b) => b[1].r - a[1].r)[0];
    if (top) { rv.followed = top[0]; if (rv.claimedBy && rv.gods[rv.claimedBy]?.outsider && rv.claimedBy !== top[0]) rv.claimedBy = null; }
    out[c.id] = changes;
  }
  return out;
}
