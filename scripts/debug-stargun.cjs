const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://localhost:4198/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  await p.evaluate(() => window.__live.flyTo(3));
  await p.waitForTimeout(9000);
  await p.evaluate(() => {
    const L = window.__live, cr = L.folk.crowds.get(3), sch = cr.people.find((q) => q.a.role === "Scholar");
    const m = L.minds.get(3);
    const pt = [...m.layout.at.values()].filter((x) => x.node.kind === "owned").sort((a, b) => b.level - a.level)[0].node.point;
    window.__sch = sch;
    L.fx.play({ kind: "corpus", clan: 3, scholar: sch.a.name, point: pt, title: "t", cites: 9, fake: 0 });
  });
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(700);
    console.log(await p.evaluate(() => { const s = window.__sch; return `${s.mode}/${s.phase} pos ${s.pos.map((v) => v.toFixed(2))} target ${s.target?.map((v) => v.toFixed(2))} r ${s.r.toFixed(2)} s ${s.s.toFixed(2)} gun ${!!s.gun?.parent} q ${s.queue?.length}`; }));
  }
  console.log("errors", errs);
  await b.close();
})();
