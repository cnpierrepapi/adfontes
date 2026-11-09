// Builds the season world's data (his call 9 Nov): every turn of the season, turn 1 to the end of the
// god simulation, as the 3D world needs it: each nation's true state on every turn, and every
// turn's records. /timelapse/ runs the live world's own 3D code on this instead of the live API.
//
// Where the truth comes from:
//   turns 1..REAL_TO   the real season: the sealed records from the live site's API
//   turns REAL_TO+1..  the god simulation (scripts/sim-week.mjs --gods): its records, and the
//                      status line the engine printed for every nation on every turn (florins, NEAR
//                      put in, mood, points, depth, clean gifts, fortune) and the world's totals
//   mind maps          the sim's final state, rewound turn by turn through the records (research,
//                      buys and ruins add points; battles and root-outs take them away). Checked:
//                      the rewound point count must equal the engine's printed count every sim turn.
//   florins before REAL_TO: not printed by the engine then, so marked unknown (null), never guessed.
//
//   node scripts/season-build.mjs [simDir=debug/sim-gods] [site=https://adfontes.fun]
import fs from "node:fs";
import { chainDepth, deepestChain } from "../engine/world.mjs";

const SIM = process.argv[2] || "debug/sim-gods", SITE = process.argv[3] || "https://adfontes.fun";
const CACHE = "debug/season-cache";
fs.mkdirSync(CACHE, { recursive: true });
const REAL_TO = JSON.parse(fs.readFileSync(`${SIM}/seed.json`, "utf8")).day;
const S = JSON.parse(fs.readFileSync(`${SIM}/state/testnet.json`, "utf8"));
const CH = JSON.parse(fs.readFileSync(`${SIM}/chain.json`, "utf8"));
const before = JSON.parse(fs.readFileSync(`${SIM}/before-world.json`, "utf8")); // the live world on turn REAL_TO
const getJSON = async (path) => {
  const f = `${CACHE}/${path.replace(/[^a-z0-9]+/gi, "_")}.json`;
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const v = await fetch(`${SITE}/api/${path}`).then((r) => r.json());
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
};

// ---- every turn's records ----
const days = {};
for (let d = 1; d <= REAL_TO; d++) days[d] = (await getJSON(`day?d=${d}`)).records || [];
const simDir = `${SIM}/state/testnet`;
for (const f of fs.readdirSync(simDir).filter((f) => /^day-\d+\.json$/.test(f))) {
  const d = parseInt(f.slice(4));
  if (d > REAL_TO) days[d] = JSON.parse(fs.readFileSync(`${simDir}/${f}`, "utf8"));
}
const LAST = Math.max(...Object.keys(days).map(Number));
// The simulated gods' visits (scripts/sim-gods.mjs ran before engine turn REAL_TO + n).
for (const line of fs.readFileSync(`${SIM}/gods.log`, "utf8").split("\n")) {
  const m = line.match(/^turn (\d+) (\{.*\})$/);
  if (!m) continue;
  const g = JSON.parse(m[2]), d = REAL_TO + Number(m[1]);
  if (!days[d] || !g.blessed) continue;
  days[d].unshift({ kind: "bless", day: d, clan: g.clan, god: g.god, near: g.blessed, mode: g.mode, sim: true });
}

// Turns gods.log lost (debug/ab-new): the blessings the engine saw, from its reverence records.
{
  const logged = new Set(Object.entries(days).filter(([d, rs]) => +d > REAL_TO && rs.some((r) => r.kind === "bless" && r.sim)).map(([d]) => +d));
  const firstLogged = logged.size ? Math.min(...logged) : Infinity;
  for (const [d, rs] of Object.entries(days)) {
    if (+d <= REAL_TO || +d >= firstLogged) continue;
    const add = [];
    for (const r of rs) if (r.kind === "reverence") for (const ch of r.changes || []) { const m = /^blessed ([\d.]+) NEAR/.exec(ch.why || ""); if (m) add.push({ kind: "bless", day: +d, clan: r.clan, god: String(ch.god).slice(0, 8), near: +m[1], sim: true }); }
    rs.unshift(...add);
  }
}

