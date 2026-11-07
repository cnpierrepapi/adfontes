// Knowledge mood + Root it out (SPEC §14). Run: node engine/test-stir.mjs
import assert from "node:assert/strict";
import * as W from "./world.mjs";
import * as RV from "./reverence.mjs";

const s = { clans: {}, corpora: {}, ruins: {}, day: 1 };
const c = W.initClan(s, { id: 1, name: "T" });
const add = (k, parent, stir = "calm") => (c.owned[k] = { depth: (c.owned[parent]?.depth ?? 0) + 1, parent, corpus: null, how: "researched", stir });
add("lithium anodes", c.field);
add("dendrite growth", "lithium anodes", "doubt");
add("dendrite suppression", "dendrite growth");
add("solid electrolytes", c.field, "faith");
c.frontier["dendrite imaging"] = { depth: 3, parent: "dendrite growth" };
c.frontier["garnet electrolytes"] = { depth: 2, parent: "solid electrolytes" };

// Root it out cuts the point and its subtree, drops their frontier, and bans the point.
const cut = W.rootOut(c, "dendrite growth");
assert.deepEqual(cut.sort(), ["dendrite growth", "dendrite suppression"]);
assert.ok(!c.owned["dendrite growth"] && !c.owned["dendrite suppression"] && c.owned["lithium anodes"]);
assert.ok(!c.frontier["dendrite imaging"] && c.frontier["garnet electrolytes"], "only the cut branch's edge goes");
W.grow(c, "lithium anodes", ["dendrite growth", "anode coatings"]);
assert.ok(!c.frontier["dendrite growth"] && c.frontier["anode coatings"], "a rooted-out point never comes back");
assert.deepEqual(W.rootOut(c, c.field), [], "the nation's root can't be cut");
assert.deepEqual(W.rootOut(c, "not a point"), []);
console.log("PASS root it out: cuts the subtree and its edge, bans the point, spares the root");

// Drift: faith lifts the followed god, doubt pulls harder; capped at 3 points each.
const rv = { followed: "g", gods: { g: { r: 50, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0 } } };
const drift = (owned) => { const ch = []; const before = rv.gods.g.r; RV.stirDrift(rv, { owned }, ch); return +(rv.gods.g.r - before).toFixed(3); };
assert.equal(drift({ a: { stir: "faith" }, b: { stir: "calm" } }), 0.15);
assert.equal(drift({ a: { stir: "doubt" } }), -0.25);
assert.equal(drift(Object.fromEntries([...Array(9)].map((_, i) => [`d${i}`, { stir: "doubt" }]))), -0.75, "capped at 3 doubt points");
assert.equal(drift({ a: { stir: "calm" } }), 0, "calm knowledge moves nothing");
console.log("PASS drift: +0.15 per faith point, -0.25 per doubt point, 3 of each at most, per turn");

// Credit: rooting out doubt earns reverence; cutting calm knowledge costs a little.
for (const [doubt, want] of [[true, 3], [false, -2]]) {
  const r2 = { followed: "g", gods: { g: { r: 50, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0 } } };
  RV.act(r2, "g", "rootOut", 1, [], { point: "x", doubt });
  assert.equal(r2.gods.g.r - 50, want);
}
console.log("PASS rooting out doubt +3 reverence; cutting calm knowledge -2");
console.log("ALL PASS");
