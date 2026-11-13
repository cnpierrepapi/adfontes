// Graphics quality (his ask 12 Nov: the game cracked his browser with one more tab open). Three tiers; the
// game picks one from the device at load and steps DOWN by itself when frames stay slow; a player can force
// Low or High from the HUD. Tested in tests/quality.test.mjs.

export const TIERS = {
  // Today's look.
  high: { pixelRatio: 2, antialias: true, shadows: true, bloom: true, fpsCap: 0, towns: 12, preload: 12 },
  // Sharp, without the glow pass; towns only near you.
  medium: { pixelRatio: 1.5, antialias: true, shadows: true, bloom: false, fpsCap: 0, towns: 4, preload: 4 },
  // Small machines: plain 1x, no shadows, 30 fps, only the town you're looking at (and the last one).
  low: { pixelRatio: 1, antialias: false, shadows: false, bloom: false, fpsCap: 30, towns: 2, preload: 0, skies: false, farSkip: true }, // skies: far-off star maps; farSkip: far islands skip per-frame work (step 3)
};
const ORDER = ["high", "medium", "low"];
const SOFT_GPU = /swiftshader|llvmpipe|software|microsoft basic render|intel\(r\) (u?hd|iris\(r\) graphics [0-9]{3}\b)|intel.*\bhd graphics\b|mali-[4t]|adreno \(tm\) [3-5]\d\d|powervr/i;

/** The tier for this device. dev = { deviceMemory, cores, gpu, dpr, phone }. */
export function pickTier(dev = {}) {
  const mem = dev.deviceMemory, cores = dev.cores ?? 4;
  if (dev.phone) return "low";
  if ((mem != null && mem <= 4) || cores <= 4) return "low";
  if (SOFT_GPU.test(String(dev.gpu || ""))) return "low";
  if (mem == null) return "medium";
  if (mem <= 8) return "medium";
  return "high";
}

/** What the browser tells us about the machine (GPU from WebGL's debug renderer string when allowed). */
export function readDevice(gl) {
  let gpu = "";
  try { const ext = gl?.getExtension("WEBGL_debug_renderer_info"); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ""; } catch { /* hidden */ }
  return { deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency, gpu, dpr: window.devicePixelRatio || 1, phone: matchMedia("(max-width: 700px), (pointer: coarse)").matches };
}

/** The player's choice: "auto" (default), "low" or "high". */
export const KEY = "adf-quality";
export const chosen = () => { try { const v = localStorage.getItem(KEY); return v === "low" || v === "high" ? v : "auto"; } catch { return "auto"; } };

/** Watches frame times. frame(ms) returns the new tier name when it steps down, else null.
 *  Rules: slow = under 30 fps (frames over 33 ms) on average across the last 3 s; a step waits out a
 *  4 s grace before the next judgement; never steps up; auto=false never moves. */
export function createStepper({ start, auto, clock = () => performance.now() }) {
  let tier = start, since = clock(), frames = [];
  const WINDOW = 3000, GRACE = 4000, SLOW_MS = 1000 / 30;
  return {
    tier: () => tier,
    settings: () => TIERS[tier],
    frame(ms) {
      if (!auto) return null;
      const now = clock();
      frames.push([now, ms]);
      while (frames.length && frames[0][0] < now - WINDOW) frames.shift();
      if (now - since < GRACE || frames.length < 2 || now - frames[0][0] < WINDOW * 0.95) return null; // judge full windows only
      const avg = frames.reduce((a, f) => a + f[1], 0) / frames.length;
      if (avg > SLOW_MS && ORDER.indexOf(tier) < ORDER.length - 1) {
        tier = ORDER[ORDER.indexOf(tier) + 1];
        since = now; frames = [];
        return tier;
      }
      return null;
    },
    /** With a frame cap (low: 30 fps), skip a frame that comes too soon after the last one drawn. */
    shouldDraw(sinceLastDrawMs) {
      const cap = TIERS[tier].fpsCap;
      if (!cap) return true;
      return sinceLastDrawMs >= 1000 / cap - 1;
    },
  };
}
