// Walking round things (SPEC §14b): nobody, and nothing they push or carry, goes through a
// building. `blocks` = [[x, z, radius], ...] in town space (buildings, trees, the fountain, the
// temple). A mover heads for its target, swings to the side of whatever is in its way, and is
// never left inside a footprint. A block that holds the target itself is not in the way (people
// work at stations right next to their scene).

const LOOK = 1.6; // how far ahead (in island units, scaled by the mover) a mover watches for blocks

/**
 * One step from `pos` toward `target`, `step` long, for a mover of radius `rad`.
 * Returns the new [x, z]. `maxR` keeps it on the island.
 */
export function steer(pos, target, step, blocks, rad, maxR = Infinity, strict = false) {
  let dx = target[0] - pos[0], dz = target[1] - pos[1];
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return [pos[0], pos[1]];
  dx /= dist; dz /= dist;
  // Strict movers (strollers, the cart, the watchman) never get let into a building; workers may
  // step up to the scene they work at.
  const holdsTarget = strict ? () => false : (b) => Math.hypot(target[0] - b[0], target[1] - b[1]) < b[2] + rad;
  // The nearest block whose circle the path ahead crosses (none if the straight leg is clear).
  let hit = null, hitT = Infinity;
  // A clear leg: no swinging, only the guard below against blocks within one step of us.
  if (clearLine(pos, target, blocks.filter((b) => !holdsTarget(b)), rad)) blocks = blocks.filter((b) => Math.hypot(pos[0] - b[0], pos[1] - b[1]) < b[2] + rad + step);
  const ahead = Math.min(dist, LOOK + rad * 4);
  for (const b of blocks) {
    if (holdsTarget(b)) continue;
    const R = b[2] + rad, ox = b[0] - pos[0], oz = b[1] - pos[1];
    const t = ox * dx + oz * dz;
    if (t < -R || t > ahead) continue;
    const px = ox - t * dx, pz = oz - t * dz;
    if (Math.hypot(px, pz) < R && t < hitT) { hit = b; hitT = t; }
  }
  if (hit) {
    // Swing to the side the block's centre is NOT on; the closer it is, the harder the swing.
    const ox = hit[0] - pos[0], oz = hit[1] - pos[1];
    const leftOfPath = dx * oz - dz * ox > 0;
    const sx = leftOfPath ? dz : -dz, sz = leftOfPath ? -dx : dx;
    const w = Math.min(0.92, 0.55 + 0.4 * (1 - Math.max(0, hitT) / (ahead + 1e-6)));
    dx = dx * (1 - w) + sx * w; dz = dz * (1 - w) + sz * w;
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  }
  const s = Math.min(step, dist);
  return pushOut(pos[0] + dx * s, pos[1] + dz * s, blocks, rad, maxR, holdsTarget);
}

/**
 * Never inside a footprint and never off the island, both at once: push straight out of any
 * circle, keep within maxR, and repeat until both hold (where two footprints overlap, or one sits
 * at the island's edge, fixing one can break the other; fixing them one at a time made people
 * shake back and forth every frame).
 */
export function pushOut(nx, nz, blocks, rad, maxR = Infinity, skip = () => false) {
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (const b of blocks) {
      if (skip(b)) continue;
      const R = b[2] + rad, ox = nx - b[0], oz = nz - b[1], d = Math.hypot(ox, oz);
      if (d < R - 1e-9) {
        // Exactly on a centre: push toward the island's middle.
        const ux = d > 1e-6 ? ox / d : -b[0] / (Math.hypot(b[0], b[1]) || 1), uz = d > 1e-6 ? oz / d : -b[1] / (Math.hypot(b[0], b[1]) || 1);
        nx = b[0] + ux * (R + 1e-6); nz = b[1] + uz * (R + 1e-6); moved = true;
      }
    }
    const len = Math.hypot(nx, nz);
    if (len > maxR) { nx *= maxR / len; nz *= maxR / len; moved = true; }
    if (!moved) break;
  }
  return [nx, nz];
}

