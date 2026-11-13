// PLAN_13NOV step 4, seat trading (his rule: KEEP IT SIMPLE). Written before engine/seats.mjs.
// A god lists their seat at a price in grace (a signed message). A buyer pays that price to the escrow (the
// operator) and hands the payment's public record to the site. The engine checks the payment, checks the seller is
// still a god there and is owed nothing elsewhere, moves the seat with the contract's move_god (owner key) and pays
// the seller. Anything off: the buyer gets their grace back. EVERYTHING goes to the buyer, reverence included.
//    node engine/test-seats.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { baseEncode } from "near-api-js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-seats-"));
Object.assign(process.env, { ADF_STATE_DIR: dir, DATABASE_URL: "" });
const S = await import("./seats.mjs");
const store = await import("./store.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const WORLD = "w6.test", ESCROW = "op.test", NOW = 1_800_000_000_000;
const priv = ed25519.utils.randomSecretKey(), pub = `ed25519:${baseEncode(ed25519.getPublicKey(priv))}`;
const sign = (body) => ({ ...body, account: body.account ?? "seller.test", publicKey: pub, signature: Buffer.from(ed25519.sign(new TextEncoder().encode(S.seatMessage(body)), priv)).toString("base64") });
const env = (over = {}) => ({ world: WORLD, now: NOW, keyOn: async () => true, godOf: async (clan, a) => clan === 12 && a === "seller.test", alive: async () => true, owed: async () => 0n, lastAt: async () => 0, isAi: () => false, ...over });
const Y = 10n ** 24n;

// 1. Listing a seat: a signed message by a god of that nation, fresh, at a sane price.
{
  const body = { world: WORLD, action: "sell", clan: 12, price: S.yoctoOf("2.5"), at: NOW - 1000 };
  ok(S.yoctoOf("2.5") === (25n * Y / 10n).toString(), "2.5 grace is 2.5e24 yocto");
  ok(S.yoctoOf("0.000001") === (Y / 1_000_000n).toString(), "six decimals kept");
  const r = await S.acceptSeat(sign(body), env());
  ok(r.ok && r.row.clan === 12 && r.row.seller === "seller.test" && r.row.price === body.price && r.row.action === "sell", "a god's signed listing is accepted");
  ok((await S.acceptSeat({ ...sign(body), signature: sign({ ...body, price: S.yoctoOf("9") }).signature }, env())).error, "a signature over another price is refused");
  ok((await S.acceptSeat(sign({ ...body, world: "other.test" }), env())).error, "another world's listing is refused");
  ok((await S.acceptSeat(sign({ ...body, at: NOW - S.SEAT.freshMs - 1 }), env())).error, "an old signed message is refused (no replay)");
  ok((await S.acceptSeat(sign(body), env({ lastAt: async () => NOW - 500 }))).error, "a message older than this god's last one is refused (no replay of an old price)");
  ok((await S.acceptSeat(sign({ ...body, account: "someone.test" }), env())).error, "a non-god can't list the seat");
  ok((await S.acceptSeat(sign(body), env({ keyOn: async () => false }))).error, "a key that isn't on the account is refused");
  ok((await S.acceptSeat(sign({ ...body, price: S.yoctoOf("0.01") }), env())).error, "under the minimum price is refused");
  ok((await S.acceptSeat(sign({ ...body, price: S.yoctoOf("20000") }), env())).error, "over the maximum price is refused");
  ok((await S.acceptSeat(sign({ ...body, price: "abc" }), env())).error, "a price that isn't a number is refused");
  ok(/owe/i.test((await S.acceptSeat(sign(body), env({ owed: async () => 5n }))).error || ""), "a seller the world owes grace from elsewhere is refused (move_god would move it too)");
  ok((await S.acceptSeat(sign(body), env({ alive: async () => false }))).error, "a fallen nation's seat can't be listed");
  ok((await S.acceptSeat(sign(body), env({ isAi: () => true }))).error, "an AI god can't list through the site");
  const un = await S.acceptSeat(sign({ world: WORLD, action: "unlist", clan: 12, price: "0", at: NOW }), env());
  ok(un.ok && un.row.action === "unlist", "taking a listing off is a signed message too");
}

// 2. The payment: one plain transfer of exactly the price, from the buyer, to the escrow, landed.
const txOk = (over = {}) => ({ status: { SuccessValue: "" }, transaction: { signer_id: "buyer.test", receiver_id: ESCROW, actions: [{ Transfer: { deposit: S.yoctoOf("2.5") } }], hash: "TX1" }, ...over });
{
  const want = { buyer: "buyer.test", escrow: ESCROW, amount: S.yoctoOf("2.5") };
  ok(S.checkPayment(txOk(), want).ok, "a landed transfer of the price to the escrow is a payment");
  ok(S.checkPayment(null, want).error, "no transaction: no payment");
  ok(S.checkPayment(txOk({ status: { Failure: {} } }), want).error, "a failed transfer is no payment");
  ok(S.checkPayment(txOk({ transaction: { ...txOk().transaction, receiver_id: "else.test" } }), want).error, "a transfer to someone else is no payment");
  ok(S.checkPayment(txOk({ transaction: { ...txOk().transaction, signer_id: "other.test" } }), want).error, "someone else's transfer is no payment for this buyer");
  ok(S.checkPayment(txOk({ transaction: { ...txOk().transaction, actions: [{ Transfer: { deposit: S.yoctoOf("1") } }] } }), want).error, "the wrong amount is no payment");
  ok(S.checkPayment(txOk({ transaction: { ...txOk().transaction, actions: [{ FunctionCall: { deposit: S.yoctoOf("2.5") } }] } }), want).error, "a function call is no payment");
}

// 3. Deciding a fill.
{
  const listing = { id: 1, clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), status: "open" };
  const buy = { tx: "TX1", listing: 1, buyer: "buyer.test", amount: S.yoctoOf("2.5") };
  const base = { listing, buy, gods: ["seller.test", "x.test"], owed: 0n };
  ok(S.decideFill(base).fill, "open listing, right amount, seller still there, owed nothing: fill");
  ok(S.decideFill({ ...base, listing: { ...listing, status: "sold" } }).refund, "already sold: refund");
  ok(S.decideFill({ ...base, listing: null }).refund, "no such listing: refund");
  ok(S.decideFill({ ...base, buy: { ...buy, amount: S.yoctoOf("2") } }).refund, "paid a different price: refund");
  ok(S.decideFill({ ...base, gods: ["x.test"] }).refund, "the seller left before the fill: refund");
  ok(S.decideFill({ ...base, owed: 1n }).refund, "the world owes the seller something now: refund");
  ok(S.decideFill({ ...base, buy: { ...buy, buyer: "seller.test" } }).refund, "buying your own seat: refund");
}