// ---- the engine's per-turn status lines (sim turns) ----
const status = {}, totals = {};
let cur = null;
for (const line of fs.readFileSync(`${SIM}/run.log`, "utf8").split("\n")) {
  let m = line.match(/^DAY (\d+) \|/);
  if (m) { cur = Number(m[1]); status[cur] = {}; continue; }
  m = line.match(/^clan (\d+) .+? florins ([\d.]+) in ([\d.]+) NEAR \| (\w+) \| mindmap (\d+) points, depth (\d+), frontier (\d+) \| clean gifts (\d+) \| fortune ([\d.]+)/);
  if (m && cur) { status[cur][m[1]] = { florins: +m[2], total_in: +m[3], mood: m[4], points: +m[5], depth: +m[6], frontier: +m[7], clean_gifts: +m[8], fortune: +m[9] }; continue; }
  m = line.match(/^world: balance ([\d.]+) owes ([\d.]+) storage ([\d.]+) \| backing ([\d.]+) jackpot ([\d.]+) \| florins ([\d.]+) worth ([\d.]+) NEAR each, minted ([\d.]+) burned ([\d.]+)/);
  if (m && cur) totals[cur] = { balance: +m[1], owed: +m[2], backing: +m[4], florins: +m[6], florin_value: +m[7], minted: +m[8], burned: +m[9], jackpot: +m[5] };
}

// ---- sim turns the run log lost (debug/ab-new kept only its last 15 turns' status lines) ----
// Florins: rewound from the sim's final state through every record that moves them. Checked on the
// turns that were printed (largest gap 0.215 florins: patent royalties paid with no record of their
// own) and against the live world on the seed turn. Mood (needs records) and fortune (rulings) carry
// forward from the seed turn. NEAR put in stays unknown: a blessing made at the reverence cap
// leaves no record, so it can't be rewound without guessing.
{
  const CHk = JSON.parse(fs.readFileSync(`${SIM}/chain.json`, "utf8"));
  const lastSim = Math.max(...Object.keys(days).map(Number));
  const missing = [];
  for (let d = REAL_TO + 1; d <= lastSim; d++) if (!status[d] || !Object.keys(status[d]).length) missing.push(d);
  if (missing.length) {
    const fx = (rs) => {
      const e = {}, add = (c, v) => { if (c != null && isFinite(v)) e[c] = (e[c] || 0) + v; };
      for (const r of rs) {
        if (r.kind === "mint") add(r.clan, r.florins);
        else if (r.kind === "upkeep") add(r.clan, -(r.paid ?? r.florins));
        else if (r.kind === "warden") add(r.clan, -(r.fine || 0));
        else if (r.kind === "trade" || r.kind === "market-sale") { add(r.buyer, -(r.price || 0)); add(r.seller, r.price || 0); }
        else if (r.kind === "royalty") add(r.clan, r.florins);
        else if (r.kind === "fortify") add(r.clan, -(r.spent || 0));
        else if (r.kind === "battle") for (const [id, sd] of Object.entries(r.sides)) add(+id, -(sd.spend || 0));
        else if (r.kind === "fallen") { add(r.by, r.loot || 0); add(r.clan, -(r.loot || 0)); }
      }
      return e;
    };
    const F = Object.fromEntries(CHk.clans.map((c) => [c.id, Number(BigInt(c.florins) / 10n ** 16n) / 1e6]));
    const fl = {};
    for (let d = lastSim; d > REAL_TO; d--) { fl[d] = { ...F }; const e = fx(days[d]); for (const id of Object.keys(F)) F[id] -= e[id] || 0; }
    const mood = Object.fromEntries(before.clans.map((c) => [c.id, c.mood ?? null]));
    const fortune = Object.fromEntries(before.clans.map((c) => [c.id, c.fortune ?? null]));
    for (let d = REAL_TO + 1; d <= lastSim; d++) {
      for (const r of days[d]) { if (r.kind === "needs" && r.mood) mood[r.clan] = r.mood; if (r.kind === "ruling" && r.fortune != null) fortune[r.clan] = r.fortune; }
      if (!missing.includes(d)) continue;
      status[d] = Object.fromEntries(CHk.clans.map((c) => [c.id, { florins: +fl[d][c.id].toFixed(3), total_in: null, mood: mood[c.id], fortune: fortune[c.id], points: null, clean_gifts: null }]));
    }
    console.log(`filled ${missing.length} sim turns the run log lost (florins rewound, mood + fortune carried forward, NEAR put in unknown); seed-turn check:`,
      before.clans.map((c) => `${c.name} ${Math.round(F[c.id])} vs ${Math.round(c.florins)}`).join(", "));
  }
}

