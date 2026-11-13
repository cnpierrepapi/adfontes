// His call 13 Nov: a god can ignore a report: it settles at once (no waiting a real day for it to lapse) and leaves the
// HUD and the to-do list. It counts as letting it lapse: a true report ignored still costs the accuser's faith.
// And the Claude budget: $3.50 a UTC day, half to the AI gods, half to the citizens. Written before the code.
//    node engine/test-dismiss.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
Object.assign(process.env, { ADF_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "adf-dis-")), DATABASE_URL: "" });
delete process.env.ADF_DAILY_CAP;
const RV = await import("./reverence.mjs");
const CH = await import("./choices.mjs");
const { CFG } = await import("./config.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const world = () => ({ reports: {
  "r70-3": { id: "r70-3", clan: 3, day: 70, accuser: "Ana", accused: "Bo", claim: "Ana says Bo faked", truth: true, settled: false },
  "r70-4": { id: "r70-4", clan: 4, day: 70, accuser: "Cy", accused: "Di", claim: "Cy says Di faked", truth: false, settled: false },
} });
const rvOf = () => ({ gods: { "g.test": { r: 50, faithLossUntil: 0 } }, followed: "g.test", putIn: {} });

ok(CH.KINDS.dismiss({ report: "r70-3" }) && !CH.KINDS.dismiss({ report: "nope" }), "'dismiss' is a choice kind, naming one report");
{
  const s = world(), rv = rvOf(), ch = [];
  const recs = RV.dismissReports(s, rv, 3, 71, [{ clan: 3, kind: "dismiss", account: "g.test", payload: { report: "r70-3" } }], ch);
  ok(s.reports["r70-3"].settled && s.reports["r70-3"].outcome === "ignored", "ignored: settled at once, outcome 'ignored'");
  ok(recs.length === 1 && recs[0].kind === "report-settled" && recs[0].outcome === "ignored" && recs[0].god === "g.test", "one report-settled record, saying who ignored it");
  ok(rv.gods["g.test"].faithLossUntil > 71 && ch.some((c) => /lost faith/.test(c.why)), "a true report ignored: the accuser loses faith, as with a lapse");
  ok(!RV.dismissReports(s, rv, 3, 71, [{ clan: 3, kind: "dismiss", account: "g.test", payload: { report: "r70-3" } }], []).length, "ignoring it again does nothing");
  ok(!RV.dismissReports(s, rv, 3, 71, [{ clan: 4, kind: "dismiss", account: "g.test", payload: { report: "r70-4" } }], []).length && !s.reports["r70-4"].settled, "only this nation's reports, only this nation's choices");
  const s2 = world(), rv2 = rvOf();
  RV.dismissReports(s2, rv2, 4, 71, [{ clan: 4, kind: "dismiss", account: "g.test", payload: { report: "r70-4" } }], []);
  ok(s2.reports["r70-4"].settled && rv2.gods["g.test"].faithLossUntil === 0, "a false report ignored costs nothing");
}
ok(CFG.dailyCapUsd === 3.5 && CFG.godsCapUsd === 1.75 && CFG.citizensCapUsd === 1.75, `budget $${CFG.dailyCapUsd}/day: AI gods $${CFG.godsCapUsd}, citizens $${CFG.citizensCapUsd}`);
{
  const run = src("engine/run.mjs"), srv = src("server.mjs"), loop = src("engine/loop.mjs");
  ok(/RV\.dismissReports\(/.test(run), "run.mjs settles ignored reports in the nation's turn");
  ok(/"dismiss"/.test(loop), "an ignore gets the nation an instant turn (seconds, not the next turn)");
  ok(/kind === "dismiss"/.test(srv), "the server only takes an ignore for an open report of that nation");
  ok(/"Ignore"/.test(src("src/live/feed.js")) && /Ignore/.test(src("src/live/gods.js")), "Ignore is offered in the feed and the god panel");
}
