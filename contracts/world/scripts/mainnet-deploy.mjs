// MAINNET deploy of the world contract. Run only after testnet passes and he has said go.
// Usage (from adfontes/): node contracts/world/scripts/mainnet-deploy.mjs [--dry]
// 1. GOD1 (old deployer address) sends the launch cost to adfontes.near
// 2. adfontes.near creates world.adfontes.near (deployer key) and operator.adfontes.near (new key)
// 3. deploy + init the wasm on world.adfontes.near   4. read back config + solvency
// Keys come from Documents/env.txt by exact name and are never printed.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DRY = process.argv.includes("--dry");
const ENV = path.join(os.homedir(), "Documents", "env.txt");
const lines = () => fs.readFileSync(ENV, "utf8").split(/\r?\n/);
const get = (k) => {
  const l = lines().find((x) => x.startsWith(k + "="));
  if (!l) throw new Error("missing " + k);
  return l.slice(k.length + 1).trim();
};
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.near.org" });
const N = (x) => BigInt(Math.round(x * 1000)) * 10n ** 21n;
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const T = (t) => (BigInt(t) * 10n ** 12n).toString();
const exists = async (id) => provider.query({ request_type: "view_account", finality: "final", account_id: id }).then((r) => r, () => null);

const WASM = "contracts/world/target/near/world.wasm";
const code = fs.readFileSync(WASM);
const codeCost = BigInt(code.length) * 10n ** 19n; // 1 byte = 0.00001 NEAR
const WORLD_FUND = codeCost + N(0.15); // code + state + headroom
const OPERATOR_FUND = N(1);
const NEEDED = WORLD_FUND + OPERATOR_FUND + N(0.05); // + account creation + gas

const deployerKey = get("ADFONTES_DEPLOYER_PRIVATE_KEY");
const deployerPub = get("ADFONTES_DEPLOYER_PUBLIC_KEY");
const GOD1 = get("ADFONTES_DEPLOYER_ACCOUNT_ID"); // the old implicit address = GOD1
const deployer = new Account("adfontes.near", provider, deployerKey);
const god1 = new Account(GOD1, provider, deployerKey);

const dep = await exists("adfontes.near");
const have = BigInt(dep.amount) - BigInt(dep.storage_usage) * 10n ** 19n;
const short = NEEDED > have ? NEEDED - have : 0n;
console.log(`wasm ${code.length} bytes -> ${fmt(codeCost)} NEAR locked; world fund ${fmt(WORLD_FUND)}, operator ${fmt(OPERATOR_FUND)}`);
console.log(`needed ${fmt(NEEDED)}, deployer spendable ${fmt(have)}, transfer from GOD1: ${fmt(short)}`);
if (DRY) process.exit(0);

// 1. top up the deployer from GOD1
if (short > 0n) {
  const r = await god1.transfer({ receiverId: "adfontes.near", amount: short + N(0.02) });
  console.log("1. GOD1 -> adfontes.near tx", r.transaction.hash);
}

// 2. accounts
if (!(await exists("world.adfontes.near"))) {
  await deployer.createSubAccount({ accountOrPrefix: "world", publicKey: deployerPub, nearToTransfer: WORLD_FUND });
  console.log("2a. world.adfontes.near created");
}
if (!(await exists("operator.adfontes.near"))) {
  let opPub;
  try {
    opPub = get("ADFONTES_OPERATOR_PUBLIC_KEY");
  } catch {
    const kp = KeyPair.fromRandom("ed25519");
    opPub = kp.getPublicKey().toString();
    fs.appendFileSync(ENV, `\n# AD FONTES operator (signs world ticks, trades, gifts). Mainnet.\nADFONTES_OPERATOR_ACCOUNT_ID=operator.adfontes.near\nADFONTES_OPERATOR_PUBLIC_KEY=${opPub}\nADFONTES_OPERATOR_PRIVATE_KEY=${kp.toString()}\n`);
  }
  await deployer.createSubAccount({ accountOrPrefix: "operator", publicKey: opPub, nearToTransfer: OPERATOR_FUND });
  console.log("2b. operator.adfontes.near created (key saved to env.txt)");
}

// 3. deploy + init
const world = new Account("world.adfontes.near", provider, deployerKey);
let cfg = null;
try { cfg = await provider.callFunction({ contractId: "world.adfontes.near", method: "get_config", args: {} }); } catch {}
if (!cfg) {
  await world.deployContract(code);
  await world.callFunction({
    contractId: "world.adfontes.near", methodName: "new", gas: T(100),
    args: {
      owner: "adfontes.near", operator: "operator.adfontes.near", treasury: "treasury.adfontes.near",
      dao_factory: "sputnik-dao.near", dao_deposit: N(0.1).toString(), staking_deposit: N(1.2).toString(),
      min_found: N(2.3).toString(),
    },
  });
  console.log("3. deployed + initialised");
}

// 4. read back
cfg = await provider.callFunction({ contractId: "world.adfontes.near", method: "get_config", args: {} });
const t = await provider.callFunction({ contractId: "world.adfontes.near", method: "get_totals", args: {} });
console.log("4. config", JSON.stringify(cfg));
console.log("   totals: balance", fmt(t.balance), "liabilities", fmt(t.liabilities), "storage", fmt(t.storage_locked));
for (const a of ["adfontes.near", GOD1, "world.adfontes.near", "operator.adfontes.near"]) {
  const r = await exists(a);
  console.log("  ", a.length > 30 ? a.slice(0, 6) + "..." + a.slice(-4) : a, fmt(r.amount));
}
