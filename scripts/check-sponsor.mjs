// Dev check: the sponsor top-up end to end against a local server (PORT 4303), with a throwaway
// sub-account of god6. Sweeps everything back into the pool at the end.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import fs from "node:fs";
import { sweep, balanceOf, nationsLeft } from "../engine/sponsor.mjs";
const prov = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const g6 = JSON.parse(fs.readFileSync(".keys/adf-god6-77978.testnet.json", "utf8"));
const pool = process.env.SPONSOR_ACCOUNT_ID;
const id = `tester${Date.now().toString(36).slice(-4)}.adf-god6-77978.testnet`;
const kp = KeyPair.fromRandom("ed25519");
await new Account(g6.account_id, prov, g6.private_key).createAccount({ newAccountId: id, publicKey: kp.getPublicKey().toString(), nearToTransfer: 10n ** 23n });
await new Promise((r) => setTimeout(r, 2500));
const n = (y) => (Number(y / 10n ** 21n) / 1000).toFixed(3);
console.log("made", id, "with", n(await balanceOf(id)), "| pool can sponsor", await nationsLeft(pool));
const post = (account) => fetch("http://localhost:4303/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) }).then(async (r) => [r.status, await r.json()]);
console.log("GET  /api/sponsor:", JSON.stringify(await fetch("http://localhost:4303/api/sponsor?net=testnet").then((r) => r.json())));
console.log("POST for our own adf- account:", JSON.stringify(await post("adf-god5-77978.testnet")));
console.log("POST for a missing account:", JSON.stringify(await post("nobody-here-xyz123.testnet")));
console.log("POST for the tester:", JSON.stringify(await post(id)));
await new Promise((r) => setTimeout(r, 2500));
console.log("tester now has", n(await balanceOf(id)), "(should be 6.2)");
console.log("POST again (should be refused):", JSON.stringify(await post(id)));
await sweep(id, kp.toString(), pool);
await new Promise((r) => setTimeout(r, 2500));
console.log("swept the tester back; pool can sponsor", await nationsLeft(pool));
