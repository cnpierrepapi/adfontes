// The five techs (SPEC §14): when each unlocks (a season-long climb), the pace (one a real day,
// none on day one), and the Astrolabe's ruins from afar. Run: node engine/test-techs.mjs
import assert from "node:assert/strict";
import * as W from "./world.mjs";

const fresh = () => {
  const s = { clans: {}, corpora: {}, ruins: {}, day: 1 };
  return { s, c: W.initClan(s, { id: 1, name: "T" }) };
};
const ready = (c) => W.TECHS.filter((t) => t.ready(c)).map((t) => t.id).sort();
const line = (c, n) => { let prev = c.field; for (let i = 1; i <= n; i++) { const k = `p${i}`; c.owned[k] = { depth: i, parent: prev }; prev = k; } };
const wide = (c, n) => { for (let i = 0; i < n; i++) c.owned[`w${i}`] = { depth: 1, parent: c.field }; };

let { s, c } = fresh();
// The old thresholds fell with a 7-point line; now that's nothing.
line(c, 6);
assert.deepEqual(ready(c), [], "a 7-point line 6 deep unlocks nothing now");
wide(c, 8); // 15 points, line 6 deep
assert.deepEqual(ready(c), ["spectacles"]);
wide(c, 18); // 33 points
assert.deepEqual(ready(c), ["press", "spectacles"]);
c.passedDrafts = 3;
assert.deepEqual(ready(c), ["bookkeeping", "press", "spectacles"]);
wide(c, 25); // 58 points... wide() reuses keys: add distinct ones
for (let i = 100; i < 130; i++) c.owned[`x${i}`] = { depth: 1, parent: c.field };
assert.ok(Object.keys(c.owned).length >= 60);
assert.deepEqual(ready(c), ["astrolabe", "bookkeeping", "clock", "press", "spectacles"]);
console.log("PASS thresholds: spectacles 15 pts + line 4, press 25, bookkeeping 3 drafts, clock 40, astrolabe 60 + line 6");

// Pace: none in the first real day, then one a real day.
const H = 3600e3, t0 = 1_800_000_000_000;
c.bornAt = t0; c.lastTechAt = undefined;
assert.equal(W.techAllowed(c, t0 + 23 * H), false, "none on day one");
assert.equal(W.techAllowed(c, t0 + 25 * H), true);
c.lastTechAt = t0 + 25 * H;
assert.equal(W.techAllowed(c, t0 + 40 * H), false, "one a real day");
assert.equal(W.techAllowed(c, t0 + 49 * H), true);
console.log("PASS pace: none in a nation's first real day, then at most one a real day");

// Ruins: the Astrolabe finds related ruins from afar; without it, only exact matches.
for (const astro of [false, true]) {
  ({ s, c } = fresh());
  s.ruins["lithium sulfur batteries"] = { depth: 1, parent: "batteries", corpus: "c9", from: 9 };
  s.corpora.c1 = { children: [] };
  c.owned["lithium metal anodes"] = { depth: 1, parent: c.field, corpus: "c1", how: "researched" };
  if (astro) c.techs = ["astrolabe"];
  assert.equal(W.absorbRuins(s, c, ["lithium metal anodes"]).length, astro ? 1 : 0, `astrolabe=${astro}`);
}
console.log("PASS the Astrolabe finds related ruins from afar; without it, only exact matches");
console.log("ALL PASS");
