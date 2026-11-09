// Research, patents and figure kits as NEP-245 tokens (his call 8 Nov; contract: contracts/world/src/mt.rs).
// The engine's records stay the truth of what each nation knows; the tokens mirror them on NEAR,
// held by each nation's Broker in its own wallet (his call 9 Nov: the agents trade them, the gods
// never touch them; they were in the DAOs for one turn and moved over). One step every turn (instant ones too, since 9 Nov), plus a mint the moment a sale completes, compares what every nation should hold with
// what was already minted and mints the difference, so the backfill of everything made before tokens
// existed and the minting of new work are the same code, and a mint that failed is retried next turn.
//
//   r:<corpus id>  research: one copy to every nation whose knowledge uses that corpus
//   p:<draft id>   a passed patent draft: one, to the nation that drafted it
//   k:<tool id>    a figure kit: to the nation that made it, and a copy to each nation that bought it

/** Everything every nation should hold. holderOf(clanId) -> the account that holds them (its Broker's
 *  wallet; null: skip the nation for now). */
export function wanted(s, holderOf) {
  const out = [];
  const add = (clan, token_id, title) => { const owner_id = holderOf(clan); if (owner_id) out.push({ key: `${clan}|${token_id}`, token_id, owner_id, title: String(title || token_id).slice(0, 120) }); };
  for (const [id, c] of Object.entries(s.clans || {})) {
    const clan = Number(id);
    const seen = new Set();
    for (const v of Object.values(c.owned || {})) {
      if (!v.corpus || seen.has(v.corpus) || !s.corpora?.[v.corpus]) continue;
      seen.add(v.corpus);
      add(clan, `r:${v.corpus}`, s.corpora[v.corpus].title);
    }
    // Research bought on the market for a point it already knew still comes as a token.
    for (const id of c.marketCorpora || []) if (!seen.has(id) && s.corpora?.[id]) { seen.add(id); add(clan, `r:${id}`, s.corpora[id].title); }
    for (const k of c.kits || []) if (s.tools?.[k]) add(clan, `k:${k}`, `Figure kit from ${s.clans[s.tools[k].clan]?.name ?? `nation ${s.tools[k].clan}`}`);
  }
  for (const d of Object.values(s.drafts || {})) if (d.passed) add(d.clan, `p:${d.id}`, d.title || d.draft?.title || `Patent draft ${d.id}`);
  for (const t of Object.values(s.tools || {})) add(t.clan, `k:${t.id}`, `Figure kit from ${s.clans[t.clan]?.name ?? `nation ${t.clan}`}`);
  return out;
}

/** What still needs minting (in a stable order, patents first so none waits behind research). */
export function toMint(s, holderOf) {
  const done = new Set(s.mtDone || []);
  const order = { p: 0, k: 1, r: 2 };
  return wanted(s, holderOf).filter((m) => !done.has(m.key)).sort((a, b) => order[a.token_id[0]] - order[b.token_id[0]] || (a.key < b.key ? -1 : 1));
}
