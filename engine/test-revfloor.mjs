// His call 12 Nov (~22:35 UTC): reverence is too low for a lot of the gods. One time only: every god holding a
// seat in a living nation gets at least 35, some more (35-45, seeded), and anyone already above keeps theirs.
// Outside gods (no seat) and fallen nations are left alone. Written before engine/revfix.mjs floorReverence.
import { floorReverence } from "./revfix.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const s = {
  clans: { 1: {}, 2: {}, 3: { fallen: { day: 40 } } },
  rev: {
    1: { gods: { lugh: { r: 0 }, kokopelli: { r: 9, outsider: true } }, followed: "kokopelli" },
    2: { gods: { anansi: { r: 12.5 }, high: { r: 58 } }, followed: "high" },
    3: { gods: { old: { r: 2 } }, followed: "old" },
  },
};
const onchain = [{ id: 1, alive: true, gods: [{ account: "lugh" }] }, { id: 2, alive: true, gods: [{ account: "anansi" }, { account: "high" }] }, { id: 3, alive: true, gods: [{ account: "old" }] }];
const out = floorReverence(s, onchain, "seed-1");
ok(s.rev[1].gods.lugh.r >= 35 && s.rev[1].gods.lugh.r <= 45 && s.rev[2].gods.anansi.r >= 35 && s.rev[2].gods.anansi.r <= 45, `seated gods under 35 rise to 35-45 (${s.rev[1].gods.lugh.r}, ${s.rev[2].gods.anansi.r})`);
ok(s.rev[2].gods.high.r === 58, "a god already above 35 keeps exactly what it had");
ok(s.rev[1].gods.kokopelli.r === 9, "an outside god without a seat is left alone");
ok(s.rev[3].gods.old.r === 2 && !out[3], "a fallen nation is left alone");
ok(out[1].length === 1 && out[1][0].god === "lugh" && out[1][0].d === +(s.rev[1].gods.lugh.r).toFixed(2) && /reverence floor/.test(out[1][0].why), "each rise is listed with its size and reason (sealed as a record)");
ok(s.rev[1].followed === "lugh", "the nation now follows its own seated god (the most revered), not the outside god");
const s2 = JSON.parse(JSON.stringify(s)); s2.rev[1].gods.lugh.r = 0; s2.rev[2].gods.anansi.r = 12.5;
floorReverence(s2, onchain, "seed-1");
ok(s2.rev[1].gods.lugh.r === s.rev[1].gods.lugh.r, "same seed, same numbers (replayable)");
const many = { clans: {}, rev: {} }, oc = [];
for (let i = 1; i <= 40; i++) { many.clans[i] = {}; many.rev[i] = { gods: { [`g${i}`]: { r: 0 } }, followed: null }; oc.push({ id: i, alive: true, gods: [{ account: `g${i}` }] }); }
floorReverence(many, oc, "spread");
const rs = Object.values(many.rev).map((v) => Object.values(v.gods)[0].r);
ok(rs.some((r) => r >= 40) && rs.some((r) => r < 38), `some sit higher than others (from ${Math.min(...rs)} to ${Math.max(...rs)})`);
