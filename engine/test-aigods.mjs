// Phase D (12 Nov, written before engine/aigods.mjs): AI gods. His rules: they work to RECOVER the nations
// that fell away (reverence, Tricksters, hunger), and they can NEVER take their stake out: a nation under AI
// gods only ends by falling in war. Their actions trickle out over the 2 h between turns.
import * as A from "./aigods.mjs";
import * as C from "../src/live/calls.js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(String(e.message || e)); } };
const W = "w6.adf-pool1-hf0w8.testnet", DAO = "adf-helios-1.sputnikv2.testnet";

// 1. The guard: no way to take money out.
const power = (m, a) => C.daoPower(W, DAO, 10n ** 22n, m, a, "AD FONTES: test");
ok(!throws(() => A.guard(C.bless(W, 1, 10n ** 23n))), "bless passes the guard");
ok(["whisper", "smite", "rule", "root_out"].every((m) => power(m, { clan_id: 1 }).every((c) => !throws(() => A.guard(c.bind ? c.bind(7) : c)))), "whisper, smite, rule and root_out motions (and their yes votes) pass");
for (const [label, call] of [["withdraw", C.withdraw(W, 1)], ["claim_owed", C.claimOwed(W)], ["found_clan", C.found(W, "X", 6n * 10n ** 24n)], ["join_dao", C.joinDao(W, 1, 10n ** 22n)]])
  ok(throws(() => A.guard(call), /not allowed/i), `${label} is refused: an AI god can't take money out or leave`);
ok(throws(() => A.guard(power("release_staking", { clan_id: 1 })[0]), /not allowed/i), "a motion to release the staking fund is refused");
ok(throws(() => A.guard({ receiver: W, method: "transfer", args: {}, deposit: 1n }), /not allowed/i) && throws(() => A.guard({ receiver: "someone.testnet", method: "bless", args: {}, deposit: 1n }), /not allowed/i), "anything else, or the right method sent elsewhere, is refused");

// 2. The plan Claude writes is checked before anything is sent.
const sit = {
  god: "odin.adfontes-mw1fjpfx.testnet", allowance: 1.0, clans: [1, 2],
  reports: { 1: [{ id: "r51-1", accused: "Mira Oyama" }] }, gifts: { 2: [{ id: 19 }] }, aogToday: 0,
};
const plan = [
  { kind: "whisper", clan: 1, text: "Feed the hungry first; the papers can wait an hour.".repeat(10) },
  { kind: "bless", clan: 2, near: 0.6 }, { kind: "bless", clan: 2, near: 0.7 },
  { kind: "smite", clan: 1, report: "r51-1", verdict: "Stunt" }, { kind: "smite", clan: 1, report: "r99-9", verdict: "Kill" },
  { kind: "rule", clan: 2, gift: 19, reward: true }, { kind: "rule", clan: 2, gift: 77, reward: true },
  { kind: "whisper", clan: 5, text: "not mine" }, { kind: "withdraw", clan: 1 },
  { kind: "fire", clan: 1, target: 6 }, { kind: "fire", clan: 1, target: 7 }, { kind: "fire", clan: 1, target: 1 },
];
const v = A.validatePlan(plan, sit);
ok(v.every((a) => sit.clans.includes(a.clan)), "only nations this god holds");
ok(!v.some((a) => a.kind === "withdraw"), "an action outside the list never gets through");
ok(v.filter((a) => a.kind === "smite").length === 1 && v.find((a) => a.kind === "smite").agent === "Mira Oyama", "smite only an accused from an open report (named from the report, not the plan)");
ok(v.filter((a) => a.kind === "rule").length === 1, "rule only gifts that are open");
ok(v.filter((a) => a.kind === "bless").reduce((s, a) => s + a.near, 0) <= sit.allowance + 1e-9, "blessings stay within the day's allowance");
ok(v.find((a) => a.kind === "whisper").text.length <= 280, "a whisper is cut to 280 characters");
ok(v.filter((a) => a.kind === "fire").length === 1 && v.find((a) => a.kind === "fire").target === 6, "one Act of God a day at most, never on its own nation");

