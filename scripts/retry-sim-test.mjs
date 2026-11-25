// A turn stuck at set_root, retried, on a copy of the live world (never on testnet). 24 Nov: the operator ran out of
// NEAR, set_root failed, and the engine retried the same day about 780 times. Every retry fought another war round
// (up to 353 in one day; six nations fell), rolled the heavens' fire again and logged the day's choices again.
// This plants a war and a choice, makes the stand-in chain refuse set_root 3 times, runs the turn 4 times, and
// checks the sealed day holds one round per war, one copy of the choice, and that the retries saved the once-a-day
// marks. Exits 1 on any failure. Stand-in Claude (ADF_FAKE_LLM=1): $0.
//   node scripts/retry-sim-test.mjs [dir=debug/sim-retry] [--keep]   (--keep: reuse an existing seed)
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv.slice(2).find((a) => !a.startsWith("--")) || "debug/sim-retry", H = 3600e3, M = 60e3;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };

if (!process.argv.includes("--keep") || !fs.existsSync(`${DIR}/seed.json`)) {
  const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); }
}
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
const run = (now, extra = {}) => {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ...extra, ADF_NOW: String(now) }, encoding: "utf8", maxBuffer: 64e6 });
  fs.appendFileSync(`${DIR}/retry.log`, `\n===== run at ${new Date(now).toISOString()} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
};
const sp = `${DIR}/state/testnet.json`, cp = `${DIR}/chain.json`;
const state = () => JSON.parse(fs.readFileSync(sp, "utf8"));
const chain = () => JSON.parse(fs.readFileSync(cp, "utf8"));
const dayRecs = (d) => JSON.parse(fs.readFileSync(`${DIR}/state/testnet/day-${d}.json`, "utf8"));
const recsOf = (x) => (Array.isArray(x) ? x : x.records);

// 0. A warm-up turn: a fresh copy builds its cooldown list (who took fire lately) on its first turn.
let r = run(seededAt + 1 * H);
ok(r.status === 0, `warm-up turn ran (exit ${r.status})`);

// 1. Plant a fresh war between two nations at full strength: only the attacker's council meets this turn.
const { eligible, warOf } = await import("../engine/war.mjs");
let S = state(), C = chain();
const free = C.clans.filter((c) => c.alive && S.clans[c.id] && !S.clans[c.id].fallen && eligible(S, c.id) && !warOf(S, c.id)).sort((a, b) => Number(BigInt(b.florins) - BigInt(a.florins)));
const { shield } = await import("../engine/cooldown.mjs");
const open = free.filter((c) => !shield(S, c.id, S.day + 1)); // a nation under the cooldown can't be attacked
const att = open[0], def = open[1];
ok(!!(att && def), att && def ? `planted: ${att.name} declares on ${def.name}` : "no two nations free to go to war");
if (!att || !def) process.exit(1);
for (const [id, c] of Object.entries(S.clans)) c.lastCouncilAt = Number(id) === att.id ? 0 : seededAt + 4 * H;
fs.writeFileSync(sp, JSON.stringify(S));
r = run(seededAt + 2 * H, { ADF_FAKE_WAR: `${att.id}:${def.id}` });
ok(r.status === 0, `turn 1 ran (exit ${r.status})`);
S = state();
const war = Object.values(S.wars || {}).find((w) => w.status === "on" && [w.a, w.b].includes(att.id) && [w.a, w.b].includes(def.id));
ok(!!war, `the war is on after turn 1${war ? ` (${war.id}, round ${war.rounds})` : ""}`);
if (!war) process.exit(1);
const roundsBefore = Object.fromEntries(Object.values(S.wars).filter((w) => w.status === "on").map((w) => [w.id, w.rounds || 0]));

// 2. Plant a choice for turn 2 (a pitch with no point: same as silence, it only has to be logged once).
const day2 = S.day + 1;
process.env.ADF_STATE_DIR = `${DIR}/state`; process.env.DATABASE_URL = "";
const store = await import("../engine/store.mjs");
await store.putChoice("testnet", { day: day2, clan: att.id, kind: "pitch", account: "retry-test.testnet", payload: { point: null } });
// And a refunded seat buy the loop settled, waiting to be sealed as a record by the scheduled turn.
const seatsPath = `${DIR}/state/seats.json`, seats = fs.existsSync(seatsPath) ? JSON.parse(fs.readFileSync(seatsPath, "utf8")) : { next: 1, seats: [], buys: [] };
seats.buys.push({ net: "testnet", tx: "retry-test-buy", listing: 999999, buyer: "retry-test.testnet", amount: "500000000000000000000000", status: "refunded", result: { why: "test: the seat was gone", refund: "retry-test-refund" }, at: Date.now() });
fs.writeFileSync(seatsPath, JSON.stringify(seats));

// 3. Turn 2: set_root refused 3 times, then accepted. Each retry comes 5 minutes after the last.
C = chain(); C.rootFails = 0; fs.writeFileSync(cp, JSON.stringify(C));
for (let j = 0; j < 4; j++) {
  r = run(seededAt + 4 * H + j * 5 * M, { ADF_SIM_FAIL_ROOT: "3" });
  if (j < 3) {
    ok(r.status !== 0 && /set_root refused/.test(r.stderr + r.stdout), `try ${j + 1}: set_root refused, the turn failed (exit ${r.status})`);
    const once = state().inProgress?.once || {};
    ok(state().inProgress?.day === day2 && once.war === true && once.fire === true, `try ${j + 1}: the day is saved as in progress with war and fire marked done (${JSON.stringify(once)})`);
  } else ok(r.status === 0, `try 4: set_root accepted, the turn sealed (exit ${r.status})`);
}

// 4. The sealed day.
const recs = recsOf(dayRecs(day2));
S = state();
const battles = {};
for (const x of recs.filter((x) => x.kind === "battle")) battles[x.war] = (battles[x.war] || 0) + 1;
ok(Object.keys(battles).length > 0, `the day has battles (${JSON.stringify(battles)})`);
ok(Object.values(battles).every((n) => n === 1), `exactly one battle per war on day ${day2}`);
for (const [id, before] of Object.entries(roundsBefore)) {
  const w = S.wars[id];
  ok(w.status !== "on" || (w.rounds || 0) === before + 1, `${id}: rounds ${before} -> ${w.rounds} (${w.status})`);
}
const fallen = recs.filter((x) => x.kind === "fallen").length;
ok(fallen <= Object.keys(roundsBefore).length, `falls on day ${day2}: ${fallen}`);
const planted = recs.filter((x) => x.kind === "choice" && x.god === "retry-test.testnet");
ok(planted.length === 1, `the planted choice is logged once (${planted.length})`);
const refunds = recs.filter((x) => x.kind === "seat-refund" && x.paid_with === "retry-test-buy").length;
ok(refunds === 1, `the planted seat refund is logged once (${refunds})`);
ok(JSON.parse(fs.readFileSync(seatsPath, "utf8")).buys.find((b) => b.tx === "retry-test-buy")?.sealed === true, "and marked sealed once the day sealed");
const skies = recs.filter((x) => x.kind === "fire" && x.cause !== "god" && x.cause !== "bully").length;
ok(skies <= 1, `the heavens' own fire at most once (${skies})`);
ok(!S.inProgress, "the day is sealed: nothing in progress");
ok(chain().roots[day2] != null, `the stand-in chain holds day ${day2}'s root`);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
