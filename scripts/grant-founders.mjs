// His call 9 Nov: each nation's founder paid 6 testnet NEAR but 5.5 of it went to creating the
// nation's Sputnik DAO, so it never became florins. Give it back: the operator grants each founder
// (the nation's first god) 5.5 NEAR straight into the backing (no jackpot cut; the florin's value
// doesn't move), funded from the sponsor pool. Then seed the founding fund. Idempotent: a founder
// already granted is skipped. Prints no key.   node scripts/grant-founders.mjs [--fund 11.2]
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const WORLD = "w6.adf-pool1-hf0w8.testnet", GRANT = 5.5;
const argv = process.argv.slice(2), FUND = Number(argv[argv.indexOf("--fund") + 1]) || 0;
const keyOf = (a) => JSON.parse(fs.readFileSync(`.keys/${a}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://near-testnet.drpc.org" });
const acct = (id) => { const k = keyOf(id); return new Account(k.account_id, provider, k.private_key); };
const view = (method, args = {}) => provider.callFunction({ contractId: WORLD, method, args });
const N = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
const NEAR = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 18n;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) { fails++; process.exitCode = 1; } };
const call = async (a, methodName, args, deposit) => {
  const r = await a.callFunctionRaw({ contractId: WORLD, methodName, args, deposit, gas: 50n * 10n ** 12n });
  const f = r.receipts_outcome.find((o) => o.outcome.status.Failure);
  if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300));
  return r.transaction.hash;
};

const cfg = await view("get_config");
const pool = acct("adf-pool1-hf0w8.testnet"), op = acct(cfg.operator);
const clans = await view("list_clans", { limit: 100 });
const todo = [];
for (const c of clans) {
  const founder = c.gods[0]?.account;
  if (!founder) continue;
  const st = await view("get_stake", { clan_id: c.id, account: founder });
  if (N(st.granted) >= GRANT) { console.log(`  ${c.name}: ${founder.slice(0, 12)}… already granted ${N(st.granted)}`); continue; }
  todo.push({ c, founder, before: N(st.near) });
}
const t0 = await view("get_totals");
if (todo.length) {
  const need = NEAR(GRANT * todo.length);
  const tx = (await pool.transfer({ receiverId: op.accountId, amount: need })).transaction.hash;
  console.log(`  pool -> operator ${N(need)} NEAR for ${todo.length} grants (tx ${tx})`);
  await wait(3000);
}
for (const x of todo) {
  let tx;
  try { tx = await call(op, "grant", { clan_id: x.c.id, god: x.founder }, NEAR(GRANT)); }
  catch (e) { if (!/Internal server error|timeout|50\d/i.test(String(e.message))) throw e; tx = "(RPC didn't wait; checking)"; await wait(6000); }
  await wait(2500);
  const st = await view("get_stake", { clan_id: x.c.id, account: x.founder });
  ok(N(st.granted) >= GRANT && Math.abs(N(st.near) - x.before - GRANT) < 0.01, `${x.c.name}: founder ${x.founder.slice(0, 12)}… +${GRANT} NEAR (${x.before} -> ${N(st.near)}) tx ${tx}`);
}
const t1 = await view("get_totals");
ok(Math.abs(N(t1.backing) - N(t0.backing) - GRANT * todo.length) < 0.001, `backing +${GRANT * todo.length} NEAR (${N(t0.backing)} -> ${N(t1.backing)})`);
ok(t1.jackpot === t0.jackpot, "jackpot untouched");
ok(Math.abs(N(t1.florin_value) - N(t0.florin_value)) < 1e-5, `florin value unchanged (${N(t0.florin_value)} -> ${N(t1.florin_value)})`);
if (FUND > 0) {
  const tx = await pool.callFunctionRaw({ contractId: WORLD, methodName: "fund_founding", args: {}, deposit: NEAR(FUND), gas: 30n * 10n ** 12n });
  await wait(3000);
  const [fund, min] = await view("get_founding");
  ok(N(fund) >= FUND, `founding fund ${N(fund)} NEAR (tx ${tx.transaction.hash}); founding now needs ${N(min)} NEAR`);
}
const t2 = await view("get_totals");
ok(BigInt(t2.balance) >= BigInt(t2.liabilities) + BigInt(t2.storage_locked), `w6 holds everything it owes plus storage (balance ${N(t2.balance)}, owes ${N(t2.liabilities)}, storage ${N(t2.storage_locked)})`);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