// 4. Reverence goes with the seat: everything, to the buyer.
{
  const rv = { gods: { "seller.test": { r: 72, whispers: [1] }, "x.test": { r: 40 } }, putIn: { "seller.test": "100", "x.test": "5" }, followed: "seller.test", claimedBy: "seller.test" };
  ok(S.carryReverence(rv, "seller.test", "buyer.test"), "carried");
  ok(rv.gods["buyer.test"].r === 72 && !rv.gods["seller.test"] && rv.putIn["buyer.test"] === "100" && !("seller.test" in rv.putIn), "a new god takes the seller's reverence and blessing baseline");
  ok(rv.followed === "buyer.test" && rv.claimedBy === "buyer.test", "the follow and the claim move too");
  const rv2 = { gods: { "seller.test": { r: 50 }, "buyer.test": { r: 65 } }, putIn: { "seller.test": "100", "buyer.test": "20" }, followed: "buyer.test" };
  S.carryReverence(rv2, "seller.test", "buyer.test");
  ok(rv2.gods["buyer.test"].r === 65 && rv2.putIn["buyer.test"] === "120" && !rv2.gods["seller.test"], "a buyer already there keeps the higher reverence, the baselines add up (stakes merge)");
  ok(!S.carryReverence({ gods: {}, putIn: {} }, "a", "b"), "nothing to carry: false");
}

