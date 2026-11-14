// Talks to the world contract as the operator. Keys are read, never printed.
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode } from "near-api-js";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NETWORKS } from "./config.mjs";
import { connectSim } from "./chain-sim.mjs";
import { gasTopUp } from "./market.mjs";
import { reserveTopUp } from "./reserve.mjs";
import { guard as aiGuard, godSeed, sendChecked } from "./aigods.mjs";
import { returned } from "../src/live/calls.js";

const YOCTO = 10n ** 24n;
export const toYocto = (near) => (BigInt(Math.round(near * 1e6)) * YOCTO) / 1_000_000n;
export const toNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
// Florins (SPEC §14): 1 florin = 10^22 units on chain (100 florins = 1 backing NEAR at the opening price).
export const toUnits = (fl) => (BigInt(Math.round(fl * 1e6)) * 10n ** 16n).toString();
export const toFlorins = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;
const MINT_MAX = 100; // florins per mint call (the contract's cap)
const T = (t) => (BigInt(t) * 10n ** 12n).toString();

function operatorKey(net) {
  const n = NETWORKS[net];
  // On Railway the operator key comes from service variables, never from a file.
  if (process.env.OPERATOR_ACCOUNT_ID && process.env.OPERATOR_PRIVATE_KEY) return [process.env.OPERATOR_ACCOUNT_ID, process.env.OPERATOR_PRIVATE_KEY];
  if (n.operatorKeyFile) {
    const k = JSON.parse(fs.readFileSync(n.operatorKeyFile, "utf8"));
    return [k.account_id, k.private_key];
  }
  const lines = fs.readFileSync(path.join(os.homedir(), "Documents", "env.txt"), "utf8").split(/\r?\n/);
  const get = (k) => lines.find((x) => x.startsWith(k + "="))?.slice(k.length + 1).trim();
  return [get(`${n.operatorEnv}_ACCOUNT_ID`), get(`${n.operatorEnv}_PRIVATE_KEY`)];
}
// NEAR RPC that rides out rate limits (9 Nov: a FastNEAR 429 crashed the 00:02 UTC turn). Every
// call goes to the network's main RPC (testnet: dRPC); on a 429 it waits and tries again, then falls
// back to the backup (testnet: FastNEAR). A 429 means the request was refused, not run, so sending it again is safe. Any other
// error (a contract refusing, a missing account) comes straight back.

const is429 = (e) => e?.cause === 429 || /\b429\b|Rate limits exceeded|Too Many Requests/i.test(String(e?.message || e));
export function resilientProvider(net, url) {
  const all = [new JsonRpcProvider({ url }), new JsonRpcProvider({ url: NETWORKS[net].backupRpc })];
  return new Proxy(all[0], {
    get(target, key) {
      const v = target[key];
      if (typeof v !== "function") return v;
      return (...args) => {
        const first = v.apply(target, args);
        if (!(first instanceof Promise)) return first;
        return first.catch(async (e) => {
          if (!is429(e)) throw e;
          let last = e;
          for (const [i, p] of [[0, all[0]], [1, all[0]], [0, all[1]], [1, all[1]], [2, all[1]]]) {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
            try { return await p[key](...args); } catch (e2) { if (!is429(e2)) throw e2; last = e2; }
          }
          throw last;
        });
      };
    },
  });
}

// The world's owner key (seat trading, PLAN_13NOV step 4, his yes 12 Nov, testnet only): used ONLY for move_god on a
// paid, checked seat sale. From the engine's secret settings on Railway; on this PC the world's own key file.
function ownerAccount(net, provider) {
  if (net !== "testnet") return null;
  if (process.env.OWNER_ACCOUNT_ID && process.env.OWNER_PRIVATE_KEY) return new Account(process.env.OWNER_ACCOUNT_ID, provider, process.env.OWNER_PRIVATE_KEY);
  const f = `.keys/${NETWORKS[net].world}.json`;
  if (!fs.existsSync(f)) return null;
  const k = JSON.parse(fs.readFileSync(f, "utf8"));
  return new Account(k.account_id, provider, k.private_key);
}

function operatorAccount(net, provider) {
  const [id, key] = operatorKey(net);
  return new Account(id, provider, key);
}

