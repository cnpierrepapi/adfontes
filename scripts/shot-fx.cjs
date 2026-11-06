// Stills of each world effect, fired on demand (dev helper). Usage: node scripts/shot-fx.cjs [baseUrl]
const { chromium } = require("playwright");
const base = process.argv[2] || "https://adfontes.fun";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  const fire = (recs, wait, name) => p.evaluate((r) => r.forEach((x) => window.__live.fx.play(x)), recs).then(() => p.waitForTimeout(wait)).then(() => p.screenshot({ path: `stills/fx-${name}.png` }));
  await fire([{ kind: "trade", buyer: 2, seller: 3, point: "metal-organic frameworks", price: 0.03 }, { kind: "trade", buyer: 3, seller: 2, point: "photovoltaics", price: 0.02 }], 1100, "1-trades");
  await fire([{ kind: "gift", clan: 3, title: "Porosity monitor", passed: true }, { kind: "gift", clan: 2, title: "Rushed module", passed: false }], 1600, "2-gifts");
  await fire([{ kind: "corpus", clan: 2, scholar: "Uma Novak", point: "hole transport layer", cites: 12, fake: 0 }, { kind: "warden", clan: 3, bounty: 0.02 }], 1300, "3-corpus-warden");
  await fire([{ kind: "trickster", clan: 3, name: "Zora Ulloa" }, { kind: "absorb", clan: 2, via: ["energy storage"], points: ["a", "b", "c"] }], 1200, "4-trickster-absorb");
  console.log("errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
