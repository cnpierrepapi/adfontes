// War (his call 8 Nov, the finale): nations fight until an island falls, decided by the citizens,
// never by the gods. Pure rules here; engine/run.mjs calls them and does the chain work.
//
// - Fair game: a nation that has had one patent draft passed (both to attack and to be attacked).
// - Once a real day each eligible nation's war council (the Patron, one cheap model call) picks one
//   move: declare war on someone, fortify, offer peace, accept peace, or hold. Whispers are ignored.
// - One war at a time per nation. Peace needs both sides; a pair that made peace can't fight again
//   for a few days.
// - While at war both nations stop research and drafting: the citizens fight. Every scheduled turn
//   is one round: each side spends from its war chest (burned) and strikes. Damage burns knowledge
//   points off the other island's edge; the island is its knowledge, so it visibly shrinks.
// - The dice come from the last root sealed on NEAR, so nobody can rig a roll and anyone can redo it.
// - An island down to its root falls: the winner takes 50% of its florins (the rest stays claimable
//   by its gods), its knowledge, and two refugees.
import { createHash } from "node:crypto";

export const WAR = {
  councilEveryMs: 24 * 3600e3, // one council a real day per nation
  peaceCooldownMs: 3 * 24 * 3600e3,
  spendFrac: 0.01,             // each round each side burns 1% of its florins on the war chest
  base: 0.18,                  // damage scale: two equal ~33-point nations fall in about 9-15 days (tests/war-sim)
  techBonus: 0.1,              // +10% strike per tech
  kitBonus: 0.05,              // +5% per figure kit, up to 5
  fortifyFrac: 0.1,            // fortify spends 10% of florins on walls
  wallPerFlorin: 0.015,        // each florin on walls adds 1.5% defence (testnet florin scale)
  wallsMax: 1.5,               // defence multiplier caps at 2.5x
  wallDecay: 0.98,             // walls wear 2% a round while at war
  plunder: 0.5,                // the winner takes half the fallen nation's florins
  refugees: 2,
};

// The arsenal (his call 8 Nov: at least seven kinds of attack). What a nation can field depends on
// what it has; each round's weapon is picked with the round's own dice, so it can be redone too.
// Weapons change the look and a little of the punch; the mean stays near 1 so pacing holds.
export const WEAPONS = {
  cannon:       { mult: 1.0,  needs: () => true },
  arrows:       { mult: 0.85, needs: () => true },                    // fire arrows
  trebuchet:    { mult: 1.2,  needs: () => true },
  mortar:       { mult: 1.05, needs: (c) => has(c, "clock") },        // timed fuses
  starlance:    { mult: 1.15, needs: (c) => has(c, "astrolabe") },    // a beam of starlight
  burningglass: { mult: 1.1,  needs: (c) => has(c, "spectacles") },   // lenses focus the sun
  pamphlets:    { mult: 0.8,  needs: (c) => has(c, "press") },        // a storm of paper: shakes faith more than walls
  ornithopters: { mult: 1.1,  needs: (c) => (c.techs?.length || 0) >= 3 }, // Da Vinci's flying machines
};
const has = (c, t) => (c.techs || []).includes(t);
export const arsenal = (c) => Object.keys(WEAPONS).filter((w) => WEAPONS[w].needs(c));
/** The weapon a side uses this round: fixed by the sealed root like the dice. */
export function weaponFor(seed, warId, round, side, c) {
  const list = arsenal(c), h = createHash("sha256").update(`${seed}|${warId}|${round}|${side}|weapon`).digest();
  return list[h.readUInt32BE(0) % list.length];
}

/** Has this nation had a patent draft passed? (his rule: then it's fair game) */
export function eligible(s, id) {
  const c = s.clans[id];
  if (!c || c.alive === false || c.fallen) return false;
  return Object.values(s.drafts || {}).some((d) => d.clan === id && d.passed);
}

/** The war a nation is in, if any. */
export function warOf(s, id) {
  return Object.values(s.wars || {}).find((w) => w.status === "on" && (w.a === id || w.b === id)) || null;
}

/** Deterministic dice in [0.5, 1.5): from the last sealed root, the war and the round. */
export function dice(seed, warId, round, side) {
  const h = createHash("sha256").update(`${seed}|${warId}|${round}|${side}`).digest();
  return 0.5 + h.readUInt32BE(0) / 2 ** 32;
}

/** How hard a nation strikes (before dice): techs and figure kits. */
export function strength(s, id) {
  const c = s.clans[id];
  const kits = Object.values(s.tools || {}).filter((t) => t.clan === id).length;
  return (1 + WAR.techBonus * (c.techs?.length || 0)) * (1 + WAR.kitBonus * Math.min(5, kits));
}

