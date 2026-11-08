// The fast-forward simulation's report: what a week did to the world (scripts/sim-week.mjs).
import fs from "node:fs";

const S = JSON.parse(fs.readFileSync("debug/sim/state/testnet.json", "utf8"));
const C = JSON.parse(fs.readFileSync("debug/sim/chain.json", "utf8"));
const before = JSON.parse(fs.readFileSync("debug/sim-before-world.json", "utf8"));
const dir = "debug/sim/state/testnet";
const days = fs.readdirSync(dir).filter((f) => /^day-\d+\.json$/.test(f)).map((f) => Number(f.match(/\d+/)[0])).sort((a, b) => a - b);
const recs = days.flatMap((d) => JSON.parse(fs.readFileSync(`${dir}/day-${d}.json`, "utf8")).map((r) => ({ ...r, day: d })));
const name = (id) => C.clans.find((c) => c.id === Number(id))?.name ?? `nation ${id}`;
const fl = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;
const count = (k) => recs.filter((r) => r.kind === k).length;

console.log(`\nSIMULATED WEEK: turns ${days[0]}–${days.at(-1)} (${days.length} turns), ${recs.length} records\n`);
console.log("NATIONS (before → after)");
for (const c of C.clans) {
  const st = S.clans[c.id] || {}, b = before.clans.find((x) => x.id === c.id) || {};
  const pts = Object.keys(st.owned || {}).length, agents = (C.agents[c.id] || []).filter((a) => a.alive).length;
  const status = st.fallen ? `FALLEN on turn ${st.fallen.day} to ${name(st.fallen.by)}` : c.alive ? "standing" : "dead";
  console.log(`  ${c.name.padEnd(16)} knowledge ${String(b.points ?? "?").padStart(3)} → ${String(pts).padStart(3)} | florins ${String(Math.round(b.florins ?? 0)).padStart(5)} → ${String(Math.round(fl(c.florins))).padStart(5)} | techs ${b.techs?.length ?? "?"} → ${(st.techs || []).length} | citizens ${agents} | walls ${(st.walls || 0).toFixed(1)} | mood ${st.mood ?? "?"} | ${status}`);
}
const rv = Object.entries(S.rev || {}).map(([id, r]) => [name(id), r.followed ? (r.gods[r.followed]?.r ?? 0) : 0]).sort((a, b) => b[1] - a[1]);
console.log(`\nSTANDINGS (reverence, for the jackpot): ${rv.map(([n, v], i) => `${i + 1}. ${n} ${v.toFixed(1)}`).join(" · ")}`);

console.log("\nWARS");
for (const w of Object.values(S.wars || {})) {
  const end = w.status === "won" ? `${name(w.winner)} won on turn ${w.endedDay}` : w.status === "peace" ? `peace on turn ${w.endedDay}` : `still on (${w.rounds} rounds)`;
  console.log(`  ${name(w.a)} vs ${name(w.b)}: declared turn ${w.startedDay} — ${end}. "${(w.reason || "").slice(0, 140)}"`);
}
const weapons = {};
for (const r of recs.filter((x) => x.kind === "battle")) for (const sd of Object.values(r.sides)) weapons[sd.weapon] = (weapons[sd.weapon] || 0) + 1;
console.log(`  weapons fired: ${Object.entries(weapons).map(([w, n]) => `${w} ${n}`).join(", ") || "none"}`);
console.log(`  councils: ${count("council")} holds/refusals, ${count("war")} declarations, ${count("fortify")} fortifications, ${count("peace-offer")} peace offers, ${count("peace")} peaces, ${count("fallen")} falls`);
for (const r of recs.filter((x) => ["war", "fortify", "peace-offer", "peace", "fallen"].includes(x.kind)).slice(0, 14))
  console.log(`    turn ${r.day} ${r.kind}: ${r.kind === "war" ? `${name(r.attacker)} → ${name(r.defender)}` : r.kind === "fallen" ? `${r.name} fell to ${r.byName}, loot ${r.loot}` : name(r.clan ?? r.a)} ${r.reason ? `"${r.reason.slice(0, 110)}"` : ""}`);
const refused = recs.filter((x) => x.kind === "council" && x.refused);
if (refused.length) console.log(`  refused by the rules: ${refused.length} (e.g. ${refused.slice(0, 3).map((r) => `${name(r.clan)} wanted to ${r.action}: ${r.refused}`).join("; ")})`);

console.log("\nECONOMY");
console.log(`  research pieces ${count("corpus")} (${recs.filter((r) => r.kind === "corpus" && r.fake).length} with made-up citations) · trades ${count("trade")} · Broker passes ${count("broker")} · drafts ${recs.filter((r) => r.kind === "gift").length} (${recs.filter((r) => r.kind === "gift" && r.passed).length} passed) · Warden fines ${count("warden")} · techs ${count("tech")} · Tricksters ${count("trickster")}`);
const tr = {};
for (const r of recs.filter((x) => x.kind === "trade" && !x.tool)) { const k = `${name(r.buyer)} ← ${name(r.seller)}`; tr[k] = (tr[k] || 0) + 1; }
console.log(`  busiest trade routes: ${Object.entries(tr).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(", ")}`);
console.log(`  florins in the world: ${fl(before.totals ? 0 : 0) || ""}${Math.round(fl(C.totals.florins))} (minted ${Math.round(fl(C.totals.minted))}, burned ${Math.round(fl(C.totals.burned))} all-time)`);
for (const r of recs.filter((x) => x.kind === "tech")) console.log(`    turn ${r.day}: ${name(r.clan)} got ${r.name ?? r.tech}`);

const spend = (() => { try { return JSON.parse(fs.readFileSync("debug/sim/state/llm_spend.json", "utf8")); } catch { return {}; } })();
console.log(`\nCLAUDE: $${Object.values(spend).reduce((a, b) => a + b, 0).toFixed(3)} for the week (${Object.entries(spend).map(([d, v]) => `${d.slice(5)} $${v.toFixed(3)}`).join(", ")})`);
const errs = recs.filter((r) => r.kind === "error");
console.log(`ERRORS: ${errs.length}${errs.length ? ": " + [...new Set(errs.map((e) => e.error.slice(0, 80)))].slice(0, 5).join(" | ") : ""}\n`);
