// Web server (Railway "web" service): the built site from dist/ plus a read-only API.
// Everything the API says comes either from the NEAR contract (live view calls) or from the
// engine's records in Postgres, and any record can be proved against the root on NEAR.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider } from "near-api-js";
import { NETWORKS } from "./engine/config.mjs";
import * as store from "./engine/store.mjs";
import { clockAt, extendHours } from "./engine/clock.mjs";
import { SPONSOR, nationsLeft, balanceOf, topUp } from "./engine/sponsor.mjs";
import { chainDepth, deepestChain, merkleProof, rootFromLeaf, leafOf, sha256, FIELDS } from "./engine/world.mjs";

// Two worlds, one site (SPEC §12m B): every API call says which network it wants (?net=), and
// each network has its own chain connection, world contract and cache. SITE_NET is the default.
const DEFAULT_NET = process.env.SITE_NET || "testnet";
const PORT = Number(process.env.PORT || 3000);
const DIST = path.resolve("dist");
const near = (y) => Number(BigInt(y || 0) / 10n ** 18n) / 1e6;

// Small cache so a busy page doesn't hammer the RPC or the database.
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// Reverence (SPEC §12m) as the site sees it: who the nation follows and how much each god is revered.
// A nation's standing is the reverence of the god it follows.
function revOf(s, id) {
  const rv = s.rev?.[id];
  if (!rv) return null;
  const gods = Object.fromEntries(Object.entries(rv.gods).map(([a, g]) => [a, { r: Math.round(g.r * 10) / 10, enemies: g.enemies.length, outsider: !!g.outsider }]));
  return { followed: rv.followed, claimed_by: rv.claimedBy, waiting: !!rv.waiting, standing: rv.followed ? gods[rv.followed]?.r ?? 0 : 0, gods };
}
// Reports: open ones without the truth (the god must decide blind); settled ones with it.
function reportsOf(s, id) {
  return Object.values(s.reports || {}).filter((r) => r.clan === id).sort((a, b) => b.day - a.day).slice(0, 8)
    .map((r) => ({ id: r.id, day: r.day, accuser: r.accuser, accused: r.accused, claim: r.claim, settled: r.settled, ...(r.settled ? { outcome: r.outcome, truth: r.truth } : { lapses_day: r.day + 12 }) }));
}

