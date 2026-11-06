import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html"), demo: resolve(import.meta.dirname, "demo/index.html"), world: resolve(import.meta.dirname, "world/index.html"), live: resolve(import.meta.dirname, "live/index.html") },
    },
  },
});
