// Spike 4: one Scholar turn on Haiku 5.5. It reads 10 abstracts and packages a corpus:
// findings that each cite real paper ids. Then the Warden check: every cited id must be one of
// the papers it was given. Prints tokens and cost.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const papers = JSON.parse(fs.readFileSync("spikes/out/papers-solid-state-electrolyte-lithium-dendrite.json", "utf8")).slice(0, 10);
const shortId = (u) => u.split("/").pop();
const listing = papers.map((p) => `[${shortId(p.id)}] ${p.title} (${p.year})\n${p.abstract.slice(0, 1200)}`).join("\n\n");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["corpus_title", "niche", "findings", "open_gaps", "asking_price_usdc"],
  properties: {
    corpus_title: { type: "string" },
    niche: { type: "string" },
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
    asking_price_usdc: { type: "number" },
  },
};

const t0 = Date.now();
const msg = await client.messages.create({
  model: "claude-haiku-5-5",
  max_tokens: 4000,
  output_config: { effort: "low", format: { type: "json_schema", schema } },
  system:
    "You are a Scholar agent in AD FONTES, a world where AI clans build knowledge from open papers and sell it to each other. " +
    "Package what these papers establish into a corpus another clan would pay for. Every finding must cite paper ids from the list, in square brackets' inner text only. " +
    "Name open gaps the papers leave, since those are where new inventions can come from. Price the corpus in USDC between 0.05 and 2.",
  messages: [{ role: "user", content: `Your clan's field: batteries.\n\nPapers:\n\n${listing}` }],
});

if (msg.stop_reason !== "end_turn") console.log("stop_reason:", msg.stop_reason);
const text = msg.content.find((b) => b.type === "text")?.text ?? "";
const corpus = JSON.parse(text);
const valid = new Set(papers.map((p) => shortId(p.id)));
const cites = corpus.findings.flatMap((f) => f.cites);
const bad = cites.filter((c) => !valid.has(c));

const u = msg.usage;
const cost = (u.input_tokens * 0.1 + u.output_tokens * 0.5) / 1e6;
console.log(`time ${Date.now() - t0} ms | in ${u.input_tokens} tok, out ${u.output_tokens} tok | cost $${cost.toFixed(5)}`);
console.log(`corpus: "${corpus.corpus_title}" | niche: ${corpus.niche} | price ${corpus.asking_price_usdc} USDC`);
console.log(`findings ${corpus.findings.length}, citations ${cites.length}, made-up citations ${bad.length}${bad.length ? " -> " + bad.join(",") : ""}`);
console.log("first finding:", corpus.findings[0]?.claim);
console.log("gaps:", corpus.open_gaps.slice(0, 3).join(" | "));
fs.writeFileSync("spikes/out/corpus-sample.json", JSON.stringify({ usage: u, corpus }, null, 2));
