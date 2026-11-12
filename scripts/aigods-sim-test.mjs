// Phase D on a copy of the live world (never testnet): every seat but North Pole's goes to an AI god, then for
// several turns the AI gods plan (stand-in minds, $0), every planned action is sent through the same code the
// live loop uses (engine/aiact.mjs runDue on the stand-in chain), and the world answers with an instant turn.
// Passes only if the fallen-away nations' reverence for their gods rises, nothing errors, no money leaves.
//   node scripts/aigods-sim-test.mjs [dir=debug/sim-ai] [turns=6] [--keep]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv.find((a, i) => i > 1 && !a.startsWith("--") && isNaN(Number(a))) || "debug/sim-ai";
const TURNS = Number(process.argv.find((a, i) => i > 1 && !isNaN(Number(a)))) || 6, H = 3600e3;
if (!process.argv.includes("--keep") || !fs.existsSync(`${DIR}/seed.json`)) {
  fs.rmSync(DIR, { recursive: true, force: true });
  const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
  if (r.status !== 0) { console.log(r.stdout, r.stderr); process.exit(1); }
}
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
Object.assign(process.env, env);
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const run = (args, at) => {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", ...args], { env: { ...env, ADF_NOW: String(at) }, encoding: "utf8", maxBuffer: 64e6 });
  fs.appendFileSync(`${DIR}/ai.log`, `\n===== ${args.join(" ")} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); }
  return r.stdout;
};
const C = () => JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
const ST = () => JSON.parse(fs.readFileSync(`${DIR}/state/testnet.json`, "utf8"));
fs.writeFileSync(`${DIR}/ai.log`, "");

run(["--force"], seededAt + 2 * H); // settle in
// The takeover, on the copy: each seat (but North Pole's) to a new AI god, stake and all.
const store = await import("../engine/store.mjs");
const A = await import("../engine/aigods.mjs");
const { nameFor } = await import("../engine/godnames.mjs");
const { runDue, temperamentOf } = await import("../engine/aiact.mjs");
const { connectSim } = await import("../engine/chain-sim.mjs");
const chainJ = C(), taken = new Set();
const moved = [];
for (const c of chainJ.clans.filter((x) => x.alive && !/^north pole$/i.test(x.name))) {
  for (const g of c.gods) {
    const name = nameFor(`${c.id}|${g.account}`, taken); taken.add(name);
    const to = A.accountFor(name, "sim-operator");
    const st = chainJ.stakes?.[`${c.id}|${g.account}`];
    if (st) chainJ.stakes[`${c.id}|${to}`] = st;
    moved.push({ clan: c.id, from: g.account, to });
    g.account = to;
    await store.addAiGod("testnet", to, name, temperamentOf(name));
    await store.claimGodName(to, name);
  }
}
fs.writeFileSync(`${DIR}/chain.json`, JSON.stringify(chainJ));
console.log(`moved ${moved.length} seats to AI gods on the copy`);
// Their reverence as they take over (the engine carries a moved god's reverence by its stake).
run(["--instant", chainJ.clans.filter((c) => c.alive).map((c) => c.id).join(",")], seededAt + 2 * H + 60e3);
const revOf = () => { const s = ST(); const out = {}; for (const m of moved) out[`${m.clan}|${m.to}`] = s.rev?.[m.clan]?.gods?.[m.to]?.r ?? 0; return out; };
const standingOf = () => { const s = ST(); const out = {}; for (const c of chainJ.clans) { const rv = s.rev?.[c.id]; if (rv) out[c.id] = rv.followed ? rv.gods?.[rv.followed]?.r ?? 0 : 0; } return out; };
const start = revOf(), startStanding = standingOf();
const fallen = Object.entries(start).filter(([, r]) => r < 30).map(([k]) => k);

let sent = 0, errors = [], notAllowed = 0, planned = 0;
for (let k = 2; k < 2 + TURNS; k++) {
  const out = run(["--force"], seededAt + k * 2 * H); // a scheduled turn: ends by planning the AI gods' two hours
  planned += Number(out.match(/AI gods: (\d+) actions planned/)?.[1] || 0);
  // Every planned action, sent the way the live loop sends them (time skipped ahead).
  const chain = connectSim(`${DIR}/chain.json`);
  const logs = [];
  await runDue({ net: "testnet", chain, now: Number.MAX_SAFE_INTEGER, limit: 1000, log: (s) => logs.push(s) });
  for (const l of logs) { sent++; if (/error/.test(l)) errors.push(l); if (/not allowed/i.test(l)) notAllowed++; }
  const ids = C().clans.filter((c) => c.alive).map((c) => c.id).join(",");
  run(["--instant", ids, "--no-research", ids], seededAt + k * 2 * H + H); // as the live loop does after AI actions
}
const end = revOf(), endStanding = standingOf();
const s = ST();
const errRecords = fs.readdirSync(`${DIR}/state/testnet`).filter((f) => /^day-\d+\.json$/.test(f)).flatMap((f) => (JSON.parse(fs.readFileSync(`${DIR}/state/testnet/${f}`, "utf8")).records || []).filter((r) => r.kind === "error" && r.day > ST().day - TURNS - 2));
const avg = (o, keys) => keys.reduce((a, k) => a + (o[k] || 0), 0) / Math.max(1, keys.length);
console.log(`planned ${planned}, sent ${sent}, errors ${errors.length}`);
ok(planned > 0 && sent === planned, `every planned action was sent (${sent} of ${planned})`);
ok(errors.length === 0, `no action failed (${errors.slice(0, 3).join(" | ") || "none"})`);
ok(notAllowed === 0, "no AI god ever tried to take money out");
ok(errRecords.length === 0, `no error records in the world (${errRecords.slice(0, 2).map((r) => r.error).join(" | ") || "none"})`);
const aiNations = new Set(moved.map((m) => m.clan));
ok(C().clans.filter((c) => aiNations.has(c.id)).every((c) => c.alive || s.clans[c.id]?.fallen), "no nation under AI gods ended, except by falling in war");
ok(avg(end, fallen) > avg(start, fallen) + 5, `the fallen-away nations' reverence for their AI gods rose: average ${avg(start, fallen).toFixed(1)} -> ${avg(end, fallen).toFixed(1)} over ${TURNS} turns (${fallen.length} seats under 30)`);
for (const m of moved) console.log(`   ${String(m.clan).padStart(2)} ${m.to.split(".")[0].padEnd(14)} ${String(start[`${m.clan}|${m.to}`]?.toFixed?.(1) ?? 0).padStart(5)} -> ${String(end[`${m.clan}|${m.to}`]?.toFixed?.(1) ?? 0).padStart(5)}   nation standing ${(startStanding[m.clan] ?? 0).toFixed?.(1)} -> ${(endStanding[m.clan] ?? 0).toFixed?.(1)}`);
console.log(bad ? `${bad} FAILED` : "ALL PASS");
await store.close();
process.exitCode = bad ? 1 : 0;
