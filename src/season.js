// The season as the site tells it (his calls 11 Nov). The game is in beta. Season 1 is the Season of
// Cheer, a Christmas special on energy ("Santa needs light too"), 11 November to 12 December 2026.
// The jackpot's payout date isn't set yet. The contract's own label ("S1: energy") stays on chain;
// pages show this instead.
export const SEASON = {
  name: "Season of Cheer",
  field: "energy",
  from: Date.UTC(2026, 10, 11),
  to: Date.UTC(2026, 11, 12, 23, 59),
};
export const seasonLabel = () => `${SEASON.name} · beta`;

// The nine nations alive on 11 November played the beta before the season's demo nation arrived.
// After the hackathon (results by 18 November) they leave the season's ranking; they stay in the
// world and keep playing. Display only: the engine and the contract are unchanged.
export const BETA_NATIONS = new Set([1, 2, 3, 4, 5, 6, 9, 10, 11]);
export const BETA_OFF_AT = Date.UTC(2026, 10, 19, 0, 0);
export const inRanking = (c, now = Date.now()) => !(now >= BETA_OFF_AT && BETA_NATIONS.has(Number(c?.id)));

// North Pole: the season's demo nation. Santa is its god. It rises from the centre of the map and
// its citizens are small people in red and white.
export const isNorthPole = (c) => /^\s*north\s*pole\s*$/i.test(c?.name || "");
