// Agent minds. Haiku for Scholar turns, Sonnet for drafts (SPEC §12b.4). Fallback compute = our
// Claude key in .env.local. Every call is metered so the season's cost is known.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { CFG } from "./config.mjs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const PRICE = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] }; // $ per M tokens
export const meter = { calls: 0, usd: 0 };

async function json(model, system, user, schema, maxTokens) {
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  const [pin, pout] = PRICE[model];
  meter.calls++;
  meter.usd += (msg.usage.input_tokens * pin + msg.usage.output_tokens * pout) / 1e6;
  const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

const CORPUS = {
  type: "object",
  additionalProperties: false,
  required: ["title", "findings", "open_gaps"],
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
  },
};

/** A Scholar turn: papers -> a corpus whose every finding cites paper ids from the list. */
export function scholarTurn({ field, topic, parent, papers, temperament, whisper }) {
  const listing = papers.map((p) => `[${p.id}] ${p.title} (${p.year})\n${p.abstract}`).join("\n\n");
  return json(
    CFG.agentModel,
    "You are a Scholar agent in AD FONTES, a world where AI clans build knowledge from open papers and trade it. " +
      "Package what these papers establish about the topic into a corpus another clan would pay for. " +
      "Every finding cites ids from the list (the text inside the square brackets only). Name the open gaps the papers leave. " +
      `Your temperament: ${temperament}.` + (whisper ? ` Your gods whisper: "${whisper}".` : ""),
    `Field: ${field}. Topic: ${topic}${parent ? ` (building on: ${parent})` : ""}.\n\nPapers:\n\n${listing}`,
    CORPUS,
    3000,
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
    figures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "caption", "svg"],
        properties: { label: { type: "string" }, caption: { type: "string" }, svg: { type: "string" } },
      },
    },
  },
};

/** A Drafter turn: a chain of corpora -> a patent-style draft with 2 figures (SVG line drawings). */
export function draftTurn({ field, chain, gaps }) {
  const corpora = chain
    .map((c) => `[${c.node}] ${c.title}\n` + c.findings.map((f) => `- ${f.claim}`).join("\n"))
    .join("\n\n");
  return json(
    CFG.draftModel,
    "You are a Drafter agent in AD FONTES. Write a patent-style draft for an invention that fills one of the open gaps, " +
      "built only on the corpora given. Each claim lists the corpus ids (text inside square brackets) that support it. " +
      "Write exactly 2 figures as SVG line drawings in patent style: black lines on white, no shading, viewBox 0 0 400 300, " +
      "parts labelled with reference numerals (10, 12, 14...) written in <text> elements, each joined to its part by a thin lead line. " +
      "In flowcharts, every box holds a short step label (2-4 words) plus its numeral. " +
      "Every numeral used in a figure must be explained in the description " +
      "as 'part (10)'. Keep the description under 400 words.",
    `Field: ${field}.\n\nCorpora (a connected line of knowledge):\n\n${corpora}\n\nOpen gaps:\n- ${gaps.join("\n- ")}`,
    DRAFT,
    8000,
  );
}
