// Testnet run of the world contract against the REAL Sputnik factory (sputnikv2.testnet).
// Usage (from adfontes/): node contracts/world/scripts/testnet.mjs <world> <god1> <god2> <operator>
// 1. deploy + init  2. god1 founds a clan  3. god2 blesses it  4. a founding the factory
// refuses must refund in full  5. god2 withdraws its share  6. solvency check.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";

const [WORLD, GOD1, GOD2, OPERATOR] = process.argv.slice(2);
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const acct = (id) => {
  const k = JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8"));
  return new Account(k.account_id, provider, k.private_key);
};
const N = (x) => (BigInt(Math.round(x * 1000)) * 10n ** 21n).toString();
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const view = (method, args = {}) => provider.callFunction({ contractId: WORLD, method, args });
const bal = async (id) => (await provider.query({ request_type: "view_account", finality: "final", account_id: id })).amount;
const failures = (r) => r.receipts_outcome.filter((o) => o.outcome.status.Failure).map((o) => JSON.stringify(o.outcome.status.Failure).slice(0, 200));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const world = acct(WORLD), g1 = acct(GOD1), g2 = acct(GOD2);

// 1. deploy + init
const code = fs.readFileSync("contracts/world/target/near/world.wasm");
let cfg = null;
try { cfg = await view("get_config"); } catch {}
if (!cfg) {
  await world.deployContract(code);
  await world.callFunction({
    contractId: WORLD, methodName: "new", gas: "100000000000000",
    args: {
      owner: WORLD, operator: OPERATOR, treasury: GOD2, dao_factory: "sputnikv2.testnet",
      dao_deposit: N(5.5), staking_deposit: N(1.2), min_found: N(7),
    },
  });
  cfg = await view("get_config");
}
console.log("1. deployed, config:", JSON.stringify(cfg));

// 2. found a clan through the real factory
const g1Before = BigInt(await bal(GOD1));
const r = await g1.callFunctionRaw({ contractId: WORLD, methodName: "found_clan", args: { name: "Testnet Tide" }, deposit: N(8), gas: "300000000000000" });
console.log("2. found_clan failures:", failures(r), "logs:", r.receipts_outcome.flatMap((o) => o.outcome.logs));
const clans = await view("list_clans", {});
const clan = clans[clans.length - 1];
console.log("   clan:", clan && { id: clan.id, dao: clan.dao, play: fmt(clan.play), reserve: fmt(clan.reserve), staking: fmt(clan.staking_fund), gods: clan.gods.length });
const pol = await provider.callFunction({ contractId: clan.dao, method: "get_policy", args: {} });
console.log("   DAO roles:", JSON.stringify(pol.roles.map((x) => [x.name, x.kind])), "bond:", fmt(pol.proposal_bond));
console.log("   god1 spent:", fmt(g1Before - BigInt(await bal(GOD1))));

// 3. god2 blesses
await g2.callFunction({ contractId: WORLD, methodName: "bless", args: { clan_id: clan.id }, deposit: N(1), gas: "30000000000000" });
const c3 = await view("get_clan", { clan_id: clan.id });
console.log("3. after bless:", { gods: c3.gods.map((g) => [g.account, fmt(g.put_in)]), play: fmt(c3.play), reserve: fmt(c3.reserve) });

// 4. refused founding must refund in full: drop the DAO deposit below what the factory needs
await world.callFunction({ contractId: WORLD, methodName: "set_config", args: { dao_deposit: N(0.1), min_found: N(1.5) }, gas: "30000000000000" });
const g2Before = BigInt(await bal(GOD2));
const r4 = await g2.callFunctionRaw({ contractId: WORLD, methodName: "found_clan", args: { name: "Doomed" }, deposit: N(2), gas: "300000000000000" });
await sleep(4000);
const lost = g2Before - BigInt(await bal(GOD2));
console.log("4. refused founding: logs", r4.receipts_outcome.flatMap((o) => o.outcome.logs), "god2 net cost:", fmt(lost), "(gas only if < 0.01)");
await world.callFunction({ contractId: WORLD, methodName: "set_config", args: { dao_deposit: N(5.5), min_found: N(7) }, gas: "30000000000000" });

// 5. god2 withdraws its share; clan lives on with god1
const g2b = BigInt(await bal(GOD2));
await g2.callFunction({ contractId: WORLD, methodName: "withdraw", args: { clan_id: clan.id }, gas: "60000000000000" });
await sleep(3000);
const c5 = await view("get_clan", { clan_id: clan.id });
console.log("5. god2 got back:", fmt(BigInt(await bal(GOD2)) - g2b), "| clan alive:", c5.alive, "gods:", c5.gods.length);

// 6. solvency: balance must cover liabilities + locked storage
const t = await view("get_totals");
const free = BigInt(t.balance) - BigInt(t.liabilities) - BigInt(t.storage_locked);
console.log("6. totals:", { balance: fmt(t.balance), liabilities: fmt(t.liabilities), storage: fmt(t.storage_locked), free: fmt(free) }, free >= 0n ? "SOLVENT" : "INSOLVENT");
