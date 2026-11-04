// Spike 1: make a NEAR testnet account through the public testnet helper (free test NEAR).
// The private key goes to .keys/<account>.json and is never printed.
import { KeyPair, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";
import path from "node:path";

const id = process.argv[2] || `adfontes-${Date.now().toString(36)}.testnet`;
const dir = path.resolve(".keys");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${id}.json`);
if (fs.existsSync(file)) throw new Error(`key file for ${id} already exists`);

const kp = KeyPair.fromRandom("ed25519");
const res = await fetch("https://helper.testnet.near.org/account", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
});
console.log("helper:", res.status, (await res.text()).slice(0, 200));
if (!res.ok) process.exit(1);

fs.writeFileSync(file, JSON.stringify({ account_id: id, private_key: kp.toString() }), { mode: 0o600 });

const rpc = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
await new Promise((r) => setTimeout(r, 3000));
const acc = await rpc.query({ request_type: "view_account", finality: "final", account_id: id });
console.log(id, "balance", Number(BigInt(acc.amount) / 10n ** 21n) / 1000, "NEAR, storage", acc.storage_usage, "bytes");
