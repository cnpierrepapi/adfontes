// Dump one island's walking layout to a file, for scripts/walk-sim.mjs (no 3D needed after this).
// Usage: node scripts/walk-dump.cjs <page url> <nation id> <out.json>
const { chromium } = require(process.cwd() + "/node_modules/playwright");
const fs = require("fs");
const [url, idArg, out] = process.argv.slice(2);
const id = Number(idArg);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(url, { waitUntil: "load" });
  await p.waitForFunction(() => window.__live, null, { timeout: 90e3 });
  await p.evaluate((i) => window.__live.viewPlaza(i), id);
  await p.waitForFunction((i) => (window.__live.folk.crowds.get(i)?.people.length ?? 0) > 0, id, { timeout: 150e3 });
  const data = await p.evaluate((i) => {
    const cr = window.__live.folk.crowds.get(i), L = cr.life, isl = window.__live.islands.get(i);
    const r = isl.userData.r;
    const scenes = Object.fromEntries(Object.entries(L.scenes).map(([k, sc]) => [k, { x: sc.x, z: sc.z, visit: sc.visit ? { x: sc.visit.x, z: sc.visit.z } : null }]));
    return {
      id: i, name: isl.userData.clan?.name, r, s: cr.people[0]?.s, blocks: L.blocks.map((b) => [...b]), scenes,
      stations: [...L.stations.entries()].map(([role, sp]) => [role, sp.map((q) => ({ x: q.x, z: q.z }))]),
      people: cr.people.map((q) => ({ role: q.a.role, name: q.a.name, pos: [...q.pos], cr: q.cr, station: q.station ? [...q.station] : null })),
      actors: L.actors.map((a) => ({ mode: a.mode, pos: [...a.pos], cr: a.cr, k: a.k, speed: a.speed ?? null, stops: a.stops ? a.stops.map((s) => [...s]) : null, night: !!a.night, hurry: !!a.hurry, cx: a.cx ?? null, cz: a.cz ?? null, rad: a.rad ?? null })),
    };
  }, id);
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`dumped ${data.name}: r ${data.r.toFixed(2)}, ${data.blocks.length} footprints, ${Object.keys(data.scenes).length} scenes, ${data.people.length} citizens, ${data.actors.length} townsfolk -> ${out}`);
  await b.close();
})().catch((e) => { console.log("FAILED", String(e).slice(0, 300)); process.exit(1); });
