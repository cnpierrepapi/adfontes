// A god's card (his ask 16 Nov): its nations, the grace it put in and how its holdings stand.
// Runs in node, no network.
//   node tests/god-card.test.mjs
import { godInfo, actionWords } from "../src/godinfo.js";
import { godLog } from "../src/server/godlog.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const LUGH = "lugh.adfontes-mw1fjpfx.testnet", LAKA = "laka.adfontes-mw1fjpfx.testnet", SANTA = "santa.testnet";
// As /api/world sends a nation: `gods` is a count, the accounts are only in its reverence.
const nation = (id, name, followed, standing, gods, extra = {}) => ({ id, name, alive: true, fallen: null, gods: gods.length,
  reverence: { followed, standing, waiting: false, gods: Object.fromEntries(gods.map((g, i) => [g, { r: i ? 20 : standing }])) }, ...extra });
const world = {
  ai: [LUGH, LAKA], names: { [LUGH]: "Lugh", [LAKA]: "Laka", [SANTA]: "Santa" },
  clans: [
    nation(1, "Helios", LUGH, 93.3, [LUGH, LAKA]),
    nation(12, "North Pole", SANTA, 45.9, [SANTA, LAKA]), // Laka is remembered here, but holds no seat (no stake row)
    nation(16, "Vaelmoor", LAKA, 55.1, [LAKA]),
    nation(3, "Antilles", LUGH, 70, [LUGH], { fallen: 6 }),
    nation(7, "Babamako", LAKA, 99, [LAKA], { alive: false }),
    nation(20, "Sunmarrow", LAKA, 55.1, [LAKA]),
  ],
};
const stakes = { stakes: [
  { clan: 1, god: LUGH, put_in: 7.5, granted: 5.5, claim_now: 9, gain: 1.5, pct: 20 },
  { clan: 1, god: LAKA, put_in: 1, granted: 0, claim_now: 0.8, gain: -0.2, pct: -20 },
  { clan: 3, god: LUGH, put_in: 2, granted: 0, claim_now: 0.5, gain: -1.5, pct: -75 },
  { clan: 16, god: LAKA, put_in: 6, granted: 5.5, claim_now: 6.6, gain: 0.6, pct: 10 },
  { clan: 20, god: LAKA, put_in: 0.4, granted: 0, claim_now: 0.3, gain: -0.1, pct: -25 },
  { clan: 7, god: LAKA, put_in: 0.1, granted: 0, claim_now: 0, gain: -0.1, pct: -100 },
  { clan: 12, god: SANTA, put_in: 14.4, granted: 0, claim_now: 12, gain: -2.4, pct: -16.7 },
] };
// The table's places, as the standings table hands them over (here: it ranks 3 nations).
const ranks = { 1: 1, 16: 2, 12: 3 };

// Lugh's card.
const L = godInfo(LUGH, world, stakes, ranks);
ok(L.ai && L.name === "Lugh", "an AI god, by its name");
ok(L.nations.length === 2 && L.leads === 1, `Lugh sits on two councils; it leads Helios, and Antilles fell (${L.nations.map((n) => n.name).join(", ")})`);
const helios = L.nations.find((n) => n.id === 1), antilles = L.nations.find((n) => n.id === 3);
ok(helios.rank === 1 && helios.of === 3 && helios.reverence === 93.3, "Helios: number 1 of the 3 the table ranks, reverence 93.3");
ok(antilles.fallen && !antilles.alive && antilles.rank === null, "a fallen nation shows as fallen, with no place");
ok(near(helios.given, 2) && near(helios.granted, 5.5) && near(helios.counts, 7.5), "grace put in is the stake less the world's grant (7.5 - 5.5 = 2)");
ok(near(L.totals.given, 4) && near(L.totals.granted, 5.5) && near(L.totals.counts, 9.5), `totals: 4 put in, 5.5 granted, stake counts 9.5 (${JSON.stringify(L.totals)})`);
ok(near(L.totals.worth, 9.5) && near(L.totals.gain, 0) && L.totals.pct === 0, "worth 9 + 0.5 = 9.5 today: even on the whole holding");

