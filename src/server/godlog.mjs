// Everything an AI god has done (his ask 16 Nov: the god's card lists every action it took, newest first). Two
// tables hold it: ai_actions (what the engine sent as that god, and how it went) and choices (its free, signed
// picks: the Scholars' pitch, asking the accused, a word to the Broker, ignoring a report). Read-only, its own
// small pool, so the web service never touches the engine's code. Pure merge in godLog(); tested in
// tests/god-card.test.mjs. Failed tries are left out (his call 17 Nov).
import pg from "pg";

const LIMIT = 400;
let pool = null;
const db = () => (process.env.DATABASE_URL ? (pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })) : null);

/** rows: ai_actions rows { at, action, result }; choices: { day, clan, kind, payload, at }. Newest first, at most `limit`. */
export function godLog(rows = [], choices = [], limit = LIMIT) {
  const out = [];
  for (const r of rows) {
    const a = typeof r.action === "string" ? JSON.parse(r.action) : r.action || {};
    const res = String(r.result || "");
    const ok = /^ok/.test(res);
    if (!ok) continue; // his call 17 Nov: the card shows what the god did, not the tries that failed
    out.push({
      at: Number(r.at), kind: a.kind, clan: a.clan ?? null, ok,
      ...(a.text ? { text: String(a.text).slice(0, 280) } : {}), ...(a.near != null ? { near: a.near } : {}),
      ...(a.target != null ? { target: a.target } : {}), ...(a.gift != null ? { gift: a.gift } : {}), ...(a.agent ? { agent: a.agent, verdict: a.verdict } : {}),
      ...(a.listing != null ? { listing: a.listing } : {}),
      tx: res.split(/\s+/)[1] || null,
    });
  }
  for (const c of choices) {
    const p = typeof c.payload === "string" ? JSON.parse(c.payload) : c.payload || {};
    out.push({ at: c.at instanceof Date ? c.at.getTime() : Number(new Date(c.at)), kind: c.kind, clan: c.clan, ok: true, day: c.day, ...(p.point ? { point: p.point } : {}), ...(p.report ? { report: p.report } : {}), ...(p.tokens ? { tokens: p.tokens.length } : {}) });
  }
  return out.filter((x) => x.kind && Number.isFinite(x.at)).sort((a, b) => b.at - a.at).slice(0, limit);
}

/** The god's log from the database ([] with no database: a local copy proxies the live site). */
export async function readGodLog(net, god) {
  const p = db();
  if (!p) return [];
  const [a, c] = await Promise.all([
    p.query("select at, action, result from ai_actions where net = $1 and god = $2 and done = true order by at desc limit $3", [net, god, LIMIT]),
    p.query("select day, clan, kind, payload, at from choices where net = $1 and account = $2 order by at desc limit $3", [net, god, LIMIT]),
  ]);
  return godLog(a.rows, c.rows);
}
