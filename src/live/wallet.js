// The gods' wallet (SPEC §12j): connect with Meteor, MyNearWallet or HOT, read the chain straight
// from the browser, and send exactly the call the confirm card showed. Nothing here ever sees a key:
// the wallet signs, we only hand it the transaction.
import "./buffer-shim.js"; // must stay the first import
import { setupWalletSelector, actionCreators } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { returned } from "./calls.js";

const RPC = { testnet: "https://near-testnet.drpc.org", mainnet: "https://rpc.mainnet.fastnear.com" }; // testnet: dRPC (9 Nov)
// Where the browser key sends its transactions (10 Nov): FastNEAR first, the way it worked before 9 Nov.
const SEND_RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"];
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
  /** An account's spendable NEAR (yocto), or null if it doesn't exist. */
  async function balance(account) {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "query", params: { request_type: "view_account", finality: "optimistic", account_id: account } }) }).then((x) => x.json());
    return r.result ? BigInt(r.result.amount) : null;
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
  // Play without a wallet (testnet only, 8 Nov): a NEAR key made in this browser. Since 9 Nov the
  // sponsor pool makes the player a named account for that key (amber-quill-417.<pool>), already
  // funded to found a nation. If the pool can't (limits, empty), the key's implicit account (64 hex
  // characters) is used as before. Never offered on mainnet: a key in a browser shouldn't hold real money.
  const LOCAL = `adf-local-key-${net}`;
  const localKey = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || "null"); } catch { return null; } };
  const localOn = () => net === "testnet" && localStorage.getItem(`${LOCAL}-on`) === "1" && !!localKey();
  const account = () => localOn() ? localKey().account : selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
  const tell = () => { const a = account(); if (a !== last) { last = a; for (const f of listeners) f(a); } };
  let last = account();
  selector.store.observable.subscribe(tell);

  async function wallets() {
    const out = [];
    if (net === "testnet") out.push({ id: "local", name: "Play without a wallet", icon: "/favicon.svg", available: true, note: "A key made in this browser. Save it from the wallet menu." });
    for (const m of selector.store.getState().modules) out.push({ id: m.id, name: m.metadata.name, icon: m.metadata.iconUrl, available: m.metadata.available !== false });
    return out;
  }
  /** Set once when "Play without a wallet" made a named, already funded account (then cleared). */
  function takeSponsored() {
    const lk = localKey();
    if (!lk?.sponsored) return null;
    localStorage.setItem(LOCAL, JSON.stringify({ ...lk, sponsored: null }));
    return lk.sponsored;
  }
  async function signIn(walletId) {
    if (walletId === "local") {
      if (net !== "testnet") throw new Error("Playing without a wallet is for testnet only.");
      if (!localKey()) {
        const { KeyPair } = await import("@near-js/crypto");
        const kp = KeyPair.fromRandom("ed25519");
        const pub = kp.getPublicKey();
        let accountId = [...pub.data].map((b) => b.toString(16).padStart(2, "0")).join(""), sponsored = null;
        const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ public_key: pub.toString() }) }).then((x) => x.json()).catch(() => ({}));
        if (r.ok && r.account) { accountId = r.account; sponsored = r.sent; }
        localStorage.setItem(LOCAL, JSON.stringify({ account: accountId, key: kp.toString(), sponsored }));
      }
      localStorage.setItem(`${LOCAL}-on`, "1");
      tell();
      return account();
    }
    const w = await selector.wallet(walletId);
    await w.signIn({ accounts: [] });
    return account();
  }
  async function signOut() {
    if (localOn()) { localStorage.removeItem(`${LOCAL}-on`); tell(); return; } // the key stays, to sign back in
    if (!selector.isSignedIn()) return;
    await (await selector.wallet()).signOut();
  }
  /**
   * Send calls one transaction at a time, in order. A call with bind(prev) is completed from the
   * previous call's return value first (a DAO vote needs the id its proposal got).
   */
  async function send(calls) {
    // Signed in without a wallet: sign here with the browser's key.
    const lk = localOn() ? localKey() : null;
    const w = lk ? await localSigner(lk) : await selector.wallet();
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
  // A signer with the same signAndSendTransaction shape the wallets have, for the browser key.
  // 10 Nov fix: near-api-js's own send waits for the result inside one RPC call and, when the RPC
  // answers 500/408/503 (dRPC does on longer calls like a founding or a claim), quietly re-sends up to
  // 12 times with growing waits: the card sat on "Sending…" for minutes after the chain was done.
  // Now: sign here, hand it over and wait only until it is in a block, then ask for the outcome every second ourselves,
  // FastNEAR first and dRPC as the backup, each call with its own short timeout.
  async function localSigner(lk) {
    // Built and signed right here from the key (10 Nov): near-api-js's Account here didn't hold the
    // key as a signer, which is where "Please provide a public key" came from.
    const { KeyPair } = await import("@near-js/crypto");
    const { createTransaction, encodeTransaction, SignedTransaction, Signature } = await import("@near-js/transactions");
    const { baseEncode, baseDecode } = await import("@near-js/utils");
    const kp = KeyPair.fromString(lk.key), pk = kp.getPublicKey();
    const call = (url, method, params, ms) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(ms) }).then((x) => x.json());
    const b64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
    let lastNonce = 0n; // two transactions in a row (a DAO proposal, then the vote) never reuse a nonce
    return {
      async signAndSendTransaction({ receiverId, actions }) {
        let ak = null;
        for (const url of SEND_RPCS) {
          const j = await call(url, "query", { request_type: "view_access_key", finality: "optimistic", account_id: lk.account, public_key: pk.toString() }, 8000).catch(() => null);
          if (j?.result?.nonce != null) { ak = j.result; break; }
          // An unknown key comes back as a "result" carrying an error, not as an error.
          if (j?.error || j?.result?.error) throw new Error(`NEAR doesn't know this browser's key for ${lk.account} yet. If you just made the account, wait a few seconds and try again.`);
        }
        if (!ak) throw new Error("Couldn't reach NEAR. Nothing was sent. Try again.");
        const nonce = (BigInt(ak.nonce) > lastNonce ? BigInt(ak.nonce) : lastNonce) + 1n;
        lastNonce = nonce;
        const tx = createTransaction(lk.account, pk, receiverId, nonce, actions, baseDecode(ak.block_hash));
        const h = new Uint8Array(await crypto.subtle.digest("SHA-256", encodeTransaction(tx)));
        const signed = new SignedTransaction({ transaction: tx, signature: new Signature({ keyType: pk.keyType, data: kp.sign(h).signature }) });
        const hash = baseEncode(h), body = b64(signed.encode());
        let handed = false, refused = null;
        for (const url of SEND_RPCS) {
          // "INCLUDED": back in a block or two, and a refusal (bad nonce, not enough NEAR) comes back at once.
          const j = await call(url, "send_tx", { signed_tx_base64: body, wait_until: "INCLUDED" }, 15000).catch(() => null);
          if (j?.result) { handed = true; break; }
          // The chain itself said no (bad nonce, not enough NEAR, expired): no point trying elsewhere.
          if (j?.error?.cause?.name === "INVALID_TRANSACTION") { refused = j.error.data ?? j.error.cause; break; }
        }
        if (refused) throw new Error(`NEAR refused it: ${JSON.stringify(refused).slice(0, 160)}`);
        const t0 = Date.now();
        while (Date.now() - t0 < 120e3) {
          for (const url of SEND_RPCS) {
            const j = await call(url, "tx", { tx_hash: hash, sender_account_id: lk.account, wait_until: "EXECUTED_OPTIMISTIC" }, 12000).catch(() => null);
            if (j?.result?.status) return j.result;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        throw new Error(handed ? "NEAR hasn't confirmed it yet. It may still go through: look again in a minute before trying again." : "Couldn't reach NEAR. Nothing was sent. Try again.");
      },
    };
  }
  /** The browser key, for the player to save (only when playing without a wallet). */
  const exportKey = () => (localOn() ? { account: localKey().account, private_key: localKey().key, network: net } : null);
  return { net, rpc, view, balance, encodeCheck, txStatus, wallets, signIn, signOut, send, account, exportKey, takeSponsored, isLocal: () => localOn(), onAccount: (f) => listeners.add(f), explorer: net === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io" };
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
