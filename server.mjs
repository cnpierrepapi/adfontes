// Web server (Railway "web" service): the built site from dist/ plus a read-only API.
// Everything the API says comes either from the NEAR contract (live view calls) or from the
// engine's records in Postgres, and any record can be proved against the root on NEAR.
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { JsonRpcProvider } from "near-api-js";
import { NETWORKS, florinRates } from "./engine/config.mjs";
import { PRICES } from "./engine/prices.mjs";
import { fairOf, kindOf, holderOfPatent } from "./engine/market.mjs";
import * as store from "./engine/store.mjs";
import { clockAt, extendHours } from "./engine/clock.mjs";
import { SPONSOR, nationsLeft, balanceOf, topUp, createNamed, PUBLIC_KEY } from "./engine/sponsor.mjs";
import { chainDepth, deepestChain, merkleProof, rootFromLeaf, leafOf, sha256, FIELDS } from "./engine/world.mjs";

// Two worlds, one site (SPEC §12m B): every API call says which network it wants (?net=), and
// each network has its own chain connection, world contract and cache. SITE_NET is the default.
const DEFAULT_NET = process.env.SITE_NET || "testnet";
const PORT = Number(process.env.PORT || 3000);
const UPSTREAM = process.env.ADF_UPSTREAM === "off" ? null : process.env.ADF_UPSTREAM || "https://adfontes.fun"; // see the API handler
const DIST = path.resolve("dist");
const near = (y) => Number(BigInt(y || 0) / 10n ** 18n) / 1e6;
// Florins (SPEC §14): 1 florin = 10^22 units on chain.
const florins = (u) => Number(BigInt(u || 0) / 10n ** 16n) / 1e6;
// Input checks (audit 8 Nov: junk ids reached a chain query and came back as 500s).
class BadInput extends Error {}
const whole = (q, name, min = 0, max = 1e7) => {
  const v = Number(q.get(name));
  if (!Number.isInteger(v) || v < min || v > max) throw new BadInput(`${name} must be a whole number from ${min}`);
  return v;
};

