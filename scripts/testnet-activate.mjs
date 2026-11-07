// Activate a testnet wallet from its public key: send 0.5 testnet NEAR from the sponsor pool to the
// implicit account (the key as hex). Usage: node scripts/testnet-activate.mjs ed25519:<key>
import { Account, JsonRpcProvider, PublicKey } from "near-api-js";
import fs from "node:fs";
const pk = PublicKey.fromString(process.argv[2]);
const id = Buffer.from(pk.data).toString("hex");
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const k = JSON.parse(fs.readFileSync(".keys/adf-pool1-hf0w8.testnet.json", "utf8"));
const before = await provider.query({ request_type: "view_account", finality: "final", account_id: id }).then((a) => a.amount, () => null);
console.log("account:", id, "| exists before:", before !== null);
const r = await new Account("adf-pool1-hf0w8.testnet", provider, k.private_key).transfer({ receiverId: id, amount: 5n * 10n ** 23n });
console.log("sent 0.5 testnet NEAR, tx", r.transaction.hash);
await new Promise((res) => setTimeout(res, 3000));
const a = await provider.query({ request_type: "view_account", finality: "final", account_id: id });
console.log("balance now:", Number(BigInt(a.amount) / 10n ** 21n) / 1000, "testnet NEAR");
const keys = await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: id });
console.log("its access key is yours:", keys.keys.some((x) => x.public_key === process.argv[2]));
