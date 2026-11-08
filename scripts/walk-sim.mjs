// Walk simulator (SPEC §14b): replays a town's movement from a dumped layout with the SAME code the
// site runs (src/live/steer.js), no 3D. Minutes of town life in seconds, the numbers, and a
// top-down map of footprints, trails and trouble spots.
// Usage: node scripts/walk-sim.mjs <layout.json> [seconds=600] [--night] [--png out.png]
import fs from "node:fs";
import { planWalk, walkStep, separate, makeOpen, checkRounds, roundsStep, gait, gaitReset } from "../src/live/steer.js";

const args = process.argv.slice(2);
const L = JSON.parse(fs.readFileSync(args[0], "utf8"));
const SECS = Number(args[1]) || 600, NIGHT = args.includes("--night");
const pngOut = args.includes("--png") ? args[args.indexOf("--png") + 1] : null;
const { r, blocks } = L, maxR = r * 0.88, open = makeOpen(blocks, r);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// --- movers, as the site makes them ---
const movers = [];
for (const p of L.people) movers.push({ kind: `citizen ${p.role}`, name: p.name, pos: [...p.pos], cr: p.cr, station: p.station, mode: "idle", until: 0, speed: r * 0.09, trail: [] });
for (const a of L.actors) {
  if (a.night && !NIGHT) continue; // the watchman only walks at night
  const m = { kind: `townsperson ${a.mode}`, pos: [...a.pos], cr: a.cr, mode: a.mode, speed: a.speed ?? r * 0.07 * (a.k ?? 1), stops: a.stops, si: 1, until: 0, cx: a.cx, cz: a.cz, rad: a.rad, ang: 0, trail: [] };
  if (m.stops) { const ok = checkRounds(m.stops, blocks, m.cr, r, open); if (ok) { m.stops = ok; m.si = 1 % ok.length; m.pos = [...ok[0]]; } else m.mode = "fixed"; }
  movers.push(m);
}

// --- the numbers ---
const T = { looks: 0, inside: 0, insideBy: {}, overlaps: 0, onSpot: 0, onSpotBy: {}, walkSamples: 0, parked: 0 };
const marks = []; // trouble spots for the map
const dt = 1 / 30;
let lastLook = 0, prevPos = new Map();
for (let f = 0, now = 0; now < SECS; f++, now += dt) {
  for (const m of movers) {
    if (m.mode === "fixed") continue;
    if (m.mode === "ring") { m.ang += dt * 0.06; m.pos = [m.cx + Math.cos(m.ang) * m.rad, m.cz + Math.sin(m.ang) * m.rad]; continue; }
    if (m.mode === "rounds") { if (roundsStep(m, dt, blocks, maxR, now) === "parked") T.parked++; else gait(m, dt, m.speed); continue; }
    // citizens and strollers: rest, then go somewhere (citizens: their station half the time)
    if (m.mode !== "walk" && now >= m.until) {
      const toWork = m.station && rnd() < 0.5;
      const ang = rnd() * 6.28, rad = r * (0.3 + rnd() * 0.45);
      planWalk(m, toWork ? m.station : open(Math.cos(ang) * rad, Math.sin(ang) * rad, m.cr), blocks, maxR, now, !toWork);
      m.mode = "walk"; m.atWork = toWork;
    }
    if (m.mode === "walk") {
      if (walkStep(m, dt, m.speed, blocks, maxR, now)) { m.mode = "stay"; m.until = now + 3 + rnd() * 6; gaitReset(m); }
      else gait(m, dt, m.speed);
    }
  }
  separate(movers.map((m) => ({ ref: m, pos: m.pos, cr: m.cr, strict: m.strict, target: m.target, hold: m.mode === "fixed" || m.mode === "ring" || (m.mode === "stay" && m.atWork) })), blocks, maxR);
  if (f % 6 === 0) for (const m of movers) m.trail.push([...m.pos]);
  // a look every 0.4 s, like the browser check
  if (now - lastLook >= 0.4) {
    lastLook = now; T.looks++;
    for (const m of movers) {
      if (m.mode === "fixed" || m.mode === "ring") continue;
      const skip = m.strict ? [] : [m.target, m.station, m.from, m.legs?.at?.(-1)];
      const inB = blocks.find((b) => !skip.some((t) => t && Math.hypot(t[0] - b[0], t[1] - b[1]) < b[2] + m.cr) && Math.hypot(m.pos[0] - b[0], m.pos[1] - b[1]) < b[2] + m.cr * 0.5 - 1e-4);
      if (inB) { T.inside++; T.insideBy[m.kind] = (T.insideBy[m.kind] || 0) + 1; marks.push(["inside", ...m.pos]); }
      const walking = (m.mode === "walk" || m.mode === "rounds") && !m.waiting; // waiting = idle pose, not walking
      const q = prevPos.get(m);
      if (walking && q) {
        T.walkSamples++;
        if (Math.hypot(m.pos[0] - q[0], m.pos[1] - q[1]) < m.cr * 0.05) { T.onSpot++; T.onSpotBy[m.kind] = (T.onSpotBy[m.kind] || 0) + 1; marks.push(["spot", ...m.pos]); }
      }
      prevPos.set(m, [...m.pos]);
    }
    for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i], b = movers[j];
      if ((a.mode === "fixed" || a.mode === "ring") && (b.mode === "fixed" || b.mode === "ring")) continue;
      if (Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < (a.cr + b.cr) * 0.6) { T.overlaps++; marks.push(["overlap", (a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2]); }
    }
  }
}
console.log(`${L.name}, ${SECS} s ${NIGHT ? "at night" : "by day"} (${movers.length} movers, ${T.looks} looks):`);
console.log(`  inside a building: ${T.inside}`, JSON.stringify(T.insideBy));
console.log(`  bodies overlapping: ${T.overlaps}`);
console.log(`  walking on the spot: ${T.onSpot} of ${T.walkSamples}`, JSON.stringify(T.onSpotBy));
console.log(`  rounds parked (walled in): ${T.parked}`);

