// The season world's data source: answers the live world's API calls (world, day, clan, trades, live)
// from public/season/season.json for whichever turn the player is on. Built by
// scripts/season-build.mjs: the real turns from the sealed records, the rest from the god simulation.
export async function loadSeason() {
  const S = await fetch("/season/season.json", { cache: "no-cache" }).then((r) => r.json());
  let T = 1;
  const nation = Object.fromEntries(S.nations.map((n) => [n.id, n]));
  const turn = (d) => S.turns[Math.max(1, Math.min(S.last, d)) - 1];
  const nameOf = (id) => nation[id]?.name ?? `nation ${id}`;

  // A nation's mind map on turn d: the points it held then, with their parent and depth.
  function pointsAt(id, d) {
    const info = S.pointInfo[id] || {};
    return (S.lives[id] || []).filter(([, from, to]) => from <= d && (to == null || to >= d)).map(([p]) => {
      const [parent, depth, how, stir] = info[p] || [nation[id].field, 1, "", "calm"];
      return { point: p, parent: p === nation[id].field ? null : parent, depth: p === nation[id].field ? 0 : depth, how, stir, corpus: null };
    });
  }
  function clanAt(id, d) {
    const n = nation[id], c = turn(d).clans[id];
    if (!n || !c) return null;
    const fl = c.florins, value = turn(d).totals?.florin_value ?? null;
    return {
      id, name: n.name, dao: n.dao, field: n.field, mbti: n.mbti, alias: n.alias,
      alive: c.alive ?? !c.fallen, fallen: c.fallen, seen: true, gods: c.gods, war: c.war, // alive false + no gods: ended, the island leaves
      florins: fl, worth: fl != null && value != null ? +(fl * value).toFixed(4) : null, total_in: c.total_in,
      clean_gifts: c.clean_gifts, fortune: c.fortune ?? 1, tricksters: c.tricksters, points: c.points, depth: c.depth, line: c.line,
      reverence: c.reverence, techs: c.techs, mood: c.mood, walls: c.walls, tokens: null,
    };
  }
  function world(d) {
    const t = turn(d);
    const clans = S.nations.filter((n) => t.clans[n.id]).map((n) => clanAt(n.id, d));
    const wars = [];
    for (const c of clans) if (c.war?.enemy && c.war.attacker) wars.push({ id: c.war.id, a: c.id, b: c.war.enemy, since: c.war.since, rounds: c.war.rounds, offer: c.war.offer });
    const tt = t.totals;
    return {
      net: "testnet", world: S.world, explorer: S.explorer, day: d, season: S.season, paused: false, weather: null, sim: t.sim,
      clock: t.clock ? { ...t.clock, arc: 0.5 } : null,
      totals: tt ? { balance: tt.balance, owed: tt.owed, backing: tt.backing, florins: tt.florins, florin_value: tt.florin_value, minted: tt.minted, burned: tt.burned } : null,
      jackpot: tt?.jackpot != null ? { near: tt.jackpot, paid: false } : null,
      clans, ruins: 0, wars, recent: [],
    };
  }
  function clan(id, d) {
    const n = nation[id], c = turn(d).clans[id];
    if (!n || !c) return { error: "no such clan" };
    const points = pointsAt(id, d), have = new Set(points.map((p) => p.point));
    return {
      id, field: n.field, mbti: n.mbti, fortune: c.fortune ?? 1, alive: c.alive ?? !c.fallen, points,
      frontier: (S.frontier[id] || []).filter(([, parent]) => have.has(parent)).slice(0, 40).map(([point, parent, depth]) => ({ point, parent, depth })),
      frontier_total: 0, line: c.line, depth: c.depth,
      drafts: S.drafts.filter((x) => x.clan === id && x.day <= d).map((x) => ({ id: x.id, day: x.day, passed: x.passed, title: x.title, chain: x.chain })),
      agents: (S.agents[id] || []).filter((a) => a.born_day <= d), reverence: c.reverence, reports: [],
    };
  }
  function trades(d) {
    const pairs = {};
    for (let k = Math.max(1, d - 19); k <= d; k++) for (const r of turn(k).records) if (r.kind === "trade") {
      const key = `${r.seller}>${r.buyer}`;
      (pairs[key] ||= { seller: r.seller, buyer: r.buyer, count: 0, near: 0, last: 0 }).count++;
      pairs[key].last = k;
    }
    return { day: d, span: 20, routes: Object.values(pairs) };
  }
  async function api(path) {
    const u = new URL(path, "http://x"), q = u.searchParams, what = u.pathname.slice(1);
    if (what === "world") return world(T);
    if (what === "day") { const d = Number(q.get("d")); return d >= 1 && d <= T ? { day: d, records: turn(d).records, root: null } : { day: d, records: [] }; }
    if (what === "clan") return clan(Number(q.get("id")), T);
    if (what === "trades") return trades(T);
    if (what === "live") return { now_ms: Date.now(), records: [] };
    if (what === "gifts") return { now_ms: Date.now(), gifts: [] };
    if (what === "sponsor") return { available: false };
    return {};
  }
  return { S, api, nameOf, clanAt, world, get turn() { return T; }, set turn(d) { T = Math.max(1, Math.min(S.last, d)); }, records: (d) => turn(d).records, isSim: (d) => turn(d).sim };
}