// ---- the nations ----
const clanIds = S.clans ? Object.keys(S.clans).map(Number).sort((a, b) => a - b) : [];
const chainClan = (id) => CH.clans.find((c) => c.id === id);
const nations = clanIds.map((id) => {
  const st = S.clans[id], b = before.clans.find((c) => c.id === id) || {};
  const founded = Object.entries(days).flatMap(([d, rs]) => rs.filter((r) => r.kind === "founded" && r.clan === id).map(() => Number(d)))[0] ?? 1;
  return { id, name: chainClan(id)?.name ?? b.name, dao: chainClan(id)?.dao ?? b.dao, field: st.field, mbti: st.mbti, alias: b.alias ?? st.alias ?? null, founded };
});

// ---- what each point looks like (parent, depth, how): the sim's final state, the live world now
// (points the sim burned are still there), the sim's frontier ----
const live = {};
for (const n of nations) live[n.id] = await getJSON(`clan?id=${n.id}`);
const info = {};
for (const n of nations) {
  const I = (info[n.id] = {});
  for (const p of live[n.id].points || []) I[p.point] = { parent: p.parent, depth: p.depth, how: p.how, corpus: p.corpus?.id ?? null };
  for (const [k, v] of Object.entries(S.clans[n.id].frontier || {})) I[k] ??= { parent: v.parent, depth: v.depth, how: "researched", corpus: null };
  for (const [k, v] of Object.entries(S.clans[n.id].owned)) I[k] = { parent: v.parent, depth: v.depth, how: v.how, corpus: v.corpus ?? null, stir: v.stir };
}

// ---- rewind the mind maps: owned[d][clan] = the set of points it held at the end of turn d ----
const owned = {};
const now = Object.fromEntries(nations.map((n) => [n.id, new Set(Object.keys(S.clans[n.id].owned))]));
const extra = {}; // points that came back on rewind and the sim's final state doesn't describe
for (let d = LAST; d >= 1; d--) {
  owned[d] = Object.fromEntries(nations.map((n) => [n.id, [...now[n.id]]]));
  for (const r of [...days[d]].reverse()) {
    const field = (id) => nations.find((n) => n.id === id)?.field;
    if (r.kind === "corpus" && !r.fake && r.point !== field(r.clan)) now[r.clan]?.delete(r.point);
    else if (r.kind === "trade" && !r.tool && r.point) now[r.buyer]?.delete(r.point);
    else if (r.kind === "absorb") for (const p of r.points || []) now[r.clan]?.delete(p);
    else if (r.kind === "market-sale" && r.learned) now[r.buyer]?.delete(r.learned);
    else if (r.kind === "battle") for (const [id, sd] of Object.entries(r.sides)) for (const p of sd.burned || []) { now[id]?.add(p); if (!info[id][p]) (extra[id] ||= new Set()).add(p); }
    else if (r.kind === "rooted") for (const p of [r.point, ...(r.cut || [])]) now[r.clan]?.add(p);
    else if (r.kind === "founded") now[r.clan] = new Set();
  }
}
// Check against the engine's own count on every sim turn.
let bad = 0;
for (let d = REAL_TO + 1; d <= LAST; d++) for (const n of nations) {
  const want = status[d]?.[n.id]?.points, got = owned[d][n.id].length;
  if (want != null && want !== got) { bad++; if (bad <= 12) console.log(`MISMATCH turn ${d} ${n.name}: rewound ${got} points, engine printed ${want}`); }
}
console.log(bad ? `${bad} point-count mismatches` : `points: rewound mind maps match the engine's count on all ${LAST - REAL_TO} sim turns × ${nations.length} nations`);
for (const [id, set] of Object.entries(extra)) console.log(`  ${nations.find((n) => n.id === +id).name}: ${set.size} burned point(s) with no record of their parent, hung off the root: ${[...set].slice(0, 5).join(", ")}`);

// A burned point with no description left: its parent is the point whose research opened it up
// (each write-up lists the points it leads to).
for (const [id, set] of Object.entries(extra)) for (const p of set) {
  if (info[id][p]) continue;
  const opener = Object.values(S.corpora).find((sc) => sc.clan === +id && (sc.children || []).includes(p));
  if (opener && info[id][opener.node]) { info[id][p] = { parent: opener.node, depth: (info[id][opener.node].depth ?? 0) + 1, how: "researched", corpus: null }; set.delete(p); }
}
for (const [id, set] of Object.entries(extra)) if (set.size) console.log(`  still no parent for ${set.size} in ${nations.find((n) => n.id === +id).name}`);
// Real turns: the rewound count on turn REAL_TO against the live world's own snapshot of that turn.
for (const n of nations) { const want = before.clans.find((c) => c.id === n.id)?.points, got = owned[REAL_TO][n.id].length; if (want !== got) console.log(`turn ${REAL_TO} ${n.name}: rewound ${got}, the live world then had ${want}`); }
console.log("founding turns:", nations.map((n) => `${n.name} t${n.founded}: ${owned[n.founded][n.id].length} pts`).join(", "));

