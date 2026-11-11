// The sandbox (his call 11 Nov): /timelapse is a copy of the live world that anyone can shock and
// fast-forward on demand. Nothing in it touches NEAR or the live world.
//
// How it works:
// - The base: a copy of the live testnet world (scripts/sim-seed.mjs: nations, florins, citizens,
//   knowledge, wars, reverence, each god's ring-fenced grant), taken again after each new live turn.
// - A visitor's sandbox: its own copy of the base, plus a child copy of the site's server (server.mjs
//   with ADF_SIM_CHAIN) that answers the same API the live world answers, from the copy. The page runs
//   the live world's own 3D code on it.
// - A turn: the real engine (engine/run.mjs) on the copy, with the stand-in chain (engine/chain-sim.mjs),
//   stand-in minds (ADF_FAKE_LLM=1, $0) and research from saved papers only (ADF_PAPERS_OFFLINE=1).
// - A shock: an Act of God the way a god casts it (a passed DAO vote, burns on the next turn), or a
//   bully war (a rich nation declares on a poor one and the heavens burn it).
// - Futures: after a shock, the same copy runs forward 12 turns several times with the shock and
//   several times without (Monte Carlo); the page says how often the nation got back to where it would
//   have been.
//
// Mounted by server.mjs under /sbx/ when ADF_SANDBOX=on.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const DIR = path.resolve(process.env.SBX_DIR || (process.env.RAILWAY_ENVIRONMENT ? "/tmp/adf-sandbox" : "debug/sandbox"));
const BASE = path.join(DIR, "base"), SESS = path.join(DIR, "sessions");
const MAX = Number(process.env.SBX_MAX || 6); // sandboxes at once
const IDLE_MS = 30 * 60e3; // a sandbox nobody has touched for 30 minutes is cleared
const H = 3600e3, TURN_MS = 2 * H; // one turn = two hours of world time, as live
const FUTURES = Number(process.env.SBX_FUTURES || 8), AHEAD = 12, PARALLEL = Number(process.env.SBX_PARALLEL || 3);
const SITE = process.env.SBX_SITE || "https://adfontes.fun";
const PORT0 = Number(process.env.SBX_PORT0 || 4300);
const PAPERS = path.join(DIR, "papers-cache.json");

fs.mkdirSync(SESS, { recursive: true });

// Children never get a secret: no keys, no database. Everything they touch is a file in the copy.
const SECRET = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|SPONSOR|OPERATOR|PRIVATE/i;
function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SECRET.test(k)) env[k] = v;
  return { ...env, DATABASE_URL: "", ADF_UPSTREAM: "off", ...extra };
}
const run = (args, env, timeoutMs = 120e3) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", (d) => { out += d; if (out.length > 4e6) out = out.slice(-2e6); });
  p.stderr.on("data", (d) => { err += d; if (err.length > 1e5) err = err.slice(-5e4); });
  const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
  p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
});
const readJ = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJ = (f, o) => fs.writeFileSync(f, JSON.stringify(o));

// ---- the paper cache: the live world's saved searches (Postgres on Railway, the file locally) ----
async function dumpPapers() {
  if (process.env.DATABASE_URL) {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); // as engine/store.mjs connects
    await c.connect();
    try {
      const r = await c.query("select key, papers from papers_cache");
      const o = {};
      for (const x of r.rows) o[x.key] = typeof x.papers === "string" ? JSON.parse(x.papers) : x.papers;
      writeJ(PAPERS + ".new", o); fs.renameSync(PAPERS + ".new", PAPERS);
    } finally { await c.end(); }
  } else if (fs.existsSync("engine/state/papers-cache.json") && !fs.existsSync(PAPERS)) fs.copyFileSync("engine/state/papers-cache.json", PAPERS);
}

