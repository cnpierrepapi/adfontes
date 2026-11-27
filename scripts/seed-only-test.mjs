// scripts/sim-seed.mjs --only=a,b,c (the game, 27 Nov): a copy holding only those nations, as they stand live.
// Checks: exactly those nations on the copy's chain and in its engine state; their citizens and stakes and no
// others; no war with a nation outside the copy; every kept day record names only those nations; the florin's
// price is the live one. Exits 1 on any failure.   node scripts/seed-only-test.mjs [dir=debug/seed-only]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "debug/seed-only";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const api = (p) => fetch(`https://adfontes.fun/api/${p}${p.includes("?") ? "&" : "?"}net=testnet`).then((r) => r.json());

const W = await api("world");
const standing = W.clans.filter((c) => c.alive !== false && !c.fallen);
// Three nations, one of them at war if any is (so a war with an outsider has to be dropped).
const fighter = standing.find((c) => c.war?.enemy != null);
const pick = [...new Set([fighter?.id, ...standing.map((c) => c.id)].filter((x) => x != null))].slice(0, 3);
const only = new Set(pick);
console.log(`picked ${pick.join(",")} (${pick.map((id) => W.clans.find((c) => c.id === id).name).join(", ")})`);
const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR, `--only=${pick.join(",")}`], { encoding: "utf8" });
ok(r.status === 0, `seed ran (exit ${r.status})${r.status ? " " + r.stderr.slice(-300) : ""}`);
if (r.status !== 0) process.exit(1);

const C = JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
const S = JSON.parse(fs.readFileSync(`${DIR}/state/testnet.json`, "utf8"));
const ids = (xs) => [...xs].map(Number).sort((a, b) => a - b).join(",");
ok(ids(C.clans.map((c) => c.id)) === ids(only), `chain holds exactly ${ids(only)} (has ${ids(C.clans.map((c) => c.id))})`);
ok(ids(Object.keys(S.clans)) === ids(only), `engine state holds exactly ${ids(only)} (has ${ids(Object.keys(S.clans))})`);
ok(Object.keys(C.agents).every((k) => only.has(Number(k))), "citizens only for those nations");
ok(Object.keys(C.stakes).every((k) => only.has(Number(k.split("|")[0]))), "stakes only for those nations");
ok(Object.keys(S.rev).every((k) => only.has(Number(k))), "reverence only for those nations");
ok(Object.values(S.wars).every((w) => only.has(w.a) && only.has(w.b)), `no war with a nation outside the copy (${Object.keys(S.wars).length} kept)`);
if (fighter) {
  const enemy = fighter.war.enemy;
  ok(only.has(enemy) ? Object.values(S.wars).some((w) => [w.a, w.b].includes(fighter.id)) : !Object.values(S.wars).some((w) => [w.a, w.b].includes(fighter.id)), `${fighter.name}'s war with ${enemy} ${only.has(enemy) ? "kept (both in the copy)" : "left out (its enemy isn't in the copy)"}`);
}
const refs = (x) => ["clan", "buyer", "seller", "a", "b", "against", "from", "target", "by", "winner", "loser", "attacker", "defender"].map((k) => x[k]).filter((v) => typeof v === "number");
let bad = 0, n = 0;
for (const f of fs.readdirSync(`${DIR}/state/testnet`).filter((x) => /^day-\d+\.json$/.test(x))) {
  for (const x of JSON.parse(fs.readFileSync(`${DIR}/state/testnet/${f}`, "utf8"))) { n++; if (refs(x).some((v) => !only.has(v) && v < 1000)) bad++; }
}
ok(n > 0 && bad === 0, `${n} day records kept, ${bad} name a nation outside the copy`);
const fv = Number((BigInt(C.totals.backing) * 10n ** 22n) / BigInt(C.totals.florins)) / 1e24;
const liveFv = W.totals?.florin_value ?? (await api("stakes")).florin_value;
ok(Math.abs(fv - liveFv) / liveFv < 0.02, `florin price is the live one (${fv.toFixed(5)} vs ${liveFv})`);
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
