import { PRICES } from "./prices.mjs";
// Every number the world runs on. SPEC.md §6, §6b, §7, §12b. Amounts in NEAR.
export const CFG = {
  // Engine turn every 2 real hours. Day and night come from engine/clock.mjs (SPEC §14).
  realHoursPerDay: 2,
  nightPace: 0.5, // Scholars research at half pace at night (Spectacles tech: full pace)
  weatherWeeks: 110, // Oct 2023 -> Nov 2025

  // Weather dial (from the 4 Nov sim, retuned for NEAR's bigger swings: x3 instead of x5).
  weatherGain: 3, // hot = clamp(weekly change x gain, -0.5, +1)
  paceSwing: 0.6, // pace = 1 + hot x 0.6  -> 0.7 (cold) .. 1.6 (hot)
  baseMistake: 0.08, // Warden finds this share of drafts dirty on a calm week
  hotMistake: 0.15, // extra mistake rate at full heat

  // Needs (SPEC §14): NEAR a nation's citizens want per real day = base x citizens x growth^age(days)
  // x techStep^techs. Blessings in the last real day vs need decide hungry / content / sated.
  needs: { base: 0.02, growth: 1.03, techStep: 1.15, hungryBelow: 0.5, satedAbove: 2, hungrySlow: 0.2, hungryFade: 1.5, silenceMs: 24 * 3600e3 },
  richLazy: 0.4, // sated: citizens do 40% less
  neglectSlow: 0.3, // under a quarter of the average: 30% less
  neglectTrickster: 0.3, // daily chance a Trickster moves into a neglected clan
  tricksterMistake: 0.05, // each Trickster adds this to the draft mistake rate

  // Fortune (fair judging).
  fortuneReward: 1.08,
  fortunePunish: 0.9,
  fortuneUnruled: 0.97,
  fortuneMax: 2,

  // Agents learn (F5): +5% per clean output in a topic, up to +50%; half to neighbours.
  learnStep: 0.05,
  learnCap: 0.5,

  // Economy. Sized so a 3.5 NEAR clan (1.885 play) can last a ~100-day season.
  // Florins (SPEC §14; rates from scripts/sim-florin.mjs, 7 Nov): a strong small nation ~1.8x,
  // a rich lazy one ~0.6x, a neglected one ~0.05x over the season.
  florin: {
    corpus: 8, // minted per clean corpus
    draft: 40, // minted per passed draft: 60% to the drafting nation, 40% to the others in its chain
    draftOwn: 0.6,
    tech: 40, // minted per tech unlocked (step 4)
    upkeep: 6, // burned per citizen per real day
    fine: 5, // burned per fake the Warden catches
    pressSale: 1, // Printing Press: minted to the seller each time another nation buys its research
  },
  // Upkeep and the draft limit run on REAL time, not engine turns (a burst of foundings starts
  // turns minutes apart). ADF_UPKEEP_HOURS only for test runs.
  // Testnet scale (his call 7 Nov): a testnet founding puts ~0.89 NEAR in (the testnet DAO factory
  // takes 5.5 of 6.5); mainnet ~6.2. Every florin amount on testnet x k x (0.89 / 6.2), with
  // k = 1.5: like mainnet, a little more chaotic (sim: strong 1.94x vs 1.82x, rich 0.56x vs 0.60x).
  florinK: 1.5,
  startNear: { testnet: 0.89, mainnet: 6.2 },
  upkeepEveryHours: Number(process.env.ADF_UPKEEP_HOURS) || 12,

  // Work per day.
  scholarTurnsPerDay: 1, // per Scholar, scaled by pace/laziness/fortune/skill
  draftMinDepth: 3, // a draft needs a connected chain this deep
  maxDepth: 6, // lines stop here; the Patron branches out instead
  draftEveryMs: 24 * 3600e3, // at most one draft per nation per real day (SPEC §14)

  // Spend guard (his call, 7 Nov): never more than this on Claude in one UTC day, whatever happens.
  dailyCapUsd: Number(process.env.ADF_DAILY_CAP) || 0.5, // his cap: $0.50 a UTC day on ALL Claude calls, every network together (ADF_DAILY_CAP: the fast-forward simulation only)
  // What one nation costs a day at full pace, measured on w6 (8 Nov): ~24 Haiku research calls at
  // ~$0.001 + one Sonnet draft at ~$0.035 + one Broker call. More nations than the cap feeds = all slow evenly.
  nationDayUsd: 0.065,
  // The most one call has cost so far, plus margin: a call only starts if it fits under the cap.
  worstCallUsd: { agent: 0.002, draft: 0.05, council: 0.06 },
  // Only the 2-hour schedule moves the world. A deploy starts the engine too; a run this soon
  // after the last one exits without doing anything (a cut-off day still resumes).
  minMinutesBetweenRuns: 110,

  // Starting team (SPEC §12b.13).
  team: ["Patron", "Scholar", "Scholar", "Smith", "Drafter", "Broker"],

  // Models (SPEC §12b.4): Haiku for agent turns, Sonnet for drafts. Fallback compute = our key.
  agentModel: "claude-haiku-5-5",
  draftModel: "claude-sonnet-5-5",
  councilModel: "claude-opus-5-5", // the war council (his call 8 Nov): war and peace get the strongest mind
};

export const NETWORKS = {
  testnet: {
    rpc: "https://rpc.testnet.fastnear.com", // rpc.testnet.near.org is deprecated + rate-limited
    world: process.env.ADF_WORLD || "w6.adf-pool1-hf0w8.testnet", // the v2 world (wipe day, 7 Nov; SPEC §14)
    operatorKeyFile: ".keys/adfontes-mw1fjpfx.testnet.json",
  },
  mainnet: {
    rpc: "https://rpc.mainnet.fastnear.com",
    world: "world.adfontes.near",
    operatorEnv: "ADFONTES_OPERATOR", // keys from Documents/env.txt
  },
};

/** Florin amounts for a network (testnet scaled by k, SPEC §14). */
export function florinRates(net) {
  const f = net === "testnet" ? CFG.florinK * (CFG.startNear.testnet / CFG.startNear.mainnet) : 1;
  const out = Object.fromEntries(Object.entries(CFG.florin).map(([k, v]) => [k, k === "draftOwn" ? v : v * f]));
  // Prices live in engine/prices.mjs (one readable file); here they're only scaled for the network.
  return { ...out, corpusBase: PRICES.researchBase * f, kit: PRICES.kit * f, scale: f };
}
