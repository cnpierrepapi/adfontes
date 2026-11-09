// Proves grants and the founding fund (his calls 9 Nov) on a testnet world (default v2d), then, with
// "w6", only upgrades the live world and checks nothing moved. On a test world:
//   1. upgrade (state, florins, backing, jackpot, tokens and market unchanged)
//   2. grant: the operator credits a founder 0.5 NEAR: backing +0.5, jackpot and florin value
//      unchanged, the founder's stake +0.5, recorded as granted, put_in untouched
//   3. refusals: a stranger can't grant; a grant only goes to a god of that nation
//   4. the founding fund pays a real Sputnik DAO: a nation founded with 1.5 NEAR (under the usual 6)
//      gets all of it as florins, less storage, and the fund drops by DAO + staking
// Prints no key.   node scripts/funding-proof.mjs [v2d|w6]
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const which = process.argv[2] || "v2d", live = which === "w6";
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://near-testnet.drpc.org" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) { fails++; process.exitCode = 1; } };
const view = (method, args = {}) => provider.callFunction({ contractId: WORLD, method, args });
const N = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
const NEAR = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 18n;
const acct = (id) => { const k = keyOf(id); return new Account(k.account_id, provider, k.private_key); };
const call = async (a, methodName, args, deposit = 0n, gas = 100n) => {
  const r = await a.callFunctionRaw({ contractId: WORLD, methodName, args, deposit, gas: gas * 10n ** 12n });
  const f = r.receipts_outcome.find((o) => o.outcome.status.Failure);
  if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300));
  const v = r.status.SuccessValue;
  return { hash: r.transaction.hash, value: v ? JSON.parse(Buffer.from(v, "base64").toString() || "null") : null };
};
const refuse = async (label, expected, fn) => {
  try { await fn(); ok(false, `${label}: it went through`); }
  catch (e) { const m = String(e.message); ok(m.includes(expected), `${label}: "${m.includes(expected) ? expected : m.slice(0, 160)}"`); }
};

// 1. Upgrade (state stays). "Is it there?" = a view only the new code has.
const has = await view("get_founding").then(() => true, (e) => { if (!/method is not found|MethodNotFound|CodeDoesNotExist/i.test(String(e.message))) throw e; return false; });
const snap = async () => {
  const [clans, t, mt, mk] = await Promise.all([view("list_clans", { limit: 100 }), view("get_totals"), view("mt_count"), view("market_count")]);
  return { clans: JSON.stringify(clans), florins: t.florins, backing: t.backing, jackpot: t.jackpot, mt: JSON.stringify(mt), mk: JSON.stringify(mk) };
};
const before = await snap();
if (!has) { await acct(WORLD).deployContract(fs.readFileSync("contracts/world/target/near/world.wasm")); await wait(4000); }
const after = await snap();
ok(JSON.stringify(before) === JSON.stringify(after), `${which}: ${has ? "already on" : "upgraded to"} the grants + founding fund contract; nations, florins, backing, jackpot, tokens and market unchanged`);
const t0 = await view("get_totals");
ok(BigInt(t0.balance) >= BigInt(t0.liabilities) + BigInt(t0.storage_locked), `${which}: still holds everything it owes plus its storage`);
const [fund0, min0] = await view("get_founding");
console.log(`  founding fund ${N(fund0)} NEAR; a founder needs ${N(min0)} NEAR right now`);
if (live) process.exit();

