// The game (his call 26-27 Nov, Documents/ADFONTES_GAME/PLAN.md section 11). A game is 4 nations: yours and 3 AI
// nations drawn from the live world as they stand at that moment. The 3 rotate: the standing nations that have sat
// in the fewest games go next (ties broken by the game's own seed), so every nation gets played against. Nothing in
// a game touches NEAR or the live world: it runs on a copy (scripts/sim-seed.mjs --only), the real engine, the
// stand-in chain and stand-in minds, like the sandbox.
//
// - You log in with your email (server.mjs: the 11 Nov email + passphrase log-in); a game belongs to the log-in.
//   One game in progress per player.
// - Your purse: play NEAR worth 10% more than the poorest of the 3 drawn nations' florins, at the florin's price
//   of the moment. It becomes your nation's florins when you found it.
// - 7 turns. End turn plays one world day (12 engine turns). A turn report after each, the result after the 7th:
//   your reverence gained (your god starts at 50).
// - A free game is deleted the moment it ends (his call 27 Nov). Paid games, kept on a volume, come later.
//
// Routes (mounted under /sbx/game by timelapse/service.mjs). Every one but the copy's API needs the log-in
// headers x-adf-email + x-adf-auth (the token the browser derives from the passphrase).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { DIR, SITE, PAPERS, PORT0, cleanEnv, run, readJ, writeJ, turn, stateOf, waitPort, dumpPapers, FL } from "./service.mjs";
import { initClan, FIELDS } from "../engine/world.mjs";

export const GAME = { turns: 7, perTurn: 12, ai: 3, purseOver: 1.1, startRev: 50, maxGames: Number(process.env.GAME_MAX || 40), childIdleMs: 10 * 60e3, jobs: Number(process.env.GAME_JOBS || 2) };
const GAMES = path.resolve(process.env.GAME_DIR || path.join(DIR, "games"));
const TALLY = path.join(GAMES, "rotation.json"), OWNERS = path.join(GAMES, "owners.json");
fs.mkdirSync(GAMES, { recursive: true });
const readOr = (f, d) => { try { return readJ(f); } catch { return d; } };
// Written whole, then swapped in: a page polling the game never reads half a file.
const writeA = (f, o) => { fs.writeFileSync(f + ".tmp", JSON.stringify(o)); fs.renameSync(f + ".tmp", f); };
const gdir = (id) => path.join(GAMES, id);
// A game's record sits beside its copy (the seed wipes the copy's folder when it fills it).
const metaF = (id) => path.join(GAMES, `${id}.json`);
const load = (id) => (/^[0-9a-f]{12}$/.test(id) && fs.existsSync(metaF(id)) ? readJ(metaF(id)) : null);
const save = (g) => writeA(metaF(g.id), g);
const wipe = (id) => { fs.rmSync(gdir(id), { recursive: true, force: true }); fs.rmSync(metaF(id), { force: true }); };
const owners = () => readOr(OWNERS, {});
const setOwner = (owner, v) => { const o = owners(); o[owner] = v; writeA(OWNERS, o); };

// ---- engine jobs: a few at a time, so one player's turn doesn't starve the others or the web server ----
let busy = 0;
const waiting = [];
async function job(f) {
  if (busy >= GAME.jobs) await new Promise((r) => waiting.push(r));
  busy++;
  try { return await f(); } finally { busy--; waiting.shift()?.(); }
}

// ---- the draw ----
/** The 3 nations for a new game: fewest games so far first, ties in an order the seed decides. Pure. */
export function draw(standing, tally, seed, n = GAME.ai) {
  const tie = (id) => crypto.createHash("sha256").update(`${seed}|${id}`).digest("hex");
  return [...standing].sort((a, b) => (tally[a] || 0) - (tally[b] || 0) || (tie(a) < tie(b) ? -1 : 1)).slice(0, n);
}
/** Play NEAR for the purse: the poorest drawn nation's florins x 1.1, at the florin's price. Pure. */
export function purseFor(florinsById, florinValue) {
  const [id, fl] = Object.entries(florinsById).sort((a, b) => a[1] - b[1])[0];
  const florins = +(fl * GAME.purseOver).toFixed(4);
  return { poorest: { id: Number(id), florins: +fl.toFixed(4) }, florins, near: +(florins * florinValue).toFixed(6), florin_value: florinValue };
}

