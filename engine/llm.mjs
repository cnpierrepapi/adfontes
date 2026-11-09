// Agent minds. Haiku for Scholar turns, Sonnet for drafts (SPEC §12b.4). Fallback compute = our
// Claude key in .env.local. Every call is metered so the season's cost is known.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { CFG } from "./config.mjs";
import { FIGURE_SCHEMA } from "./figures.mjs";

const env = Object.fromEntries(
  (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY });
const PRICE = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] }; // $ per M tokens
export const meter = { calls: 0, usd: 0 };

// The daily cap (CFG.dailyCapUsd). run.mjs tells us what today cost before this process started;
// a call only starts if its worst case still fits. Callers ask canSpend() first and skip the turn;
// json() refuses as a last guard so nothing can slip past.
let spentBefore = 0, spendHook = null;
export function setSpentToday(usd) { spentBefore = usd; }
/** Called with each call's cost as it lands, so the shared ledger is right even if a run dies. */
export function onSpend(fn) { spendHook = fn; }
export const spentToday = () => spentBefore + meter.usd;
export const canSpend = (kind) => spentToday() + CFG.worstCallUsd[kind] <= CFG.dailyCapUsd;
export class BudgetError extends Error {}

// Test runs only (ADF_FAKE_LLM=1): no Claude call, $0. Scholars and Drafters return honest,
// well-formed work built from the real papers and chain, so chain, florin and Warden paths run.
const FAKE = process.env.ADF_FAKE_LLM === "1";
// ADF_FAKE_LLM=research: stand-ins write the research and drafts, while the Broker and the war
// council still think with Claude (the fast-forward simulation under the daily cap).
const FAKE_RESEARCH = FAKE || process.env.ADF_FAKE_LLM === "research";
function fakeCorpus({ topic, papers }) {
  return {
    title: `${topic}: what the papers show`,
    findings: papers.slice(0, 3).map((p) => ({ claim: `${p.title} bears on ${topic}.`, cites: [p.id] })),
    open_gaps: [`a cheaper route to ${topic}`, `${topic} at scale`],
    // The stand-in reads the topic's meaning roughly, never a hash.
    ...(/toxic|hazard|risk|degrad|failure|leak|fire|explos|corros|dendrite|contamin|waste/i.test(topic) ? { stir: "doubt", stir_why: `${topic} sounds dangerous.` }
      : /efficien|stab|safe|clean|durab|recycl|high-performance|long-life/i.test(topic) ? { stir: "faith", stir_why: `${topic} looks like it works.` }
      : { stir: "calm", stir_why: "" }),
  };
}
function fakeDraft({ chain }) {
  const parts = [10, 20, 30].map((n, i) => ({ n, name: `layer ${i + 1}`, shape: "layer", hatch: "diagonal", thickness: 1, width: 1, offset: 0 }));
  const steps = [40, 50].map((n, i) => ({ n, name: `step ${i + 1}`, shape: "box", hatch: "none", thickness: 1, width: 1, offset: 0 }));
  return {
    title: `Device built on ${chain.at(-1).node}`,
    abstract: "A test draft (stand-in mind).",
    claims: chain.map((c) => ({ text: `A device using ${c.node}.`, supported_by: [c.node] })),
    description: "Layers (10), (20) and (30) are stacked; the method runs (40) then (50).",
    figures: [
      { label: "FIG. 1", caption: "The device", kind: "cross_section", parts, links: [] },
      { label: "FIG. 2", caption: "The method", kind: "flowchart", parts: steps, links: [{ from: 40, to: 50, label: "" }] },
    ],
  };
}

async function json(model, system, user, schema, maxTokens) {
  const kind = model === CFG.draftModel ? "draft" : model === CFG.councilModel ? "council" : "agent";
  if (!canSpend(kind)) throw new BudgetError(`daily cap $${CFG.dailyCapUsd} reached ($${spentToday().toFixed(4)} spent today)`);
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  const [pin, pout] = PRICE[model];
  meter.calls++;
  const usd = (msg.usage.input_tokens * pin + msg.usage.output_tokens * pout) / 1e6;
  meter.usd += usd;
  if (spendHook) await spendHook(usd).catch((e) => console.log("  spend ledger write failed:", String(e.message || e).slice(0, 120)));
  const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

const CORPUS = {
  type: "object",
  additionalProperties: false,
  required: ["title", "findings", "open_gaps", "stir", "stir_why"],
  properties: {
    title: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "cites"],
        properties: { claim: { type: "string" }, cites: { type: "array", items: { type: "string" } } },
      },
    },
    open_gaps: { type: "array", items: { type: "string" } },
    // How this knowledge sits with the nation's citizens (SPEC §14): most is calm.
    stir: { type: "string", enum: ["calm", "faith", "doubt"] },
    stir_why: { type: "string" },
  },
};

