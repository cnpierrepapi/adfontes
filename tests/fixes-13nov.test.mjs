// His report 13 Nov ~07:45 UTC (written before the code):
// 1. North Pole is at war (its Scholars do no research) but the feed still asked for a research direction.
// 2. After he whispered, the "Just now" list, the dialogue box and the open nation panel didn't change:
//    every record waited in the 3D queue (one every ~2 s, stalled in a background tab) before the feed heard
//    it, and the panel was drawn once and never again.
// 3. The world contract's spare NEAR (balance - owed - storage) went below zero: verify.mjs #1 failed.
//    node tests/fixes-13nov.test.mjs
import fs from "node:fs";
import { canPitch } from "../engine/war.mjs";
import { reserveTopUp, RESERVE } from "../engine/reserve.mjs";
import { mergeQueue } from "../src/live/queue.js";
import { panelSig } from "../src/live/panelsig.js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// 1. No pitch at war.
const s = { wars: { w1: { a: 12, b: 13, status: "on" }, w0: { a: 1, b: 2, status: "over" } } };
ok(canPitch(s, 12) === false && canPitch(s, 13) === false, "both sides of a war get no pitch");
ok(canPitch(s, 1) === true && canPitch(s, 5) === true, "a nation whose war is over, or never at war, gets its pitch");
ok(canPitch({}, 3) === true, "no wars at all: pitch");
ok(/canPitch\(s, c\.id\)/.test(src("server.mjs")), "/api/next pitches leave out nations at war");
ok(/canPitch\(s, c\.id\)/.test(src("engine/aiact.mjs")), "AI gods aren't offered a pitch for a nation at war");

// 2a. Your own nations' records go ahead of the rest in the 3D queue (in their order), the rest keep theirs.
const q = [{ k: "a", clan: 1 }, { k: "b", clan: 2 }];
const out = mergeQueue(q, [{ k: "c", clan: 3 }, { k: "m1", clan: 12 }, { k: "m2", clan: 12 }], (r) => r.clan === 12);
ok(out.map((r) => r.k).join() === "m1,m2,a,b,c", `yours first, then the queue, then the rest (got ${out.map((r) => r.k).join()})`);
const out2 = mergeQueue([{ k: "m0", clan: 12 }, { k: "a", clan: 1 }], [{ k: "m1", clan: 12 }], (r) => r.clan === 12);
ok(out2.map((r) => r.k).join() === "m0,m1,a", "a new one of yours goes after yours already waiting, not before");
ok(mergeQueue([], [{ k: "x", clan: 1 }], () => false).length === 1, "nothing of yours: just appended");
const fx = src("src/live/effects.js"), live = src("src/live/live.js");
ok(/mergeQueue\(/.test(fx), "the effects queue uses mergeQueue");
ok(/feed\.record\(r\)/.test(live.slice(live.indexOf("async function livePoll"), live.indexOf("setInterval(livePoll"))), "the feed hears a live record when it arrives, not when the 3D queue plays it");
ok(!/recordHooks\.add\(\(r\) => feed\.record\(r\)\)/.test(live), "the feed is no longer fed from the 3D queue (no double lines)");

// 2b. The open panel redraws when its nation changes.
const c = { id: 12, reverence: { standing: 48.2 }, florins: 2138, mood: "sated", war: { hp: 10, enemyHp: 4 }, tricksters: 1, points: 11 };
ok(panelSig(c) === panelSig({ ...c }), "same nation, same signature");
ok(panelSig(c) !== panelSig({ ...c, reverence: { standing: 68.2 } }), "reverence moved: redraw");
ok(panelSig(c) !== panelSig({ ...c, war: { hp: 9, enemyHp: 4 } }), "a war round: redraw");
ok(panelSig(c) !== panelSig({ ...c, tricksters: 0 }), "a Trickster gone: redraw");
ok(panelSig(c) === panelSig({ ...c, florins: 2138.0004 }), "florin dust doesn't redraw it");
const main = src("src/live/main.js");
ok(/panelSig\(/.test(main) && /onLive/.test(main), "main.js redraws the open panel on a change and when its nation's live records arrive");

// 3. The storage reserve.
const N = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 18n;
const T = (bal, owe, store) => ({ balance: String(N(bal)), liabilities: String(N(owe)), storage_locked: String(N(store)) });
ok(reserveTopUp(T(78.2834, 67.8241, 10.5693 + 0.0)) === +(RESERVE.topTo + 0.11).toFixed(6), `margin -0.11 -> send ${RESERVE.topTo + 0.11} (got ${reserveTopUp(T(78.2834, 67.8241, 10.5693))})`);
ok(reserveTopUp(T(80, 67, 10.5)) === 0, "margin 2.5: nothing");
ok(reserveTopUp(T(78.5, 67.9, 10.3)) === 0, "margin 0.3 exactly: nothing (only below)");
ok(reserveTopUp(T(78.4, 67.9, 10.3)) === +(RESERVE.topTo - 0.2).toFixed(6), "margin 0.2: top up to 1.0");
ok(reserveTopUp(T(10, 67, 10)) === RESERVE.max, "a huge gap (a misread?) sends at most RESERVE.max");
ok(reserveTopUp({}) === 0 && reserveTopUp(null) === 0, "no totals: nothing");
const run = src("engine/run.mjs");
const at = run.indexOf("keepReserve"), root = run.indexOf("W.merkleRoot(rec)");
ok(at > 0 && at < root, "run.mjs keeps the reserve before the turn's root, so its record is sealed");
ok(/!INSTANT[^\n]{0,80}keepReserve/.test(run), "only on scheduled turns, never instant ones");
ok(/keepReserve/.test(src("engine/chain.mjs")), "chain.mjs sends it from the operator");
ok(/"reserve"/.test(fx.slice(fx.indexOf("function enqueue"), fx.indexOf("function enqueue") + 400)), "a reserve record isn't played as a 3D event");
