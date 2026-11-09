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