// ---- reading a game's copy ----
const chainOf = (g) => readJ(path.join(gdir(g.id), "chain.json"));
const fvOf = (C) => (BigInt(C.totals.florins) > 0n ? Number((BigInt(C.totals.backing) * 10n ** 22n) / BigInt(C.totals.florins)) / 1e24 : 0);
// The engine rewrites the copy's files while a turn runs: a read that lands mid-write gets the last good snapshot.
const lastSnap = new Map();
function snapSafe(g) {
  try { const s = snap(g); lastSnap.set(g.id, s); return s; } catch (e) { if (lastSnap.has(g.id)) return lastSnap.get(g.id); throw e; }
}
function snap(g) {
  const C = chainOf(g), S = stateOf(gdir(g.id)), out = {};
  for (const id of [g.mine, ...g.nations]) {
    const cc = C.clans.find((c) => c.id === id), sc = S.clans[id], rv = S.rev?.[id];
    if (!cc || !sc) continue;
    const war = Object.values(S.wars || {}).find((w) => w.status === "on" && (w.a === id || w.b === id));
    const gods = Object.values(rv?.gods || {}).map((x) => x.r);
    out[id] = { id, name: cc.name, field: sc.field, mine: id === g.mine, florins: +FL(cc.florins).toFixed(2), points: Object.keys(sc.owned || {}).length, walls: +(sc.walls || 0).toFixed(1),
      rev: id === g.mine ? +(rv?.gods?.[g.god]?.r ?? GAME.startRev).toFixed(1) : gods.length ? +Math.max(...gods).toFixed(1) : null,
      at_war: war ? (war.a === id ? war.b : war.a) : null, fallen: !!sc.fallen };
  }
  return out;
}
function recordsBetween(g, d0, d1) {
  const out = [];
  for (let d = d0 + 1; d <= d1; d++) {
    const f = path.join(gdir(g.id), "state", "testnet", `day-${d}.json`);
    if (fs.existsSync(f)) { const x = readJ(f); out.push(...(Array.isArray(x) ? x : x.records || [])); }
  }
  return out;
}
/** What a turn did, in plain words, from its sealed records and the before/after of each nation. */
export function report(g, before, after, recs, n) {
  const name = (id) => after[id]?.name ?? before[id]?.name ?? `nation ${id}`;
  const events = [], battles = {};
  for (const r of recs) {
    if (r.kind === "war") events.push(`${name(r.attacker)} declared war on ${name(r.defender)}.`);
    else if (r.kind === "battle") { const k = Object.keys(r.sides || {}).map(Number).sort((a, b) => a - b).join("|"); battles[k] = (battles[k] || 0) + 1; }
    else if (r.kind === "peace") events.push(`${name(r.a)} and ${name(r.b)} made peace after ${r.rounds} rounds.`);
    else if (r.kind === "fallen") events.push(`${name(r.clan)} fell to ${name(r.by)}${r.surrendered ? " (it surrendered)" : ""}.`);
    else if (r.kind === "fire") events.push(`Fire burned ${Math.round(r.florins)} of ${name(r.clan)}'s florins${r.cause === "hoard" ? " (it held too much of the world's money)" : r.cause === "bully" ? " (it picked on a weaker nation)" : r.cause === "famine" ? " (it sat rich through a famine)" : ""}.`);
  }
  for (const [k, c] of Object.entries(battles)) { const [a, b] = k.split("|").map(Number); events.push(`${name(a)} and ${name(b)} fought ${c} battle${c === 1 ? "" : "s"}.`); }
  const walls = {};
  for (const r of recs) if (r.kind === "fortify") walls[r.clan] = (walls[r.clan] || 0) + (r.spent || 0);
  for (const [id, sp] of Object.entries(walls)) events.push(`${name(Number(id))} spent ${Math.round(sp)} florins on walls.`);
  // Your god's reverence: every change this turn, summed by its reason.
  const why = {};
  for (const r of recs) if ((r.kind === "reverence" || r.kind === "reverence-change") && r.clan === g.mine) for (const c of r.changes || []) if (c.god === g.god) { const w = String(c.why || "").replace(/\s*\(.*\)$/, ""); why[w] = +((why[w] || 0) + c.d).toFixed(1); }
  return {
    turn: n,
    nations: Object.keys(after).map(Number).map((id) => ({ id, name: name(id), mine: id === g.mine, before: before[id] ?? null, after: after[id] })),
    events,
    reverence: Object.entries(why).map(([w, d]) => ({ why: w, d })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)),
  };
}

