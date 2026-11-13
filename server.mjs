// Web server (Railway "web" service): the built site from dist/ plus a read-only API.
// Everything the API says comes either from the NEAR contract (live view calls) or from the
// engine's records in Postgres, and any record can be proved against the root on NEAR.
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import path from "node:path";
import { JsonRpcProvider } from "near-api-js";
import { NETWORKS, florinRates } from "./engine/config.mjs";
import { PRICES } from "./engine/prices.mjs";
import { fairOf, kindOf, holderOfPatent } from "./engine/market.mjs";
import * as store from "./engine/store.mjs";
import { clockAt, extendHours } from "./engine/clock.mjs";
import { SPONSOR, nationsLeft, balanceOf, topUp, createNamed, fundFounding, PUBLIC_KEY } from "./engine/sponsor.mjs";
import { chainDepth, deepestChain, merkleProof, rootFromLeaf, leafOf, sha256, FIELDS, pitchOf } from "./engine/world.mjs";
import { acceptChoice } from "./engine/choices.mjs";
import { standings } from "./engine/reverence.mjs";
import { inRanking } from "./src/season.js";

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
// A sandbox's own server (timelapse/service.mjs) has one visitor and must show a turn the moment it
// lands, so it reads fresh every time (11 Nov: the cache held each new turn back by ~6 s).
const NO_CACHE = process.env.ADF_NO_CACHE === "1";
async function cached(key, ms, fn) {
  if (NO_CACHE) return fn();
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
// burned: { [warId]: { [clanId]: points burned off it in that war } }, from the sealed battle records.
function warInfo(s, id, burned = {}) {
  const st = s.clans[id] || {};
  const w = Object.values(s.wars || {}).find((v) => v.status === "on" && (v.a === id || v.b === id));
  const base = { walls: +(st.walls || 0).toFixed(1), fairGame: Object.values(s.drafts || {}).some((d) => d.clan === id && d.passed) };
  if (!w) return base;
  const enemy = w.a === id ? w.b : w.a;
  return { ...base, id: w.id, enemy, since: w.startedDay, rounds: w.rounds || 0, attacker: w.a === id, offer: w.offer?.by ?? null,
    hp: Math.max(0, Object.keys(st.owned || {}).length - 1), enemyHp: Math.max(0, Object.keys(s.clans[enemy]?.owned || {}).length - 1),
    burned: burned[w.id]?.[id] || 0, enemyBurned: burned[w.id]?.[enemy] || 0 };
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
// The sandbox runs in this process when ADF_SANDBOX=on (never inside a sandbox's own child server).
const SANDBOX = process.env.ADF_SANDBOX === "on" && !SIM_CHAIN ? import("./timelapse/service.mjs").then((m) => { m.startSandbox(); return m; }) : null;
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
    // Nations whose last god claimed out (his call 10 Nov): gone from the game. A fallen nation (lost a
    // war) isn't here: its ruins are part of the war's story. Not an endpoint (no letters-only name).
    async _ended() {
      return cachedN("ended", 30_000, async () => {
        const [clans, s] = await Promise.all([view("list_clans", { limit: 100 }), stateNow()]);
        return clans.filter((c) => !c.alive && !s.clans?.[c.id]?.fallen && !(c.gods?.length > 0)).map((c) => ({ id: c.id, name: c.name }));
      });
    },
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
        // Each nation's two agent wallets (8-9 Nov): its Broker trades, its Patron pays for war and walls.
        const wallets = await cachedN("wallets", 300_000, async () => Object.fromEntries(await Promise.all(clans.map(async (c) => [c.id, {
          broker: await view("get_agent_wallet", { clan_id: c.id, role: "Broker" }).catch(() => null),
          patron: await view("get_agent_wallet", { clan_id: c.id, role: "Patron" }).catch(() => null),
        }]))));
        const weather = last.records.find((r) => r.kind === "weather") ?? null;
        // Points each side has lost in each war on now (the health bars over warring nations): the
        // burned lists of its battle records, from the turn it started. Sealed turns are kept in memory.
        const burned = {};
        for (const w of Object.values(s.wars || {}).filter((v) => v.status === "on")) {
          const per = (burned[w.id] = { [w.a]: 0, [w.b]: 0 });
          for (let d = w.startedDay ?? s.day; d <= s.day; d++) {
            const day = await dayOf(d).catch(() => null);
            for (const r of day?.records || []) if (r.kind === "battle" && r.war === w.id) for (const [cid, side] of Object.entries(r.sides || {})) if (cid in per) per[cid] += side.burned?.length || 0;
          }
        }
        // The world clock now (SPEC §14), not as of the last engine turn: the sky turns on time.
        let clock = null;
        if (s.clock?.startNear) {
          if (clockCache.startNear !== s.clock.startNear || (s.clock.rows?.length || 0) > (clockCache.rows?.length || 0)) Object.assign(clockCache, { startNear: s.clock.startNear, rows: (s.clock.rows || []).slice() });
          try { await extendHours(clockCache, s.clock.startNear); } catch { /* feed down: last known hours */ }
          clock = clockAt(clockCache.rows, Date.now());
        }
        // Every god's name (12 Nov, engine/godnames.mjs): the game shows these, never an account id.
        const godAccounts = [...clans.flatMap((c) => (c.gods || []).map((g) => g.account)), ...Object.values(s.rev || {}).flatMap((rv) => [...Object.keys(rv.gods || {}), rv.followed, rv.claimedBy])];
        const names = await store.godNames(godAccounts).catch((e) => { console.error("god names", e); return {}; });
        // Which gods are AI (12 Nov, engine/aigods.mjs): the page tags them.
        const ai = (await store.aiGods(NET).catch(() => [])).map((g) => g.account);
        return {
          net: NET, world: WORLD, explorer: EXPLORER, day: cfg.day, season: cfg.season, paused: cfg.paused,
          weather, clock, names, ai,
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
              last_act_at: st.lastActAt ?? null, // when a god last acted here (src/live/status.js: neglected after 24 h)
              war: warInfo(s, c.id, burned),
              // What the nation holds: florins, and what they're worth in NEAR at today's florin value.
              florins: florins(c.florins), worth: +(florins(c.florins) * near(totals.florin_value)).toFixed(4),
              // What it can spend (11 Nov): less its gods' ring-fenced grant (granted NEAR at today's
              // florin value), the same florins the engine's war, trades and Act of God use.
              spendable: +Math.max(0, florins(c.florins) - (near(totals.florin_value) > 0 ? (s.grantedNear?.[c.id] || 0) / near(totals.florin_value) : 0)).toFixed(4),
              total_in: near(c.total_in), clean_gifts: c.clean_gifts, whisper: c.whisper,
              field: st.field ?? null, mbti: st.mbti ?? null, fortune: st.fortune ?? 1,
              seen: !!s.clans[c.id], tricksters: st.tricksters ?? 0,
              // Born (10 Nov): the engine has made its people, so the page can raise the island with them on it.
              ready: !!st.teamDone,
              points: Object.keys(st.owned || {}).length, depth: st.owned ? chainDepth(st) : 0,
              line: st.owned ? deepestChain(st) : [],
              reverence: revOf(s, c.id),
              // v2 (SPEC §14): techs unlocked, and the needs mood (hungry / content / sated)
              techs: st.techs ?? [], mood: st.mood ?? null, need: st.need ?? null,
              // Its named account (9 Nov): <name>.<world>, forwards to the DAO. Set by the engine once made.
              alias: st.alias ?? null,
              tokens: held[c.id] ?? null,
              wallets: wallets[c.id] ?? null,
            };
          }),
          ruins: Object.keys(s.ruins || {}).length,
          wars: Object.values(s.wars || {}).filter((w) => w.status === "on").map((w) => ({ id: w.id, a: w.a, b: w.b, since: w.startedDay, rounds: w.rounds || 0, offer: w.offer?.by ?? null })),
          recent: last.records.filter((r) => r.kind !== "weather").slice(-30),
        };
      });
    },
  
    // One clan's mindmap and its agents.
    // What happens next turn (11 Nov, the personal feed): everything here is already decided or known
    // before the turn runs, so a god can answer it while they wait. Read-only, from the engine's state
    // and the chain; the engine itself is unchanged.
    async next() {
      return cachedN("next", 5_000, async () => {
        const [clans, totals, s] = await Promise.all([view("list_clans", { limit: 100 }), view("get_totals"), stateNow()]);
        const standing = clans.filter((c) => c.alive && s.clans[c.id] && !s.clans[c.id].fallen);
        const name = (id) => clans.find((c) => c.id === Number(id))?.name ?? `nation ${id}`;
        const fv = near(totals.florin_value);
        const spend = (c) => Math.max(0, florins(c.florins) - (fv > 0 ? (s.grantedNear?.[c.id] || 0) / fv : 0));
        const wars = Object.values(s.wars || {}).filter((w) => w.status === "on");
        const atWar = (id) => wars.some((w) => w.a === id || w.b === id);
        // The heavens (engine/fire.mjs): hoarding = twice an equal share of what nations can spend;
        // famine = half the nations hungry while the richest at peace isn't.
        const total = standing.reduce((a, c) => a + spend(c), 0);
        const peace = standing.filter((c) => !atWar(c.id)).sort((a, b) => spend(b) - spend(a));
        const richest = peace[0], line = standing.length >= 3 ? 2 / standing.length : null;
        const hungry = standing.filter((c) => s.clans[c.id]?.mood === "hungry").length;
        return {
          next_at: s.lastRunAt ? s.lastRunAt + 2 * 3600e3 : null, now_ms: Date.now(),
          fires: (s.fire?.queue || []).map((f) => ({ caster: f.caster, caster_name: name(f.caster), target: f.target, target_name: name(f.target), god: f.god })),
          wars: wars.map((w) => { const a = warInfo(s, w.a); return { a: w.a, a_name: name(w.a), b: w.b, b_name: name(w.b), round: (w.rounds || 0) + 1, a_points: a.hp + 1, b_points: a.enemyHp + 1, offer: w.offer?.by ?? null }; }),
          hoard: richest && line && total > 0 ? { clan: richest.id, name: richest.name, share: +(spend(richest) / total).toFixed(4), line: +line.toFixed(4) } : null,
          famine: standing.length >= 3 ? { hungry, of: standing.length, needs: Math.ceil(standing.length / 2), richest: richest?.id ?? null, richest_name: richest?.name ?? null, richest_hungry: richest ? s.clans[richest.id]?.mood === "hungry" : null } : null,
          reports: Object.values(s.reports || {}).filter((r) => !r.settled).map((r) => ({ id: r.id, clan: r.clan, accuser: r.accuser, accused: r.accused, claim: r.claim })),
          rulings: Object.entries(s.gifts || {}).filter(([, g]) => !g.applied).map(([id, g]) => ({ gift: Number(id), clan: g.clan, until: (g.at || 0) + 24 * 3600e3 })),
          // The Scholars' pitch (PLAN_13NOV step 1): for the next turn, the 3 points the dice would draw from, with
          // what a god needs to choose: how deep, how many other nations know it already, its best Scholar.
          choice_day: s.day + 1,
          pitches: await (async () => {
            const picked = await store.choicesFor(NET, s.day + 1).catch(() => []);
            return standing.map((c) => {
              const st = s.clans[c.id];
              const points = pitchOf(st, `${s.day + 1}|${c.id}`).map((p) => {
                const skills = Object.entries(st.skills || {}).map(([who, sk]) => [who, sk?.[p] || 0]).sort((x, y) => y[1] - x[1]);
                return { point: p, depth: st.frontier[p]?.depth ?? null, known_by: Object.entries(s.clans).filter(([id, o]) => Number(id) !== c.id && o.owned?.[p]).length, best_scholar: skills[0]?.[1] > 0 ? skills[0][0] : null };
              });
              return { clan: c.id, name: c.name, points, picked: picked.find((x) => x.clan === c.id && x.kind === "pitch")?.payload?.point ?? null };
            }).filter((p) => p.points.length);
          })(),
        };
      });
    },
    // A god's signed choice (PLAN_13NOV step 0, engine/choices.mjs). Not a GET endpoint (the name has an underscore).
    async _choice(b) {
      const s = await stateNow();
      const r = await acceptChoice(b, {
        world: WORLD, day: s.day + 1,
        keyOn: async (account, publicKey) => {
          const ask = (p) => p.query({ request_type: "view_access_key", finality: "final", account_id: account, public_key: publicKey });
          try { await ask(rpcs[0]); return true; } catch (e) { if (/does not exist|UNKNOWN_ACCESS_KEY|doesn't exist/i.test(String(e?.message ?? e))) return false; try { await ask(rpcs[1]); return true; } catch { return false; } }
        },
        godOf: async (clan, account) => ((await view("list_clans", { limit: 100 })).find((c) => c.id === clan)?.gods || []).some((g) => g.account === account),
      });
      if (r.ok) { await store.putChoice(NET, r.row); cache.delete(`${NET}:next`); }
      return r;
    },
    async clan(q) {
      const id = whole(q, "id", 1);
      // ?d=<day> only splits the cache, so the live world can ask for the map right after a new day.
      const d = Number(q.get("d")) || 0;
      // ?fresh=1 (10 Nov): a nation being born asks for its people as they arrive; a 2-second bucket
      // instead of the 20-second cache, so "no citizens yet" never sticks around.
      const fresh = q.get("fresh") ? `:f${Math.floor(Date.now() / 2000)}` : "";
      return cachedN(`clan:${id}:${d}${fresh}`, fresh ? 2_000 : 20_000, async () => {
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
    // An Act of God burns until the turn ends, so a fire always comes along, however busy the turn.
    const recent = pending.filter((r) => (r.at || 0) > since), last = recent.slice(-80);
    return { now_ms: Date.now(), records: [...recent.filter((r) => r.kind === "fire" && !last.includes(r)), ...last] };
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
      const listTx = {}, buyTx = {}, fairAt = {}; // fairAt: the fair price a sale was struck against (9 Nov: the page showed today's, which falls as knowledge spreads)
      const note = (r) => {
        if (r.kind === "listed" && r.listing != null) listTx[r.listing] = r.tx;
        if (r.kind === "market-buy") { buyTx[`${r.listing}|${r.clan}`] = r.tx; if (r.fair != null) fairAt[`${r.listing}|${r.clan}`] = r.fair; }
        // A trade between Brokers goes through the market too (9 Nov): the seller lists, the buyer buys.
        if (r.kind === "trade" && r.listing != null) { buyTx[`${r.listing}|${r.buyer}`] = r.tx; if (r.fair != null) fairAt[`${r.listing}|${r.buyer}`] = r.fair; if (r.listTx) listTx[r.listing] = r.listTx; }
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
      const recent = sales.slice(-40).reverse().map((x) => ({ id: x.id, listing: x.listing, buyer: x.buyer, seller: x.seller, day: x.day, price: florins(x.price), reason: x.reason, tx: buyTx[`${x.listing}|${x.buyer}`] ?? null, ...item(x.token_id), ...(fairAt[`${x.listing}|${x.buyer}`] != null ? { fair: +fairAt[`${x.listing}|${x.buyer}`].toFixed(4), fair_why: "the fair price when it sold" } : {}) }));
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

  // Every god's stake right now, straight from the contract (get_stake): what they put in, the
  // florins they hold in the nation, and what claiming them would pay today. Plus who'd take the
  // season jackpot if it ended now (the standings: engine/reverence.mjs).
  async stakes() {
    return cachedN("stakes", 30_000, async () => {
      const [clans, totals, s] = await Promise.all([view("list_clans", { limit: 100 }), view("get_totals"), stateNow()]);
      const rows = [];
      await Promise.all(clans.map(async (c) => {
        for (const g of c.gods || []) {
          const st = await view("get_stake", { clan_id: c.id, account: g.account }).catch(() => null);
          if (!st) continue;
          // Put in = what bought florins plus what the world credited back (9 Nov: the founders' DAO
          // costs, granted into the backing), so the result compares like with like.
          const granted = near(st.granted || "0"), put = +(near(st.put_in) + granted).toFixed(6), now = near(st.near);
          rows.push({ clan: c.id, nation: c.name, alive: c.alive && !s.clans[c.id]?.fallen, god: g.account, put_in: put, granted, florins: florins(st.florins), claim_now: now, gain: +(now - put).toFixed(6), pct: put > 0 ? +((now / put - 1) * 100).toFixed(1) : null });
        }
      }));
      rows.sort((a, b) => (b.pct ?? -1e9) - (a.pct ?? -1e9));
      const top = standings(s, clans, new Set((await store.aiGods(NET).catch(() => [])).map((g) => g.account))).find((r) => inRanking(r)) ?? null; // AI-led nations don't rank (12 Nov) // the beta's first nine leave the ranking after the hackathon (src/season.js)
      return { day: s.day, net: NET, explorer: EXPLORER, florin_value: near(totals.florin_value), jackpot: near(totals.jackpot), jackpot_share: 14, leader: top ? { id: top.id, name: top.name, standing: Math.round(top.standing * 10) / 10 } : null, stakes: rows };
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

// Mainnet's first world (world.adfontes.near) was retired on 10 Nov 2026: its account was deleted and the NEAR
// returned. Until a world runs there again, every mainnet endpoint gives this one plain answer instead of
// stale or broken data. Checked against NEAR once a minute, so it opens by itself when the account exists.
const MAINNET_CLOSED = { net: "mainnet", open: false, world: null, note: "No mainnet world right now. The first version was retired on 10 November 2026; mainnet reopens with the current contract after the hackathon." };
let mainnetSeen = { at: 0, open: false };
async function mainnetOpen() {
  if (Date.now() - mainnetSeen.at < 60_000) return mainnetSeen.open;
  try {
    const r = await fetch(NETWORKS.mainnet.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: NETWORKS.mainnet.world } }), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.result) mainnetSeen = { at: Date.now(), open: true };
    else if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error ?? {}))) mainnetSeen = { at: Date.now(), open: false };
  } catch {} // RPC down: keep the last answer
  return mainnetSeen.open;
}

// Ended nations (his call 10 Nov) are removed, not reworded: out of the world's nation list, their
// clan page gone, and every listing, sale, patent, royalty, trade route, draft, stake and gift of
// theirs dropped. Sealed records (/api/day, /api/proof, /api/live and the world's `recent`) stay
// exactly as they were written; /api/world sends the ended ids and names so a page can name them there.
function dropEnded(endpoint, out, ended) {
  const ids = new Set(ended.map((e) => e.id));
  const gone = (...xs) => xs.some((x) => x != null && ids.has(Number(x)));
  if (!out || typeof out !== "object") return out;
  switch (endpoint) {
    case "world": return { ...out, clans: (out.clans || []).filter((c) => !ids.has(c.id)), ended: ended.map((e) => ({ id: e.id, name: e.name })) };
    case "market": {
      const open = out.open.filter((l) => !gone(l.seller)), sales = out.sales.filter((x) => !gone(x.seller, x.buyer));
      const patents = out.patents.filter((p) => !gone(p.holder, p.drafter)), royalties = out.royalties.filter((r) => !gone(r.clan));
      const c = out.counts, offOpen = out.open.length - open.length, offSales = out.sales.length - sales.length;
      return { ...out, open, sales, patents, royalties, counts: { ...c, listings: c.listings - offOpen - offSales, open: open.length, sales: c.sales - offSales, royalties: +royalties.reduce((a, r) => a + r.florins, 0).toFixed(4), royalty_payments: royalties.length } };
    }
    case "next": return { ...out, fires: (out.fires || []).filter((f) => !gone(f.caster, f.target)), wars: (out.wars || []).filter((w) => !gone(w.a, w.b)), reports: (out.reports || []).filter((r) => !gone(r.clan)), rulings: (out.rulings || []).filter((g) => !gone(g.clan)) };
    case "trades": return { ...out, routes: out.routes.filter((r) => !gone(r.seller, r.buyer)) };
    case "stakes": return { ...out, stakes: out.stakes.filter((s) => !gone(s.clan)) };
    case "gifts": return { ...out, gifts: out.gifts.filter((g) => !gone(g.clan)) };
    case "drafts": return Array.isArray(out) ? out.filter((d) => !gone(d.clan)) : out;
    case "draft": return gone(out.clan) ? { error: "no such draft" } : out;
    case "clan": return gone(out.id) ? { error: "no such clan" } : out;
    default: return out;
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".webp": "image/webp", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".webm": "video/webm", ".jpg": "image/jpeg" };

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "text/plain", "bad path"); } // a malformed %-escape
  // The live world is the homepage (his call 8 Nov). The old landing page (/about) and the 4 Nov
  // recorded demo (/demo) described an earlier design, so both send you to the judge page (9 Nov).
  if (/^\/(about|demo)(\/.*)?$/.test(pathname)) { res.writeHead(302, { location: "/judge/" }); return res.end(); }
  if (pathname === "/" || pathname === "/index.html") pathname = "/live/index.html";
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
  // Every file carries an ETag (10 Nov), so a reload asks "changed?" and gets a tiny 304 instead of
  // the whole file. The citizen models (6.2 MB) are kept a day without even asking: they used to be
  // downloaded again on every reload, which is why the plaza showed dots for a couple of seconds.
  const cache = immutable ? "public, max-age=31536000, immutable" : p.endsWith(".glb") ? "public, max-age=86400" : "no-cache";
  if (req.headers["if-none-match"] === f.etag) { res.writeHead(304, { etag: f.etag, "cache-control": cache }); return res.end(); }
  res.writeHead(200, { etag: f.etag, "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": cache, vary: "accept-encoding", ...(gz ? { "content-encoding": "gzip" } : {}), "content-length": (gz ? f.gz : f.raw).length });
  res.end(req.method === "HEAD" ? undefined : gz ? f.gz : f.raw);
}
const files = new Map(); // path -> { raw, gz, mtime }
function fileOf(p) {
  const mtime = fs.statSync(p).mtimeMs, hit = files.get(p);
  if (hit && hit.mtime === mtime) return hit;
  const raw = fs.readFileSync(p);
  const gz = /\.(js|css|html|svg|json|txt)$/.test(p) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null;
  const f = { raw, gz, mtime, etag: `"${crypto.createHash("sha1").update(raw).digest("base64url").slice(0, 22)}"` };
  if (raw.length < 20e6) files.set(p, f);
  return f;
}

// POST /api/sponsor {account}: top a testnet founder up to what founding needs, from the pool.
// Testnet only; once per account; at most 2 per IP a day; only real, short accounts; the pool's
// own cap (what it can pay for) stops it when it runs dry. Testnet NEAR has no value, but the pool
// is shared, so this stays strict.
const sponsorByIp = new Map();
// ---- Email log-in (11 Nov): sign up / log in with an email and a passphrase ----
// The browser stretches the passphrase (PBKDF2, 600,000 rounds) into two keys: one encrypts the NEAR
// key, the other is a login token. The server keeps a peppered hash of the email (never the email),
// the salt, a hash of the token, and the encrypted key. It hands the encrypted key back only for the
// right token, so knowing someone's email isn't enough to try passphrases offline. It can't sign anything.
const PEPPER = process.env.LOGIN_PEPPER || "adf-dev-pepper"; // Railway sets a real one
const loginId = (email) => crypto.createHmac("sha256", PEPPER).update(`email|${email}`).digest("hex");
const tokenHash = (auth) => crypto.createHash("sha256").update(`auth|${auth}`).digest("hex");
const loginHits = new Map(); // ip or id -> times, for the limits below
function limited(key, max, ms) {
  const now = Date.now(), list = (loginHits.get(key) || []).filter((t) => now - t < ms);
  list.push(now); loginHits.set(key, list);
  if (loginHits.size > 5000) for (const [k, v] of loginHits) if (!v.some((t) => now - t < 3600e3)) loginHits.delete(k);
  return list.length > max;
}
// A god's signed choice (13 Nov): the body is checked in engine/choices.mjs (signature, key on the account, god of
// the nation, the open turn, the kind). Testnet only; small bodies; a few a minute per connection.
async function choicePost(req, res) {
  const json = (code, o) => send(res, code, "application/json", JSON.stringify(o));
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(413, { error: "Too long." }); }
  let b; try { b = JSON.parse(body); } catch { return json(400, { error: "Bad request." }); }
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (limited(`choice|${ip}`, 30, 60e3)) return json(429, { error: "Too many choices at once. Wait a minute." });
  try { const r = await APIS.testnet._choice(b); return json(r.ok ? 200 : 400, r.ok ? { ok: true } : { error: r.error }); }
  catch (e) { console.error("choice", e); return json(500, { error: "Couldn't save that choice just now. Try again." }); }
}

