import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // The NEAR wallet packages expect Node's `global`.
  define: { global: "globalThis" },
  // Dev only: the API comes from the live site, so local stills show the real world.
  server: { proxy: { "/api": { target: process.env.ADF_API || "https://adfontes.fun", changeOrigin: true } } },
  build: {
    rollupOptions: {
      input: { world: resolve(import.meta.dirname, "world/index.html"), live: resolve(import.meta.dirname, "live/index.html"), judge: resolve(import.meta.dirname, "judge/index.html"), timelapse: resolve(import.meta.dirname, "timelapse/index.html"), roadmap: resolve(import.meta.dirname, "roadmap/index.html"), season1: resolve(import.meta.dirname, "roadmap/season1/index.html"), marketplace: resolve(import.meta.dirname, "marketplace/index.html") },
    },
  },
});
