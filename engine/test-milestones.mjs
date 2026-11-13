// PLAN_13NOV §6 (his ask 13 Nov, milestones approved with "15 s is fine"): god powers unlock by milestones, most
// early, Act of God behind a medium-term one. Per god, across nations, counted from history, never lost. The engine
// refuses a locked god's Act of God; the AI planner never plans a locked power; the panel greys locked tiles.
// And AI gods pace their daily allowance over the whole UTC day instead of spending it by early afternoon.
// Written before engine/milestones.mjs.   node engine/test-milestones.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
Object.assign(process.env, { ADF_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "adf-ms-")), DATABASE_URL: "" });
const MS = await import("./milestones.mjs");
const A = await import("./aigods.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const H = 3600e3, NOW = 1_800_000_000_000;
const G = "god.test";
const base = () => ({ day: 80, clans: { 1: { techs: [] }, 2: { techs: [] } }, rev: { 1: { gods: { [G]: { r: 30, whispers: [] } } } }, reports: {} });
const onchain = [{ id: 1, alive: true, gods: [{ account: G }] }, { id: 2, alive: true, gods: [{ account: "other.test" }] }];

// 1. The ladder.
{
  const ids = MS.MILESTONES.map((m) => m.id).join(",");
  ok(ids === "arrive,heard,judge,revered,steward,ascendant", `six milestones in order (${ids})`);
  const at = (p) => MS.MILESTONES.find((m) => m.unlocks.includes(p))?.id;
  ok(["bless", "whisper", "ask", "pitch", "star", "seats", "claim", "ignore"].every((p) => at(p) === "arrive"), "arriving opens most powers at once");
  ok(at("rule") === "heard" && at("smite") === "judge" && at("list") === "revered" && at("root") === "steward" && at("fire") === "ascendant", "rule, smite, Broker whisper, root out, Act of God unlock in that order");
}

// 2. Reaching them.
{
  const s = base();
  MS.update(s, [], onchain, NOW);
  ok(MS.has(s, G, "whisper") && !MS.has(s, G, "rule") && !MS.has(s, G, "fire"), "a new god: the basics, nothing locked opened");
  let r = MS.update(s, [{ kind: "heard", clan: 1, god: G, delta: 4 }], onchain, NOW);
  ok(MS.has(s, G, "rule") && r.some((x) => x.kind === "milestone" && x.god === G && x.milestone === "heard"), "first whisper heard: Heard, a milestone record");
  ok(!MS.update(s, [{ kind: "heard", clan: 1, god: G, delta: 4 }], onchain, NOW).length, "reached once: no second record");
  MS.update(s, [{ kind: "report-settled", clan: 1, by: G, outcome: "stunted" }], onchain, NOW);
  ok(MS.has(s, G, "smite"), "a report stunted: Judge");
  const s2 = base(); MS.update(s2, [{ kind: "report-settled", clan: 1, god: G, outcome: "ignored" }], onchain, NOW);
  ok(MS.has(s2, G, "smite"), "a report ignored counts as judging too");
  const s5 = base(); MS.update(s5, [], onchain, NOW); MS.update(s5, [{ kind: "asked", clan: 1, report: "r1", god: G }], onchain, NOW);
  ok(MS.has(s5, G, "smite"), "hearing out an accused counts as judging (AI gods can't ignore, and stunting is what Judge opens)");
  const s3 = base(); MS.update(s3, [{ kind: "report-settled", clan: 1, outcome: "lapsed" }], onchain, NOW);
  ok(!MS.has(s3, G, "smite"), "a report that lapsed on its own doesn't");
  s.rev[1].gods[G].r = 50; MS.update(s, [], onchain, NOW);
  ok(MS.has(s, G, "list"), "reverence 50: Revered");
  s.clans[1].techs = ["spectacles"]; MS.update(s, [], onchain, NOW);
  ok(MS.has(s, G, "root"), "a nation of yours has a tech: Steward");
  s.clans[2].techs = ["spectacles", "press"]; s.rev[1].gods[G].r = 75; MS.update(s, [], onchain, NOW);
  ok(!MS.has(s, G, "fire"), "70+ reverence but its own nation has 1 tech: no Act of God (the 2 techs must be in a nation of yours)");
  s.clans[1].techs = ["spectacles", "press"];
  MS.update(s, [], onchain, NOW);
  ok(!MS.has(s, G, "fire"), "70+ and 2 techs, just now: not yet");
  MS.update(s, [], onchain, NOW + 12 * H);
  ok(!MS.has(s, G, "fire"), "12 h held: not yet");
  s.rev[1].gods[G].r = 65; MS.update(s, [], onchain, NOW + 13 * H);
  s.rev[1].gods[G].r = 72; MS.update(s, [], onchain, NOW + 14 * H);
  MS.update(s, [], onchain, NOW + 30 * H);
  ok(!MS.has(s, G, "fire"), "it dipped under 70: the day starts again");
  r = MS.update(s, [], onchain, NOW + 38.5 * H);
  ok(MS.has(s, G, "fire") && r.some((x) => x.milestone === "ascendant"), "a full real day at 70+: Ascendant, Act of God unlocked");
  s.rev[1].gods[G].r = 10; MS.update(s, [], onchain, NOW + 50 * H);
  ok(MS.has(s, G, "fire") && MS.has(s, G, "list"), "never lost once reached");
}

// 3. History counts (gods already playing when this ships).
{
  const s = base();
  s.rev[1].gods[G] = { r: 55, whispers: [70, 75] };
  s.reports = { "r70-1": { clan: 1, settled: true, outcome: "stunted" } };
  s.clans[1].techs = ["spectacles"];
  MS.update(s, [], onchain, NOW);
  const h = base(); MS.update(h, [], onchain, NOW, [{ kind: "heard", clan: 1, god: G, delta: 3 }, { kind: "asked", clan: 1, god: G, report: "r9" }]);
  ok(MS.has(h, G, "rule") && MS.has(h, G, "smite"), "sealed history counts: a whisper heard and an ask from weeks ago");
  const h2 = base(); MS.update(h2, [], onchain, NOW); MS.update(h2, [], onchain, NOW, [{ kind: "heard", clan: 1, god: G, delta: 3 }]);
  ok(!MS.has(h2, G, "rule"), "history is only read the first time a god is seen");
  ok(MS.needsHistory(base(), onchain) && !MS.needsHistory(h, onchain), "the engine knows when to read history");
  const quiet = MS.update(base(), [], onchain, NOW); // a fresh copy, for the record count
  ok(["rule", "smite", "list", "root"].every((p) => MS.has(s, G, p)) && !MS.has(s, G, "fire"), "a god with history gets credit: heard, judge, revered, steward at once");
  const s4 = base(); s4.rev[1].gods[G].r = 55; s4.clans[1].techs = ["x"];
  ok(!MS.update(s4, [], onchain, NOW).length, "credited quietly the first time: no flood of milestone records when this ships");
}

// 4. Progress for the panel.
{
  const s = base(); MS.update(s, [], onchain, NOW);
  const p = MS.progress(s, G, onchain, NOW);
  ok(p.reached.includes("arrive") && p.next?.id === "heard" && typeof p.next.how === "string" && Array.isArray(p.ladder) && p.ladder.length === 6, "progress: what's reached, what's next and how");
  ok(Array.isArray(p.locked) && p.locked.includes("fire") && !p.locked.includes("whisper"), "progress lists the locked powers");
}

// 5. The AI planner never plans a locked power.
{
  const sit = { god: "ai.op", clans: [1], allowance: 2, whispersToday: 0, aogToday: 0, reports: { 1: [{ id: "r1", accused: "X", answer: { says: "no" } }] }, gifts: { 1: [{ id: 4, warden_passed: true }] }, nations: [{ id: 1 }], sellable: { 1: [{ token: "r:c1" }] }, pitch: {}, locked: ["rule", "smite", "fire", "list"] };
  const plan = [{ kind: "rule", clan: 1, gift: 4, reward: true }, { kind: "smite", clan: 1, report: "r1", verdict: "Stunt" }, { kind: "fire", clan: 1, target: 2 }, { kind: "list", clan: 1, tokens: ["r:c1"] }, { kind: "whisper", clan: 1, text: "steady" }];
  const out = A.validatePlan(plan, sit).map((a) => a.kind);
  ok(out.join() === "whisper", `locked powers dropped, the rest kept (${out.join()})`);
}

// 6. AI gods pace the day: what they may spend grows through the UTC day.
{
  const { paced } = await import("./aiact.mjs");
  const day0 = Date.UTC(2026, 10, 13);
  const early = paced({ now: day0 + 1 * H, blessed: 0, whispers: 0 }), late = paced({ now: day0 + 23 * H, blessed: 0, whispers: 0 });
  ok(early.allowance > 0 && early.allowance < late.allowance && late.allowance <= 2, `bless allowance grows through the day (${early.allowance.toFixed(2)} at 01:00, ${late.allowance.toFixed(2)} at 23:00)`);
  ok(early.whisperRoom >= 1 && early.whisperRoom < late.whisperRoom && late.whisperRoom <= 8, `whispers too (${early.whisperRoom} then ${late.whisperRoom})`);
  ok(paced({ now: day0 + 12 * H, blessed: 2, whispers: 8 }).allowance === 0 && paced({ now: day0 + 12 * H, blessed: 2, whispers: 8 }).whisperRoom === 0, "spent is spent");
}

// 7. The wiring.
{
  const run = src("engine/run.mjs"), srv = src("server.mjs"), aiact = src("engine/aiact.mjs");
  ok(/MS\.update\(/.test(run), "run.mjs updates milestones each run and seals the records");
  ok(/MS\.has\(s, q\.god, "fire"\)/.test(run), "the engine refuses an Act of God from a god who isn't Ascendant");
  ok(/async milestones\(/.test(srv), "/api/milestones for the panel");
  ok(/locked: /.test(aiact) && /paced\(/.test(aiact), "the AI gods' situation carries their locked powers and the paced allowance");
  ok(/case "milestone"/.test(src("src/live/feed.js")), "the feed tells the world when a god reaches a milestone");
  // 13 Nov, his video: the feed's "Call fire on it" opened the Act of God card past the panel's lock.
  const g = src("src/live/gods.js");
  for (const [fn, p] of [["fireCard", "fire"], ["smiteCard", "smite"], ["ruleCard", "rule"], ["rootCard", "root"]]) { const at = g.indexOf(`async function ${fn}(`); ok(at > 0 && g.slice(at, g.indexOf("\n", g.indexOf("\n", at) + 1)).includes(`if (await locked("${p}"`), `${fn} checks its lock first, whatever button led there`); }
  // 13 Nov, his video: he couldn't find the seats page anywhere.
  ok(/href="\/seats\/">Seats</.test(src("live/index.html")), "Seats is in the live world's top bar");
  ok(/href="\/seats\/"/.test(src("marketplace/index.html")) && /href="\/seats\/"/.test(src("judge/index.html")), "and on the marketplace and judge pages");
  ok(/power\("Sell your seat"/.test(g), "and as a tile in your nation's powers");
}
