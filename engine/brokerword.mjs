// Whispering to the Broker (PLAN_13NOV step 3, confirmed by him 12 Nov). A god asks its nation's Broker to list
// some of what the nation holds (a signed choice, kind "list"). The Broker listens by that god's reverence: under
// REV.ignoredBelow never; otherwise with chance reverence/100, on seeded dice, one roll per god, nation and turn.
// If it listens, the market day puts those items up (the Broker still sets the price, clamped as always; buyers
// still walk away over twice fair). A god-asked listing that sells above fair earns that god a little reverence
// (reverence.mjs brokerReward). Pure functions; engine/run.mjs does the chain work. Tested in test-broker-word.mjs.
import { createHash } from "node:crypto";
import { REV } from "./reverence.mjs";

export const WORD = { maxItems: 3, perSale: 1, capPerDay: 5, ceiling: 60 };

/** The dice for one god, nation and turn (what's asked doesn't change them). */
export const seedOf = ({ day, clan, god, world }) => `${day}|${clan}|${god}|list|${world}`;
const roll = (seed) => createHash("sha256").update(seed).digest().readUInt32BE(0) / 2 ** 32;

/** Does the Broker listen? r = the asking god's reverence in that nation. */
export function hears({ r, seed }) {
  const rr = Number(r) || 0, x = roll(seed);
  if (rr < REV.ignoredBelow) return { listens: false, ignored: true, chance: 0, roll: +x.toFixed(4) };
  const chance = Math.min(1, rr / 100);
  return { listens: x < chance, ignored: false, chance: +chance.toFixed(3), roll: +x.toFixed(4) };
}

/** What the god asked for that the nation can sell and hasn't already listed: once each, at most WORD.maxItems. */
export function mustList(tokens, sellable, open = []) {
  const out = [];
  for (const t of tokens || []) {
    if (out.length >= WORD.maxItems || out.some((x) => x.token_id === t)) continue;
    if (open.some((l) => l.open !== false && l.token_id === t)) continue;
    const x = sellable.find((y) => y.token_id === t);
    if (x) out.push(x);
  }
  return out;
}

/** A sale counts for the reward only above the fair price. */
export const aboveFair = (sale, fair) => Number.isFinite(Number(fair)) && Number(sale?.price) > Number(fair);
