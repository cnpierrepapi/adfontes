// The testnet sponsor pool (SPEC §12m C, his call 7 Nov). Founding costs ~6.2 testnet NEAR, more
// than any faucet gives, so a pool account tops new founders up. It's filled from NEAR's testnet
// helper, which makes brand-new accounts holding 10 testnet NEAR, 10 per 12 hours: each new account
// deletes itself straight away with the pool as beneficiary, so all its NEAR lands in the pool and
// no extra key is ever kept. Testnet only; mainnet founders use their own NEAR.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

export const SPONSOR = {
  rpc: "https://rpc.testnet.fastnear.com",
  helper: "https://helper.testnet.near.org/account",
  perNation: 62n * 10n ** 23n, // 6.2 testnet NEAR: the founding minimum (6) plus gas
  keep: 2n * 10n ** 24n, // the pool keeps 2 NEAR back for its own gas and storage
  refillHours: 12, // the helper allows 10 new accounts per 12 hours
  refillCount: 10,
};
const provider = () => new JsonRpcProvider({ url: SPONSOR.rpc });

export async function balanceOf(accountId) {
  try { return BigInt((await provider().query({ request_type: "view_account", finality: "optimistic", account_id: accountId })).amount); }
  catch { return null; } // no such account
}

/** How many more new testnet nations the pool can sponsor. */
export async function nationsLeft(poolId) {
  const b = await balanceOf(poolId);
  if (b == null || b <= SPONSOR.keep) return 0;
  return Number((b - SPONSOR.keep) / SPONSOR.perNation);
}

/** Move an account's whole balance into the pool by deleting it (beneficiary = pool). */
export async function sweep(accountId, privateKey, poolId) {
  const a = new Account(accountId, provider(), privateKey);
  return a.deleteAccount(poolId);
}

/** Make up to `n` helper accounts and sweep each into the pool. Stops at the helper's limit. */
export async function refill(poolId, n = SPONSOR.refillCount, log = console.log) {
  let made = 0, limitReset = null;
  for (let i = 0; i < n; i++) {
    const id = `adf-fill${Date.now().toString(36)}${i}.testnet`;
    const kp = KeyPair.fromRandom("ed25519");
    const res = await fetch(SPONSOR.helper, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
    limitReset = Number(res.headers.get("x-ratelimit-reset")) || limitReset;
    if (!res.ok) { log(`  sponsor refill: helper said ${res.status} after ${made}`); break; }
    for (let t = 0; t < 10 && (await balanceOf(id)) == null; t++) await new Promise((r) => setTimeout(r, 1500));
    try { await sweep(id, kp.toString(), poolId); made++; }
    catch (e) { log(`  sponsor refill: couldn't sweep ${id}: ${String(e.message).slice(0, 120)}`); }
  }
  return { made, limitReset };
}

/** Send a founder what they're short of founding, from the pool. Returns the tx hash. */
export async function topUp(poolId, poolKey, to, amount) {
  const pool = new Account(poolId, provider(), poolKey);
  const r = await pool.transfer({ receiverId: to, amount });
  return r?.transaction?.hash ?? null;
}