// ---- the base copy: taken again after each new live turn ----
let base = fs.existsSync(path.join(BASE, "seed.json")) ? readJ(path.join(BASE, "seed.json")) : null, seeding = null;
// A new live turn, or a nation founded (or gone) since the copy: copy again. Sandboxes already open
// keep their copy; a new one (or Reset) gets the latest.
async function liveNow() { try { const w = await (await fetch(`${SITE}/api/world?net=testnet`, { signal: AbortSignal.timeout(15000) })).json(); return { day: w.day, nations: w.clans.filter((c) => c.alive !== false).map((c) => c.id).sort((a, b) => a - b).join(",") }; } catch { return null; } }
function reseed(nations = null) {
  return (seeding ??= (async () => {
    try {
      await dumpPapers().catch((e) => console.error("sandbox: papers", e.message));
      const tmp = BASE + "-new";
      const r = await run(["scripts/sim-seed.mjs", tmp], cleanEnv({}), 300e3);
      if (r.code !== 0) throw new Error(r.err.slice(-300) || r.out.slice(-300));
      fs.rmSync(BASE + "-old", { recursive: true, force: true });
      if (fs.existsSync(BASE)) fs.renameSync(BASE, BASE + "-old");
      fs.renameSync(tmp, BASE);
      fs.rmSync(BASE + "-old", { recursive: true, force: true });
      base = { ...readJ(path.join(BASE, "seed.json")), nations };
      writeJ(path.join(BASE, "seed.json"), base);
      console.log(`sandbox: base copy of live turn ${base.day}`);
    } catch (e) { console.error("sandbox: seed failed", String(e.message || e).slice(0, 300)); }
    finally { seeding = null; }
  })());
}
async function keepFresh() {
  const now = await liveNow();
  if (!base || (now && (now.day > base.day || now.nations !== base.nations))) await reseed(now?.nations ?? null);
}
setInterval(() => keepFresh().catch(() => {}), 2 * 60e3).unref(); // a new nation shows up within a few minutes

// ---- reading a copy ----
const FL = (u) => Number(BigInt(u || "0") / 10n ** 16n) / 1e6;
function florinsOf(dir) {
  const C = readJ(path.join(dir, "chain.json"));
  const fl = BigInt(C.totals.florins), backing = BigInt(C.totals.backing);
  const fv = fl > 0n ? (backing * 10n ** 22n) / fl : 0n; // yocto per florin, as the contract
  const out = {};
  for (const c of C.clans) {
    let reserve = 0;
    if (fv > 0n) for (const g of c.gods || []) { const st = C.stakes?.[`${c.id}|${g.account}`]; if (st?.granted && BigInt(st.granted) > 0n) reserve += Number((BigInt(st.granted) * 10n ** 6n) / fv) / 1e6; }
    out[c.id] = { name: c.name, alive: c.alive, florins: FL(c.florins), spendable: Math.max(0, FL(c.florins) - reserve) };
  }
  return { nations: out, value: Number(fv) / 1e24 };
}
const stateOf = (dir) => readJ(path.join(dir, "state", "testnet.json"));

// ---- one turn on a copy ----
async function turn(dir, k, extra = {}, args = ["--force"]) {
  const { seededAt } = readJ(path.join(dir, "seed.json"));
  const env = cleanEnv({
    ADF_SIM_CHAIN: path.join(dir, "chain.json"), ADF_STATE_DIR: path.join(dir, "state"), ADF_FAKE_LLM: "1", ADF_MARKET: "1",
    ADF_PAPERS_OFFLINE: "1", ADF_PAPERS_CACHE: PAPERS, ADF_DAILY_CAP: "50", ADF_NOW: String(seededAt + k * TURN_MS), ...extra,
  });
  const r = await run(["engine/run.mjs", "testnet", ...args], env, 180e3);
  if (r.code !== 0) throw new Error(`turn ${k} failed: ${(r.err || r.out).slice(-300)}`);
  return r.out;
}

