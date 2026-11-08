// War rules (his call 8 Nov) and pacing: two equal nations should fight for about 9-15 real days.
import { WAR, eligible, warOf, allowed, round, hp, burnEdge, takeKnowledge, dice } from "./war.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };

// A nation with n knowledge points in a tree (depth up to ~7), like Helios or Salamanco.
function nation(field, n, techs) {
  const owned = { [field]: { depth: 0, parent: null, corpus: "c0" } };
  for (let i = 1; i < n; i++) { const keys = Object.keys(owned); const parent = keys[Math.floor(i / 2.2)] ?? field; owned[`${field} ${i}`] = { depth: owned[parent].depth + 1, parent, corpus: `c${i}` }; }
  return { field, owned, frontier: {}, techs: Array(techs).fill("t"), alive: true };
}
function world(a, b) {
  return { clans: { 1: a, 2: b }, drafts: { d1: { clan: 1, passed: true }, d2: { clan: 2, passed: true } }, tools: {}, wars: {}, peace: {} };
}

// Rules
let s = world(nation("batteries", 33, 5), nation("solar cells", 32, 4));
s.clans[3] = nation("carbon", 5, 0);
ok(eligible(s, 1) && !eligible(s, 3), "fair game only after a passed patent");
ok(!allowed(s, 1, { action: "declare", target: 3 }, { 1: 100 }).ok, "a nation without a patent can't be attacked");
ok(!allowed(s, 3, { action: "declare", target: 1 }, { 3: 100 }).ok, "...and can't attack either");
ok(allowed(s, 1, { action: "declare", target: 2 }, { 1: 100 }).ok, "two nations with patents can go to war");
ok(!allowed(s, 1, { action: "declare", target: 2 }, { 1: 0.5 }).ok, "no money, no war chest");
s.wars.w1 = { id: "w1", a: 1, b: 2, status: "on" };
ok(warOf(s, 2)?.id === "w1" && !allowed(s, 1, { action: "declare", target: 2 }, { 1: 100 }).ok, "one war at a time");
ok(!allowed(s, 1, { action: "accept_peace" }).ok, "can't accept a peace nobody offered");
s.wars.w1.offer = { by: 2 };
ok(allowed(s, 1, { action: "accept_peace" }).ok && !allowed(s, 2, { action: "accept_peace" }).ok, "only the other side can accept an offer");
ok(dice("root", "w1", 1, "a") === dice("root", "w1", 1, "a") && dice("root", "w1", 1, "a") !== dice("root2", "w1", 1, "a"), "dice are fixed by the sealed root: anyone can redo a roll");

// The edge burns first, never the root
const t = nation("x", 6, 0); const before = Object.keys(t.owned).length;
const burned = burnEdge(t, 3);
ok(burned.length === 3 && Object.keys(t.owned).length === before - 3 && t.owned.x, "burning takes outer points and never the root");
ok(burned.every((k) => !Object.values(t.owned).some((v) => v.parent === k)), "no burned point leaves an orphan behind");
const win = nation("w", 3, 0), lose = nation("l", 6, 0);
const taken = takeKnowledge(win, lose, 2);
ok(taken.length === 5 && taken.every((k) => win.owned[win.owned[k].parent]), "the winner takes the knowledge, every point attached");

// Pacing: Monte Carlo over the dice.
function fight(a, b, fortify) {
  const s = world(a, b), w = { id: `w${Math.random()}`, a: 1, b: 2, status: "on" };
  const fl = { 1: 165, 2: 177 };
  for (let r = 1; r < 12 * 60; r++) {
    if (fortify && r % 12 === 1) for (const id of [1, 2]) { const x = fl[id] * WAR.fortifyFrac; fl[id] -= x; s.clans[id].walls = (s.clans[id].walls || 0) + x; }
    const o = round(s, w, `root${r}`, fl);
    for (const id of [1, 2]) fl[id] -= o.sides[id].spend;
    if (hp(s.clans[1]) <= 0 || hp(s.clans[2]) <= 0) return r / 12;
  }
  return 60;
}
const days = (f) => { const d = Array.from({ length: 400 }, f).sort((x, y) => x - y); return { median: d[200], p10: d[40], p90: d[360] }; };
const eq = days(() => fight(nation("batteries", 33, 5), nation("solar cells", 32, 4), false));
console.log(`  Helios vs Salamanco, no walls: median ${eq.median.toFixed(1)} days (10%: ${eq.p10.toFixed(1)}, 90%: ${eq.p90.toFixed(1)})`);
ok(eq.median >= 9 && eq.median <= 15, "two equal nations fight for 9-15 real days");
const wl = days(() => fight(nation("batteries", 33, 5), nation("solar cells", 32, 4), true));
console.log(`  ...both fortifying daily: median ${wl.median.toFixed(1)} days`);
ok(wl.median <= 25, "walls slow a war down but don't make it endless");
const lop = days(() => fight(nation("batteries", 33, 5), nation("batteries", 4, 0), false));
console.log(`  Helios vs Striklar-sized: median ${lop.median.toFixed(1)} days`);
ok(lop.median <= 2.5, "a lopsided war is over in a day or two");
