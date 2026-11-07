// Close-up of citizens' faces on the live world (dev helper): Meet a citizen, step through a few, still each.
// Usage: node scripts/shot-faces.cjs [base] [theme]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
const theme = process.argv[3] || "night", nid = +(process.argv[4] || 4);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/?stills&theme=${theme}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.evaluate((nid) => window.__live.flyTo(nid), nid);
  await p.waitForTimeout(6000);
  const meet = () => p.evaluate(() => [...document.querySelectorAll(".viewbtn")].find((x) => /^(Meet|Next)/.test(x.textContent)).click());
  for (let i = 0; i < 6; i++) {
    await meet();
    await p.waitForTimeout(4500);
    const who = await p.evaluate(() => document.querySelector(".who")?.textContent);
    await p.screenshot({ path: `stills/face-${theme}-${i}.png` });
    console.log(i, who);
  }
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})();
