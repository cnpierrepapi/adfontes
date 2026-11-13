// Phase E (PLAN_REBUILD_12NOV, his answers 12 Nov): new AI gods arrive at random times. Mean gap 2 h for the first
// 48 h, then 4 h widening 15 min a real day up to 6 h, never two within 30 min, replayable from a seed. Each newcomer
// founds a nation (Claude names it) or blesses one; at 100 living nations, or when the operator can't pay a founding
// and keep its floor, it blesses. It only blesses nations with no human god (its blessing would seat it on their
// council). Written before engine/arrivals.mjs.
//    node engine/test-arrivals.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
Object.assign(process.env, { ADF_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "adf-arr-")), DATABASE_URL: "", ADF_FAKE_LLM: "1" });
const AR = await import("./arrivals.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const H = 3600e3, T0 = 1_800_000_000_000;

// 1. The schedule.
{
  ok(AR.meanGapHours(0) === 2 && AR.meanGapHours(47 * H) === 2, "mean gap 2 h in the first 48 h");
  ok(AR.meanGapHours(49 * H) === 4, "then 4 h");
  ok(AR.meanGapHours(48 * H + 24 * H + 1) === 4.25 && AR.meanGapHours(48 * H + 48 * H + 1) === 4.5, "widening 15 min a real day");
  ok(AR.meanGapHours(48 * H + 30 * 24 * H) === 6, "never past 6 h");
  let a = AR.init(T0, "w6|seed"), times = [];
  for (let i = 0; i < 400; i++) { const t = AR.nextAt(a); times.push(t); a = AR.advance(a, t); }
  const gaps = times.map((t, i) => t - (i ? times[i - 1] : T0));
  ok(gaps.every((g) => g >= AR.ARRIVE.minGapMs), "never two within 30 min");
  const first48 = times.filter((t) => t - T0 < 48 * H).length;
  ok(first48 >= 14 && first48 <= 34, `about 24 arrivals in the first 48 h (got ${first48})`);
  const later = gaps.slice(first48 + 5, first48 + 55), mean = later.reduce((x, y) => x + y, 0) / later.length / H;
  ok(mean > 2.8 && mean < 6.5, `slower after (mean gap ${mean.toFixed(2)} h)`);
  let b = AR.init(T0, "w6|seed"); const again = []; for (let i = 0; i < 20; i++) { const t = AR.nextAt(b); again.push(t); b = AR.advance(b, t); }
  ok(again.join() === times.slice(0, 20).join(), "the same seed gives the same arrivals (replayable)");
  let c = AR.init(T0, "other"); ok(AR.nextAt(c) !== times[0], "another seed gives other times");
  ok(AR.due(AR.init(T0, "s"), T0) === false && AR.due(AR.init(T0, "s"), T0 + 30 * 24 * H) === true, "due only once its time has come");
}

// 2. Found or bless.
{
  const base = { alive: 11, opNear: 180, wantsFound: true };
  ok(AR.decide(base).kind === "found", "room, grace, and it wants to: it founds");
  ok(AR.decide({ ...base, wantsFound: false }).kind === "bless", "it may choose to bless");
  const cap = AR.decide({ ...base, alive: 100 });
  ok(cap.kind === "bless" && /100/.test(cap.why), "nation 101 is refused: at 100 living nations it blesses");
  const poor = AR.decide({ ...base, opNear: AR.ARRIVE.foundNear + AR.ARRIVE.keepNear - 0.1 });
  ok(poor.kind === "bless" && /grace/.test(poor.why), "not enough grace to found and keep the floor: it blesses, and says why");
  const broke = AR.decide({ ...base, opNear: AR.ARRIVE.blessNear + 0.5, wantsFound: false });
  ok(broke.kind === "wait", "too little even to bless: it waits for the next arrival");
}

// 3. Names and targets.
{
  const names = ["Zeus", "Hera", "Athena", "Apollo"];
  const n1 = AR.pickName(names, new Set(["Zeus"]), "s1");
  ok(names.includes(n1) && n1 !== "Zeus", "a newcomer takes a free god name");
  ok(AR.pickName(names, new Set(names), "s1") === null, "no free name: no arrival");
  ok(AR.pickName(names, new Set(), "s1") === AR.pickName(names, new Set(), "s1"), "the same seed picks the same name");
  ok(AR.cleanNationName("  The Salt   Marsh!! ") === "The Salt Marsh", "a nation name is tidied");
  ok(AR.cleanNationName("x") === null && AR.cleanNationName("a".repeat(60)) === null, "too short or too long is refused");
  ok(AR.cleanNationName("North Pole", ["North Pole"]) === null, "an existing nation's name is refused");
  const clans = [
    { id: 1, alive: true, gods: [{ account: "saturn.op" }] },
    { id: 2, alive: true, gods: [{ account: "olive.testnet" }] },
    { id: 3, alive: true, gods: [{ account: "mars.op" }, { account: "olive.testnet" }] },
    { id: 4, alive: false, gods: [{ account: "lugh.op" }] },
  ];
  const t = AR.blessTargets(clans, new Set(["saturn.op", "mars.op", "lugh.op"])).map((c) => c.id);
  ok(t.join() === "1", "it blesses only living nations with no human god (a human's council stays theirs)");
}

// 4. The newcomer's own choice (stand-in mind here; Claude live, from the AI gods' pot).
{
  const { arrivalChoice } = await import("./llm.mjs");
  const c = await arrivalChoice({ name: "Hera", temperament: "proud", nations: [{ id: 1, name: "Helios", mood: "hungry" }], taken: ["Helios"] });
  ok(typeof c.found === "boolean" && (c.found ? typeof c.nation === "string" && c.nation.length >= 3 : Number.isInteger(c.bless)) && typeof c.why === "string", `a choice comes back (${JSON.stringify(c)})`);
}

// 5. The wiring.
{
  const loop = src("engine/loop.mjs"), run = src("engine/run.mjs"), chain = src("engine/chain.mjs"), aiact = src("engine/aiact.mjs");
  ok(/--arrive/.test(loop) && /arrivals/.test(loop), "the loop starts an arrival when one is due");
  ok(/--arrive/.test(run) && /arrive\(/.test(run), "run.mjs --arrive does one arrival and seals its record");
  ok(/includes\("--arrive"\) && !unseen/.test(run), "--arrive isn't stopped by the minimum gap between turns");
  ok(/aiFound/.test(chain), "chain.mjs founds for an AI god outside the planner's guard");
  ok(/export async function arrive/.test(aiact) && /addAiGod/.test(aiact), "aiact.arrive registers the newcomer as an AI god at once");
  ok(/case "arrival"/.test(src("src/live/feed.js")), "the feed tells the world a new god arrived");
}