async function loginPost(req, res, what) {
  const json = (code, o) => send(res, code, "application/json", JSON.stringify(o));
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(413, { error: "Too long." }); }
  let b; try { b = JSON.parse(body); } catch { return json(400, { error: "Bad request." }); }
  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(email)) return json(400, { error: "That doesn't look like an email address." });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (limited(`ip|${ip}`, 30, 10 * 60e3)) return json(429, { error: "Too many tries from here. Wait ten minutes." });
  const id = loginId(email), hex = (x, n) => typeof x === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(x);
  // The salt, so the browser can derive its keys. An email with no log-in gets a made-up salt that
  // stays the same, so this can't be used to find out who has signed up.
  if (what === "salt") { const row = await store.getLogin(id); return json(200, { salt: row?.salt ?? crypto.createHmac("sha256", PEPPER).update(`salt|${id}`).digest("hex").slice(0, 32) }); }
  if (!hex(b.auth, 64)) return json(400, { error: "Bad request." });
  if (what === "signup") {
    if (!hex(b.salt, 32) || !hex(b.iv, 24) || typeof b.ct !== "string" || !/^[A-Za-z0-9+/=]{20,1400}$/.test(b.ct) || !/^[a-z0-9_\-.]{2,64}$/.test(String(b.account || ""))) return json(400, { error: "Bad request." });
    if (limited(`signup|${ip}`, 5, 24 * 3600e3)) return json(429, { error: "Five sign-ups a day from one connection." });
    const ok = await store.addLogin({ id, net: "testnet", account: b.account, salt: b.salt, auth: tokenHash(b.auth), iv: b.iv, ct: b.ct });
    return ok ? json(200, { ok: true }) : json(409, { error: "That email already has an account here. Log in instead." });
  }
  // Log in or forget me: the right token, at most 5 wrong ones an hour per email.
  const fails = (loginHits.get(`fail|${id}`) || []).filter((t) => Date.now() - t < 3600e3);
  if (fails.length >= 5) return json(429, { error: "Too many wrong passphrases for this email. Try again in an hour." });
  const row = await store.getLogin(id);
  const good = row && crypto.timingSafeEqual(Buffer.from(row.auth, "hex"), Buffer.from(tokenHash(b.auth), "hex"));
  if (!good) { loginHits.set(`fail|${id}`, [...fails, Date.now()]); return json(401, { error: "That email and passphrase don't match." }); }
  if (what === "forget") { await store.deleteLogin(id); return json(200, { ok: true }); }
  return json(200, { account: row.account, iv: row.iv, ct: row.ct });
}

