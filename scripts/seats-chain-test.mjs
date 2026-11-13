// Seat trading against the REAL testnet chain, on the spare test world v2d (never the live world): a buyer pays the
// escrow, engine/seats.mjs settleBuy moves the seat with move_god (the world's owner key) and pays the seller; a
// second payment for the sold seat is refunded; then the seat is sold back, so v2d ends as it began. Prints no key.
//    node scripts/seats-chain-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account, JsonRpcProvider, baseEncode } from "near-api-js";
import { randomBytes } from "node:crypto";

const WORLD = "v2d.adf-pool1-hf0w8.testnet", A = "v2dg2.adf-pool1-hf0w8.testnet", B = "v2dg1.adf-pool1-hf0w8.testnet", CLAN = 2;
Object.assign(process.env, { ADF_WORLD: WORLD, ADF_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "adf-seatchain-")), DATABASE_URL: "" });
const { connect } = await import("../engine/chain.mjs");
const S = await import("../engine/seats.mjs");
const store = await import("../engine/store.mjs");
const chain = connect("testnet");
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const acct = (id) => { const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8")); return new Account(k.account_id, provider, k.private_key); };
const balance = async (id) => BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: id })).amount);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const PRICE = S.yoctoOf("0.1");

async function buy(seller, buyer, tag) {
  const id = await store.seatList("testnet", { clan: CLAN, seller, price: PRICE, at: Date.now() });
  const r = await acct(buyer).transfer({ receiverId: chain.escrow, amount: BigInt(PRICE) });
  const tx = r.transaction.hash;
  await store.seatBuy("testnet", { tx, listing: id, buyer, amount: PRICE });
  const sellerBefore = await balance(seller);
  const out = await S.settleBuy("testnet", (await store.seatBuysWaiting("testnet")).find((b) => b.tx === tx), { store, chain, escrow: chain.escrow, log: console.log });
  await wait(6000);
  const gods = await chain.godsOf(CLAN);
  ok(out?.status === "filled", `${tag}: filled (${out?.status} ${out?.why ?? ""})`);
  ok(gods.includes(buyer) && !gods.includes(seller), `${tag}: the seat is the buyer's on chain (${gods.join(",")})`);
  ok((await balance(seller)) - sellerBefore === BigInt(PRICE), `${tag}: the seller got exactly the price`);
  return { id, tx };
}

console.log(`world ${WORLD}, escrow ${chain.escrow}; nation ${CLAN} gods now: ${(await chain.godsOf(CLAN)).join(",")}`);
ok((await chain.godsOf(CLAN)).includes(A), "the seller starts as the god");
const stakeBefore = await provider.callFunction({ contractId: WORLD, method: "get_stake", args: { clan_id: CLAN, account: A } });
const first = await buy(A, B, "sale");
const stakeAfter = await provider.callFunction({ contractId: WORLD, method: "get_stake", args: { clan_id: CLAN, account: B } });
ok(stakeAfter.florins === stakeBefore.florins && stakeAfter.put_in === stakeBefore.put_in, "everything moved: florins and put_in now the buyer's");

// A second payment for the sold seat comes back.
const r2 = await acct(A).transfer({ receiverId: chain.escrow, amount: BigInt(PRICE) });
await store.seatBuy("testnet", { tx: r2.transaction.hash, listing: first.id, buyer: A, amount: PRICE });
await wait(6000); // read the balance once the payment is final
const before2 = await balance(A);
const o2 = await S.settleBuy("testnet", (await store.seatBuysWaiting("testnet")).find((b) => b.tx === r2.transaction.hash), { store, chain, escrow: chain.escrow });
await wait(6000);
ok(o2?.status === "refunded" && (await balance(A)) - before2 === BigInt(PRICE), `a payment for a sold seat is refunded in full (${o2?.status})`);

// A made-up payment: rejected, nothing sent.
const FAKE = baseEncode(randomBytes(32));
await store.seatBuy("testnet", { tx: FAKE, listing: first.id, buyer: A, amount: PRICE });
const o3 = await S.settleBuy("testnet", (await store.seatBuysWaiting("testnet")).find((b) => b.tx === FAKE), { store, chain, escrow: chain.escrow });
ok(o3?.status === "rejected", `a payment that isn't on the record is rejected (${o3?.status}: ${o3?.why})`);

// Put it back.
await buy(B, A, "sold back");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