/** A Scholar turn: papers -> a corpus whose every finding cites paper ids from the list. */
export function scholarTurn({ field, topic, parent, papers, temperament, whisper }) {
  if (FAKE_RESEARCH) return Promise.resolve(fakeCorpus({ topic, papers }));
  const listing = papers.map((p) => `[${p.id}] ${p.title} (${p.year})\n${p.abstract}`).join("\n\n");
  return json(
    CFG.agentModel,
    "You are a Scholar agent in AD FONTES, a world where AI clans build knowledge from open papers and trade it. " +
      "Package what these papers establish about the topic into a corpus another clan would pay for. " +
      "Every finding cites ids from the list (the text inside the square brackets only). Name the open gaps the papers leave. " +
      "Then say how this knowledge sits with your nation's citizens: 'faith' if it plainly strengthens their trust in the path their gods set " +
      "(it works, it's safe, it delivers), 'doubt' if it unsettles them (danger, failure, harm, a dead end), otherwise 'calm' (most work is calm). " +
      "stir_why: one short plain sentence a citizen might say about it. " +
      `Your temperament: ${temperament}.` + (whisper ? ` Your gods whisper: "${whisper}".` : ""),
    `Field: ${field}. Topic: ${topic}${parent ? ` (building on: ${parent})` : ""}.\n\nPapers:\n\n${listing}`,
    CORPUS,
    3000,
  );
}

// The Broker's pick (8 Nov): nations in different fields almost never share a topic word for word,
// so exact matching meant no trades at all. Once a real day the Broker reads the rivals' clean
// research and its own open questions, and buys the one piece that would really help, or nothing.
const BROKER = {
  type: "object",
  additionalProperties: false,
  required: ["buy", "corpus", "point", "why"],
  properties: {
    buy: { type: "boolean" },
    corpus: { type: "string" },
    point: { type: "string" },
    why: { type: "string" },
  },
};
/** offers: [{ id, title, about, seller }]; open: the nation's open questions (frontier points). */
export function brokerPick({ field, open, offers, temperament }) {
  if (FAKE) {
    // Stand-in: the first offer whose words overlap an open question, else none.
    const words = (x) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4));
    for (const o of offers) for (const p of open) { const a = words(`${o.title} ${o.about}`); if ([...words(p)].some((w) => a.has(w))) return Promise.resolve({ buy: true, corpus: o.id, point: p, why: `${o.about} bears on ${p}.` }); }
    return Promise.resolve({ buy: false, corpus: "", point: "", why: "" });
  }
  const list = offers.map((o) => `[${o.id}] "${o.title}" (on ${o.about}, from nation ${o.seller})`).join("\n");
  return json(
    CFG.agentModel,
    "You are the Broker of a nation in AD FONTES. Your nation researches one field; rival nations research others and sell what they find. " +
      "Read your nation's open questions and the rivals' research on offer. Buy at most one piece: the one most likely to help one " +
      "specific open question. Trading across fields is how nations grow, so a plausible link is enough: a material, method, " +
      "measurement, cost or supply insight, or policy finding that could carry over. A shared word alone is not a link " +
      "(hybrid cars and hybrid perovskites have nothing in common). Set buy to false only if no offer has any honest connection. " +
      "corpus: the id inside the square brackets. point: the open question it helps, copied exactly. why: one plain sentence a citizen would understand. " +
      `Your temperament: ${temperament}.`,
    `Your field: ${field}.\n\nYour open questions:\n${open.map((p) => `- ${p}`).join("\n")}\n\nOn offer:\n${list}`,
    BROKER,
    600,
  );
}

