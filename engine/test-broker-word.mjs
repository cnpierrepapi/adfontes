// PLAN_13NOV step 3 (confirmed by him 12 Nov, NO proposals). Written before the code.
// Looking: tap a star in any nation's sky: its title, depth, who knows it, its fair price, a listing if any.
// Whispering to the Broker: on your own nation, ask the Broker to list points (a signed choice, kind "list").
// The Broker listens by your reverence: under REV.ignoredBelow never; else chance = reverence/100 on seeded dice,
// one roll per god, nation and turn. If it listens, the market day lists them (it still sets the price).
// A god-asked listing that sells ABOVE fair: +1 reverence for that god, at most +5 a real day, never past 60.
//    node engine/test-broker-word.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-bw-"));
Object.assign(process.env, { ADF_STATE_DIR: dir, DATABASE_URL: "", ADF_FAKE_LLM: "1" });
const BW = await import("./brokerword.mjs");
const RV = await import("./reverence.mjs");
const CH = await import("./choices.mjs");
const AG = await import("./aigods.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// 1. Listening by reverence.
ok(BW.hears({ r: 29.9, seed: "x" }).listens === false && BW.hears({ r: 29.9, seed: "x" }).ignored === true, "under 30 reverence the Broker ignores the god outright");
ok(BW.hears({ r: 100, seed: "anything" }).listens === true, "at 100 it always listens");
let yes = 0;
for (let i = 0; i < 2000; i++) yes += BW.hears({ r: 60, seed: `s${i}` }).listens ? 1 : 0;
ok(yes > 1100 && yes < 1300, `at 60 it listens about 60% of the time (${yes}/2000)`);
ok(BW.hears({ r: 60, seed: "68|12|list|w6" }).roll === BW.hears({ r: 60, seed: "68|12|list|w6" }).roll, "the same seed gives the same roll (sealed dice, checkable)");
ok(BW.seedOf({ day: 68, clan: 12, god: "a", world: "w6" }) === BW.seedOf({ day: 68, clan: 12, god: "a", world: "w6" }) && !/token|r:/.test(BW.seedOf({ day: 68, clan: 12, god: "a", world: "w6" })), "one roll per god, nation and turn: what's asked doesn't change the dice");

// 2. What gets listed: only what the nation can sell, never twice, at most 3.
const sellable = [{ token_id: "r:c1", price: 10, title: "A" }, { token_id: "r:c2", price: 8, title: "B" }, { token_id: "k:t1", price: 5, title: "Kit" }, { token_id: "p:d9", price: 40, title: "P" }];
const open = [{ token_id: "r:c2", open: true }];
const must = BW.mustList(["r:c1", "r:c2", "r:zz", "k:t1", "p:d9", "r:c1"], sellable, open);
ok(must.map((x) => x.token_id).join() === "r:c1,k:t1,p:d9", `sellable and not already on the shelf, once each, at most 3 (got ${must.map((x) => x.token_id).join()})`);
ok(BW.mustList(["r:zz"], sellable, open).length === 0, "something the nation doesn't hold can't be listed");

// 3. The reward: only above fair, capped a day, never past 60.
ok(BW.aboveFair({ price: 10.5 }, 10) === true && BW.aboveFair({ price: 10 }, 10) === false && BW.aboveFair({ price: 9 }, 10) === false, "only a sale above fair counts");
const rv = { gods: { g: { r: 50, enemies: [], whispers: [] } } }, ch = [];
let got = 0;
for (let i = 0; i < 8; i++) got += RV.brokerReward(rv, "g", 70, ch);
ok(got === BW.WORD.capPerDay && rv.gods.g.r === 55, `+1 a sale, at most +${BW.WORD.capPerDay} a real day (got +${got}, now ${rv.gods.g.r})`);
ok(RV.brokerReward(rv, "g", 70 + RV.REV.blessWindow, ch) === 1, "a new real day: it counts again");
const rv2 = { gods: { g: { r: 59.5, enemies: [], whispers: [] } } };
RV.brokerReward(rv2, "g", 70, []); RV.brokerReward(rv2, "g", 70, []);
ok(rv2.gods.g.r === 60, `never lifts past 60 (got ${rv2.gods.g.r})`);
const rv3 = { gods: { g: { r: 75, enemies: [], whispers: [] } } };
RV.brokerReward(rv3, "g", 70, []);
ok(rv3.gods.g.r === 75, "a god already over 60 isn't pulled down");
ok(/Broker sold what you asked, above fair/.test(src("engine/reverence.mjs")), "the reverence change says why");

// 4. The signed choice.
ok(CH.KINDS.list({ tokens: ["r:c1", "k:t1"] }) === true, "a list names 1-3 tokens");
ok(!CH.KINDS.list({ tokens: [] }) && !CH.KINDS.list({ tokens: ["r:1", "r:2", "r:3", "r:4"] }) && !CH.KINDS.list({ tokens: ["drop"] }) && !CH.KINDS.list(null), "empty, too many or junk is refused");

// 5. The wiring.
const run = src("engine/run.mjs");
ok(/BW\.hears\(/.test(run) && /BW\.mustList\(/.test(run), "the turn rolls the Broker's ear and builds the must-list");
ok(/must/.test(run.slice(run.indexOf("async function marketDay"), run.indexOf("async function marketDay") + 4000)), "marketDay takes the must-list");
ok(/RV\.brokerReward\(/.test(run.slice(run.indexOf("async function settleSale"), run.indexOf("async function settleSale") + 2500)), "a sale of a god-asked listing pays the reward when it's settled");
ok(/god's word/i.test(run), "a listing at the god's word says so (the marketplace shows the reason)");
ok(/kind === "list"/.test(src("engine/loop.mjs")) || /listsSince|asksSince\(W\.net[^)]*\)/.test(src("engine/loop.mjs")), "the loop answers a new list request in seconds");
const llm = src("engine/llm.mjs");
ok(/must/.test(llm.slice(llm.indexOf("export function brokerMarket"), llm.indexOf("export function brokerMarket") + 3000)), "brokerMarket hears what its god asked to list");
ok(/async star\(/.test(src("server.mjs")), "/api/star tells a star's title, depth, holders, fair price and listing");
ok(/lists:/.test(src("server.mjs")), "/api/next carries each nation's list request this turn");
ok(fs.existsSync(new URL("../src/live/star.js", import.meta.url)) && /api\(`star\?/.test(src("src/live/star.js")), "src/live/star.js shows a tapped star");
ok(/onStar/.test(src("src/live/live.js")) && /userData\.list/.test(src("src/live/live.js")), "tapping a star in a sky picks it (live.js)");
ok(/choose\("list"/.test(src("src/live/star.js")), "on your own nation the star card can ask the Broker to list it");

// 6. AI gods whisper to the Broker too.
const sit = { god: "a", allowance: 0, clans: [12], reports: {}, gifts: {}, aogToday: 0, sellable: { 12: [{ token: "r:c1" }, { token: "k:t1" }] } };
const v = AG.validatePlan([{ kind: "list", clan: 12, tokens: ["r:c1", "r:nope"] }], sit);
ok(v[0]?.kind === "list" && v[0].tokens.join() === "r:c1", "an AI god may ask its Broker to list only what that nation can sell");
ok(AG.validatePlan([{ kind: "list", clan: 12, tokens: ["r:nope"] }], sit).length === 0, "nothing sellable: nothing asked");
ok(/kind === "list"[\s\S]{0,200}putChoice/.test(src("engine/aiact.mjs")), "an AI god's list request is stored as its choice");