/**
 * Personal space (SPEC §14b): nobody walks into anybody. Any two people closer than their two
 * radii are pushed apart; someone holding their place (working at a station, sitting) stays put
 * and the other steps aside. Then everyone is kept out of the buildings again.
 * movers = [{ pos, cr, hold, strict, target }]
 */
export function separate(movers, blocks, maxR) {
  for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) {
    const a = movers[i], b = movers[j];
    if (a.hold && b.hold) continue;
    const dx = b.pos[0] - a.pos[0], dz = b.pos[1] - a.pos[1], d = Math.hypot(dx, dz), want = (a.cr + b.cr) * 0.9;
    if (d >= want) continue;
    const ux = d > 1e-6 ? dx / d : Math.cos(i + j), uz = d > 1e-6 ? dz / d : Math.sin(i + j), o = want - d;
    const ka = a.hold ? 0 : b.hold ? 1 : 0.5, kb = 1 - ka;
    a.pos[0] -= ux * o * ka; a.pos[1] -= uz * o * ka;
    b.pos[0] += ux * o * kb; b.pos[1] += uz * o * kb;
  }
  for (const m of movers) {
    if (m.hold) continue;
    const skip = m.strict || !m.target ? () => false : (b) => Math.hypot(m.target[0] - b[0], m.target[1] - b[1]) < b[2] + m.cr;
    const p = pushOut(m.pos[0], m.pos[1], blocks, m.cr, maxR, skip);
    m.pos[0] = p[0]; m.pos[1] = p[1];
  }
}

/**
 * A route round the buildings: shortest path on a fine grid over the island (8 directions), every
 * cell clear of every footprint (+ the mover's radius), then smoothed to the few straight legs a
 * person would actually walk. Returns waypoints ending at `to` (just [to] if the way is clear).
 */
export function route(from, to, blocks, rad, maxR, cell = 0.12, strict = false) {
  const use = strict ? blocks : blocks.filter((b) => Math.hypot(to[0] - b[0], to[1] - b[1]) >= b[2] + rad && Math.hypot(from[0] - b[0], from[1] - b[1]) >= b[2] + rad);
  if (clearLine(from, to, use, rad)) return [to];
  const n = Math.ceil((maxR * 2) / cell) + 1, off = maxR;
  const idx = (x, z) => [Math.round((x + off) / cell), Math.round((z + off) / cell)];
  const pos = (i, j) => [i * cell - off, j * cell - off];
  const free = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const [x, z] = pos(i, j);
    free[i * n + j] = Math.hypot(x, z) <= maxR && !insideAny(x, z, use, rad) ? 1 : 0;
  }
  const [si, sj] = idx(...from), [ti, tj] = idx(...to);
  const ok = (i, j) => i >= 0 && j >= 0 && i < n && j < n && (free[i * n + j] || (i === ti && j === tj) || (i === si && j === sj));
  // A* with a simple binary heap
  // 64-bit costs: 32-bit ones round, a rounded-up cost looks beatable by the same path, and the
  // search re-queues that cell forever (it froze on some walks).
  const g = new Float64Array(n * n).fill(Infinity), came = new Int32Array(n * n).fill(-1);
  const heap = [];
  const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const h = (i, j) => Math.hypot(i - ti, j - tj);
  const s0 = si * n + sj, goal = ti * n + tj;
  g[s0] = 0; push(s0, h(si, sj));
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  while (heap.length) {
    const [f, k] = pop();
    if (k === goal) { found = true; break; }
    if (f > g[k] + h(Math.floor(k / n), k % n) + 1e-9) continue; // an out-of-date entry: already done better
    const i = Math.floor(k / n), j = k % n;
    for (const [di, dj, w] of D) {
      const a = i + di, b = j + dj;
      if (!ok(a, b)) continue;
      const kk = a * n + b, ng = g[k] + w;
      if (ng < g[kk]) { g[kk] = ng; came[kk] = k; push(kk, ng + h(a, b)); }
    }
  }
  if (!found) return null; // no way there: the caller gives up on it (never walks into a wall)
  const cells = [];
  for (let k = goal; k !== -1 && k !== s0; k = came[k]) cells.unshift(pos(Math.floor(k / n), k % n));
  // Smooth: from each point, jump to the farthest point still in plain sight.
  const pts = [from, ...cells.slice(0, -1), to], out = [];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !clearLine(pts[a], pts[b], use, rad)) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