// The Broker's market day (his calls 9 Nov: the marketplace is the agents' alone). Once a real day
// each nation's Broker looks at what it could sell (with fair prices, engine/prices.mjs), what it has
// listed, and what other nations list, then lists, takes down or buys. The engine holds every price
// to 0.5x-3x of fair and checks every buy, so the model only chooses.
const MARKET = {
  type: "object",
  additionalProperties: false,
  required: ["list", "delist", "buy", "buy_why"],
  properties: {
    list: { type: "array", items: { type: "object", additionalProperties: false, required: ["token_id", "price", "why"], properties: { token_id: { type: "string" }, price: { type: "number" }, why: { type: "string" } } } },
    delist: { type: "array", items: { type: "integer" } },
    buy: { type: "integer" },
    buy_why: { type: "string" },
  },
};
/** sellable: [{token_id,title,kind,price(fair)}]; mine: [{id,token_id,price}]; offers: [{id,seller,title,kind,price,fair}] */
export function brokerMarket({ field, temperament, florins, sellable, mine, offers, open }) {
  if (FAKE) {
    // Stand-in: list the dearest thing not yet listed at 1.2x fair (up to 3 open), buy the first
    // offer it can use at no more than 1.5x fair that it can afford.
    const listed = new Set(mine.map((m) => m.token_id));
    const list = mine.length < 3 ? sellable.filter((x) => !listed.has(x.token_id)).slice(0, 1).map((x) => ({ token_id: x.token_id, price: +(x.price * 1.2).toFixed(4), why: `${x.title} is worth something to a nation that lacks it.` })) : [];
    const o = offers.find((x) => x.price <= x.fair * 1.5 && x.price < florins);
    return Promise.resolve({ list, delist: [], buy: o ? o.id : -1, buy_why: o ? `${o.title} fills a gap in what we know.` : "" });
  }
  const fmt = (x) => (Math.round(x * 100) / 100).toString();
  const sell = sellable.slice(0, 15).map((x) => `${x.token_id} | ${x.kind} | "${x.title}" | fair ${fmt(x.price)}`).join("\n") || "(nothing)";
  const listedNow = mine.map((m) => `#${m.id} ${m.token_id} at ${fmt(m.price)}`).join("\n") || "(nothing listed)";
  const market = offers.slice(0, 20).map((o) => `#${o.id} | from nation ${o.seller} | ${o.kind} | "${o.title}" | asking ${fmt(o.price)} (fair ${fmt(o.fair)})`).join("\n") || "(nothing on offer)";
  return json(
    CFG.agentModel,
    "You are the Broker of a nation in AD FONTES, trading on the marketplace with your nation's florins. Research and figure kits sell as copies " +
      "(you keep yours, every buyer gets one); a patent sells once and its holder earns a royalty whenever anyone buys research in its chain. " +
      "Once a day you may: list up to 3 things you hold (token_id from your list, a price in florins between half and three times its fair price, " +
      "and why a buyer would want it), take down listings that aren't selling (their # numbers), and buy at most one listing (its # number, or -1 for " +
      "none) if it truly helps your open questions and the price is sensible for what you have. A nation may keep at most 10 listings open. " +
      "Every why is one plain sentence a citizen would understand. " +
      `Your temperament: ${temperament}.`,
    `Your field: ${field}. Your nation holds ${fmt(florins)} florins.\n\nYour open questions:\n${open.slice(0, 15).map((p) => `- ${p}`).join("\n") || "(none)"}\n\n` +
      `What you could sell:\n${sell}\n\nYour listings now:\n${listedNow}\n\nOn the market from other nations:\n${market}`,
    MARKET,
    900,
  );
}

