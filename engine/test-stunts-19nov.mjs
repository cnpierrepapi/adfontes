// One stunt per report (his call 19 Nov). Several AI gods share a nation; each raised its own smite on the same
// report, and every motion that passed took 8 reverence from its god: 121 stunts sealed 217 penalties over days
// 120-143 (Tate's Reach's six gods all sank to 0). Written before the fix:
//  1. engine (reverence.godActions): the smite that settles a report costs its god; a second smite on a citizen
//     whose report another smite already settled costs nothing. A smite with no report behind it costs as before.
//  2. planner (aigods.oneSmitePerReport): one smite per report per plan, from the god with the most reverence there.
//  3. prompt (llm.godsPrompt): the gods are told what a stunt costs, about enemies, that a report may be left to
//     lapse, and see their own enemy count in each nation.
//  4. refund (revfix.dupStunts + refundStunts): once, give back every duplicate penalty already sealed.
import fs from "node:fs";
import * as RV from "./reverence.mjs";
import * as A from "./aigods.mjs";
import { dupStunts, refundStunts } from "./revfix.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const WORLD = "world.test";

// ---- 1. the engine charges one stunt per report ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const smiteProp = (id, proposer, clan, agent) => ({ id, proposer, status: "Approved", kind: { FunctionCall: { receiver_id: WORLD, actions: [{ method_name: "smite", args: b64({ clan_id: clan, agent, verdict: "Stunt" }) }] } } });
function fakeChain(props) {
  return { world: WORLD, dao: async (_dao, method, args) => (method === "get_last_proposal_id" ? props.length : props.slice(args.from_index, args.from_index + args.limit)) };
}
function world(gods, reports) {
  const s = { reports: {} };
  for (const r of reports) s.reports[r.id] = { clan: 2, settled: false, truth: true, answer: { says: "not me" }, ...r };
  const oc = { id: 2, dao: "dao.test", gods: gods.map((g) => ({ account: g, put_in: "0" })) };
  const rv = { gods: {}, followed: gods[0], putIn: {}, lastProposal: 0, open: [], waiting: false };
  for (const g of gods) { rv.gods[g] = { r: 50, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0, text: "" }; rv.putIn[g] = "0"; }
  return { s, oc, rv };
}
const cost = (changes, god) => changes.filter((c) => c.god === god && /^stunted/.test(c.why)).reduce((a, c) => a + c.d, 0);

{
  // Three gods' motions on the same answered report pass in the same look.
  const { s, oc, rv } = world(["wadd", "ahti", "anansi"], [{ id: "r1", accused: "Klara", day: 100 }]);
  const changes = [];
  const out = await RV.godActions({ chain: fakeChain([smiteProp(0, "wadd", 2, "Klara"), smiteProp(1, "ahti", 2, "Klara"), smiteProp(2, "anansi", 2, "Klara")]), s, oc, rv, day: 101, changes });
  ok(cost(changes, "wadd") === RV.REV.stunt && rv.gods.wadd.r === 50 + RV.REV.stunt, `the god whose smite settles the report pays the stunt (${cost(changes, "wadd")})`);
  ok(rv.gods.ahti.r === 50 && rv.gods.anansi.r === 50, `the other two gods' smites on the same report cost nothing (ahti ${rv.gods.ahti.r}, anansi ${rv.gods.anansi.r})`);
  ok(changes.some((c) => c.god === "ahti" && c.d === 0 && /already/.test(c.why) && /wadd/.test(c.why)), "the free smite is still listed, naming the god who already settled it");
  ok(out.filter((r) => r.kind === "report-settled").length === 1, "the report is settled once");
  ok(s.reports.r1.settledDay === 101 && s.reports.r1.by === "wadd", "a settled report keeps the day and the god who settled it");
}
{
  // The duplicate motion only passes on a later turn (votes came in later): still free within a real day.
  const { s, oc, rv } = world(["wadd", "ahti"], [{ id: "r1", accused: "Klara", day: 100, settled: true, outcome: "stunted", settledDay: 101, by: "wadd" }]);
  const changes = [];
  await RV.godActions({ chain: fakeChain([smiteProp(0, "ahti", 2, "Klara")]), s, oc, rv, day: 104, changes });
  ok(rv.gods.ahti.r === 50, `a smite that passes 3 game days after another god settled the report costs nothing (${rv.gods.ahti.r})`);
}
{
  // A report settled before this fix has no settledDay: its report day counts.
  const { s, oc, rv } = world(["wadd", "ahti"], [{ id: "r1", accused: "Klara", day: 100, settled: true, outcome: "stunted" }]);
  const changes = [];
  await RV.godActions({ chain: fakeChain([smiteProp(0, "ahti", 2, "Klara")]), s, oc, rv, day: 103, changes });
  ok(rv.gods.ahti.r === 50, "a report settled before the fix (no settledDay) still makes a duplicate free");
}
{
  // A new report on the same citizen: a real stunt, charged as before.
  const { s, oc, rv } = world(["wadd", "ahti"], [{ id: "r1", accused: "Klara", day: 100, settled: true, outcome: "stunted", settledDay: 101, by: "wadd" }, { id: "r2", accused: "Klara", day: 103 }]);
  const changes = [];
  await RV.godActions({ chain: fakeChain([smiteProp(0, "ahti", 2, "Klara")]), s, oc, rv, day: 104, changes });
  ok(rv.gods.ahti.r === 50 + RV.REV.stunt && s.reports.r2.settled, `a smite that settles a new report on the same citizen costs the stunt (${rv.gods.ahti.r})`);
}
{
  // A smite with no report behind it (a god acting on its own): unchanged, it costs the stunt.
  const { s, oc, rv } = world(["brahma"], []);
  const changes = [];
  await RV.godActions({ chain: fakeChain([smiteProp(0, "brahma", 2, "Nobody")]), s, oc, rv, day: 104, changes });
  ok(rv.gods.brahma.r === 50 + RV.REV.stunt, `a smite with no report costs the stunt as before (${rv.gods.brahma.r})`);
}
{
  // Long after: a report settled 20 game days ago doesn't make a fresh smite free.
  const { s, oc, rv } = world(["ahti"], [{ id: "r1", accused: "Klara", day: 80, settled: true, outcome: "stunted", settledDay: 81, by: "wadd" }]);
  const changes = [];
  await RV.godActions({ chain: fakeChain([smiteProp(0, "ahti", 2, "Klara")]), s, oc, rv, day: 104, changes });
  ok(rv.gods.ahti.r === 50 + RV.REV.stunt, `a smite 23 game days after the last settled report costs the stunt (${rv.gods.ahti.r})`);
}
{
  // A lapsed report isn't a stunt: a smite on that citizen afterwards isn't a duplicate.
  const { s, oc, rv } = world(["ahti"], [{ id: "r1", accused: "Klara", day: 100, settled: true, outcome: "lapsed", settledDay: 112 }]);
  const changes = [];
  await RV.godActions({ chain: fakeChain([smiteProp(0, "ahti", 2, "Klara")]), s, oc, rv, day: 113, changes });
  ok(rv.gods.ahti.r === 50 + RV.REV.stunt, "a report that lapsed (nobody stunted) doesn't make a later smite free");
}

