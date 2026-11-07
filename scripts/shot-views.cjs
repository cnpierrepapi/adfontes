// The nation panel's view buttons (dev helper): Plaza, then Meet a citizen twice.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  await p.evaluate(() => window.__live.flyTo(3));
  await p.waitForTimeout(3000);
  const click = async (txt) => { await p.evaluate((t) => [...document.querySelectorAll(".viewbtn")].find((x) => x.textContent.startsWith(t)).click(), txt); };
  await click("Plaza"); await p.waitForTimeout(6000);
  await p.screenshot({ path: "stills/views-1-plaza.png" });
  await click("Meet"); await p.waitForTimeout(2500);
  await p.screenshot({ path: "stills/views-2-citizen.png" });
  await click("Next"); await p.waitForTimeout(4000);
  await p.screenshot({ path: "stills/views-3-next-citizen.png" });
  console.log("who:", await p.textContent(".who"), "| errors:", errs.length ? errs : "none");
  await b.close();
})();
