// Proves the move of a nation's tokens from its DAO to its Broker's wallet (his call 9 Nov) on a
// testnet world (default v2d), then can deploy the same contract elsewhere. Idempotent. Prints no key.
//   node scripts/tokens-broker-proof.mjs v2d
//   node scripts/tokens-broker-proof.mjs w6 --deploy-only
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const which = process.argv[2] || "v2d", deployOnly = process.argv.includes("--deploy-only");
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });

// 1. Upgrade (state stays).
const worldAcct = new Account(WORLD, provider, keyOf(WORLD).private_key);
const has = await view(WORLD, "mt_move_to_broker", {}).then(() => true, (e) => !/method is not found|MethodNotFound|CodeDoesNotExist/i.test(String(e.message)));
const before = await view(WORLD, "list_clans", { limit: 100 }), tBefore = await view(WORLD, "get_totals"), mtBefore = await view(WORLD, "mt_count");
if (!has) { await worldAcct.deployContract(fs.readFileSync("contracts/world/target/near/world.wasm")); await wait(3000); }
const after = await view(WORLD, "list_clans", { limit: 100 }), tAfter = await view(WORLD, "get_totals"), mtAfter = await view(WORLD, "mt_count");
ok(JSON.stringify(before) === JSON.stringify(after) && tBefore.florins === tAfter.florins && tBefore.backing === tAfter.backing && tBefore.jackpot === tAfter.jackpot && mtBefore === mtAfter,
  `${which}: ${has ? "already on" : "upgraded to"} the contract with mt_move_to_broker; nations, florins, backing, jackpot and all ${mtAfter} token kinds unchanged`);
ok(BigInt(tAfter.balance) >= BigInt(tAfter.liabilities) + BigInt(tAfter.storage_locked), `${which}: still holds everything it owes plus its storage`);
if (deployOnly) process.exit();

// 2. The engine's own path: move every nation's DAO tokens to its Broker.
const op = keyOf(`${which}op.adf-pool1-hf0w8.testnet`);
process.env.ADF_WORLD = WORLD; process.env.OPERATOR_ACCOUNT_ID = op.account_id; process.env.OPERATOR_PRIVATE_KEY = op.private_key;
const { connect } = await import("../engine/chain.mjs");
const chain = connect("testnet");
for (const c of after.filter((x) => x.alive)) {
  const broker = await view(WORLD, "get_agent_wallet", { clan_id: c.id, role: "Broker" });
  const inDao = (await view(WORLD, "mt_tokens_for_owner", { account_id: c.dao })).map((t) => t.token_id).sort();
  const brokerBefore = (await view(WORLD, "mt_tokens_for_owner", { account_id: broker })).map((t) => t.token_id);
  const r = await chain.mtMoveToBroker(c.id);
  await wait(3000);
  const left = await view(WORLD, "mt_tokens_for_owner", { account_id: c.dao });
  const now = (await view(WORLD, "mt_tokens_for_owner", { account_id: broker })).map((t) => t.token_id);
  ok(left.length === 0 && inDao.every((t) => now.includes(t)) && now.length === new Set([...brokerBefore, ...inDao]).size,
    `${c.name}: ${r.moved} token kind(s) moved from its DAO to its Broker ${broker} (DAO now empty; Broker holds ${now.length})`);
}
// 3. Refusals.
const refuse = async (label, fn) => { try { await fn(); ok(false, label); } catch (e) { ok(true, `${label}: ${String(e.message).slice(0, 100)}`); } };
const god = new Account(`${which}g1.adf-pool1-hf0w8.testnet`, provider, keyOf(`${which}g1.adf-pool1-hf0w8.testnet`).private_key);
const failed = (r) => { const x = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (x) throw new Error(JSON.stringify(x.outcome.status.Failure)); return r; };
await refuse("a god can't move a nation's tokens to the Broker (operator only)", async () => failed(await god.callFunctionRaw({ contractId: WORLD, methodName: "mt_move_to_broker", args: { clan_id: after[0].id, limit: 10 }, gas: 50n * 10n ** 12n })));