function makeApi(NET) {
  const rpc = new JsonRpcProvider({ url: NETWORKS[NET].rpc });
  const WORLD = NETWORKS[NET].world;
  const view = (method, args = {}) => rpc.callFunction({ contractId: WORLD, method, args });
  const EXPLORER = NET === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  const cachedN = (key, ms, fn) => cached(`${NET}:${key}`, ms, fn);
  const clockCache = {}; // this network's season hours (seeded from the engine's state)
  const api = {
    // The world now: day, weather, clans (money from the chain, mind from the engine).
    async world() {
      return cachedN("world", 5_000, async () => {
        const [cfg, totals, clans, s] = await Promise.all([view("get_config"), view("get_totals"), view("list_clans", { limit: 100 }), store.loadState(NET)]);
        const last = await store.getDay(NET, s.day);
        const weather = last.records.find((r) => r.kind === "weather") ?? null;
        // The world clock now (SPEC §14), not as of the last engine turn: the sky turns on time.
        let clock = null;
        if (s.clock?.startNear) {
          if (clockCache.startNear !== s.clock.startNear || (s.clock.rows?.length || 0) > (clockCache.rows?.length || 0)) Object.assign(clockCache, { startNear: s.clock.startNear, rows: (s.clock.rows || []).slice() });
          try { await extendHours(clockCache, s.clock.startNear); } catch { /* feed down: last known hours */ }
          clock = clockAt(clockCache.rows, Date.now());
        }
        return {
          net: NET, world: WORLD, explorer: EXPLORER, day: cfg.day, season: cfg.season, paused: cfg.paused,
          weather, clock,
          totals: { balance: near(totals.balance), owed: near(totals.liabilities), burned: near(totals.burned), fees_paid: near(totals.fees_paid) },
        // Mainnet's season jackpot (SPEC §12m D): the fee account's balance (less its 0.01 NEAR
        // storage reserve) plus fees taken but not yet swept to it. Paid to the winner's gods.
        jackpot: NET === "mainnet" ? await rpc.query({ request_type: "view_account", finality: "final", account_id: cfg.treasury })
          .then((a) => ({ account: cfg.treasury, near: Math.max(0, near(a.amount) - 0.01) + near(totals.fees_pending) }), () => null) : null,
          clans: clans.map((c) => {
            const st = s.clans[c.id] || {};
            // Founded but not seen by the engine yet: predict its field exactly as the engine will
            // assign it (next field in turn, new nations in id order), so its island lands in the
            // right place at once instead of moving after the next run.
            if (!s.clans[c.id] && c.alive) {
              const unseen = clans.filter((x) => x.alive && !s.clans[x.id]).map((x) => x.id).sort((a, b) => a - b);
              st.field = FIELDS[(Object.keys(s.clans).length + unseen.indexOf(c.id)) % FIELDS.length];
            }
            return {
              id: c.id, name: c.name, dao: c.dao, alive: c.alive, gods: c.gods.length,
              play: near(c.play), reserve: near(c.reserve), total_in: near(c.total_in), clean_gifts: c.clean_gifts, whisper: c.whisper,
              field: st.field ?? null, mbti: st.mbti ?? null, fortune: st.fortune ?? 1,
              seen: !!s.clans[c.id], tricksters: st.tricksters ?? 0,
              points: Object.keys(st.owned || {}).length, depth: st.owned ? chainDepth(st) : 0,
              line: st.owned ? deepestChain(st) : [],
              reverence: revOf(s, c.id),
              // v2 (SPEC §14): techs unlocked, and the needs mood (hungry / content / sated)
              techs: st.techs ?? [], mood: st.mood ?? null, need: st.need ?? null,
            };
          }),
          ruins: Object.keys(s.ruins || {}).length,
          recent: last.records.filter((r) => r.kind !== "weather").slice(-30),
        };
      });
    },
  
    // One clan's mindmap and its agents.
    async clan(q) {
      const id = Number(q.get("id"));
      // ?d=<day> only splits the cache, so the live world can ask for the map right after a new day.
      const d = Number(q.get("d")) || 0;
      return cachedN(`clan:${id}:${d}`, 20_000, async () => {
        const [s, agents, drafts] = await Promise.all([store.loadState(NET), view("list_agents", { clan_id: id, limit: 100 }), store.listDrafts(NET, 12, id)]);
        const st = s.clans[id];
        if (!st) return { error: "no such clan" };
        const dead = st.alive === false;
        // A dead nation's points are ruins until another nation absorbs them ("taken").
        const points = Object.entries(st.owned).map(([k, v]) => ({
          point: k, parent: v.parent, depth: v.depth, how: v.how,
          corpus: v.corpus ? { id: v.corpus, title: s.corpora[v.corpus]?.title } : null,
          ...(dead && v.corpus ? { ruin: !!s.ruins?.[k] && s.ruins[k].from === id, taken: !s.ruins?.[k] } : {}),
        }));
        // Up to 40 points one step out (not owned yet), shallowest first: the faint edge of the map.
        const frontier = Object.entries(st.frontier).filter(([, v]) => st.owned[v.parent])
          .sort((a, b) => a[1].depth - b[1].depth || (a[0] < b[0] ? -1 : 1)).slice(0, 40)
          .map(([k, v]) => ({ point: k, parent: v.parent, depth: v.depth }));
        return {
          id, field: st.field, mbti: st.mbti, fortune: st.fortune, alive: !dead, points, frontier,
          frontier_total: Object.keys(st.frontier).length, line: deepestChain(st), depth: chainDepth(st),
          drafts: drafts.map((x) => ({ id: x.id, day: x.day, passed: x.passed, title: x.title })), agents,
          reverence: revOf(s, id), reports: reportsOf(s, id),
        };
      });
    },
  
    // Trade routes for the bridges: seller -> buyer counts over the last N game days.
    async trades(q) {
      const span = Math.min(60, Number(q.get("days") || 20));
      return cachedN(`trades:${span}`, 30_000, async () => {
        const s = await store.loadState(NET);
        const pairs = {};
        for (let d = Math.max(1, s.day - span + 1); d <= s.day; d++) {
          const { records } = await store.getDay(NET, d);
          for (const r of records) if (r.kind === "trade") {
            const k = `${r.seller}>${r.buyer}`;
            (pairs[k] ||= { seller: r.seller, buyer: r.buyer, count: 0, near: 0, last: 0 });
            pairs[k].count++; pairs[k].near += r.price || 0; pairs[k].last = d;
          }
        }
        return { day: s.day, span, routes: Object.values(pairs) };
      });
    },
  
    // A nation's recent gifts with their live status on NEAR: its own (its gods rule on them within
    // 24h) and others' where it was the top contributor (its gods may claim them after 24h).
    async gifts(q) {
      const id = Number(q.get("id"));
      const all = await cachedN("gifts:all", 20_000, async () => {
        const s = await store.loadState(NET);
        const ids = Object.keys(s.gifts || {}).map(Number).sort((a, b) => b - a).slice(0, 40);
        const live = await Promise.all(ids.map((g) => view("get_gift", { gift_id: g }).catch(() => null)));
        return live.filter(Boolean).map((g) => ({
          id: g.id, clan: g.clan, top_contributor: g.top_contributor, passed: g.warden_passed, status: g.status, day: g.day,
          ends_ms: Math.floor((Number(BigInt(g.created_ns) / 1_000_000n)) + 24 * 3600 * 1000),
          title: s.drafts?.[s.gifts[g.id]?.draft]?.draft?.title ?? null,
        }));
      });
      return { now_ms: Date.now(), gifts: all.filter((g) => g.clan === id || g.top_contributor === id) };
    },
  
    // What happened since the last game day, live (SPEC §12n): the instant turns' records, which
  // become the first records of the next day. ?since=<ms> returns only newer ones.
  async live(q) {
    const since = Number(q.get("since")) || 0;
    const pending = await cachedN("live", 2_500, async () => (await store.loadState(NET)).pending || []);
    return { now_ms: Date.now(), records: pending.filter((r) => (r.at || 0) > since).slice(-80) };
  },

  // The testnet sponsor pool (SPEC §12m C): how many new testnet nations it can still pay for.
  async sponsor() {
    if (NET !== "testnet" || !process.env.SPONSOR_ACCOUNT_ID) return { available: false };
    return cachedN("sponsor", 15_000, async () => {
      const s = await store.loadState(NET);
      const next = s.sponsorRefillAt ? s.sponsorRefillAt + SPONSOR.refillHours * 3600e3 : null;
      return { available: true, pool: process.env.SPONSOR_ACCOUNT_ID, nations_left: await nationsLeft(process.env.SPONSOR_ACCOUNT_ID), per_nation: near(SPONSOR.perNation.toString()), next_refill_ms: next };
    });
  },

  async drafts() {
      return cachedN("drafts", 30_000, () => store.listDrafts(NET, 30));
    },
  
    async draft(q) {
      const d = await store.getDraft(NET, q.get("id"));
      return d ?? { error: "no such draft" };
    },
  
    // A day's records, each with its index so it can be proved.
    async day(q) {
      const day = Number(q.get("d"));
      const d = await store.getDay(NET, day);
      return { day, root: d.root, tx: d.tx, records: d.records.map((r, i) => ({ i, ...r })) };
    },
  
    // Prove one record. Recomputed from the records themselves (stored hashes aren't trusted):
    // hash every record of that day, build the tree, walk record i's path up to a root, and
    // compare with the root the world contract holds on NEAR. Canonical hashing first; days
    // written before it (testnet days 1-43) used each record's exact original text.
    async proof(q) {
      const day = Number(q.get("d")), i = Number(q.get("i"));
      const d = await store.getDay(NET, day);
      if (!d.records[i]) return { error: "no such record" };
      const onchain = await view("get_root", { day });
      const schemes = [{ scheme: "canonical", leaves: d.records.map(leafOf) }];
      if (d.raws?.every(Boolean)) schemes.push({ scheme: "original text", leaves: d.raws.map(sha256) });
      let best = null;
      for (const sc of schemes) {
        const path = merkleProof(sc.leaves, i);
        const computed = rootFromLeaf(sc.leaves[i], path);
        best = { scheme: sc.scheme, leaf: sc.leaves[i], path, computed };
        if (computed === onchain) break;
      }
      // raw = the exact original text, so a browser can redo the "original text" scheme itself.
      return { day, i, record: d.records[i], raw: d.raws?.[i] ?? null, ...best, onchain, matches: best.computed === onchain, world: WORLD, rpc: NETWORKS[NET].rpc, tx: d.tx, explorer: EXPLORER };
    },
  };
  return api;
}
const APIS = { testnet: makeApi("testnet"), mainnet: makeApi("mainnet") };

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".webp": "image/webp" };

