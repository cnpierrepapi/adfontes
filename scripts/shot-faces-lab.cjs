// Still of the face lineup in the citizens lab (dev helper). Usage: node scripts/shot-faces-lab.cjs [n] [night]
const { chromium } = require("playwright");
(async () => {
  const n = process.argv[2] || 7, night = process.argv[3] === "night" ? "&night=1" : "", off = process.argv[4] || 0, y = process.argv[5] || 1.6;
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1600, height: 600 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`http://localhost:4198/lab/citizens.html?faces=${n}&off=${off}&y=${y}${night}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: `stills/faces-lab${night ? "-night" : ""}-${off}-${y}.png` });
  console.log("errors:", errs.length ? errs.slice(0, 5) : "none");
  await b.close();
})();
