// Walking round buildings (SPEC §14b). Run: node tests/steer.test.mjs
import assert from "node:assert/strict";
import { steer, route, insideAny } from "../src/live/steer.js";

const walk = (from, to, blocks, rad, steps = 4000, step = 0.02) => {
  let p = from, n = 0, worst = 0;
  const legs = route(from, to, blocks, rad, 6);
  for (; n < steps && Math.hypot(to[0] - p[0], to[1] - p[1]) > 0.02; n++) {
    if (legs.length > 1 && Math.hypot(legs[0][0] - p[0], legs[0][1] - p[1]) < 0.05) legs.shift();
    p = steer(p, legs[0], step, blocks, rad, 9);
    for (const b of blocks) worst = Math.max(worst, b[2] + rad - Math.hypot(p[0] - b[0], p[1] - b[1]));
  }
  return { p, n, worst };
};
// 1. A building right in the way: go round, never inside, arrive.
let r = walk([-5, 0], [5, 0], [[0, 0, 1]], 0.2);
assert.ok(r.worst <= 1e-6, `went inside by ${r.worst}`);
assert.ok(r.n < 4000, "arrived");
// 2. A crowded plaza: a ring of buildings and trees; 200 random walks, none ever inside.
const blocks = [[0, 0, 1.2], [2.5, 1, 0.6], [-2, 2, 0.8], [1, -2.6, 0.7], [-2.6, -1.5, 0.5], [3, -2, 0.5], [-0.5, 3.2, 0.6]];
let worst = 0, stuck = 0;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 200; i++) {
  const pick = () => { for (;;) { const a = rnd() * 6.28, d = 1.5 + rnd() * 3.5, q = [Math.cos(a) * d, Math.sin(a) * d]; if (!insideAny(q[0], q[1], blocks, 0.25)) return q; } };
  const w = walk(pick(), pick(), blocks, 0.25, 3000);
  worst = Math.max(worst, w.worst);
  if (w.n >= 3000) stuck++;
}
assert.ok(worst <= 1e-6, `someone went inside a building by ${worst}`);
console.log(`PASS 200 walks across a crowded plaza: never inside a footprint; ${stuck} of 200 didn't arrive in 3000 steps`);
assert.equal(stuck, 0, "everyone arrives");
// 3. A target next to a scene (a station): the scene holding the target doesn't block it.
r = walk([-4, 0], [0.9, 0], [[0, 0, 1]], 0.2);
assert.ok(Math.hypot(r.p[0] - 0.9, r.p[1]) <= 0.02, "reached a station beside its own scene");
console.log("PASS a station right next to its scene is reachable");
console.log("ALL PASS");
