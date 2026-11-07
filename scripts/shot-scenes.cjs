// Close stills of each role scene on a nation (dev helper): node scripts/shot-scenes.cjs [base] [theme] [id]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198", theme = process.argv[3] || "day", id = +(process.argv[4] || 3);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/?stills&theme=${theme}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.evaluate((id) => window.__live.viewPlaza(id), id);
  await p.waitForTimeout(8000);
  const roles = await p.evaluate((id) => Object.keys(window.__live.folk.crowds.get(id)?.life.scenes || {}), id);
  for (const role of roles) {
    await p.evaluate(([id, role]) => {
      const L = window.__live, sc = L.folk.crowds.get(id).life.scenes[role];
      const g = sc.obj.parent, c = g.getWorldPosition(new L.camera.position.constructor());
      const fwd = new L.camera.position.constructor(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y)); // the scene's front
      const s = sc.obj.scale.x, d = c.clone().addScaledVector(fwd, s * 4.2).setY(c.y + s * 3.6);
      L.controls.setLookAt(d.x, d.y, d.z, c.x, c.y + s * 0.8, c.z, false);
    }, [id, role]);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `stills/scene-${theme}-${id}-${role}.png` });
    console.log("shot", role);
  }
  console.log("errors:", errs.length ? errs.slice(0, 6) : "none");
  await b.close();
})();
