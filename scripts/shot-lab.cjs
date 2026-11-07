// Still of the citizens lab page (dev helper).
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`http://localhost:4198/lab/citizens.html${process.argv[3] ? "?close=" + process.argv[3] : ""}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(Number(process.argv[2] || 2500));
  await p.screenshot({ path: `stills/lab-citizens${process.argv[3] ? "-close" + process.argv[3] : ""}.png` });
  console.log("errors:", errs.length ? errs.slice(0, 5) : "none");
  await b.close();
})();
