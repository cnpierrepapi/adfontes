// World state kept off chain (Neon later; a JSON file for the testnet loop), the clan mindmap,
// the Warden's checks and the daily provenance root.
import crypto from "node:crypto";
import { CFG } from "./config.mjs";

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Canonical JSON: keys sorted at every level, so any copy of a record hashes the same
 *  (Postgres jsonb reorders keys; other languages serialise differently). */
export function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
/** A record's leaf in the day's Merkle tree. */
export const leafOf = (r) => sha256(canon(r));

const FIELDS = ["batteries", "solar cells", "carbon capture"];
const LETTERS = [["E", "I"], ["S", "N"], ["T", "F"], ["J", "P"]];

/** First sight of a clan: give it a field, a temperament and a mindmap rooted at its field. */
export function initClan(s, clan) {
  const n = Object.keys(s.clans).length;
  const field = FIELDS[n % FIELDS.length];
  s.clans[clan.id] = {
    id: clan.id,
    name: clan.name,
    field,
    mbti: LETTERS.map((p) => p[Math.random() < 0.5 ? 0 : 1]).join(""),
    fortune: 1,
    tricksters: 0,
    lastDraftDay: -99,
    lastUpkeepDay: 0,
    skills: {}, // agent name -> { node: skill }
    hasKit: false,
    // mindmap: owned points and the frontier (points one step out, not yet owned)
    owned: { [field]: { depth: 0, parent: null, corpus: null, how: "root" } },
    frontier: {},
    alive: true,
  };
  return s.clans[clan.id];
}

/** Depth of the deepest owned point whose whole chain back to the root is owned. */
export function chainDepth(c) {
  let best = 0;
  for (const [k, v] of Object.entries(c.owned)) {
    let d = v.depth, cur = k, ok = true;
    while (c.owned[cur]?.parent) { cur = c.owned[cur].parent; if (!c.owned[cur]) { ok = false; break; } }
    if (ok && d > best) best = d;
  }
  return best;
}

/** The connected chain (root..deepest) as a list of owned points. */
export function deepestChain(c) {
  let deepest = null;
  for (const [k, v] of Object.entries(c.owned)) if (!deepest || v.depth > c.owned[deepest].depth) deepest = k;
  const chain = [];
  for (let cur = deepest; cur; cur = c.owned[cur]?.parent) chain.unshift(cur);
  return chain;
}

/** Add a corpus's keywords as new frontier points one step out from `node`. */
export function grow(c, node, keywords) {
  const depth = c.owned[node].depth + 1;
  for (const k of keywords) if (!c.owned[k] && !c.frontier[k] && k !== node) c.frontier[k] = { depth, parent: node };
}

/** Patron picks the next point. N or J leap/finish deep; S or P stay shallow and explore.
 *  Lines stop at CFG.maxDepth, so the mindmap branches instead of running off in one line. */
export function pickTarget(c) {
  const pts = Object.entries(c.frontier).filter(([, v]) => v.depth <= CFG.maxDepth);
  if (!pts.length) return null;
  const deep = c.mbti[1] === "N" || c.mbti[3] === "J";
  // N/J: deepest first. S/P: anywhere on the map (still reaching drafting depth, just slower).
  if (deep) pts.sort((a, b) => b[1].depth - a[1].depth || Math.random() - 0.5);
  else pts.sort(() => Math.random() - 0.5);
  return pts[Math.floor(Math.random() * Math.min(3, pts.length))][0];
}

/** Warden on a corpus: every citation must be one of the papers the Scholar was given. */
export function wardenCorpus(corpus, paperIds) {
  const valid = new Set(paperIds);
  const cites = corpus.findings.flatMap((f) => f.cites);
  const fake = cites.filter((x) => !valid.has(x));
  return { clean: fake.length === 0 && cites.length > 0, cites: cites.length, fake };
}

