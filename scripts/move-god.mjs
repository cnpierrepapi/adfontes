// His call 9 Nov: hand a lost god's place to an account he controls (move_god, owner only). Checks
// the stake, the grant and the DAO seat after. Dry run unless --go. Prints no key.
//   node scripts/move-god.mjs --world w6.adf-pool1-hf0w8.testnet --clan 6 --from <acct> --to <acct> [--deploy] [--go]
import fs from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const WORLD = opt("--world"), CLAN = Number(opt("--clan")), FROM = opt("--from"), TO = opt("--to"), GO = argv.includes("--go");
if (!WORLD || !CLAN || !FROM || !TO) { console.log("need --world --clan --from --to"); process.exit(1); }
const provider = new JsonRpcProvider({ url: "https://near-testnet.drpc.org" });
const owner = (() => { const k = JSON.parse(fs.readFileSync(`.keys/${WORLD}.json`, "utf8")); return new Account(k.account_id, provider, k.private_key); })();
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const N = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) { fails++; process.exitCode = 1; } };

if (argv.includes("--deploy") && GO) {
  await owner.deployContract(fs.readFileSync("contracts/world/target/near/world.wasm"));
  await wait(4000);
  console.log("deployed contracts/world/target/near/world.wasm to", WORLD);
}
const clan = await view(WORLD, "get_clan", { clan_id: CLAN });
const gods = async (dao) => (await view(dao, "get_policy")).roles.find((r) => r.name === "gods")?.kind?.Group ?? [];
const before = { from: await view(WORLD, "get_stake", { clan_id: CLAN, account: FROM }), to: await view(WORLD, "get_stake", { clan_id: CLAN, account: TO }), seats: await gods(clan.dao), founder: clan.gods[0].account };
console.log(`${clan.name} (${clan.alive ? "alive" : "fallen"}), DAO ${clan.dao}`);
console.log(`from ${FROM.slice(0, 12)}: ${N(before.from.near)} NEAR, put_in ${N(before.from.put_in)}, granted ${N(before.from.granted)}, DAO seat ${before.seats.includes(FROM)}`);
console.log(`to   ${TO.slice(0, 24)}: ${N(before.to.near)} NEAR, DAO seat ${before.seats.includes(TO)}`);
if (!clan.gods.some((g) => g.account === FROM)) { console.log("FROM is not a god of that nation"); process.exit(1); }
if (!GO) { console.log("dry run: add --go to move"); process.exit(0); }

const r = await owner.callFunctionRaw({ contractId: WORLD, methodName: "move_god", args: { clan_id: CLAN, from: FROM, to: TO }, deposit: 2n * 10n ** 22n, gas: 300n * 10n ** 12n }).catch((e) => ({ err: e }));
if (r.err) console.log("RPC error (may still have landed):", String(r.err.message).slice(0, 160));
else { const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); ok(!f, `move_god tx ${r.transaction.hash}${f ? " " + JSON.stringify(f.outcome.status.Failure).slice(0, 200) : ""}`); }
await wait(6000);
const after = { from: await view(WORLD, "get_stake", { clan_id: CLAN, account: FROM }), to: await view(WORLD, "get_stake", { clan_id: CLAN, account: TO }), seats: await gods(clan.dao), clan: await view(WORLD, "get_clan", { clan_id: CLAN }) };
ok(BigInt(after.from.florins) === 0n && BigInt(after.from.granted) === 0n, "the old account holds nothing in this nation");
ok(BigInt(after.to.florins) === BigInt(before.from.florins) + BigInt(before.to.florins), `the new account holds the stake (${N(after.to.near)} NEAR)`);
ok(BigInt(after.to.granted) === BigInt(before.from.granted) + BigInt(before.to.granted), `the grant moved (${N(after.to.granted)})`);
ok(BigInt(after.to.put_in) === BigInt(before.from.put_in) + BigInt(before.to.put_in), "put_in moved");
if (before.founder === FROM) ok(after.clan.gods[0].account === TO, "the new account is the founder");
ok(!after.seats.includes(FROM), "the old account lost its DAO seat");
ok(after.seats.includes(TO), "the new account has a DAO seat");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
