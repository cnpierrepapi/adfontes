// One line per world record, in plain words. Shared by /world/ and the 3D world.
const n2 = (x) => (Math.round(x * 1000) / 1000).toString();

export function says(r, clanName) {
  const c = clanName;
  switch (r.kind) {
    case "corpus": return `${r.scholar} of ${c(r.clan)} wrote up "${r.point}" from ${r.cites} citations${r.fake ? `, ${r.fake} of them made up` : ""}.`;
    case "trade": return r.tool ? `${c(r.buyer)} bought a figure kit from ${c(r.seller)} for ${n2(r.price)} NEAR.` : `${c(r.buyer)} bought what ${c(r.seller)} knows about "${r.point}" for ${n2(r.price)} NEAR.`;
    case "gift": return `${c(r.clan)} gave its gods a draft: "${r.title}". The Warden says ${r.passed ? "clean" : "it has a problem"}.`;
    case "warden": return `The Warden caught a made-up citation in ${c(r.clan)}'s work. ${n2(r.bounty)} NEAR fine.`;
    case "trickster": return `A Trickster called ${r.name} moved into ${c(r.clan)}. Nobody was watching that clan.`;
    case "absorb": return `${c(r.clan)} reached "${r.via[0]}" and found ${r.points.length} point${r.points.length === 1 ? "" : "s"} of a dead nation's knowledge in the ruins.`;
    case "ruins": return `${c(r.clan)} died. Its ${r.points} points are ruins now, waiting to be found.`;
    case "upkeep": return `${c(r.clan)} paid ${n2(r.paid ?? r.amount)} NEAR to keep ${r.agents} agents fed.`;
    case "team": return `${c(r.clan)} gathered its first citizens.`;
    case "founded": return `A new nation state rose: ${r.name}, a ${r.field} nation.`;
    case "tool": return `${c(r.clan)}'s Smith made a figure kit.`;
    case "ruling": return `${c(r.clan)}'s gods ${r.status === "Rewarded" ? "rewarded" : r.status === "Punished" ? "punished" : "ignored"} a gift.`;
    case "sweep": return "The day's fees went to the treasury.";
    case "weather": return `Weather: NEAR ${n2(r.price)} in the week of ${r.week}.`;
    case "error": return `${c(r.clan)} had a bad day (a service didn't answer).`;
    case "budget": return "The day's research budget ran out: research and drafts wait until tomorrow.";
    case "waiting": return `${c(r.clan)}'s citizens wait in the plaza for their god's first whisper.`;
    case "reverence": return `${c(r.clan)}'s reverence: ${Object.entries(r.gods || {}).map(([g, v]) => `${g.split(".")[0]} ${v}`).join(", ") || "no gods"}${r.followed ? `; it follows ${r.followed.split(".")[0]}` : ""}.`;
    case "reverence-change": return `Reverence changed after a gift: ${(r.changes || []).map((x) => `${x.god.split(".")[0]} ${x.d > 0 ? "+" : ""}${x.d} (${x.why})`).join(", ")}.`;
    case "report": return `In ${c(r.clan)}: ${r.claim}.`;
    case "report-settled": return `In ${c(r.clan)}: the report about ${r.accused} was ${r.truth ? "true" : "a grudge"}; ${r.outcome === "stunted" ? "they were stunted" : "nobody acted"}.`;
    default: return r.kind;
  }
}

