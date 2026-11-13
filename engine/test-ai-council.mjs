// His call 13 Nov: gods share councils with AI gods (a human who bought one of two AI seats, or blessed into an AI
// nation), so AI gods judge a co-god's motion: approve or reject, within seconds. And every seat can be sold,
// whoever it's shared with. Written before the code.
//    node engine/test-ai-council.mjs
import fs from "node:fs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const A = await import("./aigods.mjs");
const S = await import("./seats.mjs");
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const WORLD = "w6.test", DAO = "north.sputnikv2.testnet";
const motion = (id, method, args, proposer = "human.testnet", votes = {}) => ({ id, proposer, status: "InProgress", votes, description: "x", kind: { FunctionCall: { receiver_id: WORLD, actions: [{ method_name: method, args: b64(args), deposit: "0", gas: "1" }] } } });

// 1. The guard: an AI god may now vote no as well as yes, and still nothing else.
{
  const vote = (action) => ({ receiver: DAO, method: "act_proposal", args: { id: 1, action, proposal: {} }, deposit: 0n });
  ok(A.guard(vote("VoteApprove"), WORLD), "a yes vote is allowed");
  ok(A.guard(vote("VoteReject"), WORLD), "a no vote is allowed now");
  let threw = false; try { A.guard(vote("VoteRemove"), WORLD); } catch { threw = true; }
  ok(threw, "removing a motion is still refused");
}

// 2. Judging a motion: what it does, read from the motion itself.
{
  const j = (m, extra = {}) => A.judgeMotion({ motion: m, world: WORLD, ...extra });
  ok(j(motion(1, "whisper", { clan_id: 3, text: "study the tides" })).approve, "a whisper is approved");
  ok(j(motion(2, "rule", { gift_id: 4, reward: true })).approve, "a ruling on a gift is approved");
  ok(j(motion(3, "smite", { clan_id: 3, agent: "Ana", verdict: "Stunt" })).approve, "a smite is approved");
  ok(j(motion(4, "root_out", { clan_id: 3, point: "act of god: Helios" })).approve, "an Act of God is approved");
  const ro = j(motion(5, "root_out", { clan_id: 3, point: "graphene" }));
  ok(!ro.approve && ro.why, "rooting out the nation's own research is rejected, with a reason");
  ok(!j(motion(6, "release_staking", { clan_id: 3, to: "x.testnet" })).approve, "sending the nation's staking away is rejected");
  ok(!j({ ...motion(7, "whisper", {}), kind: { Transfer: { receiver_id: "x", amount: "1" } } }).approve, "a motion that isn't a world power is rejected");
  ok(!j(motion(8, "whisper", { clan_id: 3, text: "x" }), { world: "other.test" }).approve, "a motion aimed at another contract is rejected");
}

// 3. Which motions an AI god has to judge: open, raised by someone who isn't an AI god, not yet voted on by it.
{
  const ai = new Set(["saturn.op", "mars.op"]);
  const list = [motion(1, "whisper", {}), motion(2, "whisper", {}, "mars.op"), { ...motion(3, "whisper", {}), status: "Approved" }, motion(4, "whisper", {}, "human.testnet", { "saturn.op": "Approve" }), motion(5, "whisper", {}, "human.testnet", { "mars.op": "Approve" })];
  const todo = A.motionsToJudge(list, "saturn.op", ai).map((m) => m.id);
  ok(todo.join(",") === "1,5", `saturn judges 1 and 5 only (got ${todo.join(",")})`);
}

// 4. Every AI seat is for sale, in any nation, alone or alongside other gods.
{
  const clans = [
    { id: 3, alive: true, gods: [{ account: "saturn.op" }] },
    { id: 4, alive: true, gods: [{ account: "dushara.op" }, { account: "tez.op" }] },
    { id: 5, alive: true, gods: [{ account: "human.test" }, { account: "lugh.op" }] },
    { id: 6, alive: false, gods: [{ account: "mars.op" }] },
  ];
  const ai = new Set(["saturn.op", "dushara.op", "tez.op", "mars.op", "lugh.op"]);
  const claim = { "3|saturn.op": 2, "4|dushara.op": 1, "4|tez.op": 3, "5|lugh.op": 2 };
  const L = S.aiListings({ clans, ai, open: [], stakeOf: (c, a) => claim[`${c}|${a}`] ?? null });
  const keys = L.map((x) => `${x.clan}|${x.seller}`).sort().join(" ");
  ok(keys === "3|saturn.op 4|dushara.op 4|tez.op 5|lugh.op", `every AI seat listed, each at its own price (${keys})`);
  ok(L.find((x) => x.seller === "tez.op").price === S.aiSeatPrice(3) && L.find((x) => x.seller === "dushara.op").price === S.aiSeatPrice(1), "each seat priced on its own claim value");
  ok(!L.some((x) => x.seller === "human.test" || x.clan === 6), "a human's seat and a fallen nation's aren't listed by the engine");
}

// 5. The wiring.
{
  const loop = src("engine/loop.mjs"), aiact = src("engine/aiact.mjs"), run = src("engine/run.mjs");
  ok(/judgeMotions/.test(loop), "the loop has AI gods judge co-gods' motions");
  ok(/export async function judgeMotions/.test(aiact) && /VoteReject/.test(aiact), "aiact sends approve or reject votes");
  ok(/stakeOf: \(id, account\)/.test(run), "run.mjs prices each AI seat on its own claim value");
}
