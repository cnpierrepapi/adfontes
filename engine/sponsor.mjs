// The testnet sponsor pool (SPEC §12m C, his call 7 Nov). Founding costs ~6.2 testnet NEAR, more
// than any faucet gives, so a pool account tops new founders up. It's filled from NEAR's testnet
// helper, which makes brand-new accounts holding 10 testnet NEAR, 10 per 12 hours: each new account
// deletes itself straight away with the pool as beneficiary, so all its NEAR lands in the pool and
// no extra key is ever kept. Testnet only; mainnet founders use their own NEAR.
import { Account, KeyPair } from "near-api-js";
import { resilientProvider } from "./chain.mjs";

export const SPONSOR = {
  rpc: "https://near-testnet.drpc.org", // FastNEAR as the backup (resilientProvider)
  helper: "https://helper.testnet.near.org/account",
  // His call 9 Nov: a new player starts with 7 NEAR of florins. The world's founding fund pays the
  // DAO and staking, so all a founder puts in becomes florins, less 14% to the jackpot:
  // 8.14 in -> 7 NEAR of florins; 8.3 leaves room for gas.
  perNation: 83n * 10n ** 23n,
  // ...and for each nation it sponsors, the pool tops the founding fund up by that nation's DAO +
  // staking costs (5.5 + 0.1), so sponsored players never drain it.
  fundPerNation: 56n * 10n ** 23n,
  keep: 2n * 10n ** 24n, // the pool keeps 2 NEAR back for its own gas and storage
  refillHours: 12, // the helper allows 10 new accounts per 12 hours
  refillCount: 10,
};
const provider = () => resilientProvider("testnet", SPONSOR.rpc);

export async function balanceOf(accountId) {
  try { return BigInt((await provider().query({ request_type: "view_account", finality: "optimistic", account_id: accountId })).amount); }
  catch { return null; } // no such account
}

/** How many more new testnet nations the pool can sponsor. */
export async function nationsLeft(poolId) {
  const b = await balanceOf(poolId);
  if (b == null || b <= SPONSOR.keep) return 0;
  return Number((b - SPONSOR.keep) / (SPONSOR.perNation + SPONSOR.fundPerNation));
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

/** Top the world's founding fund up from the pool (the contract's fund_founding). Returns the tx hash. */
export async function fundFounding(poolId, poolKey, world, amount = SPONSOR.fundPerNation) {
  const pool = new Account(poolId, provider(), poolKey);
  const r = await pool.callFunctionRaw({ contractId: world, methodName: "fund_founding", args: {}, deposit: amount, gas: 30n * 10n ** 12n });
  return r?.transaction?.hash ?? null;
}

/** Send a founder what they're short of founding, from the pool. Returns the tx hash. */
export async function topUp(poolId, poolKey, to, amount) {
  const pool = new Account(poolId, provider(), poolKey);
  const r = await pool.transfer({ receiverId: to, amount });
  return r?.transaction?.hash ?? null;
}

// Named accounts for players (his call 9 Nov): "Play without a wallet" used to give a 64-character
// hex account. Now the pool makes a readable one under its own name, e.g.
// amber-quill-417.adf-pool1-hf0w8.testnet, funds it and puts the player's browser key on it, all in
// one transaction. The key is the player's; the pool keeps no key on it.
const ADJ = ["amber", "ashen", "azure", "bright", "brisk", "copper", "crimson", "dusky", "gilded", "golden", "hazel", "ivory", "jade", "lucid", "merry", "misty", "noble", "olive", "quiet", "russet", "scarlet", "silver", "sly", "stout", "swift", "tawny", "umber", "velvet", "wild", "wry"];
const NOUN = ["quill", "lantern", "compass", "falcon", "heron", "orchard", "atlas", "lute", "abacus", "beacon", "cipher", "codex", "comet", "ember", "fresco", "galleon", "harbor", "inkwell", "kestrel", "loom", "mortar", "nova", "obelisk", "prism", "quarry", "raven", "sextant", "spire", "tallow", "vellum"];
export function randomName(rand = Math.random) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  return `${pick(ADJ)}-${pick(NOUN)}-${100 + Math.floor(rand() * 900)}`;
}
export const PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** Make a named player account under the pool, funded with `amount`, owned by `publicKey`. */
export async function createNamed(poolId, poolKey, publicKey, amount) {
  const { actions, PublicKey } = await import("near-api-js");
  const pool = new Account(poolId, provider(), poolKey);
  for (let i = 0; i < 6; i++) {
    const account = `${randomName()}.${poolId}`;
    if ((await balanceOf(account)) != null) continue; // taken: draw again
    const r = await pool.signAndSendTransaction({ receiverId: account, actions: [
      actions.createAccount(), actions.transfer(amount), actions.addFullAccessKey(PublicKey.fromString(publicKey)),
    ] });
    const fail = r.receipts_outcome?.find((o) => o.outcome.status.Failure);
    if (fail) throw new Error(`couldn't make ${account}: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 160)}`);
    return { account, tx: r?.transaction?.hash ?? null };
  }
  throw new Error("no free name after 6 tries");
}
