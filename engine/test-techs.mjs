// The five techs (SPEC §14): when each unlocks, and the Astrolabe's ruins from afar.
// Run: node engine/test-techs.mjs
import assert from "node:assert/strict";
import * as W from "./world.mjs";

const fresh = () => {
  const s = { clans: {}, corpora: {}, ruins: {}, day: 1 };
  return { s, c: W.initClan(s, { id: 1, name: "T" }) };
};
const ready = (c) => W.TECHS.filter((t) => t.ready(c)).map((t) => t.id);

// A new nation is ready for nothing.
let { s, c } = fresh();
assert.deepEqual(ready(c), []);

// A line 3 deep (root + 3) = 4 points: Spectacles only.
let prev = c.field;
for (let i = 1; i <= 3; i++) { const k = `p${i}`; c.owned[k] = { depth: i, parent: prev, corpus: null, how: "researched" }; prev = k; }
assert.deepEqual(ready(c), ["spectacles"]);
// 6 points: + Printing Press.
c.owned.q1 = { depth: 1, parent: c.field }; c.owned.q2 = { depth: 1, parent: c.field };
assert.deepEqual(ready(c), ["press", "spectacles"]);
// A passed draft: + Bookkeeping. 12 points: + Clock.
c.passedDrafts = 1;
for (let i = 3; i <= 8; i++) c.owned[`q${i}`] = { depth: 1, parent: c.field };
assert.deepEqual(ready(c), ["press", "spectacles", "clock", "bookkeeping"]);
// The line reaches full depth (6): + Astrolabe.
for (let i = 4; i <= 6; i++) { const k = `p${i}`; c.owned[k] = { depth: i, parent: prev, corpus: null, how: "researched" }; prev = k; }
assert.deepEqual(ready(c), ["press", "spectacles", "clock", "bookkeeping", "astrolabe"]);
console.log("PASS techs unlock in order: spectacles (line 3 deep), press (6 points), clock (12), bookkeeping (a passed draft), astrolabe (line 6 deep)");

// Ruins: a nation that gains "lithium metal anodes" doesn't find the ruin "lithium sulfur batteries"
// (no exact match), but with the Astrolabe it does (they share "lithium").
for (const astro of [false, true]) {
  ({ s, c } = fresh());
  s.ruins["lithium sulfur batteries"] = { depth: 1, parent: "batteries", corpus: "c9", from: 9 };
  s.corpora.c1 = { children: [] };
  c.owned["lithium metal anodes"] = { depth: 1, parent: c.field, corpus: "c1", how: "researched" };
  if (astro) c.techs = ["astrolabe"];
  const taken = W.absorbRuins(s, c, ["lithium metal anodes"]);
  assert.equal(taken.length, astro ? 1 : 0, `astrolabe=${astro}`);
}
console.log("PASS the Astrolabe finds related ruins from afar; without it, only exact matches");
console.log("ALL PASS");
