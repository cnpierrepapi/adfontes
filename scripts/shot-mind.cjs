// Stills of the mind constellations (dev helper). Usage: node scripts/shot-mind.cjs [baseUrl]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: "stills/mind-0-world.png" });
  for (const id of [3, 2, 1, 4]) {
    await p.evaluate((i) => window.__live.flyTo(i), id);
    await p.waitForTimeout(3200);
    await p.screenshot({ path: `stills/mind-${id}.png` });
  }
  // Hover the brightest star of nation 3 to check the card.
  await p.evaluate(() => window.__live.flyTo(3));
  await p.waitForTimeout(3000);
  const xy = await p.evaluate(() => {
    const m = window.__live.minds.get(3), cam = window.__live.camera;
    const L = m.layout, line = [...L.at.values()].sort((a, b) => b.level - a.level)[0];
    const v = line.pos.clone(); m.group.localToWorld(v); v.project(cam);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  });
  await p.mouse.move(xy[0], xy[1]);
  await p.waitForTimeout(400);
  await p.screenshot({ path: "stills/mind-hover.png" });
  console.log("errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