// Agent wallets (8 Nov): each nation's Broker and Patron sign their own moves from their own NEAR
// accounts. Their keys are derived from the operator key (no new secret anywhere), and each
// account's only key is a function-call key for its own methods on the world contract; it can't send
// NEAR. Since the marketplace (9 Nov) the Broker trades from trader<id>.<operator>, whose key also
// lists, delists and buys on the market (a function-call key can never gain methods, so the first
// Broker wallets, broker<id>.<operator>, were retired and their tokens moved over).
const ROLE_METHOD = { Broker: ["agent_buy", "market_list", "market_delist", "market_buy"], Patron: ["agent_spend"] };
const walletOf = (clanId, role, opId) => `${role === "Broker" ? "trader" : "patron"}${clanId}.${opId}`;
const keyLabel = (role) => (role === "Broker" ? "Trader" : role); // the Broker's new key, not the retired one
const AGENT_FUND = 10n ** 23n; // 0.1 NEAR: storage plus a few hundred calls of gas
// Named nation accounts (9 Nov): <name>.<world>, made by the world contract, paid by the operator.
const ALIAS_DEPOSIT = 3n * 10n ** 22n; // 0.03 NEAR (the contract's ALIAS_DEPOSIT)
const FORWARD_MIN = 10n ** 21n; // only call forward() when at least 0.001 NEAR is waiting
function agentKeyPair(opKey, world, clanId, role) {
  const seed = createHash("sha256").update(`adf-agent|${opKey}|${world}|${clanId}|${role}`).digest();
  const pub = ed25519.getPublicKey(seed);
  return KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(pub)]))}`);
}

/** An AI god's key: from the operator key and its account (engine/aigods.mjs godSeed). */
function godKeyPair(opKey, world, account) {
  const seed = godSeed(opKey, world, account);
  return KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(ed25519.getPublicKey(seed))]))}`);
}

