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

  // Gods' money (SPEC §6): by NEAR put in, never by sales.
  richLazy: 0.4, // above the world average: agents do 40% less
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
  upkeepPerAgent: 0.001, // NEAR per agent per game day (burned, counts as spend)
  upkeepEveryDays: 6, // charge upkeep in batches to save gas
  corpusBasePrice: 0.01, // NEAR; x (1 + depth) x scarcity
  toolPrice: 0.008,
  wardenBounty: 0.02, // to our treasury when the Warden catches a fake
  sweepEveryDays: 12, // send fees to the treasury once a real day

  // Work per day.
  scholarTurnsPerDay: 1, // per Scholar, scaled by pace/laziness/fortune/skill
  draftMinDepth: 3, // a draft needs a connected chain this deep
  maxDepth: 6, // lines stop here; the Patron branches out instead
  draftEveryDays: 8, // a clan tries at most one draft this often

  // Spend guard (his call, 7 Nov): never more than this on Claude in one UTC day, whatever happens.
  dailyCapUsd: 0.5,
  // The most one call has cost so far, plus margin: a call only starts if it fits under the cap.
  worstCallUsd: { agent: 0.002, draft: 0.05 },
  // Only the 2-hour schedule moves the world. A deploy starts the engine too; a run this soon
  // after the last one exits without doing anything (a cut-off day still resumes).
  minMinutesBetweenRuns: 110,

  // Starting team (SPEC §12b.13).
  team: ["Patron", "Scholar", "Scholar", "Smith", "Drafter", "Broker"],

  // Models (SPEC §12b.4): Haiku for agent turns, Sonnet for drafts. Fallback compute = our key.
  agentModel: "claude-haiku-5-5",
  draftModel: "claude-sonnet-5-5",
};

export const NETWORKS = {
  testnet: {
    rpc: "https://rpc.testnet.fastnear.com", // rpc.testnet.near.org is deprecated + rate-limited
    world: process.env.ADF_WORLD || "w5.adf-god6-77978.testnet",
    operatorKeyFile: ".keys/adfontes-mw1fjpfx.testnet.json",
  },
  mainnet: {
    rpc: "https://rpc.mainnet.fastnear.com",
    world: "world.adfontes.near",
    operatorEnv: "ADFONTES_OPERATOR", // keys from Documents/env.txt
  },
};
