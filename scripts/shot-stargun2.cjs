// Star-gun flight check (dev helper): the Scholar is placed in the open on the camera's side,
// fires, and frames are taken through the flight; then a misfire.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
const id = Number(process.argv[3] || 3);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  await p.evaluate((i) => window.__live.flyTo(i), id);
  await p.waitForTimeout(9000);
  const shoot = (fake) => p.evaluate(([i, fake]) => {
    const L = window.__live, cr = L.folk.crowds.get(i), sch = cr.people.find((q) => q.a.role === "Scholar");
    const isl = cr.group.parent.parent, ip = isl.getWorldPosition(new isl.position.constructor()), r = isl.userData.r;
    // Camera: the island's open south-west, the sky above it.
    const cam = L.camera.position, dx = cam.x - ip.x, dz = cam.z - ip.z, d = Math.hypot(dx, dz);
    // Put the Scholar on the camera's side of the plaza, out in the open.
    const local = cr.group.worldToLocal(new isl.position.constructor(ip.x + (dx / d) * r * 0.45, ip.y, ip.z + (dz / d) * r * 0.45));
    sch.pos = sch.open(local.x, local.z); sch.mode = "stay"; sch.until = 1e12;
    window.__sch = sch;
    const m = L.minds.get(i);
    const pt = [...m.layout.at.values()].filter((x) => x.node.kind === "owned").sort((a, b) => b.level - a.level)[0].node.point;
    L.fx.play({ kind: "corpus", clan: i, scholar: sch.a.name, point: fake ? "x" : pt, title: "t", cites: 9, fake: fake ? 1 : 0 });
    return pt;
  }, [id, fake]);
  const waitPhase = async (want) => { for (let k = 0; k < 250; k++) { if ((await p.evaluate(() => `${window.__sch.mode}/${window.__sch.phase}`)) === want) return true; await p.waitForTimeout(80); } return false; };
  const pt = await shoot(false);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: "stills/gun2-1-carry.png" });
  console.log("aim", await waitPhase("gun/aim"));
  await p.waitForTimeout(900);
  await p.screenshot({ path: "stills/gun2-2-aim.png" });
  console.log("fire", await waitPhase("gun/fire"));
  for (const [ms, n] of [[250, "3-flight-a"], [450, "4-flight-b"], [900, "5-landed"]]) {
    await p.waitForTimeout(ms);
    console.log(n, await p.evaluate(() => { const L = window.__live; return L.folk.shots.map((sh) => { const v = sh.head.position.clone().project(L.camera); return `shot at screen ${((v.x + 1) * 720).toFixed(0)},${((1 - v.y) * 405).toFixed(0)}`; }).join(" ") || "no shot in flight"; }));
    await p.screenshot({ path: `stills/gun2-${n}.png` });
  }
  await p.waitForTimeout(2500);
  await shoot(true);
  console.log("misfire", await waitPhase("gun/fire"));
  for (const [ms, n] of [[650, "6-misfire"], [450, "7-misfire-fall"]]) { await p.waitForTimeout(ms); await p.screenshot({ path: `stills/gun2-${n}.png` }); }
  console.log("point", pt, "| errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
