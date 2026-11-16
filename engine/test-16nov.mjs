// His calls 16 Nov: the AI gods' planner works in batches with a stand-in when a call fails; reverence back to
// parity (50) once; a 21-turn cooldown on war and Acts of God; AI gods can withdraw their whole stake and buy seats.
//   node engine/test-16nov.mjs
import * as CD from "./cooldown.mjs";
import * as WR from "./war.mjs";
import * as FIRE from "./fire.mjs";
import * as A from "./aigods.mjs";
import * as SE from "./seats.mjs";
import * as RV from "./reverence.mjs";
import { parityReverence, PARITY } from "./revfix.mjs";
import fs from "node:fs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const WORLD = "w6.adf-pool1-hf0w8.testnet", ESCROW = "adfontes-mw1fjpfx.testnet";

// ---- the cooldown ----
{
  const s = { day: 100, wars: { w1: { a: 3, b: 4, status: "peace", endedDay: 90 }, w2: { a: 5, b: 6, status: "on", startedDay: 95 }, w3: { a: 7, b: 8, status: "won", winner: 7, endedDay: 70 } }, fire: { landed: { 9: 99, 3: 85 } } };
  const sh = CD.shield(s, 3, 101);
  ok(sh && sh.until === 111 && sh.left === 10 && /war on turn 90/.test(sh.why), `out of a war on turn 90: protected until turn 111 (${JSON.stringify(sh)})`);
  ok(CD.shield(s, 4, 110)?.left === 1 && CD.shield(s, 4, 111) === null, "both sides of the war; free again on turn 111 exactly (90 + 21)");
  ok(CD.shield(s, 9, 101)?.until === 120 && /Act of God on turn 99/.test(CD.shield(s, 9, 101).why), "fire on turn 99: protected until turn 120");
  ok(CD.shield(s, 7, 101) === null && CD.shield(s, 8, 91) === null, "a war that ended 21 or more turns ago protects nobody");
  ok(CD.shield(s, 5, 101) === null, "a war still on gives no cooldown (it's at war: other rules stop attacks)");
  ok(CD.shield(s, 3, 101).why.includes("war"), "the latest hit wins (war on 90 beats fire on 85)");
  ok(JSON.stringify(CD.firesFrom([{ day: 80, records: [{ kind: "fire", clan: 2 }, { kind: "war" }] }, { day: 88, records: [{ kind: "fire", clan: 2 }, { kind: "fire", clan: 6 }] }])) === JSON.stringify({ 2: 88, 6: 88 }), "fire read back from sealed turns: the latest turn per nation");

  // A declaration on a protected nation is refused; on a free one it isn't.
  const passed = { d1: { clan: 1, passed: true }, d3: { clan: 3, passed: true }, d10: { clan: 10, passed: true } };
  const s2 = { day: 100, clans: { 1: { owned: {} }, 3: { owned: {} }, 10: { owned: {} } }, drafts: passed, wars: { w1: { a: 3, b: 4, status: "peace", endedDay: 90 } }, peace: {} };
  const r = WR.allowed(s2, 1, { action: "declare", target: 3 }, { 1: 50 }, Date.now(), 101);
  ok(!r.ok && /protected for 10 more turns \(until turn 111\)/.test(r.why), `war on a nation 11 turns out of a war: refused (${r.why})`);
  ok(WR.allowed(s2, 1, { action: "declare", target: 10 }, { 1: 50 }, Date.now(), 101).ok, "war on a nation with no recent hit: allowed");
  ok(WR.allowed(s2, 1, { action: "declare", target: 3 }, { 1: 50 }, Date.now(), 111).ok, "the same nation on turn 111: allowed");
  // An Act of God on a protected nation is refused.
  const f = FIRE.mayCast({ caster: 1, target: 9, standing: [1, 9], atWar: [], shield: CD.shield(s, 9, 101) });
  ok(!f.ok && /protected for 19 more turns/.test(f.why), `fire on a nation burned 2 turns ago: refused (${f.why})`);
  ok(FIRE.mayCast({ caster: 1, target: 9, standing: [1, 9], atWar: [], shield: null }).ok, "fire on an unprotected nation: allowed");
  const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  ok(/WR\.allowed\(s, x\.id, move, fl, now, day\)/.test(run) && /shield: CD\.shield\(s, q\.target, day\)/.test(run), "run.mjs checks the cooldown for both war and a god's fire");
  ok((run.match(/landed \|\|= \{\}\)\[[a-z.]+\] = day/g) || []).length === 2, "every fire that lands starts the clock (god or heavens, and a bully's)");
}

