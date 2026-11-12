// The game reads web2, as a player SEES it (12 Nov): load the pages, open a nation, and fail on any web3 word
// or account id in the visible text, data from the server included. Judge page, roadmap, README not checked
// (his call: they stay web3). Allowed: Meteor (the one outside wallet) and "public record" links.
//   node tests/web2-page.test.cjs [baseUrl=http://127.0.0.1:3977]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://127.0.0.1:3977";
const COIN = /\bNEAR\b/;
const BANNED = /\btestnet\b|\bmainnet\b|\bDAOs?\b|\bproposals?\b|\bwallets?\b|\bfor gas\b|\bgas (?:money|fees?)\b|\btokens?\b|\bNEP-?\d+|\bmint(?:ed|s|ing)?\b|\bcontract\b|\bSputnik\b|\bstaking\b|\btransactions?\b|\bexplorer\b|nearblocks|\bcrypto\b|\bUSDC\b|\byocto|\bIntents\b|\bon[- ]chain\b|\bblockchain\b|\bfaucet\b|\bsponsor(?:ed|ship)?\b/i;
const ACCOUNT = /\b[a-z0-9_\-]+\.(?:adf-[a-z0-9\-.]+\.)?testnet\b|\b[0-9a-f]{64}\b|\b[0-9a-f]{8,}…/;
const ALLOWED = /\bMeteor\b|public record/i;
let bad = 0;
const check = (where, text) => {
  for (const line of text.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
    if (ALLOWED.test(line)) continue;
    if (COIN.test(line) || BANNED.test(line) || ACCOUNT.test(line)) { console.log(`FAIL ${where}: ${line.slice(0, 160)}`); bad++; }
  }
};
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
  await p.goto(`${base}/live/?stills`, { waitUntil: "networkidle" });
  await p.waitForTimeout(5000);
  check("live HUD", await p.evaluate(() => document.body.innerText));
  const ids = await p.evaluate(() => window.__live.world.clans.map((c) => c.id));
  for (const id of ids) {
    await p.evaluate((i) => window.__live.flyTo(i), id);
    await p.waitForTimeout(1200);
    check(`live panel ${id}`, await p.evaluate(() => document.querySelector("#panel")?.innerText || ""));
  }
  // The god menu as a visitor (sign-in choices).
  await p.click(".chip.wallet", { force: true }).catch(() => {});
  await p.waitForTimeout(1500);
  check("sign-in menu", await p.evaluate(() => document.body.innerText));
  for (const path of ["/world/", "/marketplace/"]) {
    await p.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(3000);
    check(path, await p.evaluate(() => document.body.innerText));
    // Tooltips too (title attributes).
    check(`${path} tooltips`, (await p.$$eval("[title]", (x) => x.map((e) => e.getAttribute("title")))).join("\n"));
  }
  const names = await p.evaluate(async (u) => (await (await fetch(`${u}/api/world`)).json()).names || {}, base);
  const n = Object.keys(names).length;
  if (!n || Object.values(names).some((v) => !v || /testnet|^[0-9a-f]{64}$/.test(v))) { console.log(`FAIL the world names every god (${n})`); bad++; } else console.log(`PASS the world names all ${n} gods (${Object.values(names).slice(0, 6).join(", ")}...)`);
  await b.close();
  console.log(bad ? `${bad} FAILED` : "PASS a player sees no web3 word and no account id");
  process.exit(bad ? 1 : 0);
})();