/** True if a mover of radius `rad` can walk the straight line a -> b without touching a block. */
export function clearLine(a, b, blocks, rad) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
  for (const q of blocks) {
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (L * L)));
    if (Math.hypot(a[0] + dx * t - q[0], a[1] + dz * t - q[1]) < q[2] + rad) return false;
  }
  return true;
}

/** Send mover `m` ({ pos: [x, z], cr: its radius }) to `target` by a route round the buildings. */
export function planWalk(m, target, blocks, maxR, now, strict = false) {
  m.target = [target[0], target[1]];
  m.from = [m.pos[0], m.pos[1]]; // where this walk began (a worker leaving their own scene)
  m.strict = strict;
  m.legs = route(m.pos, m.target, blocks, m.cr ?? 0.1, maxR, 0.12, strict);
  m.walkT0 = now;
  m.prog = null; m.stuck = false;
  m.noWay = !m.legs; // walled off: walkStep reports it at once, nobody walks on the spot
  if (!m.legs) m.legs = [m.target];
}

/**
 * One frame of walking along the planned route at `speed` (units per second). Updates m.pos and
 * m.heading; returns true on arrival (or after 30 s, so nobody is ever stuck for good).
 */
export function walkStep(m, dt, speed, blocks, maxR, now) {
  if (!m.target) return true;
  if (m.noWay) { m.target = null; m.legs = null; m.noWay = false; m.gaveUp = (m.gaveUp || 0) + 1; return true; }
  const step = speed * dt;
  if (m.legs.length > 1 && Math.hypot(m.legs[0][0] - m.pos[0], m.legs[0][1] - m.pos[1]) < Math.max(0.05, step * 1.5)) m.legs.shift();
  const np = steer(m.pos, m.legs[0], step, blocks, m.cr ?? 0.1, maxR, m.strict);
  const dx = np[0] - m.pos[0], dz = np[1] - m.pos[1];
  m.pos[0] = np[0]; m.pos[1] = np[1];
  // Face where we are really going: a nudge (someone stepping aside) doesn't turn us round.
  if (Math.hypot(dx, dz) > step * 0.5) m.heading = Math.atan2(dx, dz);
  // Stuck (blocked by a crowd or a corner): no real progress for 1.5 s means stop here and move
  // on to the next thing, never walk on the spot.
  if (!m.prog || now - m.prog.t > 1.5) {
    const moved = m.prog ? Math.hypot(m.pos[0] - m.prog.x, m.pos[1] - m.prog.z) : Infinity;
    m.stuck = moved < (m.cr ?? 0.1) * 0.5;
    m.prog = { t: now, x: m.pos[0], z: m.pos[1] };
  }
  const done = Math.hypot(m.target[0] - m.pos[0], m.target[1] - m.pos[1]) < 0.03 || m.stuck || now - (m.walkT0 ?? now) > 30;
  if (done) { m.gaveUp = m.stuck ? (m.gaveUp || 0) + 1 : 0; m.target = null; m.legs = null; m.prog = null; m.stuck = false; }
  return done;
}

/** Turn a three.js object toward `heading`, smoothly. */
export function turnToward(obj, heading, dt, rate = 6) {
  if (heading == null) return;
  obj.rotation.y += Math.atan2(Math.sin(heading - obj.rotation.y), Math.cos(heading - obj.rotation.y)) * Math.min(1, dt * rate);
}

