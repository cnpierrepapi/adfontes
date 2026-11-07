// The gods' wallet (SPEC §12j): connect with Meteor, MyNearWallet or HOT, read the chain straight
// from the browser, and send exactly the call the confirm card showed. Nothing here ever sees a key:
// the wallet signs, we only hand it the transaction.
import "./buffer-shim.js"; // must stay the first import
import { setupWalletSelector, actionCreators } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { returned } from "./calls.js";

const RPC = { testnet: "https://rpc.testnet.fastnear.com", mainnet: "https://rpc.mainnet.fastnear.com" };
export const YOCTO = 10n ** 24n;
export const TGAS = 10n ** 12n;
const enc = new TextEncoder(), dec = new TextDecoder();

/** "1.25" -> yocto (bigint). Up to 6 decimals; anything else throws. */
export function toYocto(s) {
  const m = String(s).trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) throw new Error("Write the amount like 1 or 0.5");
  return BigInt(m[1]) * YOCTO + BigInt((m[2] || "").padEnd(6, "0")) * 10n ** 18n;
}
/** yocto -> "1.25" (trimmed, up to 4 decimals). */
export function near(y) {
  const v = BigInt(y || 0), whole = v / YOCTO, frac = ((v % YOCTO) * 10000n) / YOCTO;
  return frac ? `${whole}.${String(frac).padStart(4, "0").replace(/0+$/, "")}` : String(whole);
}

export async function createWallet(net) {
  const rpc = RPC[net] ?? RPC.testnet;
  let id = 0;
  async function view(contractId, method, args = {}) {
    const r = await fetch(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: contractId, method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
    }).then((x) => x.json());
    if (r.error || r.result?.error) throw new Error(r.error?.data || r.error?.message || r.result.error);
    return JSON.parse(dec.decode(new Uint8Array(r.result.result)));
  }
  async function txStatus(hash, sender) {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" } }) }).then((x) => x.json());
    return r.result ?? null;
  }

  // HOT has no testnet, so it's offered only when the world runs on mainnet.
  const modules = [setupMeteorWallet(), setupMyNearWallet()];
  if (net === "mainnet") {
    const { setupHotWallet } = await import("@near-wallet-selector/hot-wallet");
    modules.push(setupHotWallet());
  }
  const selector = await setupWalletSelector({ network: net === "mainnet" ? "mainnet" : "testnet", modules });
  const listeners = new Set();
  const account = () => selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
  let last = account();
  selector.store.observable.subscribe(() => { const a = account(); if (a !== last) { last = a; for (const f of listeners) f(a); } });

  async function wallets() {
    const out = [];
    for (const m of selector.store.getState().modules) out.push({ id: m.id, name: m.metadata.name, icon: m.metadata.iconUrl, available: m.metadata.available !== false });
    return out;
  }
  async function signIn(walletId) {
    const w = await selector.wallet(walletId);
    await w.signIn({ accounts: [] });
    return account();
  }
  async function signOut() {
    if (!selector.isSignedIn()) return;
    await (await selector.wallet()).signOut();
  }
  /**
   * Send calls one transaction at a time, in order. A call with bind(prev) is completed from the
   * previous call's return value first (a DAO vote needs the id its proposal got).
   */
  async function send(calls) {
    const w = await selector.wallet();
    const outs = [];
    for (let c of calls) {
      if (c.bind) {
        const prev = returned(outs.at(-1));
        if (prev == null) throw new Error("The proposal went in but its number didn't come back. Vote on it from Open proposals.");
        c = c.bind(prev);
      }
      let out;
      try { out = await w.signAndSendTransaction({ receiverId: c.receiver, actions: [actionCreators.functionCall(c.method, enc.encode(JSON.stringify(c.args)), BigInt(c.gas), BigInt(c.deposit))] }); }
      catch (e) { if (outs.length) e.partial = outs; throw e; } // the first went through, a later one didn't
      outs.push(out);
      if (failure(out)) break;
    }
    return outs.filter(Boolean);
  }
  // Dev check (scripts/check-preload.cjs): build and encode a real transaction with the same
  // libraries the wallets use, so a missing browser global shows up without a wallet.
  async function encodeCheck(c) {
    const { createTransaction, encodeTransaction } = await import("@near-js/transactions");
    const { KeyPair } = await import("@near-js/crypto");
    const pk = KeyPair.fromRandom("ed25519").getPublicKey();
    const tx = createTransaction("someone.testnet", pk, c.receiver, 1n, [actionCreators.functionCall(c.method, enc.encode(JSON.stringify(c.args)), BigInt(c.gas), BigInt(c.deposit))], new Uint8Array(32));
    // The very step Meteor and MyNearWallet take to hand the transaction over (their bundles call Buffer).
    return Buffer.from(encodeTransaction(tx)).toString("base64").length;
  }
  return { net, rpc, view, encodeCheck, txStatus, wallets, signIn, signOut, send, account, onAccount: (f) => listeners.add(f), explorer: net === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io" };
}

/** Did this outcome fail anywhere? Returns the first failure in plain-ish words, or null. */
export function failure(outcome) {
  const all = [outcome?.transaction_outcome, ...(outcome?.receipts_outcome || [])];
  for (const o of all) {
    const f = o?.outcome?.status?.Failure;
    if (f) {
      const msg = JSON.stringify(f).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? JSON.stringify(f).match(/"(ERR_[A-Z_]+)/)?.[1];
      return msg || "the transaction failed";
    }
  }
  if (outcome?.status?.Failure) return "the transaction failed";
  return null;
}
