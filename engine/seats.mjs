// Seat trading (PLAN_13NOV step 4, his rule 12 Nov: KEEP IT SIMPLE). A god lists their seat in a nation at a price
// in grace with a signed message (no transaction). A buyer pays exactly that price to the escrow (the operator) and
// hands the site the payment's public record. The engine (engine/loop.mjs, within seconds) checks the payment,
// checks the seller is still a god there and that the world owes them nothing from other nations (move_god moves
// that too), then moves the seat with the contract's move_god (owner only) and pays the seller the whole price.
// Anything off and the buyer gets their grace back. EVERYTHING goes to the buyer: put_in, shares, grant, the council
// seat, the founder's place and the reverence (carryReverence, sealed by engine/run.mjs). Tested in test-seats.mjs.
import { verifySignature, verify413 } from "./choices.mjs";

export const SEAT = { minNear: 0.1, maxNear: 10000, freshMs: 10 * 60e3 };
const Y = 10n ** 24n;

/** "2.5" grace -> yocto as a string (up to 6 decimals). Null if it isn't a plain positive number. */
export function yoctoOf(near) {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(near).trim());
  if (!m) return null;
  return (BigInt(m[1]) * Y + BigInt((m[2] || "").padEnd(6, "0")) * (Y / 1_000_000n)).toString();
}
export const nearOf = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;

/** The exact text a seller signs (src/seats.js builds the same string). */
export const seatMessage = ({ world, action, clan, price, at }) =>
  `adfontes-seat:${JSON.stringify({ world, action, clan: Number(clan), price: String(price ?? "0"), at: Number(at) })}`;

/** Check a signed listing ("sell" at a price, or "unlist"). env = { world, now, keyOn, godOf, alive, owed, lastAt,
 *  isAi }. Returns { ok, row } or { error } in plain words for the page. */
export async function acceptSeat(b, env) {
  if (!b || typeof b !== "object") return { error: "Nothing to read." };
  if (b.action !== "sell" && b.action !== "unlist") return { error: "That isn't something you can do with a seat." };
  if (b.world !== env.world) return { error: "That is for another world." };
  const at = Number(b.at);
  if (!Number.isFinite(at) || Math.abs(env.now - at) > SEAT.freshMs) return { error: "That was signed too long ago. Try again." };
  const price = b.action === "sell" ? String(b.price ?? "") : "0";
  if (b.action === "sell") {
    if (!/^\d{1,40}$/.test(price)) return { error: "Name a price in grace." };
    const p = BigInt(price);
    if (p < BigInt(yoctoOf(String(SEAT.minNear))) || p > BigInt(yoctoOf(String(SEAT.maxNear)))) return { error: `Ask between ${SEAT.minNear} and ${SEAT.maxNear.toLocaleString("en")} grace.` };
  }
  const body = { world: b.world, action: b.action, clan: b.clan, price, at };
  const signedOk = b.nep413 ? verify413(seatMessage(body), b.nep413, b.signature, b.publicKey) : verifySignature(seatMessage(body), b.signature, b.publicKey);
  if (!signedOk) return { error: "The signature doesn't match. Nothing was saved." };
  if (!(await env.keyOn(b.account, b.publicKey))) return { error: "That key isn't on this account." };
  const clan = Number(b.clan);
  if (!(await env.godOf(clan, b.account))) return { error: "Only a god of this nation can sell a seat in it." };
  if (env.isAi(b.account)) return { error: "AI gods don't sell their seats here." };
  if (at <= Number(await env.lastAt(clan, b.account))) return { error: "You've changed this listing since. Reload and try again." };
  if (b.action === "sell") {
    if (!(await env.alive(clan))) return { error: "A fallen nation's seat can't be sold. Claim what's left instead." };
    if (BigInt(await env.owed(b.account)) > 0n) return { error: "The world owes you grace from another nation. Claim it first: a seat can't be sold while it does." };
  }
  return { ok: true, row: { clan, seller: b.account, action: b.action, price, at } };
}

/** Is this transaction (an RPC `tx` result) the buyer's payment: one plain transfer of exactly `amount` to the escrow,
 *  landed? Returns { ok } or { error }. */