// ---- the copy's own server (the 3D page reads it), only while someone has the game open ----
const kids = new Map(); // game id -> { child, port, used }
let nextPort = PORT0 + 300;
async function child(g) {
  const k = kids.get(g.id);
  if (k?.child) { k.used = Date.now(); return k; }
  const port = nextPort++; if (nextPort > PORT0 + 499) nextPort = PORT0 + 300;
  const c = spawn(process.execPath, ["server.mjs"], { env: cleanEnv({ PORT: String(port), ADF_SIM_CHAIN: path.join(gdir(g.id), "chain.json"), ADF_STATE_DIR: path.join(gdir(g.id), "state"), ADF_NO_CACHE: "1" }), stdio: "ignore" });
  const rec = { child: c, port, used: Date.now() };
  kids.set(g.id, rec);
  c.on("exit", () => { if (kids.get(g.id) === rec) kids.delete(g.id); });
  await waitPort(port);
  return rec;
}
function stopChild(id) { const k = kids.get(id); kids.delete(id); try { k?.child?.kill(); } catch {} }
setInterval(() => { for (const [id, k] of kids) if (Date.now() - k.used > GAME.childIdleMs) stopChild(id); }, 60e3).unref();

// ---- a game's life ----
const running = new Map(); // game id -> { target, done } while its turns run
let liveWorld = null; // the live world as last read (for the draw)

async function newGame(owner) {
  const mine = owners()[owner];
  if (mine?.current && load(mine.current)) throw Object.assign(new Error("You have a game going. Continue it, or give it up first."), { code: 409 });
  if (fs.readdirSync(GAMES).filter((x) => /^[0-9a-f]{12}\.json$/.test(x)).length >= GAME.maxGames) throw Object.assign(new Error("Every game slot is taken right now. Try again in a little while."), { code: 503 });
  liveWorld = await (await fetch(`${SITE}/api/world?net=testnet`, { signal: AbortSignal.timeout(20000) })).json();
  const standing = liveWorld.clans.filter((c) => c.alive !== false && !c.fallen).map((c) => c.id);
  if (standing.length < GAME.ai) throw Object.assign(new Error("Not enough nations are standing in the live world to start a game."), { code: 503 });
  const id = crypto.randomBytes(6).toString("hex"), dir = gdir(id);
  const tally = readOr(TALLY, {});
  const pick = draw(standing, tally, id);
  for (const n of pick) tally[n] = (tally[n] || 0) + 1;
  writeA(TALLY, tally);
  const g = { id, owner, created: Date.now(), status: "drawing", nations: pick, mine: null, god: null, k: 0, turn: 0, reports: [] };
  fs.mkdirSync(dir, { recursive: true });
  save(g);
  setOwner(owner, { ...(owners()[owner] || {}), current: id });
  running.set(id, { target: 0, done: 0, what: "copying the 3 nations from the live world" });
  // The copy, then one quiet turn (the engine's first look at each nation's DAO and stand-in wallets; its
  // records are dropped, as the sandbox's base does).
  job(async () => {
    try {
      if (!fs.existsSync(PAPERS)) await dumpPapers().catch(() => {});
      const r = await run(["scripts/sim-seed.mjs", dir, `--only=${pick.join(",")}`], cleanEnv({}), 300e3);
      if (r.code !== 0) throw new Error((r.err || r.out).slice(-300));
      // The purse and the cards read the copy as it was taken: the live world's florins at this moment (the
      // quiet turn below charges a little upkeep).
      const C = readJ(path.join(dir, "chain.json")), S0 = stateOf(dir);
      const fl = Object.fromEntries(pick.map((n) => [n, FL(C.clans.find((c) => c.id === n)?.florins)]));
      const purse = purseFor(fl, fvOf(C));
      purse.poorest.name = C.clans.find((c) => c.id === purse.poorest.id)?.name;
      const drawn = pick.map((n) => ({ id: n, name: C.clans.find((c) => c.id === n)?.name, field: S0.clans[n]?.field ?? null, florins: +fl[n].toFixed(2), points: Object.keys(S0.clans[n]?.owned || {}).length }));
      await turn(dir, 1);
      fs.rmSync(path.join(dir, "state", "testnet", `day-${stateOf(dir).day}.json`), { force: true });
      const x = load(id); if (!x) return;
      Object.assign(x, { status: "founding", k: 1, purse, drawn });
      save(x);
    } catch (e) { const x = load(id); if (x) { x.status = "failed"; x.error = String(e.message || e).slice(0, 300); save(x); } }
    finally { running.delete(id); }
  });
  return g;
}

