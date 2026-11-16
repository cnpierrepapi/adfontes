// The season standings (his call 16 Nov): every nation still standing ranks, AI-led ones too; a
// fallen or gone one doesn't. One rule (src/season.js rankNations) for the table and the jackpot script.
// Runs in node, no network.
//   node tests/standings.test.mjs
import { rankNations } from "../src/season.js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const LUGH = "lugh.adfontes-mw1fjpfx.testnet", LAKA = "laka.adfontes-mw1fjpfx.testnet", SANTA = "santa.testnet";
const nation = (id, name, followed, standing, extra = {}) => ({ id, name, alive: true, fallen: null, reverence: { followed, standing, waiting: false }, ...extra });
const clans = [
  nation(1, "Helios", LUGH, 93.3), // AI-led
  nation(12, "North Pole", SANTA, 45.9), // led by a person
  nation(16, "Vaelmoor", LAKA, 55.1),
  nation(3, "Antilles", LUGH, 70, { fallen: { by: 6, day: 40 } }), // fell in war: out of the race
  nation(7, "Babamako", LAKA, 99, { alive: false }), // gone
  nation(20, "Sunmarrow", LAKA, 55.1), // ties Vaelmoor: the older nation goes first
  nation(2, "Salamanco creek", LAKA, 0, { reverence: { followed: null, standing: 0, waiting: true } }),
];
const R = rankNations(clans);
ok(R.map((r) => r.id).join(",") === "1,16,20,12,2", `AI-led nations rank with the rest; fallen and gone ones don't (${R.map((r) => r.id).join(",")})`);
ok(R[0].follows === LUGH && R[0].standing === 93.3, "a row says which god the nation follows and its standing");
ok(R.at(-1).waiting === true && R.at(-1).follows === null, "a nation waiting for its god's first whisper ranks last, marked waiting");
ok(rankNations(null).length === 0 && rankNations([]).length === 0, "no world, no rows");
