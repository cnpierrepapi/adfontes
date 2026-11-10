// The world as NEAR held it at the end of each real turn (read-only): the block where the turn's root was
// sealed (set_root), then get_totals and list_clans at that block from an archival node. The season film
// shows these numbers for the real turns, so each one can be checked against NEAR by anyone.
//   node scripts/season-chain.mjs <from> <to>     writes debug/season-cache/chain-turn-<d>.json
import fs from "node:fs";

const WORLD = "w6.adf-pool1-hf0w8.testnet", OPERATOR = "adfontes-mw1fjpfx.testnet", SITE = "https://adfontes.fun";
const ARCHIVE = "https://archival-rpc.testnet.fastnear.com", CACHE = "debug/season-cache";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  for (let t = 0; t < 10; t++) {
    const j = await (await fetch(ARCHIVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json().catch(() => ({}));
    await sleep(1200);
    if (j.result) return j.result;
    if (j.error && !/rate|429|timeout/i.test(JSON.stringify(j.error))) throw new Error(JSON.stringify(j.error).slice(0, 200));
    await sleep(5000 * (t + 1));
  }
  throw new Error(`archival node kept refusing ${method}`);
}
const view = async (method, args, block_id) => JSON.parse(Buffer.from((await rpc("query", { request_type: "call_function", account_id: WORLD, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), block_id })).result).toString());
const near = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6, florins = (y) => Number(BigInt(y) / 10n ** 16n) / 1e6;

const AT = process.argv[2] === "--at" ? Number(process.argv[3]) : null;
const [from, to] = AT ? [Number(process.argv[4]), Number(process.argv[4])] : process.argv.slice(2).map(Number);
// The last block at or before a moment: binary search on block heights (about 1 block a second).
async function blockAt(ms) {
  const top = await rpc("block", { finality: "final" });
  let hi = top.header.height, lo = hi - Math.ceil((Date.now() - ms) / 1000) * 2 - 100;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const b = await rpc("block", { block_id: mid }).catch(() => null); if (!b) { lo = mid; continue; } if (Number(b.header.timestamp) / 1e6 <= ms) lo = mid; else hi = mid; }
  return (await rpc("block", { block_id: lo })).header.hash;
}
fs.mkdirSync(CACHE, { recursive: true });
for (let d = from; d <= to; d++) {
  const f = `${CACHE}/chain-turn-${d}.json`;
  if (fs.existsSync(f)) continue;
  const day = await (await fetch(`${SITE}/api/day?d=${d}&net=testnet`)).json();
  let block;
  if (AT) block = await blockAt(AT); // the moment the simulation was seeded
  else {
    if (!day.tx) { console.log(`turn ${d}: no root transaction on record, skipped`); continue; }
    const tx = await rpc("tx", { tx_hash: day.tx, sender_account_id: OPERATOR, wait_until: "FINAL" });
    block = tx.receipts_outcome.at(-1).block_hash; // the block where set_root ran: the turn is done
  }
  const root = AT ? null : await view("get_root", { day: d }, block);
  const totals = await view("get_totals", {}, block);
  const clans = await view("list_clans", { limit: 100 }, block);
  const out = {
    day: d, block, ...(AT ? { at: new Date(AT).toISOString(), note: "the moment the simulation was seeded" } : { root_tx: day.tx, root_matches: root === day.root }),
    totals: { balance: near(totals.balance), owed: near(totals.liabilities), backing: near(totals.backing), florins: florins(totals.florins), florin_value: near(totals.florin_value), minted: florins(totals.minted), burned: florins(totals.burned), jackpot: near(totals.jackpot) },
    clans: Object.fromEntries(clans.map((c) => [c.id, { name: c.name, alive: c.alive, gods: c.gods.length, florins: florins(c.florins), total_in: near(c.total_in) }])),
  };
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(`turn ${d}: block ${block.slice(0, 8)}, ${AT ? `state at ${out.at}` : `root ${out.root_matches ? "matches" : "DIFFERS"}`}, ${clans.length} nations, jackpot ${out.totals.jackpot}`);
}

// The simulation's starting point: `node scripts/season-chain.mjs --at <ms> <day>` writes the world as
// NEAR held it at the last block at or before that moment (the sim was seeded from that state).
