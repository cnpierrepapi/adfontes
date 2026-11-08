// Proves named player accounts (9 Nov) on testnet with a small amount, then gives the NEAR back:
// the pool makes <adjective-noun-nnn>.<pool> for a fresh browser-style key, the key (and only it)
// can sign for it, and the account deletes itself back into the pool. Nothing here prints a key.
//   node scripts/player-name-proof.mjs
import fs from "node:fs";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import { createNamed, balanceOf } from "../engine/sponsor.mjs";

const POOL = "adf-pool1-hf0w8.testnet";
const poolKey = JSON.parse(fs.readFileSync(`.keys/${POOL}.json`, "utf8")).private_key;
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const kp = KeyPair.fromRandom("ed25519"); // what the browser makes
const poolBefore = await balanceOf(POOL);
const { account, tx } = await createNamed(POOL, poolKey, kp.getPublicKey().toString(), 5n * 10n ** 22n);
await wait(3000);
ok(/^[a-z]+-[a-z]+-\d{3}\.adf-pool1-hf0w8\.testnet$/.test(account), `the pool made a named account: ${account} (tx ${tx})`);
ok((await balanceOf(account)) === 5n * 10n ** 22n, "it holds what the pool sent (0.05 NEAR here; 6.5 for a real player)");
const keys = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: account })).keys;
ok(keys.length === 1 && keys[0].public_key === kp.getPublicKey().toString() && keys[0].access_key.permission === "FullAccess", "its only key is the player's browser key: the pool keeps none");
// The player's key signs: here it deletes the test account back into the pool.
await new Account(account, provider, kp.toString()).deleteAccount(POOL);
await wait(3000);
ok((await balanceOf(account)) == null, "signed with the browser key: the test account deleted itself, NEAR back to the pool");
const poolAfter = await balanceOf(POOL);
console.log(`  pool: ${Number(poolBefore / 10n ** 21n) / 1000} -> ${Number(poolAfter / 10n ** 21n) / 1000} NEAR (gas only)`);