// ---- reverence back to parity ----
{
  const g = (r, extra = {}) => ({ r, whispers: [], flourish: 0, enemies: [], ...extra });
  const s = { clans: { 1: {}, 2: {}, 3: { fallen: { by: 1, day: 5 } } }, rev: {
    1: { followed: "lugh", gods: { lugh: g(89.5), laka: g(32) } },
    2: { followed: "brahma", gods: { brahma: g(54.7), visitor: g(20, { outsider: true }) } },
    3: { followed: "x", gods: { x: g(5) } },
  } };
  const onchain = [{ id: 1, alive: true, gods: [{ account: "lugh" }, { account: "laka" }] }, { id: 2, alive: true, gods: [{ account: "brahma" }] }, { id: 3, alive: true, gods: [{ account: "x" }] }, { id: 4, alive: false, gods: [] }];
  const out = parityReverence(s, onchain);
  ok(s.rev[1].gods.lugh.r === PARITY && s.rev[1].gods.laka.r === PARITY && s.rev[2].gods.brahma.r === PARITY, "every seated god at 50: down from 89.5 and 54.7, up from 32");
  ok(s.rev[2].gods.visitor.r === 20 && s.rev[3].gods.x.r === 5, "outside gods and fallen nations are left alone");
  ok(out[1].length === 2 && out[1].find((c) => c.god === "lugh").d === -39.5 && /from 89.5 to 50/.test(out[1][0].why + out[1][1].why), "each change is written down for the sealed record");
  RV.follow(s, 1, []);
  ok(s.rev[1].followed === "lugh", "a nation keeps the god it follows when its gods are level");
  s.rev[1].followed = "laka"; RV.follow(s, 1, []);
  ok(s.rev[1].followed === "laka", "... whichever god that was");
  s.rev[1].gods.lugh.r = 51; RV.follow(s, 1, []);
  ok(s.rev[1].followed === "lugh", "a god ahead still takes the nation");
  ok(Object.keys(parityReverence(s, onchain)).length === 1, "run again: only the gods that moved off 50 change (run.mjs runs it once)");
}

