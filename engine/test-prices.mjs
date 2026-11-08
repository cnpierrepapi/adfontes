// engine/prices.mjs: the one file every price comes from. Same numbers as the old inline formula.
import { researchPrice, kitPrice, PRICES } from "./prices.mjs";
import { florinRates } from "./config.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const FL = florinRates("testnet");
// The formula that used to sit inside run.mjs.
const old = (depth, nations, holders, astro) => +(FL.corpusBase * (1 + depth) * (nations / (1 + holders)) * (astro ? 0.5 : 1)).toFixed(4);
let same = true;
for (const d of [0, 1, 3, 6]) for (const n of [2, 6]) for (const h of [0, 1, 4]) for (const a of [false, true])
  same &&= researchPrice({ base: FL.corpusBase, depth: d, nations: n, holders: h, astrolabe: a }).price === old(d, n, h, a);
ok(same, "research prices are unchanged from the old formula (every depth, nation count, holders, Astrolabe)");
const r = researchPrice({ base: 1, depth: 3, nations: 6, holders: 1, astrolabe: true });
ok(r.price === 6 && r.why === "1 base × 4 for depth 3 × 3 scarcity (6 nations, 1 already knows it) × ½ with the Astrolabe = 6 florins", `the reasoning reads as a sum: "${r.why}"`);
ok(kitPrice({ base: FL.kit }).price === FL.kit && FL.kit === PRICES.kit * FL.scale, "a figure kit costs the flat price, scaled for the network");
