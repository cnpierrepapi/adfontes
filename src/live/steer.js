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
  let nx = pos[0] + dx * s, nz = pos[1] + dz * s;
  // Never inside a footprint: push straight out of any circle we ended up in.
  // Repeat: where two footprints overlap, leaving one can put us in the other.
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const b of blocks) {
      if (holdsTarget(b)) continue;
      const R = b[2] + rad, ox = nx - b[0], oz = nz - b[1], d = Math.hypot(ox, oz);
      if (d < R - 1e-9 && d > 1e-6) { nx = b[0] + (ox / d) * (R + 1e-6); nz = b[1] + (oz / d) * (R + 1e-6); moved = true; }
    }
    if (!moved) break;
  }
  const len = Math.hypot(nx, nz);
  if (len > maxR) { nx *= maxR / len; nz *= maxR / len; }
  return [nx, nz];
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
  const g = new Float32Array(n * n).fill(Infinity), came = new Int32Array(n * n).fill(-1);
  const heap = [];
  const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const h = (i, j) => Math.hypot(i - ti, j - tj);
  const s0 = si * n + sj, goal = ti * n + tj;
  g[s0] = 0; push(s0, h(si, sj));
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  while (heap.length) {
    const [, k] = pop();
    if (k === goal) { found = true; break; }
    const i = Math.floor(k / n), j = k % n;
    for (const [di, dj, w] of D) {
      const a = i + di, b = j + dj;
      if (!ok(a, b)) continue;
      const kk = a * n + b, ng = g[k] + w;
      if (ng < g[kk]) { g[kk] = ng; came[kk] = k; push(kk, ng + h(a, b)); }
    }
  }
  if (!found) return [to]; // walled in: steer() still keeps them out of buildings
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
}

/**
 * One frame of walking along the planned route at `speed` (units per second). Updates m.pos and
 * m.heading; returns true on arrival (or after 30 s, so nobody is ever stuck for good).
 */
export function walkStep(m, dt, speed, blocks, maxR, now) {
  if (!m.target) return true;
  const step = speed * dt;
  if (m.legs.length > 1 && Math.hypot(m.legs[0][0] - m.pos[0], m.legs[0][1] - m.pos[1]) < Math.max(0.05, step * 1.5)) m.legs.shift();
  const np = steer(m.pos, m.legs[0], step, blocks, m.cr ?? 0.1, maxR, m.strict);
  const dx = np[0] - m.pos[0], dz = np[1] - m.pos[1];
  m.pos[0] = np[0]; m.pos[1] = np[1];
  if (Math.hypot(dx, dz) > 1e-6) m.heading = Math.atan2(dx, dz);
  const done = Math.hypot(m.target[0] - m.pos[0], m.target[1] - m.pos[1]) < 0.03 || now - (m.walkT0 ?? now) > 30;
  if (done) { m.target = null; m.legs = null; }
  return done;
}

/** Turn a three.js object toward `heading`, smoothly. */
export function turnToward(obj, heading, dt, rate = 6) {
  if (heading == null) return;
  obj.rotation.y += Math.atan2(Math.sin(heading - obj.rotation.y), Math.cos(heading - obj.rotation.y)) * Math.min(1, dt * rate);
}

/** True if (x, z) sits inside any block (for tests and checks). */
export const insideAny = (x, z, blocks, rad = 0) => blocks.some((b) => Math.hypot(x - b[0], z - b[1]) < b[2] + rad - 1e-6);
