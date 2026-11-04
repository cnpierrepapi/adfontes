// Render stills of the landing page for review. Usage: node scripts/stills.mjs [baseUrl]
import { chromium } from "playwright";
import fs from "node:fs";

const base = process.argv[2] || "http://localhost:4173";
const out = "stills";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

const shots = [
  { name: "hero-desktop", url: "/?t=12", w: 1440, h: 900 },
  { name: "hero-mobile", url: "/?t=12", w: 390, h: 844 },
  { name: "panel-clan", url: "/?t=12&open=agents", w: 1440, h: 900 },
  { name: "panel-loop", url: "/?t=12&open=fountain", w: 1440, h: 900 },
  { name: "panel-god", url: "/?t=12&open=sun", w: 1440, h: 900 },
  { name: "panel-weather", url: "/?t=12&open=weather", w: 1440, h: 900 },
  { name: "demo", url: "/demo/", w: 1440, h: 900, full: true },
];
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + s.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!s.full });
  console.log(s.name, errors.length ? "ERRORS: " + errors.join(" | ") : "ok");
  await page.close();
}
await browser.close();
