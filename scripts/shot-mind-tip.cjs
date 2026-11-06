// Close-up of a nation's line tip and scrolls (dev helper).
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
const id = Number(process.argv[3] || 3);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.evaluate((i) => window.__live.flyTo(i), id);
  await p.waitForTimeout(2600);
  await p.evaluate((i) => {
    const L = window.__live, m = L.minds.get(i);
    const line = m.layout.at, tipName = [...line.keys()].pop();
    const chainTip = [...line.values()].filter((x) => x.node.kind === "owned").sort((a, b) => b.level - a.level)[0].pos.clone();
    m.group.localToWorld(chainTip);
    const cam = L.camera.position.clone();
    const dir = cam.sub(chainTip).normalize().multiplyScalar(6);
    L.controls.setLookAt(chainTip.x + dir.x, chainTip.y + dir.y, chainTip.z + dir.z, chainTip.x, chainTip.y, chainTip.z, false);
  }, id);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `stills/mind-tip-${id}.png` });
  await b.close();
})();