/** Defence multiplier from walls. */
export const defence = (c) => 1 + Math.min(WAR.wallsMax, (c.walls || 0) * WAR.wallPerFlorin);

/** The island's hit points: its knowledge points (the root never burns). */
export const hp = (c) => Math.max(0, Object.keys(c.owned).length - 1);

/** Burn n points off the outer edge (deepest leaves first). Returns the burned points. */
export function burnEdge(c, n) {
  const burned = [];
  for (let i = 0; i < n; i++) {
    const kids = new Set(Object.values(c.owned).map((v) => v.parent));
    const leaves = Object.entries(c.owned).filter(([k]) => k !== c.field && !kids.has(k)).sort((a, b) => b[1].depth - a[1].depth || (a[0] < b[0] ? -1 : 1));
    if (!leaves.length) break;
    const [k] = leaves[0];
    delete c.owned[k];
    for (const [fk, fv] of Object.entries(c.frontier)) if (fv.parent === k) delete c.frontier[fk];
    burned.push(k);
  }
  return burned;
}

/** Check a council's choice against the rules. Returns { ok, why } (why = the rule it broke). */
export function allowed(s, id, move, florins = {}, now = Date.now()) {
  const w = warOf(s, id);
  if (!eligible(s, id)) return { ok: false, why: "not fair game yet (no passed patent)" };
  if (move.action === "declare") {
    const t = Number(move.target);
    if (w) return { ok: false, why: "already at war" };
    if (t === id || !eligible(s, t)) return { ok: false, why: "that nation can't be attacked" };
    if (warOf(s, t)) return { ok: false, why: "that nation is already at war" };
    const last = (s.peace || {})[pairKey(id, t)];
    if (last && now - last < WAR.peaceCooldownMs) return { ok: false, why: "peace with them is still fresh" };
    if (!((florins[id] || 0) > 1)) return { ok: false, why: "no money for a war chest" };
    return { ok: true };
  }
  if (move.action === "offer_peace") return w ? { ok: true } : { ok: false, why: "not at war" };
  if (move.action === "accept_peace") return w && w.offer && w.offer.by !== id ? { ok: true } : { ok: false, why: "no peace on offer" };
  if (move.action === "fortify" || move.action === "hold") return { ok: true };
  return { ok: false, why: "unknown move" };
}
export const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** One round of a war. florins: { [id]: current florins }. Returns what happened (no chain work). */
export function round(s, w, seed, florins) {
  const n = (w.rounds || 0) + 1;
  const out = { war: w.id, round: n, seed: String(seed).slice(0, 16), sides: {} };
  for (const [me, them, side] of [[w.a, w.b, "a"], [w.b, w.a, "b"]]) {
    const spend = +(Math.max(0, florins[me] || 0) * WAR.spendFrac).toFixed(4);
    const d = dice(seed, w.id, n, side);
    const broke = (florins[me] || 0) < 1; // can't pay the soldiers: half strength
    const weapon = weaponFor(seed, w.id, n, side, s.clans[me]);
    const hit = WAR.base * strength(s, me) * d * WEAPONS[weapon].mult * (broke ? 0.5 : 1) / defence(s.clans[them]);
    out.sides[me] = { spend, dice: +d.toFixed(4), weapon, strike: +hit.toFixed(4) };
  }
  for (const [me, them] of [[w.a, w.b], [w.b, w.a]]) {
    const c = s.clans[them];
    c.warDamage = (c.warDamage || 0) + out.sides[me].strike;
    const whole = Math.floor(c.warDamage);
    c.warDamage -= whole;
    out.sides[them].burned = whole ? burnEdge(c, whole) : [];
    out.sides[them].hp = hp(c);
    c.walls = (c.walls || 0) * WAR.wallDecay;
  }
  w.rounds = n;
  return out;
}

/** The winner takes the fallen nation's knowledge: each point it doesn't know, under its own root. */
export function takeKnowledge(winner, loser, loserId) {
  const taken = [];
  // Shallowest first, so a point's parent is already in place when it arrives.
  for (const [k, v] of Object.entries(loser.owned).sort((a, b) => a[1].depth - b[1].depth)) {
    if (k === loser.field || winner.owned[k]) continue;
    const parent = winner.owned[v.parent] ? v.parent : winner.field;
    winner.owned[k] = { depth: (winner.owned[parent]?.depth ?? 0) + 1, parent, corpus: v.corpus, how: `taken in war from clan ${loserId}` };
    delete winner.frontier[k];
    taken.push(k);
  }
  return taken;
}
