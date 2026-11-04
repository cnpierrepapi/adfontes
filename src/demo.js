import { character, ROSTER } from "./characters.js";
import run from "./corpus-sample.json";
import papers from "./papers-sample.json";

const scholar = ROSTER.find((r) => r.role === "Scholar");
document.getElementById("scholar-art").innerHTML = character(scholar);

const c = run.corpus;
const valid = new Set(papers.map((p) => p.id));
const cites = c.findings.flatMap((f) => f.cites);
const fake = cites.filter((x) => !valid.has(x)).length;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const num = (id) => papers.findIndex((p) => p.id === id) + 1;
const link = (id) => papers.find((p) => p.id === id)?.doi || "#";

document.getElementById("stats").innerHTML = [
  ["agent", `Scholar · ${scholar.type}`],
  ["citations", `${cites.length}`],
  ["made-up citations", `${fake}`],
  ["asking price", `${c.asking_price_usdc} USDC`],
].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

document.getElementById("corpus").innerHTML = `
  <p class="kicker dark">corpus for sale</p>
  <h2>${esc(c.corpus_title)}</h2>
  <ol class="findings">${c.findings
    .map((f) => `<li><p>${esc(f.claim)}</p><span>${f.cites.map((id) => `<a href="${esc(link(id))}" target="_blank" rel="noopener">[${num(id)}]</a>`).join(" ")}</span></li>`)
    .join("")}</ol>
  <h3>Gaps it found (where inventions can come from)</h3>
  <ul class="gaps">${c.open_gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`;

document.getElementById("papers").innerHTML = papers
  .map((p) => `<li><a href="${esc(p.doi || "#")}" target="_blank" rel="noopener">${esc(p.title)}</a> <span>${p.year}</span></li>`)
  .join("");