/** True if (x, z) sits inside any block (for tests and checks). */
export const insideAny = (x, z, blocks, rad = 0) => blocks.some((b) => Math.hypot(x - b[0], z - b[1]) < b[2] + rad - 1e-6);

/** The open spot nearest to (x, z) with `rad` clearance from every block, staying on the island. */
export function makeOpen(blocks, r) {
  const clear = (x, z, rad = 0) => !blocks.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br + rad);
  return (x, z, rad = 0) => {
    if (clear(x, z, rad)) return [x, z];
    for (let ring = 1; ring <= 14; ring++) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, d = ring * r * 0.05;
      let nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
      const len = Math.hypot(nx, nz), max = r * 0.86;
      if (len > max) { nx *= max / len; nz *= max / len; } // stay on the island
      if (clear(nx, nz, rad)) return [nx, nz];
    }
    return [x, z];
  };
}

/**
 * Check a round (the watchman's) leg by leg on the finished town: stops with no way to them are
 * dropped; too few left and the round moves inward toward the plaza; nothing works and it parks.
 * Returns the stops to walk, or null (park).
 */
export function checkRounds(stops, blocks, cr, r, open) {
  const loop = (st) => {
    const keep = [st[0]];
    for (const q of st.slice(1)) if (route(keep.at(-1), q, blocks, cr, r * 0.88, 0.12, true)) keep.push(q);
    return keep.length >= 3 && route(keep.at(-1), keep[0], blocks, cr, r * 0.88, 0.12, true) ? keep : null;
  };
  let ok = loop(stops);
  for (const f of [0.5, 0.4, 0.3]) {
    if (ok) break;
    const ring = [...Array(8)].map((_, k) => open(Math.cos((k / 8) * 6.283) * r * f, Math.sin((k / 8) * 6.283) * r * f, cr));
    ok = loop(ring.filter((q) => !blocks.some((b) => Math.hypot(q[0] - b[0], q[1] - b[1]) < b[2] + cr)));
  }
  return ok;
}

/** One frame of a round: stop to stop. Returns "next" at each stop, "parked" if a whole lap went
 *  nowhere (walled in), else null. */
export function roundsStep(a, dt, blocks, maxR, now) {
  if (!a.target) { planWalk(a, a.stops[a.si], blocks, maxR, now, true); a.legFrom = [a.pos[0], a.pos[1]]; }
  if (!walkStep(a, dt, a.speed, blocks, maxR, now)) return null;
  a.si = (a.si + 1) % a.stops.length;
  const went = Math.hypot(a.pos[0] - a.legFrom[0], a.pos[1] - a.legFrom[1]) > a.cr;
  a.failed = went ? 0 : (a.failed || 0) + 1;
  if (a.failed >= a.stops.length) { a.mode = "fixed"; return "parked"; }
  return "next";
}

/**
 * Gait (SPEC §14b): someone held up (a crowd at a narrow gap) stops and waits in an idle pose
 * instead of walking on the spot, then walks on when the way clears. Call once a frame while they
 * are trying to move; returns "wait" or "walk" when the pose should change, else null.
 */
export function gait(m, dt, expected) {
  if (!m.gPrev) { m.gPrev = [m.pos[0], m.pos[1]]; m.gAcc = 0; m.gT = 0; return null; }
  m.gAcc += Math.hypot(m.pos[0] - m.gPrev[0], m.pos[1] - m.gPrev[1]);
  m.gPrev[0] = m.pos[0]; m.gPrev[1] = m.pos[1];
  m.gT += dt;
  if (m.gT < 0.3) return null;
  const v = m.gAcc / m.gT;
  m.gAcc = 0; m.gT = 0;
  if (!m.waiting && v < expected * 0.25) { m.waiting = true; return "wait"; }
  if (m.waiting && v > expected * 0.5) { m.waiting = false; return "walk"; }
  return null;
}
/** Forget the gait (a new walk starts fresh). */
export const gaitReset = (m) => { m.gPrev = null; m.waiting = false; };
