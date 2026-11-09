// The tighter cut (his call 9 Nov): which of a turn's records play on screen. Every big moment plays;
// the everyday ones play the first time (a nation's first research, a pair's first trade). The world's
// state still follows every record; this only decides what you watch happen.
const RARE = ["starlance", "ornithopters", "burningglass", "mortar", "pamphlets", "trebuchet", "arrows", "cannon"];
export function makeCut() {
  const seen = new Set();
  const first = (k) => (seen.has(k) ? false : (seen.add(k), true));
  return function cut(recs) {
    return recs.filter((r) => {
      switch (r.kind) {
        case "founded": case "war": case "peace-offer": case "peace": case "fallen": case "absorb": case "rooted": return true;
        case "tech": return true; // a building rises in the town
        case "gift": return !!r.passed && first(`patent:${r.clan}`); // a nation's first patent
        case "fortify": return first(`walls:${r.clan}`); // the first walls go up
        case "trickster": return first(`trickster:${r.clan}`);
        case "warden": return first(`warden:${r.clan}`);
        case "bless": return r.mode === "rescue" || first(`bless:${r.god}`);
        case "battle": {
          const sides = Object.values(r.sides || {});
          const newWeapon = sides.some((s) => s.weapon && RARE.includes(s.weapon) && first(`weapon:${s.weapon}`));
          return newWeapon || (sides.some((s) => s.burned?.length) && first(`burn:${r.war}:${Math.floor(r.round / 2)}`));
        }
        case "corpus": return !r.fake && first(`corpus:${r.clan}`);
        case "trade": return !r.tool && first(`trade:${Math.min(r.buyer, r.seller)}-${Math.max(r.buyer, r.seller)}`);
        case "tool": return first(`tool:${r.clan}`);
        // 9 Nov: a whisper the citizens heard (the new reverence rule): each nation's first, and any that moved them a lot.
        // ...and one whisper heard as empty words, to show what generic words get you.
        case "heard": return first(`heard:${r.clan}`) || Math.abs(r.delta || 0) >= 12 || (r.verdict === "empty" && first("heard:empty"));
        case "royalty": return first("royalty"); // the first time a patent pays its holder
        case "market-buy": return first(`market:${r.clan}`); // a nation's first buy on the marketplace
        default: return false;
      }
    });
  };
}
