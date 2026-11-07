// Wipe day (SPEC §14): a fresh testnet world on the v2 contract, as a sub-account of the sponsor
// pool. Usage (from adfontes/): node contracts/world/scripts/testnet-world.mjs <prefix> <operator>
// The new account's key goes to .keys/ (never printed). Owner = the world account itself.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import fs from "node:fs";

const POOL = "adf-pool1-hf0w8.testnet";
const [PREFIX, OPERATOR] = process.argv.slice(2);
if (!PREFIX || !OPERATOR) throw new Error("usage: testnet-world.mjs <prefix> <operator>");
const ID = `${PREFIX}.${POOL}`;
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const N = (x) => (BigInt(Math.round(x * 1000)) * 10n ** 21n).toString();
const acct = (id) => new Account(id, provider, JSON.parse(fs.readFileSync(`.keys/${id}.json`, "utf8")).private_key);

if (!fs.existsSync(`.keys/${ID}.json`)) {
  const kp = KeyPair.fromRandom("ed25519");
  fs.writeFileSync(`.keys/${ID}.json`, JSON.stringify({ account_id: ID, private_key: kp.toString() }));
  await acct(POOL).createSubAccount({ accountOrPrefix: PREFIX, publicKey: kp.getPublicKey().toString(), nearToTransfer: BigInt(N(6)) });
  console.log("made", ID, "with 6 NEAR");
  await new Promise((r) => setTimeout(r, 3000));
}
let cfg = null;
try { cfg = await provider.callFunction({ contractId: ID, method: "get_config", args: {} }); } catch {}
if (!cfg) {
  const w = acct(ID);
  await w.deployContract(fs.readFileSync("contracts/world/target/near/world.wasm"));
  await w.callFunction({
    contractId: ID, methodName: "new", gas: "100000000000000",
    args: { owner: ID, operator: OPERATOR, dao_factory: "sputnikv2.testnet", dao_deposit: N(5.5), staking_deposit: N(0.1), min_found: N(6), season_end_ns: String(Date.parse("2026-11-30T23:00:00Z") * 1e6) },
  });
  await new Promise((r) => setTimeout(r, 3000));
  cfg = await provider.callFunction({ contractId: ID, method: "get_config", args: {} });
}
const t = await provider.callFunction({ contractId: ID, method: "get_totals", args: {} });
console.log("world", ID, "\nconfig", JSON.stringify(cfg), "\ntotals", JSON.stringify(t));