export function checkPayment(tx, { buyer, escrow, amount }) {
  if (!tx?.transaction) return { error: "No such payment on the public record." };
  if (!tx.status || "Failure" in tx.status) return { error: "That payment didn't go through." };
  const t = tx.transaction;
  if (t.signer_id !== buyer) return { error: "That payment came from someone else." };
  if (t.receiver_id !== escrow) return { error: "That payment went somewhere else." };
  const a = t.actions || [];
  if (a.length !== 1 || !a[0]?.Transfer) return { error: "That isn't a plain payment." };
  if (String(a[0].Transfer.deposit) !== String(amount)) return { error: "That payment is for a different amount." };
  return { ok: true };
}

/** Fill or refund? `gods` = the nation's god accounts now; `owed` = what the world owes the seller now (BigInt). */
export function decideFill({ listing, buy, gods, owed }) {
  if (!listing || listing.status !== "open") return { refund: "The seat was sold or taken off before your payment arrived." };
  if (String(buy.amount) !== String(listing.price)) return { refund: "The price changed before your payment arrived." };
  if (buy.buyer === listing.seller) return { refund: "That's your own seat." };
  if (!gods.includes(listing.seller)) return { refund: "The seller left the nation before your payment arrived." };
  if (BigInt(owed) > 0n) return { refund: "The world owes the seller grace from elsewhere, so the seat can't move just now." };
  return { fill: true };
}

/** Reverence goes with the seat. A new god takes the seller's place whole; a buyer already there keeps the higher
 *  reverence and the blessing baselines add up (the contract merges the stakes). */
export function carryReverence(rv, seller, buyer) {
  const a = rv?.gods?.[seller];
  if (!a) return false;
  const b = rv.gods[buyer];
  rv.gods[buyer] = b ? { ...b, r: Math.max(a.r, b.r) } : a;
  delete rv.gods[seller];
  rv.putIn ||= {};
  rv.putIn[buyer] = (BigInt(rv.putIn[buyer] ?? 0) + BigInt(rv.putIn[seller] ?? 0)).toString();
  delete rv.putIn[seller];
  if (rv.followed === seller) rv.followed = buyer;
  if (rv.claimedBy === seller) rv.claimedBy = buyer;
  return true;
}

/** The record a finished buy becomes in its turn (sealed on NEAR with the rest). */
export function recordOf(buy, listing) {
  const price = nearOf(buy.amount);
  if (buy.status === "filled") return { kind: "seat-sold", clan: listing?.clan ?? null, seller: listing?.seller ?? null, buyer: buy.buyer, price, listing: buy.listing, paid_with: buy.tx, tx: buy.result?.move ?? null, paid: buy.result?.pay ?? null };
  return { kind: "seat-refund", clan: listing?.clan ?? null, buyer: buy.buyer, price, listing: buy.listing, paid_with: buy.tx, why: buy.result?.why ?? null, tx: buy.result?.refund ?? null };
}

/** Settle one buy. d = { store, chain: { txOf, godsOf, owed, moveGod, pay }, escrow, log }. Claims the buy first (only
 *  one settler ever works on it); a buy whose seat already moved ("pay-due") only retries paying the seller.
 *  Returns { status, why } or null when someone else has it. */
