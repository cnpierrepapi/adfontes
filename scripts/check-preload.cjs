// Dev check: citizens are built before any fly-in, and the god panel chip is there.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => localStorage.setItem("adf-intro-seen", "1")); // the first-visit intro would take the camera
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const t0 = Date.now();
  await p.goto(`${base}/live/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__live, null, { timeout: 60000 }).catch(async (e) => { console.log("never loaded; errors:", errs); await b.close(); process.exit(1); });
  for (let i = 0; i < 40; i++) {
    const n = await p.evaluate(() => window.__live.folk.crowds.size);
    if (i % 4 === 0) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s crowds built: ${n} of ${await p.evaluate(() => window.__live.world.clans.length)}`);
    if (n >= await p.evaluate(() => window.__live.world.clans.length)) break;
    await p.waitForTimeout(500);
  }
  await p.evaluate(() => window.__live.flyTo(3));
  await p.waitForTimeout(1600);
  console.log("people at Carbon Choir right after the fly-in:", await p.evaluate(() => window.__live.folk.crowds.get(3)?.people.length), "visible:", await p.evaluate(() => window.__live.folk.crowds.get(3)?.group.visible));
  console.log("wallet chip:", await p.evaluate(() => document.querySelector(".chip.wallet")?.textContent));
  console.log("panel powers:", await p.evaluate(() => document.querySelector(".powers")?.innerText.replace(/\n/g, " | ")));
  await p.waitForFunction(() => window.__gods, null, { timeout: 30000 });
  console.log("encode a whisper proposal like a wallet would:", await p.evaluate(async () => {
    try { return "ok, " + await window.__gods.wallet.encodeCheck({ receiver: "dao.testnet", method: "add_proposal", args: { proposal: { description: "x", kind: { FunctionCall: { receiver_id: "w.testnet", actions: [] } } } }, deposit: 10n ** 22n, gas: 5n * 10n ** 13n }) + " bytes"; } catch (e) { return "FAILED: " + e.message; }
  }));
  await p.screenshot({ path: "stills/preload-flyin.png" });
  console.log("errors:", errs.length ? errs.slice(0, 6) : "none");
  await b.close();
})();
