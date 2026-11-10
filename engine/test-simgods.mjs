// The fast-forward's simulated gods (his rule 8 Nov): visit at 30+, drift away under 30, rush back
// under 10 and keep coming until the nation is back above 30.
import { nextMode, visits } from "../scripts/sim-gods.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
ok(nextMode(null, 50) === "faithful" && nextMode(null, 20) === "away" && nextMode(null, 5) === "rescue", "first look: faithful / away / rescue by standing");
ok(visits(nextMode("faithful", 30)), "30 or more: they keep visiting");
ok(nextMode("faithful", 29.9) === "away" && !visits("away"), "under 30: they stop coming");
ok(nextMode("away", 15) === "away", "between 10 and 30: still away");
ok(nextMode("away", 9.9) === "rescue" && visits("rescue"), "under 10: they rush back");
ok(nextMode("rescue", 20) === "rescue", "...and keep coming between 10 and 30 (no flicker at 10)");
ok(nextMode("rescue", 30) === "faithful", "back above 30: faithful again");
ok(nextMode("faithful", 5) === "rescue", "a crash straight under 10 brings them back at once");
ok(nextMode("faithful", 31, 2) === "away" && nextMode("faithful", 31, -2) === "faithful", "each god's own offset: one drifts while another stays");
// The walk he described: 50 -> 25 -> 8 -> 20 -> 32 -> 26
let m = null; const path = [50, 25, 8, 20, 32, 26].map((x) => (m = nextMode(m, x)));
ok(path.join(",") === "faithful,away,rescue,rescue,faithful,away", `decline and comeback: ${path.join(" -> ")}`);

// The whisper cap (his call 10 Nov): 5 whispers per god for the whole run; after that the god still
// visits and blesses. 20 simulated days with a faithful god in a stand-in world.
{
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { godsTurn, GODS } = await import("../scripts/sim-gods.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simgods-"));
  fs.mkdirSync(`${dir}/state`);
  const god = "god.test";
  fs.writeFileSync(`${dir}/chain.json`, JSON.stringify({ clans: [{ id: 1, alive: true, dao: "dao.test", gods: [{ account: god, put_in: "0", shares: "0" }], total_in: "0", shares: "0" }], totals: { florins: "1000", backing: "1000", jackpot: "0", balance: "0", liabilities: "0" }, gifts: {} }));
  fs.writeFileSync(`${dir}/state/testnet.json`, JSON.stringify({ clans: { 1: { owned: {} } }, rev: { 1: { followed: god, gods: { [god]: { r: 60 } } } } }));
  let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let visitsN = 0, blessedAfter = 0;
  for (let d = 0; d < 20; d++) for (const v of godsTurn(dir, d * GODS.dayMs + 23 * 3600e3, rand)) { if (v.blessed == null) continue; visitsN++; if (v.whispers >= GODS.whisperCap && !v.whispered) blessedAfter++; }
  const whispers = JSON.parse(fs.readFileSync(`${dir}/chain.json`, "utf8")).daos["dao.test"].filter((p) => JSON.stringify(p).includes("whisper")).length;
  ok(GODS.whisperCap === 5 && whispers === 5, `a god whispers ${whispers} times in ${visitsN} visits (cap ${GODS.whisperCap})`);
  ok(blessedAfter > 0, `after the fifth whisper it still visits and blesses (${blessedAfter} visits)`);
  fs.rmSync(dir, { recursive: true, force: true });
}