// 3. The trickle: spread over the 2 h to the next turn.
const start = 1_000_000, span = 2 * 3600e3;
const many = Array.from({ length: 130 }, (_, i) => ({ god: `g${i % 15}`, kind: "bless", clan: 1 }));
const s1 = A.schedule(many, start, span, "seed-a");
const gaps = s1.slice(1).map((x, i) => x.at - s1[i].at);
ok(s1.length === 130 && s1.every((x) => x.at >= start && x.at < start + span), "every action lands inside the 2 hours");
ok(Math.max(...gaps) <= 60e3 && s1[0].at - start <= 60e3, `with 130 actions, never a minute without one (longest gap ${(Math.max(...gaps) / 1000).toFixed(0)} s)`);
const byGod = {}; for (const x of s1) (byGod[x.god] ||= []).push(x.at);
ok(Object.values(byGod).every((t) => t.slice(1).every((at, i) => at - t[i] >= 20e3)), "one god's actions are at least 20 s apart (its transactions never collide)");
ok(JSON.stringify(A.schedule(many, start, span, "seed-a")) === JSON.stringify(s1) && JSON.stringify(A.schedule(many, start, span, "seed-b")) !== JSON.stringify(s1), "the same seed gives the same times (replayable); another seed differs");
const few = A.schedule(many.slice(0, 20), start, span, "s");
ok(few.every((x) => x.at < start + span) && Math.min(...few.slice(1).map((x, i) => x.at - few[i].at)) > 60e3, "with only 20, they spread out rather than bunching");

// 4. Their accounts and keys.
ok(A.accountFor("Ahura Mazda", "adfontes-mw1fjpfx.testnet") === "ahura-mazda.adfontes-mw1fjpfx.testnet" && A.accountFor("Chang'e", "op.testnet") === "change.op.testnet", "an AI god's account is its name, made safe for NEAR");
const k1 = A.godSeed("opkey", W, "odin.op.testnet"), k2 = A.godSeed("opkey", W, "odin.op.testnet"), k3 = A.godSeed("opkey", W, "thor.op.testnet");
ok(Buffer.compare(k1, k2) === 0 && Buffer.compare(k1, k3) !== 0 && k1.length === 32, "a god's key comes from the operator key: the same every time, different per god");

// 5. Recovery first.
const nations = [
  { id: 1, standing: 45, tricksters: 0, mood: "content", openGifts: 0 },
  { id: 2, standing: 0, tricksters: 2, mood: "hungry", openGifts: 1 },
  { id: 3, standing: 12, tricksters: 1, mood: "hungry", openGifts: 0 },
  { id: 4, standing: 28, tricksters: 0, mood: "content", openGifts: 0 },
];
const order = A.recoveryOrder(nations).map((n) => n.id);
ok(order[0] === 2 && order[1] === 3 && order.indexOf(1) === 3, `the most fallen-away nation comes first (${order})`);
const fake = A.fakePlan({ god: "odin.op.testnet", allowance: 1, clans: [2, 3], nations: nations.filter((n) => [2, 3].includes(n.id)), reports: { 2: [{ id: "r1", accused: "X" }] }, gifts: { 2: [{ id: 5, warden_passed: true }] } });
ok(fake.some((a) => a.kind === "rule" && a.gift === 5) && fake.some((a) => a.kind === "whisper" && a.clan === 2) && fake.some((a) => a.kind === "bless" && a.clan === 2), "the stand-in plan (no Claude) rules the waiting gift, whispers and feeds the hungriest nation first");

