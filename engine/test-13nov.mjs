// His asks 13 Nov (written before the code):
// 1. An AI action is claimed ("sending") before it goes out, so a restart can never send it twice.
// 2. After topping an AI god up, wait until the NEAR is there before blessing (Tezcatlipoca: 0.347 < 0.351).
// 3. AI gods have full control: no outside gods left in their nations, and an AI-led nation never turns to one.
// 4. A blessing is its own record, naming the god and the amount (the feed had nothing to show).
// 5. The feed shows the whole world's events again, your own nations highlighted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-13nov-"));
Object.assign(process.env, { ADF_STATE_DIR: dir, DATABASE_URL: "" });
const store = await import("./store.mjs");
const RV = await import("./reverence.mjs");

// 1. Claim before sending.
await store.queueAiActions("testnet", [{ at: 1, god: "lugh.op", kind: "bless", clan: 1, near: 0.2 }]);
const [row] = await store.dueAiActions("testnet", 10, 5);
ok(await store.claimAiAction(row.id) === true, "an action is claimed before it's sent");
ok(await store.claimAiAction(row.id) === false, "a second claim (a restarted engine) gets nothing: it can't be sent twice");
ok((await store.dueAiActions("testnet", 10, 5)).length === 0, "a claimed action is no longer due");
const act = fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8");
ok(/claimAiAction\(row\.id\)[\s\S]{0,200}continue/.test(act), "runDue claims each action and skips one it can't claim");

// 2. Top-up then wait.
const chain = fs.readFileSync(new URL("./chain.mjs", import.meta.url), "utf8");
ok(/async aiTopUp[\s\S]{0,900}for \(let i = 0; i < \d+; i\+\+\)[\s\S]{0,300}aiBalance/.test(chain), "aiTopUp waits until the new balance shows before returning");

// 3. Outside gods.
const s = { clans: { 1: {}, 12: {} }, rev: {
  1: { gods: { "lugh.op": { r: 36 }, kokopelli: { r: 9, outsider: true } }, followed: "lugh.op", claimedBy: "kokopelli" },
  12: { gods: { olive: { r: 40 }, bastet: { r: 20, outsider: true } }, followed: "olive", claimedBy: null },
} };
const onchain = [{ id: 1, alive: true, gods: [{ account: "lugh.op" }] }, { id: 12, alive: true, gods: [{ account: "olive" }] }];
const ai = new Set(["lugh.op"]);
const gone = RV.dropOutsiders(s, onchain, ai);
ok(!s.rev[1].gods.kokopelli && s.rev[1].claimedBy === null, "an AI-led nation's outside god is gone, and so is its claim");
ok(s.rev[12].gods.bastet, "a human-led nation keeps its rules (its outside gods stay)");
ok(gone[1]?.[0] === "kokopelli", "what was removed is listed (for the record)");
s.rev[1].gods["lugh.op"].r = 0;
const other = { 5: { followed: "susanoo.op", gods: { "susanoo.op": { r: 70 } } } };
Object.assign(s.rev, other); s.clans[5] = {};
RV.follow(s, 1, [], ai);
ok(s.rev[1].followed === "lugh.op" && !Object.values(s.rev[1].gods).some((g) => g.outsider), "even at 0, an AI-led nation stays with its AI god: no outside god claims it");

// 4. A blessing record.
const rv = { gods: { "lugh.op": { r: 36 } }, putIn: { "lugh.op": "1000000000000000000000000" }, lastProposal: 0, open: [] };
const fakeChain = { dao: async (dao, m) => (m === "get_last_proposal_id" ? 0 : []) };
const recs = await RV.godActions({ chain: fakeChain, s, oc: { id: 1, dao: "d", gods: [{ account: "lugh.op", put_in: "1300000000000000000000000" }] }, rv, day: 64, changes: [] });
const b = recs.find((r) => r.kind === "bless");
ok(b && b.god === "lugh.op" && Math.abs(b.near - 0.3) < 1e-9 && b.clan === 1, "a blessing becomes a record with the god and the amount");

// 5. The feed.
const feed = fs.readFileSync(new URL("../src/live/feed.js", import.meta.url), "utf8");
ok(/case "bless":/.test(feed) && /case "ruling":/.test(feed) && /case "correction":/.test(feed), "the feed has lines for blessings, rulings and the fresh start");
ok(/const ours = true/.test(feed) || /world events/.test(feed), "the feed shows every nation's events, not only your own");
fs.rmSync(dir, { recursive: true, force: true });
