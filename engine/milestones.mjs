// Milestones (PLAN_13NOV §6, his ask 13 Nov): god powers unlock as a god grows. Most open on arrival; Act of God
// waits behind a medium-term milestone (about 1 to 3 days of play). Per god, across every nation it holds, counted
// from history the first time it's seen, and never lost. Stored in s.milestones, sealed as 'milestone' records.
// The engine refuses a locked Act of God (it applies the fire itself); rulings, stunts and rooting out run from the
// council straight on chain, so those locks live in the god panel and the AI planner. Tested in test-milestones.mjs.
const H = 3600e3;
export const MILESTONES = [
  { id: "arrive", name: "Arrive", how: "Become a god of any nation", unlocks: ["bless", "whisper", "ask", "pitch", "star", "seats", "claim", "ignore"] },
  { id: "heard", name: "Heard", how: "Your first whisper lands with your citizens", unlocks: ["rule"] },
  { id: "judge", name: "Judge", how: "Hear out an accused citizen, or settle a report", unlocks: ["smite"] },
  { id: "revered", name: "Revered", how: "Reach 50 reverence in any nation", unlocks: ["list"] },
  { id: "steward", name: "Steward", how: "A nation of yours unlocks a tech", unlocks: ["root"] },
  { id: "ascendant", name: "Ascendant", how: "Hold 70 reverence for a full real day, in a nation of yours with 2 techs", unlocks: ["fire"] },
];
export const ASCEND = { reverence: 70, techs: 2, holdMs: 24 * H };
const byPower = Object.fromEntries(MILESTONES.flatMap((m) => m.unlocks.map((p) => [p, m.id])));

// Judging: asking the accused (AI gods and newcomers can do it from day one), or settling a report by stunt or ignore.
const judged = (r, god) => (r.kind === "asked" && r.god === god) || (r.kind === "report-settled" && (r.by === god || r.god === god) && (r.outcome === "stunted" || r.outcome === "ignored"));
const gameOf = (s, god) => ((s.milestones ||= {})[god] ||= { reached: {}, heldSince: null, seen: false });
/** May this god use this power? Unknown powers are open. */
/** Does this run need history (a god not seen yet)? */
export const needsHistory = (s, onchain) => onchain.some((c) => c.alive !== false && (c.gods || []).some((g) => !s.milestones?.[g.account]?.seen));
export function has(s, god, power) {
  const need = byPower[power];
  if (!need || need === "arrive") return true;
  return !!s.milestones?.[god]?.reached?.[need];
}

/** Look at the world after a run. records = this run's records. Returns new 'milestone' records. */
export function update(s, records, onchain, now = Date.now(), history = []) {
  const out = [];
  const gods = new Map(); // god -> its living nations
  for (const c of onchain) if (c.alive !== false) for (const g of c.gods || []) { if (!gods.has(g.account)) gods.set(g.account, []); gods.get(g.account).push(c.id); }
  for (const [god, nations] of gods) {
    const m = gameOf(s, god), fresh = !m.seen; // first sight: history is credited quietly, no flood of records
    const reach = (id) => { if (m.reached[id]) return; m.reached[id] = now; if (fresh) return; const ms = MILESTONES.find((x) => x.id === id); out.push({ kind: "milestone", god, milestone: id, name: ms.name, unlocks: ms.unlocks }); };
    const revs = nations.map((id) => s.rev?.[id]?.gods?.[god]).filter(Boolean);
    const techs = (id) => (s.clans?.[id]?.techs || []).length;
    // History, once: what a god already did before milestones existed.
    if (!m.seen) {
      m.seen = true;
      // history = the last few weeks of sealed records (run.mjs reads them once, when a god is first seen).
      if (revs.some((g) => (g.whispers || []).length) || history.some((r) => r.kind === "heard" && r.god === god)) m.reached.heard = now;
      if (Object.values(s.reports || {}).some((r) => nations.includes(r.clan) && (r.asked?.by === god || (r.settled && r.outcome === "stunted"))) || history.some((r) => judged(r, god))) m.reached.judge = now;
    }
    m.reached.arrive ??= now;
    if (records.some((r) => r.kind === "heard" && r.god === god)) reach("heard");
    if (records.some((r) => judged(r, god))) reach("judge");
    if (revs.some((g) => g.r >= 50)) reach("revered");
    if (nations.some((id) => techs(id) >= 1)) reach("steward");
    // Ascendant: 70+ reverence in a nation of its own with 2 techs, held a full real day without a dip.
    const high = nations.some((id) => techs(id) >= ASCEND.techs && (s.rev?.[id]?.gods?.[god]?.r ?? 0) >= ASCEND.reverence);
    if (!high) m.heldSince = null;
    else if (m.heldSince == null) m.heldSince = now;
    else if (now - m.heldSince >= ASCEND.holdMs) reach("ascendant");
  }
  return out;
}

/** For the god panel: the ladder, what's reached, what's next and how far along. */
export function progress(s, god, onchain, now = Date.now()) {
  const m = s.milestones?.[god] || { reached: {}, heldSince: null };
  const reached = MILESTONES.filter((x) => x.id === "arrive" || m.reached[x.id]).map((x) => x.id);
  const next = MILESTONES.find((x) => !reached.includes(x.id)) || null;
  const nations = onchain.filter((c) => c.alive !== false && (c.gods || []).some((g) => g.account === god)).map((c) => c.id);
  const best = Math.max(0, ...nations.map((id) => s.rev?.[id]?.gods?.[god]?.r ?? 0));
  const locked = Object.keys(byPower).filter((p) => !reached.includes(byPower[p]));
  return {
    reached, locked,
    next: next && { id: next.id, name: next.name, how: next.how, unlocks: next.unlocks },
    ladder: MILESTONES.map((x) => ({ id: x.id, name: x.name, how: x.how, unlocks: x.unlocks, reached: reached.includes(x.id) })),
    reverence: Math.round(best * 10) / 10,
    held_hours: m.heldSince ? Math.round(((now - m.heldSince) / H) * 10) / 10 : 0,
  };
}
