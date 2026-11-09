// Proves the marketplace on a real testnet world (step 5.5, default v2d): two nations' Brokers list,
// buy and take down, signing from their own trader wallets through the engine's own calls
// (engine/chain.mjs), and the contract refuses what it should, each with its exact message.
// Every run mints its own fresh kit and patent to the first nation's Broker, so it can run again.
// Prints no key.
//   node scripts/market-proof.mjs v2d
import fs from "node:fs";
import { JsonRpcProvider } from "near-api-js";

const which = process.argv[2] || "v2d";
if (which === "w6") throw new Error("Not on the live world: this proof mints test tokens.");
const WORLD = `${which}.adf-pool1-hf0w8.testnet`;
const keyOf = (acct) => JSON.parse(fs.readFileSync(`.keys/${acct}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://near-testnet.drpc.org" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) { fails++; process.exitCode = 1; } };
const view = (method, args = {}) => provider.callFunction({ contractId: WORLD, method, args });
// A refusal passes only on the message it's named for.
const refuse = async (label, expected, fn) => {
  try { await fn(); ok(false, `${label}: it went through`); }
  catch (e) { const m = String(e.message); ok(m.includes(expected), `${label}: "${m.includes(expected) ? expected : m.slice(0, 160)}"`); }
};
const FL = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;
const florinsOf = async (id) => FL((await view("list_clans", { limit: 100 })).find((c) => c.id === id).florins);
const holds = async (acct, token) => Number(await view("mt_balance_of", { account_id: acct, token_id: token }));

const op = keyOf(`${which}op.adf-pool1-hf0w8.testnet`);
process.env.ADF_WORLD = WORLD; process.env.OPERATOR_ACCOUNT_ID = op.account_id; process.env.OPERATOR_PRIVATE_KEY = op.private_key;
const { connect } = await import("../engine/chain.mjs");
const chain = connect("testnet");

// Gas money first (playbook 7b): the operator mints and pays storage, each trader signs ~6 calls.
const bal = async (a) => Number(BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: a })).amount) / 10n ** 18n) / 1e6;
const [A, B] = (await view("list_clans", { limit: 100 })).filter((c) => c.alive);
const tA = chain.agentId(A.id, "Broker"), tB = chain.agentId(B.id, "Broker");
for (const [who, need] of [[op.account_id, 0.3], [tA, 0.03], [tB, 0.03]]) ok((await bal(who)) >= need, `${who} has gas money (${await bal(who)} NEAR, needs ${need})`);
if (fails) process.exit();
const totalsBefore = await view("get_totals");

// 1. Fresh tokens for this run, in A's Broker wallet (the engine mints the same way).
const run = Date.now().toString(36);
const kit = `k:mkt${run}`, pat = `p:mkt${run}`;
await chain.mtMint([{ token_id: kit, owner_id: tA, amount: "1", title: `Proof kit ${run}` }, { token_id: pat, owner_id: tA, amount: "1", title: `Proof patent ${run}` }], `market proof ${run}`);
await wait(3000);
ok((await holds(tA, kit)) === 1 && (await holds(tA, pat)) === 1, `${A.name}'s Broker (${tA}) holds a fresh kit and patent`);

// 2. A copy: A lists the kit, B buys it. Florins move, the listing stays open, B is marked for its copy.
const [a0, b0] = [await florinsOf(A.id), await florinsOf(B.id)];
const L0 = (await chain.marketList(A.id, kit, 2, "proof: a kit for sale")).value;
await wait(3000);
let l = (await view("market_listings", { from_index: L0, limit: 1 }))[0];
ok(l && l.open && l.kind === "copy" && l.seller === A.id && FL(l.price) === 2, `listing ${L0}: ${A.name} sells copies of the kit at 2 florins, signed by its trader wallet`);
const s0 = await chain.marketBuy(B.id, L0, "proof: buying a copy");
await wait(3000);
const [a1, b1] = [await florinsOf(A.id), await florinsOf(B.id)];
ok(Math.abs(a1 - a0 - 2) < 1e-6 && Math.abs(b0 - b1 - 2) < 1e-6, `${B.name} paid 2 florins and ${A.name} got them (${b0} -> ${b1}, ${a0} -> ${a1}); signed by ${s0.signer}`);
l = (await view("market_listings", { from_index: L0, limit: 1 }))[0];
ok(l.open && l.sold === 1, "the copy listing stays open, 1 sold");
const sale = (await chain.marketSales(s0.value))[0];
ok(sale && sale.buyer === B.id && sale.seller === A.id && sale.token_id === kit && sale.price === 2, `sale ${s0.value} is on the record with buyer, seller, token and price`);
ok((await holds(tA, kit)) === 1, `${A.name} keeps its own kit`);
// The engine mints the bought copy on its next turn (settleMarket, then the token sync): same call here.
await chain.mtMint([{ token_id: kit, owner_id: tB, amount: "1", title: `Proof kit ${run}` }], `market proof ${run}: the bought copy`);
await wait(3000);
ok((await holds(tB, kit)) === 1, `${B.name}'s Broker now holds its copy of the kit`);

// 3. A patent: one of a kind. It moves to the buyer at once and the listing closes.
const L1 = (await chain.marketList(A.id, pat, 3, "proof: a patent for sale")).value;
await wait(3000);
ok((await view("market_listings", { from_index: L1, limit: 1 }))[0]?.kind === "sale", `listing ${L1}: ${A.name} sells its patent at 3 florins`);
await chain.marketBuy(B.id, L1, "proof: buying the patent");
await wait(3000);
ok((await holds(tA, pat)) === 0 && (await holds(tB, pat)) === 1, `the patent moved from ${tA} to ${tB} in the same transaction`);
ok(!(await view("market_listings", { from_index: L1, limit: 1 }))[0].open, "the patent listing closed");

// 4. Refusals, each on its own message.
await refuse("a Broker can't buy its own listing", "That's your own listing", () => chain.marketBuy(A.id, L0, "x"));
await refuse("a copy can't be bought twice", "You already have that", () => chain.marketBuy(B.id, L0, "x"));
await refuse("a sold patent can't be bought again", "That listing is closed", () => chain.marketBuy(B.id, L1, "x"));
await refuse("you can't list what you don't hold", "You don't hold that token", () => chain.marketList(A.id, pat, 3, "x"));
await refuse("the same thing can't be listed twice", "That's already listed", () => chain.marketList(A.id, kit, 2, "x"));
await refuse("no price over 1000 florins", "Price must be between 0 and 1000 florins", () => chain.marketList(B.id, pat, 1001, "x"));
await refuse("nobody takes down another nation's listing", "Not your listing", () => chain.marketDelist(B.id, L0));
// Affordability: B lists the patent at the 1000-florin cap; A must really be short first (playbook 3).
const L2 = (await chain.marketList(B.id, pat, 1000, "proof: too dear")).value;
await wait(3000);
const aNow = await florinsOf(A.id);
ok(aNow < 1000, `${A.name} has ${aNow} florins, less than the 1000 asked`);
await refuse("a nation can't buy what it can't afford", "Buyer can't afford it", () => chain.marketBuy(A.id, L2, "x"));
ok((await holds(tB, pat)) === 1 && (await florinsOf(A.id)) === aNow, "the refused buy changed nothing");
// Only an agent wallet can trade: the operator itself can't.
const { Account } = await import("near-api-js");
const opAcct = new Account(op.account_id, provider, op.private_key);
await refuse("the operator isn't a Broker", "Not an agent wallet", async () => {
  const r = await opAcct.callFunctionRaw({ contractId: WORLD, methodName: "market_list", args: { token_id: kit, price: "1", reason: "x" }, gas: 30n * 10n ** 12n });
  const f = r.receipts_outcome.find((o) => o.outcome.status.Failure);
  if (f) throw new Error(JSON.stringify(f.outcome.status.Failure));
});

// 5. Taking down: B delists its too-dear patent; then nobody can buy it.
await chain.marketDelist(B.id, L2);
await wait(3000);
ok(!(await view("market_listings", { from_index: L2, limit: 1 }))[0].open, `${B.name}'s Broker took listing ${L2} down`);
await refuse("a delisted item can't be bought", "That listing is closed", () => chain.marketBuy(A.id, L2, "x"));
await refuse("it can't be taken down twice", "That listing is already closed", () => chain.marketDelist(B.id, L2));

// 6. The market only moves florins between nations: no florins made or lost, the backing untouched.
const totalsAfter = await view("get_totals");
ok(totalsAfter.florins === totalsBefore.florins && totalsAfter.backing === totalsBefore.backing, `total florins (${FL(totalsAfter.florins)}) and backing unchanged by the market`);
ok(BigInt(totalsAfter.balance) >= BigInt(totalsAfter.liabilities) + BigInt(totalsAfter.storage_locked), `${which} still holds everything it owes plus its storage`);
const [n, sn] = await view("market_count");
console.log(`\n${fails ? `${fails} FAILED` : "ALL PASS"} (market on ${which}: ${n} listings, ${sn} sales so far)`);
