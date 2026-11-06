// Dev helper: one real Drafter turn on a real testnet chain, rendered with the figure kit.
// Usage: node scripts/try-draft.mjs [clanId]
import fs from "node:fs";
import { draftTurn, meter } from "../engine/llm.mjs";
import { renderFigure } from "../engine/figures.mjs";
import * as W from "../engine/world.mjs";

const s = JSON.parse(fs.readFileSync("engine/state/testnet.json", "utf8"));
const c = s.clans[process.argv[2] || 2];
const nodes = W.deepestChain(c).filter((k) => c.owned[k].corpus).slice(0, 5);
const chain = nodes.map((k) => ({ ...s.corpora[c.owned[k].corpus], node: k }) /* the clan's own point name wins (bought corpora carry the seller's) */);
const draft = await draftTurn({ field: c.field, chain, gaps: chain.at(-1).gaps.slice(0, 4) });
for (const f of draft.figures) f.svg = renderFigure(f);
const check = W.wardenDraft(draft, nodes);
console.log("title:", draft.title);
console.log("figures:", draft.figures.map((f) => `${f.label} ${f.kind} (${f.parts.length} parts)`).join(", "));
console.log("warden:", check.passed ? "clean" : check.problems.join("; "), `| cost $${meter.usd.toFixed(4)}`);
const key = (f) => f.parts.map((p) => `${p.n} ${p.name}`).join(" · ");
fs.writeFileSync(
  "stills/try-draft.html",
  `<body style="margin:0;display:flex;flex-wrap:wrap;gap:8px;background:#ddd;padding:8px">${draft.figures.map((f) => `<div style="background:#fff">${f.svg}<div style="font:12px Arial;padding:4px 8px;max-width:510px">${key(f)}</div></div>`).join("")}</body>`,
);
fs.writeFileSync("stills/try-draft.json", JSON.stringify(draft, null, 1));
