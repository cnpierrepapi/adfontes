// His calls 8 Nov after the fast-forward: Tricksters capped, fallen nations out of the standings
// and the jackpot, a broke nation at war surrenders.
import { tricksterMayCome, TRICKSTERS } from "./world.mjs";
import { standings, jackpotWinner } from "./reverence.mjs";
import { WAR, round, surrenders } from "./war.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const H = 3600e3, now = 1e13;

// Tricksters
const T = (n, alive = true) => Array.from({ length: n }, (_, i) => ({ name: `t${i}`, role: "Trickster", alive }));
const folk = [{ name: "a", role: "Scholar", alive: true }];
ok(tricksterMayCome({}, folk, now), "the first Trickster can come to a silent nation");
ok(!tricksterMayCome({ lastTricksterAt: now - 2 * H }, [...folk, ...T(1)], now), "the second waits a real day after the first");
ok(tricksterMayCome({ lastTricksterAt: now - 25 * H }, [...folk, ...T(1)], now), "...then it may come");
ok(!tricksterMayCome({ lastTricksterAt: 0 }, [...folk, ...T(2)], now), `never more than ${TRICKSTERS.cap} living`);
ok(tricksterMayCome({ lastTricksterAt: now - 2 * H }, [...folk, ...T(2, false)], now), "dead Tricksters don't count");

// Standings and jackpot
const rev = (r) => ({ followed: "g", gods: { g: { r } } });
const s = { clans: { 1: {}, 2: { fallen: { day: 46, by: 3 } }, 3: {}, 4: {} }, rev: { 1: rev(12), 2: rev(90), 3: rev(40), 4: rev(40) } };
const clans = [1, 2, 3, 4].map((id) => ({ id, name: `n${id}`, alive: true }));
const st = standings(s, clans);
ok(!st.some((r) => r.id === 2), "a fallen nation is out of the standings");
ok(jackpotWinner(s, clans).id === 3, "the jackpot goes to the top nation still standing (fallen #1 skipped, tie to the older)");
ok(jackpotWinner({ clans: { 2: s.clans[2] }, rev: s.rev }, [clans[1]]) === null, "no nation standing, no winner");

// Broke at war
const nation = (n) => { const owned = { r: { depth: 0, parent: null } }; for (let i = 1; i < n; i++) owned[`p${i}`] = { depth: 1, parent: "r" }; return { field: "r", owned, frontier: {}, techs: [], walls: 50 }; };
const w = { id: "w1", a: 1, b: 2, status: "on" };
const sw = { clans: { 1: nation(40), 2: nation(40) }, tools: {} };
const o1 = round(sw, w, "seed", { 1: 100, 2: 0.2 });
ok(o1.sides[2].broke === 1 && !o1.sides[1].broke, "a side under 1 florin is broke");
const rich = { clans: { 1: nation(40), 2: nation(40) }, tools: {} };
const o0 = round(rich, { id: "w1", a: 1, b: 2, status: "on" }, "seed", { 1: 100, 2: 100 });
ok(o1.sides[1].strike > o0.sides[1].strike * 1.4, `a broke side's walls don't help and it takes ${WAR.brokeHurt}x`);
ok(surrenders(w) === null, "one broke round: no surrender yet");
round(sw, w, "seed", { 1: 100, 2: 0.2 });
round(sw, w, "seed", { 1: 100, 2: 0.2 });
ok(surrenders(w) === 2, `broke ${WAR.surrenderAfter} rounds in a row: it surrenders`);
const w2 = { id: "w2", a: 1, b: 2, status: "on" };
round(sw, w2, "s", { 1: 100, 2: 0.2 }); round(sw, w2, "s", { 1: 100, 2: 0.2 }); round(sw, w2, "s", { 1: 100, 2: 5 });
round(sw, w2, "s", { 1: 100, 2: 0.2 });
ok(surrenders(w2) === null, "a round with money resets the count");
const w3 = { id: "w3", a: 1, b: 2, status: "on" };
for (let i = 0; i < 3; i++) round(sw, w3, "s", { 1: 0.1, 2: 0.1 });
ok(surrenders(w3) === null, "both broke: neither surrenders, the dice decide");
