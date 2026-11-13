// Where the world lives off chain. Postgres when DATABASE_URL is set (Railway), local files
// otherwise (development on this PC). Records are kept per day with their Merkle leaf, so the
// site can hand anyone a proof against the root stored on NEAR.
import fs from "node:fs";
import pg from "pg";
import { sha256, leafOf } from "./world.mjs";
import { nameFor } from "./godnames.mjs";

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
    create table if not exists logins (id text primary key, net text not null, account text not null, salt text not null, auth text not null, iv text not null, ct text not null, at timestamptz default now());
    create table if not exists god_names (account text primary key, name text unique not null, at timestamptz default now());
    create table if not exists choices (net text not null, day int not null, clan int not null, kind text not null, account text not null, payload jsonb not null, at timestamptz default now(), primary key (net, day, clan, kind));
    create table if not exists ai_gods (account text primary key, net text not null, name text not null, temperament text, at timestamptz default now());
    create table if not exists ai_actions (id serial primary key, net text not null, at bigint not null, god text not null, action jsonb not null, done boolean not null default false, result text);
    create table if not exists seats (id serial primary key, net text not null, clan int not null, seller text not null, price text not null, status text not null default 'open', buyer text, at bigint not null, updated timestamptz default now());
    create table if not exists seat_buys (tx text primary key, net text not null, listing int not null, buyer text not null, amount text not null, status text not null default 'waiting', claimed text, result jsonb, at bigint not null, sealed boolean not null default false);
  `);
  await ready;
  return pool;
}

// Email log-ins (11 Nov): id = a peppered hash of the email (the email itself is never stored), auth =
// a hash of the login token the browser derives from the passphrase, ct = the NEAR key encrypted in
// the browser with a key from the same passphrase. Nothing here can sign anything.
// God names (12 Nov, engine/godnames.mjs): each account gets one name for good, never shared. The table's
// unique name column settles two servers naming at once: the loser re-reads and takes the next free one.
const NAMES_FILE = () => `${DIR}/god_names.json`;
/** Give an account a chosen name (an AI god's own), replacing any name the site gave it first. False if another
 *  account already holds that name. */
export async function claimGodName(account, name) {
  const p = await db();
  if (p) {
    try { return (await p.query("insert into god_names (account, name) values ($1, $2) on conflict (account) do update set name = excluded.name", [account, name])).rowCount === 1; }
    catch { return false; } // the name belongs to another account
  }
  const all = fs.existsSync(NAMES_FILE()) ? JSON.parse(fs.readFileSync(NAMES_FILE(), "utf8")) : {};
  if (Object.entries(all).some(([a, n]) => n === name && a !== account)) return false;
  all[account] = name; fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(NAMES_FILE(), JSON.stringify(all)); return true;
}
/** A sold AI seat (engine/seats.mjs takesName): the AI god's name goes to the buyer, whose own name (if the site gave
 *  them one) is let go. */
export async function moveGodName(from, to) {
  const p = await db();
  if (p) {
    const c = await p.connect();
    try { await c.query("begin"); await c.query("delete from god_names where account = $1", [to]); await c.query("update god_names set account = $2 where account = $1", [from, to]); await c.query("commit"); }
    catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    return;
  }
  const all = fs.existsSync(NAMES_FILE()) ? JSON.parse(fs.readFileSync(NAMES_FILE(), "utf8")) : {};
  if (!(from in all)) return;
  all[to] = all[from]; delete all[from];
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(NAMES_FILE(), JSON.stringify(all));
}
// Signed choices (13 Nov, engine/choices.mjs): one per kind, nation and turn; a new one replaces the old.
const CHOICES_FILE = () => `${DIR}/choices.json`;
export async function putChoice(net, row) {
  const p = await db();
  if (p) return void (await p.query("insert into choices (net, day, clan, kind, account, payload) values ($1,$2,$3,$4,$5,$6) on conflict (net, day, clan, kind) do update set account = excluded.account, payload = excluded.payload, at = now()", [net, row.day, row.clan, row.kind, row.account, JSON.stringify(row.payload)]));
  const all = fs.existsSync(CHOICES_FILE()) ? JSON.parse(fs.readFileSync(CHOICES_FILE(), "utf8")) : {};
  all[`${net}|${row.day}|${row.clan}|${row.kind}`] = { ...row, net, at: Date.now() };
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(CHOICES_FILE(), JSON.stringify(all));
}
export async function choicesFor(net, day) {
  const p = await db();
  if (p) return (await p.query("select day, clan, kind, account, payload from choices where net = $1 and day = $2", [net, day])).rows;
  const all = fs.existsSync(CHOICES_FILE()) ? JSON.parse(fs.readFileSync(CHOICES_FILE(), "utf8")) : {};
  return Object.values(all).filter((r) => r.net === net && r.day === Number(day)).map(({ net: _n, at: _a, ...r }) => r);
}
/** Choices of these kinds made after `sinceMs` (asks, step 2; Broker list requests, step 3): the loop gives their
 *  nations an instant turn, so the answer comes in seconds. */
export async function choicesSince(net, sinceMs, kinds = ["ask"]) {
  const p = await db();
  if (p) return (await p.query("select day, clan, kind, account, payload, (extract(epoch from at) * 1000)::float8 as at from choices where net = $1 and kind = any($3) and at > to_timestamp($2 / 1000.0)", [net, sinceMs, kinds])).rows;
  const all = fs.existsSync(CHOICES_FILE()) ? JSON.parse(fs.readFileSync(CHOICES_FILE(), "utf8")) : {};
  return Object.values(all).filter((r) => r.net === net && kinds.includes(r.kind) && (r.at || 0) > sinceMs).map(({ net: _n, ...r }) => r);
}
// Seat trading (PLAN_13NOV step 4, engine/seats.mjs): listings (one open per seller and nation; a new price
// cancels the old one) and buys (one per payment; waiting -> working -> filled | refunded | rejected, or pay-due /
// refund-due to retry). Finished buys are sealed as records once by engine/run.mjs.
const SEATS_FILE = () => `${DIR}/seats.json`;
const seatsFile = () => (fs.existsSync(SEATS_FILE()) ? JSON.parse(fs.readFileSync(SEATS_FILE(), "utf8")) : { next: 1, seats: [], buys: [] });
const seatsSave = (all) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(SEATS_FILE(), JSON.stringify(all)); };
const RETRY = ["waiting", "pay-due", "refund-due"];
const seatRow = (r) => (r ? { id: Number(r.id), clan: Number(r.clan), seller: r.seller, price: String(r.price), status: r.status, buyer: r.buyer ?? null, at: Number(r.at) } : null);
const buyRow = (r) => (r ? { tx: r.tx, listing: Number(r.listing), buyer: r.buyer, amount: String(r.amount), status: r.status, result: r.result ?? null, at: Number(r.at) } : null);
export async function seatList(net, { clan, seller, price, at }) {
  const p = await db();
  if (p) {
    await p.query("update seats set status = 'cancelled', updated = now() where net = $1 and clan = $2 and seller = $3 and status = 'open'", [net, clan, seller]);
    return Number((await p.query("insert into seats (net, clan, seller, price, at) values ($1,$2,$3,$4,$5) returning id", [net, clan, seller, String(price), at])).rows[0].id);
  }
  const all = seatsFile();
  for (const x of all.seats) if (x.net === net && x.clan === clan && x.seller === seller && x.status === "open") x.status = "cancelled";
  const id = all.next++;
  all.seats.push({ id, net, clan, seller, price: String(price), status: "open", buyer: null, at });
  seatsSave(all);
  return id;
}
export async function seatUnlist(net, clan, seller, at) {
  const p = await db();
  if (p) return void (await p.query("update seats set status = 'cancelled', at = greatest(at, $4), updated = now() where net = $1 and clan = $2 and seller = $3 and status = 'open'", [net, clan, seller, at]));
  const all = seatsFile();
  for (const x of all.seats) if (x.net === net && x.clan === clan && x.seller === seller && x.status === "open") { x.status = "cancelled"; x.at = Math.max(x.at, at); }
  seatsSave(all);
}
export async function seatGet(net, id) {
  const p = await db();
  if (p) return seatRow((await p.query("select * from seats where net = $1 and id = $2", [net, id])).rows[0]);
  return seatRow(seatsFile().seats.find((x) => x.net === net && x.id === Number(id)));
}
export async function seatsOpen(net) {
  const p = await db();
  if (p) return (await p.query("select * from seats where net = $1 and status = 'open' order by id desc", [net])).rows.map(seatRow);
  return seatsFile().seats.filter((x) => x.net === net && x.status === "open").reverse().map(seatRow);
}
export async function seatsSold(net, limit = 20) {
  const p = await db();
  if (p) return (await p.query("select * from seats where net = $1 and status = 'sold' order by id desc limit $2", [net, limit])).rows.map(seatRow);
  return seatsFile().seats.filter((x) => x.net === net && x.status === "sold").reverse().slice(0, limit).map(seatRow);
}
/** The newest signed time this seller used for this nation (a replayed older message is refused). */
export async function seatLastAt(net, clan, seller) {
  const p = await db();
  if (p) return Number((await p.query("select coalesce(max(at), 0) as at from seats where net = $1 and clan = $2 and seller = $3", [net, clan, seller])).rows[0].at);
  return Math.max(0, ...seatsFile().seats.filter((x) => x.net === net && x.clan === clan && x.seller === seller).map((x) => x.at));
}
export async function seatSetStatus(net, id, status, buyer) {
  const p = await db();
  if (p) return void (await p.query("update seats set status = $3, buyer = $4, updated = now() where net = $1 and id = $2", [net, id, status, buyer]));
  const all = seatsFile();
  const x = all.seats.find((r) => r.net === net && r.id === Number(id));
  if (x) { x.status = status; x.buyer = buyer; }
  seatsSave(all);
}
/** Note a buy. False when this payment was already used. */
export async function seatBuy(net, { tx, listing, buyer, amount }) {
  const p = await db();
  if (p) return (await p.query("insert into seat_buys (tx, net, listing, buyer, amount, at) values ($1,$2,$3,$4,$5,$6) on conflict (tx) do nothing", [tx, net, listing, buyer, String(amount), Date.now()])).rowCount === 1;
  const all = seatsFile();
  if (all.buys.some((b) => b.tx === tx)) return false;
  all.buys.push({ tx, net, listing: Number(listing), buyer, amount: String(amount), status: "waiting", claimed: null, result: null, at: Date.now(), sealed: false });
  seatsSave(all);
  return true;
}
export async function seatBuysWaiting(net) {
  const p = await db();
  if (p) return (await p.query("select * from seat_buys where net = $1 and status = any($2) order by at", [net, RETRY])).rows.map(buyRow);
  return seatsFile().buys.filter((b) => b.net === net && RETRY.includes(b.status)).map(buyRow);
}
/** Take a buy to work on it. Returns the status it had (so a pay-due one only retries the payment), or null when
 *  someone else already has it. */
export async function seatBuyClaim(net, tx) {
  const p = await db();
  if (p) return (await p.query("update seat_buys set claimed = status, status = 'working' where net = $1 and tx = $2 and status = any($3) returning claimed", [net, tx, RETRY])).rows[0]?.claimed ?? null;
  const all = seatsFile();
  const b = all.buys.find((x) => x.net === net && x.tx === tx && RETRY.includes(x.status));
  if (!b) return null;
  b.claimed = b.status; b.status = "working";
  seatsSave(all);
  return b.claimed;
}
export async function seatBuyFinish(net, tx, status, result) {
  const p = await db();
  if (p) return void (await p.query("update seat_buys set status = $3, result = $4 where net = $1 and tx = $2", [net, tx, status, JSON.stringify(result)]));
  const all = seatsFile();
  const b = all.buys.find((x) => x.net === net && x.tx === tx);
  if (b) { b.status = status; b.result = result; }
  seatsSave(all);
}
export async function seatBuysOf(net, buyer) {
  const p = await db();
  if (p) return (await p.query("select * from seat_buys where net = $1 and buyer = $2 order by at desc limit 10", [net, buyer])).rows.map(buyRow);
  return seatsFile().buys.filter((b) => b.net === net && b.buyer === buyer).reverse().slice(0, 10).map(buyRow);
}
/** Filled and refunded buys not yet sealed as records. */
export async function seatBuysUnsealed(net) {
  const p = await db();
  if (p) return (await p.query("select * from seat_buys where net = $1 and not sealed and status in ('filled', 'refunded') order by at", [net])).rows.map(buyRow);
  return seatsFile().buys.filter((b) => b.net === net && !b.sealed && (b.status === "filled" || b.status === "refunded")).map(buyRow);
}
export async function seatBuysSealed(txs) {
  if (!txs.length) return;
  const p = await db();
  if (p) return void (await p.query("update seat_buys set sealed = true where tx = any($1)", [txs]));
  const all = seatsFile();
  for (const b of all.buys) if (txs.includes(b.tx)) b.sealed = true;
  seatsSave(all);
}
export const asksSince = (net, sinceMs) => choicesSince(net, sinceMs, ["ask"]);
/** Every name given so far. */
export async function takenNames() {
  const p = await db();
  if (p) return (await p.query("select name from god_names")).rows.map((r) => r.name);
  return Object.values(fs.existsSync(NAMES_FILE()) ? JSON.parse(fs.readFileSync(NAMES_FILE(), "utf8")) : {});
}
export async function godNames(accounts) {
  const want = [...new Set((accounts || []).filter(Boolean).map(String))];
  const p = await db();
  const byAcct = new Map(), taken = new Set();
  if (!p) {
    const all = fs.existsSync(NAMES_FILE()) ? JSON.parse(fs.readFileSync(NAMES_FILE(), "utf8")) : {};
    for (const [a, n] of Object.entries(all)) { byAcct.set(a, n); taken.add(n); }
    let changed = false;
    for (const a of want.sort()) if (!byAcct.has(a)) { const n = nameFor(a, taken); byAcct.set(a, n); taken.add(n); all[a] = n; changed = true; }
    if (changed) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(NAMES_FILE(), JSON.stringify(all)); }
    return Object.fromEntries(want.map((a) => [a, byAcct.get(a)]));
  }
  for (const r of (await p.query("select account, name from god_names")).rows) { byAcct.set(r.account, r.name); taken.add(r.name); }
  for (const a of want) {
    for (let tries = 0; !byAcct.has(a) && tries < 8; tries++) {
      const n = nameFor(a, taken);
      const r = await p.query("insert into god_names (account, name) values ($1, $2) on conflict do nothing", [a, n]);
      if (r.rowCount === 1) { byAcct.set(a, n); taken.add(n); break; }
      for (const x of (await p.query("select account, name from god_names where account = $1 or name = $2", [a, n])).rows) { taken.add(x.name); if (x.account === a) byAcct.set(a, x.name); }
    }
  }
  return Object.fromEntries(want.map((a) => [a, byAcct.get(a) ?? nameFor(a, taken)]));
}

// AI gods (12 Nov, engine/aigods.mjs): who they are, and the actions waiting to go out over the 2 hours.
const AI_FILE = () => `${DIR}/ai.json`;
const aiFile = () => (fs.existsSync(AI_FILE()) ? JSON.parse(fs.readFileSync(AI_FILE(), "utf8")) : { gods: {}, actions: [], next: 1 });
const aiSave = (m) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(AI_FILE(), JSON.stringify(m)); };
export async function aiGods(net) {
  const p = await db();
  if (p) return (await p.query("select account, name, temperament from ai_gods where net = $1", [net])).rows;
  return Object.values(aiFile().gods).filter((g) => g.net === net);
}
/** An AI god that sold its seat (engine/seats.mjs): it sits nowhere now, so the engine stops planning for it. */
export async function removeAiGod(net, account) {
  const p = await db();
  if (p) { await p.query("delete from ai_gods where net = $1 and account = $2", [net, account]); await p.query("update ai_actions set done = true, result = 'sold its seat' where net = $1 and god = $2 and not done", [net, account]); return; }
  const m = aiFile(); delete m.gods[account]; aiSave(m);
}
export async function addAiGod(net, account, name, temperament) {
  const p = await db();
  if (p) return void (await p.query("insert into ai_gods (account, net, name, temperament) values ($1,$2,$3,$4) on conflict (account) do nothing", [account, net, name, temperament]));
  const m = aiFile(); m.gods[account] ||= { account, net, name, temperament }; aiSave(m);
}
/** Queue planned actions: [{ at, god, ...action }]. Anything still waiting from the last plan is dropped first. */
export async function queueAiActions(net, list) {
  const p = await db();
  if (p) {
    await p.query("delete from ai_actions where net = $1 and done = false", [net]);
    for (const a of list) { const { at, god, ...action } = a; await p.query("insert into ai_actions (net, at, god, action) values ($1,$2,$3,$4)", [net, at, god, JSON.stringify(action)]); }
    return;
  }
  const m = aiFile(); m.actions = m.actions.filter((x) => x.net !== net || x.done);
  for (const a of list) { const { at, god, ...action } = a; m.actions.push({ id: m.next++, net, at, god, action, done: false, result: null }); }
  aiSave(m);
}
export async function dueAiActions(net, now, limit = 3) {
  const p = await db();
  if (p) return (await p.query("select id, at, god, action from ai_actions where net = $1 and done = false and result is null and at <= $2 order by at limit $3", [net, now, limit])).rows;
  return aiFile().actions.filter((x) => x.net === net && !x.done && x.result == null && x.at <= now).sort((a, b) => a.at - b.at).slice(0, limit);
}
/** Claim an action before sending it (13 Nov): true once; a restarted engine can never send it twice. */
export async function claimAiAction(id) {
  const p = await db();
  if (p) return (await p.query("update ai_actions set result = 'sending' where id = $1 and done = false and result is null", [id])).rowCount === 1;
  const m = aiFile(); const x = m.actions.find((y) => y.id === id);
  if (!x || x.done || x.result != null) return false;
  x.result = "sending"; aiSave(m); return true;
}
export async function finishAiAction(id, result) {
  const p = await db();
  if (p) return void (await p.query("update ai_actions set done = true, result = $2 where id = $1", [id, String(result).slice(0, 300)]));
  const m = aiFile(); const x = m.actions.find((y) => y.id === id); if (x) { x.done = true; x.result = String(result).slice(0, 300); } aiSave(m);
}
/** The queue at a glance: waiting, the next one's time, and today's sent / failed (the loop's status line). */
export async function aiQueueStatus(net, since) {
  const p = await db();
  if (p) {
    const r = (await p.query("select sum(case when not done then 1 else 0 end)::int waiting, min(case when not done then at end)::text next, sum(case when done and at >= $2 and result like 'ok%' then 1 else 0 end)::int sent, sum(case when done and at >= $2 and result like 'error%' then 1 else 0 end)::int failed from ai_actions where net = $1", [net, since])).rows[0];
    return { waiting: r.waiting || 0, next: r.next ? Number(r.next) : null, sent: r.sent || 0, failed: r.failed || 0 };
  }
  const a = aiFile().actions.filter((x) => x.net === net);
  const w = a.filter((x) => !x.done);
  return { waiting: w.length, next: w.length ? Math.min(...w.map((x) => x.at)) : null, sent: a.filter((x) => x.done && x.at >= since && /^ok/.test(x.result || "")).length, failed: a.filter((x) => x.done && x.at >= since && /^error/.test(x.result || "")).length };
}
/** Today's actions by one god (for its daily allowance and one Act of God a day). */
export async function aiActionsSince(net, god, since) {
  const p = await db();
  if (p) return (await p.query("select action, result from ai_actions where net = $1 and god = $2 and done = true and at >= $3", [net, god, since])).rows;
  return aiFile().actions.filter((x) => x.net === net && x.god === god && x.done && x.at >= since);
}

const LOGINS = () => `${DIR}/logins.json`;
const loginFile = () => (fs.existsSync(LOGINS()) ? JSON.parse(fs.readFileSync(LOGINS(), "utf8")) : {});
export async function getLogin(id) {
  const p = await db();
  if (p) return (await p.query("select * from logins where id = $1", [id])).rows[0] ?? null;
  return loginFile()[id] ?? null;
}
/** Adds a log-in; false if that email already has one. */
export async function addLogin(row) {
  const p = await db();
  if (p) return (await p.query("insert into logins (id, net, account, salt, auth, iv, ct) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing", [row.id, row.net, row.account, row.salt, row.auth, row.iv, row.ct])).rowCount === 1;
  const all = loginFile();
  if (all[row.id]) return false;
  all[row.id] = row; fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(LOGINS(), JSON.stringify(all));
  return true;
}
export async function deleteLogin(id) {
  const p = await db();
  if (p) return void (await p.query("delete from logins where id = $1", [id]));
  const all = loginFile(); delete all[id]; fs.writeFileSync(LOGINS(), JSON.stringify(all));
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

const CACHE = process.env.ADF_PAPERS_CACHE || "engine/state/papers-cache.json"; // the sandbox points copies at its own dump
let fileCache = null;
export async function getPapers(key) {
  const p = await db();
  if (p) return (await p.query("select papers from papers_cache where key = $1", [key])).rows[0]?.papers ?? null;
  fileCache ||= fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  return fileCache[key] ?? null;
}
/** Every cached search, from the file cache (copies of the world run on files, never the database). */
export function allPapers() {
  fileCache ||= fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  return fileCache;
}
/** The keys of every cached search with page size n ("query|n"), database or file (12 Nov: research reads the
 *  closest one once the day's OpenAlex share is used). */
export async function paperKeys(n) {
  const p = await db();
  if (p) return (await p.query("select key from papers_cache where key like $1", [`%|${n}`])).rows.map((r) => r.key);
  return Object.keys(allPapers()).filter((k) => k.endsWith(`|${n}`));
}
export async function putPapers(key, papers) {
  const p = await db();
  if (p) return void (await p.query("insert into papers_cache (key, papers) values ($1,$2) on conflict (key) do nothing", [key, JSON.stringify(papers)]));
  fileCache ||= fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  fileCache[key] = papers;
  fs.mkdirSync(CACHE.slice(0, CACHE.lastIndexOf("/")), { recursive: true }); // the cache's own folder, not the state folder
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
  if (p && clan != null) return (await p.query("select id, clan, day, passed, data->'draft'->>'title' as title, data->'chain' as chain from drafts where net = $1 and clan = $3 order by day desc, id desc limit $2", [net, limit, clan])).rows;
  if (p) return (await p.query("select id, clan, day, passed, data->'draft'->>'title' as title, data->'chain' as chain from drafts where net = $1 order by day desc, id desc limit $2", [net, limit])).rows;
  return [];
}
