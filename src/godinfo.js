// A god's card (his ask 16 Nov): tap an AI god and see its nations, the grace it has put into them
// and how its holdings stand today. Built only from what the site already reads: /api/world (the
// nations and each god's reverence there) and /api/stakes (get_stake on the contract for every seat).
// No DOM here, so tests/god-card.test.mjs runs it in node.

const r6 = (x) => Math.round(x * 1e6) / 1e6;

/** One line of a god's log (/api/godlog, src/server/godlog.mjs) in plain words. nameOf(id) -> a nation's name. */
export function actionWords(e, nameOf = (id) => `nation ${id}`) {
  const n = e.clan != null ? nameOf(e.clan) : "a nation";
  const say = {
    whisper: () => `Whispered to ${n}${e.text ? `: "${e.text}"` : ""}`,
    bless: () => `Blessed ${n} with ${e.near} grace`,
    rule: () => `Rewarded gift #${e.gift} in ${n}`,
    smite: () => `${e.verdict === "Kill" ? "Killed" : "Stunned"} ${e.agent || "a citizen"} in ${n}`,
    fire: () => `Called an Act of God on ${e.target != null ? nameOf(e.target) : "a nation"}`,
    withdraw: () => `Took its whole stake out of ${n} and left`,
    buy: () => `Bought a seat in ${n}`,
    pitch: () => `Picked what ${n}'s Scholars study next${e.point ? `: ${e.point}` : ""}`,
    ask: () => `Asked the accused in ${n} to answer`,
    list: () => `Told ${n}'s Broker to sell ${e.tokens || "some"} thing${e.tokens === 1 ? "" : "s"}`,
    dismiss: () => `Ignored a report in ${n}`,
  }[e.kind];
  const line = say ? say() : `${e.kind} in ${n}`;
  return e.ok ? line : `${line} (didn't go through: ${e.why || "refused"})`;
}

/** world: /api/world. stakes: /api/stakes (or null when it didn't load). account: the god.
 *  ranks: { nationId: place } as the season standings table shows them right now (src/live/standings.js),
 *  so the card and the table never disagree; a nation the table doesn't rank has no place. */
export function godInfo(account, world, stakes, ranks = {}) {
  const clans = world?.clans || [];
  const of = Object.keys(ranks).length;
  const rows = new Map((stakes?.stakes || []).filter((x) => x.god === account).map((x) => [x.clan, x]));
  // Its seats: one stake row per seat (/api/stakes reads every council). /api/world only counts a
  // nation's gods, so if the stakes didn't load, the nations where it holds reverence stand in.
  const seated = clans.filter((c) => (stakes ? rows.has(c.id) : c.reverence?.gods?.[account] != null));
  const nations = seated.map((c) => {
    const st = rows.get(c.id) ?? null; // st.put_in already counts what the world granted (server.mjs stakes)
    const granted = st?.granted ?? 0, counts = st?.put_in ?? null;
    return {
      id: c.id, name: c.name, alive: c.alive !== false && !c.fallen, fallen: !!c.fallen,
      leads: c.reverence?.followed === account, reverence: c.reverence?.gods?.[account]?.r ?? null,
      rank: ranks[c.id] ?? null, of,
      given: counts == null ? null : r6(counts - granted), granted, counts,
      worth: st?.claim_now ?? null, gain: st?.gain ?? null, pct: st?.pct ?? null,
    };
  }).sort((a, b) => (b.alive - a.alive) || (b.leads - a.leads) || ((b.counts ?? 0) - (a.counts ?? 0)) || a.id - b.id);
  const known = nations.filter((n) => n.counts != null);
  const sum = (k) => r6(known.reduce((a, n) => a + n[k], 0));
  const counts = sum("counts"), worth = sum("worth");
  return {
    account, ai: (world?.ai || []).includes(account), name: world?.names?.[account] ?? null,
    nations, leads: nations.filter((n) => n.leads && n.alive).length, // nations it leads that still stand
    // Holdings: only seats whose stake loaded. pct is the whole holding against what it counts.
    totals: known.length ? { given: sum("given"), granted: sum("granted"), counts, worth, gain: r6(worth - counts), pct: counts > 0 ? Math.round((worth / counts - 1) * 1000) / 10 : null } : null,
    missing: nations.length - known.length,
  };
}
