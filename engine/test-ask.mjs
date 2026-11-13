// PLAN_13NOV step 2, Ask the accused (his call 12 Nov: asking comes FIRST). Written before engine/ask.mjs.
// A report opens with one answer: "Ask <accused>" (a signed choice). The accused answers in their own words
// (one short Claude call; a guilty one may lie), in seconds via the loop. Only then can a stunt settle it.
// Silence = today: a report nobody asks about lapses on its clock. Asking moves no reverence.
//    node engine/test-ask.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-ask-"));
Object.assign(process.env, { ADF_STATE_DIR: dir, DATABASE_URL: "", ADF_FAKE_LLM: "1" });
const AK = await import("./ask.mjs");
const RV = await import("./reverence.mjs");
const CH = await import("./choices.mjs");
const AG = await import("./aigods.mjs");
const store = await import("./store.mjs");
const { accusedReply } = await import("./llm.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const world = () => ({
  reports: {
    "r64-12": { id: "r64-12", clan: 12, day: 64, accuser: "Dagny Castell", accused: "Dagny Ulloa", kind: "trickster", claim: "Dagny Castell says Dagny Ulloa is a Trickster", truth: true, settled: false },
    "r60-3": { id: "r60-3", clan: 3, day: 60, accuser: "A", accused: "B", kind: "fake", claim: "A says B faked", truth: false, settled: true },
  },
});
const agents = [{ name: "Dagny Ulloa", role: "Trickster", alive: true, stunted_until: 0 }, { name: "Dagny Castell", role: "Scholar", alive: true, stunted_until: 0 }];
const ask = (clan, report, account = "olive.testnet") => ({ day: 68, clan, kind: "ask", account, payload: { report } });

// 1. Asking marks the report, once, and only an open report of that nation.
let s = world();
let recs = AK.markAsked(s, [ask(12, "r64-12")], 12, 68);
ok(s.reports["r64-12"].asked?.by === "olive.testnet" && recs.length === 1 && recs[0].kind === "asked", "an ask marks the open report as asked and writes an 'asked' record");
ok(AK.markAsked(s, [ask(12, "r64-12", "other.testnet")], 12, 68).length === 0 && s.reports["r64-12"].asked.by === "olive.testnet", "asking twice changes nothing");
ok(AK.markAsked(s, [ask(3, "r60-3")], 3, 68).length === 0 && !s.reports["r60-3"].asked, "a settled report can't be asked");
ok(AK.markAsked(s, [ask(5, "r64-12")], 5, 68).length === 0, "another nation's god can't ask about this nation's report");

// 2. The accused answers once, in their own words; the truth goes to the reply but not into the record.
let calls = 0, seen = null;
const reply = async (x) => { calls++; seen = x; return { says: "I only checked the sources twice, ask anyone." }; };
recs = await AK.answerAsked(s, 12, agents, 68, reply);
ok(calls === 1 && recs.length === 1 && recs[0].kind === "answer" && /checked the sources/.test(recs[0].says), "the accused answers once, recorded as an 'answer'");
ok(seen.guilty === true && seen.role === "Trickster" && seen.accused === "Dagny Ulloa", "the reply knows who they are and whether they're guilty (a guilty one may lie)");
ok(!("truth" in recs[0]) && !("guilty" in recs[0]), "the answer record doesn't give the truth away");
ok((await AK.answerAsked(s, 12, agents, 68, reply)).length === 0 && calls === 1, "a second look doesn't answer again");
ok(AK.answered(s.reports["r64-12"]) === true, "the report counts as answered");

// 3. Dead or stunted: silent, and the stunt unlocks at once.
for (const [label, who] of [["dead", { alive: false }], ["stunted", { stunted_until: 70 }]]) {
  const s2 = world(); AK.markAsked(s2, [ask(12, "r64-12")], 12, 68); calls = 0;
  const r2 = await AK.answerAsked(s2, 12, [{ ...agents[0], ...who }, agents[1]], 68, reply);
  ok(calls === 0 && r2[0]?.silent === true && r2[0].says === null && AK.answered(s2.reports["r64-12"]), `a ${label} accused can't answer: silent, no Claude call, and it counts as answered`);
}

// 4. A failed reply leaves it asked but unanswered, to try again.
const s3 = world(); AK.markAsked(s3, [ask(12, "r64-12")], 12, 68);
const r3 = await AK.answerAsked(s3, 12, agents, 68, async () => { throw new Error("budget"); });
ok(r3[0]?.kind === "error" && !AK.answered(s3.reports["r64-12"]), "a failed reply: an error record, still unanswered");
ok((await AK.answerAsked(s3, 12, agents, 69, reply))[0]?.kind === "answer", "the next look answers it");