// 2. A grant to the first nation's founder.
const op = acct(`${which}op.adf-pool1-hf0w8.testnet`);
const [A] = (await view("list_clans", { limit: 100 })).filter((c) => c.alive);
const god = A.gods[0].account;
const s0 = await view("get_stake", { clan_id: A.id, account: god }), tA = await view("get_totals");
await call(op, "grant", { clan_id: A.id, god }, NEAR(0.5));
await wait(3000);
const s1 = await view("get_stake", { clan_id: A.id, account: god }), tB = await view("get_totals");
ok(BigInt(tB.backing) - BigInt(tA.backing) === NEAR(0.5), `backing +0.5 NEAR (${N(tA.backing)} -> ${N(tB.backing)})`);
ok(tB.jackpot === tA.jackpot, "no jackpot cut");
ok(Math.abs(N(tB.florin_value) - N(tA.florin_value)) < 1e-6, `the florin's value didn't move (${N(tB.florin_value)})`);
ok(Math.abs(N(s1.near) - N(s0.near) - 0.5) < 0.001, `${god}'s stake +0.5 NEAR (${N(s0.near)} -> ${N(s1.near)})`);
ok(BigInt(s1.granted) - BigInt(s0.granted) === NEAR(0.5) && s1.put_in === s0.put_in, "recorded as granted; put_in untouched");

// 3. Refusals.
await refuse("a stranger can't grant", "Only the owner or operator", () => call(acct(`${which}g2.adf-pool1-hf0w8.testnet`), "grant", { clan_id: A.id, god }, NEAR(0.01)));
await refuse("a grant only goes to a god of that nation", "Not a god of that nation", () => call(op, "grant", { clan_id: A.id, god: op.accountId }, NEAR(0.01)));

// 4. The founding fund pays a real DAO.
const cfg = await view("get_config"), costs = BigInt(cfg.dao_deposit) + BigInt(cfg.staking_deposit);
const pool = acct("adf-pool1-hf0w8.testnet");
let [fund] = await view("get_founding");
if (BigInt(fund) < costs) { await call(pool, "fund_founding", {}, costs + NEAR(0.1) - BigInt(fund)); await wait(3000); [fund] = await view("get_founding"); }
const [, min] = await view("get_founding");
ok(N(min) === 1, `with the fund full (${N(fund)} NEAR) a founder needs only ${N(min)} NEAR, not ${N(cfg.min_found)}`);
const founder = acct(`${which}g2.adf-pool1-hf0w8.testnet`);
const name = `Funded ${Date.now().toString(36)}`;
const nBefore = (await view("list_clans", { limit: 100 })).length;
// A long transaction (it creates a DAO): the RPC sometimes answers 500 though it landed. Read the
// world to find out (playbook: never treat an RPC error as a failed transaction).
try { await call(founder, "found_clan", { name }, NEAR(1.5), 300n); }
catch (e) { if (!/Internal server error|timeout|50\d/i.test(String(e.message))) throw e; console.log("  (the RPC didn't wait for the founding; reading the world instead)"); }
await wait(8000);
const made = (await view("list_clans", { limit: 100 })).find((c) => c.name === name);
ok(!!made, `"${name}" founded with 1.5 NEAR; its DAO ${made?.dao ?? "(none)"}`);
if (made) {
  ok(N(made.total_in) > 1.48 && N(made.total_in) <= 1.5, `all of it became florins but storage: ${N(made.total_in)} NEAR in`);
  ok(N(made.staking_fund) === N(cfg.staking_deposit), `its staking fund came from the fund (${N(made.staking_fund)} NEAR)`);
  const dao = await provider.query({ request_type: "view_account", finality: "final", account_id: made.dao }).catch(() => null);
  ok(!!dao && N(dao.amount) >= N(cfg.dao_deposit) - 0.5, `its Sputnik DAO is real and holds ${dao ? N(dao.amount) : 0} NEAR`);
}
const [fund2] = await view("get_founding");
ok(BigInt(fund) - BigInt(fund2) === costs, `the fund paid DAO + staking: ${N(fund)} -> ${N(fund2)} NEAR`);
const t9 = await view("get_totals");
ok(BigInt(t9.balance) >= BigInt(t9.liabilities) + BigInt(t9.storage_locked), `${which} still holds everything it owes (the fund counted) plus its storage`);
console.log(`\n${fails ? `${fails} FAILED` : "ALL PASS"} (${nBefore} -> ${(await view("list_clans", { limit: 100 })).length} nations on ${which})`);
