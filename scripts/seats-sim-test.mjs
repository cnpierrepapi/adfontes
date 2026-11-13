// Seat trading through the engine's turns, on a copy of the live world (never testnet), stand-in minds ($0):
// an AI god's seat is listed by a scheduled turn; a sale the loop settled is sealed by the next instant turn, once:
// the buyer takes the AI god's reverence, its name and its place in the season rankings; the AI god is let go.
// (The chain side, move_god and the payments, is scripts/seats-chain-test.mjs on the real test world v2d.)
//    node scripts/seats-sim-test.mjs [dir=debug/sim-seats]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "debug/sim-seats", H = 3600e3;
fs.rmSync(DIR, { recursive: true, force: true });
const seed = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
if (seed.status !== 0) { console.log(seed.stdout, seed.stderr); process.exit(1); }
const env = { ...process.env, ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, ADF_DAILY_CAP: "50", DATABASE_URL: "", ADF_FAKE_LLM: "1", ADF_MARKET: "1", ADF_PAPERS_OFFLINE: "1" };
Object.assign(process.env, env);
const { seededAt } = JSON.parse(fs.readFileSync(`${DIR}/seed.json`, "utf8"));
let bad = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
const run = (args, k) => { const r = spawnSync(process.execPath, ["engine/run.mjs", "testnet", ...args], { env: { ...env, ADF_NOW: String(seededAt + k * 2 * H) }, encoding: "utf8", maxBuffer: 64e6 }); if (r.status !== 0) { console.log(r.stdout.slice(-1500), r.stderr.slice(-1500)); process.exit(1); } return r.stdout; };
const STF = `${DIR}/state/testnet.json`, CHF = `${DIR}/chain.json`;
const ST = () => JSON.parse(fs.readFileSync(STF, "utf8"));
const save = (s) => fs.writeFileSync(STF, JSON.stringify(s));

run(["--force"], 1);
const store = await import("../engine/store.mjs");
const RV = await import("../engine/reverence.mjs");
const S = await import("../engine/seats.mjs");
let C = JSON.parse(fs.readFileSync(CHF, "utf8"));
let s = ST();
// A living nation with one god: make that god an AI god called Saturn, followed at 55.
const nation = C.clans.find((c) => c.alive && c.gods.length === 1 && s.clans[c.id] && !s.clans[c.id].fallen && s.rev?.[c.id]);
if (!nation) { console.log("FAIL no one-god nation on this copy"); process.exit(1); }
const id = nation.id, AI = nation.gods[0].account, BUYER = "newcomer.sim";
for (const g of await store.aiGods("testnet")) await store.removeAiGod("testnet", g.account); // only Saturn is AI here
await store.addAiGod("testnet", AI, "Saturn", "INTJ");
await store.claimGodName(AI, "Saturn");
s.rev[id].gods[AI].r = 55; s.rev[id].followed = AI;
save(s);
const aiNow = async () => new Set((await store.aiGods("testnet")).map((g) => g.account));
ok(!RV.standings(s, C.clans, await aiNow()).some((r) => r.id === id), `nation ${id} (${nation.name}) is AI-led: out of the rankings`);

// A scheduled turn lists the AI seat.
run(["--force"], 2);
const open = (await store.seatsOpen("testnet")).filter((l) => l.clan === id);
ok(open.length === 1 && open[0].seller === AI && S.nearOf(open[0].price) >= S.AI_SEAT.min, `the turn listed Saturn's seat (${open[0] ? S.nearOf(open[0].price) : "-"} grace)`);
run(["--force"], 3);
ok((await store.seatsOpen("testnet")).filter((l) => l.clan === id).length === 1, "the next turn doesn't list it twice");

// The loop settled a sale (the chain side): the seat is the buyer's on chain, the buy is filled.
C = JSON.parse(fs.readFileSync(CHF, "utf8"));
C.clans.find((c) => c.id === id).gods[0].account = BUYER;
fs.writeFileSync(CHF, JSON.stringify(C));
const L = open[0], TX = "SIMTX1";
await store.seatBuy("testnet", { tx: TX, listing: L.id, buyer: BUYER, amount: L.price });
await store.seatBuyClaim("testnet", TX);
await store.seatSetStatus("testnet", L.id, "sold", BUYER);
await store.seatBuyFinish("testnet", TX, "filled", { move: "MOVE", pay: "PAY", seller: AI, clan: id });

const before = (ST().pending || []).length, r0 = ST().rev[id].gods[AI].r; // reverence drifts each scheduled turn
run(["--instant", String(id), "--no-research", String(id)], 3.2);
s = ST();
const recs = (s.pending || []).slice(before), sold = recs.filter((r) => r.kind === "seat-sold");
ok(sold.length === 1 && sold[0].clan === id && sold[0].buyer === BUYER && sold[0].seller === AI && sold[0].as === "Saturn", `one seat-sold record, the buyer as Saturn (${JSON.stringify(sold[0])?.slice(0, 160)})`);
ok(s.rev[id].gods[BUYER]?.r === r0 && !s.rev[id].gods[AI] && s.rev[id].followed === BUYER, `the buyer holds Saturn's reverence (${r0}) and the nation follows them`);
ok((await store.godNames([BUYER]))[BUYER] === "Saturn", "the buyer is named Saturn");
ok(!(await aiNow()).has(AI), "Saturn's AI is let go");
const rank = RV.standings(s, C.clans, await aiNow());
ok(rank.some((r) => r.id === id && r.standing === r0), `the nation now ranks, on ${r0} (${rank.map((r) => `${r.id}:${r.standing}`).join(" ")})`);
ok(!(await store.seatBuysUnsealed("testnet")).length, "the sale is marked sealed");
ok(!recs.some((r) => r.kind === "error"), `no errors (${recs.filter((r) => r.kind === "error").map((r) => r.error).join(" | ")})`);
const b2 = (ST().pending || []).length;
run(["--instant", String(id), "--no-research", String(id)], 3.4);
ok(!(ST().pending || []).slice(b2).some((r) => r.kind === "seat-sold"), "sealed once: the next turn writes no second record");
run(["--force"], 4);
ok(!(await store.seatsOpen("testnet")).some((l) => l.clan === id), "a human-led nation's seat isn't listed by the engine");
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