/** Warden on a draft: claims cite only the chain; every figure numeral is explained in the text. */
export function wardenDraft(draft, chainNodes) {
  const allowed = new Set(chainNodes);
  const problems = [];
  for (const [i, cl] of draft.claims.entries()) {
    const bad = cl.supported_by.filter((x) => !allowed.has(x));
    if (!cl.supported_by.length) problems.push(`claim ${i + 1} cites nothing`);
    if (bad.length) problems.push(`claim ${i + 1} cites outside the chain: ${bad.join(", ")}`);
  }
  if (draft.figures.length < 2) problems.push("fewer than 2 figures");
  for (const fig of draft.figures) {
    // Numerals may sit alone ("30") or after a step label ("Measure output 30"); skip "FIG. 2" titles.
    const texts = [...fig.svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    const nums = texts.filter((t) => !/^fig/i.test(t)).flatMap((t) => [...t.matchAll(/(?<![\w.,])(\d{1,3})(?![\w.,])/g)].map((m) => m[1]));
    if (!nums.length) problems.push(`${fig.label} has no reference numerals`);
    for (const n of new Set(nums)) if (!new RegExp(`\\(${n}\\)`).test(draft.description)) problems.push(`${fig.label}: numeral ${n} never explained`);
  }
  return { passed: problems.length === 0, problems };
}

/** Merkle root over the day's records (sha256, last leaf doubled on odd levels). */
export function merkleRoot(records) {
  return rootOfLeaves(records.map(leafOf));
}

/** Root from leaf hashes (sha256, last leaf doubled on odd levels). */
export function rootOfLeaves(leaves) {
  let level = leaves.slice();
  if (!level.length) return sha256("empty");
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}

/** Learning (F5): +5% in a topic per clean output, half to its neighbours, capped. */
export function learn(c, agent, node) {
  const sk = (c.skills[agent] ||= {});
  const bump = (k, v) => (sk[k] = Math.min(CFG.learnCap, (sk[k] || 0) + v));
  bump(node, CFG.learnStep);
  const parent = c.owned[node]?.parent;
  if (parent) bump(parent, CFG.learnStep / 2);
}

const STOP = new Set(["based", "using", "system", "systems", "method", "methods", "analysis", "material", "materials", "energy", "effect", "effects", "properties", "performance", "application", "applications", "structure", "process"]);
const words = (k) => k.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w));
/** Two points are related if they share a significant word (graphene oxide ~ reduced graphene oxide). */
export function related(a, b) {
  const wa = new Set(words(a));
  return a === b || words(b).some((w) => wa.has(w));
}

/** Ruins (SPEC §12b.11): when a clan GAINS a point today that matches a ruin (same keyword, or
 *  the new corpus's papers are tagged with it), it absorbs that ruin point and the ruin points
 *  that grew from it. Nothing is absorbed without a matching gain, so it happens over time. */
export function absorbRuins(s, c, gained) {
  const taken = [];
  for (const g of gained) {
    const tags = new Set([g, ...(s.corpora[c.owned[g]?.corpus]?.children || [])]);
    const hits = Object.keys(s.ruins).filter((k) => tags.has(k));
    for (const hit of hits) {
      const queue = [hit];
      while (queue.length) {
        const k = queue.shift();
        const v = s.ruins[k];
        if (!v) continue;
        // Already know this point (e.g. just researched it)? Keep ours, but still unlock what grew from it.
        if (!c.owned[k]) {
          c.owned[k] = { depth: v.depth, parent: c.owned[v.parent] ? v.parent : g, corpus: v.corpus, how: `absorbed from ruins of clan ${v.from}` };
          delete c.frontier[k];
          taken.push(k);
        }
        delete s.ruins[k];
        for (const [rk, rv] of Object.entries(s.ruins)) if (rv.parent === k) queue.push(rk);
      }
    }
  }
  return taken;
}

/** Merkle proof for leaf i: the sibling hashes from the bottom up, and which side each sits on. */
export function merkleProof(leaves, i) {
  const path = [];
  let level = leaves.slice(), idx = i;
  while (level.length > 1) {
    const sib = idx % 2 ? idx - 1 : idx + 1;
    path.push({ hash: level[sib] ?? level[idx], left: idx % 2 === 1 });
    const next = [];
    for (let k = 0; k < level.length; k += 2) next.push(sha256(level[k] + (level[k + 1] ?? level[k])));
    level = next;
    idx = Math.floor(idx / 2);
  }
  return path;
}

/** Recompute the root from a leaf hash and its proof. */
export function rootFromLeaf(leaf, path) {
  let h = leaf;
  for (const p of path) h = p.left ? sha256(p.hash + h) : sha256(h + p.hash);
  return h;
}

/** Recompute the root from one record (canonical leaf) and its proof. */
export const rootFromProof = (record, path) => rootFromLeaf(leafOf(record), path);
