// His call 12 Nov: nations led by AI gods were out of the season standings. His call 16 Nov reversed it: every nation
// still standing ranks, AI-led ones too (src/season.js rankNations). reverence.standings keeps its optional AI list
// (the first three checks); the site, the API and the award script must no longer pass one. Exits 1 on failure.
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
ok(/rankNations/.test(site) && !/isAi\(c\.reverence\?\.followed\)/.test(site), "the site's standings table ranks every nation still standing, AI-led too (rankNations)");
const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
ok(/standings\(s, clans\)\[0\]/.test(server) && !/standings\(s, clans, new Set\(/.test(server), "the API's jackpot leader counts AI-led nations too");
const award = fs.readFileSync(new URL("../scripts/award-jackpot.mjs", import.meta.url), "utf8");
ok(/rankNations\(W\.clans\)/.test(award) && !/\.ai\b/.test(award), "the jackpot award script uses the site's own rule, AI-led nations included");
