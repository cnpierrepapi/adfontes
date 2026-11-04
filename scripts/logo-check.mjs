// Render the mark at large and favicon sizes, on light and dark, into one contact sheet.
import { chromium } from "playwright";
import fs from "node:fs";

const svg = fs.readFileSync(process.argv[2] || "public/mark.svg", "utf8");
const uri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const sizes = [256, 64, 32, 16];
const cell = (bg) => sizes.map((s) => `<div style="background:${bg};padding:12px;display:inline-flex;align-items:center;justify-content:center;width:280px;height:280px"><img src="${uri}" width="${s}" height="${s}" style="image-rendering:auto"></div>`).join("");
const html = `<body style="margin:0;font-family:sans-serif">
<div>${cell("#ffffff")}</div><div>${cell("#1d1430")}</div><div>${cell("#6fe3ff")}</div>
<div style="padding:20px;background:#6fe3ff;display:flex;gap:14px;align-items:center"><img src="${uri}" width="54"><span style="font:800 40px 'Bricolage Grotesque',sans-serif;letter-spacing:.06em;color:#fff">AD FONTES</span></div></body>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 960 } });
await p.setContent(html);
await p.screenshot({ path: "stills/logo-sheet.png", fullPage: true });
await b.close();
console.log("ok");
