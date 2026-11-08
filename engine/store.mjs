// Where the world lives off chain. Postgres when DATABASE_URL is set (Railway), local files
// otherwise (development on this PC). Records are kept per day with their Merkle leaf, so the
// site can hand anyone a proof against the root stored on NEAR.
import fs from "node:fs";
import pg from "pg";
import { sha256, leafOf } from "./world.mjs";

const URL = process.env.DATABASE_URL;
// Local files live here (the fast-forward simulation uses its own folder: ADF_STATE_DIR).
const DIR = process.env.ADF_STATE_DIR || "engine/state";
const pool = URL ? new pg.Pool({ connectionString: URL, max: 8 }) : null;
let ready = null;

async function db() {
  if (!pool) return null;
  ready ||= pool.query(`
    create table if not exists world_state (net text primary key, state jsonb not null, updated_at timestamptz default now());
    create table if not exists records (net text, day int, idx int, kind text, data jsonb not null, leaf text not null, primary key (net, day, idx));
    create table if not exists drafts (net text, id text, clan int, day int, passed boolean, data jsonb not null, primary key (net, id));
    create table if not exists roots (net text, day int, root text not null, tx text, primary key (net, day));
    create table if not exists papers_cache (key text primary key, papers jsonb not null);
    alter table records add column if not exists raw text;
    create table if not exists sponsored (net text, account text, at timestamptz default now(), tx text, primary key (net, account));
    create table if not exists llm_spend (date text primary key, usd double precision not null default 0);
  `);
  await ready;
  return pool;
}

// Testnet founders the sponsor pool has topped up (once per account; SPEC §12m C).
export async function wasSponsored(net, account) {
  const p = await db();
  if (p) return (await p.query("select 1 from sponsored where net = $1 and account = $2", [net, account])).rowCount > 0;
  const f = `${DIR}/sponsored.json`;
  return fs.existsSync(f) && !!JSON.parse(fs.readFileSync(f, "utf8"))[`${net}:${account}`];
}
export async function markSponsored(net, account, tx) {
  const p = await db();
  if (p) { await p.query("insert into sponsored (net, account, tx) values ($1, $2, $3) on conflict do nothing", [net, account, tx]); return; }
  const f = `${DIR}/sponsored.json`;
  const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  m[`${net}:${account}`] = { tx, at: Date.now() };
  fs.writeFileSync(f, JSON.stringify(m));
}

// Claude spend per UTC day, for the whole engine (his cap, 8 Nov: $0.50 a day on ALL Claude calls).
// One ledger for every network, and a world wipe never touches it (a per-world counter reset on
// the 7 Nov wipe and let that day go past the cap).
const SPEND_FILE = `${DIR}/llm_spend.json`;
export async function spendOn(date) {
  const p = await db();
  if (p) return Number((await p.query("select usd from llm_spend where date = $1", [date])).rows[0]?.usd ?? 0);
  return fs.existsSync(SPEND_FILE) ? Number(JSON.parse(fs.readFileSync(SPEND_FILE, "utf8"))[date] ?? 0) : 0;
}
export async function addSpend(date, usd) {
  if (!(usd > 0)) return;
  const p = await db();
  if (p) { await p.query("insert into llm_spend (date, usd) values ($1, $2) on conflict (date) do update set usd = llm_spend.usd + excluded.usd", [date, usd]); return; }
  const m = fs.existsSync(SPEND_FILE) ? JSON.parse(fs.readFileSync(SPEND_FILE, "utf8")) : {};
  m[date] = (m[date] ?? 0) + usd;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(SPEND_FILE, JSON.stringify(m));
}

const EMPTY = () => ({ day: 0, clans: {}, corpora: {}, drafts: {}, gifts: {}, tools: {}, ruins: {}, roots: {}, nextId: 1 });

export async function loadState(net) {
  const p = await db();
  if (p) {
    const r = await p.query("select state from world_state where net = $1", [net]);
    return r.rows[0]?.state ?? EMPTY();
  }
  fs.mkdirSync(`${DIR}/${net}`, { recursive: true });
  const f = `${DIR}/${net}.json`;
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : EMPTY();
}