// Small cache so a busy page doesn't hammer the RPC or the database.
const cache = new Map();
// Load test 8 Nov: at 300 visitors, every expired entry was refetched by every waiting request at
// once. Now: one fetch at a time per key; while it runs, visitors get the last copy (stale-while-
// refresh); with no copy yet, everyone waits on the same fetch.
const inflight = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.v;
  let run = inflight.get(key);
  if (!run) {
    run = Promise.resolve().then(fn).then((v) => { cache.set(key, { t: Date.now(), v }); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  if (hit) { run.catch((e) => console.error("refresh failed, serving stale:", key, String(e?.message ?? e).slice(0, 120))); return hit.v; } // stale while it refreshes
  return run;
}
// One failed RPC read must never take the site down (8 Nov: a 429 from the public RPC, rejected in a
// background refresh nobody awaited, crashed the web service). Log it and keep serving.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", String(e?.message ?? e).slice(0, 200)));

// Reverence (SPEC §12m) as the site sees it: who the nation follows and how much each god is revered.
// A nation's standing is the reverence of the god it follows.
// A nation's war, as the site shows it (engine/war.mjs).
function warInfo(s, id) {
  const st = s.clans[id] || {};
  const w = Object.values(s.wars || {}).find((v) => v.status === "on" && (v.a === id || v.b === id));
  const base = { walls: +(st.walls || 0).toFixed(1), fairGame: Object.values(s.drafts || {}).some((d) => d.clan === id && d.passed) };
  if (!w) return base;
  const enemy = w.a === id ? w.b : w.a;
  return { ...base, id: w.id, enemy, since: w.startedDay, rounds: w.rounds || 0, attacker: w.a === id, offer: w.offer?.by ?? null,
    hp: Math.max(0, Object.keys(st.owned || {}).length - 1), enemyHp: Math.max(0, Object.keys(s.clans[enemy]?.owned || {}).length - 1) };
}
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

// Development only: ADF_SIM_CHAIN=<a fast-forward run's chain.json> (with ADF_STATE_DIR=<its state>)
// serves that simulated world instead of NEAR, to look at the site on a world with more going on.
const SIM_CHAIN = process.env.ADF_SIM_CHAIN || null;
function simView(method, args) {
  const S = JSON.parse(fs.readFileSync(SIM_CHAIN, "utf8"));
  const units = (fl) => (BigInt(Math.round(fl * 1e6)) * 10n ** 16n).toString();
  const priced = (l) => l.map((x) => ({ ...x, price: units(x.price) }));
  switch (method) {
    case "get_config": return S.config;
    case "get_totals": { const f = BigInt(S.totals.florins), b = BigInt(S.totals.backing); return { ...S.totals, florin_value: f > 0n ? ((b * 10n ** 22n) / f).toString() : "0" }; }
    case "list_clans": return S.clans;
    case "list_agents": return S.agents[args.clan_id] || [];
    case "get_agent_wallet": return `trader${args.clan_id}.sim.local`;
    case "get_gift": return S.gifts?.[args.gift_id] ?? null;
    case "get_root": return S.roots?.[args.day] ?? null;
    case "market_listings": return priced(S.market?.listings || []);
    case "market_sales": return priced(S.market?.sales || []);
    default: return null;
  }
}

function makeApi(NET) {
  // The main RPC first (testnet: dRPC, his call 9 Nov); the backup (testnet: FastNEAR) if it fails or
  // rate-limits us, and for a minute after.
  // (near-api-js's FailoverRpcProvider shares one index across parallel calls, so it can try the
  // dead one twice: this is the per-call version.)
  const BACKUP = NETWORKS[NET].backupRpc;
  const rpcs = [process.env.ADF_TEST_DEAD_RPC || NETWORKS[NET].rpc, BACKUP].map((url, i) => new JsonRpcProvider({ url }, i === 0 ? { retries: 1, wait: 300, backoff: 1.5 } : {})); // fail fast to the backup
  const WORLD = NETWORKS[NET].world;
  let primaryDownUntil = 0;
  const view = async (method, args = {}) => {
    if (SIM_CHAIN) return simView(method, args);
    const call = (p) => p.callFunction({ contractId: WORLD, method, args });
    if (Date.now() < primaryDownUntil) return call(rpcs[1]);
    try { return await call(rpcs[0]); }
    catch (e) {
      if (/panicked|does not exist|MethodNotFound|CodeDoesNotExist/i.test(String(e?.message ?? e))) throw e; // the contract said no: same answer anywhere
      primaryDownUntil = Date.now() + 60_000;
      return call(rpcs[1]);
    }
  };
  const EXPLORER = NET === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  const cachedN = (key, ms, fn) => cached(`${NET}:${key}`, ms, fn);
  const stateNow = () => cachedN("state", 3_000, () => store.loadState(NET)); // one shared copy
  // A sealed turn never changes: keep it; the open turn is read again after 5 s.
  const sealedDays = new Map();
  const dayOf = async (d) => {
    if (sealedDays.has(d)) return sealedDays.get(d);
    const v = await cachedN(`day:${d}`, 5_000, () => store.getDay(NET, d));
    if (v.root) { sealedDays.set(d, v); if (sealedDays.size > 300) sealedDays.delete(sealedDays.keys().next().value); }
    return v;
  };
  const clockCache = {}; // this network's season hours (seeded from the engine's state)
  const api = {
    // The world now: day, weather, clans (money from the chain, mind from the engine).
    async world() {
      return cachedN("world", 5_000, async () => {
        const [cfg, totals, clans, s] = await Promise.all([view("get_config"), view("get_totals"), view("list_clans", { limit: 100 }), stateNow()]);
        const last = await dayOf(s.day);
        // What each nation's Broker holds as NEP-245 tokens in its own wallet (his call 9 Nov: the
        // agents trade them; until its wallet exists, its DAO), counted by kind; a minute's cache.
        const held = await cachedN("tokens", 60_000, async () => Object.fromEntries(await Promise.all(clans.map(async (c) => {
          const holder = (await view("get_agent_wallet", { clan_id: c.id, role: "Broker" }).catch(() => null)) || c.dao;
          const list = await view("mt_tokens_for_owner", { account_id: holder, limit: 500 }).catch(() => null);
          if (!list) return [c.id, null];
          const n = (p) => list.filter((t) => t.token_id.startsWith(p)).length;
          return [c.id, { holder, research: n("r:"), patents: n("p:"), kits: n("k:"), sample: list.find((t) => t.token_id.startsWith("p:"))?.token_id ?? list[0]?.token_id ?? null }];
        }))));
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
          totals: { balance: near(totals.balance), owed: near(totals.liabilities), backing: near(totals.backing), florins: florins(totals.florins), florin_value: near(totals.florin_value), minted: florins(totals.minted), burned: florins(totals.burned) },
        // The season jackpot (SPEC §14): 14% of everything put in, held by the world contract and
        // paid to the winning nation's gods after the season ends. Both networks.
        jackpot: totals.jackpot != null ? { near: near(totals.jackpot), paid: !!totals.jackpot_paid } : null,
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
              // A nation that lost a war has fallen (the chain still holds it so its gods can claim).
              id: c.id, name: c.name, dao: c.dao, alive: c.alive && !st.fallen, gods: c.gods.length,
              fallen: st.fallen ?? null,
              war: warInfo(s, c.id),
              // What the nation holds: florins, and what they're worth in NEAR at today's florin value.
              florins: florins(c.florins), worth: +(florins(c.florins) * near(totals.florin_value)).toFixed(4),
              total_in: near(c.total_in), clean_gifts: c.clean_gifts, whisper: c.whisper,
              field: st.field ?? null, mbti: st.mbti ?? null, fortune: st.fortune ?? 1,
              seen: !!s.clans[c.id], tricksters: st.tricksters ?? 0,
              points: Object.keys(st.owned || {}).length, depth: st.owned ? chainDepth(st) : 0,
              line: st.owned ? deepestChain(st) : [],
              reverence: revOf(s, c.id),
              // v2 (SPEC §14): techs unlocked, and the needs mood (hungry / content / sated)
              techs: st.techs ?? [], mood: st.mood ?? null, need: st.need ?? null,
              // Its named account (9 Nov): <name>.<world>, forwards to the DAO. Set by the engine once made.
              alias: st.alias ?? null,
              tokens: held[c.id] ?? null,
            };
          }),
          ruins: Object.keys(s.ruins || {}).length,
          wars: Object.values(s.wars || {}).filter((w) => w.status === "on").map((w) => ({ id: w.id, a: w.a, b: w.b, since: w.startedDay, rounds: w.rounds || 0, offer: w.offer?.by ?? null })),
          recent: last.records.filter((r) => r.kind !== "weather").slice(-30),
        };
      });
    },
  
    // One clan's mindmap and its agents.
    async clan(q) {
      const id = whole(q, "id", 1);
      // ?d=<day> only splits the cache, so the live world can ask for the map right after a new day.
      const d = Number(q.get("d")) || 0;
      return cachedN(`clan:${id}:${d}`, 20_000, async () => {
        const [s, agents, drafts] = await Promise.all([stateNow(), view("list_agents", { clan_id: id, limit: 100 }), store.listDrafts(NET, 12, id)]);
        const st = s.clans[id];
        if (!st) return { error: "no such clan" };
        const dead = st.alive === false;
        // A dead nation's points are ruins until another nation absorbs them ("taken").
        const points = Object.entries(st.owned).map(([k, v]) => ({
          point: k, parent: v.parent, depth: v.depth, how: v.how, stir: v.stir ?? "calm", stir_why: v.stir_why ?? null,
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
          // chain: the points a draft stands on (a passed one's patent earns royalties on them).
          drafts: drafts.map((x) => ({ id: x.id, day: x.day, passed: x.passed, title: x.title, chain: x.chain || [] })), agents,
          reverence: revOf(s, id), reports: reportsOf(s, id),
        };
      });
    },
  
    // Trade routes for the bridges: seller -> buyer counts over the last N game days.
    async trades(q) {
      const span = Math.min(60, Number(q.get("days") || 20));
      return cachedN(`trades:${span}`, 30_000, async () => {
        const s = await stateNow();
        const pairs = {};
        for (let d = Math.max(1, s.day - span + 1); d <= s.day; d++) {
          const { records } = await dayOf(d);
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
      const id = whole(q, "id", 1);
      const all = await cachedN("gifts:all", 20_000, async () => {
        const s = await stateNow();
        const ids = Object.keys(s.gifts || {}).map(Number).sort((a, b) => b - a).slice(0, 40);
        const live = await Promise.all(ids.map((g) => view("get_gift", { gift_id: g }).catch(() => null)));
        return live.filter(Boolean).map((g) => ({
          id: g.id, clan: g.clan, passed: g.warden_passed, status: g.status, day: g.day,
          ends_ms: Math.floor((Number(BigInt(g.created_ns) / 1_000_000n)) + 24 * 3600 * 1000),
          title: s.drafts?.[s.gifts[g.id]?.draft]?.draft?.title ?? null,
        }));
      });
      return { now_ms: Date.now(), gifts: all.filter((g) => g.clan === id) };
    },
  
    // What happened since the last game day, live (SPEC §12n): the instant turns' records, which
  // become the first records of the next day. ?since=<ms> returns only newer ones.
  async live(q) {
    const since = Number(q.get("since")) || 0;
    const pending = await cachedN("live", 2_500, async () => (await stateNow()).pending || []);
    return { now_ms: Date.now(), records: pending.filter((r) => (r.at || 0) > since).slice(-80) };
  },

  // The testnet sponsor pool (SPEC §12m C): how many new testnet nations it can still pay for.
  async sponsor() {
    if (NET !== "testnet" || !process.env.SPONSOR_ACCOUNT_ID) return { available: false };
    return cachedN("sponsor", 15_000, async () => {
      const s = await stateNow();
      const next = s.sponsorRefillAt ? s.sponsorRefillAt + SPONSOR.refillHours * 3600e3 : null;
      return { available: true, pool: process.env.SPONSOR_ACCOUNT_ID, nations_left: await nationsLeft(process.env.SPONSOR_ACCOUNT_ID), per_nation: near(SPONSOR.perNation.toString()), next_refill_ms: next };
    });
  },

  // The marketplace (adfontes.fun/marketplace, view only): open listings and sales straight from the
  // world contract, priced against the fair price in engine/prices.mjs, each joined to its
  // transaction from the engine's records; every passed patent with its holder and royalties.
  async market() {
    return cachedN("market", 20_000, async () => {
      const [s, listings, sales] = await Promise.all([stateNow(), view("market_listings", { from_index: 0, limit: 500 }).catch(() => []), view("market_sales", { from_index: 0, limit: 500 }).catch(() => [])]);
      const FL = florinRates(NET);
      // Transactions: from the records of the turns the open listings and recent sales happened on
      // (the contract's day can be a turn behind the record's), and what's happened since.
      const listTx = {}, buyTx = {};
      const note = (r) => {
        if (r.kind === "listed" && r.listing != null) listTx[r.listing] = r.tx;
        if (r.kind === "market-buy") buyTx[`${r.listing}|${r.clan}`] = r.tx;
      };
      const days = new Set([...listings.filter((l) => l.open), ...sales.slice(-40)].flatMap((x) => [x.day, x.day + 1]).filter((d) => d >= 1 && d <= s.day));
      for (const d of days) (await dayOf(d)).records.forEach(note);
      (s.pending || []).forEach(note);
      // Royalties, from the sealed records themselves (every turn; a sealed turn is cached for good):
      // each payment's share per patent (older records without `per` split their total evenly).
      const royalties = [], earned = {};
      for (let d = 1; d <= s.day; d++) for (const r of (await dayOf(d)).records) if (r.kind === "royalty") {
        const per = r.per ?? Object.fromEntries((r.patents || []).map((p) => [p, +(r.florins / Math.max(1, r.patents.length)).toFixed(4)]));
        for (const [p, v] of Object.entries(per)) earned[p] = +((earned[p] || 0) + v).toFixed(4);
        royalties.push({ day: d, clan: r.clan, florins: r.florins, patents: r.patents || [], sales: r.sales, tx: r.tx ?? null });
      }
      const item = (token) => { const f = fairOf(s, token, FL); return { token, kind: f?.kind ?? kindOf(token), title: f?.title ?? token.slice(2), fair: f ? +f.price.toFixed(4) : null, fair_why: f?.why ?? null }; };
      const open = listings.filter((l) => l.open).map((l) => ({ id: l.id, seller: l.seller, day: l.day, price: florins(l.price), copy: l.kind === "copy", sold: l.sold, reason: l.reason, tx: listTx[l.id] ?? null, ...item(l.token_id) }));
      const recent = sales.slice(-40).reverse().map((x) => ({ id: x.id, listing: x.listing, buyer: x.buyer, seller: x.seller, day: x.day, price: florins(x.price), reason: x.reason, tx: buyTx[`${x.listing}|${x.buyer}`] ?? null, ...item(x.token_id) }));
      const listed = new Set(open.map((l) => l.token));
      const patents = Object.values(s.drafts || {}).filter((d) => d.passed).map((d) => ({
        id: d.id, day: d.day, drafter: d.clan, holder: holderOfPatent(s, d.id), chain: d.chain || [],
        royalties: earned[d.id] ?? 0, listed: listed.has(`p:${d.id}`), ...item(`p:${d.id}`),
      })).sort((a, b) => b.royalties - a.royalties || b.day - a.day);
      return {
        net: NET, world: WORLD, explorer: EXPLORER, day: s.day, on: process.env.ADF_MARKET === "1" || null,
        bounds: { min: PRICES.marketMin, max: PRICES.marketMax }, royalty: +FL.royalty.toFixed(4),
        counts: { listings: listings.length, open: open.length, sales: sales.length, royalties: +royalties.reduce((a, r) => a + r.florins, 0).toFixed(4), royalty_payments: royalties.length },
        open, sales: recent, patents, royalties: royalties.slice(-40).reverse(),
      };
    });
  },

  async drafts() {
      return cachedN("drafts", 30_000, () => store.listDrafts(NET, 30));
    },
  
    async draft(q) {
      if (!/^d\d{1,9}$/.test(q.get("id") || "")) throw new BadInput("id looks like d123");
      const d = await store.getDraft(NET, q.get("id"));
      return d ?? { error: "no such draft" };
    },
  
    // A day's records, each with its index so it can be proved.
    async day(q) {
      const day = whole(q, "d", 0);
      const d = await dayOf(day);
      return { day, root: d.root, tx: d.tx, records: d.records.map((r, i) => ({ i, ...r })) };
    },
  
    // Prove one record. Recomputed from the records themselves (stored hashes aren't trusted):
    // hash every record of that day, build the tree, walk record i's path up to a root, and
    // compare with the root the world contract holds on NEAR. Canonical hashing first; days
    // written before it (testnet days 1-43) used each record's exact original text.
    async proof(q) {
      const day = whole(q, "d", 1), i = whole(q, "i", 0);
      const d = await dayOf(day);
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

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".webp": "image/webp", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".webm": "video/webm", ".jpg": "image/jpeg" };

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "text/plain", "bad path"); } // a malformed %-escape
  // The live world is the homepage (his call 8 Nov); the old landing page lives at /about/.
  if (pathname === "/" || pathname === "/index.html") pathname = "/live/index.html";
  else if (pathname === "/about" || pathname === "/about/") pathname = "/index.html";
  let p = path.normalize(path.join(DIST, pathname));
  if (p !== DIST && !p.startsWith(DIST + path.sep)) return send(res, 403, "text/plain", "forbidden");
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p) && !path.extname(p) && fs.existsSync(p + "/index.html")) p += "/index.html";
  if (!fs.existsSync(p)) {
    const nf = path.join(DIST, "404.html");
    return send(res, 404, "text/html; charset=utf-8", fs.existsSync(nf) ? fs.readFileSync(nf) : "Not found");
  }
  const immutable = p.includes(`${path.sep}assets${path.sep}`);
  // Video and audio: streamed from disk with byte ranges (Safari and iPhones won't play an MP4
  // without them, and every browser seeks with them). Never held in memory or gzipped.
  if (/\.(mp4|mp3|webm)$/.test(p)) {
    const size = fs.statSync(p).size;
    const head = { "content-type": TYPES[path.extname(p)], "accept-ranges": "bytes", "cache-control": "public, max-age=86400" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2]), end = m[1] && m[2] ? Number(m[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (!(start >= 0 && start <= end)) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(p, { start, end }).on("error", () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { ...head, "content-length": size });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(p).on("error", () => res.destroy()).pipe(res);
  }
  // Held in memory (and gzipped once) instead of read from disk on every request: load test 8 Nov.
  const f = fileOf(p);
  const gz = f.gz && /gzip/.test(req.headers["accept-encoding"] || "");
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache", vary: "accept-encoding", ...(gz ? { "content-encoding": "gzip" } : {}), "content-length": (gz ? f.gz : f.raw).length });
  res.end(req.method === "HEAD" ? undefined : gz ? f.gz : f.raw);
}
const files = new Map(); // path -> { raw, gz, mtime }
function fileOf(p) {
  const mtime = fs.statSync(p).mtimeMs, hit = files.get(p);
  if (hit && hit.mtime === mtime) return hit;
  const raw = fs.readFileSync(p);
  const gz = /\.(js|css|html|svg|json|txt)$/.test(p) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null;
  const f = { raw, gz, mtime };
  if (raw.length < 20e6) files.set(p, f);
  return f;
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
  let account = "", publicKey = "";
  try { const b = JSON.parse(body); account = String(b.account || "").trim().toLowerCase(); publicKey = String(b.public_key || "").trim(); } catch { return json(400, { error: "Send {\"account\": \"you.testnet\"}." }); }
  // Play without a wallet (9 Nov): {public_key} -> the pool makes the player a named account
  // (amber-quill-417.<pool>), funded to found a nation, with that key on it. Same limits as below.
  if (publicKey) return sponsorNamed(req, res, json, pool, key, publicKey);
  if (!/^[a-z0-9_\-.]{2,64}$/.test(account) || !(account.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(account))) return json(400, { error: "That isn't a testnet account." });
  if (account.startsWith("adf-") || account === pool) return json(400, { error: "That account belongs to the world." });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const today = (sponsorByIp.get(ip) || []).filter((t) => Date.now() - t < 24 * 3600e3);
  if (today.length >= 2) return json(429, { error: "Two sponsorships a day from one connection. Try again tomorrow, or bless a nation instead." });
  if (await store.wasSponsored("testnet", account)) return json(409, { error: "This account was already sponsored once. Bless a nation instead." });
  // A brand-new implicit account (a key made in the browser: Play without a wallet) has no account on
  // chain until NEAR is sent to it; the transfer creates it. Named accounts must already exist.
  const have = (await balanceOf(account)) ?? (/^[0-9a-f]{64}$/.test(account) ? 0n : null);
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

async function sponsorNamed(req, res, json, pool, key, publicKey) {
  if (!PUBLIC_KEY.test(publicKey)) return json(400, { error: "That isn't a NEAR public key." });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const today = (sponsorByIp.get(ip) || []).filter((t) => Date.now() - t < 24 * 3600e3);
  if (today.length >= 2) return json(429, { error: "Two sponsorships a day from one connection. Try again tomorrow, or bless a nation instead." });
  if ((await nationsLeft(pool)) < 1) return json(410, { error: "New testnet nations are full for now. Bless a nation to become one of its gods." });
  sponsorByIp.set(ip, [...today, Date.now()]); // counted before the send, so two quick clicks can't both pass
  try {
    const { account, tx } = await createNamed(pool, key, publicKey, SPONSOR.perNation);
    await store.markSponsored("testnet", account, tx);
    cache.delete("testnet:sponsor");
    return json(200, { ok: true, account, sent: near(SPONSOR.perNation.toString()), tx });
  } catch (e) {
    sponsorByIp.set(ip, today); // nothing was sent: the try doesn't count
    console.error("sponsor named", e);
    return json(500, { error: "The pool couldn't make your account just now. Try again in a minute." });
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
    // A fresh clone (no database, no engine state on disk) has the chain but none of the engine's
    // records, so its world would be hollow. It reads them from the live site's public API instead:
    // `npm start` shows the real world, served from your own copy of the code. ADF_UPSTREAM=off disables.
    if (m && UPSTREAM && !process.env.DATABASE_URL && !fs.existsSync("engine/state/testnet.json")) {
      try {
        const r = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, { signal: AbortSignal.timeout(20000) });
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-cache", "access-control-allow-origin": "*" });
        return res.end(Buffer.from(await r.arrayBuffer()));
      } catch { return send(res, 502, "application/json", JSON.stringify({ error: "couldn't reach the live world" })); }
    }
    if (m) {
      const net = url.searchParams.get("net") === "mainnet" ? "mainnet" : url.searchParams.get("net") === "testnet" ? "testnet" : DEFAULT_NET;
      const fn = Object.hasOwn(APIS[net], m[1]) ? APIS[net][m[1]] : null;
      if (!fn) return send(res, 404, "application/json", JSON.stringify({ error: "unknown endpoint" }));
      try {
        const out = await fn(url.searchParams);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache", "access-control-allow-origin": "*" });
        return res.end(JSON.stringify(out));
      } catch (e) {
        if (e instanceof BadInput) return send(res, 400, "application/json", JSON.stringify({ error: e.message }));
        console.error(m[1], e);
        return send(res, 500, "application/json", JSON.stringify({ error: "server error" }));
      }
    }
    serveStatic(req, res, url);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`AD FONTES web on :${PORT} (default ${DEFAULT_NET}; serves testnet and mainnet)`));