const NAME = /^[A-Za-z][A-Za-z '\-]{1,22}[A-Za-z]$/;
function found(g, body) {
  if (g.status !== "founding") throw Object.assign(new Error(g.status === "drawing" ? "Your 3 nations are still being copied. A few seconds." : "Your nation is already founded."), { code: 409 });
  const name = String(body.name || "").trim().replace(/\s+/g, " "), field = String(body.field || "");
  if (!NAME.test(name)) throw Object.assign(new Error("Name your nation with 3 to 24 letters (spaces, ' and - are fine)."), { code: 400 });
  if (!FIELDS.includes(field)) throw Object.assign(new Error(`Pick a field: ${FIELDS.join(", ")}.`), { code: 400 });
  const dir = gdir(g.id), C = readJ(path.join(dir, "chain.json")), S = stateOf(dir);
  if (C.clans.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error("A nation in your game already has that name."), { code: 400 });
  // Your nation on the copy's chain, paid with the purse: its florins at the florin's price, so the price
  // doesn't move (the world's backing grows with the florins).
  const id = Math.max(...(liveWorld?.clans || []).map((c) => c.id), ...C.clans.map((c) => c.id)) + 1;
  const god = `god-${g.id}.play`;
  // The purse's florins come in at the copy's price right now, so the price doesn't move at all.
  const units = BigInt(Math.round(g.purse.florins * 1e6)) * 10n ** 16n;
  const yocto = (units * BigInt(C.totals.backing)) / BigInt(C.totals.florins);
  C.clans.push({ id, name, dao: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.sim-dao`, alive: true, gods: [{ account: god, put_in: yocto.toString(), shares: units.toString() }], florins: units.toString(), shares: units.toString(), total_in: yocto.toString(), clean_gifts: 0, born_day: C.config?.day ?? S.day });
  C.totals.florins = (BigInt(C.totals.florins) + units).toString();
  C.totals.backing = (BigInt(C.totals.backing) + yocto).toString();
  (C.agents ||= {})[id] = [];
  (C.stakes ||= {})[`${id}|${god}`] = { florins: units.toString(), near: yocto.toString(), put_in: yocto.toString(), granted: "0" };
  writeJ(path.join(dir, "chain.json"), C);
  // The engine meets it as a nation already set up with your field: its people arrive on the first turn, and
  // your god starts at 50 (the engine's start for a god already there; the purse isn't counted as a blessing).
  const c = initClan(S, { id, name });
  c.field = field; c.owned = { [field]: { depth: 0, parent: null, corpus: null, how: "root" } };
  c.lastTotalIn = yocto.toString(); c.player = true;
  writeJ(path.join(dir, "state", "testnet.json"), S);
  Object.assign(g, { status: "playing", mine: id, god, name, field, day0: S.day, start: null });
  save(g);
  g.start = snap(g); save(g);
  return g;
}

function endTurn(g) {
  if (g.status !== "playing") throw Object.assign(new Error(g.status === "finished" ? "This game is over." : "Found your nation first."), { code: 409 });
  if (running.has(g.id)) throw Object.assign(new Error("Your turn is already playing out."), { code: 409 });
  // A turn cut short (the service restarted mid-turn) picks up where it stopped.
  if (g.turnFrom == null) { g.turnFrom = g.k; g.before = snap(g); g.dayFrom = stateOf(gdir(g.id)).day; save(g); }
  const target = g.turnFrom + GAME.perTurn;
  const st = { target: GAME.perTurn, done: g.k - g.turnFrom, what: "the day plays out" };
  running.set(g.id, st);
  job(async () => {
    try {
      while (g.k < target) {
        await turn(gdir(g.id), g.k + 1);
        g.k++; st.done++; save(g);
        if (stateOf(gdir(g.id)).clans[g.mine]?.fallen) break; // your island fell: the game ends here
      }
      const after = snap(g), n = g.turn + 1;
      g.reports.push(report(g, g.before, after, recordsBetween(g, g.dayFrom, stateOf(gdir(g.id)).day), n));
      g.turn = n; g.turnFrom = null; g.before = null; g.dayFrom = null;
      if (g.turn >= GAME.turns || after[g.mine]?.fallen) finish(g, after);
      else save(g);
    } catch (e) { g.error = String(e.message || e).slice(0, 300); save(g); }
    finally { running.delete(g.id); }
  });
}

function finish(g, after) {
  const me = after[g.mine], start = g.start || {};
  const ai = g.nations.map((id) => ({ id, name: after[id]?.name ?? start[id]?.name, gain: after[id]?.rev != null && start[id]?.rev != null ? +(after[id].rev - start[id].rev).toFixed(1) : null, fallen: !!after[id]?.fallen }));
  const result = { gain: +((me?.rev ?? GAME.startRev) - GAME.startRev).toFixed(1), reverence: me?.rev ?? null, fell: !!me?.fallen, turns: g.turn, ai, finished_at: Date.now() };
  g.status = "finished"; g.result = result;
  // A free game is deleted the moment it ends (his call 27 Nov). What the player keeps is the result line.
  setOwner(g.owner, { current: null, last: { id: g.id, name: g.name, field: g.field, result, nations: ai.map((x) => x.name), reports: g.reports } });
  stopChild(g.id);
  wipe(g.id);
}

function quit(g) {
  if (running.has(g.id)) throw Object.assign(new Error("Wait for this turn to finish playing out."), { code: 409 });
  stopChild(g.id);
  const o = owners()[g.owner];
  if (o?.current === g.id) setOwner(g.owner, { ...o, current: null });
  wipe(g.id);
}

function view(g) {
  const r = running.get(g.id);
  const live = g.status === "playing" || g.status === "finished" ? snapSafe(g) : null;
  return {
    id: g.id, status: g.status, error: g.error ?? null, turn: g.turn, turns: GAME.turns, per_turn: GAME.perTurn,
    running: r ? { what: r.what, done: r.done, of: r.target } : null,
    purse: g.purse ?? null, name: g.name ?? null, field: g.field ?? null, mine: g.mine, fields: FIELDS,
    drawn: g.drawn ?? g.nations.map((id) => { const s = g.start?.[id] ?? live?.[id]; const lw = liveWorld?.clans?.find((c) => c.id === id); return { id, name: s?.name ?? lw?.name ?? `nation ${id}`, field: s?.field ?? null, florins: s?.florins ?? lw?.florins ?? null, points: s?.points ?? null }; }),
    nations: live ? Object.values(live) : null,
    gain: live?.[g.mine]?.rev != null ? +(live[g.mine].rev - GAME.startRev).toFixed(1) : null,
    report: g.reports.at(-1) ?? null, reports: g.reports.length,
    result: g.result ?? null,
  };
}

// ---- HTTP ----
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => { b += d; if (b.length > 4096) req.destroy(); }); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });

export async function handleGame(req, res, url, { verify } = {}) {
  const parts = url.pathname.split("/").filter(Boolean); // ["sbx", "game", id|action, action?, ...]
  try {
    if (parts.length === 2) return json(res, 200, { turns: GAME.turns, per_turn: GAME.perTurn, ai: GAME.ai, fields: FIELDS, purse_over: GAME.purseOver, start_reverence: GAME.startRev });
    // The copy's own API for the 3D page: no log-in (the game id is the key; nothing in it is private).
    if (parts[3] === "api") {
      const g = load(parts[2]);
      if (!g || g.status !== "playing") return json(res, 404, { error: "no such game" });
      const k = await child(g);
      const p = http.request({ host: "127.0.0.1", port: k.port, path: "/" + parts.slice(3).join("/") + url.search, method: "GET" }, (r) => { res.writeHead(r.statusCode, { "content-type": r.headers["content-type"] || "application/json", "cache-control": "no-store" }); r.pipe(res); });
      p.on("error", () => json(res, 502, { error: "the game didn't answer" }));
      return p.end();
    }
    if (!verify) return json(res, 503, { error: "Log-in isn't available here." });
    const owner = await verify(req.headers["x-adf-email"], req.headers["x-adf-auth"]);
    if (!owner) return json(res, 401, { error: "Log in with your email to play." });
    if (parts[2] === "mine") {
      const o = owners()[owner] || {}, g = o.current ? load(o.current) : null;
      return json(res, 200, { game: g ? view(g) : null, last: o.last ? { id: o.last.id, name: o.last.name, field: o.last.field, result: o.last.result, nations: o.last.nations, reports: o.last.reports } : null });
    }
    if (parts[2] === "new") { if (req.method !== "POST") return json(res, 405, { error: "POST" }); return json(res, 200, view(await newGame(owner))); }
    const g = load(parts[2]);
    if (!g || g.owner !== owner) return json(res, 404, { error: "No such game for this log-in. A finished free game is deleted when it ends." });
    const act = parts[3];
    if (act === "state") return json(res, 200, view(g));
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const b = await body(req);
    if (act === "found") return json(res, 200, view(found(g, b)));
    if (act === "end-turn") { endTurn(g); return json(res, 200, view(g)); }
    if (act === "quit") { quit(g); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: "unknown" });
  } catch (e) { return json(res, e.code || 500, { error: String(e.message || e).slice(0, 300) }); }
}
