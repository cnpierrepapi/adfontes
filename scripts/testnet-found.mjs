// Found one nation on the TESTNET world (test NEAR only). Refuses anything but testnet.
// Usage (from adfontes/): node scripts/testnet-found.mjs <world> <god> "<name>" [topUpFrom]
// topUpFrom: another testnet god whose test NEAR covers the gap to min_found first.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

const [WORLD, GOD, NAME, FROM] = process.argv.slice(2);
for (const id of [WORLD, GOD, FROM].filter(Boolean)) if (!id.endsWith(".testnet")) throw new Error(`testnet only: ${id}`);
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const acct = (id) => {
  const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8"));
  return new Account(k.account_id, provider, k.private_key);
};
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const bal = async (id) => BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: id })).amount);
const view = (method, args = {}) => provider.callFunction({ contractId: WORLD, method, args });

const cfg = await view("get_config");
const deposit = BigInt(cfg.min_found) + 10n ** 23n; // min + 0.1 for play
const need = deposit + 5n * 10n ** 23n; // + headroom: 300 Tgas prepaid reserves ~0.3
const have = await bal(GOD);
console.log(`min_found ${fmt(cfg.min_found)}, ${GOD} has ${fmt(have)}`);
if (have < need) {
  if (!FROM) throw new Error("not enough test NEAR; pass a topUpFrom god");
  const gap = need - have;
  const r = await acct(FROM).transfer({ receiverId: GOD, amount: gap });
  console.log(`topped up ${fmt(gap)} from ${FROM}: ${r.transaction.hash}`);
}
const r = await acct(GOD).callFunctionRaw({ contractId: WORLD, methodName: "found_clan", args: { name: NAME }, deposit: deposit.toString(), gas: "300000000000000" });
const fails = r.receipts_outcome.filter((o) => o.outcome.status.Failure);
console.log(`found_clan "${NAME}": tx ${r.transaction.hash}, failures ${fails.length}`);
const clans = await view("list_clans", { limit: 100 });
console.log(clans.map((c) => `${c.id} ${c.name}${c.alive ? "" : " (dead)"}`).join(" | "));
