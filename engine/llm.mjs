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
const PRICE = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] }; // $ per M tokens
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
  const kind = model === CFG.draftModel ? "draft" : "agent";
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
  if (FAKE) return Promise.resolve(fakeCorpus({ topic, papers }));
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
  if (FAKE) return Promise.resolve(fakeDraft({ chain }));
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
