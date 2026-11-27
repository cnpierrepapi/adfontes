// No ring-fence (his call 27 Nov): every florin a nation holds is its own to spend, including the NEAR the
// world granted its founder god on 9 Nov. Checked on a copy of the live world (never on testnet), with stand-in
// minds (ADF_FAKE_LLM=1, $0):
//   1. the copy keeps the live world's fallen nations fallen (scripts/sim-seed.mjs used to drop the flag);
//   2. the heavens' hoard fire picks and burns from ALL of a nation's florins: the richest nation at peace is
//      given a grant worth 30% of its florins, the hoard line is lowered so the fire must fall, and the burn
//      must be worked out from its full florins (with a fence it either picks another nation or burns less);
//   3. the copy's own API says spendable = florins for every nation.
// Exits 1 on any failure.   node scripts/fence-sim-test.mjs [dir=debug/sim-fence] [--keep]
import fs from "node:fs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const DIR = process.argv.slice(2).find((a) => !a.startsWith("--")) || "debug/sim-fence", H = 3600e3;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const api = (p) => fetch(`https://adfontes.fun/api/${p}${p.includes("?") ? "&" : "?"}net=testnet`).then((r) => r.json());

if (!process.argv.includes("--keep") || !fs.existsSync(`${DIR}/seed.json`)) {
  const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); }
}
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
const sp = `${DIR}/state/testnet.json`, cp = `${DIR}/chain.json`;
const state = () => JSON.parse(fs.readFileSync(sp, "utf8"));
const chain = () => JSON.parse(fs.readFileSync(cp, "utf8"));
const FL = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;

// 1. Fallen stays fallen.
const live = await api("world");
const liveFallen = live.clans.filter((c) => c.fallen).map((c) => c.id).sort((a, b) => a - b);
let S = state();
const copyFallen = Object.values(S.clans).filter((c) => c.fallen).map((c) => c.id).sort((a, b) => a - b);
ok(liveFallen.length > 0 && JSON.stringify(copyFallen) === JSON.stringify(liveFallen), `the copy's fallen nations match live (live ${liveFallen.join(",")}; copy ${copyFallen.join(",") || "none"})`);

const env = { ...process.env, ADF_SIM_CHAIN: cp, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
for (const k of Object.keys(env)) if (/KEY|SECRET|TOKEN|PASSWORD|SPONSOR|OPERATOR|PRIVATE/i.test(k)) delete env[k];
const run = (now, extra = {}) => {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ...extra, ADF_NOW: String(now) }, encoding: "utf8", maxBuffer: 64e6 });
  fs.appendFileSync(`${DIR}/run.log`, `\n===== run at ${new Date(now).toISOString()} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
};

// A warm-up turn (error log 65): the copy builds its cooldown list on its first turn. The world's fire is off
// for it, so nothing burns before the planted grant.
let r = run(seededAt + 1 * H, { ADF_AOG: "off" });
ok(r.status === 0, `warm-up turn ran (exit ${r.status})`);

// 2. A grant worth 30% of the richest nation at peace, then a hoard line nobody can stay under.
const { warOf } = await import("../engine/war.mjs");
S = state();
let C = chain();
const standing = C.clans.filter((c) => c.alive && S.clans[c.id] && !S.clans[c.id].fallen);
const peace = standing.filter((c) => !warOf(S, c.id)).sort((a, b) => Number(BigInt(b.florins) - BigInt(a.florins)));
const X = peace[0], second = peace[1];
ok(!!(X && second), X ? `richest at peace: ${X.name} (${FL(X.florins).toFixed(1)} florins; next ${second?.name} ${second ? FL(second.florins).toFixed(1) : "-"})` : "no nation at peace");
if (!X || !second) process.exit(1);
const fv = BigInt(C.totals.florins) > 0n ? (BigInt(C.totals.backing) * 10n ** 22n) / BigInt(C.totals.florins) : 0n; // yocto per florin
const grantFl = FL(X.florins) * 0.3;
const grantY = (BigInt(Math.round(grantFl * 1e6)) * fv) / 10n ** 6n;
const god = X.gods[0].account, key = `${X.id}|${god}`;
C.stakes ||= {};
C.stakes[key] = { ...(C.stakes[key] || { florins: "0", near: "0", put_in: "0" }), granted: (BigInt(C.stakes[key]?.granted || "0") + grantY).toString() };
fs.writeFileSync(cp, JSON.stringify(C));
console.log(`  planted: ${god} in ${X.name} granted ${(Number(grantY / 10n ** 18n) / 1e6).toFixed(3)} NEAR (= ${grantFl.toFixed(1)} florins)`);

r = run(seededAt + 2 * H, { ADF_AOG_HOARD: "0.01" });
ok(r.status === 0, `fire turn ran (exit ${r.status})`);
S = state(); C = chain();
const recs = JSON.parse(fs.readFileSync(`${DIR}/state/testnet/day-${S.day}.json`, "utf8"));
const fire = (Array.isArray(recs) ? recs : recs.records).find((x) => x.kind === "fire" && x.cause === "hoard");
ok(!!fire && fire.clan === X.id, `the hoard fire falls on ${X.name}${fire ? ` (it fell on clan ${fire.clan})` : " (no hoard fire)"}`);
if (fire && fire.clan === X.id) {
  const used = fire.florins / fire.pct; // the florins the burn was worked out from
  const held = FL(C.clans.find((c) => c.id === X.id).florins) + fire.florins; // what it held just before the burn
  ok(Math.abs(used - held) / held < 0.005, `the burn was worked out from all ${held.toFixed(1)} florins (used ${used.toFixed(1)}; a fence would use ~${(held - grantFl).toFixed(1)})`);
}

// 3. The copy's own API.
const port = 4390 + Math.floor(Math.random() * 50);
const child = spawn(process.execPath, ["server.mjs"], { env: { ...env, PORT: String(port), ADF_NO_CACHE: "1" }, stdio: "ignore" });
const get = (p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: p }, (x) => { let b = ""; x.on("data", (d) => (b += d)); x.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej));
let W = null;
for (let i = 0; i < 40 && !W; i++) { await new Promise((z) => setTimeout(z, 500)); W = await get("/api/world?net=testnet").catch(() => null); }
child.kill();
ok(!!W, "the copy's server answered /api/world");
if (W) {
  const off = W.clans.filter((c) => c.alive !== false && Math.abs((c.spendable ?? c.florins) - c.florins) > 0.001);
  ok(off.length === 0, `spendable = florins for every standing nation${off.length ? ` (off: ${off.map((c) => `${c.name} ${c.spendable}/${c.florins}`).join(", ")})` : ""}`);
}

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
