// His call 12 Nov: nations led by AI gods are out of the season standings and can't win the jackpot. Only
// nations whose followed god is a human rank. Written before the change. Exits 1 on failure.
import fs from "node:fs";
import { standings, jackpotWinner } from "./reverence.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const s = { clans: { 1: {}, 2: {}, 12: {} }, rev: {
  1: { followed: "lugh.op", gods: { "lugh.op": { r: 80 } } },
  2: { followed: "human.testnet", gods: { "human.testnet": { r: 20 } } },
  12: { followed: "olive", gods: { olive: { r: 43.9 } } },
} };
const clans = [{ id: 1, name: "Helios", alive: true }, { id: 2, name: "Two", alive: true }, { id: 12, name: "North Pole", alive: true }];
const ai = new Set(["lugh.op"]);
ok(standings(s, clans, ai).map((r) => r.id).join() === "12,2", "a nation led by an AI god isn't ranked, however high its reverence");
ok(jackpotWinner(s, clans, ai).id === 12, "the jackpot goes to the top nation led by a human");
ok(standings(s, clans).length === 3, "without the AI list, everything ranks as before (old callers unchanged)");
const site = fs.readFileSync(new URL("../src/live/standings.js", import.meta.url), "utf8");
ok(/isAi\(c\.reverence\?\.followed\)/.test(site), "the site's standings table leaves out AI-led nations");
const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
ok(/standings\(s, clans, new Set\(/.test(server), "the API's jackpot leader skips AI-led nations");
const award = fs.readFileSync(new URL("../scripts/award-jackpot.mjs", import.meta.url), "utf8");
ok(/\.ai\b/.test(award) && /followed/.test(award), "the jackpot award script skips AI-led nations");
