// Dev check: missed events are kept per nation and replay (with star-gun shots) on fly-in.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4199", id = Number(process.argv[3] || 3);
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => localStorage.setItem("adf-intro-seen", "1")); // the first-visit intro would take the camera
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/live/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__live && window.__live.folk.crowds.size >= window.__live.world.clans.length, null, { timeout: 90000 });
  await p.waitForTimeout(3000);
  console.log("missed per nation:", await p.evaluate(() => JSON.stringify([...window.__live.missed()].map(([k, v]) => [k, v.length, v.map((r) => r.kind[0]).join("")]))));
  await p.evaluate((id) => window.__live.flyTo(id), id);
  let shots = 0;
  for (let t = 0; t < 40; t++) {
    await p.waitForTimeout(1000);
    const st = await p.evaluate(() => ({ strip: document.querySelector(".replay")?.hidden ? null : document.querySelector(".replay span")?.textContent, guns: window.__live.folk.shots.length, aiming: [...(window.__live.folk.crowds.get(window.__live.world.clans[0] && 0) ? [] : [])].length }));
    shots = Math.max(shots, st.guns);
    if (t % 3 === 0 || t < 3) console.log(`${t}s`, st.strip ?? "(no strip)", "| star shots in the air:", st.guns);
    if (t === 14) await p.screenshot({ path: "stills/replay.png" });
  }
  console.log("max star shots in flight at once:", shots, "| left to replay:", await p.evaluate((id) => window.__live.missed().get(id)?.length ?? 0, id));
  console.log("errors:", errs.length ? errs.slice(0, 5) : "none");
  await b.close();
})();
