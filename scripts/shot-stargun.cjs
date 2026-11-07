// Star-gun sequence (dev helper): a Scholar of nation <id> carries, aims and fires a star, then a
// misfire. The camera follows the Scholar; each still is taken when that phase starts.
// Usage: node scripts/shot-stargun.cjs [baseUrl] [nationId]
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
  await p.waitForTimeout(3000);
  await p.evaluate((i) => window.__live.flyTo(i), id);
  await p.waitForTimeout(9000);
  // Follow the Scholar: camera beside and a little below their head height, looking up past them.
  // From the open sea side (outside the island, so no tower or tree between us), close or wide.
  const follow = (wide = false) => p.evaluate((wide) => {
    const L = window.__live, s = window.__sch, v = s.c.root.getWorldPosition(new s.c.root.position.constructor());
    const out = Math.hypot(v.x - s.isl.x, v.z - s.isl.z) || 1, dx = (v.x - s.isl.x) / out, dz = (v.z - s.isl.z) / out;
    const k = wide ? 3.2 : 1, side = 0.9 * k, back = 2.4 * k;
    L.controls.setLookAt(v.x + dx * back - dz * side, v.y + (wide ? 1.6 : 0.7), v.z + dz * back + dx * side, v.x, v.y + (wide ? 3.2 : 0.75), v.z, false);
  }, wide);
  const fire = (fake) => p.evaluate(([i, fake]) => {
    const L = window.__live, cr = L.folk.crowds.get(i);
    const sch = cr.people.find((q) => q.a.role === "Scholar");
    const isl = cr.group.parent.parent, ip = isl.getWorldPosition(new isl.position.constructor());
    window.__sch = Object.assign(sch, { isl: ip });
    const m = L.minds.get(i);
    const pt = [...m.layout.at.values()].filter((x) => x.node.kind === "owned").sort((a, b) => b.level - a.level)[0].node.point;
    L.fx.play({ kind: "corpus", clan: i, scholar: sch.a.name, point: fake ? "x" : pt, title: "t", cites: 9, fake: fake ? 1 : 0 });
    return { scholar: sch.a.name, point: pt };
  }, [id, fake]);
  const phase = () => p.evaluate(() => `${window.__sch.mode}/${window.__sch.phase}`);
  async function until(want, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await phase()) === want) return true; await follow(); await p.waitForTimeout(100); }
    return false;
  }
  const info = await fire(false);
  await p.waitForTimeout(1200); await follow(); await p.waitForTimeout(150);
  await p.screenshot({ path: "stills/gun-1-carry.png" });
  console.log("aim reached:", await until("gun/aim"));
  await p.waitForTimeout(800); await follow();
  await p.screenshot({ path: "stills/gun-2-aim.png" });
  console.log("fire reached:", await until("gun/fire"));
  await follow(true);
  await p.waitForTimeout(450);
  await p.screenshot({ path: "stills/gun-3-fire.png" });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: "stills/gun-4-landed.png" });
  await p.waitForTimeout(2500);
  await fire(true);
  console.log("misfire fire reached:", await until("gun/fire"));
  await follow(true);
  await p.waitForTimeout(800);
  await p.screenshot({ path: "stills/gun-5-misfire.png" });
  await p.waitForTimeout(700);
  await p.screenshot({ path: "stills/gun-6-misfire-fall.png" });
  console.log(JSON.stringify(info), "| errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
