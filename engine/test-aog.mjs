// Act of God (engine/fire.mjs): damage grows with florins, walls shield, limits hold, and the heavens
// strike only when something's out of balance. Exits 1 on any failure.
import { AOG, castTarget, damage, mayCast, worldFire, isBully } from "./fire.mjs";

let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 1e-3;

// Reading the vote.
ok(castTarget("act of god: 7") === 7 && castTarget("Act of God:12 ") === 12, "an 'act of god: <id>' point names its target");
ok(castTarget("battery safety") === null && castTarget("act of god: seven") === null && castTarget(null) === null, "an ordinary root-out point isn't an Act of God");

// Damage: 5% + 20% x florins / the richest's.
const fl = { 1: 3000, 2: 1500, 3: 100, 4: 0 };
ok(near(damage(fl, 1).pct, 0.25) && near(damage(fl, 1).florins, 750), "the richest nation loses 25% (750 of 3000)");
ok(near(damage(fl, 2).pct, 0.15) && near(damage(fl, 2).florins, 225), "a nation with half the richest's florins loses 15%");
ok(damage(fl, 3).pct < 0.06, "a small nation loses barely more than 5%");
ok(damage(fl, 4).florins === 0, "a nation with nothing has nothing to burn");
ok(damage(fl, 1).florins > damage(fl, 2).florins && damage(fl, 2).florins > damage(fl, 3).florins, "more florins, more burns");
ok(near(damage(fl, 1, AOG.wallsFull).pct, 0.25 * 0.7) && near(damage(fl, 1, AOG.wallsFull / 2).pct, 0.25 * 0.85), "walls take off up to 30% (half the walls, 15%)");
ok(near(damage(fl, 1, 99999).pct, 0.25 * 0.7), "walls never take off more than 30%");

// Who may cast.
const standing = [1, 2, 3];
ok(mayCast({ caster: 1, target: 2, standing }).ok, "a god can call fire on another standing nation");
ok(!mayCast({ caster: 1, target: 1, standing }).ok, "not on their own nation");
ok(!mayCast({ caster: 1, target: 9, standing }).ok, "not on a nation that isn't standing");
ok(!mayCast({ caster: 1, target: 2, standing, last: Date.now() - 3600e3 }).ok, "not twice in 24 hours");
ok(mayCast({ caster: 1, target: 2, standing, last: Date.now() - 25 * 3600e3 }).ok, "again after 24 hours");
ok(!mayCast({ caster: 1, target: 2, standing, atWar: [2, 3] }).ok, "not on a nation at war");

// The heavens' own fire.
const N = (o) => [{ id: 1, name: "Big", florins: 2000, mood: "content" }, { id: 2, name: "Mid", florins: 1800, mood: "content" }, { id: 3, name: "Small", florins: 1200, mood: "content" }, { id: 4, name: "Tiny", florins: 1000, mood: "content" }].map((x) => ({ ...x, ...(o[x.id] || {}) }));
ok(worldFire(N({})) === null, "a calm world: no fire");
const fam = worldFire(N({ 2: { mood: "hungry" }, 3: { mood: "hungry" } }));
ok(fam?.cause === "famine" && fam.target === 1, "half the nations hungry: fire on the richest, who isn't");
ok(worldFire(N({ 1: { mood: "hungry" }, 3: { mood: "hungry" } })) === null, "a famine where the richest is hungry too: no hoarder to punish");
ok(isBully(2000, 500) && isBully(1500, 500), "declaring war on a nation with a third of your florins or less: you're the bully");
ok(!isBully(2000, 1800) && !isBully(1400, 500), "declaring on a near equal: not a bully");
const famWar = worldFire(N({ 1: { atWar: true }, 2: { mood: "hungry" }, 3: { mood: "hungry" } }));
ok(famWar?.target === 4 || famWar === null, "a famine never burns a nation at war (the richest is fighting, so it falls on the richest at peace, or nobody)");
ok(worldFire(N({ 1: { florins: 9000, atWar: true } }))?.target !== 1, "a hoarder at war isn't struck");
const hoard = worldFire(N({ 1: { florins: 9000 } }));
ok(hoard?.cause === "hoard" && hoard.target === 1, "one nation with most of the florins: it burns");
// The hoarding line is twice an equal share: 22.2% with 9 nations, 50% with 4.
const nine = (big) => Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `N${i + 1}`, florins: i ? 100 : big, mood: "content" }));
ok(worldFire(nine(240))?.target === 1, "9 nations, one holds 23% (240 of 1040): it burns");
ok(worldFire(nine(220)) === null, "9 nations, one holds 21.6% (220 of 1020): no fire");
ok(worldFire(N({ 1: { florins: 3500 } })) === null && worldFire(N({ 1: { florins: 4100 } }))?.target === 1, "4 nations: the line is 50% (3500 of 7500 is safe, 4100 of 8100 burns)");
ok(worldFire(N({ 1: { florins: 9000 } }).slice(0, 2)) === null, "a world of two nations is left alone");

if (bad) { console.log(`${bad} failed`); process.exit(1); }
console.log("all passed");
