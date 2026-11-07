// How many funded testnet accounts will NEAR's testnet helper create before it limits us?
// Each success = a new account holding 10 testnet NEAR, key saved to .keys/ (never printed).
// Stops at the first refusal, or after MAX tries. Usage: node scripts/helper-limit-test.mjs [max]
import { KeyPair } from "near-api-js";
import fs from "node:fs";
import path from "node:path";

const MAX = Number(process.argv[2] || 10);
const dir = path.resolve(".keys");
fs.mkdirSync(dir, { recursive: true });
const rpc = (account_id) => fetch("https://rpc.testnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "optimistic", account_id } }) }).then((r) => r.json());
const t0 = Date.now();
let made = 0;
for (let i = 1; i <= MAX; i++) {
  const id = `adf-pool${i}-${Date.now().toString(36).slice(-5)}.testnet`;
  const kp = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  const body = (await res.text()).slice(0, 160).replace(/\s+/g, " ");
  const limitHeaders = [...res.headers].filter(([k]) => /rate|limit|retry/i.test(k)).map(([k, v]) => `${k}=${v}`).join(" ");
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (!res.ok) { console.log(`#${i} at ${secs}s: REFUSED ${res.status} ${limitHeaders} | ${body}`); break; }
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ account_id: id, private_key: kp.toString() }), { mode: 0o600 });
  await new Promise((r) => setTimeout(r, 2500));
  const a = await rpc(id);
  made++;
  console.log(`#${i} at ${secs}s: ${res.status} ${id} balance ${a.result ? Number(BigInt(a.result.amount) / 10n ** 21n) / 1000 : "?"} NEAR ${limitHeaders}`);
}
console.log(`made ${made} account(s) in ${((Date.now() - t0) / 1000).toFixed(0)}s at ${new Date().toISOString()}`);
