// Talks to the world contract as the operator. Keys are read, never printed.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NETWORKS } from "./config.mjs";

const YOCTO = 10n ** 24n;
export const toYocto = (near) => (BigInt(Math.round(near * 1e6)) * YOCTO) / 1_000_000n;
export const toNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
const T = (t) => (BigInt(t) * 10n ** 12n).toString();

function operatorAccount(net, provider) {
  const n = NETWORKS[net];
  if (n.operatorKeyFile) {
    const k = JSON.parse(fs.readFileSync(n.operatorKeyFile, "utf8"));
    return new Account(k.account_id, provider, k.private_key);
  }
  const lines = fs.readFileSync(path.join(os.homedir(), "Documents", "env.txt"), "utf8").split(/\r?\n/);
  const get = (k) => lines.find((x) => x.startsWith(k + "="))?.slice(k.length + 1).trim();
  return new Account(get(`${n.operatorEnv}_ACCOUNT_ID`), provider, get(`${n.operatorEnv}_PRIVATE_KEY`));
}

export function connect(net) {
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
    tick: (day) => call("tick", { day }),
    spawn: (clanId, name, role) => call("spawn_agent", { clan_id: clanId, name, role }),
    trade: (buyer, seller, near, memo) => call("trade", { buyer, seller, amount: toYocto(near).toString(), memo }),
    upkeep: (clanId, near) => call("upkeep", { clan_id: clanId, amount: toYocto(near).toString() }),
    bounty: (clanId, near, memo) => call("bounty", { clan_id: clanId, amount: toYocto(near).toString(), memo }),
    giftDraft: (clanId, hash, passed, top) => call("gift", { clan_id: clanId, draft_hash: hash, warden_passed: passed, top_contributor: top }),
    setRoot: (day, root) => call("set_root", { day, root }),
    sweep: () => call("sweep_fees", {}, 60),
  };
}
