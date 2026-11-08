// Every price in the world, in one file (the Games With Real Economies brief: "pricing rules in one
// readable file, with the merchant's reasoning in a tooltip"). Each rule returns the price AND the
// sum that made it, in plain words; the engine stores both on the trade and the site shows them when
// you hover a trade in the event list. Change a number here and every market in the world follows.
//
// Amounts are in florins at mainnet scale; testnet multiplies by florinRates().scale (engine/config.mjs).

export const PRICES = {
  // Research (a corpus: what one nation's Scholars learned about one point).
  researchBase: 1,        // florins for a point one step from a nation's root
  // x (1 + depth): deeper knowledge took longer to reach, so it costs more.
  // x scarcity = nations alive / (1 + nations that already know it): rare knowledge costs more,
  //   knowledge half the world already has is cheap.
  astrolabeDiscount: 0.5, // a buyer with the Astrolabe pays half: it finds what it needs from afar

  // Figure kits (a nation's drawings, bought once by a Drafter to halve its draft mistakes).
  kit: 1,                 // flat: every kit does the same job

  // The Printing Press: copies are cheap, so a seller with the Press earns this on top of every sale.
  // (It's minted for the seller, not paid by the buyer; the amount lives in config.florin.pressSale.)
};

const f = (x) => (Math.round(x * 100) / 100).toString();

/** What a piece of research costs. base = PRICES.researchBase at this network's scale. */
export function researchPrice({ base, depth, nations, holders, astrolabe }) {
  const scarcity = nations / (1 + holders);
  const price = +(base * (1 + depth) * scarcity * (astrolabe ? PRICES.astrolabeDiscount : 1)).toFixed(4);
  const why = [
    `${f(base)} base`,
    `× ${1 + depth} for depth ${depth}`,
    `× ${f(scarcity)} scarcity (${nations} nations, ${holders} already know${holders === 1 ? "s" : ""} it)`,
    ...(astrolabe ? [`× ½ with the Astrolabe`] : []),
  ].join(" ") + ` = ${f(price)} florins`;
  return { price, why };
}

/** What a figure kit costs. base = PRICES.kit at this network's scale. */
export function kitPrice({ base }) {
  return { price: base, why: `flat price for a figure kit: ${f(base)} florins` };
}
