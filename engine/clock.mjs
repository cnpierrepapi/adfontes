// The world clock (SPEC §14). The world replays NEAR's real hourly closes 5x faster than life
// (1 NEAR hour = 12 real minutes), timed so the replay meets live NEAR when the season ends.
// Day and night come from the price: the season opens on a rise (day); a day ends when the price
// falls FLIP below its high, a night ends when it climbs FLIP above its low. A phase's length
// counts in 24 NEAR-hour units, so 48 falling hours = 2 nights. A cycle = a night + a day.

export const CLOCK = {
  speed: 5, // NEAR hours per real hour (N = 12 real minutes per NEAR hour)
  flip: 0.03, // 3% reversal flips day <-> night
  seasonEnd: Date.parse("2026-11-30T23:00:00Z"), // midnight 30 Nov -> 1 Dec, Malta
  hour: 3600e3,
};

/** The NEAR moment (ms) the world shows at real time `realMs`. Equals realMs at season end. */
export const nearTimeAt = (realMs, c = CLOCK) => c.seasonEnd - c.speed * (c.seasonEnd - realMs);
/** The real time (ms) at which the world reaches NEAR moment `nearMs`. */
export const realTimeAt = (nearMs, c = CLOCK) => c.seasonEnd - (c.seasonEnd - nearMs) / c.speed;

/**
 * Split hourly closes into day/night phases. `rows` = [[unixSec, close], ...] sorted, one per hour,
 * starting at the season's first NEAR hour. Causal: a flip at hour i uses only prices up to i.
 * Returns phases [{ day, start, end, startPrice, endPrice, hours }] (end = null for the open one).
 */
export function phases(rows, flip = CLOCK.flip) {
  if (!rows.length) return [];
  const out = [];
  let day = true, ext = rows[0][1], start = 0;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i][1];
    if (day ? p > ext : p < ext) ext = p;
    else if (day ? p <= ext * (1 - flip) : p >= ext * (1 + flip)) {
      out.push({ day, start: rows[start][0], end: rows[i][0], startPrice: rows[start][1], endPrice: p, hours: i - start });
      day = !day; ext = p; start = i;
    }
  }
  out.push({ day, start: rows[start][0], end: null, startPrice: rows[start][1], endPrice: rows.at(-1)[1], hours: rows.length - 1 - start });
  return out;
}

/** Whole days or nights a phase counts as (at least 1; 48 h = 2). */
export const units = (hours) => Math.max(1, Math.ceil(hours / 24));

/**
 * Where the world is at real time `realMs`. `rows` = the season's hourly closes so far.
 * - phase: "day" | "night"; hoursIn: NEAR hours into it; arc: 0..1 through the current 24 h unit
 *   (the sun's or moon's path); unit: which day/night of a long run this is (1, 2, ...)
 * - days / nights: how many have begun this season; cycle: completed night+day pairs + 1
 */
export function clockAt(rows, realMs, c = CLOCK) {
  const t = nearTimeAt(realMs, c) / 1000;
  const upTo = rows.filter((r) => r[0] <= t);
  const ph = phases(upTo, c.flip);
  if (!ph.length) return null;
  const cur = ph.at(-1);
  const hoursIn = Math.max(0, (t - cur.start) / 3600);
  let days = 0, nights = 0;
  for (const p of ph) {
    const u = p === cur ? Math.floor(hoursIn / 24) + 1 : units(p.hours);
    if (p.day) days += u; else nights += u;
  }
  return {
    nearTime: Math.round(t * 1000),
    price: upTo.at(-1)[1],
    startPrice: cur.startPrice,
    change: +(upTo.at(-1)[1] / cur.startPrice - 1).toFixed(4), // how far this rise/fall has gone
    phase: cur.day ? "day" : "night",
    phaseStartedNear: cur.start * 1000,
    phaseStartedReal: Math.round(realTimeAt(cur.start * 1000, c)),
    hoursIn: +hoursIn.toFixed(2),
    unit: Math.floor(hoursIn / 24) + 1,
    arc: +((hoursIn % 24) / 24).toFixed(4),
    days, nights,
    cycle: Math.min(days, nights) + 1,
  };
}

export const hourFloor = (ms) => Math.floor(ms / CLOCK.hour) * CLOCK.hour;

/** A new season's first NEAR hour, if it started at real time `realMs` (one hour back, so the
 *  world has a price from its first second). */
export const seasonStartNear = (realMs = Date.now()) => hourFloor(nearTimeAt(realMs)) - CLOCK.hour;

/**
 * Bring `cache.rows` (in place) up to the world's NEAR time now: only NEAR hours that are over in
 * the world (an hour's close is never shown before the world reaches its end). Returns the rows.
 */
export async function extendHours(cache, startNear, realMs = Date.now()) {
  if (cache.startNear !== startNear) { cache.startNear = startNear; cache.rows = []; }
  cache.rows ||= [];
  const upTo = nearTimeAt(realMs);
  const last = cache.rows.length ? cache.rows.at(-1)[0] * 1000 : startNear - CLOCK.hour;
  if (upTo - last < 2 * CLOCK.hour) return cache.rows; // the next hour isn't over yet
  const more = await fetchHours(last + CLOCK.hour, upTo);
  for (const r of more) if (r[0] * 1000 > last && r[0] * 1000 >= startNear && r[0] * 1000 + CLOCK.hour <= upTo) cache.rows.push(r);
  return cache.rows;
}

/** Hourly closes from Coinbase between two ms times, [[unixSec, close], ...] sorted, no gaps filled. */
export async function fetchHours(fromMs, toMs) {
  const rows = new Map();
  for (let t = fromMs; t < toMs; t += 300 * CLOCK.hour) {
    const end = Math.min(toMs, t + 299 * CLOCK.hour);
    const u = `https://api.exchange.coinbase.com/products/NEAR-USD/candles?granularity=3600&start=${new Date(t).toISOString()}&end=${new Date(end).toISOString()}`;
    const r = await fetch(u, { headers: { "user-agent": "adfontes-world-clock" } });
    if (!r.ok) throw new Error(`price feed ${r.status}`);
    for (const c of await r.json()) rows.set(c[0], [c[0], c[4]]);
    await new Promise((res) => setTimeout(res, 200));
  }
  return [...rows.values()].sort((a, b) => a[0] - b[0]);
}
