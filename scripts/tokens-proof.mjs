// Proves research as NEP-245 tokens on a testnet world (default: the throwaway test world v2d), then
// can deploy the same contract to another world. Idempotent: reruns reuse what exists. Prints no key.
//   node scripts/tokens-proof.mjs v2d            (deploy + mint + views + DAO transfer + refusals)
//   node scripts/tokens-proof.mjs w6 --deploy-only
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const which = process.argv[2] || "v2d", deployOnly = process.argv.includes("--deploy-only");
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const failed = (r) => { const x = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (x) throw new Error(JSON.stringify(x.outcome.status.Failure).slice(0, 200)); return r; };
const T = (n) => BigInt(n) * 10n ** 12n;

// 1. Upgrade the world's code (state stays: tokens live in their own storage slots).
const wk = keyOf(WORLD), worldAcct = new Account(WORLD, provider, wk.private_key);
const wasm = fs.readFileSync("contracts/world/target/near/world.wasm");
const hasTokens = await view(WORLD, "mt_count").then(() => true, () => false);
const before = await view(WORLD, "list_clans", { limit: 100 }), tBefore = await view(WORLD, "get_totals");
if (!hasTokens) { await worldAcct.deployContract(wasm); await wait(3000); }
const after = await view(WORLD, "list_clans", { limit: 100 }), tAfter = await view(WORLD, "get_totals");
ok(JSON.stringify(before) === JSON.stringify(after) && tBefore.florins === tAfter.florins && tBefore.backing === tAfter.backing && tBefore.jackpot === tAfter.jackpot,
  `${which}: ${hasTokens ? "already on" : "upgraded to"} the token contract; every nation, florin, backing and jackpot unchanged (${after.length} nations)`);
ok(BigInt(tAfter.balance) >= BigInt(tAfter.liabilities) + BigInt(tAfter.storage_locked), `${which}: still holds everything it owes plus its storage`);
if (hasTokens) ok((await view(WORLD, "get_alias", { clan_id: after[0].id })) !== undefined, `${which}: named accounts still answer`);
if (deployOnly) process.exit();

// 2. The engine's own mint path: research to both nations, a patent and a kit to the first.
const op = keyOf(`${which}op.adf-pool1-hf0w8.testnet`);
process.env.ADF_WORLD = WORLD; process.env.OPERATOR_ACCOUNT_ID = op.account_id; process.env.OPERATOR_PRIVATE_KEY = op.private_key;
const { connect } = await import("../engine/chain.mjs");
const chain = connect("testnet");
const [A, B] = after.filter((c) => c.alive);
const tag = "proof1";
const R = `r:${tag}`, P = `p:${tag}`, K = `k:${tag}`;
if (!(await view(WORLD, "mt_supply", { token_id: P }))) {
  const r = await chain.mtMint([
    { token_id: R, owner_id: A.dao, amount: "1", title: "Proof research" },
    { token_id: R, owner_id: B.dao, amount: "1", title: "Proof research" },
    { token_id: P, owner_id: A.dao, amount: "1", title: "Proof patent" },
    { token_id: K, owner_id: A.dao, amount: "1", title: "Proof kit" },
  ], "proof");
  console.log(`  minted (tx ${r.hash})`);
  await wait(3000);
}
ok((await view(WORLD, "mt_supply", { token_id: R })) === "2" && (await view(WORLD, "mt_balance_of", { account_id: B.dao, token_id: R })) === "1", `research is copyable: both DAOs hold ${R}, supply 2`);
const info = await view(WORLD, "mt_token_info", { token_id: P });
ok(info.kind === "patent" && info.supply === "1", `the patent is one of a kind (supply ${info.supply})`);
const mine = (await view(WORLD, "mt_tokens_for_owner", { account_id: A.dao })).map((t) => t.token_id);
ok([R, K].every((t) => mine.includes(t)), `mt_tokens_for_owner lists ${A.name}'s tokens (${mine.length})`);

// 3. A god moves the patent to the other nation the real way: a DAO proposal, voted through.
const holder = (await view(WORLD, "mt_token", { token_ids: [P] }))[0].owner_id;
const [from, to] = holder === A.dao ? [A, B] : [B, A];
const godId = from.gods[0].account, god = new Account(godId, provider, keyOf(godId).private_key);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const kind = { FunctionCall: { receiver_id: WORLD, actions: [{ method_name: "mt_transfer", args: b64({ receiver_id: to.dao, token_id: P, amount: "1", approval: null, memo: "proof: patent sold" }), deposit: "1", gas: T(30).toString() }] } };
const pr = failed(await god.callFunctionRaw({ contractId: from.dao, methodName: "add_proposal", args: { proposal: { description: "move the proof patent", kind } }, deposit: 10n ** 22n, gas: T(50) }));
const pid = JSON.parse(Buffer.from(pr.status.SuccessValue, "base64").toString());
failed(await god.callFunctionRaw({ contractId: from.dao, methodName: "act_proposal", args: { id: pid, action: "VoteApprove", proposal: kind }, gas: T(150) }));
await wait(4000);
const status = (await view(from.dao, "get_proposal", { id: pid })).status;
ok(status === "Approved" && (await view(WORLD, "mt_token", { token_ids: [P] }))[0].owner_id === to.dao,
  `${from.name}'s god moved the patent to ${to.name} by DAO vote (proposal ${pid} ${status}); its owner is now ${to.dao}`);

// 4. Refusals.
const refuse = async (label, fn) => { try { await fn(); ok(false, label); } catch (e) { ok(true, `${label}: ${String(e.message).slice(0, 110)}`); } };
const opAcct = new Account(op.account_id, provider, op.private_key);
await refuse("a second patent of the same draft", async () => chain.mtMint([{ token_id: P, owner_id: A.dao, amount: "1", title: "x" }], "x"));
await refuse("a god can't mint", async () => failed(await god.callFunctionRaw({ contractId: WORLD, methodName: "mt_mint_batch", args: { mints: [{ token_id: "r:forged", owner_id: godId, amount: "1" }] }, deposit: 10n ** 23n, gas: T(50) })));
await refuse("a mint that doesn't pay its storage", async () => failed(await opAcct.callFunctionRaw({ contractId: WORLD, methodName: "mt_mint_batch", args: { mints: [{ token_id: "r:unpaid", owner_id: A.dao, amount: "1", title: "x" }] }, deposit: 0n, gas: T(50) })));
await refuse("a god can't move the nation's tokens alone (the DAO holds them)", async () => failed(await god.callFunctionRaw({ contractId: WORLD, methodName: "mt_transfer", args: { receiver_id: to.dao, token_id: R, amount: "1" }, deposit: 1n, gas: T(30) })));
