// Hover the "You, the god" pin and check it stays put and clickable (real time, not frozen t).
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto((process.argv[2] || "http://localhost:4173") + "/", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const pin = p.locator(".pin", { hasText: "You, the god" });
const box0 = await pin.boundingBox();
await p.mouse.move(box0.x + 10, box0.y + 2, { steps: 12 });
const boxes = [];
for (let i = 0; i < 8; i++) { await p.waitForTimeout(250); boxes.push(await pin.boundingBox()); }
const drift = Math.max(...boxes.map((bx) => Math.hypot(bx.x - boxes[0].x, bx.y - boxes[0].y)));
const op = await pin.evaluate((e) => getComputedStyle(e).opacity);
await p.mouse.click(box0.x + 10, box0.y + 2);
await p.waitForTimeout(500);
const opened = await p.locator("#panel h2").textContent().catch(() => null);
console.log({ driftWhileHoveredPx: Math.round(drift), opacity: op, panelOpened: opened });
await b.close();
