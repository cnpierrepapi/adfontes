// Open papers from OpenAlex, with the keywords OpenAlex tags on each one (the mindmap's points).
import fs from "node:fs";
import { getPapers, putPapers } from "./store.mjs";

// Free OpenAlex key = $1/day (~1,000 searches). Without one we share $0.10/day per IP address.
// A local simulation (ADF_SIM_CHAIN) never spends the live world's key (9 Nov: three sims used up the
// day's budget and the live nations' research failed with 429s). It reads the shared paper cache and,
// on a miss, asks OpenAlex with its own key (ADF_SIM_OPENALEX_KEY) or none (the per-IP free pool).
const SIM = !!process.env.ADF_SIM_CHAIN;
const KEY = SIM ? process.env.ADF_SIM_OPENALEX_KEY : process.env.OPENALEX_API_KEY || (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").match(/^OPENALEX_API_KEY=(\S+)/m)?.[1];
const AUTH = KEY ? { Authorization: `Bearer ${KEY}` } : {};

const unInvert = (idx) => {
  const words = [];
  for (const [w, pos] of Object.entries(idx || {})) for (const p of pos) words[p] = w;
  return words.join(" ");
};

/** Papers for a search phrase: [{id, title, year, abstract, keywords[]}], cached on disk. */
export async function papersFor(query, n = 10) {
  const key = `${query}|${n}`;
  const hit = await getPapers(key);
  if (hit) return hit;
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("filter", "open_access.is_oa:true,has_abstract:true,from_publication_date:2015-01-01");
  url.searchParams.set("per-page", String(n));
  url.searchParams.set("select", "id,title,publication_year,abstract_inverted_index,keywords");
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { "User-Agent": "adfontes-engine", ...AUTH } });
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); // 2s, 4s, 8s, 16s
  }
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const j = await res.json();
  const papers = j.results.map((w) => ({
    id: w.id.split("/").pop(),
    title: w.title,
    year: w.publication_year,
    abstract: unInvert(w.abstract_inverted_index).slice(0, 1200),
    keywords: (w.keywords || []).map((k) => k.display_name.toLowerCase()),
  }));
  await putPapers(key, papers);
  return papers;
}

// The Warden checks citations against the papers a Scholar was given (engine/world.mjs wardenCorpus),
// not by asking OpenAlex again: if OpenAlex is down, the Scholar's turn fails and nobody is fined.
