// Open papers from OpenAlex, with the keywords OpenAlex tags on each one (the mindmap's points).
import fs from "node:fs";
import { getPapers, putPapers, allPapers, paperKeys } from "./store.mjs";
import { openAlexOpen } from "./budget.mjs";

const words = (q) => new Set(String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
/** The cached search closest to a query (most shared words, same page size), or null. */
function closest(query, n) {
  const want = words(query);
  let best = null, score = 0;
  for (const [key, papers] of Object.entries(allPapers())) {
    const [q, size] = key.split("|");
    if (Number(size) !== n || !papers?.length) continue;
    let k = 0;
    for (const w of words(q)) if (want.has(w)) k++;
    if (k > score) { score = k; best = papers; }
  }
  return best;
}

// Free OpenAlex key = $1/day (~1,000 searches). Without one we share $0.10/day per IP address.
// A local simulation (ADF_SIM_CHAIN) never spends the live world's key (9 Nov: three sims used up the
// day's budget and the live nations' research failed with 429s). It reads the shared paper cache and,
// on a miss, asks OpenAlex with its own key (ADF_SIM_OPENALEX_KEY) or none (the per-IP free pool).
const SIM = !!process.env.ADF_SIM_CHAIN;
// His call 10 Nov: one key, the new one (Railway OPENALEX_API_KEY). The old key and its fallback are
// gone: it had no budget left, so every short burst limit on the new key fell through to it and failed.
const KEY = SIM ? process.env.ADF_SIM_OPENALEX_KEY : process.env.OPENALEX_API_KEY;
const auth = (k) => (k ? { Authorization: `Bearer ${k}` } : {});

// His cap 12 Nov: at most 75% of the key's daily OpenAlex credits. The budget is OpenAlex's own count: read
// once per engine run (/rate-limit), then kept current from each reply's x-ratelimit-* headers. Past the
// line, research reads the closest cached search instead (as copies of the world do).
let budget = null, cut = false;
export const openAlexCut = () => cut;
export const openAlexBudget = () => budget;
async function readBudget() {
  if (budget || !KEY) return;
  try {
    const r = await fetch("https://api.openalex.org/rate-limit", { headers: { "User-Agent": "adfontes-engine", ...auth(KEY) } });
    const j = r.ok ? await r.json() : null;
    if (j?.rate_limit?.credits_limit > 0) budget = { limit: j.rate_limit.credits_limit, remaining: j.rate_limit.credits_remaining };
  } catch { /* unknown: the first search's headers will tell */ }
}
const fromHeaders = (res) => {
  const limit = Number(res.headers.get("x-ratelimit-limit")), remaining = Number(res.headers.get("x-ratelimit-remaining"));
  if (limit > 0 && Number.isFinite(remaining)) budget = { limit, remaining };
};
/** The cached search closest to a query, from the database or the file cache; null if nothing shares a word. */
async function closestCached(query, n) {
  const local = closest(query, n);
  if (local) return local;
  const want = words(query);
  let best = null, score = 0;
  for (const key of (await paperKeys(n).catch(() => []))) { let k = 0; for (const w of words(key.split("|")[0])) if (want.has(w)) k++; if (k > score) { score = k; best = key; } }
  return best ? getPapers(best) : null;
}

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
  // A copy of the world run offline (ADF_PAPERS_OFFLINE=1: tests and the sandbox) never asks OpenAlex.
  // A search it hasn't seen gets the cached search that shares the most words with it, so research
  // goes on; with nothing in common it fails like an OpenAlex miss.
  if (SIM && process.env.ADF_PAPERS_OFFLINE === "1") {
    const near = closest(query, n);
    if (near) return near;
    throw new Error("OpenAlex offline (test copy, not in the cache)");
  }
  // Past 75% of today's credits: no live search.
  await readBudget();
  if (!openAlexOpen(budget)) {
    if (!cut) console.log(`  OpenAlex: ${budget.remaining} of ${budget.limit} credits left today, under the 25% we keep back: research reads the paper cache`);
    cut = true;
    const near = await closestCached(query, n);
    if (near) return near;
    throw new Error("OpenAlex's daily share is used up and nothing cached is close");
  }
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("filter", "open_access.is_oa:true,has_abstract:true,from_publication_date:2015-01-01");
  url.searchParams.set("per-page", String(n));
  url.searchParams.set("select", "id,title,publication_year,abstract_inverted_index,keywords");
  let res;
  // A 429 here is almost always a burst (too many at once), not the day's budget: wait as OpenAlex
  // asks (Retry-After) or back off, and try the same key again, up to 6 times (about a minute).
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, { headers: { "User-Agent": "adfontes-engine", ...auth(KEY) } });
    if (res.status !== 429 && res.status < 500) break;
    const after = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, after > 0 ? Math.min(30, after) * 1000 : 1500 * 2 ** attempt)); // 1.5s, 3s, 6s, 12s, 24s
  }
  fromHeaders(res);
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
