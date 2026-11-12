// A local copy of the world with N nations (default 100), for graphics tests only: clones the nations of a
// seeded copy (scripts/sim-seed.mjs) under new ids and names. Never touches testnet or the live database.
//   node scripts/make-big-world.mjs <seededDir> <outDir> [n=100]
import fs from "node:fs";
import path from "node:path";

const [src, out, nArg] = process.argv.slice(2);
const N = Number(nArg) || 100;
if (!src || !out) { console.log("usage: node scripts/make-big-world.mjs <seededDir> <outDir> [n]"); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
const chainF = path.join(out, "chain.json"), stateF = path.join(out, "state", "testnet.json");
const C = JSON.parse(fs.readFileSync(chainF, "utf8")), S = JSON.parse(fs.readFileSync(stateF, "utf8"));
const alive = C.clans.filter((c) => c.alive && S.clans[c.id]);
let id = Math.max(...C.clans.map((c) => c.id));
const SYL = ["Ar", "Bel", "Cor", "Dun", "El", "Fen", "Gal", "Hal", "Iv", "Jor", "Kel", "Lun", "Mor", "Nor", "Os", "Pel", "Quin", "Ros", "Sel", "Tor", "Ul", "Var", "Wen", "Yr", "Zan"];
while (C.clans.filter((c) => c.alive).length < N) {
  const base = alive[(id) % alive.length];
  id++;
  const name = `${SYL[id % SYL.length]}${SYL[(id * 7) % SYL.length].toLowerCase()}${id}`;
  C.clans.push({ ...structuredClone(base), id, name, dao: `big-${id}.sim.local`, gods: [{ account: `big-god-${id}.sim.local`, put_in: "1000000000000000000000000" }] });
  if (C.agents?.[base.id]) C.agents[id] = structuredClone(C.agents[base.id]);
  S.clans[id] = { ...structuredClone(S.clans[base.id]), id, name };
}
fs.writeFileSync(chainF, JSON.stringify(C));
fs.writeFileSync(stateF, JSON.stringify(S));
console.log(`${C.clans.filter((c) => c.alive).length} nations in ${out}`);