// 6. A send that errors (12 Nov, v2d proof: a 500 from the RPC on a motion that HAD landed): look before
//    giving up; if it landed, carry on; if not, send once more; only then fail.
{
  const sleep = async () => {};
  let sent = 0;
  const r1 = await A.sendChecked({ send: async () => { sent++; throw new Error("Internal server error"); }, landed: async () => ({ value: 7 }), sleep });
  ok(r1.value === 7 && sent === 1, "a send that errored but landed counts as done (no second send)");
  sent = 0; let n = 0;
  const r2 = await A.sendChecked({ send: async () => { sent++; if (sent === 1) throw new Error("timeout"); return { value: 8 }; }, landed: async () => null, sleep });
  ok(r2.value === 8 && sent === 2, "a send that didn't land is sent once more");
  sent = 0;
  let threw = false;
  try { await A.sendChecked({ send: async () => { sent++; throw new Error("Internal server error"); }, landed: async () => null, sleep }); } catch { threw = true; }
  ok(threw && sent === 2, "twice failed and never landed: it fails (and says so)");
  threw = false; sent = 0;
  try { await A.sendChecked({ send: async () => { sent++; throw new Error("Smart contract panicked: Not a god"); }, landed: async () => null, sleep }); } catch { threw = true; }
  ok(threw && sent === 1, "a refusal from the contract isn't retried");
}