// 5. Settling a buy end to end, against a stand-in chain and the file store.
function fakeChain(over = {}) {
  const calls = [];
  const gods = { 12: ["seller.test", "x.test"] };
  return {
    calls, gods,
    txOf: async (hash) => (/^TX/.test(hash) ? txOk({ transaction: { ...txOk().transaction, hash } }) : null),
    godsOf: async (clan) => gods[clan] || [],
    owed: async () => 0n,
    moveGod: async (clan, from, to) => { calls.push(["move", clan, from, to]); gods[clan] = gods[clan].map((g) => (g === from ? to : g)); return { hash: "MOVE" }; },
    pay: async (to, amount) => { calls.push(["pay", to, amount]); return { hash: `PAY-${to}` }; },
    ...over,
  };
}
{
  const net = "t1";
  const id = await store.seatList(net, { clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), at: NOW });
  ok((await store.seatsOpen(net)).length === 1, "the listing is open");
  const id2 = await store.seatList(net, { clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), at: NOW + 1 });
  ok(id2 !== id && (await store.seatsOpen(net)).length === 1 && (await store.seatGet(net, id)).status === "cancelled", "a new price replaces the old listing (the old one is cancelled)");
  ok(await store.seatBuy(net, { tx: "TX1", listing: id2, buyer: "buyer.test", amount: S.yoctoOf("2.5") }), "a buy is noted");
  ok(!(await store.seatBuy(net, { tx: "TX1", listing: id2, buyer: "buyer.test", amount: S.yoctoOf("2.5") })), "the same payment can't be used twice");
  const ch = fakeChain();
  const [b] = await store.seatBuysWaiting(net);
  const out = await S.settleBuy(net, b, { store, chain: ch, escrow: ESCROW, sleep: async () => {} });
  ok(out?.status === "filled", `the buy filled (${out?.status} ${out?.why ?? ""})`);
  ok(ch.calls[0][0] === "move" && ch.calls[0][2] === "seller.test" && ch.calls[0][3] === "buyer.test", "the seat moved seller -> buyer");
  ok(ch.calls[1][0] === "pay" && ch.calls[1][1] === "seller.test" && ch.calls[1][2] === S.yoctoOf("2.5"), "the seller got the whole price");
  ok((await store.seatGet(net, id2)).status === "sold" && (await store.seatGet(net, id2)).buyer === "buyer.test", "the listing is sold, to the buyer");
  ok(!(await store.seatBuysWaiting(net)).length, "nothing left waiting");
  ok(await S.settleBuy(net, b, { store, chain: ch, escrow: ESCROW, sleep: async () => {} }) === null && ch.calls.length === 2, "settling the same buy again does nothing (claimed once)");

  // A second buyer of the same seat is refunded.
  await store.seatBuy(net, { tx: "TX2", listing: id2, buyer: "buyer.test", amount: S.yoctoOf("2.5") });
  const [b2] = await store.seatBuysWaiting(net);
  const out2 = await S.settleBuy(net, b2, { store, chain: ch, escrow: ESCROW, sleep: async () => {} });
  ok(out2?.status === "refunded" && ch.calls.at(-1)[0] === "pay" && ch.calls.at(-1)[1] === "buyer.test", "a second buyer of a sold seat gets their grace back");

  // A payment that never landed: rejected, nothing sent.
  const id3 = await store.seatList(net, { clan: 12, seller: "x.test", price: S.yoctoOf("2.5"), at: NOW });
  await store.seatBuy(net, { tx: "NOPE", listing: id3, buyer: "buyer.test", amount: S.yoctoOf("2.5") });
  const n = ch.calls.length;
  const out3 = await S.settleBuy(net, (await store.seatBuysWaiting(net))[0], { store, chain: ch, escrow: ESCROW, sleep: async () => {} });
  ok(out3?.status === "rejected" && ch.calls.length === n && (await store.seatGet(net, id3)).status === "open", "no payment found: rejected, nothing moved or paid, the listing stays open");

  // move_god fails: the listing reopens and the buyer is refunded.
  const net2 = "t2";
  const lid = await store.seatList(net2, { clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), at: NOW });
  await store.seatBuy(net2, { tx: "TX3", listing: lid, buyer: "buyer.test", amount: S.yoctoOf("2.5") });
  const bad = fakeChain({ moveGod: async () => { throw new Error("Only the owner"); } });
  const out4 = await S.settleBuy(net2, (await store.seatBuysWaiting(net2))[0], { store, chain: bad, escrow: ESCROW, sleep: async () => {} });
  ok(out4?.status === "refunded" && bad.calls.some((c) => c[0] === "pay" && c[1] === "buyer.test") && (await store.seatGet(net2, lid)).status === "open", "move_god failed: refunded, the listing is open again");

  // The seller's payment fails after the move: kept as due and paid on a later try, never twice.
  const net3 = "t3";
  const lid3 = await store.seatList(net3, { clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), at: NOW });
  await store.seatBuy(net3, { tx: "TX4", listing: lid3, buyer: "buyer.test", amount: S.yoctoOf("2.5") });
  let fail = true;
  const flaky = fakeChain({ pay: async (to, amount) => { if (fail) throw new Error("rpc 500"); flaky.calls.push(["pay", to, amount]); return { hash: "P" }; } });
  const o5 = await S.settleBuy(net3, (await store.seatBuysWaiting(net3))[0], { store, chain: flaky, escrow: ESCROW, sleep: async () => {} });
  ok(o5?.status === "pay-due", "the seat moved but paying the seller failed: pay-due");
  fail = false;
  const o6 = await S.settleBuy(net3, (await store.seatBuysWaiting(net3))[0], { store, chain: flaky, escrow: ESCROW, sleep: async () => {} });
  ok(o6?.status === "filled" && flaky.calls.filter((c) => c[0] === "move").length === 1 && flaky.calls.filter((c) => c[0] === "pay").length === 1, "the next try pays the seller, without moving the seat again");

  // 13 Nov on the real chain: the RPC answered an error to a move that had landed. The chain decides: the seller is
  // paid and the buyer keeps the seat (the first version refunded them too).
  const net4 = "t4";
  const lid4 = await store.seatList(net4, { clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), at: NOW });
  await store.seatBuy(net4, { tx: "TX5", listing: lid4, buyer: "buyer.test", amount: S.yoctoOf("2.5") });
  const liar = fakeChain();
  liar.moveGod = async (clan, from, to) => { liar.calls.push(["move", clan, from, to]); liar.gods[clan] = liar.gods[clan].map((g) => (g === from ? to : g)); throw new Error("Internal server error"); };
  const o7 = await S.settleBuy(net4, (await store.seatBuysWaiting(net4))[0], { store, chain: liar, escrow: ESCROW, sleep: async () => {} });
  ok(o7?.status === "filled" && liar.calls.filter((c) => c[0] === "pay").length === 1 && liar.calls.find((c) => c[0] === "pay")[1] === "seller.test", "a move that errored but landed: the seller is paid, the buyer is NOT refunded");
  // The chain can't be read after the error: the buy waits (the seat stays held), and the next try finishes it.
  const net5 = "t5";
  const lid5 = await store.seatList(net5, { clan: 12, seller: "seller.test", price: S.yoctoOf("2.5"), at: NOW });
  await store.seatBuy(net5, { tx: "TX6", listing: lid5, buyer: "buyer.test", amount: S.yoctoOf("2.5") });
  const blind = fakeChain();
  let dark = false;
  const realGods = blind.godsOf;
  blind.godsOf = async (c) => { if (dark) throw new Error("rpc down"); return realGods(c); };
  blind.moveGod = async (clan, from, to) => { blind.calls.push(["move"]); blind.gods[clan] = blind.gods[clan].map((g) => (g === from ? to : g)); dark = true; throw new Error("timeout"); };
  const o8 = await S.settleBuy(net5, (await store.seatBuysWaiting(net5))[0], { store, chain: blind, escrow: ESCROW, sleep: async () => {} });
  ok(o8?.status === "waiting" && (await store.seatGet(net5, lid5)).status === "filling" && !blind.calls.some((c) => c[0] === "pay"), "can't tell if it moved: nothing paid or refunded, the seat stays held");
  dark = false;
  const o9 = await S.settleBuy(net5, (await store.seatBuysWaiting(net5))[0], { store, chain: blind, escrow: ESCROW, sleep: async () => {} });
  ok(o9?.status === "filled" && blind.calls.filter((c) => c[0] === "move").length === 1 && blind.calls.filter((c) => c[0] === "pay").length === 1, "the next try sees the move on chain: the seller is paid once, no second move");

  // Sealing: every finished buy becomes a record once.
  const un = await store.seatBuysUnsealed("t1");
  ok(un.length === 2 && un.some((x) => x.status === "filled") && un.some((x) => x.status === "refunded"), "filled and refunded buys wait to be sealed");
  const rec = S.recordOf(un.find((x) => x.status === "filled"), await store.seatGet("t1", id2));
  ok(rec.kind === "seat-sold" && rec.clan === 12 && rec.seller === "seller.test" && rec.buyer === "buyer.test" && rec.price === 2.5 && rec.tx, "a filled buy is a seat-sold record (price in grace, the move's record)");
  await store.seatBuysSealed(un.map((x) => x.tx));
  ok(!(await store.seatBuysUnsealed("t1")).length, "sealed once");
}

