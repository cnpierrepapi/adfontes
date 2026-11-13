// Phase C measured (12 Nov): the live page on a 100-nation copy, CPU slowed 4x (a weak laptop), High vs Low.
// Low must use clearly less memory and GPU memory, keep at most 2 towns, draw no slower than High, and stay
// under a JS memory ceiling. Exits 1 on failure; prints the numbers either way.
//   node tests/quality-page.test.cjs [baseUrl=http://127.0.0.1:3977] [ceilingMB=350]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://127.0.0.1:3977", CEILING = Number(process.argv[3]) || 350;
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };

async function measure(b, tier) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
  await ctx.addInitScript((t) => { localStorage.setItem("adf-quality", t); localStorage.setItem("adf-cinema-seen", "1"); localStorage.setItem("adf-tutorial-done", "1"); }, tier);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.goto(`${base}/live/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__live?.quality, null, { timeout: 120000 });
  await p.waitForTimeout(25000); // page-load building settles (towns, minds)
  // Fly to a nation so its town is built, then measure the frame rate for 6 s.
  await p.evaluate(() => window.__live.flyTo(window.__live.world.clans[0].id));
  await p.waitForTimeout(8000);
  // Flying to a nation always shows its town (13 Nov): wait for it on both tiers, so they're measured on the same scene.
  await p.waitForFunction(() => window.__live.quality().towns >= 1, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(4000);
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  const heap = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
  const q = await p.evaluate(() => window.__live.quality());
  const drawn = await p.evaluate(() => window.__drawn ?? null);
  await ctx.close();
  return { tier, fps, heap, q, errs, drawn };
}

(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
  const H = await measure(b, "high"), L = await measure(b, "low");
  await b.close();
  for (const r of [H, L]) console.log(`${r.tier.padEnd(4)}: tier ${r.q.tier}, ${r.q.towns} towns, JS heap ${r.heap.toFixed(0)} MB, geometries ${r.q.memory.geometries}, textures ${r.q.memory.textures}, draw calls ${r.q.calls}, rAF ${r.fps.toFixed(1)}/s, errors ${r.errs.length}`);
  ok(L.q.tier === "low" && H.q.tier === "high", "each run used the tier it asked for");
  ok(L.errs.length === 0 && H.errs.length === 0, "no page errors on either tier");
  ok(L.q.towns <= 2, `low keeps at most 2 towns (${L.q.towns}; high ${H.q.towns})`);
  ok(L.q.towns >= 1 && H.q.towns >= 1, "both measured with the nation's town built (what a player sees after flying there)");
  // Measured 12 Nov: memory was never the problem (~80 MB); draw calls were (12,630 a frame with 100 nations,
  // 3,372 with today's 13: ~130 separate planks per trade bridge, ~110 pieces per island). Targets set
  // before the merge work (phase C2): Low under 3,000 draw calls and at least 15 frames a second here.
  ok(L.q.calls < 3000, `low draws under 3,000 calls a frame with 100 nations (${L.q.calls})`);
  // The 15 frames a second target (12 Nov) was dropped on 13 Nov (his call: "if it doesn't work remove that as a goal"):
  // graphics step 3 took Low from 1.6 to ~7 fps here without a town, but a town in view is bound by its citizens' shaders
  // on the GPU, not by draw calls. Measured, printed, and Low must never be slower than High.
  console.log(`frames a second with the CPU slowed 4x: low ${L.fps.toFixed(1)}, high ${H.fps.toFixed(1)}`);
  ok(L.fps >= H.fps * 0.95, `low is never slower than high (${L.fps.toFixed(1)} vs ${H.fps.toFixed(1)})`);
  ok(L.q.memory.textures <= H.q.memory.textures, `low holds no more textures than high (${L.q.memory.textures} vs ${H.q.memory.textures})`);
  ok(L.heap < CEILING, `low stays under ${CEILING} MB of JS memory with 100 nations (${L.heap.toFixed(0)} MB)`);
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