// ---- AI gods: withdraw and buy ----
{
  ok(A.guard({ receiver: WORLD, method: "withdraw", args: { clan_id: 3 }, deposit: 0n }, WORLD), "an AI god may withdraw its stake");
  let threw = false; try { A.guard({ receiver: WORLD, method: "claim_owed", args: {}, deposit: 0n }, WORLD); } catch { threw = true; }
  ok(threw, "anything else on the world is still refused (claim_owed)");
  ok(A.guardPay(ESCROW, (2n * 10n ** 24n).toString(), ESCROW), "it may pay the escrow for a seat");
  threw = false; try { A.guardPay("someone.testnet", "1000", ESCROW); } catch { threw = true; }
  ok(threw, "a payment anywhere else is refused");
  threw = false; try { A.guardPay(ESCROW, "0", ESCROW); } catch { threw = true; }
  ok(threw, "a payment of nothing is refused");

  const sit = { god: "lugh", clans: [1, 2], allowance: 1, wallet: 7, nations: [], listings: [{ id: 11, clan: 5, price: 2.5 }, { id: 12, clan: 6, price: 6.9 }, { id: 13, clan: 1, price: 1 }], shielded: [9] };
  const v = A.validatePlan([{ kind: "buy", listing: 11 }, { kind: "buy", listing: 12 }, { kind: "buy", listing: 99 }], sit);
  ok(v.length === 1 && v[0].kind === "buy" && v[0].listing === 11 && v[0].clan === 5 && v[0].price === 2.5, `one buy a turn, a listing it was shown (${JSON.stringify(v)})`);
  ok(A.validatePlan([{ kind: "buy", listing: 12 }], sit).length === 0, "a seat that would leave it under 0.3 grace: not bought (6.9 + 0.3 > 7)");
  ok(A.validatePlan([{ kind: "buy", listing: 13 }], sit).length === 0, "never a seat in a nation it already sits in");
  const w = A.validatePlan([{ kind: "whisper", clan: 2, text: "hold on" }, { kind: "withdraw", clan: 2 }, { kind: "withdraw", clan: 1 }, { kind: "bless", clan: 2, near: 0.5 }, { kind: "bless", clan: 1, near: 0.2 }], sit);
  ok(w.filter((x) => x.kind === "withdraw").length === 1 && w.find((x) => x.kind === "withdraw").clan === 2, "one withdrawal a turn");
  ok(!w.some((x) => x.clan === 2 && x.kind !== "withdraw") && w.some((x) => x.kind === "bless" && x.clan === 1), "nothing else goes to the nation it leaves; its other nations carry on");
  ok(A.validatePlan([{ kind: "withdraw", clan: 7 }], sit).length === 0, "it can only leave a nation it sits in");
  ok(A.validatePlan([{ kind: "fire", clan: 1, target: 9 }], sit).length === 0 && A.validatePlan([{ kind: "fire", clan: 1, target: 8 }], sit).length === 1, "no fire planned on a protected nation");

  const ai = new Set(["lugh", "laka"]);
  ok(SE.takesName({ seller: "laka", buyer: "person.testnet", ai, seatsElsewhere: 0 }), "a person buying an AI seat takes its name");
  ok(!SE.takesName({ seller: "laka", buyer: "lugh", ai, seatsElsewhere: 0 }), "an AI god buying keeps its own name");
  const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  ok(/takesName\(\{ seller: l\.seller, buyer: b\.buyer[^\n]*removeAiGod/.test(run), "a seller AI god is let go only when a person takes its name");
  const act = fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8");
  ok(/chain\.aiPay\(row\.god, l\.price\)/.test(act) && /store\.seatBuy\(net, \{ tx: p\.hash/.test(act), "a buy pays the escrow from the god's wallet and hands the payment to the seat market");
  ok(/kind === "withdraw"\) return \[C\.withdraw\(world, a\.clan\)\]/.test(act), "a withdrawal is the god panel's own call");
}

// ---- planning in batches ----
{
  const sits = Array.from({ length: 14 }, (_, i) => ({ god: `g${i}`, clans: [i], nations: [{ id: i, name: `n${i}`, standing: 10, mood: "hungry", need: 0.3, fed24h: 0 }], allowance: 1, gifts: {} }));
  const calls = [];
  const plan = async (batch) => {
    calls.push(batch.length);
    if (calls.length === 2) throw new Error("Unterminated string in JSON");
    return Object.fromEntries(batch.map((s, i) => [s.god, i === 0 ? [] : [{ kind: "whisper", clan: s.clans[0], text: "words" }]]));
  };
  const { plans, failed } = await A.planInBatches(sits, plan, { size: 6 });
  ok(calls.join(",") === "6,6,2", `14 gods in batches of 6: three calls (${calls.join(",")})`);
  ok(Object.keys(plans).length === 14, "every god gets a plan");
  ok(failed.length === 1 && /Unterminated/.test(failed[0]), "a failed call is counted, not thrown");
  ok(sits.slice(6, 12).every((s) => plans[s.god].some((a) => a.kind === "bless")), "the gods of the failed batch get the stand-in plan (it feeds the hungry)");
  ok(plans.g0.length > 0 && plans.g1[0].text === "words", "a god Claude left empty gets the stand-in; the rest keep Claude's words");
  const all = await A.planInBatches(sits, async () => { throw new Error("pot spent"); });
  ok(all.failed.length === 3 && Object.values(all.plans).every((p) => p.length), "a spent pot: everyone on the stand-in, nobody idle");
  const llm = fs.readFileSync(new URL("./llm.mjs", import.meta.url), "utf8");
  ok(/GODS_PLAN,\s*6000,/.test(llm) && /2 to 4 actions/.test(llm) && /"buy", "withdraw"\]/.test(llm), "each call has more room, asks for fewer actions, and knows buy and withdraw");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
if (fails) process.exit(1);