// ---- 2. the planner: one smite per report ----
{
  const sits = [
    { god: "wadd", nations: [{ id: 2, myReverence: 1 }] },
    { god: "ahti", nations: [{ id: 2, myReverence: 30 }] },
    { god: "anansi", nations: [{ id: 2, myReverence: 12 }, { id: 5, myReverence: 3 }] },
  ];
  const all = [
    { god: "wadd", kind: "smite", clan: 2, report: "r1", agent: "Klara", verdict: "Stunt" },
    { god: "ahti", kind: "smite", clan: 2, report: "r1", agent: "Klara", verdict: "Stunt" },
    { god: "anansi", kind: "smite", clan: 2, report: "r1", agent: "Klara", verdict: "Stunt" },
    { god: "anansi", kind: "smite", clan: 5, report: "r9", agent: "Bram", verdict: "Stunt" },
    { god: "wadd", kind: "whisper", clan: 2, text: "hello" },
    { god: "ahti", kind: "whisper", clan: 2, text: "hello too" },
  ];
  const kept = A.oneSmitePerReport(all, sits);
  const r1 = kept.filter((a) => a.kind === "smite" && a.report === "r1");
  ok(r1.length === 1 && r1[0].god === "ahti", `one smite per report survives, from the god with the most reverence there (${r1.map((a) => a.god)})`);
  ok(kept.some((a) => a.kind === "smite" && a.report === "r9"), "a smite on a different report survives");
  ok(kept.filter((a) => a.kind === "whisper").length === 2, "other actions are untouched");
  ok(A.oneSmitePerReport([], sits).length === 0, "an empty plan stays empty");
}