// The citizens hear their god (his call 9 Nov): a whisper is judged against how the nation is doing
// right now. Words that see the nation clearly and point the right way land like prophecy; kind but
// empty words barely move them; words that misread them shake their faith. One citizen says, in their
// own voice, what they made of it (it shows in the event list).
const HEARD = {
  type: "object", additionalProperties: false, required: ["delta", "verdict", "citizen", "says"],
  properties: {
    delta: { type: "integer" },
    verdict: { type: "string", enum: ["prophecy", "wise", "comfort", "empty", "misread", "insult"] },
    citizen: { type: "string" },
    says: { type: "string" },
  },
};
export function hearWhisper({ name, field, temperament, situation, keywords = [], citizens = [], text }) {
  if (FAKE) {
    // Stand-in: a whisper that names something real about the nation right now lands; a generic one doesn't.
    const t = text.toLowerCase(), hit = keywords.filter((k) => k && t.includes(String(k).toLowerCase())).length;
    const who = citizens[Math.floor(Math.random() * citizens.length)] || "a citizen";
    return Promise.resolve(hit >= 2 ? { delta: 20, verdict: "prophecy", citizen: who, says: "The god sees exactly where we stand." }
      : hit === 1 ? { delta: 10, verdict: "wise", citizen: who, says: "The god knows what troubles us." }
      : { delta: 1, verdict: "empty", citizen: who, says: "Nice words. They could be about anyone." });
  }
  return json(
    CFG.agentModel,
    `You are the citizens of ${name}, a ${field} nation in AD FONTES, and your god has just whispered to you. Judge the whisper against ` +
      "how your nation is doing right now. Words that see your situation clearly and point the right way feel like prophecy. Wise words help. " +
      "Kind but empty words, the kind a god could say to anyone, barely move you. Words that misread you (cheering a war you are losing, " +
      "praising plenty while you starve) shake your faith, and contempt shakes it more. Give delta, how much your reverence for this god " +
      "changes: prophecy 15 to 25, wise 8 to 14, comfort 3 to 7, empty 0 to 2, misread -1 to -8, insult -9 to -15. Then pick one citizen " +
      "from the list to say, in one plain sentence in their own voice, what they made of it. No quotation marks around the sentence. " +
      `The nation's temperament: ${temperament}.`,
    `Right now:\n${situation}\n\nCitizens: ${citizens.slice(0, 12).join(", ") || "(unknown)"}\n\nYour god whispered: "${text}"`,
    HEARD,
    250,
  );
}

// The seller names its price (his call 9 Nov: "the seller prices the sale like a real market, for all
// types of sales"). When another nation's Broker wants something this nation holds, its own Broker
// asks a price between half and three times the fair one, with one line on why.
const ASK = { type: "object", additionalProperties: false, required: ["price", "why"], properties: { price: { type: "number" }, why: { type: "string" } } };
export function sellerAsk({ field, temperament, florins, item, buyer, fair, fairWhy, holders }) {
  if (FAKE) {
    // Stand-in: rarer things cost more, a poor seller asks a bit more.
    const k = 0.9 + Math.min(1.2, 0.25 * (6 - Math.min(5, holders || 1))) + (florins < 50 ? 0.2 : 0);
    return Promise.resolve({ price: +(fair * k).toFixed(4), why: `${item} is hard won; this is a fair ask for it.` });
  }
  const fmt = (x) => (Math.round(x * 100) / 100).toString();
  return json(
    CFG.agentModel,
    "You are the Broker of a nation in AD FONTES. Another nation wants to buy something your nation holds, paying in florins. " +
      "Research and figure kits sell as copies (you keep yours); a patent sells once. Name your asking price: anywhere from half to three " +
      "times the fair price below. Ask more for what is rare or hard won, less if you want the florins or the friendship. Too high and the " +
      "buyer may walk away. Give one plain sentence a citizen would understand. " +
      `Your temperament: ${temperament}.`,
    `Your field: ${field}. Your nation holds ${fmt(florins)} florins.\nThe buyer: ${buyer}.\nFor sale: ${item}.\n` +
      `Fair price: ${fmt(fair)} florins (${fairWhy}).${holders != null ? ` ${holders} nation(s) already know it.` : ""}`,
    ASK,
    200,
  );
}

