// Where the world lives off chain. Postgres when DATABASE_URL is set (Railway), local files
// otherwise (development on this PC). Records are kept per day with their Merkle leaf, so the
// site can hand anyone a proof against the root stored on NEAR.
import fs from "node:fs";
import pg from "pg";
import { sha256 } from "./world.mjs";

const URL = process.env.DATABASE_URL;
const pool = URL ? new pg.Pool({ connectionString: URL, max: 3 }) : null;
let ready = null;

async function db() {
  if (!pool) return null;
  ready ||= pool.query(`
    create table if not exists world_state (net text primary key, state jsonb not null, updated_at timestamptz default now());
    create table if not exists records (net text, day int, idx int, kind text, data jsonb not null, leaf text not null, primary key (net, day, idx));
    create table if not exists drafts (net text, id text, clan int, day int, passed boolean, data jsonb not null, primary key (net, id));
    create table if not exists roots (net text, day int, root text not null, tx text, primary key (net, day));
    create table if not exists papers_cache (key text primary key, papers jsonb not null);
  `);
  await ready;
  return pool;
}

const EMPTY = () => ({ day: 0, clans: {}, corpora: {}, drafts: {}, gifts: {}, tools: {}, ruins: {}, roots: {}, nextId: 1 });

export async function loadState(net) {
  const p = await db();
  if (p) {
    const r = await p.query("select state from world_state where net = $1", [net]);
    return r.rows[0]?.state ?? EMPTY();
  }
  fs.mkdirSync(`engine/state/${net}`, { recursive: true });
  const f = `engine/state/${net}.json`;
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : EMPTY();
}

export async function saveState(net, s) {
  const p = await db();
  if (p) {
    await p.query(
      "insert into world_state (net, state, updated_at) values ($1, $2, now()) on conflict (net) do update set state = $2, updated_at = now()",
      [net, s],
    );
    return;
  }
  fs.writeFileSync(`engine/state/${net}.json`, JSON.stringify(s, null, 1));
}

/** The day's records, root and the tx that put the root on chain. */
export async function saveDay(net, day, records, root, tx) {
  const p = await db();
  if (p) {
    const c = await p.connect();
    try {
      await c.query("begin");
      await c.query("delete from records where net = $1 and day = $2", [net, day]);
      for (const [i, r] of records.entries()) {
        await c.query("insert into records (net, day, idx, kind, data, leaf) values ($1,$2,$3,$4,$5,$6)", [net, day, i, r.kind, r, sha256(JSON.stringify(r))]);
      }
      await c.query("insert into roots (net, day, root, tx) values ($1,$2,$3,$4) on conflict (net, day) do update set root = $3, tx = $4", [net, day, root, tx]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
    return;
  }
  fs.writeFileSync(`engine/state/${net}/day-${day}.json`, JSON.stringify(records, null, 1));
}

export async function saveDraft(net, d) {
  const p = await db();
  if (p) {
    await p.query(
      "insert into drafts (net, id, clan, day, passed, data) values ($1,$2,$3,$4,$5,$6) on conflict (net, id) do update set data = $6, passed = $5",
      [net, d.id, d.clan, d.day, d.passed, d],
    );
    return;
  }
  fs.writeFileSync(`engine/state/${net}/${d.id}.json`, JSON.stringify(d, null, 1));
}

const CACHE = "engine/state/papers-cache.json";
let fileCache = null;
export async function getPapers(key) {
  const p = await db();
  if (p) return (await p.query("select papers from papers_cache where key = $1", [key])).rows[0]?.papers ?? null;
  fileCache ||= fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  return fileCache[key] ?? null;
}
export async function putPapers(key, papers) {
  const p = await db();
  if (p) return void (await p.query("insert into papers_cache (key, papers) values ($1,$2) on conflict (key) do nothing", [key, JSON.stringify(papers)]));
  fileCache ||= fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  fileCache[key] = papers;
  fs.mkdirSync("engine/state", { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(fileCache));
}

export async function close() {
  if (pool) await pool.end();
}
