// Weather sound check (dev helper): silent until the first tap, the week's mix fades in,
// a new day crossfades, the chip mutes. Usage: node scripts/test-sound.cjs [baseUrl]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4198";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=user-gesture-required"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = [], fails = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("response", (r) => r.url().includes("/sound/") && r.status() !== 200 && fails.push(r.url() + " " + r.status()));
  await p.goto(`${base}/live/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const st = () => p.evaluate(() => window.__sound.state());
  console.log("before tap:", JSON.stringify(await st()), "| chip:", await p.textContent("#sound"), "| kind:", await p.evaluate(() => window.__sound.kind));
  await p.mouse.click(700, 500);
  await p.waitForTimeout(5000);
  console.log("after tap :", JSON.stringify(await st()), "| chip:", await p.textContent("#sound"));
  await p.evaluate(() => window.__sound.setKind("storm"));
  await p.waitForTimeout(8000);
  console.log("storm day :", JSON.stringify(await st()));
  await p.click("#sound", { force: true }); // the HUD floats, so it is never "stable"
  await p.waitForTimeout(1500);
  console.log("muted     :", JSON.stringify(await st()), "| chip:", await p.textContent("#sound"), "| saved:", await p.evaluate(() => localStorage.getItem("adf-sound")));
  console.log("sound fetch failures:", fails.length ? fails : "none", "| errors:", errs.length ? errs.slice(0, 3) : "none");
  await b.close();
})();
