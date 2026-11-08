// The fast-forward simulation (his call 8 Nov): a week of the world (84 turns of 2 hours) run by the
// real engine, locally, on a copy of the live testnet world (scripts/sim-seed.mjs), never on testnet.
// The war councils and Brokers think with Claude; research and drafts use the engine's stand-ins
// (ADF_FAKE_LLM=research), so it stays inside the $0.50 a day cap. The engine's clock is simulated
// (engine/simclock.mjs): drafts, upkeep, councils, techs and NEAR's day and night all happen as they
// would over 7 days.   node scripts/sim-week.mjs [turns=84]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TURNS = Number(process.argv[2]) || 84, H = 3600e3;
const { seededAt } = JSON.parse(fs.readFileSync("debug/sim/seed.json", "utf8"));
const env = { ...process.env, ADF_SIM_CHAIN: "debug/sim/chain.json", ADF_STATE_DIR: "debug/sim/state", ADF_DAILY_CAP: "50", DATABASE_URL: "" }; // real Claude for everything (his OK 8 Nov); the live cap is untouched
delete env.ADF_FAKE_LLM;
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
const log = fs.createWriteStream("debug/sim/run.log");
const t0 = Date.now();
for (let k = 1; k <= TURNS; k++) {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 });
  log.write(`\n===== sim turn ${k} (${new Date(seededAt + k * 2 * H).toISOString()}) exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  const spend = /today \(UTC\): \$([\d.]+)/.exec(r.stdout)?.[1];
  const notable = (r.stdout.match(/\[(war|fallen|peace|fortify|tech|council|trade|broker)\][^\n]{0,110}/g) || []).map((x) => x.replace(/\{"kind":"[a-z-]+",?/, "")).slice(0, 4);
  console.log(`turn ${String(k).padStart(2)}/${TURNS} exit ${r.status} | spend today $${spend ?? "?"} | ${((Date.now() - t0) / 60000).toFixed(1)} min${notable.length ? "\n    " + notable.join("\n    ") : ""}`);
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); break; }
}
log.end();
