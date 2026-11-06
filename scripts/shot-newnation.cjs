// Home view with every nation, then a nation founded while you watch (dev helper).
// The first /api/world answer hides the newest nation; the 30 s poll then "finds" it.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const errs = [];
  for (const [w, h] of [[1440, 810], [1280, 720], [1920, 1080]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`${base}/live/?stills&theme=${process.env.THEME || "night"}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(3000);
    await p.screenshot({ path: `stills/home-${w}.png` });
    await p.close();
  }
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  p.on("pageerror", (e) => errs.push(e.message));
  let first = true;
  await p.route("**/api/world", async (route) => {
    const res = await route.fetch(); const j = await res.json();
    if (first) { first = false; const max = Math.max(...j.clans.map((c) => c.id)); j.clans = j.clans.filter((c) => c.id !== max); }
    await route.fulfill({ response: res, json: j });
  });
  await p.goto(`${base}/live/?stills&theme=${process.env.THEME || "night"}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: "stills/new-0-before.png" });
  await p.waitForTimeout(31000);
  await p.screenshot({ path: "stills/new-1-rising.png" });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: "stills/new-2-landed.png" });
  console.log("errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
