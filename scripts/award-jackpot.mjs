// Pay the season jackpot to the #1 nation (SPEC §14). The contract pays whoever the owner names, so
// the rule lives here: nations still standing, ranked by reverence; a nation that fell in war is out
// (his call 8 Nov). Reads the live standings from the public API. Dry run unless --send.
// Usage: node scripts/award-jackpot.mjs [testnet|mainnet] [--send]
//   --send signs award_jackpot as the world's owner (key in .keys/<owner>.json). Mainnet needs his go.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

const NET = process.argv.includes("mainnet") ? "mainnet" : "testnet";
const SEND = process.argv.includes("--send");
const API = process.env.ADF_UPSTREAM || "https://adfontes.fun";
const W = await (await fetch(`${API}/api/world?net=${NET}`)).json();

// Same order as the site's table (src/live/standings.js) and engine/reverence.mjs standings().
// Nations led by an AI god (their followed god is in W.ai) don't rank (12 Nov).
const aiGods = new Set(W.ai || []);
const ranked = W.clans.filter((c) => c.alive !== false && !c.fallen && !aiGods.has(c.reverence?.followed))
  .map((c) => ({ id: c.id, name: c.name, standing: c.reverence?.standing ?? 0 }))
  .sort((a, b) => b.standing - a.standing || a.id - b.id);
const fallen = W.clans.filter((c) => c.fallen).map((c) => c.name);
console.log(`${NET} world ${W.world} | jackpot ${W.jackpot?.near ?? "?"} NEAR${W.jackpot?.paid ? " (ALREADY PAID)" : ""}`);
console.log(ranked.map((r, i) => `  ${i + 1}. ${r.name} (nation ${r.id}) ${r.standing}`).join("\n"));
if (fallen.length) console.log(`  out (fell in war): ${fallen.join(", ")}`);
const win = ranked[0];
if (!win) throw new Error("no nation standing");
if (ranked[1] && ranked[1].standing === win.standing) console.log(`  tie at ${win.standing}: the older nation (${win.name}) wins`);
if (!SEND) { console.log(`\nDry run. Would award the jackpot to ${win.name} (nation ${win.id}). Add --send to pay it.`); process.exit(0); }

const rpc = NET === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com";
const provider = new JsonRpcProvider({ url: rpc });
const cfg = await provider.callFunction({ contractId: W.world, method: "get_config", args: {} });
const owner = cfg.owner;
const k = JSON.parse(fs.readFileSync(`.keys/${owner}.json`, "utf8"));
const acct = new Account(owner, provider, k.private_key);
const r = await acct.callFunctionRaw({ contractId: W.world, methodName: "award_jackpot", args: { clan_id: win.id }, gas: "100000000000000" });
console.log(`awarded to ${win.name}: tx ${r.transaction.hash}`);
