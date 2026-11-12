// Phase A turn test (12 Nov): the turn-58 failures, planted on a copy of the live world (never testnet),
// run through the real engine on the stand-in chain with stand-in minds ($0). Exits 1 on any failure.
//   node scripts/gas-holds-sim-test.mjs [dir=debug/sim-gas] [--keep]
// Planted after a settling turn: one Broker at 0.02 NEAR (Helios at turn 58 had 0.0303), one Patron at
// 0.05, one Broker at 0.15 (left alone); on the shelf, a copy the buyer's Broker already HOLDS and a copy
// its nation BOUGHT BEFORE (not minted yet), both the only things it could use, both cheap. The next
// turn must top up the two low wallets, leave the third, and buy neither copy, with no error records.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "debug/sim-gas", H = 3600e3;
if (!process.argv.includes("--keep") || !fs.existsSync(`${DIR}/seed.json`)) {
  fs.rmSync(DIR, { recursive: true, force: true });
  const r = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
  if (r.status !== 0) { console.log(r.stdout, r.stderr); process.exit(1); }
}
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
delete env.SPONSOR_ACCOUNT_ID; delete env.SPONSOR_PRIVATE_KEY; delete env.OPERATOR_PRIVATE_KEY;
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const turn = (k) => {
  const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", "--force"], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 });
  fs.appendFileSync(`${DIR}/gas.log`, `\n===== turn ${k} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) { console.log(r.stderr.slice(-1500)); process.exit(1); }
};
const C = () => JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
const ST = () => JSON.parse(fs.readFileSync(`${DIR}/state/testnet.json`, "utf8"));
const dayFile = (d) => JSON.parse(fs.readFileSync(`${DIR}/state/testnet/day-${d}.json`, "utf8"));

fs.writeFileSync(`${DIR}/gas.log`, "");
turn(1);
let chain = C(), s = ST();
const alive = chain.clans.filter((c) => c.alive && s.clans[c.id] && !s.clans[c.id].fallen).map((c) => c.id);
const [low, lowP, fine, buyer] = alive;
// Two copies the buyer could use: research by other nations on points it doesn't know.
const usable = Object.values(s.corpora || {}).filter((k) => k.clan !== buyer && s.clans[k.clan] && !s.clans[buyer].owned[k.node]);
ok(usable.length >= 2, `the copy has research the buyer (${buyer}) lacks: ${usable.length}`);
const [held, boughtBefore] = usable;
const T = (k) => `r:${k.id}`;
chain.gas = { ...(chain.gas || {}), [`trader${low}.sim-operator`]: 0.02, [`patron${lowP}.sim-operator`]: 0.05, [`trader${fine}.sim-operator`]: 0.15 };
chain.mt ||= {};
chain.mt[`trader${buyer}.sim-operator|${T(held)}`] = "1";
chain.market ||= { listings: [], sales: [] };
// Close every other open listing so these two are the only things on the shelf.
for (const l of chain.market.listings) l.open = false;
for (const k of [held, boughtBefore]) chain.market.listings.push({ id: chain.market.listings.length, seller: k.clan, token_id: T(k), price: 0.01, kind: "copy", open: true, day: chain.config.day, reason: "test", sold: 0 });
chain.market.sales.push({ id: chain.market.sales.length, listing: chain.market.listings.length - 1, buyer, seller: boughtBefore.clan, token_id: T(boughtBefore), price: 0.01, day: chain.config.day, reason: "earlier" });
fs.writeFileSync(`${DIR}/chain.json`, JSON.stringify(chain));
// The buyer's market day is due now; no direct deal this turn may short-cut it.
s.clans[buyer].lastMarketAt = 0;
fs.writeFileSync(`${DIR}/state/testnet.json`, JSON.stringify(s));
const salesBefore = chain.market.sales.length;

turn(2);
chain = C(); s = ST();
const recs = dayFile(s.day).records || dayFile(s.day);
const gas = recs.filter((r) => r.kind === "gas");
ok(gas.some((r) => r.clan === low && r.role === "Broker") && chain.gas[`trader${low}.sim-operator`] >= 0.1, `Broker of ${low} at 0.02 was topped up (now ${chain.gas[`trader${low}.sim-operator`]})`);
ok(gas.some((r) => r.clan === lowP && r.role === "Patron") && chain.gas[`patron${lowP}.sim-operator`] >= 0.1, `Patron of ${lowP} at 0.05 was topped up`);
ok(!gas.some((r) => r.clan === fine && r.role === "Broker"), `Broker of ${fine} at 0.15 was left alone`);
const errs = recs.filter((r) => r.kind === "error");
ok(errs.length === 0, `no error records (${errs.map((e) => e.error).join(" | ") || "none"})`);
const newSales = chain.market.sales.slice(salesBefore).filter((x) => x.buyer === buyer && [T(held), T(boughtBefore)].includes(x.token_id));
ok(newSales.length === 0, `the buyer bought neither copy it already had (${newSales.length})`);
ok(!recs.some((r) => /already have/i.test(JSON.stringify(r))), "no 'already have that' anywhere in the turn");
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
