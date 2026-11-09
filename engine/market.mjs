// The marketplace's rules on the engine side (his calls 9 Nov; contract: contracts/world/src/market.rs).
// Only the agents trade: each nation's Broker lists what it holds and buys other nations' listings,
// from its own wallet, in florins. Pure functions here; engine/run.mjs does the chain work.
//
//   fair prices   every listable token has one (engine/prices.mjs); a Broker asks 0.5x to 3x of it
//   a sale        teaches the buyer: research joins its knowledge, a kit helps its Drafter, a patent
//                 changes hands (and with it the royalties)
//   royalties     whenever any nation buys research on a point in a passed patent's chain (on the
//                 market or in the automatic trades), the patent's holder earns PRICES.patentRoyalty
import { researchPrice, kitPrice, patentPrice } from "./prices.mjs";
import { grow } from "./world.mjs";

const kindOf = (t) => ({ r: "research", k: "kit", p: "patent" })[t[0]];
export const holderOfPatent = (s, draftId) => s.patents?.[draftId] ?? s.drafts?.[draftId]?.clan ?? null;

/** A token's title and fair price (FL = florinRates(net)), or null if the world doesn't know it. */
export function fairOf(s, tokenId, FL) {
  const [p, id] = [tokenId[0], tokenId.slice(2)];
  if (p === "r") {
    const sc = s.corpora?.[id];
    if (!sc) return null;
    const maker = s.clans[sc.clan];
    const depth = maker?.owned?.[sc.node]?.depth ?? 1;
    const nations = Object.values(s.clans).filter((c) => c.alive !== false && !c.fallen).length;
    const holders = Object.values(s.clans).filter((c) => Object.values(c.owned || {}).some((v) => v.corpus === id)).length;
    return { title: sc.title || sc.node, kind: "research", point: sc.node, ...researchPrice({ base: FL.corpusBase, depth, nations, holders, astrolabe: false }) };
  }
  if (p === "k") {
    const t = s.tools?.[id];
    if (!t) return null;
    return { title: `Figure kit from ${s.clans[t.clan]?.name ?? `nation ${t.clan}`}`, kind: "kit", ...kitPrice({ base: FL.kit }) };
  }
  if (p === "p") {
    const d = s.drafts?.[id];
    if (!d?.passed) return null;
    return { title: d.title || `Patent ${id}`, kind: "patent", ...patentPrice({ base: FL.patentBase, links: (d.chain || []).length }) };
  }
  return null;
}

/** What a nation's Broker can put up for sale: its own research, its patents, its own kits. */
export function sellable(s, clanId, FL) {
  const out = [];
  const c = s.clans[clanId];
  const own = new Set(Object.values(c.owned || {}).map((v) => v.corpus).filter(Boolean));
  for (const id of own) if (s.corpora[id]?.clan === clanId) { const f = fairOf(s, `r:${id}`, FL); if (f) out.push({ token_id: `r:${id}`, ...f }); }
  for (const d of Object.values(s.drafts || {})) if (d.passed && holderOfPatent(s, d.id) === clanId) { const f = fairOf(s, `p:${d.id}`, FL); if (f) out.push({ token_id: `p:${d.id}`, ...f }); }
  for (const t of Object.values(s.tools || {})) if (t.clan === clanId) { const f = fairOf(s, `k:${t.id}`, FL); if (f) out.push({ token_id: `k:${t.id}`, ...f }); }
  return out.sort((a, b) => b.price - a.price);
}

/** Could this nation use what's on offer? Research it doesn't know yet, a kit if it has none, any patent. */
export function useful(s, clanId, tokenId) {
  const c = s.clans[clanId];
  if (tokenId[0] === "r") {
    const sc = s.corpora?.[tokenId.slice(2)];
    return !!sc && !c.owned[sc.node] && !Object.values(c.owned).some((v) => v.corpus === sc.id);
  }
  if (tokenId[0] === "k") return !c.hasKit;
  return tokenId[0] === "p" && holderOfPatent(s, tokenId.slice(2)) !== clanId;
}

/** A sale on the market teaches the buyer. Returns a short note of what changed (for the record). */
export function applySale(s, sale) {
  const c = s.clans[sale.buyer];
  if (!c) return null;
  const t = sale.token_id, id = t.slice(2);
  if (t[0] === "r") {
    const sc = s.corpora?.[id];
    if (!sc) return null;
    const point = sc.node;
    if (c.owned[point]) {
      // It knew the point already: it keeps the research all the same (its token is minted).
      (c.marketCorpora ||= []).includes(id) || c.marketCorpora.push(id);
      return { learned: null, note: "already knew the point" };
    }
    const maker = s.clans[sc.clan];
    const p = maker?.owned?.[point]?.parent;
    const parent = p && c.owned[p] ? p : c.field;
    c.owned[point] = { depth: (c.owned[parent]?.depth ?? 0) + 1, parent, corpus: id, how: `bought on the market from clan ${sale.seller}` };
    delete c.frontier[point];
    grow(c, point, sc.children || []);
    return { learned: point };
  }
  if (t[0] === "k") {
    c.hasKit = true;
    (c.kits ||= []).includes(id) || c.kits.push(id);
    return { kit: id };
  }
  if (t[0] === "p") {
    (s.patents ||= {})[id] = sale.buyer;
    return { patent: id };
  }
  return null;
}

/** Royalties for a research buy: [{ clan, draft }] for every passed patent whose chain holds the
 *  point, paid to its holder (never to the buyer itself). */
export function royaltiesFor(s, points, buyer) {
  const want = new Set(points.filter(Boolean));
  const out = [];
  for (const d of Object.values(s.drafts || {})) {
    if (!d.passed || !(d.chain || []).some((n) => want.has(n))) continue;
    const holder = holderOfPatent(s, d.id);
    if (holder != null && holder !== buyer && s.clans[holder] && !s.clans[holder].fallen) out.push({ clan: holder, draft: d.id });
  }
  return out;
}

export { kindOf };
