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

// The season standings (his call 16 Nov): every nation still standing ranks, whoever leads it, a
// person or an AI god, by the reverence of the god it follows. A nation that fell in war is out (his
// call 8 Nov). Ties go to the older nation. One rule for the HUD table (src/live/standings.js), the
// API's leader (server.mjs /api/stakes) and the jackpot script (scripts/award-jackpot.mjs).
// clans: the world's nations as /api/world sends them.
export const rankNations = (clans) => (clans || []).filter((c) => c.alive !== false && !c.fallen)
  .map((c) => ({ id: c.id, name: c.name, standing: c.reverence?.standing ?? 0, waiting: !!c.reverence?.waiting, follows: c.reverence?.followed ?? null }))
  .sort((a, b) => b.standing - a.standing || a.id - b.id);

// North Pole: the season's demo nation. Santa is its god. It rises from the centre of the map and
// its citizens are small people in red and white.
export const isNorthPole = (c) => /^\s*north\s*pole\s*$/i.test(c?.name || "");
