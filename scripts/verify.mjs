// One command for judges: checks what AD FONTES claims against NEAR itself. Read-only, signs nothing,
// needs no keys and no npm install (Node 18+ only).
//   node scripts/verify.mjs            (the live testnet world, through adfontes.fun)
//   node scripts/verify.mjs <site>     (another copy of the site)
// Every number below comes from a view call on NEAR testnet. The site is only used to find out which
// records to hash and which accounts to ask about; anything it says is checked against the chain.
import crypto from "node:crypto";

const SITE = process.argv[2] || "https://adfontes.fun";
const RPC = "https://rpc.testnet.fastnear.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, what, why = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${what}${why ? `\n      ${why}` : ""}`); };

async function rpc(params) {
  for (let t = 0; t < 6; t++) {
    const j = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) }).then((r) => r.json()).catch(() => ({}));
    if (j.result) return j.result;
    if (j.error && !/429|rate|timeout/i.test(JSON.stringify(j.error))) throw new Error(JSON.stringify(j.error).slice(0, 160));
    await sleep(1500 * (t + 1));
  }
  throw new Error("NEAR's RPC kept refusing");
}
const view = async (account_id, method_name, args = {}) => JSON.parse(Buffer.from((await rpc({ request_type: "call_function", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());
const site = (p) => fetch(`${SITE}/api/${p}${p.includes("?") ? "&" : "?"}net=testnet`).then((r) => r.json());
const near = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const merkle = (leaves) => { let l = leaves.slice(); if (!l.length) return sha("empty"); while (l.length > 1) { const n = []; for (let i = 0; i < l.length; i += 2) n.push(sha(l[i] + (l[i + 1] ?? l[i]))); l = n; } return l[0]; };

const W = await site("world");
const WORLD = W.world;
console.log(`AD FONTES, ${W.season}, turn ${W.day}. World contract: ${WORLD} (NEAR testnet)\n`);

// 1. The money: the contract holds more NEAR than it owes.
console.log("# 1. Is the world solvent?");
const T = await view(WORLD, "get_totals");
const bal = near(T.balance), owed = near(T.liabilities), store = near(T.storage_locked);
ok(bal >= owed + store, `the contract holds ${bal.toFixed(4)} NEAR and owes ${owed.toFixed(4)} (gods' backing ${near(T.backing).toFixed(4)}, jackpot ${near(T.jackpot).toFixed(4)}, the rest set aside) plus ${store.toFixed(4)} locked for storage`,
  `margin ${(bal - owed - store).toFixed(4)} NEAR. get_totals on ${WORLD}`);
const fv = near(T.florin_value), calc = near(T.backing) / (Number(BigInt(T.florins) / 10n ** 16n) / 1e6);
ok(Math.abs(fv - calc) < 1e-5, `1 florin is worth ${fv.toFixed(6)} NEAR = backing / florins (${calc.toFixed(6)}), so every florin can be paid out`);

// 2. The records: rebuild each of the last three sealed turns' Merkle roots from every record and
// compare with the root the contract holds.
console.log("\n# 2. Is every record what was sealed on NEAR?");
let checked = 0;
for (let d = W.day; d >= 1 && checked < 3; d--) {
  const day = await site(`day?d=${d}`);
  if (!day.root || !day.records?.length) continue;
  const onchain = await view(WORLD, "get_root", { day: d });
  const mine = merkle(day.records.map(({ i, ...r }) => sha(canon(r)))); // i is the site's numbering, not part of the record
  ok(mine === onchain, `turn ${d}: ${day.records.length} records hashed here give root ${mine.slice(0, 16)}…, NEAR holds ${String(onchain).slice(0, 16)}…`, day.tx ? `sealed in tx ${day.tx}` : "");
  checked++;
}
if (!checked) ok(false, "no sealed turn found");

// 3. The agents: a nation's Broker and Patron sign from their own accounts, with one key each that
// can only call the world contract and can't send NEAR.
console.log("\n# 3. Do the agents hold their own wallets, with keys that can't move NEAR?");
const live = W.clans.filter((c) => c.alive && c.wallets?.broker);
const sample = live[Math.floor(Math.random() * live.length)];
for (const role of ["broker", "patron"]) {
  const acct = sample.wallets[role];
  const keys = (await rpc({ request_type: "view_access_key_list", account_id: acct })).keys;
  const fc = keys.every((k) => k.access_key.permission?.FunctionCall?.receiver_id === WORLD);
  ok(keys.length >= 1 && fc, `${sample.name}'s ${role === "broker" ? "Broker" : "Patron"} ${acct}: ${keys.length} key(s), every one a function-call key for ${WORLD} only`,
    keys.map((k) => { const p = k.access_key.permission; return p === "FullAccess" ? "FULL ACCESS" : `${p.FunctionCall.receiver_id}: ${(p.FunctionCall.method_names || []).join(", ") || "any method"}, allowance ${p.FunctionCall.allowance ? near(p.FunctionCall.allowance) + " NEAR of gas" : "none"}`; }).join("\n      "));
}

// Tamper test: change one letter of one record and the root no longer matches.
{
  const day = await site(`day?d=${W.day - 1}`);
  if (day.root && day.records?.length) {
    const recs = day.records.map(({ i, ...r }) => r);
    recs[0] = { ...recs[0], kind: recs[0].kind + "x" };
    ok(merkle(recs.map((r) => sha(canon(r)))) !== day.root, `change one letter in turn ${W.day - 1}'s first record and the root no longer matches NEAR's (so the check above can fail)`);
  }
}

// 4. The research: tokens on NEP-245, held by the Broker.
console.log("\n# 4. Is the research a token on NEAR?");
const tk = live.find((c) => c.tokens?.sample) ?? sample;
if (tk.tokens?.sample) {
  const [info, b] = await Promise.all([view(WORLD, "mt_token_info", { token_id: tk.tokens.sample }), view(WORLD, "mt_balance_of", { account_id: tk.tokens.holder, token_id: tk.tokens.sample })]);
  ok(BigInt(b) > 0n, `${tk.name}'s Broker ${tk.tokens.holder} holds ${b} of "${tk.tokens.sample}" (${info.kind}: "${String(info.title).slice(0, 60)}")`, "mt_token_info and mt_balance_of, NEP-245");
} else ok(false, "no token to check");

// 5. The nations: each one's treasury is a Sputnik DAO on NEAR, and its gods sit on its council.
console.log("\n# 5. Is every nation's treasury a real DAO?");
let daos = 0;
for (const c of live) {
  const p = await view(c.dao, "get_policy").catch(() => null);
  if (p?.roles) daos++;
  else ok(false, `${c.name}: ${c.dao} didn't answer get_policy`);
}
ok(daos === live.length, `${daos} of ${live.length} living nations have a Sputnik DAO that answers get_policy`);

console.log(`\n${pass} passed, ${fail} failed. Nothing was signed or sent.`);
if (fail) process.exitCode = 1;