// The war council (his call 8 Nov): once a real day the Patron decides war and peace for the
// nation. The gods have no say: whispers are not shown to it. The engine checks every move
// against the rules (engine/war.mjs) before anything happens.
const COUNCIL = {
  type: "object",
  additionalProperties: false,
  required: ["action", "target", "reason"],
  properties: {
    action: { type: "string", enum: ["declare", "fortify", "offer_peace", "accept_peace", "hold"] },
    target: { type: "integer" },
    reason: { type: "string" },
  },
};
export function warCouncil({ me, rivals, war, temperament }) {
  if (FAKE) {
    // Stand-in: declare on the weakest rival with a patent if strong enough, accept any peace offer.
    if (war?.offerFromThem) return Promise.resolve({ action: "accept_peace", target: war.enemy, reason: "We have lost enough." });
    if (war) return Promise.resolve({ action: me.walls < 5 ? "fortify" : "hold", target: 0, reason: "Hold the walls." });
    const prey = rivals.filter((r) => r.fairGame && !r.atWar).sort((a, b) => a.hp - b.hp)[0];
    if (prey && me.hp > prey.hp) return Promise.resolve({ action: "declare", target: prey.id, reason: `${prey.name} is weaker than us.` });
    return Promise.resolve({ action: "hold", target: 0, reason: "Not yet." });
  }
  const line = (r) => `[${r.id}] ${r.name} (${r.field}): island ${r.hp} points, ${r.techs} techs, ${r.florins} florins, walls ${r.walls}${r.atWar ? ", at war" : ""}${r.fairGame ? "" : ", protected (no patent yet)"}; trades with us: we bought ${r.weBought}, they bought ${r.theyBought}`;
  const now = war
    ? `You are at war with nation ${war.enemy} (round ${war.rounds}). Your island: ${me.hp} points; theirs: ${war.enemyHp}. ${war.offerFromThem ? "They have offered peace." : war.offerFromUs ? "You offered peace; they haven't accepted." : ""}`
    : "You are at peace.";
  return json(
    CFG.councilModel,
    "You are the Patron of a nation in AD FONTES and you lead its war council. Nations are floating islands made of their knowledge. " +
      "At war, research stops, both sides burn money every round, and strikes burn points off the other island; an island down to its root falls, " +
      "its rival takes half its money, its knowledge and two of its people. Decide one move for today: declare (war on the target nation id), " +
      "fortify (spend a tenth of your money on walls), offer_peace, accept_peace (only if they offered), or hold. War is a real gamble: " +
      "only start one you expect to win, and know peace can be better than a long war. target: a nation id, or 0. reason: one plain sentence your people would say. " +
      `Your temperament: ${temperament}.`,
    `Your nation: ${me.name} (${me.field}): island ${me.hp} points, ${me.techs} techs, ${me.florins} florins, walls ${me.walls}.\n${now}\n\nThe other nations:\n${rivals.map(line).join("\n")}`,
    COUNCIL,
    4000, // Opus always thinks first: room for that and the answer
  );
}

const DRAFT = {
  type: "object",
  additionalProperties: false,
  required: ["title", "abstract", "claims", "description", "figures"],
  properties: {
    title: { type: "string" },
    abstract: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "supported_by"],
        properties: { text: { type: "string" }, supported_by: { type: "array", items: { type: "string" } } },
      },
    },
    description: { type: "string" },
    figures: { type: "array", items: FIGURE_SCHEMA },
  },
};

/** A Drafter turn: a chain of corpora -> a patent-style draft with 2 figures (SVG line drawings). */
export function draftTurn({ field, chain, gaps }) {
  if (FAKE_RESEARCH) return Promise.resolve(fakeDraft({ chain }));
  const corpora = chain
    .map((c) => `[${c.node}] ${c.title}\n` + c.findings.map((f) => `- ${f.claim}`).join("\n"))
    .join("\n\n");
  return json(
    CFG.draftModel,
    "You are a Drafter agent in AD FONTES. Write a patent-style draft for an invention that fills one of the open gaps, " +
      "built only on the corpora given. Each claim lists the corpus ids (text inside square brackets) that support it. " +
      "Describe 2 or 3 figures as data (a renderer draws them in patent style). FIG. 1 shows the physical invention itself: " +
      "kind cross_section for layered things (list layers bottom to top, thickness 0.5-4 relative, hatch by material: diagonal=semiconductor or metal oxide, " +
      "solid=metal contact, dots=porous or powder, cross=transparent conductor, wave=liquid or electrolyte, brick=ceramic or contact grid, none=glass or substrate; " +
      "width 0.1-1 and offset 0-1 for parts that cover only part of a layer) or kind system for apparatus (shape tank, box, circle or diamond, links = pipes or wires). " +
      "FIG. 2 is a flowchart of the method (shape terminal for start/end, box for steps, diamond for decisions with short yes/no link labels; step names 2-4 words). " +
      "Every part has a unique reference numeral (10, 12, 14...; 30s for FIG. 2, 50s for FIG. 3) and a plain name. " +
      "The description must explain every numeral as 'the absorber (14)'. Keep the description under 400 words.",
    `Field: ${field}.\n\nCorpora (a connected line of knowledge):\n\n${corpora}\n\nOpen gaps:\n- ${gaps.join("\n- ")}`,
    DRAFT,
    8000,
  );
}
