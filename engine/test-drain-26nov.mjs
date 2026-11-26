// Reverence drain (his call 26 Nov): no god ever reaches 100, and the higher the reverence the faster it drains.
// - No fade at all under 50, and a fade never takes a god below 50.
// - From 50 the fade grows with reverence: x1 at 50, x1.5 at 100 (enemies, lost faith, hunger and justice
//   still scale it as before).
// - A gain above 90 closes part of the gap to 100: (100 - r) * (1 - e^(-d/10)), so 100 is never reached;
//   the part of a gain below 90 counts in full. Nothing goes over 99.9 (the page rounds 99.95 to 100.0).
// Picked from a replay of turns 133-217 (debug/rev-replay.mjs, debug/rev-grid.mjs).
import { fade, act, REV } from "./reverence.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const nation = (r, extra = {}) => ({ gods: { g: { r, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0, text: "", ...extra } }, followed: "g", putIn: {} });
const fadeOnce = (r, extra = {}, mul = 1) => { const rv = nation(r, extra); fade(rv, 10, new Set(extra.enemies || []), [], mul); return rv.gods.g.r; };
const heard = (r, d) => { const rv = nation(r); act(rv, "g", "whisper", 10, [], { text: "x", heard: { delta: d, verdict: "prophecy" } }); return rv.gods.g.r; };

// The fade.
ok(fadeOnce(40) === 40, "no fade under 50 (40 stays 40)");
ok(fadeOnce(50) === 50, "no fade at exactly 50");
ok(fadeOnce(45, { enemies: ["Ada"] }) === 45, "enemies don't drain a god under 50 either");
ok(near(fadeOnce(99.9), 99.9 - 1 * (1 + 0.5 * 49.9 / 50)), "near the top the fade is ~1.5x (99.9 -> 98.40)");
ok(near(fadeOnce(75), 75 - 1.25), "at 75 the fade is 1.25x (75 -> 73.75)");
ok(fadeOnce(50.4) === 50, "a fade never takes a god below 50 (50.4 -> 50)");
ok(near(fadeOnce(90, { enemies: ["Ada"] }), 90 - 1.4 * (REV.fade + REV.enemyFade)), "an enemy still speeds the fade, scaled the same way (x1.4 at 90)");
ok(near(fadeOnce(90, {}, 2), 90 - 2.8), "hunger (mul 2) still doubles it");

// Gains.
ok(near(heard(70, 10), 80), "a gain under 90 counts in full (70 + 10 = 80)");
ok(near(heard(95, 10), 95 + 5 * (1 - Math.exp(-1))), "at 95 a +10 closes 63% of the gap (95 -> 98.16)");
ok(near(heard(85, 20), 90 + 10 * (1 - Math.exp(-1.5))), "a gain crossing 90 counts in full up to 90, then shrinks (85 + 20 -> 97.77)");
ok(heard(99.8, 25) <= 99.9, "nothing goes over 99.9");
{
  const rv = nation(60);
  for (let i = 0; i < 400; i++) { rv.gods.g.whispers = []; act(rv, "g", "whisper", 10 + i * 20, [], { text: "x", heard: { delta: 25, verdict: "prophecy" } }); }
  ok(rv.gods.g.r < 100, `400 perfect whispers in a row stay under 100 (${rv.gods.g.r.toFixed(2)})`);
}
{ const rv = nation(60); for (let i = 0; i < 50; i++) act(rv, "g", "reward", 10, []); ok(rv.gods.g.r < 100, "50 rewards in a row stay under 100 (every kind of gain is held, not only whispers)"); }
ok(heard(100, 10) === 100, "a god at 100 from before gains nothing more (the fade then brings it down)");
// Losses at any level are untouched.
{ const rv = nation(95); act(rv, "g", "stunt", 10, [], { agent: "Ada" }); ok(near(rv.gods.g.r, 95 + REV.stunt), "a stun still costs the full 8 at 95"); }
{ const rv = nation(45); act(rv, "g", "stunt", 10, [], { agent: "Ada" }); ok(near(rv.gods.g.r, 45 + REV.stunt), "under 50, a stun still costs (only the fade stops)"); }

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