function serveStatic(req, res, url) {
  let p = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!p.startsWith(DIST)) return send(res, 403, "text/plain", "forbidden");
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p) && !path.extname(p) && fs.existsSync(p + "/index.html")) p += "/index.html";
  if (!fs.existsSync(p)) {
    const nf = path.join(DIST, "404.html");
    return send(res, 404, "text/html; charset=utf-8", fs.existsSync(nf) ? fs.readFileSync(nf) : "Not found");
  }
  const immutable = p.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  fs.createReadStream(p).pipe(res);
}

// POST /api/sponsor {account}: top a testnet founder up to what founding needs, from the pool.
// Testnet only; once per account; at most 2 per IP a day; only real, short accounts; the pool's
// own cap (what it can pay for) stops it when it runs dry. Testnet NEAR has no value, but the pool
// is shared, so this stays strict.
const sponsorByIp = new Map();
async function sponsorPost(req, res) {
  const json = (code, o) => send(res, code, "application/json", JSON.stringify(o));
  const pool = process.env.SPONSOR_ACCOUNT_ID, key = process.env.SPONSOR_PRIVATE_KEY;
  if (!pool || !key) return json(503, { error: "Sponsorship isn't set up." });
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 512) return json(413, { error: "Too long." }); }
  let account = "";
  try { account = String(JSON.parse(body).account || "").trim().toLowerCase(); } catch { return json(400, { error: "Send {\"account\": \"you.testnet\"}." }); }
  if (!/^[a-z0-9_\-.]{2,64}$/.test(account) || !(account.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(account))) return json(400, { error: "That isn't a testnet account." });
  if (account.startsWith("adf-") || account === pool) return json(400, { error: "That account belongs to the world." });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const today = (sponsorByIp.get(ip) || []).filter((t) => Date.now() - t < 24 * 3600e3);
  if (today.length >= 2) return json(429, { error: "Two sponsorships a day from one connection. Try again tomorrow, or bless a nation instead." });
  if (await store.wasSponsored("testnet", account)) return json(409, { error: "This account was already sponsored once. Bless a nation instead." });
  const have = await balanceOf(account);
  if (have == null) return json(404, { error: "That account doesn't exist on testnet yet." });
  if (have >= SPONSOR.perNation) return json(400, { error: "You already have enough to found a nation." });
  if ((await nationsLeft(pool)) < 1) return json(410, { error: "New testnet nations are full for now. Bless a nation to become one of its gods." });
  try {
    const amount = SPONSOR.perNation - have;
    const tx = await topUp(pool, key, account, amount);
    await store.markSponsored("testnet", account, tx);
    sponsorByIp.set(ip, [...today, Date.now()]);
    cache.delete("testnet:sponsor");
    return json(200, { ok: true, sent: near(amount.toString()), tx });
  } catch (e) {
    console.error("sponsor", e);
    return json(500, { error: "The pool couldn't send just now. Try again in a minute." });
  }
}

function send(res, code, type, body) {
  res.writeHead(code, { "content-type": type });
  res.end(body);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/api/sponsor") return sponsorPost(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "read only");
    const m = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (m) {
      const net = url.searchParams.get("net") === "mainnet" ? "mainnet" : url.searchParams.get("net") === "testnet" ? "testnet" : DEFAULT_NET;
      const fn = Object.hasOwn(APIS[net], m[1]) ? APIS[net][m[1]] : null;
      if (!fn) return send(res, 404, "application/json", JSON.stringify({ error: "unknown endpoint" }));
      try {
        const out = await fn(url.searchParams);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache", "access-control-allow-origin": "*" });
        return res.end(JSON.stringify(out));
      } catch (e) {
        console.error(m[1], e);
        return send(res, 500, "application/json", JSON.stringify({ error: "server error" }));
      }
    }
    serveStatic(req, res, url);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`AD FONTES web on :${PORT} (default ${DEFAULT_NET}; serves testnet and mainnet)`));
