// A nation's status label (13 Nov). "Neglected" means what it says: no god has acted there for 24 hours (the
// engine's lastActAt, sent as last_act_at). Hunger and Tricksters are their own facts. Tested in tests/status.test.mjs.
const DAY = 24 * 3600e3;

export function statusOf(c, now = Date.now()) {
  if (c.alive === false) return "dead";
  if (c.seen === false) return "new";
  if (c.last_act_at != null && now - c.last_act_at > DAY) return "neglected";
  if (c.mood === "hungry") return "hungry";
  if (c.mood === "sated") return "rich";
  return "ok";
}

/** The few words after the nation's name on its floating plate. */
export function plateWords(c, status) {
  return status === "dead" ? " · ruins" : status === "rich" ? " · sated" : status === "neglected" ? " · neglected" : status === "hungry" ? " · hungry" : status === "new" ? " · new" : "";
}

/** The line under the name in the nation's panel. */
export function panelWords(c, status) {
  const base = status === "dead" ? " · ruins" : status === "rich" ? " · sated, so a bit lazy" : status === "neglected" ? " · neglected: no god has acted here in a day" : status === "hungry" ? " · hungry, it needs a blessing" : status === "new" ? " · new, waiting for its first day" : "";
  return base + ((c.tricksters || 0) > 0 && status !== "dead" ? " · a Trickster moved in" : "");
}
