// Act of God (10 Nov): fire rains on a nation and burns its florins. The more florins it holds next to
// the richest nation, the more burns. Burnt florins leave the world (every other florin is worth a
// little more); the backing doesn't move. Two ways it starts:
//   1. A god calls it on another nation, by a DAO vote of their own nation: a `root_out` proposal whose
//      point is "act of god: <target id>" (the contract already takes it, so it needs no new contract).
//      The caster's nation pays a tenth of the damage, and each god can call it once a real day.
//   2. The heavens strike by themselves when something's out of balance (scheduled turns only, at most
//      once a turn): a famine while one nation hoards, or one nation holding too much of the world's
//      florins. Fire always falls on whoever's piling up.
//   3. A bully: a nation that declares war on one with a third of its florins or less burns the moment
//      it declares, before its first attack (run.mjs warPhase).
// A nation at war is never a target (his rule 10 Nov): it's already being hit. The bully is the one
// exception, because its fire lands as it declares.
// Pure functions here; engine/run.mjs does the burning and writes the records.

export const AOG = {
  on: process.env.ADF_AOG !== "off",
  base: 0.05, // every target loses at least 5% of its spendable florins
  rich: 0.2, // plus up to 20% more, by its florins / the richest nation's florins
  wallsMax: 0.3, // walls take off up to 30% of the damage
  wallsFull: 300, // ... at 300 florins of walls
  casterCost: 0.1, // the caster's nation burns 10% of the damage it did
  godEveryMs: 24 * 3600e3, // one Act of God per god per real day
  minFlorins: 1, // a target with less than this has nothing to burn
  famineShare: 0.5, // world fire: at least half the standing nations hungry ...
  bullyRatio: 3, // ... or a war declared by a nation 3x the defender's florins ...
  hoardShare: Number(process.env.ADF_AOG_HOARD) || 0.4, // ... or one nation holding 40% of all spendable florins (tests can lower it)
  minNations: 3, // the heavens don't strike a world of one or two nations
  point: /^act of god:\s*(\d+)\s*$/i,
};

/** The target id if a root_out point is an Act of God, else null. */
export function castTarget(point) {
  const m = AOG.point.exec(String(point ?? ""));
  return m ? Number(m[1]) : null;
}

/** How much of a nation's spendable florins burn: 5% + 20% x its florins / the richest's, less up to
 *  30% for walls. florins: { [id]: spendable florins } of the standing nations. */
export function damage(florins, target, walls = 0) {
  const have = Math.max(0, florins[target] || 0);
  const top = Math.max(0, ...Object.values(florins));
  if (have < AOG.minFlorins || top <= 0) return { florins: 0, pct: 0 };
  const shield = Math.min(AOG.wallsMax, (Math.max(0, walls) / AOG.wallsFull) * AOG.wallsMax);
  const pct = (AOG.base + AOG.rich * (have / top)) * (1 - shield);
  return { florins: +(have * pct).toFixed(4), pct: +pct.toFixed(4), shield: +shield.toFixed(3) };
}

/** Can this god call fire on that nation now? { ok } or { ok: false, why }. */
export function mayCast({ last = 0, now = Date.now(), caster, target, standing, atWar = [] }) {
  if (!AOG.on) return { ok: false, why: "Acts of God are switched off" };
  if (target === caster) return { ok: false, why: "a god can't call fire on their own nation" };
  if (!standing.includes(target)) return { ok: false, why: "that nation isn't standing" };
  if (atWar.includes(target)) return { ok: false, why: "that nation is at war, and the heavens don't strike a nation already fighting" };
  if (now - last < AOG.godEveryMs) return { ok: false, why: "this god already called fire in the last 24 hours" };
  return { ok: true };
}

/** A declaration of war that brings fire on the attacker: it has 3x the defender's florins or more. */
export const isBully = (attackerFlorins, defenderFlorins) => AOG.on && attackerFlorins >= AOG.bullyRatio * Math.max(defenderFlorins, 1);

/** Does the world strike by itself this turn? Returns { target, cause, why } or null.
 *  nations: [{ id, name, florins (spendable), mood, atWar }] standing. A nation at war counts toward
 *  the world's florins and hunger but is never the one that burns. */
export function worldFire(nations) {
  if (!AOG.on || nations.length < AOG.minNations) return null;
  const total = nations.reduce((a, x) => a + Math.max(0, x.florins), 0);
  const peaceful = nations.filter((x) => !x.atWar);
  if (total <= 0 || !peaceful.length) return null;
  const richest = peaceful.reduce((a, x) => (x.florins > a.florins ? x : a));
  // A famine while one nation sits on the most: the hoarder burns.
  const hungry = nations.filter((x) => x.mood === "hungry");
  if (hungry.length >= Math.ceil(nations.length * AOG.famineShare) && richest.mood !== "hungry") return { target: richest.id, cause: "famine", why: `${hungry.length} of ${nations.length} nations are hungry while ${richest.name} holds the most florins` };
  // Hoarding: one nation with too much of the world's florins.
  if (richest.florins / total >= AOG.hoardShare) return { target: richest.id, cause: "hoard", why: `${richest.name} holds ${Math.round((richest.florins / total) * 100)}% of the world's florins` };
  return null;
}