// --- the map: footprints, trails, trouble ---
if (pngOut) {
  const S = 220 / r, W = 2 * r * S + 40, X = (x) => 20 + (x + r) * S;
  const names = Object.fromEntries(Object.entries(L.scenes).map(([k, v]) => [`${v.x.toFixed(3)},${v.z.toFixed(3)}`, k]));
  const col = (k) => (k.startsWith("citizen") ? "#2a7fff" : k.includes("rounds") ? "#ff8a00" : "#22a36b");
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" style="background:#f6f1e3;font:11px sans-serif">`,
    `<circle cx="${X(0)}" cy="${X(0)}" r="${r * S}" fill="#efe3c4" stroke="#b9a77a"/>`,
    `<circle cx="${X(0)}" cy="${X(0)}" r="${maxR * S}" fill="none" stroke="#b9a77a" stroke-dasharray="4 4"/>`,
    ...blocks.map((b) => { const nm = names[`${b[0].toFixed(3)},${b[1].toFixed(3)}`]; return `<circle cx="${X(b[0])}" cy="${X(b[1])}" r="${b[2] * S}" fill="${nm ? "#c9b8f0" : "#d9cfc0"}" fill-opacity="0.75" stroke="#7a6a9a"/>` + (nm ? `<text x="${X(b[0])}" y="${X(b[1]) + 4}" text-anchor="middle" fill="#3d2f6a">${nm}</text>` : ""); }),
    ...movers.map((m) => `<polyline fill="none" stroke="${col(m.kind)}" stroke-opacity="0.45" stroke-width="1.4" points="${m.trail.map(([x, z]) => `${X(x).toFixed(1)},${X(z).toFixed(1)}`).join(" ")}"/>`),
    ...movers.filter((m) => m.stops).flatMap((m) => m.stops.map(([x, z], i) => `<circle cx="${X(x)}" cy="${X(z)}" r="4" fill="#ff8a00"/><text x="${X(x) + 5}" y="${X(z) - 4}" fill="#a85a00">${i}</text>`)),
    ...marks.slice(0, 400).map(([k, x, z]) => `<circle cx="${X(x)}" cy="${X(z)}" r="3.5" fill="${k === "spot" ? "#ff1f6e" : k === "inside" ? "#000" : "#ff00ff"}"/>`),
    `<text x="10" y="${W - 8}" fill="#555">blue citizens · green townsfolk · orange watchman + his stops · red walked on the spot · black inside a building · magenta overlap · purple scenes</text>`,
    `</svg>`].join("");
  fs.writeFileSync(pngOut.replace(/\.png$/, ".svg"), svg);
  const { chromium } = await import("playwright");
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: Math.ceil(W), height: Math.ceil(W) } });
  await pg.setContent(svg); await pg.screenshot({ path: pngOut }); await b.close();
  console.log(`  map: ${pngOut}`);
}
