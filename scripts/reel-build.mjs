// Builds the judges' reel (step 6, his call 9 Nov): about 90 seconds of the season's best moments,
// with captions. Turns 1 to REAL_TO are the real season, read from the live site's API (the same
// records the Merkle roots on NEAR cover). After that it's the god simulation (scripts/sim-week.mjs
// --gods, run from the live world as it stood on turn REAL_TO): wars, the rare weapons, a fall, peace.
// Every beat says which it is. Writes public/reel.json; src/live/timelapse.js plays it.
//   node scripts/reel-build.mjs [simDir=debug/sim-gods] [site=https://adfontes.fun]
import fs from "node:fs";
import { says } from "../src/says.js";

const SIM = process.argv[2] || "debug/sim-gods", SITE = process.argv[3] || "https://adfontes.fun";
const seed = JSON.parse(fs.readFileSync(`${SIM}/seed.json`, "utf8"));
const REAL_TO = seed.day ?? 16;
const names = { 1: "Helios", 2: "Salamanco creek", 3: "Antilles", 4: "Striklar", 5: "Fremonition", 6: "Numdial" };
const nameOf = (id) => names[id] ?? `nation ${id}`;

// The records, in order: real turns from the site, simulated ones from the sim's folder.
const days = [];
for (let d = 1; d <= REAL_TO; d++) {
  const x = await fetch(`${SITE}/api/day?d=${d}`).then((r) => r.json());
  days.push({ day: d, sim: false, records: x.records || [] });
}
const dir = `${SIM}/state/testnet`;
for (const f of fs.readdirSync(dir).filter((f) => /^day-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)))) {
  const d = parseInt(f.slice(4));
  if (d > REAL_TO) days.push({ day: d, sim: true, records: JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")) });
}
const all = days.flatMap(({ day, sim, records }) => records.map((r, i) => ({ day, sim, r, i })));
const SIM_TO = days.at(-1).day;

// The picks: every founding, the firsts, every war, peace and fall, and a battle for each weapon
// (the rare ones first, and only battles where something burned).
const picked = new Map();
const pick = (b, ms = 2800) => b && !picked.has(b) && picked.set(b, ms);
const first = (fn) => all.find(fn);
for (const b of all.filter((b) => b.r.kind === "founded")) pick(b, 2200);
pick(first((b) => b.r.kind === "corpus" && !b.r.fake));
pick(first((b) => b.r.kind === "trade" && !b.r.tool));
pick(first((b) => b.r.kind === "tech" && b.r.tech === "press"));
pick(first((b) => b.r.kind === "gift" && b.r.passed && b.r.title));
for (const b of all.filter((b) => ["war", "peace-offer", "peace", "fallen"].includes(b.r.kind))) pick(b, b.r.kind === "fallen" ? 4200 : 3200);
pick(first((b) => b.sim && b.r.kind === "trickster"));
pick(first((b) => b.sim && b.r.kind === "warden"));
pick(first((b) => b.sim && b.r.kind === "fortify"));
pick(first((b) => b.sim && b.r.kind === "tech"));
pick(first((b) => b.sim && b.r.kind === "gift" && b.r.passed && b.r.title));
const burned = (b) => b.r.kind === "battle" && Object.values(b.r.sides).some((x) => x.burned?.length);
const usesW = (b, w) => Object.values(b.r.sides).some((x) => x.weapon === w);
for (const w of ["starlance", "ornithopters", "burningglass", "mortar", "pamphlets", "trebuchet", "arrows"]) pick(all.find((b) => burned(b) && usesW(b, w) && ![...picked.keys()].some((p) => p.r.kind === "battle" && usesW(p, w))) ?? all.find((b) => b.r.kind === "battle" && usesW(b, w)), 3000);

// Captions: the event list's own line, with long quoted reasons cut to their first sentence.
const short = (s) => s.replace(/"([^"]{0,400})"/g, (m, q) => { const one = q.match(/^.{20,140}?[.!?](\s|$)/)?.[0]?.trim() ?? (q.length > 140 ? `${q.slice(0, 137).trim()}…` : q); return `"${one}"`; });
const beats = [...picked.entries()].sort(([a], [b]) => a.day - b.day || a.i - b.i).map(([b, ms]) => {
  // Keep only what the player needs from the record.
  const { kind, clan, buyer, seller, attacker, defender, a, b: bb, by, sides, war, name, tech, passed, tool, stir, fake, cut, doubt, via, points, round } = b.r;
  return { day: b.day, sim: b.sim, ms, cap: short(says(b.r, nameOf)), r: { kind, clan, buyer, seller, attacker, defender, a, b: bb, by, sides, war, name, tech, passed, tool, stir, fake, cut, doubt, via, points, round } };
});
const total = beats.reduce((t, b) => t + b.ms, 0);
const out = { built: new Date().toISOString(), real_to: REAL_TO, sim_to: SIM_TO, seconds: Math.round(total / 1000), beats };
fs.writeFileSync("public/reel.json", JSON.stringify(out));
for (const b of beats) console.log(`${b.sim ? "SIM " : "REAL"} t${String(b.day).padStart(3)} ${(b.ms / 1000).toFixed(1)}s ${b.r.kind.padEnd(11)} ${b.cap.slice(0, 150)}`);
console.log(`\n${beats.length} beats, ${out.seconds} s; real turns 1-${REAL_TO}, simulated ${REAL_TO + 1}-${SIM_TO}`);
