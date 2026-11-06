// Open papers from OpenAlex, with the keywords OpenAlex tags on each one (the mindmap's points).
import fs from "node:fs";

const CACHE = "engine/state/papers-cache.json";
let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

const unInvert = (idx) => {
  const words = [];
  for (const [w, pos] of Object.entries(idx || {})) for (const p of pos) words[p] = w;
  return words.join(" ");
};

/** Papers for a search phrase: [{id, title, year, abstract, keywords[]}], cached on disk. */
export async function papersFor(query, n = 10) {
  const key = `${query}|${n}`;
  if (cache[key]) return cache[key];
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("filter", "open_access.is_oa:true,has_abstract:true,from_publication_date:2015-01-01");
  url.searchParams.set("per-page", String(n));
  url.searchParams.set("select", "id,title,publication_year,abstract_inverted_index,keywords");
  const res = await fetch(url, { headers: { "User-Agent": "adfontes-engine" } });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const j = await res.json();
  const papers = j.results.map((w) => ({
    id: w.id.split("/").pop(),
    title: w.title,
    year: w.publication_year,
    abstract: unInvert(w.abstract_inverted_index).slice(0, 1200),
    keywords: (w.keywords || []).map((k) => k.display_name.toLowerCase()),
  }));
  cache[key] = papers;
  save();
  return papers;
}

/** Does this OpenAlex work id exist? (the Warden's citation check). */
export async function paperExists(id) {
  const res = await fetch(`https://api.openalex.org/works/${id}?select=id`, { headers: { "User-Agent": "adfontes-engine" } });
  return res.ok;
}
