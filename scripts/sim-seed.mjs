// Seeds the fast-forward simulation with a copy of the live testnet world, as of now, from public
// data only: the site's API (each nation's knowledge, drafts, techs, wars, reverence) and NEAR view
// calls (nations, money, citizens). Nothing is written anywhere but debug/sim/.
//   node scripts/sim-seed.mjs [dir=debug/sim]
import fs from "node:fs";
import { JsonRpcProvider } from "near-api-js";

const OUT = process.argv[2] || "debug/sim", SITE = "https://adfontes.fun", WORLD = "w6.adf-pool1-hf0w8.testnet";
const api = (p) => fetch(`${SITE}/api/${p}${p.includes("?") ? "&" : "?"}net=testnet`).then((r) => r.json());
const T0 = Date.now(), H = 3600e3;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/state/testnet`, { recursive: true });

// 1. The chain (view calls only).
const rpc = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const view = (method, args = {}) => rpc.callFunction({ contractId: WORLD, method, args });
const [config, totals, chainClans] = await Promise.all([view("get_config"), view("get_totals"), view("list_clans", { limit: 100 })]);
const agents = {};
for (const c of chainClans) agents[c.id] = await view("list_agents", { clan_id: c.id, limit: 100 });
fs.writeFileSync(`${OUT}/chain.json`, JSON.stringify({ config, totals, clans: chainClans, agents, gifts: {}, roots: {}, nextGift: 100000 }));

// 2. The engine's state, rebuilt from the public API.
const W = await api("world");
const s = { world: "sim.local", day: W.day, // the stand-in chain's name: the engine's world check must match it
   clans: {}, corpora: {}, drafts: {}, gifts: {}, tools: {}, ruins: {}, roots: {}, rev: {}, wars: {}, peace: {}, reports: {}, nextId: 900000, lastRunAt: T0 - 2 * H };
for (const wc of W.clans) {
  const d = await api(`clan?id=${wc.id}`);
  const cc = chainClans.find((x) => x.id === wc.id);
  const owned = {}, frontier = {};
  for (const p of d.points) {
    owned[p.point] = { depth: p.depth, parent: p.parent, corpus: p.corpus?.id ?? null, how: p.how, stir: p.stir };
    if (p.corpus) {
      const from = /bought from clan (\d+)/.exec(p.how || "");
      s.corpora[p.corpus.id] ||= { id: p.corpus.id, clan: from ? Number(from[1]) : wc.id, node: p.point, title: p.corpus.title, children: [], clean: true, findings: [], gaps: [] };
    }
  }
  for (const f of d.frontier || []) frontier[f.point] = { depth: f.depth, parent: f.parent };
  for (const dr of d.drafts || []) s.drafts[dr.id] = { id: dr.id, clan: wc.id, day: dr.day, passed: dr.passed, title: dr.title, chain: dr.chain || [] };
  const passed = (d.drafts || []).filter((x) => x.passed).length;
  s.clans[wc.id] = {
    id: wc.id, name: wc.name, field: d.field, mbti: d.mbti, fortune: d.fortune ?? 1, tricksters: wc.tricksters ?? 0,
    owned, frontier, skills: Object.fromEntries((d.agents || []).map((a) => [a.name, {}])), alive: wc.alive !== false, teamDone: true,
    techs: wc.techs || [], mood: wc.mood, need: wc.need, walls: wc.war?.walls || 0, passedDrafts: passed, firstDraftDone: passed > 0, hasKit: false,
    bornDay: 1, bornAt: T0 - 24 * H, lastDraftDay: W.day - 1, lastDraftAt: T0 - 12 * H, lastUpkeepAt: T0, lastUpkeepDay: W.day,
    lastTechAt: T0 - 12 * H, lastCouncilAt: T0 - 12 * H, lastBrokerAskAt: T0 - 12 * H, lastActAt: T0, lastTotalIn: cc?.total_in ?? "0", blessings: 0,
  };
  // Reverence as the site shows it.
  if (d.reverence) s.rev[wc.id] = {
    gods: Object.fromEntries(Object.entries(d.reverence.gods || {}).map(([a, g]) => [a, { r: g.r, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0, text: "", outsider: g.outsider }])),
    followed: d.reverence.followed, claimedBy: d.reverence.claimed_by, waiting: false, since: 1, lastProposal: null, putIn: {},
  };
}
for (const w of W.wars || []) s.wars[w.id] = { id: w.id, a: w.a, b: w.b, status: "on", startedDay: w.since, startedAt: T0 - 6 * H, rounds: w.rounds, ...(w.offer ? { offer: { by: w.offer } } : {}) };
fs.writeFileSync(`${OUT}/state/testnet.json`, JSON.stringify(s));
fs.writeFileSync(`${OUT}/before-world.json`, JSON.stringify(W));
fs.writeFileSync(`${OUT}/seed.json`, JSON.stringify({ seededAt: T0, day: W.day }));
console.log(`seeded at turn ${W.day}: ${W.clans.length} nations (${W.clans.map((c) => c.name).join(", ")}), ${Object.keys(s.corpora).length} research pieces, ${Object.keys(s.drafts).length} drafts, ${Object.keys(s.wars).length} war(s)`);
