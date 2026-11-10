// Proof (10 Nov): a whole team can be spawned in ONE transaction, the way engine/chain.mjs spawnMany
// does it for a new nation. Runs on the test world v2d only, signed by its operator; adds two
// citizens with unique names to nation 1 ("Proof North") and checks the contract has both.
// Run: node scripts/spawn-batch-proof.mjs
import fs from "node:fs";
import { Account, JsonRpcProvider, actions } from "near-api-js";

const WORLD = "v2d.adf-pool1-hf0w8.testnet";
const key = JSON.parse(fs.readFileSync(".keys/v2dop.adf-pool1-hf0w8.testnet.json", "utf8"));
const provider = new JsonRpcProvider({ url: "https://near-testnet.drpc.org" });
const op = new Account(key.account_id, provider, key.private_key);
const view = (method, args = {}) => provider.callFunction({ contractId: WORLD, method, args });
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };

const tag = Date.now().toString(36).slice(-5);
const team = [{ name: `Batch ${tag} A`, role: "Scholar" }, { name: `Batch ${tag} B`, role: "Smith" }];
const before = await view("list_agents", { clan_id: 1, limit: 200 });
const t0 = Date.now();
const r = await op.signAndSendTransaction({ receiverId: WORLD, actions: team.map(({ name, role }) => actions.functionCall("spawn_agent", { clan_id: 1, name, role }, 30n * 10n ** 12n, 0n)) });
const ms = Date.now() - t0;
const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
ok(!fail, `one transaction with ${team.length} spawn_agent calls went through in ${(ms / 1000).toFixed(1)} s (tx ${r.transaction.hash})${fail ? ": " + JSON.stringify(fail.outcome.status.Failure).slice(0, 200) : ""}`);
await new Promise((x) => setTimeout(x, 3000));
const after = await view("list_agents", { clan_id: 1, limit: 200 });
for (const t of team) ok(after.some((a) => a.name === t.name && a.role === t.role), `the contract has ${t.name} (${t.role})`);
ok(after.length === before.length + team.length, `nation 1 went from ${before.length} to ${after.length} citizens`);
if (bad) process.exitCode = 1;