// 5. A stunt only settles a report that has been answered.
const s4 = world(), rv = { gods: { "olive.testnet": { r: 50, enemies: [] } } }, ch = [];
ok(RV.answerReport(s4, rv, 12, "olive.testnet", "Dagny Ulloa", 68, ch) === null && !s4.reports["r64-12"].settled, "stunting before asking doesn't settle the report");
AK.markAsked(s4, [ask(12, "r64-12")], 12, 68);
ok(RV.answerReport(s4, rv, 12, "olive.testnet", "Dagny Ulloa", 68, ch) === null, "asked but not answered yet: still doesn't settle");
await AK.answerAsked(s4, 12, agents, 68, reply);
ok(RV.answerReport(s4, rv, 12, "olive.testnet", "Dagny Ulloa", 68, ch)?.outcome === "stunted" && s4.reports["r64-12"].settled, "after the answer, a stunt settles it as before");

// 6. Silence = today: it still lapses on its clock, asked or not; asking moves no reverence.
const s5 = world(); AK.markAsked(s5, [ask(12, "r64-12")], 12, 68);
const lapsed = RV.lapseReports(s5, { gods: {}, followed: null }, 12, 64 + RV.REV.reportDays, []);
ok(lapsed.length === 1 && s5.reports["r64-12"].outcome === "lapsed", "an asked report still lapses on time");
ok(!/reverence|\.r\s*[+-]=/.test(src("engine/ask.mjs").replace(/\/\/.*$/gm, "")), "asking touches no reverence");

// 7. The signed choice.
ok(CH.KINDS.ask({ report: "r64-12" }) === true, "an ask names a report id");
ok(!CH.KINDS.ask({ report: "drop table" }) && !CH.KINDS.ask({}) && !CH.KINDS.ask(null), "junk is refused");
ok(/kind === "ask"[\s\S]{0,300}settled/.test(src("server.mjs")), "the server only takes an ask for an open report of that nation");

// 8. AI gods ask first, stunt only after the answer.
const sit = { god: "lugh.op", allowance: 0, clans: [12], reports: { 12: [{ id: "r64-12", accused: "Dagny Ulloa", asked: false, answer: null }] }, gifts: {}, aogToday: 0 };
ok(AG.validatePlan([{ kind: "ask", clan: 12, report: "r64-12" }], sit)[0]?.kind === "ask", "an AI god may ask about a listed report");
ok(AG.validatePlan([{ kind: "smite", clan: 12, report: "r64-12" }], sit).length === 0, "an AI god can't stunt before the answer");
const sit2 = { ...sit, reports: { 12: [{ id: "r64-12", accused: "Dagny Ulloa", asked: true, answer: { says: "no" } }] } };
ok(AG.validatePlan([{ kind: "smite", clan: 12, report: "r64-12" }], sit2)[0]?.kind === "smite" && AG.validatePlan([{ kind: "ask", clan: 12, report: "r64-12" }], sit2).length === 0, "after the answer it may stunt, and can't ask again");
ok(/kind === "ask"[\s\S]{0,200}putChoice/.test(src("engine/aiact.mjs")), "an AI god's ask is stored as its choice");
ok(/ask/.test(src("engine/llm.mjs").slice(src("engine/llm.mjs").indexOf("export async function godsPlan"))), "the AI gods' prompt explains asking");

// 9. The wiring.
const run = src("engine/run.mjs");
ok(/AK\.markAsked\(/.test(run) && /AK\.answerAsked\(/.test(run), "every turn (instant too) marks asks and answers them");
ok(/asksSince/.test(src("engine/loop.mjs")), "the loop gives a nation with a new ask an instant turn (an answer in seconds)");
await store.putChoice("testnet", ask(12, "r64-12"));
const since = await store.asksSince("testnet", Date.now() - 60e3);
ok(since.length === 1 && since[0].clan === 12, "store.asksSince finds a new ask");
ok((await store.asksSince("testnet", Date.now() + 60e3)).length === 0, "and nothing newer than that");
const srv = src("server.mjs");
ok(/asked:/.test(srv) && /answer:/.test(srv), "/api/next and /api/clan carry asked and the answer");
const feed = src("src/live/feed.js"), gods = src("src/live/gods.js");
ok(/choose\("ask"/.test(feed) && /choose\("ask"/.test(gods), "the feed and the god panel ask first");
ok(/r\.answer/.test(gods) && /Stunt/.test(gods), "the panel's Stunt button waits for the answer");
ok(/kind === "answer"/.test(feed), "the answer speaks in the dialogue box");

// 10. The reply itself (stand-in): words, short.
const a1 = await accusedReply({ accused: "Dagny Ulloa", role: "Trickster", claim: "x", guilty: true, nation: "North Pole", temperament: "ESFP" });
ok(typeof a1.says === "string" && a1.says.length > 0 && a1.says.length <= 220, "accusedReply gives one short line");
