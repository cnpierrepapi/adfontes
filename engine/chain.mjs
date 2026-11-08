// Talks to the world contract as the operator. Keys are read, never printed.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NETWORKS } from "./config.mjs";
import { connectSim } from "./chain-sim.mjs";

const YOCTO = 10n ** 24n;
export const toYocto = (near) => (BigInt(Math.round(near * 1e6)) * YOCTO) / 1_000_000n;
export const toNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
// Florins (SPEC §14): 1 florin = 10^22 units on chain (100 florins = 1 backing NEAR at the opening price).
export const toUnits = (fl) => (BigInt(Math.round(fl * 1e6)) * 10n ** 16n).toString();
export const toFlorins = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;
const MINT_MAX = 100; // florins per mint call (the contract's cap)
const T = (t) => (BigInt(t) * 10n ** 12n).toString();

function operatorAccount(net, provider) {
  const n = NETWORKS[net];
  // On Railway the operator key comes from service variables, never from a file.
  if (process.env.OPERATOR_ACCOUNT_ID && process.env.OPERATOR_PRIVATE_KEY)
    return new Account(process.env.OPERATOR_ACCOUNT_ID, provider, process.env.OPERATOR_PRIVATE_KEY);
  if (n.operatorKeyFile) {
    const k = JSON.parse(fs.readFileSync(n.operatorKeyFile, "utf8"));
    return new Account(k.account_id, provider, k.private_key);
  }
  const lines = fs.readFileSync(path.join(os.homedir(), "Documents", "env.txt"), "utf8").split(/\r?\n/);
  const get = (k) => lines.find((x) => x.startsWith(k + "="))?.slice(k.length + 1).trim();
  return new Account(get(`${n.operatorEnv}_ACCOUNT_ID`), provider, get(`${n.operatorEnv}_PRIVATE_KEY`));
}

export function connect(net) {
  // The fast-forward simulation (scripts/sim-week.mjs): a stand-in chain in a local file, never testnet.
  if (process.env.ADF_SIM_CHAIN) return connectSim(process.env.ADF_SIM_CHAIN);
  const n = NETWORKS[net];
  const provider = new JsonRpcProvider({ url: n.rpc });
  const op = operatorAccount(net, provider);
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
  };
}
