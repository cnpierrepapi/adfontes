// The game (timelapse/game.mjs, /play): a whole game on a copy of 3 live nations, never on testnet, stand-in minds
// ($0). Checks the draw rotates through every standing nation, the purse is the poorest drawn nation's florins
// x 1.1 at the florin's price, founding adds your nation without moving the price, End turn plays exactly 12
// engine turns, a game survives the service restarting, 7 turns finish it and a free game is then deleted,
// one game per log-in, nobody else can read yours. Part 2 runs the real server.mjs and checks the email log-in
// guards the game routes. Exits 1 on any failure.   node scripts/game-test.mjs [--skip-login]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve("debug/game-test");
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
Object.assign(process.env, { SBX_DIR: path.join(ROOT, "sbx"), GAME_DIR: path.join(ROOT, "games"), SBX_FRESH_MS: "1000000000", SBX_PORT0: "4600" });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- part 0: pure rules ----
const G = await import("../timelapse/game.mjs");
{
  const standing = Array.from({ length: 17 }, (_, i) => i + 1), tally = {}, seen = [];
  for (let n = 0; n < 6; n++) { const p = G.draw(standing, tally, `seed${n}`); for (const id of p) { tally[id] = (tally[id] || 0) + 1; seen.push(id); } }
  const first17 = new Set(seen.slice(0, 17));
  ok(first17.size === 17, `6 games draw all 17 standing nations before any repeats (first 17 draws hold ${first17.size} different nations)`);
  const p = G.purseFor({ 3: 2421.7, 19: 82.1, 22: 32.2 }, 0.01216);
  ok(p.poorest.id === 22 && Math.abs(p.florins - 35.42) < 0.01 && Math.abs(p.near - 35.42 * 0.01216) < 1e-4, `purse = poorest (32.2 florins) x 1.1 = ${p.florins} florins = ${p.near} NEAR`);
}

