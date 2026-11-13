// PLAN_13NOV steps 2-3 end to end, on a copy of the live world (never testnet), stand-in minds ($0): a god asks the
// accused of a report and asks its Broker to list its own research; ONE instant turn (what the loop runs within
// seconds) answers the report and lists the items at the god's word, and nothing errors. Then a god under 30
// reverence is ignored. Exits 1 on any failure.   node scripts/step23-sim-test.mjs [dir=debug/sim-step23]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "debug/sim-step23", H = 3600e3;
fs.rmSync(DIR, { recursive: true, force: true });
const seed = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
if (seed.status !== 0) { console.log(seed.stdout, seed.stderr); process.exit(1); }
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
Object.assign(process.env, env);
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const run = (args, k) => { const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", ...args], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 }); if (r.status !== 0) { console.log(r.stdout.slice(-1500), r.stderr.slice(-1500)); process.exit(1); } return r.stdout; };
const STF = `${DIR}/state/testnet.json`;
const ST = () => JSON.parse(fs.readFileSync(STF, "utf8"));
const save = (s) => fs.writeFileSync(STF, JSON.stringify(s));

run(["--force"], 1);
const store = await import("../engine/store.mjs");
const MK = await import("../engine/market.mjs");
const { florinRates } = await import("../engine/config.mjs");
const C = JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
let s = ST();
const FL = florinRates("testnet");
// A living nation at peace whose Broker has its own research to sell and a wallet.
const atWar = (id) => Object.values(s.wars || {}).some((w) => w.status === "on" && (w.a === id || w.b === id));
const id = C.clans.filter((c) => c.alive && s.clans[c.id] && !s.clans[c.id].fallen && !atWar(c.id) && s.clans[c.id].agentWallets === 2).map((c) => c.id).find((cid) => MK.sellable(s, cid, FL).some((x) => x.token_id[0] === "r"));
if (id == null) { console.log("FAIL no nation with research to sell on this copy"); process.exit(1); }
const god = C.clans.find((c) => c.id === id).gods[0].account;
const agents = (C.agents?.[id] || []).filter((a) => a.alive);
const accused = agents.find((a) => a.role !== "Trickster" && (a.stunted_until ?? 0) <= s.day + 1)?.name, accuser = agents.find((a) => a.name !== accused)?.name;
// Plant one open report and full reverence for this god (a copy: the dice must listen, reverence/100 = 1).
const rid = `r${s.day}-${id}`;
for (const r of Object.values(s.reports || {})) if (r.clan === id) r.settled = true;
(s.reports ||= {})[rid] = { id: rid, clan: id, day: s.day, accuser, accused, kind: "fake", claim: `${accuser} says ${accused} faked a citation`, truth: false, settled: false };
s.rev[id].gods[god].r = 100;
save(s);
const tokens = MK.sellable(s, id, FL).filter((x) => x.token_id[0] === "r").slice(0, 2).map((x) => x.token_id);
await store.putChoice("testnet", { day: s.day + 1, clan: id, kind: "ask", account: god, payload: { report: rid } });
await store.putChoice("testnet", { day: s.day + 1, clan: id, kind: "list", account: god, payload: { tokens } });
console.log(`nation ${id}, god ${god.slice(0, 24)}, report ${rid} (${accused}), list ${tokens.join(", ")}`);

const before = (ST().pending || []).length;
run(["--instant", String(id), "--no-research", String(id)], 1.2);
s = ST();
const recs = (s.pending || []).slice(before);
const k = (kind) => recs.filter((r) => r.kind === kind && (r.clan === id));
ok(k("asked").length === 1 && k("answer").length === 1 && k("answer")[0].says, `one instant turn: asked, and ${accused} answered ("${k("answer")[0]?.says}")`);
ok(!!s.reports[rid].answer && !s.reports[rid].settled, "the report is answered and still open (the god decides now)");
const bw = k("broker-word")[0];
ok(bw?.listens === true && bw.listing.length === tokens.length, `the Broker heeded a god at 100 reverence: ${JSON.stringify(bw?.listing)}`);
const listed = k("listed").filter((r) => r.asked_by === god);
ok(listed.length === tokens.length && listed.every((r) => /^At its god's word/.test(r.why)), "each asked item is on the market, its reason says it's at its god's word");
ok(listed.every((r) => s.godListed?.[r.listing]?.god === god), "each god-asked listing is remembered for the reward");
const shelf = JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
ok(tokens.every((t) => (shelf.market?.listings || []).some((l) => l.token_id === t && l.seller === id && l.open !== false)), "the copy's market holds the listings, open");
ok(!recs.some((r) => r.kind === "error"), `no error records (${recs.filter((r) => r.kind === "error").map((r) => r.error).join(" | ")})`);

// The same request again in the same turn: heard once, nothing listed twice.
const before2 = (ST().pending || []).length;
run(["--instant", String(id), "--no-research", String(id)], 1.3);
const recs2 = (ST().pending || []).slice(before2);
ok(!recs2.some((r) => r.kind === "listed" && r.asked_by) && !recs2.some((r) => r.kind === "broker-word"), "the same request isn't heard twice; nothing listed twice");

// A god under 30 reverence asks: ignored.
s = ST(); s.rev[id].gods[god].r = 10; save(s);
const more = MK.sellable(s, id, FL).filter((x) => x.token_id[0] !== "r" || !tokens.includes(x.token_id)).slice(0, 1).map((x) => x.token_id);
if (more.length) {
  await store.putChoice("testnet", { day: s.day + 1, clan: id, kind: "list", account: god, payload: { tokens: more } });
  const before3 = (ST().pending || []).length;
  run(["--instant", String(id), "--no-research", String(id)], 1.4);
  const recs3 = (ST().pending || []).slice(before3);
  const w3 = recs3.find((r) => r.kind === "broker-word");
  ok(w3?.listens === false && w3.ignored === true && !recs3.some((r) => r.kind === "listed" && r.asked_by), "a god under 30 reverence is ignored, nothing listed");
} else console.log("(skipped the low-reverence check: nothing else to list)");
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
