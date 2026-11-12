// The game reads web2 (his call 12 Nov): no web3 word a player can read, anywhere in the game. Every system
// stays; only words, links and buttons change. The judge page, roadmap and README stay web3 (his call), so
// they aren't scanned. Allowed: the one outside wallet (Meteor) and explorer links worded "public record".
// Scans string literals with words in them, HTML text, titles/tooltips/meta, and server error messages.
//   node tests/web2.test.mjs        (exit 1 and every hit listed on failure)
import fs from "node:fs";

const FILES = [
  "live/index.html", "marketplace/index.html", "world/index.html", "timelapse/index.html",
  ...fs.readdirSync("src/live").filter((f) => f.endsWith(".js") && f !== "buffer-shim.js" && f !== "intents.js").map((f) => `src/live/${f}`),
  "src/says.js", "src/market.js", "src/net.js", "src/pagenav.js", "src/proof.js", "src/season.js", "src/talk.js", "src/world.js",
  ...fs.readdirSync("src/sandbox").filter((f) => f.endsWith(".js")).map((f) => `src/sandbox/${f}`),
];
// Words a player must never read. NEAR only in capitals (the coin); "chain" is a game word (a patent's chain).
const COIN = /\bNEAR\b/; // capitals only: near(...) is the amount formatter, not a word on screen
const BANNED = /\btestnet\b|\bmainnet\b|\bDAOs?\b|\bproposals?\b|\bwallets?\b|\bgas\b|\btokens?\b|\bNEP-?\d+|\bmint(?:ed|s|ing)?\b|\bcontract\b|\bSputnik\b|\bstaking\b|\btransactions?\b|\bexplorer\b|nearblocks|\bcrypto\b|\bUSDC\b|\bswap\b|\byocto|\.testnet\b|\bIntents\b|\bon[- ]chain\b|\bblockchain\b|\bthe chain\b|\bprivate key\b|\byour key\b|\bkey file\b|\bfaucet\b|\bsponsor(?:ed|ship)?\b/i;
const ALLOWED = /\bMeteor\b|public record/;

const hits = [];
const scan = (f, raw, i) => { const text = raw.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "…"); /* code inside ${...} isn't text */ if ((COIN.test(text) || BANNED.test(text)) && !ALLOWED.test(text)) hits.push(`${f}:${i + 1}: ${text.slice(0, 150)}`); };
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments aren't shown
    if (f.endsWith(".html")) {
      const t = line.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").trim();
      if (t) scan(f, t, i);
      for (const m of line.matchAll(/(?:title|aria-label|placeholder|content|alt)="([^"]+)"/g)) scan(f, m[1], i);
      return;
    }
    for (const m of line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      const s = m[2];
      if (/className:\s*$/.test(line.slice(0, m.index))) continue; // a CSS class, not text
      if (/console\.(log|warn|error|info)\(\s*$/.test(line.slice(0, m.index))) continue; // the dev console, not the page
      if (/\s/.test(s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "")) && /[a-z]{3}/i.test(s) && !/^(https?:|\.\/|\/api|select |insert |create )/.test(s)) scan(f, s, i);
    }
  });
}
// Server error messages a player can see (sign-up, login, starting grace).
fs.readFileSync("server.mjs", "utf8").split(/\r?\n/).forEach((line, i) => {
  for (const m of line.matchAll(/error: "([^"]+)"/g)) scan("server.mjs", m[1], i);
});
for (const h of hits) console.log(`FAIL ${h}`);
console.log(hits.length ? `${hits.length} web3 word(s) a player can read` : "PASS the game reads web2: no web3 word in any player-facing text");
process.exit(hits.length ? 1 : 0);
