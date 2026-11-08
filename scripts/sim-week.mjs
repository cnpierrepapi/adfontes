// The fast-forward simulation (his call 8 Nov): a week of the world (84 turns of 2 hours) run by the
// real engine, locally, on a copy of the live testnet world (scripts/sim-seed.mjs), never on testnet.
// The war councils and Brokers think with Claude; research and drafts use the engine's stand-ins
// (ADF_FAKE_LLM=research), so it stays inside the $0.50 a day cap. The engine's clock is simulated
// (engine/simclock.mjs): drafts, upkeep, councils, techs and NEAR's day and night all happen as they
// would over 7 days.   node scripts/sim-week.mjs [turns=84] [--gods] [--dir debug/sim]
// --gods: simulated gods visit between turns (scripts/sim-gods.mjs); without it the world is godless.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { godsTurn, rng } from "./sim-gods.mjs";

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const TURNS = Number(argv.find((a) => /^\d+$/.test(a))) || 84, H = 3600e3;
const DIR = opt("--dir") || "debug/sim", GODS = argv.includes("--gods");
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
const rand = rng(seededAt % 2 ** 31);
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "" }; // real Claude for everything (his OK 8 Nov); the live cap is untouched
if (argv.includes("--fake")) env.ADF_FAKE_LLM = "1"; else delete env.ADF_FAKE_LLM; // --fake: stand-in minds, $0 (smoke tests)
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
const log = fs.createWriteStream(`${DIR}/run.log`);
const godLog = GODS ? fs.createWriteStream(`${DIR}/gods.log`) : null;
const t0 = Date.now();
for (let k = 1; k <= TURNS; k++) {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 });
  log.write(`\n===== sim turn ${k} (${new Date(seededAt + k * 2 * H).toISOString()}) exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  const spend = /today \(UTC\): \$([\d.]+)/.exec(r.stdout)?.[1];
  const notable = (r.stdout.match(/\[(war|fallen|peace|fortify|tech|council|trade|broker)\][^\n]{0,110}/g) || []).map((x) => x.replace(/\{"kind":"[a-z-]+",?/, "")).slice(0, 4);
  console.log(`turn ${String(k).padStart(2)}/${TURNS} exit ${r.status} | spend today $${spend ?? "?"} | ${((Date.now() - t0) / 60000).toFixed(1)} min${notable.length ? "\n    " + notable.join("\n    ") : ""}`);
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); break; }
  // Simulated gods act between turns; the next turn reads them off the stand-in chain.
  if (GODS) {
    const did = godsTurn(DIR, seededAt + k * 2 * H + H, rand);
    for (const d of did) godLog.write(`turn ${k} ${JSON.stringify(d)}\n`);
    const v = did.filter((d) => d.blessed).length, ch = did.filter((d) => d.change);
    if (v || ch.length) console.log(`    gods: ${v} visit(s)${ch.length ? "; " + ch.map((d) => `nation ${d.clan} god ${d.god} ${d.change} at ${d.standing}`).join("; ") : ""}`);
  }
}
godLog?.end();
log.end();