// ---- 3. the prompt ----
{
  const { godsPrompt } = await import("./llm.mjs");
  const sit = { god: "ahti.op", name: "Ahti", temperament: "stern", allowance: 1, wallet: 2, clans: [2], nations: [{ id: 2, name: "Salamanco creek", standing: 20, myReverence: 4, enemies: 3, mood: "content", tricksters: 2, war: null, florins: 10, looking: ["y6"] }], reports: { 2: [{ id: "r1", accused: "Klara", claim: "Klara rushed the draft", asked: true, answer: { says: "not me" } }] } };
  const p = godsPrompt([sit]);
  ok(/8 reverence/.test(p.system), "the gods are told a stunt costs 8 reverence");
  ok(/innocent/i.test(p.system) && /enem/i.test(p.system) && /fade/i.test(p.system), "the gods are told an innocent stunted becomes an enemy that speeds the fade");
  ok(/laps/i.test(p.system), "the gods are told a report may be left to lapse");
  ok(/one god/i.test(p.system), "the gods are told one god per nation is enough for a report");
  ok(/3 enem/.test(p.user), "each god sees its own enemy count in each nation");
  const aiact = fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8");
  ok(/enemies:/.test(aiact.slice(aiact.indexOf("const nations = clans.map"))), "situations() fills each nation's enemy count");
  ok(/oneSmitePerReport\(/.test(aiact.slice(aiact.indexOf("export async function planGods"))), "planGods runs every plan through oneSmitePerReport");
}

// ---- 4. the refund ----
{
  const rec = (day, clan, gods, changes) => ({ day, clan, kind: "reverence", gods, changes });
  const settled = (day, clan, accused, by, report) => ({ day, clan, kind: "report-settled", accused, by, report, outcome: "stunted", truth: true });
  const days = [
    { day: 120, records: [
      settled(120, 2, "Ilse", "anansi", "r1"),
      rec(120, 2, {}, [{ god: "anansi", d: -8, why: "stunted Ilse" }, { god: "wadd", d: -8, why: "stunted Ilse" }, { god: "ahti", d: -3, why: "stunted Ilse" }]), // ahti was at 3: the clamp took only 3
      rec(120, 9, {}, [{ god: "brahma", d: -8, why: "stunted Nobody" }]), // no report behind it: not a duplicate
    ] },
    { day: 122, records: [rec(122, 2, {}, [{ god: "ahti", d: -8, why: "stunted Ilse" }])] }, // passed 2 game days later: duplicate
    { day: 140, records: [rec(140, 2, {}, [{ god: "wadd", d: -8, why: "stunted Ilse" }])] }, // 20 game days later, no new report: not counted
    { day: 141, records: [settled(141, 2, "Ilse", "wadd", "r7"), rec(141, 2, {}, [{ god: "wadd", d: -8, why: "stunted Ilse" }, { god: "wadd", d: -8, why: "stunted Ilse" }])] }, // the same god twice: one is a duplicate
    { day: 142, records: [rec(142, 3, {}, [{ god: "tano", d: -8, why: "stunted Ilse" }])] }, // another nation's Ilse: not counted against nation 2's report
  ];
  const { refunds, count } = dupStunts(days);
  ok(refunds[2]?.wadd === 16 && refunds[2]?.ahti === 11 && !refunds[2]?.anansi, `duplicates are refunded what they really cost, never the settling stunt (wadd ${refunds[2]?.wadd}, ahti ${refunds[2]?.ahti}, anansi ${refunds[2]?.anansi})`);
  ok(!refunds[9] && !refunds[3], "a smite with no settled report behind it, or in another nation, isn't refunded");
  ok(count === 4, `4 duplicate penalties found (${count})`);

  // The 16 Nov parity reset (day 111) set every seated god to 50: losses before it in that nation were wiped already.
  const withParity = [
    { day: 100, records: [settled(100, 2, "Ilse", "anansi", "r0"), rec(100, 2, {}, [{ god: "anansi", d: -8, why: "stunted Ilse" }, { god: "wadd", d: -8, why: "stunted Ilse" }]), settled(100, 5, "Bo", "x", "r5"), rec(100, 5, {}, [{ god: "x", d: -8, why: "stunted Bo" }, { god: "y", d: -8, why: "stunted Bo" }])] },
    { day: 111, records: [{ day: 111, clan: 2, kind: "correction", changes: [{ god: "anansi", d: 4, why: "reverence back to parity (16 Nov): from 46 to 50" }], why: "A one-time reset (16 Nov): every god with a seat stands at 50 reverence, level with the rest." }] },
    ...days,
  ];
  const p = dupStunts(withParity);
  ok(p.refunds[2]?.wadd === 16 && p.count === 5, `duplicates before a nation's parity reset aren't refunded (wadd ${p.refunds[2]?.wadd}, count ${p.count})`);
  ok(p.refunds[5]?.y === 8, "a nation with no parity record keeps its earlier duplicates");

  const s = { clans: { 2: {}, 4: { fallen: { day: 130 } } }, rev: { 2: { gods: { wadd: { r: 95 }, ahti: { r: 0 }, anansi: { r: 1 } } }, 4: { gods: { x: { r: 0 } } } } };
  const onchain = [{ id: 2, alive: true, gods: [{ account: "wadd" }, { account: "ahti" }] }, { id: 4, alive: true, gods: [{ account: "x" }] }];
  const out = refundStunts(s, onchain, { 2: { wadd: 16, ahti: 11, gone: 8 }, 4: { x: 8 } });
  ok(s.rev[2].gods.wadd.r === 100 && s.rev[2].gods.ahti.r === 11, `refunds land, capped at 100 (wadd ${s.rev[2].gods.wadd.r}, ahti ${s.rev[2].gods.ahti.r})`);
  ok(!out[2].some((c) => c.god === "gone") && s.rev[4].gods.x.r === 0 && !out[4], "a god no longer seated, or a fallen nation, gets nothing");
  ok(out[2].every((c) => c.d > 0 && /stunt/.test(c.why)) && out[2].find((c) => c.god === "wadd").d === 5, "each refund is listed with what really moved and why");
  const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  ok(/revDupStunts19Nov/.test(run) && /refundStunts\(/.test(run) && /dupStunts\(/.test(run), "run.mjs applies the refund once (s.fixes.revDupStunts19Nov)");
}