// ---- part 1: a whole game through the routes, with a stand-in log-in ----
const who = { "a@x.io": "A", "b@x.io": "B", "c@x.io": "C" };
const srv = http.createServer((req, res) => G.handleGame(req, res, new URL(req.url, "http://x"), { verify: async (e) => who[e] ?? null })).listen(4590);
const call = (p, email, method = "GET", b = null) => new Promise((resolve, reject) => {
  const data = b ? JSON.stringify(b) : null;
  const r = http.request({ host: "127.0.0.1", port: 4590, path: p, method, headers: { ...(email ? { "x-adf-email": email, "x-adf-auth": "0".repeat(64) } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (x) => { let s = ""; x.on("data", (d) => (s += d)); x.on("end", () => { try { resolve({ status: x.statusCode, body: JSON.parse(s) }); } catch { resolve({ status: x.statusCode, body: s }); } }); });
  r.on("error", reject); if (data) r.write(data); r.end();
});
const until = async (f, ms, step = 2000) => { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(step); } };

ok((await call("/sbx/game/mine")).status === 401, "no log-in: refused");
let r = await call("/sbx/game/new", "a@x.io", "POST");
ok(r.status === 200 && r.body.status === "drawing" && r.body.drawn.length === 3, `new game: 3 nations drawn (${r.body.drawn?.map((x) => x.name).join(", ")})`);
const id = r.body.id;
const founding = await until(async () => { const s = (await call(`/sbx/game/${id}/state`, "a@x.io")).body; return s.status === "founding" || s.status === "failed" ? s : null; }, 6 * 60e3);
ok(founding?.status === "founding", `the copy is ready to found (${founding?.status ?? "timed out"}${founding?.error ? ": " + founding.error : ""})`);
if (founding?.status !== "founding") { srv.close(); process.exit(1); }
const gd = path.join(ROOT, "games", id);
let C = JSON.parse(fs.readFileSync(path.join(gd, "chain.json"), "utf8"));
const FL = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;
const fv = (C) => Number((BigInt(C.totals.backing) * 10n ** 22n) / BigInt(C.totals.florins)) / 1e24;
ok(C.clans.length === 3, `the copy holds only the 3 drawn nations (${C.clans.map((c) => c.name).join(", ")})`);
// The purse reads the copy as it was taken (the live world's florins at the draw), before the quiet setup turn.
const poorest = Math.min(...founding.drawn.map((n) => n.florins));
ok(Math.abs(founding.purse.florins - poorest * 1.1) < 0.01 && Math.abs(founding.purse.near - founding.purse.florins * founding.purse.florin_value) < 1e-4 && Math.abs(founding.purse.florin_value - fv(C)) / fv(C) < 0.01, `purse ${founding.purse.florins} florins = ${founding.purse.near} play NEAR (poorest ${founding.purse.poorest.name} ${poorest.toFixed(2)} x 1.1)`);
const liveNow = await (await fetch("https://adfontes.fun/api/world?net=testnet")).json();
const off = founding.drawn.filter((n) => { const l = liveNow.clans.find((c) => c.id === n.id); return !l || Math.abs(l.florins - n.florins) > Math.max(5, l.florins * 0.05); });
ok(off.length === 0, `the drawn nations' florins are the live world's (${founding.drawn.map((n) => `${n.name} ${n.florins}`).join(", ")}${off.length ? "; off: " + off.map((n) => n.name).join(",") : ""})`);
ok((await call("/sbx/game/new", "a@x.io", "POST")).status === 409, "a second game while one is going: refused");
ok((await call(`/sbx/game/${id}/state`, "b@x.io")).status === 404, "another log-in can't read this game");
ok((await call(`/sbx/game/${id}/found`, "a@x.io", "POST", { name: "Testoria", field: "astrology" })).status === 400, "a field nobody researches: refused");
const fv0 = fv(C);
r = await call(`/sbx/game/${id}/found`, "a@x.io", "POST", { name: "Testoria", field: "solar cells" });
ok(r.status === 200 && r.body.status === "playing" && r.body.nations.length === 4, `founded Testoria: 4 nations (${r.body.error ?? ""})`);
C = JSON.parse(fs.readFileSync(path.join(gd, "chain.json"), "utf8"));
const mine = C.clans.find((c) => c.name === "Testoria");
ok(!!mine && Math.abs(FL(mine.florins) - founding.purse.florins) < 0.01, `Testoria holds the purse as florins (${mine ? FL(mine.florins) : "-"})`);
ok(Math.abs(fv(C) - fv0) / fv0 < 1e-6, `the florin's price didn't move (${fv0} -> ${fv(C)})`);

const k0 = JSON.parse(fs.readFileSync(path.join(ROOT, "games", `${id}.json`), "utf8")).k;
r = await call(`/sbx/game/${id}/end-turn`, "a@x.io", "POST");
ok(r.status === 200 && r.body.running, "End turn: the day starts playing");
ok((await call(`/sbx/game/${id}/end-turn`, "a@x.io", "POST")).status === 409, "End turn again while it plays: refused");
ok((await call(`/sbx/game/${id}/quit`, "a@x.io", "POST")).status === 409, "give up while it plays: refused");
let s = await until(async () => { const v = (await call(`/sbx/game/${id}/state`, "a@x.io")).body; return v.status && v.running === null ? v : null; }, 10 * 60e3);
const g1 = JSON.parse(fs.readFileSync(path.join(ROOT, "games", `${id}.json`), "utf8"));
ok(s?.turn === 1 && g1.k - k0 === 12, `turn 1 done: exactly 12 engine turns (${g1.k - k0})${s?.error ? " error " + s.error : ""}`);
const S1 = JSON.parse(fs.readFileSync(path.join(gd, "state", "testnet.json"), "utf8"));
ok(S1.clans[mine.id]?.field === "solar cells", `Testoria researches solar cells (${S1.clans[mine.id]?.field})`);
const C1 = JSON.parse(fs.readFileSync(path.join(gd, "chain.json"), "utf8"));
ok((C1.agents[mine.id] || []).length > 0, `Testoria's people arrived (${(C1.agents[mine.id] || []).length})`);
ok(s?.report?.nations?.length === 4 && Array.isArray(s.report.events), `turn report: 4 nations, ${s?.report?.events?.length} events, reverence reasons ${JSON.stringify(s?.report?.reverence ?? [])}`);
const rev1 = s?.nations?.find((x) => x.mine)?.rev;
ok(typeof rev1 === "number" && rev1 >= 40 && rev1 <= 60, `your god's reverence after turn 1: ${rev1} (started at 50)`);

// The service restarts (a crash, not a deploy: /tmp survives a crash): a fresh process reads the game back.
const back = spawnSync(process.execPath, ["--input-type=module", "-e", `const G = await import(${JSON.stringify(new URL("../timelapse/game.mjs", import.meta.url).href)}); const http = await import("node:http"); const s = http.createServer((q, r) => G.handleGame(q, r, new URL(q.url, "http://x"), { verify: async () => "A" })).listen(4591, async () => { const x = await (await fetch("http://127.0.0.1:4591/sbx/game/${id}/state")).json(); console.log(JSON.stringify({ turn: x.turn, status: x.status })); s.close(); process.exit(0); });`], { env: process.env, encoding: "utf8", timeout: 60e3 });
ok(/"turn":1/.test(back.stdout) && /"status":"playing"/.test(back.stdout), `a restarted service finds the game at turn 1 (${back.stdout.trim() || back.stderr.slice(-200)})`);

for (let t = 2; t <= 7; t++) {
  r = await call(`/sbx/game/${id}/end-turn`, "a@x.io", "POST");
  if (r.status !== 200) { ok(false, `End turn ${t}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); break; }
  s = await until(async () => { const v = await call(`/sbx/game/${id}/state`, "a@x.io"); return v.status === 404 ? { gone: true } : v.body.status && v.body.running === null ? v.body : null; }, 10 * 60e3);
  if (s?.gone) break;
  if (s?.error) { ok(false, `turn ${t}: ${s.error}`); break; }
}
const m = (await call("/sbx/game/mine", "a@x.io")).body;
ok(m.game === null && m.last?.id === id && m.last.result?.turns >= 1, `game over: result kept (gain ${m.last?.result?.gain}, reverence ${m.last?.result?.reverence}, ${m.last?.result?.turns} turns${m.last?.result?.fell ? ", your island fell" : ""})`);
ok(m.last?.result?.fell || m.last?.result?.turns === 7, "it ended after 7 turns (or when your island fell)");
{ // Every point your god's reverence moved is explained in the turn reports.
  const said = (m.last?.reports || []).reduce((a, r) => a + r.reverence.reduce((x, y) => x + y.d, 0), 0);
  ok(Math.abs(said - (m.last?.result?.gain ?? NaN)) < 0.25, `the reports explain your whole gain (${said.toFixed(1)} of ${m.last?.result?.gain})`);
}
ok(!fs.existsSync(gd) && !fs.existsSync(path.join(ROOT, "games", `${id}.json`)), "the free game's copy and record are deleted");
ok((await call(`/sbx/game/${id}/end-turn`, "a@x.io", "POST")).status === 404, "End turn on the finished game: it's gone");

r = await call("/sbx/game/new", "c@x.io", "POST");
const cid = r.body.id;
await until(async () => (await call(`/sbx/game/${cid}/state`, "c@x.io")).body.status === "founding", 6 * 60e3);
ok((await call(`/sbx/game/${cid}/quit`, "c@x.io", "POST")).status === 200 && !fs.existsSync(path.join(ROOT, "games", cid)) && !fs.existsSync(path.join(ROOT, "games", `${cid}.json`)), "give up: the game is deleted");
srv.close();

// ---- part 2: the real server's email log-in guards the routes ----
if (!process.argv.includes("--skip-login")) {
  const port = 4595, st = path.join(ROOT, "server-state");
  fs.mkdirSync(st, { recursive: true });
  const env = { ...process.env, PORT: String(port), ADF_SANDBOX: "on", ADF_STATE_DIR: st, DATABASE_URL: "", LOGIN_PEPPER: "test-pepper" };
  for (const k of Object.keys(env)) if (/SPONSOR|OPERATOR|PRIVATE/.test(k)) delete env[k];
  const sv = spawn(process.execPath, ["server.mjs"], { env, stdio: "ignore" });
  const req = (p, method = "GET", b = null, h = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
  await until(async () => (await req("/sbx/game").catch(() => null))?.status === 200, 60e3, 500);
  const auth = "ab".repeat(32);
  const su = await req("/api/login/signup", "POST", { email: "p@x.io", auth, salt: "cd".repeat(16), iv: "ef".repeat(12), ct: "A".repeat(40), account: "player-test.testnet" });
  ok(su.status === 200, `signed up a test log-in (${su.status} ${JSON.stringify(su.body)})`);
  ok((await req("/sbx/game/mine")).status === 401, "real server: no log-in, refused");
  ok((await req("/sbx/game/mine", "GET", null, { "x-adf-email": "p@x.io", "x-adf-auth": "12".repeat(32) })).status === 401, "real server: wrong token, refused");
  const good = await req("/sbx/game/mine", "GET", null, { "x-adf-email": "p@x.io", "x-adf-auth": auth });
  ok(good.status === 200 && good.body?.game === null, `real server: right email + token, in (${good.status})`);
  sv.kill();
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
