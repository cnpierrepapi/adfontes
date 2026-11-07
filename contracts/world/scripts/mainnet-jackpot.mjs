// Mainnet jackpot (SPEC §12m D, his go 7 Nov): create jackpot.adfontes.near (it holds nothing but
// the season's fees) and point the world's treasury at it, so every fee sweep fills the jackpot.
// The jackpot gets the treasury's existing public key, so no new secret is made or stored.
// Usage (from adfontes/): node contracts/world/scripts/mainnet-jackpot.mjs [--dry]
// Keys are read from Documents/env.txt and never printed.
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DRY = process.argv.includes("--dry");
const WORLD = "world.adfontes.near", OWNER = "adfontes.near", JACKPOT = "jackpot.adfontes.near";
const env = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), "Documents", "env.txt"), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" });
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const keysOf = async (a) => (await provider.query({ request_type: "view_access_key_list", finality: "optimistic", account_id: a })).keys.map((k) => k.public_key); // optimistic: a just-made account shows at once
const exists = (a) => provider.query({ request_type: "view_account", finality: "final", account_id: a }).then(() => true, () => false);

if (env.ADFONTES_DEPLOYER_NAMED_ACCOUNT !== OWNER) throw new Error("env.txt: the deployer's named account isn't adfontes.near");
const ownerKeyOk = (await keysOf(OWNER)).includes(env.ADFONTES_DEPLOYER_PUBLIC_KEY);
const treasuryKey = env.ADFONTES_TREASURY_PUBLIC_KEY;
const cfg = await view(WORLD, "get_config");
console.log(`owner key on ${OWNER}: ${ownerKeyOk} | world owner is ${cfg.owner} | treasury now ${cfg.treasury} | ${JACKPOT} exists: ${await exists(JACKPOT)}`);
if (!ownerKeyOk || cfg.owner !== OWNER) throw new Error("the owner key doesn't match; stopping");
if (!treasuryKey?.startsWith("ed25519:")) throw new Error("no treasury public key in env.txt");
if (DRY) { console.log("dry run: would create", JACKPOT, "(0.01 NEAR, the treasury's key) and set the world's treasury to it"); process.exit(0); }

const owner = new Account(OWNER, provider, env.ADFONTES_DEPLOYER_PRIVATE_KEY);
if (!(await exists(JACKPOT))) {
  await owner.createAccount({ newAccountId: JACKPOT, publicKey: treasuryKey, nearToTransfer: 10n ** 22n }); // 0.01 NEAR: its storage reserve
  console.log("created", JACKPOT);
}
const jk = await keysOf(JACKPOT);
if (!jk.includes(treasuryKey)) throw new Error("the jackpot doesn't carry the treasury key; stopping before set_config");
const r = await owner.callFunctionRaw({ contractId: WORLD, methodName: "set_config", args: { treasury: JACKPOT }, gas: 30n * 10n ** 12n });
const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
if (fail) throw new Error("set_config failed: " + JSON.stringify(fail.outcome.status.Failure).slice(0, 200));
const after = await view(WORLD, "get_config");
console.log(`treasury is now ${after.treasury} (tx ${r.transaction.hash})`);
