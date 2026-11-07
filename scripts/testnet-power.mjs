// A god uses a DAO power on their nation, as the site does it: propose through the nation's DAO,
// read the proposal id add_proposal returned, then vote yes (never vote on a guessed id).
// Usage: node scripts/testnet-power.mjs <world> <god account (key in .keys/)> <method> '<json args>'
//   e.g. ... root_out '{"clan_id":1,"point":"hematite"}'   ... whisper '{"clan_id":1,"text":"go deep"}'
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "node:fs";
const [WORLD, GOD, METHOD, ARGS] = process.argv.slice(2);
const args = JSON.parse(ARGS);
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const k = JSON.parse(fs.readFileSync(`.keys/${GOD}.json`, "utf8"));
const god = new Account(GOD, provider, k.private_key);
const clan = await provider.callFunction({ contractId: WORLD, method: "get_clan", args: { clan_id: Number(args.clan_id) } });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const kind = { FunctionCall: { receiver_id: WORLD, actions: [{ method_name: METHOD, args: b64(args), deposit: "0", gas: "30000000000000" }] } };
const r = await god.callFunctionRaw({ contractId: clan.dao, methodName: "add_proposal", args: { proposal: { description: `${METHOD}: ${ARGS}`, kind } }, deposit: 10n ** 22n, gas: "50000000000000" });
const id = JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString());
await god.callFunctionRaw({ contractId: clan.dao, methodName: "act_proposal", args: { id, action: "VoteApprove", proposal: kind }, gas: "150000000000000" });
await new Promise((res) => setTimeout(res, 3000));
const p = await provider.callFunction({ contractId: clan.dao, method: "get_proposal", args: { id } });
console.log(`${clan.name}: proposal ${id} (${METHOD}) -> ${p.status}`);