export function connect(net) {
  // The fast-forward simulation (scripts/sim-week.mjs): a stand-in chain in a local file, never testnet.
  if (process.env.ADF_SIM_CHAIN) return connectSim(process.env.ADF_SIM_CHAIN);
  const n = NETWORKS[net];
  const provider = resilientProvider(net, n.rpc);
  const op = operatorAccount(net, provider);
  const opKey = operatorKey(net)[1];
  const world = n.world;
  const view = (method, args = {}) => provider.callFunction({ contractId: world, method, args });
  const call = async (methodName, args, gasT = 30) => {
    const r = await op.callFunctionRaw({ contractId: world, methodName, args, gas: T(gasT) });
    const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
    if (fail) throw new Error(`${methodName} failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
    const v = r.status.SuccessValue;
    return { hash: r.transaction.hash, value: v ? JSON.parse(Buffer.from(v, "base64").toString() || "null") : null };
  };
  return {
    world,
    operator: op.accountId,
    config: () => view("get_config"),
    totals: () => view("get_totals"),
    clans: () => view("list_clans", { limit: 100 }),
    agents: (clanId) => view("list_agents", { clan_id: clanId, limit: 100 }),
    gift: (giftId) => view("get_gift", { gift_id: giftId }),
    // A nation's Sputnik DAO (read only): its proposals carry who proposed each god power.
    dao: (dao, method, args = {}) => provider.callFunction({ contractId: dao, method, args }),
    tick: (day) => call("tick", { day }),
    spawn: (clanId, name, role) => call("spawn_agent", { clan_id: clanId, name, role }),
    /** A new nation's whole team in ONE transaction (10 Nov: six separate calls took ~12 s). */
    async spawnMany(clanId, team) {
      const r = await op.signAndSendTransaction({ receiverId: world, actions: team.map(({ name, role }) => actions.functionCall("spawn_agent", { clan_id: clanId, name, role }, BigInt(T(30)), 0n)) });
      const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
      if (fail) throw new Error(`spawn_agent failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
      return r.transaction.hash;
    },
    stake: (clanId, account) => view("get_stake", { clan_id: clanId, account }),
    // Florins: trades move them, good work mints them, upkeep and Warden fines burn them.
    trade: (buyer, seller, florins, memo) => call("trade", { buyer, seller, amount: toUnits(florins), memo }),
    mint: async (clanId, florins, memo) => {
      let last = null;
      for (let left = florins; left > 1e-6; left -= MINT_MAX) last = await call("mint", { clan_id: clanId, amount: toUnits(Math.min(MINT_MAX, left)), memo });
      return last;
    },
    burn: (clanId, florins, memo) => call("burn", { clan_id: clanId, amount: toUnits(florins), memo }),
    giftDraft: (clanId, hash, passed) => call("gift", { clan_id: clanId, draft_hash: hash, warden_passed: passed }),
    setRoot: (day, root) => call("set_root", { day, root }),
    getRoot: (day) => view("get_root", { day }),
    // ---- AI gods (12 Nov, engine/aigods.mjs) ----
    /** Make an AI god's account (<name>.<operator>) with its derived key and a starting balance, once. */
    async aiEnsure(account, fundNear = 0.5) {
      const kp = godKeyPair(opKey, world, account);
      const exists = await provider.query({ request_type: "view_account", finality: "final", account_id: account }).then(() => true, () => false);
      if (exists) return false;
      if (!account.endsWith("." + op.accountId)) throw new Error("an AI god's account must sit under the operator");
      await op.signAndSendTransaction({ receiverId: account, actions: [actions.createAccount(), actions.transfer(BigInt(Math.round(fundNear * 1e6)) * 10n ** 18n), actions.addFullAccessKey(kp.getPublicKey())] });
      return true;
    },
    /** Phase E: a newcomer AI god founds its own nation. Engine code, not the planner, so it skips the AI guard (which
     *  refuses found_clan to planned actions). Via FastNEAR (dRPC 500s on long calls); an error is checked against the
     *  chain before it counts: the nation may exist anyway. */
    async aiFound(account, name, near) {
      const fast = new JsonRpcProvider({ url: n.backupRpc }), kp = godKeyPair(opKey, world, account);
      const acct = new Account(account, fast, kp.toString());
      // A just-made account's key can take a few seconds to show on this node (cold audit 14 Nov: Chang'e's founding
      // failed with "access key does not exist"): wait until it does.
      for (let i = 0; i < 10; i++) {
        const seen = await fast.query({ request_type: "view_access_key", finality: "final", account_id: account, public_key: kp.getPublicKey().toString() }).then(() => true, () => false);
        if (seen) break;
        await new Promise((res) => setTimeout(res, 2000));
      }
      try {
        const r = await acct.callFunctionRaw({ contractId: world, methodName: "found_clan", args: { name }, deposit: BigInt(Math.round(near * 1e6)) * 10n ** 18n, gas: BigInt(T(300)) });
        const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
        if (fail) throw new Error(`found_clan failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
        return { hash: r.transaction.hash };
      } catch (e) {
        await new Promise((res) => setTimeout(res, 8000));
        const c = (await view("list_clans", { limit: 100 })).find((x) => x.name === name && (x.gods || []).some((g) => g.account === account));
        if (c) return { hash: null, clan: c.id };
        throw e;
      }
    },
    /** The operator's spendable grace (it funds the AI gods and their foundings). */
    opBalance: async () => toNear((await provider.query({ request_type: "view_account", finality: "final", account_id: op.accountId })).amount),
    /** Its spendable NEAR. */
    async aiBalance(account) {
      const a = await provider.query({ request_type: "view_account", finality: "final", account_id: account });
      return Number((BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n) / 10n ** 18n) / 1e6;
    },
    /** Top an AI god up to `to` NEAR from the operator when it's under `min`. Returns NEAR sent. */
    async aiTopUp(account, min, to) {
      const have = await this.aiBalance(account).catch(() => null);
      if (have == null || have >= min) return 0;
      const send = +(to - have).toFixed(4);
      await op.transfer({ receiverId: account, amount: BigInt(Math.round(send * 1e6)) * 10n ** 18n });
      // Wait until the NEAR shows (13 Nov: a blessing went out before its top-up landed and was refused).
      for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 1500)); if (((await this.aiBalance(account).catch(() => 0)) ?? 0) >= min) break; }
      return send;
    },
    /** Send an AI god's calls (src/live/calls.js shapes), in order. Every call passes the guard first: no
     *  withdraw, no claim, no leaving, ever. A call with `bind` gets the id the one before it returned. */
    async aiSend(account, calls) {
      const acct = new Account(account, provider, godKeyPair(opKey, world, account).toString());
      let value = null, proposal = null; const hashes = []; // proposal: the motion's number (add_proposal's answer)
      for (const c0 of calls) {
        const c = c0.bind ? c0.bind(value) : c0;
        aiGuard(c, world);
        // Before sending: what "it landed" would look like (12 Nov: an RPC 500 on a motion that had landed).
        const putBefore = c.method === "bless" ? BigInt((await view("list_clans", { limit: 100 })).find((x) => x.id === c.args.clan_id)?.gods.find((g) => g.account === account)?.put_in ?? 0) : null;
        const landed = async () => {
          if (c.method === "bless") { const g = (await view("list_clans", { limit: 100 })).find((x) => x.id === c.args.clan_id)?.gods.find((x) => x.account === account); return g && BigInt(g.put_in) > putBefore ? { value: null, hash: null } : null; }
          if (c.method === "add_proposal") {
            const last = await provider.callFunction({ contractId: c.receiver, method: "get_last_proposal_id", args: {} });
            const ps = await provider.callFunction({ contractId: c.receiver, method: "get_proposals", args: { from_index: Math.max(0, last - 5), limit: 5 } });
            const p = ps.reverse().find((x) => x.proposer === account && x.description === c.args.proposal.description);
            return p ? { value: p.id, hash: null } : null;
          }
          if (c.method === "act_proposal") { const p = await provider.callFunction({ contractId: c.receiver, method: "get_proposal", args: { id: c.args.id } }); return p?.votes?.[account] ? { value: null, hash: null } : null; }
          return null;
        };
        const r = await sendChecked({
          send: async () => {
            const o = await acct.callFunctionRaw({ contractId: c.receiver, methodName: c.method, args: c.args, deposit: BigInt(c.deposit || 0), gas: BigInt(c.gas) });
            const fail = o.receipts_outcome.find((x) => x.outcome.status.Failure);
            if (fail) throw new Error(`${c.method} refused: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 200)}`);
            return { value: returned(o), hash: o.transaction.hash };
          },
          landed,
        });
        value = r.value; if (r.hash) hashes.push(r.hash);
        if (c.method === "add_proposal") proposal = r.value;
      }
      return { hash: hashes.at(-1) ?? null, hashes, value, proposal };
    },
    // ---- agent wallets ----
    agentId: (clanId, role) => walletOf(clanId, role, op.accountId),
    /** Make sure this nation's Broker and Patron have their wallets: create, fund, register. */
    async ensureAgents(clanId) {
      const made = [];
      for (const role of ["Broker", "Patron"]) {
        const id = walletOf(clanId, role, op.accountId);
        const have = await view("get_agent_wallet", { clan_id: clanId, role }).catch(() => null);
        if (have === id) continue;
        const kp = agentKeyPair(opKey, world, clanId, keyLabel(role));
        const exists = await provider.query({ request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);
        if (!exists) {
          await op.signAndSendTransaction({ receiverId: id, actions: [
            actions.createAccount(), actions.transfer(AGENT_FUND),
            actions.addFunctionCallAccessKey(kp.getPublicKey(), world, ROLE_METHOD[role]), // its only key: its own methods on the world
          ] });
        }
        await call("set_agent_wallet", { clan_id: clanId, role, account: id });
        made.push(id);
      }
      return made;
    },
    // ---- research as NEP-245 tokens (engine/tokens.mjs) ----
    /** Mint up to 50 tokens; the operator attaches 0.01 NEAR a token for their storage (a new token
     *  takes up to ~0.008) and the contract sends back what wasn't used. */
    async mtMint(mints, memo) {
      let r;
      try { r = await op.callFunctionRaw({ contractId: world, methodName: "mt_mint_batch", args: { mints, memo }, deposit: BigInt(mints.length) * 10n ** 22n, gas: T(150) }); }
      catch (e) {
        // 9 Nov, two turns running: the RPC answered 500 while waiting on the mint, yet the mint had
        // landed. On an RPC error (not a contract refusal), look on NEAR before calling it a failure.
        if (/panicked|Smart contract|NotEnoughBalance|InvalidNonce/i.test(String(e?.message ?? e))) throw e;
        for (const wait of [4000, 8000]) {
          await new Promise((res) => setTimeout(res, wait));
          const held = await Promise.all(mints.map((m) => view("mt_balance_of", { account_id: m.owner_id, token_id: m.token_id }).catch(() => null)));
          if (held.every((b) => b != null && BigInt(b) >= 1n)) return { hash: null, recovered: true };
        }
        throw e;
      }
      const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
      if (fail) throw new Error(`mt_mint_batch failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
      return { hash: r.transaction.hash };
    },
    /** Move what a nation's DAO still holds into its Broker's wallet (up to 100 kinds a call). */
    async mtMoveToBroker(clanId) {
      const r = await op.callFunctionRaw({ contractId: world, methodName: "mt_move_to_broker", args: { clan_id: clanId, limit: 100 }, gas: T(200) });
      const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
      if (fail) throw new Error(`mt_move_to_broker failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
      const v = r.status.SuccessValue;
      return { moved: v ? JSON.parse(Buffer.from(v, "base64").toString()) : 0, hash: r.transaction.hash };
    },
    /** Does this account hold any tokens at all? */
    mtHoldsAny: (owner) => view("mt_tokens_for_owner", { account_id: owner, limit: 1 }).then((l) => l.length > 0, () => false),
    /** What an account already holds of these tokens (null: a world from before tokens). */
    mtBalances: (owner, tokenIds) => view("mt_batch_balance_of", { account_id: owner, token_ids: tokenIds }).catch(() => null),
    // ---- named nation accounts ----
    /** Make sure this nation has its named account; returns it (or null if the world can't make one yet). */
    async ensureAlias(clanId) {
      const have = await view("get_alias", { clan_id: clanId }).catch(() => undefined);
      if (have === undefined) return null; // a world contract from before named accounts
      if (have) return have;
      // 9 Nov: dRPC answered "Internal server error" while the account was being made (Babamako and
      // Colo Colo); it existed seconds later. On an RPC error, look on NEAR before calling it a failure.
      let r;
      try { r = await op.callFunctionRaw({ contractId: world, methodName: "create_alias", args: { clan_id: clanId }, deposit: ALIAS_DEPOSIT, gas: T(60) }); }
      catch (e) {
        if (/panicked|ExecutionError|FunctionCallError/.test(String(e.message || e))) throw e; // the contract itself said no
        for (let i = 0; i < 8; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const a = await view("get_alias", { clan_id: clanId }).catch(() => null);
          if (a) return a;
        }
        throw e;
      }
      const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
      if (fail) throw new Error(`create_alias failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
      // Testnet view reads lag behind a fresh write: ask again for up to ~10 s.
      for (let i = 0; i < 5; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const a = await view("get_alias", { clan_id: clanId }).catch(() => null);
        if (a) return a;
      }
      return null; // made but not readable yet: the next turn picks it up
    },
    /** Send whatever is waiting at a nation's named account on to its DAO. Returns { near, hash } or null. */
    /** Keep an agent wallet in gas money (his rule 12 Nov, engine/market.mjs gasTopUp): under 0.1 NEAR
     *  spendable (balance less what its storage locks), the operator tops it up to 0.2. Returns the NEAR sent, or 0. */
    async ensureGas(clanId, role) {
      const id = walletOf(clanId, role, op.accountId);
      const a = await provider.query({ request_type: "view_account", finality: "final", account_id: id }).catch(() => null);
      if (!a) return 0;
      const spendable = Number((BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n) / 10n ** 18n) / 1e6;
      const send = gasTopUp(spendable);
      if (!send) return 0;
      await op.transfer({ receiverId: id, amount: BigInt(Math.round(send * 1e6)) * 10n ** 18n });
      return send;
    },
    /** Keep the world contract's spare NEAR (engine/reserve.mjs): reads get_totals, the operator sends
     *  the top-up as a plain transfer. Returns { near, spare, hash } or null when nothing was needed. */
    async keepReserve() {
      const t = await view("get_totals");
      const send = reserveTopUp(t);
      if (!send) return null;
      const spare = Number(BigInt(t.balance) / 10n ** 18n - BigInt(t.liabilities) / 10n ** 18n - BigInt(t.storage_locked) / 10n ** 18n) / 1e6;
      const r = await op.transfer({ receiverId: world, amount: BigInt(Math.round(send * 1e6)) * 10n ** 18n });
      return { near: send, spare, hash: r?.transaction?.hash ?? null };
    },
    // ---- seat trading (PLAN_13NOV step 4, engine/seats.mjs): the operator is the escrow ----
    escrow: op.accountId,
    /** A transaction's outcome (null if the record has none). */
    txOf: async (hash, sender) => {
      // wait_until NONE answers UNKNOWN_TRANSACTION at once for a made-up hash (FINAL just hangs, 13 Nov).
      for (const url of [n.backupRpc, n.rpc]) {
        const ask = (w) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: w } }), signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => null);
        const j0 = await ask("NONE");
        if (j0?.error?.cause?.name === "UNKNOWN_TRANSACTION") return null;
        const j = await ask("FINAL");
        if (j?.result?.transaction) return j.result;
      }
      throw new Error("couldn't read the payment just now");
    },
    godsOf: async (clanId) => ((await view("get_clan", { clan_id: clanId }))?.gods || []).map((g) => g.account),
    owed: async (account) => BigInt(await view("get_owed", { account })),
    async moveGod(clanId, from, to) {
      // FastNEAR for the owner's call: dRPC answers 500 on long calls (10 Nov, and a move_god on 13 Nov).
      const owner = ownerAccount(net, new JsonRpcProvider({ url: n.backupRpc }));
      if (!owner) throw new Error("no owner key here: seats can't move");
      const r = await owner.callFunctionRaw({ contractId: world, methodName: "move_god", args: { clan_id: clanId, from, to }, deposit: 2n * 10n ** 22n, gas: BigInt(T(300)) });
      const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
      if (fail) throw new Error(`move_god failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
      return { hash: r.transaction.hash };
    },
    /** The escrow pays out (a seller's price, or a buyer's refund). */
    async pay(to, yocto) {
      const r = await op.transfer({ receiverId: to, amount: BigInt(yocto) });
      return { hash: r?.transaction?.hash ?? null };
    },
    async forwardAlias(alias) {
      const a = await provider.query({ request_type: "view_account", finality: "final", account_id: alias });
      const waiting = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n - 5n * 10n ** 21n;
      if (waiting < FORWARD_MIN) return null;
      const r = await op.callFunctionRaw({ contractId: alias, methodName: "forward", args: {}, gas: T(10) });
      const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
      if (fail) throw new Error(`forward failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 200)}`);
      return { near: Number(waiting / 10n ** 18n) / 1e6, hash: r.transaction.hash };
    },
    // ---- the marketplace (agents only, 9 Nov): signed by the nation's Broker from its trader wallet ----
    marketList: (clanId, tokenId, florins, reason) => agentCall(clanId, "Broker", "market_list", { token_id: tokenId, price: toUnits(florins), reason: String(reason).slice(0, 200) }),
    marketDelist: (clanId, listingId) => agentCall(clanId, "Broker", "market_delist", { listing_id: listingId }),
    marketBuy: (clanId, listingId, reason) => agentCall(clanId, "Broker", "market_buy", { listing_id: listingId, reason: String(reason).slice(0, 200) }),
    /** Every listing / sale from index `from` (prices in florins). null: a world without the market. */
    marketListings: (from = 0) => view("market_listings", { from_index: from, limit: 500 }).then((l) => l.map((x) => ({ ...x, price: toFlorins(x.price) })), () => null),
    marketSales: (from = 0) => view("market_sales", { from_index: from, limit: 500 }).then((l) => l.map((x) => ({ ...x, price: toFlorins(x.price) })), () => null),
    /** The nation's Broker buys from another nation, signing from its own wallet. */
    agentBuy: (clanId, seller, florins, memo) => agentCall(clanId, "Broker", "agent_buy", { seller, amount: toUnits(florins), memo }),
    /** The nation's Patron spends florins (war chest, walls), signing from its own wallet. */
    agentSpend: (clanId, florins, memo) => agentCall(clanId, "Patron", "agent_spend", { amount: toUnits(florins), memo }),
  };
  async function agentCall(clanId, role, methodName, args) {
    const id = walletOf(clanId, role, op.accountId);
    const agent = new Account(id, provider, agentKeyPair(opKey, world, clanId, keyLabel(role)).toString());
    const r = await agent.callFunctionRaw({ contractId: world, methodName, args, gas: T(30) });
    const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
    if (fail) throw new Error(`${methodName} failed: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
    const v = r.status.SuccessValue;
    return { hash: r.transaction.hash, value: v ? JSON.parse(Buffer.from(v, "base64").toString() || "null") : null, signer: id };
  }
}
