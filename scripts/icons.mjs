// Render PNG icons from the SVG favicon.
import { chromium } from "playwright";
import fs from "node:fs";
const svg = fs.readFileSync("public/favicon.svg", "utf8");
const b = await chromium.launch();
for (const [name, size] of [["apple-touch-icon.png", 180]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  await p.screenshot({ path: `public/${name}`, omitBackground: true });
}
await b.close();
console.log("ok");
