// What the open nation panel shows, as one string (13 Nov, his note: the panel never changed after he acted).
// main.js redraws the panel when this changes. Florins are rounded so dust doesn't redraw it every poll.
export function panelSig(c) {
  if (!c) return "";
  const w = c.war || {};
  return [c.id, c.alive, c.mood, Math.round(c.florins ?? 0), c.points, c.depth, c.clean_gifts, c.tricksters, c.gods,
    c.reverence?.standing, c.reverence?.followed, w.enemy, w.hp, w.enemyHp, w.rounds, w.walls, w.offer, c.fallen?.by, (c.techs || []).length].join("|");
}