export async function settleBuy(net, buy, d) {
  const { store, chain } = d, log = d.log || (() => {});
  const was = await store.seatBuyClaim(net, buy.tx);
  if (!was) return null;
  const done = async (status, result) => { await store.seatBuyFinish(net, buy.tx, status, result); return { status, why: result.why ?? null }; };
  const keep = { ...(buy.result || {}) };
  if (was === "pay-due" || was === "refund-due") {
    const to = was === "pay-due" ? keep.seller : buy.buyer;
    try { const p = await chain.pay(to, buy.amount); return done(was === "pay-due" ? "filled" : "refunded", { ...keep, [was === "pay-due" ? "pay" : "refund"]: p?.hash ?? null }); }
    catch (e) { log(`seats: paying ${to} failed again: ${String(e.message || e).slice(0, 120)}`); return done(was, { ...keep, error: String(e.message || e).slice(0, 200) }); }
  }
  let tx;
  try { tx = await chain.txOf(buy.tx, buy.buyer); }
  catch (e) { await store.seatBuyFinish(net, buy.tx, "waiting", { ...keep, error: String(e.message || e).slice(0, 200) }); return { status: "waiting", why: "the payment couldn't be read just now" }; }
  const pay = checkPayment(tx, { buyer: buy.buyer, escrow: d.escrow, amount: buy.amount });
  if (pay.error) return done("rejected", { why: pay.error });
  const listing = await store.seatGet(net, buy.listing);
  const refund = async (why) => {
    try { const p = await chain.pay(buy.buyer, buy.amount); return done("refunded", { why, refund: p?.hash ?? null }); }
    catch (e) { return done("refund-due", { why, error: String(e.message || e).slice(0, 200) }); }
  };
  // The chain, not the RPC's answer, says whether the seat moved. 13 Nov on v2d: dRPC answered "Internal server
  // error" to a move_god that had landed, and the first version refunded a buyer who now held the seat. A move only
  // counts as failed when the seller is still there after ~20 s; if the chain can't be read, the buy waits.
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const movedOnChain = async () => {
    let g = null;
    for (const ms of [2000, 3000, 5000, 10000]) {
      await sleep(ms);
      g = await chain.godsOf(listing.clan).catch(() => null);
      if (g && g.includes(buy.buyer) && !g.includes(listing.seller)) return true;
    }
    return g ? false : null;
  };
  const sold = async (moveHash) => {
    await store.seatSetStatus(net, listing.id, "sold", buy.buyer);
    const res = { move: moveHash, seller: listing.seller, clan: listing.clan };
    try { const p = await chain.pay(listing.seller, buy.amount); return done("filled", { ...res, pay: p?.hash ?? null }); }
    catch (e) { log(`seats: paying the seller of listing ${listing.id} failed: ${String(e.message || e).slice(0, 120)}`); return done("pay-due", { ...res, error: String(e.message || e).slice(0, 200) }); }
  };
  // An earlier try left this buy mid-move: look at the chain first.
  if (listing?.status === "filling" && listing.buyer === buy.buyer) {
    const m = await movedOnChain();
    if (m === true) return sold(keep.move ?? null);
    if (m === null) return done("waiting", { ...keep, why: "checking whether the seat moved" });
    await store.seatSetStatus(net, listing.id, "open", null);
    listing.status = "open";
  }
  const gods = listing ? await chain.godsOf(listing.clan) : [];
  const owed = listing ? await chain.owed(listing.seller) : 0n;
  const dec = decideFill({ listing, buy, gods, owed });
  if (dec.refund) return refund(dec.refund);
  await store.seatSetStatus(net, listing.id, "filling", buy.buyer);
  let move;
  try { move = await chain.moveGod(listing.clan, listing.seller, buy.buyer); }
  catch (e) {
    log(`seats: move_god answered with an error for listing ${listing.id}: ${String(e.message || e).slice(0, 160)}; checking the chain`);
    const m = await movedOnChain();
    if (m === true) return sold(null);
    if (m === null) return done("waiting", { ...keep, why: "checking whether the seat moved" });
    await store.seatSetStatus(net, listing.id, "open", null);
    return refund("The seat couldn't be moved just now.");
  }
  return sold(move?.hash ?? null);
}

// AI gods sell their seats too (his ask 13 Nov): every scheduled turn, a nation led by ONE AI god (and nobody else)
// lists that god's seat at its claim value plus a quarter, never under the floor, re-priced when the claim value
// drifts. A human who buys one joins the season rankings as that god: reverence via carryReverence (the nation is
// then followed by a human, so engine/reverence.mjs standings counts it) and the AI god's name (takesName).
export const AI_SEAT = { premium: 1.25, min: 0.5, drift: 0.1 };
export function aiSeatPrice(claimNear) {
  const tenths = Math.ceil(Math.round(Number(claimNear || 0) * AI_SEAT.premium * 1e6) / 1e5);
  return yoctoOf(Math.max(AI_SEAT.min, tenths / 10).toFixed(1));
}
/** Which AI seats to (re)list now: [{ clan, seller, price }]. stakeOf(clan) = the AI god's claim value in grace. */
export function aiListings({ clans, ai, open, stakeOf }) {
  const out = [];
  for (const c of clans) {
    const gods = (c.gods || []).map((g) => g.account);
    if (c.alive === false || gods.length !== 1 || !ai.has(gods[0])) continue;
    const claim = stakeOf(c.id);
    if (claim == null) continue;
    const price = aiSeatPrice(claim), now = open.find((l) => l.clan === c.id && l.seller === gods[0]);
    if (now && Math.abs(nearOf(now.price) - nearOf(price)) <= nearOf(price) * AI_SEAT.drift) continue;
    out.push({ clan: c.id, seller: gods[0], price });
  }
  return out;
}
/** Does the buyer take the seller's name? Only from an AI god, and only a buyer with no seat anywhere else (a name is
 *  per account, so a god who already plays keeps theirs). */
export const takesName = ({ seller, ai, seatsElsewhere }) => ai.has(seller) && !seatsElsewhere;
