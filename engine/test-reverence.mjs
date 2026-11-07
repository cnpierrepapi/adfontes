// Proves the reverence rules (SPEC §12m) on made-up nations. No chain, no Claude. Run: node engine/test-reverence.mjs
import { REV, ensure, act, fade, follow, effects, maybeReport, answerReport, lapseReports, flourish } from "./reverence.mjs";
let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", label); };
const near = (a, b) => Math.abs(a - b) < 0.01;
const R = (() => { let x = 7; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
const s = {};
const A = { id: 1, gods: [{ account: "ann", put_in: "0" }] };
const B = { id: 2, gods: [{ account: "bo", put_in: "0" }, { account: "cy", put_in: "0" }] };
let ch = [];

// Existing gods start at 50; a nation founded later waits for its god's first whisper.
let ra = ensure(s, A, 1, { fresh: false });
check("existing god starts at 50, citizens not waiting", ra.gods.ann.r === 50 && !ra.waiting);
const C = { id: 3, gods: [{ account: "dee", put_in: "0" }] };
let rc = ensure(s, C, 5, { fresh: true });
check("new founder starts at 30 and the citizens wait", rc.gods.dee.r === 30 && effects(rc).waiting);
act(rc, "dee", "whisper", 5, ch, { text: "Be careful" });
check("first whisper ends the wait and lifts reverence", !effects(rc).waiting && rc.gods.dee.r === 45);

// Whispers: diminishing within a real day, and capped at 60.
ch = [];
act(rc, "dee", "whisper", 6, ch, {}); // 2nd in the window: +7.5
check("second whisper the same day gives half (45 -> 52.5)", near(rc.gods.dee.r, 52.5));
act(rc, "dee", "whisper", 7, ch, {}); // 3rd: +5 -> 57.5
act(rc, "dee", "whisper", 8, ch, {}); // 4th: +3.75 -> capped at 60
check("whispers alone stop at 60", rc.gods.dee.r === REV.whisperCap);
act(rc, "dee", "reward", 8, ch, {});
check("other actions go above 60 (reward +6 -> 66)", rc.gods.dee.r === 66);
act(rc, "dee", "whisper", 9, ch, {});
check("a whisper never pulls reverence down from above the cap", rc.gods.dee.r === 66);

// A flourishing nation makes the next whisper count for more.
rc.gods.dee.r = 40; rc.gods.dee.whispers = [];
flourish(rc, 3);
act(rc, "dee", "whisper", 30, ch, {});
check("whisper after the nation did well: 15 + 6 bonus (40 -> 60, capped)", rc.gods.dee.r === 60);

// Fade, and what it does at low reverence.
ra.gods.ann.r = 31;
fade(ra, 2, new Set(), ch);
check("plain fade is 1 a game day", ra.gods.ann.r === 30);
fade(ra, 3, new Set(), ch);
follow(s, 1, ch);
check("under 30 the whisper is ignored and citizens go their own way", effects(ra).ignored && effects(ra).whisper === "" && effects(ra).mistakeAdd > 0);

// Several gods: the citizens follow the most revered.
const rb = ensure(s, B, 1, { fresh: false });
rb.gods.bo.r = 20; rb.gods.cy.r = 55;
follow(s, 2, ch);
check("several gods: the citizens follow the most revered (cy)", rb.followed === "cy");

// One god at zero: an outside god claims the nation (the best-revered god of another nation).
ra.gods.ann.r = 0;
follow(s, 1, ch);
check(`only god at zero: claimed by outside god ${ra.claimedBy} (cy, the most revered elsewhere)`, ra.claimedBy === "cy" && ra.followed === "cy" && ra.gods.cy.outsider);

// Reports: stunt a guilty citizen -> fade slows; stunt an innocent -> enemy, faster fade; ignore a true one -> faith lost.
const living = [{ name: "Wren", role: "Scholar", stunted_until: 0 }, { name: "Otto", role: "Smith", stunted_until: 0 }, { name: "Nora", role: "Patron", stunted_until: 0 }];
const D = { id: 4, gods: [{ account: "eve", put_in: "0" }] };
const rd = ensure(s, D, 1, { fresh: false });
follow(s, 4, ch);
let rep = null;
for (let d = 10; d < 200 && !rep; d++) rep = maybeReport(s, 4, d, living, [{ kind: "fake", name: "Wren" }], R);
const r1 = s.reports[rep.report];
check(`a report appears without its truth in the record: "${rep.claim}"`, !!rep && !("truth" in rep));
const out = answerReport(s, rd, 4, "eve", r1.accused, r1.day + 1, ch);
if (r1.truth) {
  const before = rd.gods.eve.r; fade(rd, r1.day + 2, new Set(["Wren", "Otto", "Nora"]), ch);
  check(`stunting the guilty ${r1.accused}: justice, fade halved (${before} -> ${rd.gods.eve.r})`, near(before - rd.gods.eve.r, 0.5) && out.truth === true);
} else {
  const before = rd.gods.eve.r; fade(rd, r1.day + 2, new Set(["Wren", "Otto", "Nora"]), ch);
  check(`stunting the innocent ${r1.accused}: an enemy, fade 1.5 (${before} -> ${rd.gods.eve.r})`, near(before - rd.gods.eve.r, 1.5) && rd.gods.eve.enemies.includes(r1.accused));
}
// Force the other two branches deterministically.
s.reports.x = { id: "x", clan: 4, day: 50, accuser: "Nora", accused: "Otto", kind: "sold", truth: false, settled: false };
rd.gods.eve.enemies = []; rd.gods.eve.justiceUntil = 0;
answerReport(s, rd, 4, "eve", "Otto", 51, ch);
let before = rd.gods.eve.r; fade(rd, 52, new Set(["Wren", "Otto", "Nora"]), ch);
check("stunting an innocent makes an enemy: fade 1.5 a day while they live", near(before - rd.gods.eve.r, 1.5));
before = rd.gods.eve.r; fade(rd, 53, new Set(["Wren", "Nora"]), ch);
check("the enemy dies: back to the plain fade of 1", near(before - rd.gods.eve.r, 1));
s.reports.y = { id: "y", clan: 4, day: 60, accuser: "Nora", accused: "Wren", kind: "fake", truth: true, settled: false };
const lapsed = lapseReports(s, rd, 4, 60 + REV.reportDays, ch);
before = rd.gods.eve.r; fade(rd, 61 + REV.reportDays, new Set(["Wren", "Otto", "Nora"]), ch);
check("ignoring a true report: the accuser loses faith, fade 1.5 for a day", lapsed[0]?.outcome === "lapsed" && lapsed[0].truth && near(before - rd.gods.eve.r, 1.5));
s.reports.z = { id: "z", clan: 4, day: 70, accuser: "Nora", accused: "Wren", kind: "rushed", truth: false, settled: false };
rd.gods.eve.faithLossUntil = 0;
lapseReports(s, rd, 4, 70 + REV.reportDays, ch);
before = rd.gods.eve.r; fade(rd, 71 + REV.reportDays, new Set(["Wren", "Otto", "Nora"]), ch);
check("ignoring a false report costs nothing extra", near(before - rd.gods.eve.r, 1));

// Every action moves reverence.
const E = { id: 5, gods: [{ account: "fin", put_in: "0" }] };
const re = ensure(s, E, 1, { fresh: false });
const moves = {};
for (const k of ["bless", "reward", "punish", "claim", "staking", "stunt", "kill"]) { re.gods.fin.r = 50; act(re, "fin", k, 1, ch, { near: 1, verdict: "Stunt" }); moves[k] = re.gods.fin.r - 50; }
check(`every action moves it: ${JSON.stringify(moves)}`, moves.bless > 0 && moves.reward > 0 && moves.claim > 0 && moves.staking > 0 && moves.punish < 0 && moves.stunt < 0 && moves.kill < moves.stunt);

console.log(bad ? `${bad} FAILED` : "ALL PASS");
