// One line per world record, in plain words. Shared by /world/ and the 3D world (its event list).
const n2 = (x) => (Math.round(x * 1000) / 1000).toString();
const fl = (x) => `${n2(x)} florin${Math.abs(x - 1) < 1e-9 ? "" : "s"}`;

const TECH_LINE = {
  press: "Copies are cheap, so every sale of its research earns a little more.",
  spectacles: "Its Scholars can read by lamplight now and work right through the night.",
  clock: "Days run on time, and upkeep costs 30% less.",
  bookkeeping: "It can take more NEAR before its citizens get lazy.",
  astrolabe: "It buys at half price and spots ruins from far off.",
};

/** For a trade: how its price was made (engine/prices.mjs) and the merchant's reason, in plain words.
 *  Shown when you hover (or tap) a trade in the event list, and on the judge page. */
export function tipOf(r) {
  const why = r.why && `The Broker's reason: ${r.why}`;
  switch (r.kind) {
    case "trade": return [r.priceWhy && `Price: ${r.priceWhy}.`, why].filter(Boolean).join("\n");
    case "listed": return [r.priceWhy && `Fair price: ${r.priceWhy}.`, `It asks ${fl(r.price)}. A Broker can ask half to three times the fair price.`, why].filter(Boolean).join("\n");
    case "market-buy": return [r.fair != null && `Fair price ${fl(r.fair)}, paid ${fl(r.price)}.`, why].filter(Boolean).join("\n");
    case "royalty": return `Each research buy on a point in a patent's chain pays its holder. Patents: ${(r.patents || []).join(", ")}.`;
    default: return "";
  }
}

// What a market token is, in words: research on a point, a patent, a figure kit.
function thing(r, from) {
  const t = r.token || r.token_id || "";
  const of = from ? `${from}'s ` : "its ";
  if (t[0] === "p") return `${of}patent "${r.title ?? t.slice(2)}"`;
  if (t[0] === "k") return from ? `a figure kit from ${from}` : "a figure kit";
  return `${of}research on "${r.title ?? t.slice(2)}"`;
}

