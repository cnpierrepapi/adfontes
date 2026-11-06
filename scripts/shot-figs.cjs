// Screenshot each figure block on a stills page separately (dev helper).
// Usage: node scripts/shot-figs.cjs [page.html] [prefix]
const { chromium } = require("playwright");
const page = process.argv[2] || "figs.html";
const prefix = process.argv[3] || "fig";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 560, height: 1400 } });
  await p.goto(`file:///C:/Users/user/adfontes/stills/${page}`);
  const els = await p.locator("body > div").all();
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `stills/${prefix}${i + 1}.png` });
  console.log(`${els.length} figures -> stills/${prefix}1..${els.length}.png`);
  await b.close();
})();