// 6. The wiring.
{
  const run = src("engine/run.mjs"), loop = src("engine/loop.mjs"), srv = src("server.mjs"), chain = src("engine/chain.mjs");
  ok(/seatBuysUnsealed/.test(run) && /carryReverence/.test(run) && run.indexOf("seatBuysUnsealed") < run.indexOf("RV.ensure("), "run.mjs carries reverence for a sold seat BEFORE any reverence.ensure (so the move never reads as a departure)");
  ok(/seatBuysSealed/.test(run), "run.mjs marks the sales sealed");
  ok(/seatBuysWaiting/.test(loop) && /settleBuy/.test(loop), "the loop settles waiting buys within seconds");
  ok(/moveGod/.test(chain) && /OWNER_PRIVATE_KEY/.test(chain), "chain.mjs moves gods with the owner key (from the engine's secret settings)");
  ok((chain.match(/^\s+stake[:(]/gm) || []).length === 1, "chain.mjs has ONE stake (a second one silently replaced the grant reserve's, 13 Nov)");
  ok(/\/api\/seat\b/.test(srv) && /\/api\/seat\/buy/.test(srv) && /acceptSeat/.test(srv), "server.mjs takes listings and buys");
  ok(/seats:\s*resolve/.test(src("vite.config.js")), "the seats page is built");
  ok(/\/seats\//.test(src("src/live/gods.js")), "the god panel links to the seats page");
}
fs.rmSync(dir, { recursive: true, force: true });

// 7. His ask 13 Nov: AI gods sell their seats too, and a human who buys one joins the season rankings as that god.
{
  ok(S.aiSeatPrice(2) === S.yoctoOf("2.5"), "an AI god asks its claim value plus a quarter (2 -> 2.5 grace)");
  ok(S.aiSeatPrice(0.1) === S.yoctoOf(String(S.AI_SEAT.min)), "never under the floor");
  ok(S.aiSeatPrice(1.01) === S.yoctoOf("1.3"), "rounded up to a tenth (1.01 x 1.25 = 1.2625 -> 1.3)");
  const clans = [
    { id: 3, alive: true, gods: [{ account: "saturn.op" }] },
    { id: 4, alive: true, gods: [{ account: "dushara.op" }, { account: "tez.op" }] },
    { id: 5, alive: true, gods: [{ account: "human.test" }] },
    { id: 6, alive: false, gods: [{ account: "mars.op" }] },
    { id: 7, alive: true, gods: [{ account: "lugh.op" }] },
  ];
  const ai = new Set(["saturn.op", "dushara.op", "tez.op", "mars.op", "lugh.op"]);
  const stakeOf = { 3: 2, 7: 4 };
  const open = [{ clan: 7, seller: "lugh.op", price: S.yoctoOf("5.1") }];
  const L = S.aiListings({ clans, ai, open, stakeOf: (c) => stakeOf[c] });
  ok(L.length === 1 && L[0].clan === 3 && L[0].seller === "saturn.op" && L[0].price === S.yoctoOf("2.5"), "an AI seat lists; a human's seat, a fallen nation and a seat with no claim value read don't; a fair listing already open stays (two-AI nations: test-ai-council.mjs)");
  const L2 = S.aiListings({ clans, ai, open: [{ clan: 7, seller: "lugh.op", price: S.yoctoOf("9") }], stakeOf: (c) => stakeOf[c] });
  ok(L2.some((x) => x.clan === 7 && x.price === S.yoctoOf("5")), "a listing the claim value has drifted away from is re-priced");

  // The buyer takes the AI god's place in the rankings: followed by reverence (carryReverence) and its name.
  const RV = await import("./reverence.mjs");
  const s = { clans: { 3: {} }, rev: { 3: { gods: { "saturn.op": { r: 60 } }, putIn: { "saturn.op": "1" }, followed: "saturn.op" } } };
  const onchain = [{ id: 3, name: "Numdial", alive: true }];
  ok(!RV.standings(s, onchain, ai).length, "an AI-led nation is out of the rankings");
  S.carryReverence(s.rev[3], "saturn.op", "buyer.test");
  ok(RV.standings(s, onchain, ai)[0]?.id === 3 && RV.standings(s, onchain, ai)[0].standing === 60, "after a human buys it, it ranks, on the AI god's reverence");
  await store.claimGodName("saturn.op", "Saturn");
  await store.moveGodName("saturn.op", "buyer.test");
  const names = await store.godNames(["buyer.test"]);
  ok(names["buyer.test"] === "Saturn", "the buyer is named as that god");
  ok(S.takesName({ seller: "saturn.op", buyer: "buyer.test", ai, seatsElsewhere: 0 }) && !S.takesName({ seller: "saturn.op", buyer: "b", ai, seatsElsewhere: 1 }) && !S.takesName({ seller: "human.test", buyer: "b", ai, seatsElsewhere: 0 }), "the name moves only from an AI god, and only to a buyer with no other seat (a god's name follows them everywhere)");
  await store.addAiGod("t9", "saturn.op", "Saturn", "INTJ");
  await store.removeAiGod("t9", "saturn.op");
  ok(!(await store.aiGods("t9")).some((g) => g.account === "saturn.op"), "the AI god that sold is no longer an AI god (it sits nowhere)");
  const run = src("engine/run.mjs");
  ok(/aiListings/.test(run) && /moveGodName/.test(run) && /removeAiGod/.test(run), "run.mjs lists AI seats each turn and hands the name over on a sale");
  ok(run.indexOf("seatBuysUnsealed") < run.indexOf("const AI_SET"), "a sale is sealed before the turn decides which nations are AI-led");
}
