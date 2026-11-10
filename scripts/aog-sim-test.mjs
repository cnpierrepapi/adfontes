// Act of God on a copy of the live world (never on testnet): seed a fresh copy, then run the real
// engine on the stand-in chain with stand-in minds ($0). Turn 1 settles in; then a god of the poorest
// nation calls fire on the richest (plus two calls the heavens must refuse); turn 2 burns it; turn 3
// lowers the hoarding line so the heavens strike on their own. Exits 1 on any failure.
//   node scripts/aog-sim-test.mjs [dir=debug/sim-aog] [--keep]   (--keep: reuse an existing seed)
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "debug/sim-aog", H = 3600e3;
if (!process.argv.includes("--keep") || !fs.existsSync(`${DIR}/seed.json`)) {
  const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
  if (r.status !== 0) { console.log(r.stdout, r.stderr); process.exit(1); }
}
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1" };
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
const turn = (k, extra = {}) => {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ...extra, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 });
  fs.appendFileSync(`${DIR}/aog.log`, `\n===== turn ${k} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); }
  return r.stdout.split("\n").filter((l) => /\[(fire|fire-refused)\]|act of god/.test(l));
};
const chain = () => JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
const fl = (C, id) => Number(BigInt(C.clans.find((c) => c.id === id).florins) / 10n ** 16n) / 1e6;
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };

fs.writeFileSync(`${DIR}/aog.log`, "");
turn(1);
let C = chain();
const standing = C.clans.filter((c) => c.alive);
// Nations at war can't be struck: take the war map from the site (the copy was seeded from it).
const warOf = Object.fromEntries((await (await fetch("https://adfontes.fun/api/world?net=testnet")).json()).clans.map((c) => [c.id, c.war?.enemy ?? null]));
const byFl = [...standing].sort((a, b) => fl(C, b.id) - fl(C, a.id));
const fighting = byFl.find((c) => warOf[c.id] != null);
const peace = byFl.filter((c) => warOf[c.id] == null);
const rich = peace[0], poor = peace.at(-1), mid = peace[2];
const god = poor.gods[0].account;
console.log(`richest ${rich.name} ${fl(C, rich.id).toFixed(1)} florins; caster ${poor.name} ${fl(C, poor.id).toFixed(1)}, god ${god}`);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const dao = ((C.daos ||= {})[poor.dao] ||= []);
const propose = (point, who = god) => dao.push({ id: dao.length, proposer: who, status: "Approved", description: "act of god (test)", kind: { FunctionCall: { receiver_id: "sim.local", actions: [{ method_name: "root_out", args: b64({ clan_id: poor.id, point }), deposit: "0", gas: "30000000000000" }] } } });
propose(`act of god: ${rich.id}`); // goes through
propose(`act of god: ${mid.id}`); // same god, same day: refused
propose(`act of god: ${poor.id}`, poor.gods.at(-1).account); // own nation: refused
const other = C.clans.find((c) => c.alive && c.id !== poor.id && c.gods.length && c.gods[0].account !== god && warOf[c.id] == null && c.id !== rich.id);
if (fighting && other) ((C.daos[other.dao] ||= [])).push({ id: C.daos[other.dao].length, proposer: other.gods[0].account, status: "Approved", description: "act of god (test)", kind: { FunctionCall: { receiver_id: "sim.local", actions: [{ method_name: "root_out", args: b64({ clan_id: other.id, point: `act of god: ${fighting.id}` }), deposit: "0", gas: "30000000000000" }] } } });
fs.writeFileSync(`${DIR}/chain.json`, JSON.stringify(C));
const before = { rich: fl(C, rich.id), poor: fl(C, poor.id), mid: fl(C, mid.id) };

const lines2 = turn(2);
console.log(lines2.map((l) => "   " + l.trim().slice(0, 200)).join("\n"));
C = chain();
const fire = lines2.find((l) => /\[fire\]/.test(l) && l.includes(`"clan":${rich.id}`));
ok(!!fire, `turn 2: fire fell on ${rich.name}, the richest`);
const f = fire ? { pct: Number(/"pct":([\d.]+)/.exec(fire)?.[1]) } : null; // the engine prints records cut at 220 characters
ok(f && f.pct > 0.05 && f.pct <= 0.25, `it burned ${f ? (f.pct * 100).toFixed(1) : "?"}% (5% plus up to 20% by its florins next to the richest, which may be at war; less for walls)`);
ok(fl(C, rich.id) < before.rich - 1, `${rich.name}'s florins on the stand-in chain: ${before.rich.toFixed(1)} -> ${fl(C, rich.id).toFixed(1)}`);
ok(fl(C, poor.id) < before.poor, `${poor.name} paid for it: ${before.poor.toFixed(1)} -> ${fl(C, poor.id).toFixed(1)}`);
ok(lines2.some((l) => /fire-refused/.test(l) && /24 hours/.test(l)), "the same god's second call the same day was refused");
ok(lines2.some((l) => /fire-refused/.test(l) && /own nation/.test(l)), "a call on the god's own nation was refused");
if (fighting && other) ok(lines2.some((l) => /fire-refused/.test(l) && /at war/.test(l)), `a call on ${fighting.name}, which is at war, was refused`);
ok(Math.abs(fl(C, mid.id) - before.mid) < 60, `${mid.name} wasn't burned (only upkeep moved it)`);

const lines3 = turn(3, { ADF_AOG_HOARD: "0.05" });
console.log(lines3.map((l) => "   " + l.trim().slice(0, 200)).join("\n"));
ok(lines3.some((l) => /\[fire\]/.test(l) && /"cause":"hoard"/.test(l)), "turn 3: with the hoarding line lowered, the heavens struck on their own");
ok(lines3.filter((l) => /\[fire\]/.test(l)).length === 1, "and only once");
const lines4 = turn(4);
const log = fs.readFileSync(`${DIR}/aog.log`, "utf8");
const wars = (log.match(/\[war\][^\n]*/g) || []).length, bully = (log.match(/\[fire\][^\n]*"cause":"bully"[^\n]*/g) || []);
console.log(`wars declared on the copy: ${wars}; bully fires: ${bully.length}${bully.length ? "\n   " + bully.join("\n   ").slice(0, 400) : ""}`);
ok(!lines4.some((l) => /\[fire\]/.test(l)), "turn 4, normal rules on this world: no fire");
// Turn 5: every war council meets (they meet once a real day; the copy is only hours old), so a
// nation can declare. Any declaration on a nation with a third of the attacker's florins or less must
// bring fire on the attacker before the war's first battle.
const sp = `${DIR}/state/testnet.json`, S = JSON.parse(fs.readFileSync(sp, "utf8"));
for (const c of Object.values(S.clans)) c.lastCouncilAt = 0;
fs.writeFileSync(sp, JSON.stringify(S));
turn(5);
const t5 = fs.readFileSync(`${DIR}/aog.log`, "utf8").split("===== turn 5")[1] || "";
const t5lines = t5.split("\n");
const decl = t5lines.map((l, i) => ({ l, i })).filter((x) => /\[war\]/.test(x.l));
console.log(`turn 5: ${decl.length} war(s) declared`);
for (const d of decl) {
  const att = Number(/"attacker":(\d+)/.exec(d.l)?.[1]), def = Number(/"defender":(\d+)/.exec(d.l)?.[1]);
  const fireAt = t5lines.findIndex((l) => /\[fire\]/.test(l) && /"cause":"bully"/.test(l) && l.includes(`"clan":${att},`));
  const battleAt = t5lines.findIndex((l, i) => i > d.i && /\[battle\]/.test(l));
  console.log(`   war ${att} on ${def}: bully fire at line ${fireAt}, first battle at line ${battleAt}`);
  if (fireAt >= 0) ok(battleAt < 0 || fireAt < battleAt, `nation ${att} burned as it declared, before its first battle`);
}
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} failed` : "all passed");
