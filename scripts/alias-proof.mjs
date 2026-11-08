// Proves named nation accounts on a testnet world (default: the throwaway test world v2d), then can
// deploy the same contract to another world. Idempotent: reruns reuse what exists. Nothing here
// prints a key.
//   node scripts/alias-proof.mjs v2d            (deploy + aliases + send/forward + refusals)
//   node scripts/alias-proof.mjs w6 --deploy-only
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const which = process.argv[2] || "v2d", deployOnly = process.argv.includes("--deploy-only");
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const bal = async (a) => BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: a })).amount);
const fmt = (y) => (Number(y / 10n ** 18n) / 1e6).toFixed(4);

// 1. Upgrade the world's code (its state stays: the alias registry uses its own storage slots).
const wk = keyOf(WORLD), worldAcct = new Account(WORLD, provider, wk.private_key);
const wasm = fs.readFileSync("contracts/world/target/near/world.wasm");
const hasAliases = await view(WORLD, "get_alias", { clan_id: 1 }).then(() => true, () => false);
const before = await view(WORLD, "list_clans", { limit: 100 });
const tBefore = await view(WORLD, "get_totals");
if (!hasAliases) { await worldAcct.deployContract(wasm); await wait(3000); }
const after = await view(WORLD, "list_clans", { limit: 100 });
const tAfter = await view(WORLD, "get_totals");
ok(JSON.stringify(before) === JSON.stringify(after) && tBefore.florins === tAfter.florins && tBefore.backing === tAfter.backing && tBefore.jackpot === tAfter.jackpot,
  `${which}: ${hasAliases ? "already on" : "upgraded to"} the named-accounts contract; every nation, florin, backing and jackpot unchanged (${after.length} nations)`);
ok(BigInt(tAfter.balance) >= BigInt(tAfter.liabilities) + BigInt(tAfter.storage_locked), `${which}: still holds everything it owes plus its storage`);
if (deployOnly) process.exit();

// 2. The engine's own code path: a named account for every live nation.
const op = keyOf(`${which}op.adf-pool1-hf0w8.testnet`);
process.env.ADF_WORLD = WORLD; process.env.OPERATOR_ACCOUNT_ID = op.account_id; process.env.OPERATOR_PRIVATE_KEY = op.private_key;
const { connect } = await import("../engine/chain.mjs");
const chain = connect("testnet");
const live = after.filter((c) => c.alive);
const aliases = {};
for (const c of live) {
  aliases[c.id] = await chain.ensureAlias(c.id);
  console.log(`  ${c.name} (nation ${c.id}): ${aliases[c.id]}`);
}
await wait(3000);
for (const c of live) {
  const a = aliases[c.id];
  ok(a && a.endsWith(`.${WORLD}`) && (await view(WORLD, "get_alias", { clan_id: c.id })) === a, `${c.name}'s named account is registered on chain: ${a}`);
  ok((await view(a, "dao")) === c.dao, `${a} forwards to ${c.name}'s DAO (${c.dao})`);
}

// 3. Money sent to the named account reaches the DAO.
const [A] = live, alias = aliases[A.id];
const opAcct = new Account(op.account_id, provider, op.private_key);
const daoBefore = await bal(A.dao);
const sent = 10n ** 22n; // 0.01 NEAR
await opAcct.transfer({ receiverId: alias, amount: sent });
await wait(3000);
const f = await chain.forwardAlias(alias);
await wait(4000);
const daoGain = (await bal(A.dao)) - daoBefore;
ok(f && daoGain >= sent - 10n ** 20n, `0.01 NEAR sent to ${alias} reached ${A.dao} after forward() (DAO +${fmt(daoGain)} NEAR, tx ${f?.hash})`);
ok((await chain.forwardAlias(alias)) === null, "nothing left waiting: the engine doesn't call forward() for nothing");

// 4. Refusals.
const refuse = async (label, fn) => { try { await fn(); ok(false, label); } catch (e) { ok(true, `${label}: ${String(e.message).slice(0, 100)}`); } };
const god = new Account(`${which}g1.adf-pool1-hf0w8.testnet`, provider, keyOf(`${which}g1.adf-pool1-hf0w8.testnet`).private_key);
const failed = (r) => { const x = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (x) throw new Error(JSON.stringify(x.outcome.status.Failure)); return r; };
await refuse("a god can't make named accounts (operator only)", async () => failed(await god.callFunctionRaw({ contractId: WORLD, methodName: "create_alias", args: { clan_id: A.id }, deposit: 3n * 10n ** 22n, gas: 60n * 10n ** 12n })));
await refuse("one named account per nation", async () => failed(await opAcct.callFunctionRaw({ contractId: WORLD, methodName: "create_alias", args: { clan_id: A.id }, deposit: 3n * 10n ** 22n, gas: 60n * 10n ** 12n })));
await refuse("nobody can point a named account at another DAO (init runs once, parent only)", async () => failed(await opAcct.callFunctionRaw({ contractId: alias, methodName: "init", args: Buffer.from("thief.testnet"), gas: 10n * 10n ** 12n })));
const keys = await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: alias });
ok(keys.keys.length === 0, `${alias} has no keys: nobody can sign for it, it can only forward`);