// ---- shocks ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
function plantCast(dir, caster, target) {
  const f = path.join(dir, "chain.json"), C = readJ(f);
  const c = C.clans.find((x) => x.id === caster);
  const god = c.gods[0].account;
  const dao = ((C.daos ||= {})[c.dao] ||= []);
  dao.push({ id: dao.length, proposer: god, status: "Approved", description: "act of god (sandbox)", kind: { FunctionCall: { receiver_id: "sim.local", actions: [{ method_name: "root_out", args: b64({ clan_id: caster, point: `act of god: ${target}` }), deposit: "0", gas: "30000000000000" }] } } });
  writeJ(f, C);
  return god;
}
// A bully war: only the attacker's council meets on the next turn, and its stand-in mind declares.
function plantBully(dir, att, k) {
  const f = path.join(dir, "state", "testnet.json"), S = readJ(f), { seededAt } = readJ(path.join(dir, "seed.json"));
  for (const [id, c] of Object.entries(S.clans)) c.lastCouncilAt = Number(id) === att ? 0 : seededAt + (k + 1) * TURN_MS;
  writeJ(f, S);
}
function applyShock(dir, shock, k) {
  if (shock.kind === "fire") plantCast(dir, shock.caster, shock.target);
  else if (shock.kind === "bully") plantBully(dir, shock.attacker, k);
}
const shockEnv = (shock) => (shock?.kind === "bully" ? { ADF_FAKE_WAR: `${shock.attacker}:${shock.target}` } : {});

// ---- sessions ----
const sessions = new Map();
let nextPort = PORT0;
function waitPort(port, ms = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryIt = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/world?net=testnet", timeout: 3000 }, (res) => { res.resume(); resolve(); });
      req.on("error", () => (Date.now() - t0 > ms ? reject(new Error("sandbox server didn't start")) : setTimeout(tryIt, 300)));
      req.on("timeout", () => req.destroy());
    };
    tryIt();
  });
}
async function create() {
  if (!base) { await keepFresh(); if (!base) throw new Error("The sandbox couldn't copy the live world just now. Try again in a minute."); }
  for (const s of sessions.values()) if (Date.now() - s.used > IDLE_MS) drop(s.id);
  if (sessions.size >= MAX) { const oldest = [...sessions.values()].filter((s) => !s.running).sort((a, b) => a.used - b.used)[0]; if (oldest && Date.now() - oldest.used > 5 * 60e3) drop(oldest.id); }
  if (sessions.size >= MAX) throw new Error(`All ${MAX} sandboxes are in use. Try again in a few minutes.`);
  const id = crypto.randomBytes(6).toString("hex"), dir = path.join(SESS, id);
  fs.cpSync(BASE, dir, { recursive: true });
  const s = { id, dir, k: 0, day: base.day, used: Date.now(), running: false, pending: null, log: [], futures: null, port: null, child: null, error: null };
  sessions.set(id, s);
  try {
    // One quiet turn first: the engine takes its first look at each nation's DAO (votes from before the
    // copy don't count), as it did when the nation was new.
    await turn(dir, 1); s.k = 1;
    s.port = nextPort++; if (nextPort > PORT0 + 200) nextPort = PORT0;
    s.child = spawn(process.execPath, ["server.mjs"], { env: cleanEnv({ PORT: String(s.port), ADF_SIM_CHAIN: path.join(dir, "chain.json"), ADF_STATE_DIR: path.join(dir, "state") }), stdio: "ignore" });
    s.child.on("exit", () => { s.child = null; });
    await waitPort(s.port);
  } catch (e) { drop(id); throw e; }
  return s;
}
function drop(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { s.child?.kill(); } catch {}
  setTimeout(() => fs.rmSync(s.dir, { recursive: true, force: true }), 2000);
}
setInterval(() => { for (const s of sessions.values()) if (!s.running && Date.now() - s.used > IDLE_MS) drop(s.id); }, 60e3).unref();