/**
 * The world this network's saved state belongs to (SPEC §14, wipe day). On TESTNET only: if the
 * engine is pointed at a different world contract than the one its state was built for, that
 * network's state, records, roots and drafts are deleted and a fresh state starts. The papers
 * cache and the sponsored-accounts list are kept. Mainnet is never wiped here.
 */
export async function ensureWorld(net, world) {
  const s = await loadState(net);
  const used = s.day > 0 || Object.keys(s.clans || {}).length > 0;
  if (s.world === world || (!used && !s.world)) {
    if (!s.world) { s.world = world; await saveState(net, s); }
    return s;
  }
  if (net !== "testnet") throw new Error(`${net} state belongs to ${s.world ?? "an older world"}, not ${world}: refusing to touch it`);
  const p = await db();
  if (p) for (const t of ["records", "drafts", "roots", "world_state"]) await p.query(`delete from ${t} where net = $1`, [net]);
  else {
    fs.rmSync(`${DIR}/${net}`, { recursive: true, force: true });
    fs.rmSync(`${DIR}/${net}.json`, { force: true });
  }
  console.log(`  ${net}: new world ${world} (was ${s.world ?? "an older world"}): old state, days, roots and drafts cleared`);
  const fresh = { ...EMPTY(), world };
  await saveState(net, fresh);
  return fresh;
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
  fs.writeFileSync(`${DIR}/${net}.json`, JSON.stringify(s, null, 1));
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
        // raw = exact text as written; leaf = canonical hash (what the day root is built from).
        await c.query("insert into records (net, day, idx, kind, data, leaf, raw) values ($1,$2,$3,$4,$5,$6,$7)", [net, day, i, r.kind, r, leafOf(r), JSON.stringify(r)]);
      }
      // root null = a checkpoint mid-day (records so far); the root row comes at the end of the day.
      if (root) await c.query("insert into roots (net, day, root, tx) values ($1,$2,$3,$4) on conflict (net, day) do update set root = $3, tx = $4", [net, day, root, tx]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
    return;
  }
  fs.writeFileSync(`${DIR}/${net}/day-${day}.json`, JSON.stringify(records, null, 1));
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
  fs.writeFileSync(`${DIR}/${net}/${d.id}.json`, JSON.stringify(d, null, 1));
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
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(fileCache));
}

export async function close() {
  if (pool) await pool.end();
}

// ---- reads for the website API ----
export async function getDay(net, day) {
  const p = await db();
  if (p) {
    const r = await p.query("select idx, kind, data, leaf, raw from records where net = $1 and day = $2 order by idx", [net, day]);
    const root = (await p.query("select root, tx from roots where net = $1 and day = $2", [net, day])).rows[0] ?? null;
    return { records: r.rows.map((x) => x.data), raws: r.rows.map((x) => x.raw), leaves: r.rows.map((x) => x.leaf), root: root?.root ?? null, tx: root?.tx ?? null };
  }
  const f = `${DIR}/${net}/day-${day}.json`;
  if (!fs.existsSync(f)) return { records: [], leaves: [], root: null, tx: null };
  const records = JSON.parse(fs.readFileSync(f, "utf8"));
  const s = JSON.parse(fs.readFileSync(`${DIR}/${net}.json`, "utf8"));
  const raws = records.map((r) => JSON.stringify(r));
  // Days written before canonical hashing used the raw text as the leaf.
  const canonRoot = s.roots?.[day];
  const leaves = records.map(leafOf);
  return { records, raws, leaves, legacyLeaves: raws.map(sha256), root: canonRoot ?? null, tx: null };
}

export async function getDraft(net, id) {
  const p = await db();
  if (p) return (await p.query("select data from drafts where net = $1 and id = $2", [net, id])).rows[0]?.data ?? null;
  const f = `${DIR}/${net}/${id}.json`;
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

export async function listDrafts(net, limit = 30, clan = null) {
  const p = await db();
  if (p && clan != null) return (await p.query("select id, clan, day, passed, data->'draft'->>'title' as title from drafts where net = $1 and clan = $3 order by day desc, id desc limit $2", [net, limit, clan])).rows;
  if (p) return (await p.query("select id, clan, day, passed, data->'draft'->>'title' as title from drafts where net = $1 order by day desc, id desc limit $2", [net, limit])).rows;
  return [];
}
