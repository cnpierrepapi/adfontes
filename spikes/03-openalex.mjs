// Spike 3: pull open-access papers for one narrow topic from OpenAlex (no key, $0.10/day free).
// Saves abstracts to spikes/out/papers-<slug>.json for the agent spike.
import fs from "node:fs";

const topic = process.argv[2] || "solid-state electrolyte lithium dendrite";
const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
const url = new URL("https://api.openalex.org/works");
url.searchParams.set("search", topic);
url.searchParams.set("filter", "open_access.is_oa:true,has_abstract:true,from_publication_date:2018-01-01");
url.searchParams.set("per-page", "25");
url.searchParams.set("select", "id,doi,title,publication_year,cited_by_count,abstract_inverted_index,primary_location");

const t0 = Date.now();
const res = await fetch(url, { headers: { "User-Agent": "adfontes-spike" } });
console.log("status", res.status, "in", Date.now() - t0, "ms; rate headers:", res.headers.get("x-ratelimit-remaining") ?? "none");
const j = await res.json();

const unInvert = (idx) => {
  const words = [];
  for (const [w, pos] of Object.entries(idx || {})) for (const p of pos) words[p] = w;
  return words.join(" ");
};
const papers = j.results.map((w) => ({
  id: w.id,
  doi: w.doi,
  title: w.title,
  year: w.publication_year,
  cited: w.cited_by_count,
  source: w.primary_location?.source?.display_name ?? null,
  abstract: unInvert(w.abstract_inverted_index),
}));

fs.mkdirSync("spikes/out", { recursive: true });
fs.writeFileSync(`spikes/out/papers-${slug}.json`, JSON.stringify(papers, null, 2));
console.log("total matches:", j.meta.count, "| saved:", papers.length);
console.log("avg abstract words:", Math.round(papers.reduce((a, p) => a + p.abstract.split(" ").length, 0) / papers.length));
for (const p of papers.slice(0, 5)) console.log(`- ${p.year} | ${p.cited} cites | ${p.title}`);

// Check a single id lookup works (the Warden uses this to confirm a citation is real).
const one = await fetch(`https://api.openalex.org/works/${papers[0].id.split("/").pop()}?select=id,title`).then((r) => r.json());
console.log("lookup by id ok:", one.title === papers[0].title);
