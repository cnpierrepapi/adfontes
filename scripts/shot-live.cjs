// Stills of the live world (dev helper). Usage: node scripts/shot-live.cjs [baseUrl]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://127.0.0.1:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: "stills/live-1-home.png" });
  await p.evaluate(() => window.__live.flyTo(2));
  await p.waitForTimeout(2200);
  await p.screenshot({ path: "stills/live-2-clan2.png" });
  await p.evaluate(() => window.__live.flyTo(3));
  await p.waitForTimeout(700);
  await p.screenshot({ path: "stills/live-3-midflight.png" });
  await p.waitForTimeout(1800);
  await p.screenshot({ path: "stills/live-4-clan3.png" });
  console.log("errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
