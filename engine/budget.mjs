// Budgets (his calls 12 Nov). The Claude pots live in llm.mjs (canSpend); these are the two rules around them.

/** Fair share: the nations that waited longest for a Claude turn go first (never = first of all), ties by id.
 *  When the day's money runs out mid-turn, the ones left out lead the next turn. */
export function fairOrder(list, s) {
  const at = (c) => s.clans?.[c.id]?.lastThoughtAt ?? -Infinity;
  return [...list].sort((a, b) => at(a) - at(b) || a.id - b.id);
}

/** OpenAlex's daily credits (his cap: use at most 75%). budget = { limit, remaining } as OpenAlex reports it
 *  (/rate-limit, or the x-ratelimit-* headers on each reply). Unknown = open: the first search reads it. */
export const OPENALEX_SHARE = 0.75;
export function openAlexOpen(budget) {
  if (!budget || !(budget.limit > 0)) return true;
  return budget.remaining >= budget.limit * (1 - OPENALEX_SHARE);
}