function view(s) {
  const W = florinsOf(s.dir), S = stateOf(s.dir), C = readJ(path.join(s.dir, "chain.json"));
  const wars = Object.values(S.wars || {}).filter((w) => w.status === "on").map((w) => [w.a, w.b]);
  return {
    id: s.id, seed_day: base?.day ?? null, copied_at: readJ(path.join(s.dir, "seed.json")).seededAt, turns: s.k - 1, day: S.day,
    running: s.running, target: s.running?.target ?? null, done: s.running?.done ?? 0, pending: s.pending, log: s.log.slice(-12), error: s.error,
    nations: Object.entries(W.nations).filter(([id, n]) => n.alive && S.clans[id] && !S.clans[id].fallen).map(([id, n]) => ({ id: +id, name: n.name, florins: +n.florins.toFixed(1), spendable: +n.spendable.toFixed(1), at_war: wars.some((p) => p.includes(+id)), gods: (C.clans.find((c) => c.id === +id)?.gods || []).length })),
    florin_value: W.value, futures: s.futures,
  };
}

// The next turns, one at a time (the page polls the copy's API and plays each as it lands).
async function forward(s, n) {
  s.running = { target: n, done: 0 };
  s.error = null;
  try {
    for (let i = 0; i < n; i++) {
      const shock = s.pending; s.pending = null;
      const k = s.k + 1;
      if (shock) applyShock(s.dir, shock, s.k);
      await turn(s.dir, k, shockEnv(shock));
      s.k = k; s.running.done = i + 1; s.used = Date.now();
      // What burned, from the turn's sealed records (the engine's printed lines are cut short).
      const day = stateOf(s.dir).day, f = path.join(s.dir, "state", "testnet", `day-${day}.json`);
      const fires = (fs.existsSync(f) ? readJ(f) : []).filter((r) => r.kind === "fire" || r.kind === "fire-refused");
      for (const f of fires) s.log.push({ turn: k - 1, ...f });
      if (shock && !fires.length) s.log.push({ turn: k - 1, kind: "fire-refused", clan: shock.caster ?? shock.attacker, target: shock.target, why: shock.kind === "bully" ? "the war wasn't declared (the attacker or its target was already at war)" : "nothing burned" });
    }
  } catch (e) { s.error = String(e.message || e).slice(0, 300); }
  finally { s.running = false; }
}