// 7. Cost guards (12 Nov): every whisper costs a Claude call when the citizens judge it, so an AI god whispers at
//    most 2 times a turn and 8 times a UTC day; and an instant turn its action triggers doesn't research.
{
  const sitW = { god: "odin.op.testnet", allowance: 1, clans: [1], reports: {}, gifts: {}, aogToday: 0, whispersToday: 7 };
  const many = Array.from({ length: 5 }, (_, i) => ({ kind: "whisper", clan: 1, text: `word ${i}` }));
  ok(A.validatePlan(many, { ...sitW, whispersToday: 0 }).length === 2, "at most 2 whispers a turn");
  ok(A.validatePlan(many, sitW).length === 1, "at most 8 a day (7 already today: 1 more)");
  ok(A.validatePlan(many, { ...sitW, whispersToday: 8 }).length === 0, "none once the day's 8 are used");
  const fs = await import("node:fs");
  const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8"), loop = fs.readFileSync(new URL("./loop.mjs", import.meta.url), "utf8"), act = fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8");
  ok(/--no-research/.test(run) && /NO_RESEARCH\.has\(oc\.id\)/.test(run), "run.mjs skips research for nations named in --no-research");
  ok(/aiTouched/.test(loop) && /--no-research/.test(loop), "the loop names the nations an AI god just acted on, so their instant turn skips research");
  ok(/whispersToday/.test(act), "the planner counts each god's whispers today");
}
// 8. The always-on loop reads the AI gods' queue all day, so it must never close the database (12 Nov: it did,
//    after startup, and every tick then failed with "Cannot use a pool after calling end on the pool").
{
  const fs = await import("node:fs");
  const loop = fs.readFileSync(new URL("./loop.mjs", import.meta.url), "utf8");
  ok(!/store\.close\(\)/.test(loop), "loop.mjs keeps its database open (it sends the AI gods' actions)");
}
// 9. The chain is the record (12 Nov: the live database can't be reached from outside Railway): the engine
//    finds AI gods on chain (a seat held by <a god's name>.<operator>), registers them and fixes their names.
{
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-disc-"));
  process.env.ADF_STATE_DIR = dir; process.env.DATABASE_URL = "";
  const store = await import("./store.mjs?disc"), { discoverAiGods } = await import("./aiact.mjs");
  const op = "adfontes-mw1fjpfx.testnet";
  const chain = { operator: op, clans: async () => [
    { id: 1, alive: true, gods: [{ account: `lugh.${op}` }, { account: "olive-codex-852.adf-pool1-hf0w8.testnet" }] },
    { id: 2, alive: true, gods: [{ account: `ahura-mazda.${op}` }, { account: `trader2.${op}` }, { account: `nobody-known.${op}` }] },
  ] };
  const found = await discoverAiGods({ net: "testnet", chain, store });
  ok(found.map((g) => g.name).sort().join(",") === "Ahura Mazda,Lugh", `AI gods found on chain by their account names (${found.map((g) => g.name)})`);
  ok(!found.some((g) => /trader|olive|nobody/.test(g.account)), "agent wallets, human gods and unknown names aren't AI gods");
  const again = await discoverAiGods({ net: "testnet", chain, store });
  ok(again.length === 0 && (await store.aiGods("testnet")).length === 2, "finding them twice registers nothing twice");
  ok((await store.godNames([`lugh.${op}`]))[`lugh.${op}`] === "Lugh", "an AI god shows under its own god name");
  fs.rmSync(dir, { recursive: true, force: true });
}
// 10. New AI gods start at once (12 Nov: the takeover landed ~85 min before the next turn, and the nations are
//     hungry): when the loop finds new AI gods on chain, it plans their two hours straight away (run.mjs --plan-only).
{
  const fs = await import("node:fs");
  const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8"), loop = fs.readFileSync(new URL("./loop.mjs", import.meta.url), "utf8");
  ok(/--plan-only/.test(run) && /PLAN_ONLY[\s\S]{0,400}planGods\(/.test(run), "run.mjs --plan-only plans the AI gods and touches nothing else");
  ok(/planNow = true/.test(loop) && /"--plan-only"/.test(loop), "the loop asks for a plan as soon as it finds new AI gods");
}
// 11. An AI god keeps its own name even if the website named the account first (12 Nov: the site gave the new
//     accounts random pool names before the engine claimed theirs: Jupiter instead of Lugh).
{
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-name-"));
  process.env.ADF_STATE_DIR = dir; process.env.DATABASE_URL = "";
  const store = await import("./store.mjs?name"), { discoverAiGods } = await import("./aiact.mjs?name");
  const op = "adfontes-mw1fjpfx.testnet", acct = `lugh.${op}`;
  await store.godNames([acct]); // the website got there first
  const chain = { operator: op, clans: async () => [{ id: 1, alive: true, gods: [{ account: acct }] }] };
  await discoverAiGods({ net: "testnet", chain, store });
  ok((await store.godNames([acct]))[acct] === "Lugh", `the AI god shows as Lugh, not the name the site picked first`);
  await store.addAiGod("testnet", acct, "Lugh", "devout");
  await store.godNames([`x.${op}`]);
  ok((await store.godNames([acct]))[acct] === "Lugh", "and keeps it");
  fs.rmSync(dir, { recursive: true, force: true });
}
// 12. The AI gods plan with Haiku 5.5 (his call 13 Nov, after scripts/gods-model-eval.mjs: same whisper quality
//     as Sonnet with the v2 prompt, every god planned, ~5x cheaper, fits the gods' $0.25 a day).
{
  const { CFG } = await import("./config.mjs");
  ok(CFG.godModel === "claude-haiku-5-5", `the AI gods plan with Haiku 5.5 (${CFG.godModel})`);
}
// 13. Gifts the Warden passed are always rewarded (13 Nov: Haiku ruled only 75% of waiting gifts in the eval, and
//     an unruled gift costs its gods reverence). Code adds the ruling; the god still signs it like any motion.
//     Gifts the Warden failed are left to the god.
{
  const sitG = { god: "odin.op", allowance: 1, clans: [1, 2], reports: {}, gifts: { 1: [{ id: 7, warden_passed: true }, { id: 8, warden_passed: false }], 2: [{ id: 9, warden_passed: true }] }, aogToday: 0 };
  const plan = [{ kind: "whisper", clan: 1, text: "hold" }, { kind: "rule", clan: 2, gift: 9, reward: true }];
  const out = A.withPassedGifts(A.validatePlan(plan, sitG), sitG);
  ok(out.some((a) => a.kind === "rule" && a.gift === 7), "a passed gift the plan forgot is ruled anyway");
  ok(out.filter((a) => a.kind === "rule" && a.gift === 9).length === 1, "a passed gift the plan already rules isn't ruled twice");
  ok(!out.some((a) => a.gift === 8), "a gift the Warden failed is left to the god");
  ok(out.find((a) => a.gift === 7)?.reward === true, "the ruling rewards it");
  const fs = await import("node:fs");
  ok(/withPassedGifts\(A\.validatePlan\(/.test(fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8")), "planGods adds the passed gifts to every god's plan");
}
