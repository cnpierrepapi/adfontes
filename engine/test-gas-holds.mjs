// Phase A (12 Nov, tests written before the code): turn 58 failed twice on Helios's Broker running out
// of gas (0.0303 NEAR, a tx needs ~0.031) and once on Striklar's Broker buying a copy it already had.
// 1. Gas: below 0.1 NEAR spendable, top up to 0.2 (his rule: every turn, under 0.1).
// 2. "Already has it" = holds the token now OR bought it before (the contract remembers every buyer:
//    contracts/world/src/market.rs `mk:b:`), checked once, for every buy path.
// 3. The stand-in chain behaves like NEAR on both, so sims and turn tests can catch these.
// 4. Every market buy in run.mjs goes through the one checked function.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as MK from "./market.mjs";
import { connectSim as makeSimChain } from "./chain-sim.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const fails = async (p, re) => { try { await p; return false; } catch (e) { return re.test(String(e.message || e)); } };

// 1. The top-up rule.
ok(MK.gasTopUp(0.0303) === +(0.2 - 0.0303).toFixed(6), "a wallet at 0.0303 NEAR (Helios, turn 58) is topped up to 0.2");
ok(MK.gasTopUp(0.0999) > 0 && MK.gasTopUp(0.1) === 0 && MK.gasTopUp(0.15) === 0, "under 0.1 tops up; 0.1 and above doesn't");
ok(MK.gasTopUp(0) === 0.2, "an empty wallet gets 0.2");

// 3. The stand-in chain, like NEAR.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-gas-"));
const file = path.join(dir, "chain.json");
const S0 = {
  config: { day: 5 }, totals: { florins: "0", backing: "0", burned: "0" }, nextGift: 0, gifts: {},
  clans: [1, 2, 3].map((id) => ({ id, name: `N${id}`, alive: true, florins: (1000n * 10n ** 22n).toString(), gods: [] })),
  wallets: { "1:Broker": "trader1.sim-operator", "2:Broker": "trader2.sim-operator", "3:Broker": "trader3.sim-operator", "1:Patron": "patron1.sim-operator" },
  gas: { "trader1.sim-operator": 0.0303, "trader2.sim-operator": 0.5, "trader3.sim-operator": 0.5, "patron1.sim-operator": 0.15 },
  mt: { "trader1.sim-operator|r:c1": "1", "trader2.sim-operator|r:c9": "1" },
  market: { listings: [], sales: [] },
};
fs.writeFileSync(file, JSON.stringify(S0));
const chain = makeSimChain(file);
ok(await fails(chain.marketList(1, "r:c1", 2, "test"), /Not enough balance for trader1/), "a Broker under a transaction's worst-case cost (~0.031 NEAR) is refused, as on NEAR");
ok(await chain.ensureGas(1, "Broker") > 0, "ensureGas tops up the Broker under 0.1");
ok(await chain.ensureGas(1, "Patron") === 0, "ensureGas leaves a Patron at 0.15 alone");
const L = await chain.marketList(1, "r:c1", 2, "test");
ok(L.value === 0, "after the top-up the same Broker can list");
const B = await chain.marketBuy(2, L.value, "test").catch((e) => ({ error: String(e.message || e) }));
ok(B.value === 0 && !B.error, `a nation that never had it can buy (${B.error || "bought"})`);
const L2 = await chain.marketList(2, "r:c9", 2, "test");
// Nation 3 buys r:c9 once, then (copy not yet minted, as on NEAR) tries again: refused.
await chain.marketBuy(3, L2.value, "first");
ok(await fails(chain.marketBuy(3, L2.value, "again"), /You already have that/), "a Broker that bought a copy before is refused, even before its copy is minted");
fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), mt: { ...JSON.parse(fs.readFileSync(file, "utf8")).mt, "trader1.sim-operator|r:c9": "1" } }));
const chain2 = makeSimChain(file);
ok(await fails(chain2.marketBuy(1, L2.value, "held"), /You already have that/), "a Broker that holds the token is refused");

// 2. The one check, both ways.
const sales = (await chain2.marketSales(0)) || [];
ok(await MK.alreadyHas(chain2, 1, "r:c9", sales) === true, "alreadyHas: held now");
ok(await MK.alreadyHas(chain2, 3, "r:c9", sales) === true, "alreadyHas: bought before, copy not minted yet");
ok(await MK.alreadyHas(chain2, 2, "r:c1", sales) === true, "alreadyHas: nation 2 bought r:c1 above");
ok(await MK.alreadyHas(chain2, 3, "r:c1", sales) === false, "alreadyHas: nation 3 neither holds nor bought r:c1");
ok(await MK.alreadyHas(chain2, 3, "p:d1", sales) === false, "alreadyHas: a patent nobody bought");

// 4. One door for every market buy in run.mjs.
const src = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
const calls = src.match(/chain\.marketBuy\(/g) || [];
ok(calls.length === 1 && /async function buyChecked\([^)]*\)\s*\{[\s\S]{0,600}?MK\.alreadyHas\([\s\S]{0,400}?chain\.marketBuy\(/.test(src), `every market buy goes through buyChecked, which asks MK.alreadyHas first (${calls.length} direct marketBuy call(s))`);
const gasAtStart = /for \(const role of \["Broker", "Patron"\]\)[\s\S]{0,300}chain\.ensureGas\(/.test(src) && !/!INSTANT && chain\.ensureGas/.test(src);
ok(gasAtStart, "both agent wallets get the gas check every turn, instant turns too");
fs.rmSync(dir, { recursive: true, force: true });
// The real chain uses the same tested rule (the turn-58 threshold of 0.03 lived here).
const csrc = fs.readFileSync(new URL("./chain.mjs", import.meta.url), "utf8");
ok(/async ensureGas\(clanId, role\) \{[\s\S]{0,500}gasTopUp\(spendable\)/.test(csrc) && !/min = 0\.03/.test(csrc), "chain.mjs ensureGas tops up by gasTopUp on spendable NEAR");
