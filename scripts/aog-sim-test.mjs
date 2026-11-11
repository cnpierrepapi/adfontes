// Act of God on a copy of the live world (never on testnet): seed a fresh copy, then run the real
// engine on the stand-in chain with stand-in minds ($0). Turn 1 settles in; then a god of the poorest
// nation calls fire on the richest (plus two calls the heavens must refuse); turn 2 burns it; turn 3
// lowers the hoarding line so the heavens strike on their own; turn 5 plants a bully war. Exits 1 on any failure.
//   node scripts/aog-sim-test.mjs [dir=debug/sim-aog] [--keep]   (--keep: reuse an existing seed)
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "debug/sim-aog", H = 3600e3;
if (!process.argv.includes("--keep") || !fs.existsSync(`${DIR}/seed.json`)) {
  const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
  if (r.status !== 0) { console.log(r.stdout, r.stderr); process.exit(1); }
}
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
const seedDay = Math.max(0, ...fs.readdirSync(`${DIR}/state/testnet`).filter((f) => /^day-\d+\.json$/.test(f)).map((f) => Number(f.match(/\d+/)[0])));
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
const turn = (k, extra = {}, args = ["--force"]) => {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", ...args], { env: { ...env, ...extra, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 });
  fs.appendFileSync(`${DIR}/aog.log`, `\n===== turn ${k} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); }
  return r.stdout.split("\n").filter((l) => /\[(fire|fire-refused)\]|act of god/.test(l));
};
const chain = () => JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
// The florins a nation can spend, as the engine counts them: its florins less its gods' ring-fenced
// grant (granted NEAR at today's florin value). The copy carries each god's stake (scripts/sim-seed.mjs).
const fl = (C, id) => {
  const c = C.clans.find((x) => x.id === id), all = Number(BigInt(c.florins) / 10n ** 16n) / 1e6;
  const f = BigInt(C.totals.florins), fv = f > 0n ? (BigInt(C.totals.backing) * 10n ** 22n) / f : 0n;
  let reserve = 0;
  if (fv > 0n) for (const g of c.gods || []) { const st = C.stakes?.[`${id}|${g.account}`]; if (st?.granted && BigInt(st.granted) > 0n) reserve += Number((BigInt(st.granted) * 10n ** 6n) / fv) / 1e6; }
  return Math.max(0, all - reserve);
};
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

// The live engine runs an instant turn for a nation seconds after its gods' vote passes. The vote is
// read there and the fire waits for the next scheduled turn (his call 11 Nov: Act of God is turn based).
const inst = turn(2, {}, ["--instant", [poor.id, ...(fighting && other ? [other.id] : [])].join(",")]);
ok(!inst.some((l) => /\[fire/.test(l)), "the instant turn after the vote reads it but burns nothing");
const lines2 = turn(3);
console.log(lines2.map((l) => "   " + l.trim().slice(0, 200)).join("\n"));
C = chain();
const fire = lines2.find((l) => /\[fire\]/.test(l) && l.includes(`"clan":${rich.id}`));
ok(!!fire, `turn 3, the next scheduled turn: fire fell on ${rich.name}, the richest`);
const f = fire ? { pct: Number(/"pct":([\d.]+)/.exec(fire)?.[1]) } : null; // the engine prints records cut at 220 characters
ok(f && f.pct > 0.05 && f.pct <= 0.25, `it burned ${f ? (f.pct * 100).toFixed(1) : "?"}% (5% plus up to 20% by its florins next to the richest, which may be at war; less for walls)`);
ok(fl(C, rich.id) < before.rich - 1, `${rich.name}'s florins on the stand-in chain: ${before.rich.toFixed(1)} -> ${fl(C, rich.id).toFixed(1)}`);
// The caster's price, from the sealed record: a tenth of the damage, burned from its own florins (its
// florins can still end the turn higher: it earns in the same turn).
const dd3 = `${DIR}/state/testnet`, last3 = Math.max(...fs.readdirSync(dd3).filter((x) => /^day-\d+\.json$/.test(x)).map((x) => Number(x.match(/\d+/)[0])));
const fr = JSON.parse(fs.readFileSync(`${dd3}/day-${last3}.json`, "utf8")).find((r) => r.kind === "fire" && r.clan === rich.id);
ok(fr?.cost?.florins > 0 && Math.abs(fr.cost.florins - fr.florins * 0.1) < 0.01, `${poor.name} paid a tenth: ${fr?.cost?.florins} florins for ${fr?.florins} burned`);
ok(lines2.some((l) => /fire-refused/.test(l) && /24 hours/.test(l)), "the same god's second call the same day was refused");
ok(lines2.some((l) => /fire-refused/.test(l) && /own nation/.test(l)), "a call on the god's own nation was refused");
if (fighting && other) ok(lines2.some((l) => /fire-refused/.test(l) && /at war/.test(l)), `a call on ${fighting.name}, which is at war, was refused`);
ok(Math.abs(fl(C, mid.id) - before.mid) < 60, `${mid.name} wasn't burned (only upkeep moved it)`);

const lines3 = turn(4, { ADF_AOG_HOARD: "0.05" });
console.log(lines3.map((l) => "   " + l.trim().slice(0, 200)).join("\n"));
ok(lines3.some((l) => /\[fire\]/.test(l) && /"cause":"hoard"/.test(l)), "turn 4: with the hoarding line lowered, the heavens struck on their own");
ok(lines3.filter((l) => /\[fire\]/.test(l)).length === 1, "and only once");
const lines4 = turn(5);
const log = fs.readFileSync(`${DIR}/aog.log`, "utf8");
const wars = (log.match(/\[war\][^\n]*/g) || []).length, bully = (log.match(/\[fire\][^\n]*"cause":"bully"[^\n]*/g) || []);
console.log(`wars declared on the copy: ${wars}; bully fires: ${bully.length}${bully.length ? "\n   " + bully.join("\n   ").slice(0, 400) : ""}`);
// Turn 4, normal rules: the heavens strike only if a nation at peace holds twice an equal share
// (22% with 9 nations) or half the world is hungry. Any fire must say which.
const n4 = chain().clans.filter((c) => c.alive).length, f4 = lines4.filter((l) => /\[fire\]/.test(l));
ok(f4.every((l) => /"cause":"famine"/.test(l) || (/"cause":"hoard"/.test(l) && Number(/holds (\d+)%/.exec(l)?.[1]) >= Math.floor((200 / n4)))), `turn 4, normal rules: ${f4.length ? "fire only past the line (" + (200 / n4).toFixed(1) + "% with " + n4 + " nations)" : "no fire"}`);
// Turn 5: a bully, planted. The richest nation at peace (with a passed patent) declares on a nation
// at peace with under a third of its florins. Only its council meets (the others are marked as met).
// The fire must hit the attacker, before the war's first battle, for the right amount.
// --rule-off: the same turn with Act of God switched off; the bully checks must then FAIL.
const sp = `${DIR}/state/testnet.json`, S = JSON.parse(fs.readFileSync(sp, "utf8"));
const { eligible, warOf: inWar } = await import("../engine/war.mjs");
const { damage } = await import("../engine/fire.mjs");
C = chain();
const free = C.clans.filter((c) => c.alive && eligible(S, c.id) && !inWar(S, c.id)).sort((a, b) => fl(C, b.id) - fl(C, a.id));
const att = free[0], def = free.filter((c) => fl(C, c.id) * 3.2 <= fl(C, att.id)).at(-1); // the rule says 3x; a little margin
ok(!!(att && def), att && def ? `planted: ${att.name} (${fl(C, att.id).toFixed(1)}) declares on ${def.name} (${fl(C, def.id).toFixed(1)})` : "no nation 3.2x poorer than the richest to pick on");
if (att && def) {
  for (const [id, c] of Object.entries(S.clans)) c.lastCouncilAt = Number(id) === att.id ? 0 : seededAt + 6 * 2 * H; // only its council meets
  fs.writeFileSync(sp, JSON.stringify(S));
  const flAll = Object.fromEntries(C.clans.filter((c) => c.alive).map((c) => [c.id, fl(C, c.id)]));
  const attBefore = flAll[att.id];
  turn(6, { ADF_FAKE_WAR: `${att.id}:${def.id}`, ...(process.argv.includes("--rule-off") ? { ADF_AOG: "off" } : {}) });
  // The turn's sealed records, in order (the printed lines are cut at 220 characters).
  const dd5 = `${DIR}/state/testnet`, last = Math.max(...fs.readdirSync(dd5).filter((f) => /^day-\d+\.json$/.test(f)).map((f) => Number(f.match(/\d+/)[0])));
  const t5 = JSON.parse(fs.readFileSync(`${dd5}/day-${last}.json`, "utf8"));
  const declAt = t5.findIndex((r) => r.kind === "war" && r.attacker === att.id && r.defender === def.id);
  const fireAt = t5.findIndex((r) => r.kind === "fire" && r.cause === "bully" && r.clan === att.id);
  const battleAt = t5.findIndex((r, i) => i > declAt && r.kind === "battle" && r.sides && String(att.id) in r.sides);
  ok(declAt >= 0, `${att.name} declared war on ${def.name}`);
  ok(fireAt > declAt && declAt >= 0, `fire fell on ${att.name}, the attacker, as it declared`);
  ok(!t5.some((r) => r.kind === "fire" && r.clan === def.id), `not on ${def.name}, the defender`);
  ok(fireAt >= 0 && (battleAt < 0 || fireAt < battleAt), `before the war's first battle (fire record ${fireAt}, battle record ${battleAt})`);
  const want = damage(flAll, att.id, S.clans[att.id].walls || 0).florins, got = t5[fireAt]?.florins;
  // The engine uses the florins at the moment of the declaration; earlier in the turn they move a little
  // (mints, upkeep, trades), so the rule's figure from the start of the turn agrees to within 1%.
  ok(fireAt >= 0 && Math.abs(got - want) <= want * 0.01, `burned ${got} florins, the rule on start-of-turn florins says ${want.toFixed(4)} (within 1%)`);
  ok(fireAt >= 0 && Math.abs(fl(chain(), att.id) - (attBefore - got)) < attBefore * 0.15, `${att.name} on the stand-in chain: ${attBefore.toFixed(1)} -> ${fl(chain(), att.id).toFixed(1)} (the fire plus the turn's own spending)`);
}
// No turn on the copy may log an error. Research that misses the paper cache (the copy runs offline) isn't one.
const dd = `${DIR}/state/testnet`, allErrs = fs.readdirSync(dd).filter((f) => /^day-\d+\.json$/.test(f) && Number(f.match(/\d+/)[0]) > seedDay)
  .flatMap((f) => JSON.parse(fs.readFileSync(`${dd}/${f}`, "utf8")).filter((r) => r.kind === "error"));
const errs = allErrs.filter((r) => !/OpenAlex (429|offline)/.test(r.error)), rateLimited = allErrs.length - errs.length;
if (rateLimited) console.log(`(the copy's research missed the paper cache ${rateLimited} times, offline on purpose; not counted)`);
ok(!errs.length, `no errors on any turn of the copy${errs.length ? ": " + errs.slice(0, 3).map((r) => r.error).join(" | ") : ""}`);
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} failed` : "all passed");
