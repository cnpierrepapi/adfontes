// Sweep retired testnet wallets into the sponsor pool (his order, 7 Nov). Transfers only (no
// deletes: accounts over 10 kB of state can't be deleted). Leaves storage cost + a little gas.
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";
const POOL = "adf-pool1-hf0w8.testnet";
const ids = process.argv.slice(2);
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const Y = 10n ** 24n;
for (const id of ids) {
  const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8"));
  const v = await provider.query({ request_type: "view_account", finality: "final", account_id: id });
  const locked = BigInt(v.storage_usage) * 10n ** 19n; // 1e19 yocto per byte
  const send = BigInt(v.amount) - locked - Y / 20n; // keep 0.05 for gas
  if (send <= 0n) { console.log(id, "nothing to send"); continue; }
  const a = new Account(id, provider, k.private_key);
  const r = await a.transfer({ receiverId: POOL, amount: send });
  console.log(id.padEnd(30), "sent", (Number(send / 10n ** 20n) / 1e4).toFixed(3), "tx", r.transaction.hash);
}
