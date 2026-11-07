// First-visit check (dev helper): click "Meet a citizen" the moment the panel opens, while the
// citizen kit is still loading; the camera must end up close to that citizen.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__live.flyTo(2));
  await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll(".viewbtn")].find((x) => x.textContent.startsWith("Meet")).click());
  await p.waitForTimeout(9000);
  const d = await p.evaluate(() => {
    const L = window.__live, cr = L.folk.crowds.get(2), name = document.querySelector(".who").textContent.split(",")[0];
    const who = cr.people.find((q) => q.a.name === name);
    const v = who.c.root.getWorldPosition(L.camera.position.clone());
    return { name, inScene: !!who.c.root.parent, dist: +L.camera.position.distanceTo(v).toFixed(2) };
  });
  await p.screenshot({ path: "stills/views-cold.png" });
  console.log(JSON.stringify(d), "| errors:", errs.length ? errs : "none");
  await b.close();
})();
