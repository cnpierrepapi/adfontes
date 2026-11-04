// Shared helpers for the spikes. Keys live in .keys/ and are never printed.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

export const RPC_URL = "https://rpc.testnet.near.org";
export const provider = new JsonRpcProvider({ url: RPC_URL });

export function loadAccount(id) {
  const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8"));
  return new Account(k.account_id, provider, k.private_key);
}

export function firstKeyId() {
  const f = fs.readdirSync(".keys").find((n) => n.endsWith(".testnet.json"));
  if (!f) throw new Error("no testnet key in .keys/, run spike 01 first");
  return f.replace(/\.json$/, "");
}

export async function viewAccount(id) {
  try {
    return await provider.query({ request_type: "view_account", finality: "final", account_id: id });
  } catch {
    return null;
  }
}

export const yocto = (near) => (BigInt(Math.round(near * 1000)) * 10n ** 21n).toString();
export const near = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
