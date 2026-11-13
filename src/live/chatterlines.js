// Citizen chatter (PLAN_13NOV §6, his ask 13 Nov): every 15 seconds a citizen says one line about something that
// really happened, built from a sealed record (no Claude call, $0). Pure functions; src/live/chatter.js shows them.
// Tested in tests/chatter.test.mjs. Game copy stays web2 and has no em dashes.
export const EVERY_MS = 15000;
export const AUTO_CLOSE_MS = 11000; // a line nobody answers closes by itself before the next one
// ask: what the line wants from its nation's god (his call 13 Nov: something that needs you). The feed turns it into a button.
const fl = (x) => `${(Math.round(Number(x) * 100) / 100).toLocaleString("en")} florins`;
const cut = (s, n = 70) => { s = String(s ?? ""); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const fit = (l) => (l ? { ...l, text: cut(l.text, 160) } : null);

/** One record -> { who, role, clan, text } or null (bookkeeping never becomes chatter). name(id) = a nation's name. */
export function lineFor(r, name) {
  switch (r?.kind) {
    case "corpus": return fit({ who: r.scholar || "A Scholar", role: "Scholar", clan: r.clan, ask: { act: "whisper", label: "Whisper back" }, text: r.fake ? `I read ${r.cites} papers for "${cut(r.title)}". Some of them weren't real. I'll be more careful.` : `Just finished "${cut(r.title)}". ${r.cites} real papers behind it.` });
    case "trade": return fit({ who: "The Broker", role: "Broker", clan: r.seller, text: `Sold ${name(r.buyer)} what we know about ${cut(r.about || r.point || "it", 40)} for ${fl(r.price)}.` });
    case "market-sale": return fit({ who: "The Broker", role: "Broker", clan: r.seller, text: `${name(r.buyer)} bought "${cut(r.title, 50)}" off the market for ${fl(r.price)}.` });
    case "listed": return fit({ who: "The Broker", role: "Broker", clan: r.clan, text: `Put "${cut(r.title, 50)}" up for sale at ${fl(r.price)}. Someone will want it.` });
    case "warden": return fit({ who: "The Warden", role: "Warden", clan: r.clan, ask: { act: "whisper", label: "Warn them", text: "There's a cheat among you. Check every citation twice." }, text: `Caught ${r.fake?.length || 1} made-up source${(r.fake?.length || 1) === 1 ? "" : "s"}. That's a fine of ${fl(r.fine)}.` });
    case "needs": return r.mood === "hungry" ? fit({ who: "A citizen", role: "Citizen", clan: r.clan, ask: { act: "bless", label: "Bless them" }, text: `We're going hungry in ${name(r.clan)}. Are the gods even watching?` }) : r.mood === "sated" ? fit({ who: "A citizen", role: "Citizen", clan: r.clan, text: `Full bellies in ${name(r.clan)} today. Bless the gods.` }) : null;
    case "tech": return fit({ who: "A Scholar", role: "Scholar", clan: r.clan, ask: { act: "whisper", label: "Whisper back" }, text: `${name(r.clan)} has ${r.name || "a new tech"} now. Everything changes from here.` });
    case "heard": return r.says ? fit({ who: r.citizen || "A citizen", role: "Citizen", clan: r.clan, text: r.says }) : null;
    case "answer": return r.says ? fit({ who: r.accused || "The accused", role: r.role || "Citizen", clan: r.clan, text: r.says }) : null;
    case "battle": { const [a, b] = Object.keys(r.sides || {}).map(Number); return a && b ? fit({ who: "A soldier", role: "Patron", clan: a, ask: { act: "whisper", label: "Rally them" }, text: `Round ${r.round} against ${name(b)}. We hold the line.` }) : null; } // { war, round, sides: { [id]: … } }
    case "fire": return fit({ who: "A citizen", role: "Citizen", clan: r.clan, ask: { act: "bless", label: "Bless them" }, text: `Fire fell on ${name(r.clan)}. We lost ${fl(r.florins)}.` });
    case "arrival": return fit({ who: r.name || "A new god", role: "God", clan: r.clan ?? null, text: r.found || r.nation ? `I have come, and ${r.nation} is mine.` : `I have come to bless ${name(r.clan)}.` });
    case "seat-sold": return fit({ who: "A citizen", role: "Citizen", clan: r.clan, text: r.as ? `Someone new speaks for ${r.as} now. We'll see if they're any good.` : `A god sold their seat in ${name(r.clan)} for ${r.price} grace.` });
    case "milestone": return r.milestone !== "arrive" ? fit({ who: "A priest", role: "Citizen", clan: null, text: `A god became ${r.name}. The heavens feel closer.` }) : null;
    default: return null;
  }
}

const keyOf = (r) => `${r.day ?? ""}|${r.live ?? r.at ?? r.i ?? ""}|${r.kind}|${r.clan ?? r.buyer ?? ""}|${r.title ?? r.text ?? r.says ?? r.name ?? ""}`;
const clanOf = (r, l) => l.clan ?? r.clan ?? r.buyer ?? r.seller ?? null;
/** The next line to say: never one already spoken; a nation of yours first, then the newest. Null = stay quiet. */
export function pick(records, spoken, mine, name) {
  let best = null;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i], key = keyOf(r);
    if (spoken.has(key)) continue;
    const l = lineFor(r, name);
    if (!l) continue;
    const own = mine.has(Number(clanOf(r, l))) || mine.has(Number(r.buyer)) || mine.has(Number(r.seller));
    if (own) return { ...l, key };
    best ||= { ...l, key };
  }
  return best;
}