export function says(r, clanName) {
  const c = clanName;
  switch (r.kind) {
    case "alias": return `${c(r.clan)} got its own name on NEAR: ${r.account}.`;
    case "forwarded": return `${n2(r.near)} NEAR came in at ${r.account} and went on to ${c(r.clan)}'s treasury.`;
    case "corpus": return `${r.scholar} of ${c(r.clan)} wrote up "${r.point}" from ${r.cites} citations${r.fake ? `, ${r.fake} of them made up` : ""}.${r.stir === "doubt" ? " It unsettles the citizens." : r.stir === "faith" ? " It lifts their faith." : ""}`;
    case "trade": return r.tool ? `${c(r.buyer)} bought a figure kit from ${c(r.seller)} for ${fl(r.price)}.` : `${c(r.buyer)} bought what ${c(r.seller)} knows about "${r.about ?? r.point}" for ${fl(r.price)}.`;
    case "broker": return r.wanted ? `${c(r.clan)}'s Broker wanted ${c(r.seller)}'s work on "${r.wanted}" but the nation couldn't afford ${fl(r.price)}.` : `${c(r.clan)}'s Broker looked at what the rivals know and bought nothing. ${r.why ?? ""}`.trim();
    case "gift": {
      const earned = r.florins ? Object.values(r.florins).reduce((a, b) => a + b, 0) : 0;
      return r.passed ? `${c(r.clan)} drafted "${r.title}". The Warden passed it${earned ? `, and it earned ${fl(earned)}` : ""}.` : `${c(r.clan)} drafted "${r.title}". The Warden found a problem.`;
    }
    case "warden": return `The Warden caught a made-up citation in ${c(r.clan)}'s work. ${r.fine != null ? `${fl(r.fine)} burned` : `${n2(r.bounty)} NEAR fine`}.`;
    case "trickster": return `A Trickster called ${r.name} moved into ${c(r.clan)}. Its gods went quiet for a day.`;
    case "absorb": return `${c(r.clan)} reached "${r.via[0]}" and found ${r.points.length} point${r.points.length === 1 ? "" : "s"} of a dead nation's knowledge in the ruins.`;
    case "ruins": return `${c(r.clan)} died. Its ${r.points} points are ruins now, waiting to be found.`;
    case "upkeep": return r.florins != null ? `${c(r.clan)} burned ${fl(r.paid ?? r.florins)} feeding ${r.agents} citizens.` : `${c(r.clan)} paid ${n2(r.paid ?? r.amount)} NEAR to keep ${r.agents} agents fed.`;
    case "mint": return `${c(r.clan)} earned ${fl(r.florins)}.`;
    case "team": return `${c(r.clan)} gathered its first citizens.`;
    case "founded": return `A new nation state rose: ${r.name}, a ${r.field} nation.`;
    case "tool": return `${c(r.clan)}'s Smith made a figure kit.`;
    case "ruling": return `${c(r.clan)}'s gods ${r.status === "Rewarded" ? "rewarded" : r.status === "Punished" ? "punished" : "ignored"} a draft.`;
    case "tech": return `${c(r.clan)} has the ${r.name} now. ${TECH_LINE[r.tech] ?? ""}`.trim();
    case "rooted": return `${c(r.clan)}'s gods rooted out "${r.point}"${r.cut.length > 1 ? ` and ${r.cut.length - 1} point${r.cut.length === 2 ? "" : "s"} that grew from it` : ""}.${r.doubt ? " The citizens breathe easier." : " Nobody was worried about it."}`;
    case "dawn": return "Dawn. NEAR turned up 3%, so the sun is up and the scholars work at full pace.";
    case "dusk": return "Dusk. NEAR slipped 3%, so night falls and the scholars slow down.";
    case "needs":
      return r.mood === "hungry" ? `${c(r.clan)} is hungry. Its citizens want ${n2(r.need)} NEAR a day and got far less.`
        : r.mood === "sated" ? `${c(r.clan)} got more than it needs. Its citizens are getting lazy.`
        : r.was ? `${c(r.clan)} is content again.` : `${c(r.clan)} is content.`;
    case "sweep": return "The day's fees went to the treasury.";
    case "weather": return `Weather: NEAR ${n2(r.price)} in the week of ${r.week}.`;
    case "error": return `${c(r.clan)} had a bad day (a service didn't answer).`;
    case "budget": return "The day's research budget ran out: research and drafts wait until tomorrow.";
    case "waiting": return `${c(r.clan)}'s citizens wait in the plaza for their god's first whisper.`;
    case "reverence": return `${c(r.clan)}'s reverence: ${Object.entries(r.gods || {}).map(([g, v]) => `${g.split(".")[0]} ${v}`).join(", ") || "no gods"}${r.followed ? `; it follows ${r.followed.split(".")[0]}` : ""}.`;
    case "reverence-change": return `Reverence changed after a draft: ${(r.changes || []).map((x) => `${x.god.split(".")[0]} ${x.d > 0 ? "+" : ""}${x.d} (${x.why})`).join(", ")}.`;
    case "report": return `In ${c(r.clan)}: ${r.claim}.`;
    case "report-settled": return `In ${c(r.clan)}: the report about ${r.accused} was ${r.truth ? "true" : "a grudge"}; ${r.outcome === "stunted" ? "they were stunted" : "nobody acted"}.`;
    // War (the finale): the citizens decide, the gods watch.
    case "war": return `${c(r.attacker)} declared war on ${c(r.defender)}. "${r.reason}"`;
    case "council": return r.refused ? `${c(r.clan)}'s war council wanted to ${r.action.replace("_", " ")}, but ${r.refused}.` : `${c(r.clan)}'s war council holds. "${r.reason}"`;
    case "fortify": return `${c(r.clan)} spent ${fl(r.spent)} on its walls. "${r.reason}"`;
    case "peace-offer": return `${c(r.clan)} offered ${c(r.to)} peace. "${r.reason}"`;
    case "peace": return `Peace between ${c(r.a)} and ${c(r.b)} after ${r.rounds} round${r.rounds === 1 ? "" : "s"}. "${r.reason}"`;
    case "battle": {
      const WEAPON = { cannon: "cannon", arrows: "fire arrows", trebuchet: "a trebuchet", mortar: "mortars", starlance: "a star lance", burningglass: "a burning glass", pamphlets: "a storm of pamphlets", ornithopters: "flying machines" };
      const used = Object.keys(r.sides).map((id) => r.sides[id].weapon ? `${c(Number(id))} used ${WEAPON[r.sides[id].weapon] ?? r.sides[id].weapon}` : null).filter(Boolean).join(", ");
      const ids = Object.keys(r.sides).map(Number), hit = ids.filter((id) => r.sides[id].burned?.length);
      if (!hit.length) return `War between ${c(ids[0])} and ${c(ids[1])}, round ${r.round}${used ? ` (${used})` : ""}: both walls held.`;
      return `War, round ${r.round}${used ? ` (${used})` : ""}: ${hit.map((id) => `${c(id)} lost "${r.sides[id].burned.join('", "')}" (${r.sides[id].hp} point${r.sides[id].hp === 1 ? "" : "s"} left)`).join("; ")}.`;
    }
    // The marketplace (his calls 9 Nov): only the Brokers trade, from their own wallets.
    case "listed": return `${c(r.clan)}'s Broker put ${thing(r)} up for sale at ${fl(r.price)}.`;
    case "delisted": return `${c(r.clan)}'s Broker took ${thing(r)} off the market.`;
    case "market-buy": return `${c(r.clan)}'s Broker bought ${thing(r, c(r.seller))} for ${fl(r.price)}.`;
    case "market-sale": {
      const t = r.token || "";
      if (t[0] === "p") return `${c(r.buyer)} holds the patent "${r.title}" now, and its royalties with it.`;
      if (t[0] === "k") return `${c(r.buyer)}'s Drafter has ${c(r.seller)}'s figure kit now.`;
      return r.learned ? `${c(r.buyer)} learned "${r.learned}" from what it bought off ${c(r.seller)}.` : `${c(r.buyer)} already knew "${r.title}" but keeps the copy it bought.`;
    }
    case "royalty": return `${c(r.clan)} earned ${fl(r.florins)} in patent royalties. ${r.sales === 1 ? "Someone bought research" : `${r.sales} buys of research`} in its patents' chains.`;
    case "tokens": return `${r.minted} new tokens on NEAR: ${r.research} research, ${r.patents} patent${r.patents === 1 ? "" : "s"}, ${r.kits} kit${r.kits === 1 ? "" : "s"}.`;
    case "tokens-moved": return `${c(r.clan)}'s tokens moved into its Broker's own wallet.`;
    case "fallen": return `${r.name} has ${r.surrendered ? "run out of money and surrendered" : "fallen"}. ${r.byName} took ${fl(r.loot)}${r.knowledge ? `, ${r.knowledge} point${r.knowledge === 1 ? "" : "s"} of its knowledge` : ""} and two of its people.`;
    default: return r.kind;
  }
}
