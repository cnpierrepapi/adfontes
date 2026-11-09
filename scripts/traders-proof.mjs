// Proves the market Broker wallets (9 Nov, step 5.2) on a testnet world (default v2d): the world is
// upgraded to the marketplace contract, each nation's Broker gets trader<id>.<operator> with a key
// for agent_buy + the market methods, the old broker<id> wallet is retired, and its tokens follow.
// Idempotent. Prints no key.
//   node scripts/traders-proof.mjs v2d
//   node scripts/traders-proof.mjs w6            (the live testnet world: deploy + wallets, no trades)
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";

const which = process.argv[2] || "v2d", live = which === "w6";
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://near-testnet.drpc.org" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const failed = (r) => { const x = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (x) throw new Error(JSON.stringify(x.outcome.status.Failure).slice(0, 220)); return r; };
const refuse = async (label, fn) => { try { await fn(); ok(false, label); } catch (e) { ok(true, `${label}: ${String(e.message).slice(0, 110)}`); } };

// 1. Upgrade to the marketplace contract (state stays). "Is it there?" = a view only the new code has.
const has = await view(WORLD, "market_count").then(() => true, (e) => { if (!/method is not found|MethodNotFound|CodeDoesNotExist/i.test(String(e.message))) throw e; return false; });
const before = await view(WORLD, "list_clans", { limit: 100 }), tB = await view(WORLD, "get_totals"), mtB = await view(WORLD, "mt_count");
if (!has) { await new Account(WORLD, provider, keyOf(WORLD).private_key).deployContract(fs.readFileSync("contracts/world/target/near/world.wasm")); await wait(3000); }
const after = await view(WORLD, "list_clans", { limit: 100 }), tA = await view(WORLD, "get_totals"), mtA = await view(WORLD, "mt_count");
ok(JSON.stringify(before) === JSON.stringify(after) && tB.florins === tA.florins && tB.backing === tA.backing && tB.jackpot === tA.jackpot && mtB === mtA,
  `${which}: ${has ? "already on" : "upgraded to"} the marketplace contract; nations, florins, backing, jackpot and ${mtA} token kinds unchanged`);
ok(BigInt(tA.balance) >= BigInt(tA.liabilities) + BigInt(tA.storage_locked), `${which}: still holds everything it owes plus its storage`);
ok(JSON.stringify(await view(WORLD, "market_count")) === JSON.stringify(["0", "0"]) || has, `${which}: the market is open and empty`);

// 2. The engine's own path: new Broker wallets, then the token move.
const opFile = live ? "adfontes-mw1fjpfx.testnet" : `${which}op.adf-pool1-hf0w8.testnet`;
const op = keyOf(opFile);
process.env.ADF_WORLD = WORLD; process.env.OPERATOR_ACCOUNT_ID = op.account_id; process.env.OPERATOR_PRIVATE_KEY = op.private_key;
const { connect } = await import("../engine/chain.mjs");
const chain = connect("testnet");
for (const c of after.filter((x) => x.alive)) {
  const oldWallet = await view(WORLD, "get_agent_wallet", { clan_id: c.id, role: "Broker" });
  const oldHeld = oldWallet ? (await view(WORLD, "mt_tokens_for_owner", { account_id: oldWallet, limit: 500 })).length : 0;
  const made = await chain.ensureAgents(c.id);
  await wait(3000);
  const trader = chain.agentId(c.id, "Broker");
  ok((await view(WORLD, "get_agent_wallet", { clan_id: c.id, role: "Broker" })) === trader, `${c.name}'s Broker now trades from ${trader}${made.length ? " (new)" : ""}`);
  let moved = 0, r;
  do { r = await chain.mtMoveToBroker(c.id); moved += r.moved; } while (r.moved > 0);
  await wait(3000);
  const now = (await view(WORLD, "mt_tokens_for_owner", { account_id: trader, limit: 500 })).length;
  const left = oldWallet && oldWallet !== trader ? (await view(WORLD, "mt_tokens_for_owner", { account_id: oldWallet, limit: 500 })).length : 0;
  ok(left === 0 && now >= oldHeld, `${c.name}: ${moved} token kind(s) moved to the new wallet (it holds ${now}; the old one holds ${left})`);
  const keys = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: trader })).keys;
  const fc = keys[0]?.access_key.permission.FunctionCall;
  ok(keys.length === 1 && fc && fc.receiver_id === WORLD && ["agent_buy", "market_list", "market_delist", "market_buy"].every((m) => fc.method_names.includes(m)),
    `${trader} has one key: the world's agent_buy and market methods only`);
}
if (live) process.exit();

// 3. Refusals and the retired wallet (test world only).
const [A] = after.filter((x) => x.alive);
const { createHash } = await import("node:crypto");
const { ed25519 } = await import("@noble/curves/ed25519.js");
const { KeyPair, baseEncode } = await import("near-api-js");
const derive = (label) => { const seed = createHash("sha256").update(`adf-agent|${op.private_key}|${WORLD}|${A.id}|${label}`).digest(); return KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(ed25519.getPublicKey(seed))]))}`).toString(); };
const trader = new Account(chain.agentId(A.id, "Broker"), provider, derive("Trader"));
const retired = new Account(`broker${A.id}.${op.account_id}`, provider, derive("Broker"));
await refuse("the retired broker wallet can't trade any more", async () => failed(await retired.callFunctionRaw({ contractId: WORLD, methodName: "agent_buy", args: { seller: 2, amount: "1", memo: "x" }, gas: 30n * 10n ** 12n })));
await refuse("the trader's key can't send NEAR", () => trader.transfer({ receiverId: op.account_id, amount: 10n ** 21n }));
await refuse("the trader's key can't call methods outside its list (agent_spend is the Patron's)", async () => failed(await trader.callFunctionRaw({ contractId: WORLD, methodName: "agent_spend", args: { amount: "1", memo: "x" }, gas: 30n * 10n ** 12n })));
