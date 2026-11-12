// Phase C (12 Nov, written before src/live/quality.js): graphics that don't crack small machines.
// 1. A tier is picked at load from the device (memory, cores, GPU, phone); unknown memory = medium.
// 2. Auto steps DOWN one tier when frames stay under 30 fps for 3 s; never back up in a session; a
//    player's choice (Low / High) is never overridden.
// 3. Each tier's settings: low = pixel ratio 1, no antialias, no shadows, no bloom, 30 fps cap, towns only
//    for the focused nation and one more, nothing built at page load.
//   node tests/quality.test.mjs
import { pickTier, TIERS, createStepper } from "../src/live/quality.js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };

// 1. Picking.
ok(pickTier({ deviceMemory: 4, cores: 8, gpu: "NVIDIA GeForce RTX 3060", dpr: 1 }) === "low", "4 GB of memory: low");
ok(pickTier({ deviceMemory: 16, cores: 4, gpu: "Apple M1", dpr: 2 }) === "low", "4 cores: low");
ok(pickTier({ deviceMemory: 16, cores: 12, gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))", dpr: 1 }) === "low", "software GPU (SwiftShader): low");
ok(pickTier({ deviceMemory: 8, cores: 8, gpu: "ANGLE (Intel, Intel(R) UHD Graphics 620)", dpr: 1.25 }) === "low", "integrated Intel UHD/HD graphics: low");
ok(pickTier({ deviceMemory: 8, cores: 8, gpu: "NVIDIA GeForce GTX 1650", dpr: 1 }) === "medium", "8 GB, a real GPU: medium");
ok(pickTier({ deviceMemory: 16, cores: 12, gpu: "NVIDIA GeForce RTX 4070", dpr: 1 }) === "high", "16 GB, 12 cores, a strong GPU: high");
ok(pickTier({ deviceMemory: undefined, cores: 10, gpu: "Apple GPU", dpr: 2 }) === "medium", "memory unknown (Safari, Firefox): medium");
ok(pickTier({ deviceMemory: 8, cores: 8, gpu: "Adreno (TM) 740", dpr: 3, phone: true }) === "low", "phones start on low");

// 3. The tiers.
const L = TIERS.low, M = TIERS.medium, H = TIERS.high;
ok(L.pixelRatio === 1 && !L.antialias && !L.shadows && !L.bloom && L.fpsCap === 30 && L.towns === 2 && L.preload === 0, "low: 1x, no antialias, no shadows, no bloom, 30 fps, 2 towns, nothing built at load");
ok(M.pixelRatio <= 1.5 && M.antialias && M.shadows && !M.bloom && M.towns === 4 && M.preload === 4, "medium: up to 1.5x, shadows, no bloom, 4 towns, the 4 nearest built at load");
ok(H.pixelRatio === 2 && H.antialias && H.shadows && H.bloom && H.towns === 12, "high: today's look (2x, shadows, bloom, 12 towns)");
ok(L.towns < M.towns && M.towns < H.towns && L.pixelRatio < H.pixelRatio, "each tier is lighter than the one above");

// 2. Stepping down.
let now = 0;
const st = createStepper({ start: "high", auto: true, clock: () => now });
const feed = (ms, secs) => { const end = now + secs * 1000; let out = null; while (now < end) { now += ms; out = st.frame(ms) || out; } return out; };
ok(feed(16, 5) === null && st.tier() === "high", "60 fps for 5 s: stays high");
ok(feed(40, 2) === null && st.tier() === "high", "25 fps for 2 s: not yet (needs 3 s)");
ok(feed(40, 1.5) === "medium" && st.tier() === "medium", "25 fps past 3 s: steps down to medium");
ok(feed(40, 2) === null && st.tier() === "medium", "right after a step: a grace period before judging again");
ok(feed(40, 5) === "low" && st.tier() === "low", "still slow: steps down to low");
ok(feed(40, 10) === null && st.tier() === "low", "low is the floor");
ok(feed(8, 30) === null && st.tier() === "low", "fast again: never steps back up in a session");
now = 0;
const fixed = createStepper({ start: "high", auto: false, clock: () => now });
let moved = null; for (let i = 0; i < 400; i++) { now += 50; moved = fixed.frame(50) || moved; }
ok(moved === null && fixed.tier() === "high", "a player who chose High is never stepped down");
// The 30 fps cap: on low, a frame that comes too soon is skipped.
ok(st.shouldDraw(10) === false && st.shouldDraw(34) === true, "low draws at most ~30 times a second");
ok(createStepper({ start: "high", auto: true, clock: () => 0 }).shouldDraw(10) === true, "high draws every frame");
