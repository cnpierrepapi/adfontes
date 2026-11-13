// PLAN_13NOV steps 0-1 end to end, on a copy of the live world (never testnet), stand-in minds ($0): a god's
// pitch pick for the next turn makes that nation's Scholars research exactly that point, and the choice is sealed
// in the turn's records. Exits 1 on any failure.   node scripts/choices-sim-test.mjs [dir=debug/sim-choice]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "debug/sim-choice", H = 3600e3;
fs.rmSync(DIR, { recursive: true, force: true });
const seed = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
if (seed.status !== 0) { console.log(seed.stdout, seed.stderr); process.exit(1); }
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
Object.assign(process.env, env);
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const turn = (k) => { const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 }); if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); } return r.stdout; };
const ST = () => JSON.parse(fs.readFileSync(`${DIR}/state/testnet.json`, "utf8"));

turn(1);
const store = await import("../engine/store.mjs");
const { pitchOf } = await import("../engine/world.mjs");
let s = ST();
// A nation with Scholars at work and three points to pitch.
const C = JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
const id = C.clans.filter((c) => c.alive && s.clans[c.id] && !s.clans[c.id].fallen && !s.clans[c.id].waiting).map((c) => c.id).find((cid) => pitchOf(s.clans[cid], `${s.day + 1}|${cid}`).length === 3);
const pitch = pitchOf(s.clans[id], `${s.day + 1}|${id}`), pick = pitch[2];
await store.putChoice("testnet", { day: s.day + 1, clan: id, kind: "pitch", account: C.clans.find((c) => c.id === id).gods[0].account, payload: { point: pick } });
console.log(`nation ${id}, pitch ${JSON.stringify(pitch)}, the god picks "${pick}"`);
turn(2);
s = ST();
const dayJ = JSON.parse(fs.readFileSync(`${DIR}/state/testnet/day-${s.day}.json`, "utf8"));
const recs = Array.isArray(dayJ) ? dayJ : dayJ.records || []; // a day file is a plain list of records
const mine = recs.filter((r) => r.kind === "corpus" && r.clan === id);
ok(recs.some((r) => r.kind === "choice" && r.clan === id && r.choice === "pitch" && r.payload?.point === pick), "the choice is sealed in the turn's records");
ok(mine.length > 0 && mine[0].point === pick, `the nation's first research of the turn is the god's pick (${mine.map((r) => r.point).join(", ") || "no research"})`);
ok(!recs.some((r) => r.kind === "error"), `no error records (${recs.filter((r) => r.kind === "error").map((r) => r.error).join(" | ") || "none"})`);
console.log(bad ? `${bad} FAILED` : "ALL PASS");
await store.close();
process.exitCode = bad ? 1 : 0;