async function sponsorPost(req, res) {
  const json = (code, o) => send(res, code, "application/json", JSON.stringify(o));
  const pool = process.env.SPONSOR_ACCOUNT_ID, key = process.env.SPONSOR_PRIVATE_KEY;
  if (!pool || !key) return json(503, { error: "Free starting grace isn't set up." });
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 512) return json(413, { error: "Too long." }); }
  let account = "", publicKey = "";
  try { const b = JSON.parse(body); account = String(b.account || "").trim().toLowerCase(); publicKey = String(b.public_key || "").trim(); } catch { return json(400, { error: "Send {\"account\": \"you.testnet\"}." }); }
  // Play without a wallet (9 Nov): {public_key} -> the pool makes the player a named account
  // (amber-quill-417.<pool>), funded to found a nation, with that key on it. Same limits as below.
  if (publicKey) return sponsorNamed(req, res, json, pool, key, publicKey);
  if (!/^[a-z0-9_\-.]{2,64}$/.test(account) || !(account.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(account))) return json(400, { error: "That account isn't one we know." });
  if (account.startsWith("adf-") || account === pool) return json(400, { error: "That account belongs to the world." });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const today = (sponsorByIp.get(ip) || []).filter((t) => Date.now() - t < 24 * 3600e3);
  if (today.length >= 2) return json(429, { error: "Two sponsorships a day from one connection. Try again tomorrow, or bless a nation instead." });
  if (await store.wasSponsored("testnet", account)) return json(409, { error: "This account already got its starting grace. Bless a nation instead." });
  // A brand-new implicit account (a key made in the browser: Play without a wallet) has no account on
  // chain until NEAR is sent to it; the transfer creates it. Named accounts must already exist.
  const have = (await balanceOf(account)) ?? (/^[0-9a-f]{64}$/.test(account) ? 0n : null);
  if (have == null) return json(404, { error: "That account doesn't exist yet." });
  if (have >= SPONSOR.perNation) return json(400, { error: "You already have enough to found a nation." });
  if ((await nationsLeft(pool)) < 1) return json(410, { error: "New nations are full for now. Bless a nation to become one of its gods." });
  try {
    const amount = SPONSOR.perNation - have;
    const tx = await topUp(pool, key, account, amount);
    await store.markSponsored("testnet", account, tx);
    sponsorByIp.set(ip, [...today, Date.now()]);
    // Its nation's DAO + staking go into the world's founding fund (9 Nov), so all it founds with becomes florins.
    fundFounding(pool, key, NETWORKS.testnet.world).catch((e) => console.error("founding fund top-up", String(e?.message ?? e).slice(0, 160)));
    cache.delete("testnet:sponsor");
    return json(200, { ok: true, sent: near(amount.toString()), tx });
  } catch (e) {
    console.error("sponsor", e);
    return json(500, { error: "The pool couldn't send just now. Try again in a minute." });
  }
}

