// Citizens on islands (dev helper): world view dots, then flown in to a nation.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
const id = Number(process.argv[3] || 3);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`${base}/live/?stills&theme=${process.env.THEME || "night"}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: "stills/folk-0-world.png" });
  await p.evaluate((i) => window.__live.flyTo(i), id);
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `stills/folk-1-nation${id}.png` });
  // Closer: a three-quarter view of the plaza from just above the houses.
  const n = await p.evaluate((i) => window.__live.folk.crowds.get(i)?.people.length ?? -1, id);
  await p.evaluate((i) => { const L = window.__live, isl = L.folk.crowds.get(i).group.parent.parent; const v = isl.getWorldPosition(new isl.position.constructor()); const r = isl.userData.r; L.controls.setLookAt(v.x + r * 1.5, v.y + r * 0.9, v.z + r * 1.5, v.x, v.y + r * 0.08, v.z, false); }, id);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `stills/folk-2-plaza${id}.png` });
  console.log("citizens:", n, "| errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
