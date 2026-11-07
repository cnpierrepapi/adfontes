// Plaza stills of nations (dev helper): node scripts/shot-town.cjs [base] [theme] [ids...]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198", theme = process.argv[3] || "day";
const ids = process.argv.slice(4).map(Number);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`${base}/live/?stills&theme=${theme}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  for (const id of ids.length ? ids : [2, 3, 4]) {
    await p.evaluate((id) => window.__live.flyTo(id), id);
    await p.waitForTimeout(1500);
    await p.evaluate(() => [...document.querySelectorAll(".viewbtn")].find((x) => x.textContent === "Plaza").click());
    await p.waitForTimeout(9000);
    await p.screenshot({ path: `stills/town-${theme}-${id}.png` });
    console.log("shot", id);
  }
  console.log("errors:", errs.length ? errs.slice(0, 6) : "none");
  await b.close();
})();
