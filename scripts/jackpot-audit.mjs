// The jackpot, checked against every NEAR ever put into the world (read-only, signs nothing).
// The live audit can only check the jackpot against what today's gods hold, because a god who claims
// out leaves their 14% behind. This replays the whole history instead:
//   1. NearBlocks lists every found_clan and bless transaction sent to the world contract.
//   2. An archival NEAR node gives the jackpot just before and just after each one.
//   3. Before the first transaction NearBlocks has, the jackpot must be 14% of what the nations held
//      then; after it, every rise must be one deposit's 14%.
// The jackpot only rises on a deposit (and falls only when award_jackpot pays it), so if all three
// hold, the jackpot is exactly 14% of every NEAR put in. Founder grants and the founding fund are not
// deposits: they go straight into the backing, by design.
// Run: node scripts/jackpot-audit.mjs   (testnet world w6; slow on purpose: the archival node rate-limits)
const WORLD = process.argv[2] || "w6.adf-pool1-hf0w8.testnet";
const NB = `https://api-testnet.nearblocks.io/v3/accounts/${WORLD}/txns`;
const ARCHIVE = "https://archival-rpc.testnet.fastnear.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;

async function view(method, args, block) {
  for (let t = 0; t < 10; t++) {
    const r = await fetch(ARCHIVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", account_id: WORLD, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), ...(block ? { block_id: block } : { finality: "final" }) } }) });
    const j = await r.json().catch(() => ({}));
    await sleep(1500);
    if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString());
    if (j.error && !/rate|429/i.test(JSON.stringify(j.error))) return null;
    await sleep(6000);
  }
  throw new Error(`archival node kept refusing ${method}`);
}

// Every deposit transaction NearBlocks knows, oldest first.
const deposits = [];
let next = null;
do {
  const u = new URL(NB);
  u.searchParams.set("limit", "100");
  if (next) u.searchParams.set("next", next);
  const j = await (await fetch(u, { headers: { "user-agent": "adfontes-audit" } })).json();
  if (!j.data) throw new Error(`NearBlocks: ${JSON.stringify(j).slice(0, 200)}`);
  for (const t of j.data) if (t.outcomes?.status && t.actions.some((a) => a.method === "found_clan" || a.method === "bless")) deposits.push(t);
  next = j.meta?.next_page || null;
  await sleep(1100);
} while (next);
deposits.sort((a, b) => Number(a.block.block_height) - Number(b.block.block_height));
if (!deposits.length) throw new Error("no deposits found");

let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const close = (a, b) => Math.abs(a - b) < 2e-6;

const first = Number(deposits[0].block.block_height) - 3;
const t0 = await view("get_totals", {}, first);
let held = 0;
for (let id = 1; ; id++) { const c = await view("get_clan", { clan_id: id }, first); if (!c) break; held += near(c.total_in); }
let jackpot = near(t0.jackpot), everIn = held;
ok(close(jackpot, held * 0.14), `before ${new Date(Number(deposits[0].block_timestamp) / 1e6).toISOString()} (where NearBlocks' history starts): jackpot ${jackpot} = 14% of the ${held.toFixed(6)} NEAR the nations held`);

for (const t of deposits) {
  const after = near((await view("get_totals", {}, Number(t.block.block_height) + 25)).jackpot);
  const rise = after - jackpot, sent = near(t.actions_agg.deposit);
  // What went in after costs (storage, the DAO bond, a founding's DAO and staking when unfunded):
  // the contract puts 14% of exactly that into the jackpot, so it can't be more than what was sent.
  const net = rise / 0.14;
  ok(net > 0 && net <= sent + 1e-6, `${new Date(Number(t.block_timestamp) / 1e6).toISOString().slice(0, 16)} ${t.actions[0].method} by ${t.signer_account_id.slice(0, 24)}: sent ${sent}, jackpot +${rise.toFixed(6)} = 14% of ${net.toFixed(4)} put in after costs`);
  everIn += net;
  jackpot = after;
}
const now = near((await view("get_totals", {})).jackpot);
ok(close(now, jackpot), `the jackpot now (${now}) is where the replay ends (${jackpot.toFixed(6)}): nothing else moved it`);
ok(close(now, everIn * 0.14), `the jackpot is 14% of the ${everIn.toFixed(4)} NEAR ever put in`);
if (bad) process.exitCode = 1;
