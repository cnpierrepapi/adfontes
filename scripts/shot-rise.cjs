// Stills of the founding animation (dev helper). Usage: node scripts/shot-rise.cjs [baseUrl] [nationId]
const { chromium } = require("playwright");
const base = process.argv[2] || "https://adfontes.fun", id = Number(process.argv[3] || 3);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.evaluate((i) => window.__live.riseNation(i), id);
  let last = 0;
  for (const [ms, name] of [[1000, "a"], [2500, "b"], [4000, "c"], [6500, "d"]]) {
    await p.waitForTimeout(ms - last); last = ms;
    await p.screenshot({ path: `stills/rise-${name}.png` });
  }
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})();
