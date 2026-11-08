// Proves agent wallets on a testnet world (default: the throwaway test world v2d), then can deploy
// the same contract to another world. Nothing here prints a key.
//   node scripts/agent-wallets-proof.mjs v2d     (deploy + wallets + buy/spend + refusals)
//   node scripts/agent-wallets-proof.mjs w6 --deploy-only
import fs from "node:fs";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

const which = process.argv[2] || "v2d", deployOnly = process.argv.includes("--deploy-only");
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };

// 1. Upgrade the world's code (its state stays: the wallet registry uses its own storage slots).
const wk = keyOf(WORLD), worldAcct = new Account(WORLD, provider, wk.private_key);
const wasm = fs.readFileSync("contracts/world/target/near/world.wasm");
const before = await provider.callFunction({ contractId: WORLD, method: "list_clans", args: { limit: 100 } });
await worldAcct.deployContract(wasm);
await wait(3000);
const after = await provider.callFunction({ contractId: WORLD, method: "list_clans", args: { limit: 100 } });
ok(JSON.stringify(before) === JSON.stringify(after), `${which}: upgraded to the agent-wallet contract; every nation and balance unchanged (${after.length} nations)`);
if (deployOnly) process.exit();

// 2. The engine's own code path: wallets for every live nation, then agent-signed moves.
const op = keyOf(`${which}op.adf-pool1-hf0w8.testnet`);
process.env.ADF_WORLD = WORLD; process.env.OPERATOR_ACCOUNT_ID = op.account_id; process.env.OPERATOR_PRIVATE_KEY = op.private_key;
const { connect, toFlorins } = await import("../engine/chain.mjs");
const chain = connect("testnet");
const live = after.filter((c) => c.alive);
for (const c of live) console.log(`  nation ${c.id}: wallets made ${JSON.stringify(await chain.ensureAgents(c.id))}`);
await wait(3000);
for (const c of live) ok((await provider.callFunction({ contractId: WORLD, method: "get_agent_wallet", args: { clan_id: c.id, role: "Broker" } })) === chain.agentId(c.id, "Broker"), `nation ${c.id}'s Broker wallet is registered on chain`);

const [a, b] = live;
const fl = async (id) => toFlorins((await provider.callFunction({ contractId: WORLD, method: "get_clan", args: { clan_id: id } })).florins);
const [fa, fb] = [await fl(a.id), await fl(b.id)];
const buy = await chain.agentBuy(a.id, b.id, 0.5, "proof: corpus");
await wait(3000);
ok(Math.abs((await fl(a.id)) - (fa - 0.5)) < 1e-6 && Math.abs((await fl(b.id)) - (fb + 0.5)) < 1e-6, `nation ${a.id}'s Broker bought from nation ${b.id}, signed by ${buy.signer} (tx ${buy.hash})`);
const fa2 = await fl(a.id);
const spend = await chain.agentSpend(a.id, 0.25, "proof: walls");
await wait(3000);
ok(Math.abs((await fl(a.id)) - (fa2 - 0.25)) < 1e-6, `nation ${a.id}'s Patron spent 0.25 florins, signed by ${spend.signer} (tx ${spend.hash})`);

// 3. Refusals.
const patronKey = (await import("node:crypto")).createHash; // (keys are derived inside chain.mjs; reuse its path below)
const refuse = async (label, fn) => { try { await fn(); ok(false, label); } catch (e) { ok(true, `${label}: ${String(e.message).slice(0, 90)}`); } };
const opAcct = new Account(op.account_id, provider, op.private_key);
await refuse("the operator can't act as an agent", () => opAcct.callFunction({ contractId: WORLD, methodName: "agent_buy", args: { seller: b.id, amount: "1", memo: "x" } }));
// The Patron's own key only allows agent_spend: asking it to buy is refused by NEAR itself.
const { createHash } = await import("node:crypto");
const { ed25519 } = await import("@noble/curves/ed25519.js");
const { baseEncode } = await import("near-api-js");
const seed = createHash("sha256").update(`adf-agent|${op.private_key}|${WORLD}|${a.id}|Patron`).digest();
const pk = KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(ed25519.getPublicKey(seed))]))}`);
const patron = new Account(chain.agentId(a.id, "Patron"), provider, pk.toString());
await refuse("a Patron's key can't call agent_buy", () => patron.callFunction({ contractId: WORLD, methodName: "agent_buy", args: { seller: b.id, amount: "1", memo: "x" } }));
await refuse("an agent's key can't send NEAR", () => patron.transfer({ receiverId: op.account_id, amount: 10n ** 21n }));