// ---- futures (Monte Carlo): the same copy, 12 turns ahead, with and without the shock ----
async function futures(s, shock) {
  const tag = crypto.randomBytes(3).toString("hex"), root = path.join(s.dir, `futures-${tag}`);
  const F = { status: "running", shock, runs: FUTURES, ahead: AHEAD, done: 0, shocked: [], plain: [] };
  s.futures = F;
  const startK = s.k, snap = path.join(root, "snap");
  // One snapshot at the moment of the shock: every future starts from it, whatever the sandbox does next.
  fs.mkdirSync(snap, { recursive: true });
  for (const f of ["chain.json", "seed.json"]) fs.copyFileSync(path.join(s.dir, f), path.join(snap, f));
  fs.cpSync(path.join(s.dir, "state"), path.join(snap, "state"), { recursive: true });
  const jobs = [];
  for (let i = 0; i < FUTURES; i++) for (const withShock of [true, false]) jobs.push({ i, withShock });
  const one = async ({ i, withShock }) => {
    const dir = path.join(root, `${withShock ? "s" : "p"}${i}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ["chain.json", "seed.json"]) fs.copyFileSync(path.join(snap, f), path.join(dir, f));
    fs.cpSync(path.join(snap, "state"), path.join(dir, "state"), { recursive: true });
    const line = [florinsOf(dir).nations[shock.kind === "bully" ? shock.attacker : shock.target]?.spendable ?? 0];
    for (let t = 1; t <= AHEAD; t++) {
      if (withShock && t === 1) applyShock(dir, shock, startK);
      await turn(dir, startK + t, withShock && t === 1 ? shockEnv(shock) : {});
      line.push(+(florinsOf(dir).nations[shock.kind === "bully" ? shock.attacker : shock.target]?.spendable ?? 0).toFixed(2));
    }
    (withShock ? F.shocked : F.plain).push(line);
    F.done++;
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const queue = jobs.slice();
    await Promise.all(Array.from({ length: PARALLEL }, async () => { while (queue.length && sessions.has(s.id) && s.futures === F) await one(queue.shift()); }));
    if (s.futures !== F) return;
    // Back where it would have been: the turn the shocked run reaches 95% of the no-shock median.
    const med = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : 0; };
    const plainMed = Array.from({ length: AHEAD + 1 }, (_, t) => med(F.plain.map((l) => l[t])));
    const back = F.shocked.map((l) => { for (let t = 1; t <= AHEAD; t++) if (l[t] >= plainMed[t] * 0.95) return t; return null; });
    const ok = back.filter((t) => t != null);
    Object.assign(F, { status: "done", plain_median: plainMed, shocked_median: Array.from({ length: AHEAD + 1 }, (_, t) => med(F.shocked.map((l) => l[t]))), recovered: ok.length, recover_turns: ok.length ? med(ok) : null });
  } catch (e) { F.status = "failed"; F.error = String(e.message || e).slice(0, 200); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---- HTTP: /sbx/... ----
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => { b += d; if (b.length > 1e4) req.destroy(); }); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });

export async function handleSandbox(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["sbx", id?, action?, ...]
  try {
    if (parts.length === 1 || parts[1] === "info") return json(res, 200, { base_day: base?.day ?? null, copied_at: base?.seededAt ?? null, in_use: sessions.size, max: MAX, seeding: !!seeding });
    if (parts[1] === "new" && req.method === "POST") { const s = await create(); return json(res, 200, view(s)); }
    const s = sessions.get(parts[1]);
    if (!s) return json(res, 404, { error: "That sandbox is gone (they clear after 30 minutes). Start a new one." });
    s.used = Date.now();
    const act = parts[2];
    if (act === "api") {
      // The copy's own API, from its child server: the same code that serves the live world.
      if (!s.child) return json(res, 503, { error: "the sandbox is starting" });
      const p = http.request({ host: "127.0.0.1", port: s.port, path: "/" + parts.slice(2).join("/") + url.search, method: "GET" }, (r) => { res.writeHead(r.statusCode, { "content-type": r.headers["content-type"] || "application/json", "cache-control": "no-store" }); r.pipe(res); });
      p.on("error", () => json(res, 502, { error: "the sandbox didn't answer" }));
      return p.end();
    }
    if (act === "state") return json(res, 200, view(s));
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const b = await body(req);
    if (act === "forward") {
      if (s.running) return json(res, 409, { error: "It's already running." });
      const n = Math.max(1, Math.min(84, Number(b.turns) || 1));
      forward(s, n);
      return json(res, 200, view(s));
    }
    if (act === "shock") {
      if (s.running) return json(res, 409, { error: "Wait for the turns that are running to finish." });
      if (s.pending) return json(res, 409, { error: "There's already a shock waiting for the next turn." });
      const W = view(s), alive = new Map(W.nations.map((n) => [n.id, n]));
      const target = Number(b.target);
      if (!alive.has(target)) return json(res, 400, { error: "Pick a standing nation." });
      let shock;
      if (b.kind === "fire") {
        const caster = Number(b.caster);
        if (!alive.has(caster) || !alive.get(caster).gods) return json(res, 400, { error: "Pick the nation whose gods call the fire." });
        if (caster === target) return json(res, 400, { error: "A nation's gods can't call fire on their own nation." });
        shock = { kind: "fire", caster, target };
      } else if (b.kind === "bully") {
        const attacker = Number(b.attacker);
        if (!alive.has(attacker) || attacker === target) return json(res, 400, { error: "Pick the nation that declares war." });
        shock = { kind: "bully", attacker, target };
      } else return json(res, 400, { error: "Unknown shock." });
      s.pending = shock;
      futures(s, shock); // the futures start from this turn, in the background
      return json(res, 200, view(s));
    }
    if (act === "reset") { drop(s.id); const n = await create(); return json(res, 200, view(n)); }
    return json(res, 404, { error: "unknown" });
  } catch (e) { return json(res, 500, { error: String(e.message || e).slice(0, 300) }); }
}

/** Start the base copy when the web server starts (the first visitor doesn't wait for it). */
export function startSandbox() { keepFresh().catch(() => {}); }