// ---- walls, wars, reverence, techs, tricksters, gods: forward through the records ----
const W = {}; // W[d][clan] = per-turn facts
const walls = {}, techs = {}, tricksters = {}, rev = {}, fallen = {}, cleanGifts = {}, wars = {};
for (let d = 1; d <= LAST; d++) {
  for (const r of days[d]) {
    if (r.kind === "fortify") walls[r.clan] = (walls[r.clan] || 0) + (r.spent || 0);
    else if (r.kind === "battle") for (const id of Object.keys(r.sides)) walls[id] = (walls[id] || 0) * 0.98;
    else if (r.kind === "tech") (techs[r.clan] ||= []).includes(r.tech) || techs[r.clan].push(r.tech);
    else if (r.kind === "trickster") tricksters[r.clan] = (tricksters[r.clan] || 0) + 1;
    else if (r.kind === "reverence") rev[r.clan] = { followed: r.followed ?? null, claimed_by: r.claimed_by ?? null, waiting: !!r.waiting, gods: r.gods || {} };
    else if (r.kind === "fallen") fallen[r.clan] = { day: d, by: r.by, war: r.war };
    else if (r.kind === "gift" && r.passed) cleanGifts[r.clan] = (cleanGifts[r.clan] || 0) + 1;
    else if (r.kind === "war") wars[r.war] = { id: r.war, a: r.attacker, b: r.defender, since: d, rounds: 0, offer: null, status: "on" };
    else if (r.kind === "peace-offer") { const w = Object.values(wars).find((x) => x.status === "on" && (x.a === r.clan || x.b === r.clan)); if (w) w.offer = r.clan; }
    else if (r.kind === "peace") { if (wars[r.war]) wars[r.war].status = "peace"; }
    if (r.kind === "battle" && wars[r.war]) wars[r.war].rounds = r.round;
    if (r.kind === "fallen" && wars[r.war]) wars[r.war].status = "won";
  }
  W[d] = {};
  for (const n of nations) {
    if (d < n.founded) continue;
    const id = n.id, pts = owned[d][id];
    const c = { owned: Object.fromEntries(pts.map((p) => [p, { ...(info[id][p] || { parent: n.field, depth: 1 }) }])), field: n.field };
    if (c.owned[n.field]) c.owned[n.field].depth = 0;
    const s = status[d]?.[id];
    // The last turn reads the sim's final state: a turn whose research failed (OpenAlex 429) skipped the
    // nation's reverence record, so Helios and Fremonition have none after day 80 in debug/ab-new.
    const R = d === LAST && S.rev?.[id] ? { followed: S.rev[id].followed ?? null, claimed_by: S.rev[id].claimedBy ?? null, waiting: !!S.rev[id].waiting, gods: Object.fromEntries(Object.entries(S.rev[id].gods).map(([a, g]) => [a, g.r])) } : rev[id];
    const godR = R ? Object.fromEntries(Object.entries(R.gods).map(([a, v]) => [a, { r: Math.round((typeof v === "number" ? v : v.r ?? 0) * 10) / 10, enemies: 0, outsider: false }])) : {};
    const war = Object.values(wars).find((w) => w.status === "on" && (w.a === id || w.b === id));
    const enemy = war ? (war.a === id ? war.b : war.a) : null;
    W[d][id] = {
      points: pts.length, depth: chainDepth(c), line: deepestChain(c),
      florins: s?.florins ?? (d === REAL_TO ? before.clans.find((x) => x.id === id)?.florins ?? null : null),
      total_in: s?.total_in ?? (d === REAL_TO ? before.clans.find((x) => x.id === id)?.total_in ?? null : null),
      mood: s?.mood ?? null, fortune: s?.fortune ?? null, clean_gifts: s?.clean_gifts ?? (cleanGifts[id] || 0),
      techs: [...(techs[id] || [])], tricksters: tricksters[id] || 0, walls: +(walls[id] || 0).toFixed(1),
      gods: Object.keys(godR).length,
      reverence: R ? { followed: R.followed, claimed_by: R.claimed_by, waiting: R.waiting, standing: R.followed ? godR[R.followed]?.r ?? 0 : 0, gods: godR } : null,
      fallen: fallen[id] && fallen[id].day <= d ? fallen[id] : null,
      war: war ? { id: war.id, enemy, since: war.since, rounds: war.rounds, attacker: war.a === id, offer: war.offer, hp: Math.max(0, pts.length - 1), enemyHp: Math.max(0, (owned[d][enemy]?.length ?? 1) - 1), walls: +(walls[id] || 0).toFixed(1), fairGame: true } : { walls: +(walls[id] || 0).toFixed(1), fairGame: (cleanGifts[id] || 0) > 0 },
    };
  }
}
// Walls check: the rebuilt walls against the sim's final state.
for (const n of nations) { const want = +(S.clans[n.id].walls || 0).toFixed(1), got = W[LAST][n.id]?.walls; if (Math.abs(want - got) > 0.5) console.log(`walls: ${n.name} rebuilt ${got}, final state ${want}`); }

