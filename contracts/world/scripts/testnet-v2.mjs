// v2 contract proof on testnet (SPEC §14): florins, jackpot, claims, against the REAL Sputnik
// factory. Usage (from adfontes/): node contracts/world/scripts/testnet-v2.mjs [prefix]
// Makes fresh sub-accounts of the sponsor pool (world, operator, two gods; keys to .keys/, never
// printed), deploys target/near/world.wasm, then: two foundings, a blessing, mint / burn / trade /
// a citizen's storage, a draft, a claim at today's florin value, and the solvency check.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import fs from "node:fs";

const POOL = "adf-pool1-hf0w8.testnet";
const P = process.argv[2] || "v2a";
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const N = (x) => (BigInt(Math.round(x * 1000)) * 10n ** 21n).toString();
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const FL = (fl) => (BigInt(Math.round(fl * 1e6)) * 10n ** 16n).toString(); // florins -> units
const fl = (u) => (Number(BigInt(u) / 10n ** 16n) / 1e6).toFixed(3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (id) => JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8"));
const acct = (id) => new Account(id, provider, keyOf(id).private_key);
const failures = (r) => r.receipts_outcome.filter((o) => o.outcome.status.Failure).map((o) => JSON.stringify(o.outcome.status.Failure).slice(0, 220));
let ok = true;
// A call's failures (empty = it went through); a refused call throws, so catch that too.
const attempt = async (f) => { try { return failures(await f()); } catch (e) { return [String(e.message || e).slice(0, 160)]; } };
const check = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"} ${what}`); if (!cond) ok = false; };

const pool = acct(POOL);
const ids = { world: `${P}.${POOL}`, op: `${P}op.${POOL}`, g1: `${P}g1.${POOL}`, g2: `${P}g2.${POOL}` };
const fund = { world: 6, op: 1, g1: 9, g2: 9 };
for (const [k, id] of Object.entries(ids)) {
  if (fs.existsSync(`.keys/${id}.json`)) continue;
  const kp = KeyPair.fromRandom("ed25519");
  fs.writeFileSync(`.keys/${id}.json`, JSON.stringify({ account_id: id, private_key: kp.toString() }));
  await pool.createSubAccount({ accountOrPrefix: id.split(".")[0], publicKey: kp.getPublicKey().toString(), nearToTransfer: BigInt(N(fund[k])) });
  console.log("made", id, "with", fund[k], "NEAR");
}
await sleep(3000);
const world = acct(ids.world), op = acct(ids.op), g1 = acct(ids.g1), g2 = acct(ids.g2);
const view = (method, args = {}) => provider.callFunction({ contractId: ids.world, method, args });
const opCall = (methodName, args) => op.callFunctionRaw({ contractId: ids.world, methodName, args, gas: "30000000000000" });

// 1. deploy + init (testnet sizes: the factory needs 5.5 NEAR for a DAO)
let cfg = null;
try { cfg = await view("get_config"); } catch {}
if (!cfg) {
  await world.deployContract(fs.readFileSync("contracts/world/target/near/world.wasm"));
  await world.callFunction({
    contractId: ids.world, methodName: "new", gas: "100000000000000",
    args: { owner: ids.world, operator: ids.op, dao_factory: "sputnikv2.testnet", dao_deposit: N(5.5), staking_deposit: N(0.1), min_found: N(6), season_end_ns: String(Date.parse("2026-11-30T23:00:00Z") * 1e6) },
  });
  cfg = await view("get_config");
}
console.log("1. deployed:", JSON.stringify(cfg));

// 2. two foundings through the real factory
const founded = (id) => (clansNow) => clansNow.find((c) => c.alive && c.gods.some((x) => x.account === id));
for (const [g, name] of [[g1, "Proof North"], [g2, "Proof South"]]) {
  if (founded(g.accountId)(await view("list_clans", {}))) { console.log(`   ${name}: already founded by ${g.accountId}`); continue; }
  const r = await g.callFunctionRaw({ contractId: ids.world, methodName: "found_clan", args: { name }, deposit: N(6.5), gas: "300000000000000" });
  check(!failures(r).length, `found ${name} ${failures(r).join(" ")}`);
}
await sleep(3000);
let clans = await view("list_clans", {});
const A = founded(ids.g1)(clans), B = clans.find((c) => c.alive && c.id !== A.id && c.gods[0]?.account === ids.g2);
let t = await view("get_totals");
console.log("2. nations:", clans.map((c) => `${c.id} ${c.name} in ${fmt(c.total_in)} florins ${fl(c.florins)}`).join(" | "));
const netIn = BigInt(A.total_in) + BigInt(B.total_in);
check(BigInt(t.jackpot) === (BigInt(A.total_in) * 1400n) / 10000n + (BigInt(B.total_in) * 1400n) / 10000n, `jackpot = 14% of what was put in (${fmt(t.jackpot)})`);
check(BigInt(t.backing) + BigInt(t.jackpot) === netIn, `backing + jackpot = all NEAR put in (${fmt(t.backing)} + ${fmt(t.jackpot)})`);
check(t.florin_value === N(0.01), `opening price 0.01 NEAR per florin (${fmt(t.florin_value)})`);

// 3. god2 blesses North at today's price
await g2.callFunction({ contractId: ids.world, methodName: "bless", args: { clan_id: A.id }, deposit: N(1), gas: "100000000000000" });
await sleep(3000);
const s2 = await view("get_stake", { clan_id: A.id, account: ids.g2 });
check(Math.abs(Number(fmt(s2.near)) - Number(fmt(s2.put_in)) * 0.86) < 0.002, `god2's stake in North = 86% of their blessing (${fmt(s2.near)} of ${fmt(s2.put_in)})`);

// 4. the operator: a citizen (storage paid in florins), mint, burn, trade, a draft
const before = await view("get_clan", { clan_id: A.id });
let r = await opCall("spawn_agent", { clan_id: A.id, name: `Ilse Varga ${Date.now() % 1e6}`, role: "Scholar" });
check(!failures(r).length, "spawn a citizen");
const afterSpawn = await view("get_clan", { clan_id: A.id });
check(BigInt(afterSpawn.florins) < BigInt(before.florins), `the citizen's storage cost North ${fl(BigInt(before.florins) - BigInt(afterSpawn.florins))} florins`);
r = await opCall("mint", { clan_id: A.id, amount: FL(100), memo: "proof: clean work" });
check(!failures(r).length, "mint 100 florins to North");
check((await attempt(() => opCall("mint", { clan_id: A.id, amount: FL(100.5), memo: "too much" }))).length > 0, "a mint over 100 florins is refused");
r = await opCall("burn", { clan_id: B.id, amount: FL(50), memo: "proof: upkeep" });
check(!failures(r).length, "burn 50 florins of South");
r = await opCall("trade", { buyer: B.id, seller: A.id, amount: FL(4), memo: "proof: corpus" });
check(!failures(r).length, "South buys a corpus from North for 4 florins");
r = await opCall("gift", { clan_id: A.id, draft_hash: "ab".repeat(32), warden_passed: true });
check(!failures(r).length, "record a passed draft");
check((await attempt(() => g1.callFunctionRaw({ contractId: ids.world, methodName: "mint", args: { clan_id: A.id, amount: FL(1), memo: "self" }, gas: "30000000000000" }))).length > 0, "a god can't mint");
check((await attempt(() => world.callFunctionRaw({ contractId: ids.world, methodName: "award_jackpot", args: { clan_id: A.id }, gas: "30000000000000" }))).length > 0, "not even the owner can pay the jackpot before the season ends");

// 5. god2 claims at today's value (North gained: mint, sale)
await sleep(3000);
const s2b = await view("get_stake", { clan_id: A.id, account: ids.g2 });
const bal = async (id) => BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: id })).amount);
const g2Before = await bal(ids.g2);
r = await g2.callFunctionRaw({ contractId: ids.world, methodName: "withdraw", args: { clan_id: A.id }, gas: "200000000000000" } /* same as the site (calls.js GAS.withdraw) */);
check(!failures(r).length, `god2 claims from North ${failures(r).join(" ")}`);
await sleep(4000);
const got = (await bal(ids.g2)) - g2Before;
console.log(`   god2's stake before claiming ${fmt(s2b.near)} (put in ${fmt(s2b.put_in)}); wallet change ${fmt(got)} (minus gas and the 0.01 DAO bond)`);
check(BigInt(s2b.near) > BigInt(s2.near), "god2 gained from North's work before claiming");
check(got > BigInt(s2b.near) - BigInt(N(0.02)), "the claim paid the stake (less bond + gas)");

// 6. solvency
t = await view("get_totals");
const solvent = BigInt(t.balance) >= BigInt(t.liabilities) + BigInt(t.storage_locked);
console.log(`6. balance ${fmt(t.balance)} | liabilities ${fmt(t.liabilities)} (backing ${fmt(t.backing)}, jackpot ${fmt(t.jackpot)}) | storage ${fmt(t.storage_locked)} | florins ${fl(t.florins)} worth ${fmt(t.florin_value)} NEAR each`);
check(solvent, "the world can pay everything it owes");
console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
