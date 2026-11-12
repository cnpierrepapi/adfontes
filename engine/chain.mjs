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
