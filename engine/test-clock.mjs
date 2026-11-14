// Tests for the world clock (SPEC §14). `node engine/test-clock.mjs` (fetches real NEAR hours).
import assert from "node:assert/strict";
import { CLOCK, nearTimeAt, realTimeAt, phases, units, clockAt, fetchHours } from "./clock.mjs";

const H = 3600;
// 1. The replay meets live NEAR at season end and runs 5x before it.
assert.equal(nearTimeAt(CLOCK.seasonEnd), CLOCK.seasonEnd);
assert.equal(nearTimeAt(CLOCK.seasonEnd - 3600e3), CLOCK.seasonEnd - 5 * 3600e3);
assert.equal(realTimeAt(nearTimeAt(1.79e12)), 1.79e12);
// Cold audit 14 Nov: after 30 Nov the replay has met live NEAR; to the season's end (12 Dec) it runs live, hour for
// hour (before this it mapped onto hours that hadn't happened yet, and day and night froze).
assert.equal(nearTimeAt(CLOCK.seasonEnd + 3600e3), CLOCK.seasonEnd + 3600e3);
assert.equal(realTimeAt(CLOCK.seasonEnd + 7200e3), CLOCK.seasonEnd + 7200e3);
console.log("PASS after 30 Nov the clock is NEAR's live hour");
// One NEAR hour = 12 real minutes.
assert.equal(realTimeAt(CLOCK.seasonEnd - 3600e3), CLOCK.seasonEnd - 12 * 60e3);

// 2. Zigzag: starts on a rise; a 2.9% dip stays day, a 3% dip flips to night; 3% up flips back.
const mk = (ps) => ps.map((p, i) => [i * H, p]);
let ph = phases(mk([100, 102, 99.1, 104, 100.88, 99, 102, 101.97]));
assert.deepEqual(ph.map((p) => p.day), [true, false, true]);
assert.equal(ph[0].hours, 4); // day: hours 0..4 (flip at 100.88 = 104 x 0.97)
assert.equal(ph[1].hours, 2); // night: low 99, flips at 101.97 (99 x 1.03)
// A season that opens on a fall still starts as day, and flips once the fall reaches 3%.
assert.deepEqual(phases(mk([100, 98, 96.9])).map((p) => p.day), [true, false]);

// 3. Units: 1 h counts as 1, 24 h as 1, 25 h as 2, 48 h as 2.
assert.deepEqual([1, 24, 25, 48, 49].map(units), [1, 1, 2, 2, 3]);

// 4. clockAt on real NEAR hours: the open phase, a long run counting 2 nights, monotonic counts.
const now = Date.now();
const seasonStartNear = nearTimeAt(Date.parse("2026-11-07T00:00:00Z"));
const rows = await fetchHours(seasonStartNear - 3600e3, nearTimeAt(now));
assert.ok(rows.length > 50, `got ${rows.length} hours`);
const season = rows.filter((r) => r[0] * 1000 >= seasonStartNear);
const seen = [];
for (let t = Date.parse("2026-11-07T00:00:00Z"); t <= now; t += 15 * 60e3) {
  const c = clockAt(season, t);
  if (!c) continue;
  if (seen.length) {
    const prev = seen.at(-1);
    assert.ok(c.days >= prev.days && c.nights >= prev.nights, "counts never go back");
    assert.ok(c.arc >= 0 && c.arc < 1);
  }
  seen.push(c);
}
assert.equal(seen[0].phase, "day", "the season opens on a day");
const all = phases(season);
console.log(`real NEAR replay: ${season.length} NEAR hours (${new Date(season[0][0] * 1000).toISOString().slice(0, 16)} -> now), ${all.length} phases`);
console.log("phases (NEAR hours, real minutes):", all.slice(0, 12).map((p) => `${p.day ? "day" : "night"} ${p.hours}h/${p.hours * 12}m`).join(", "));
console.log("clock now:", JSON.stringify(clockAt(season, now)));
console.log("clock tests: all passed");