// Laka: leads Vaelmoor and Sunmarrow, sits on Helios's council under Lugh; Babamako is gone.
const K = godInfo(LAKA, world, stakes, ranks);
ok(K.nations.map((n) => n.id).join(",") === "16,20,1,7", `standing nations it leads first (most stake first), then the councils it only sits on, the gone ones last (${K.nations.map((n) => `${n.id}${n.leads ? "*" : ""}`).join(",")})`);
ok(K.leads === 2 && !K.nations.find((n) => n.id === 1).leads, "Laka leads 2 standing nations (Babamako is gone) and only sits on Helios's council");
ok(K.nations.find((n) => n.id === 20).rank === null, "a nation the table doesn't rank has no place on the card either");
ok(!K.nations.some((n) => n.id === 12), "North Pole remembers Laka but Laka holds no seat there: not one of its nations");
ok(K.missing === 0 && near(K.totals.counts, 7.5) && near(K.totals.worth, 7.7), `totals over its four seats: counts 7.5, worth 7.7 (${JSON.stringify(K.totals)})`);
ok(near(K.totals.pct, Math.round((7.7 / 7.5 - 1) * 1000) / 10), `whole-holding gain ${K.totals.pct}%`);

// No ranks handed over, a god with nothing, and a stakes read that failed.
ok(godInfo(LUGH, world, stakes).nations.every((n) => n.rank === null && n.of === 0), "no table yet: no places");
const none = godInfo("nobody.testnet", world, stakes, ranks);
ok(none.nations.length === 0 && none.totals === null && !none.ai, "a god with no seat: no nations, no totals");
const down = godInfo(LUGH, world, null, ranks);
ok(down.nations.length === 2 && down.totals === null && down.missing === 2, "stakes didn't load: the nations still show, the money says it's missing");

// Everything it has done (his ask 16 Nov): what the engine sent as the god, and its free signed picks, newest first.
{
  const rows = [
    { at: 1000, action: { kind: "whisper", clan: 1, text: "Feed them first." }, result: "ok HASH1" },
    { at: 3000, action: JSON.stringify({ kind: "bless", clan: 16, near: 0.5 }), result: "ok HASH2" },
    { at: 2000, action: { kind: "fire", clan: 1, target: 3 }, result: "error: that nation is protected for 4 more turns" },
    { at: 4000, action: { kind: "buy", clan: 20, listing: 43 }, result: "ok HASH4" },
  ];
  const choices = [{ day: 110, clan: 1, kind: "pitch", payload: { point: "nickel" }, at: new Date(2500) }, { day: 110, clan: 1, kind: "list", payload: { tokens: ["r:a", "r:b"] }, at: "1970-01-01T00:00:05.000Z" }];
  const log = godLog(rows, choices);
  ok(log.map((e) => e.kind).join(",") === "list,buy,bless,pitch,fire,whisper", `both tables, newest first (${log.map((e) => e.kind).join(",")})`);
  ok(log.find((e) => e.kind === "bless").tx === "HASH2" && log.find((e) => e.kind === "bless").near === 0.5, "a sent action keeps its public record and amount");
  const fire = log.find((e) => e.kind === "fire");
  ok(!fire.ok && fire.tx === null && /protected for 4 more turns/.test(fire.why), "a refused one says why, with no record");
  ok(godLog(rows, choices, 2).length === 2, "capped at the limit");
  const nameOf = (id) => ({ 1: "Helios", 3: "Antilles", 16: "Vaelmoor", 20: "Sunmarrow" })[id];
  ok(actionWords(log.find((e) => e.kind === "whisper"), nameOf) === 'Whispered to Helios: "Feed them first."', "a whisper reads as what it said");
  ok(actionWords(log.find((e) => e.kind === "bless"), nameOf) === "Blessed Vaelmoor with 0.5 grace", "a blessing in grace");
  ok(actionWords(fire, nameOf) === "Called an Act of God on Antilles (didn't go through: that nation is protected for 4 more turns)", "a failed one says so");
  ok(actionWords(log.find((e) => e.kind === "list"), nameOf) === "Told Helios's Broker to sell 2 things" && actionWords(log.find((e) => e.kind === "buy"), nameOf) === "Bought a seat in Sunmarrow", "Broker words and seat buys");
  ok(actionWords({ kind: "withdraw", clan: 1, ok: true }, nameOf) === "Took its whole stake out of Helios and left", "taking its stake out");
}
