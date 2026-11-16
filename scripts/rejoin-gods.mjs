// His call 17 Nov: seat the AI gods whose council seat never went through. On 14-16 Nov the world's vote to add
// Akka (Tate's Reach), Zao Jun (Numdial) and Ahti (Salamanco creek) to their DAO's gods failed for want of storage
// NEAR (LackBalanceForState), so they held a stake but every motion they filed was refused (ERR_PERMISSION_DENIED).
// After scripts/fund-pipeline.mjs topped the DAOs up, each god calls the world's join_dao (0.01 NEAR bond), which
// files the add again and votes it through. Signed with each god's own key (derived from the operator key, as the
// engine does). Checks the god is a god there and not already on the council first. Dry run unless --send.
//   node scripts/rejoin-gods.mjs [--send]
import { Account, JsonRpcProvider, KeyPair, baseEncode } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519.js";
import fs from "node:fs";
import { godSeed } from "../engine/aigods.mjs";

const SEND = process.argv.includes("--send"), OP = "adfontes-mw1fjpfx.testnet";
const STUCK = [["akka", 14], ["zao-jun", 6], ["ahti", 2]];
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const W = await (await fetch("https://adfontes.fun/api/world?net=testnet")).json();
const opKey = JSON.parse(fs.readFileSync(`.keys/${OP}.json`, "utf8")).private_key;
const keyOf = (account) => { const seed = godSeed(opKey, W.world, account); return KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(ed25519.getPublicKey(seed))]))}`); };

for (const [name, clanId] of STUCK) {
  const god = `${name}.${OP}`;
  const clan = await provider.callFunction({ contractId: W.world, method: "get_clan", args: { clan_id: clanId } });
  const policy = await provider.callFunction({ contractId: clan.dao, method: "get_policy", args: {} });
  const council = policy.roles.find((r) => r.name === "gods")?.kind?.Group || [];
  const kp = keyOf(god);
  const keys = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: god })).keys.map((k) => k.public_key);
  const status = !clan.gods.some((g) => g.account === god) ? "not a god there" : council.includes(god) ? "already on the council" : !keys.includes(kp.getPublicKey().toString()) ? "derived key doesn't match" : "to seat";
  console.log(`${clan.name} (${clanId}): ${god}: ${status}`);
  if (status !== "to seat" || !SEND) continue;
  const acct = new Account(god, provider, kp.toString());
  const r = await acct.callFunctionRaw({ contractId: W.world, methodName: "join_dao", args: { clan_id: clanId }, deposit: 10n ** 22n, gas: 200n * 10n ** 12n });
  const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure);
  console.log(fail ? `  FAILED: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}` : `  sent ${r.transaction.hash}`);
  await new Promise((res) => setTimeout(res, 4000));
  const after = (await provider.callFunction({ contractId: clan.dao, method: "get_policy", args: {} })).roles.find((x) => x.name === "gods")?.kind?.Group || [];
  console.log(`  on the council now: ${after.includes(god)}`);
}