// ---- each point's life: [point, parent, depth, how, from, to] (to = null: still held at the end) ----
const lives = {};
for (const n of nations) {
  const L = (lives[n.id] = []), open = new Map();
  for (let d = n.founded; d <= LAST; d++) {
    const set = new Set(owned[d][n.id]);
    for (const p of set) if (!open.has(p)) open.set(p, d);
    for (const [p, from] of [...open]) if (!set.has(p)) { L.push([p, from, d - 1]); open.delete(p); }
  }
  for (const [p, from] of open) L.push([p, from, null]);
}
const pointInfo = Object.fromEntries(nations.map((n) => [n.id, Object.fromEntries(lives[n.id].map(([p]) => [p, info[n.id][p] ? [info[n.id][p].parent, info[n.id][p].depth, info[n.id][p].how ?? "", info[n.id][p].stir ?? "calm"] : [n.field, 1, "", "calm"]]))]));

// ---- the citizens, the drafts, the sky's faint edge ----
const agents = Object.fromEntries(nations.map((n) => [n.id, (CH.agents[n.id] || []).map((a) => ({ name: a.name, role: a.role, born_day: a.born_day ?? 0, alive: a.alive !== false, stunted_until: a.stunted_until ?? 0 }))]));
const drafts = Object.values(S.drafts || {}).map((x) => ({ id: x.id, clan: x.clan, day: x.day, passed: !!x.passed, title: x.title || x.draft?.title || null, chain: x.chain || [] }));
const frontier = Object.fromEntries(nations.map((n) => [n.id, Object.entries(S.clans[n.id].frontier || {}).slice(0, 80).map(([k, v]) => [k, v.parent, v.depth])]));

// ---- the turns: clock, totals, records (trimmed to what the world plays and the captions say) ----
const KEEP = new Set(["clock", "corpus", "trade", "gift", "warden", "trickster", "absorb", "tech", "founded", "rooted", "ruling", "tool", "war", "battle", "fortify", "peace-offer", "peace", "fallen", "council", "bless", "report", "report-settled", "needs", "listed", "market-buy", "royalty", "market-sale", "delisted", "broker", "heard"]); // the last four feed the plain view (market, gods)
const turns = [];
for (let d = 1; d <= LAST; d++) {
  const clock = days[d].find((r) => r.kind === "clock");
  turns.push({
    day: d, sim: d > REAL_TO,
    clock: clock ? { phase: clock.phase, price: clock.price, change: clock.change, unit: clock.unit, days: clock.days, nights: clock.nights, cycle: clock.cycle } : null,
    totals: totals[d] ?? (d === REAL_TO ? before.totals : null),
    records: days[d].filter((r) => KEEP.has(r.kind)).map(({ hash, raw, at, live: _l, signer, ...r }) => ({ ...r, day: d })),
    clans: W[d],
  });
}
const out = { built: new Date().toISOString(), real_to: REAL_TO, last: LAST, season: before.season, world: before.world, explorer: before.explorer, nations, pointInfo, lives, agents, drafts, frontier, turns };
fs.mkdirSync("public/season", { recursive: true });
fs.writeFileSync("public/season/season.json", JSON.stringify(out));
const kb = Math.round(fs.statSync("public/season/season.json").size / 1024);
console.log(`season: turns 1-${LAST} (real 1-${REAL_TO}), ${nations.length} nations, ${turns.reduce((a, t) => a + t.records.length, 0)} records, ${kb} KB`);