async function sponsorNamed(req, res, json, pool, key, publicKey) {
  if (!PUBLIC_KEY.test(publicKey)) return json(400, { error: "That sign-in didn't look right. Try again." });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const today = (sponsorByIp.get(ip) || []).filter((t) => Date.now() - t < 24 * 3600e3);
  if (today.length >= 2) return json(429, { error: "Two sponsorships a day from one connection. Try again tomorrow, or bless a nation instead." });
  if ((await nationsLeft(pool)) < 1) return json(410, { error: "New nations are full for now. Bless a nation to become one of its gods." });
  sponsorByIp.set(ip, [...today, Date.now()]); // counted before the send, so two quick clicks can't both pass
  try {
    const { account, tx } = await createNamed(pool, key, publicKey, SPONSOR.perNation);
    await store.markSponsored("testnet", account, tx);
    fundFounding(pool, key, NETWORKS.testnet.world).catch((e) => console.error("founding fund top-up", String(e?.message ?? e).slice(0, 160)));
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
    if (req.method === "POST" && url.pathname === "/api/choice") return choicePost(req, res);
    { const lm = req.method === "POST" && url.pathname.match(/^\/api\/login(?:\/(salt|signup|forget))?$/); if (lm) return loginPost(req, res, lm[1] || "login"); }
    // The sandbox (/timelapse, timelapse/service.mjs): copies of the live world to shock and fast-forward.
    if (SANDBOX && (url.pathname === "/sbx" || url.pathname.startsWith("/sbx/"))) return (await SANDBOX).handleSandbox(req, res, url);
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
      if (net === "mainnet" && !(await mainnetOpen())) return send(res, 200, "application/json", JSON.stringify(MAINNET_CLOSED));
      try {
        let out = await fn(url.searchParams);
        // Ended nations are removed from everything but the sealed records (dropEnded above).
        if (m[1] !== "proof" && m[1] !== "day" && m[1] !== "live") out = dropEnded(m[1], out, await APIS[net]._ended().catch(() => []));
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
