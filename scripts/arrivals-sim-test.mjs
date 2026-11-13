// Phase E through the engine's turns, on a copy of the live world (never testnet), stand-in minds ($0): the first
// --arrive only schedules; when the time comes a newcomer arrives (record pending, AI god registered, next one
// scheduled); a founded nation gets its start from the next turn like any other; the record is sealed with the day.
//    node scripts/arrivals-sim-test.mjs [dir=debug/sim-arrivals]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "debug/sim-arrivals", H = 3600e3;
fs.rmSync(DIR, { recursive: true, force: true });
const seed = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
if (seed.status !== 0) { console.log(seed.stdout, seed.stderr); process.exit(1); }
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
Object.assign(process.env, env);
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const run = (args, k) => { const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", ...args], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 }); if (r.status !== 0) { console.log(r.stdout.slice(-1500), r.stderr.slice(-1500)); process.exit(1); } return r.stdout; };
const STF = `${DIR}/state/testnet.json`, CHF = `${DIR}/chain.json`;
const ST = () => JSON.parse(fs.readFileSync(STF, "utf8"));
const save = (s) => fs.writeFileSync(STF, JSON.stringify(s));

run(["--force"], 1);
const store = await import("../engine/store.mjs");
const AR = await import("../engine/arrivals.mjs");
const nBefore = JSON.parse(fs.readFileSync(CHF, "utf8")).clans.length, aiBefore = (await store.aiGods("testnet")).length;
const out0 = run(["--arrive"], 1.1);
let s = ST();
ok(!!s.arrivals && s.arrivals.n === 0 && /next arrival/.test(out0), "the first --arrive only sets the schedule");
ok(!(s.pending || []).some((r) => r.kind === "arrival"), "nobody arrives yet");
// Its time has come.
s.arrivals.last -= 7 * H; save(s);
const p0 = (ST().pending || []).length;
run(["--arrive"], 1.2);
s = ST();
const rec = (s.pending || []).slice(p0).find((r) => r.kind === "arrival");
ok(!!rec && rec.name && (rec.found ? !!rec.nation : rec.clan != null), `a newcomer arrived: ${rec ? `${rec.name} ${rec.found ? `founded ${rec.nation}` : `blessed nation ${rec.clan}`}` : "none"}`);
ok(s.arrivals.n === 1 && AR.nextAt(s.arrivals) - s.arrivals.last >= AR.ARRIVE.minGapMs, "the next arrival is scheduled at least 30 min on");
ok((await store.aiGods("testnet")).length === aiBefore + 1, "registered as an AI god");
const C = JSON.parse(fs.readFileSync(CHF, "utf8"));
if (rec?.found) ok(C.clans.length === nBefore + 1 && C.clans.at(-1).gods[0].account === rec.god, "its nation is on the chain with it as god");
const p1 = (ST().pending || []).length;
run(["--arrive"], 1.25);
ok((ST().pending || []).length === p1, "not due again straight away: nobody else arrives");
// The next turn: a founded nation gets its start; the arrival is sealed with the day.
run(["--force"], 2);
s = ST();
if (rec?.found) ok(!!s.clans[C.clans.at(-1).id], "the new nation got its start like any other (citizens, mind)");
const day = s.day, recs = (await store.getDay("testnet", day)).records || [];
ok(recs.some((r) => r.kind === "arrival" && r.name === rec?.name), `the arrival is sealed in day ${day}'s records`);
ok(!recs.some((r) => r.kind === "error"), `no errors (${recs.filter((r) => r.kind === "error").map((r) => r.error).join(" | ").slice(0, 300)})`);
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
