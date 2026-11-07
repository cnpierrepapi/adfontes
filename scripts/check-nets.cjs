// Dev check: the site opens in both worlds (testnet / mainnet), the switch says which, no errors.
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4301";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  for (const net of ["mainnet", "testnet"]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/favicon|404/.test(m.text()) && errs.push(m.text()));
    await p.goto(`${base}/live/?net=${net}`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__live && window.__gods, null, { timeout: 60000 });
    await p.evaluate(() => window.__live.flyTo(window.__live.world.clans.find((c) => c.alive !== false).id));
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => ({ chip: document.getElementById("net").textContent, dial: document.getElementById("dial").textContent, world: window.__live.world.world, nations: window.__live.world.clans.map((c) => c.name), panel: document.querySelector(".powers")?.innerText.replace(/\n+/g, " | ").slice(0, 200), wallets: null }));
    console.log(net, JSON.stringify(r));
    await p.screenshot({ path: `stills/net-${net}.png` });
    console.log("  errors:", errs.length ? errs.slice(0, 4) : "none");
    await p.close();
  }
  await b.close();
})();
