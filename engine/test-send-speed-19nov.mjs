// AI motions took ~2 min each to send (his ask 19 Nov: find where and fix it). debug/motion-timeline.mjs on 14 sealed
// motions: the proposal landed ~10 s after the loop was free and the god's own yes vote 1-2 s later, then ~100 s passed
// before "ok". debug/receipt-times.mjs: the co-god vote that passes a motion had ALL its receipts (the whisper too)
// executed within 3 s; the RPC call waiting for every receipt (EXECUTED_OPTIMISTIC) only answered ~90 s later. And a
// co-god kept voting after the motion had passed: ERR_PROPOSAL_NOT_READY_FOR_VOTE on nearly every motion.
// Written before the fix:
//  1. aigods.confirmVote: a vote returns once it's in a final block, then the DAO's own receipt is read (about every
//     second) for refusal; never waits on the motion's later receipts; never hangs past its tries.
//  2. aigods.coVoters: co-gods vote only as many times as the motion still needs (Sputnik: floor(n/2)+1 yes votes).
//  3. chain.aiSend sends act_proposal through confirmVote with waitUntil INCLUDED_FINAL; runDue uses coVoters.
import fs from "node:fs";
import * as A from "./aigods.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const DAO = "adf-1.sputnikv2.testnet";
const outcome = (status) => ({ receipts_outcome: [{ outcome: { executor_id: DAO, status } }, { outcome: { executor_id: "world.testnet", status: { SuccessValue: "" } } }] });

// ---- 1. confirmVote ----
{
  const slept = [], asked = [];
  const sleep = async (ms) => { slept.push(ms); };
  // In a final block at once; the DAO's receipt shows on the second look.
  const looks = [null, outcome({ SuccessValue: "" })];
  const r = await A.confirmVote({ send: async () => ({ hash: "H1" }), status: async (h) => { asked.push(h); return looks.shift(); }, dao: DAO, sleep });
  ok(r.hash === "H1" && !r.unconfirmed, "a vote whose DAO receipt succeeded comes back with its hash");
  ok(asked.length === 2 && asked.every((h) => h === "H1"), `the DAO's receipt is looked up by the vote's hash until it shows (${asked.length} looks)`);
  ok(slept.length === 2 && slept.every((ms) => ms <= 1000), `it looks about every second (${slept.join(",")} ms)`);
}
{
  // The motion had already passed: the DAO refused the vote. Same words as today, so the refusal reads the same.
  let err = null;
  try { await A.confirmVote({ send: async () => ({ hash: "H2" }), status: async () => outcome({ Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: panicked at 'ERR_PROPOSAL_NOT_READY_FOR_VOTE'" } } } } }), dao: DAO, sleep: async () => {} }); } catch (e) { err = String(e.message || e); }
  ok(/ERR_PROPOSAL_NOT_READY_FOR_VOTE/.test(err || "") && /refused/.test(err || ""), `a refused vote throws, naming why (${(err || "no error").slice(0, 70)})`);
  ok(/panicked|ERR_|refused/i.test(err || ""), "the refusal matches sendChecked's REFUSED words, so it isn't sent a second time");
}
{
  // The node keeps saying "don't know yet" (or errors): give up waiting after the tries, the vote is in a final block.
  let n = 0;
  const r = await A.confirmVote({ send: async () => ({ hash: "H3" }), status: async () => { n++; if (n % 2) throw new Error("UNKNOWN_TRANSACTION"); return null; }, dao: DAO, sleep: async () => {}, tries: 8 });
  ok(r.hash === "H3" && r.unconfirmed === true && n === 8, `after 8 looks it stops waiting and says so (${n} looks, unconfirmed ${r.unconfirmed})`);
}
{
  // Only the DAO's receipt counts: a later receipt failing (the world refusing the whisper) is the motion's business.
  const r = await A.confirmVote({ send: async () => ({ hash: "H4" }), status: async () => ({ receipts_outcome: [{ outcome: { executor_id: DAO, status: { SuccessReceiptId: "x" } } }, { outcome: { executor_id: "world.testnet", status: { Failure: {} } } }] }), dao: DAO, sleep: async () => {} });
  ok(r.hash === "H4" && !r.unconfirmed, "the vote counts once the DAO took it, whatever the motion's own calls do next");
}
{
  // send itself failing (RPC down) is not swallowed: sendChecked around it looks on chain and retries as before.
  let err = null;
  try { await A.confirmVote({ send: async () => { throw new Error("fetch failed"); }, status: async () => null, dao: DAO, sleep: async () => {} }); } catch (e) { err = String(e.message); }
  ok(err === "fetch failed", "a failed send comes straight back to sendChecked");
}

// ---- 2. coVoters ----
{
  const ai = new Set(["a", "b", "c", "d", "e"]);
  const clan = (n) => ({ gods: Array.from({ length: n }, (_, i) => ({ account: "abcde"[i] })) });
  const prop = (votes) => ({ status: "InProgress", votes: Object.fromEntries(votes.map((v) => [v, "Approve"])) });
  ok(A.coVoters(clan(5), "a", ai, prop(["a"])).join() === "b,c", `5 gods, proposer voted: 2 more yes votes pass it (${A.coVoters(clan(5), "a", ai, prop(["a"])).join()})`);
  ok(A.coVoters(clan(4), "a", ai, prop(["a"])).join() === "b,c", "4 gods: needs 3, so 2 co-votes");
  ok(A.coVoters(clan(2), "a", ai, prop(["a"])).join() === "b", "2 gods: one co-vote");
  ok(A.coVoters(clan(1), "a", ai, prop(["a"])).length === 0, "1 god: its own vote passed it, nobody else votes");
  ok(A.coVoters(clan(4), "a", new Set(["a", "c"]), prop(["a"])).join() === "c", "only AI gods vote; a person's seat is skipped (it may still pass when they vote)");
  ok(A.coVoters(clan(5), "a", ai, prop(["a", "b"])).join() === "c", "a vote already in counts");
  ok(A.coVoters(clan(5), "a", ai, prop([])).join() === "b,c", "the proposer's own vote counts even when a lagging read doesn't show it yet");
  ok(A.coVoters(clan(4), "a", ai, { ...prop(["a"]), status: "Approved" }).length === 0, "a motion that already passed gets no more votes");
}

// ---- 3. wired in ----
{
  const chain = fs.readFileSync(new URL("./chain.mjs", import.meta.url), "utf8");
  const send = chain.slice(chain.indexOf("async aiSend("), chain.indexOf("// ---- agent wallets"));
  ok(/confirmVote\(/.test(send) && /INCLUDED_FINAL/.test(send) && /act_proposal/.test(send), "aiSend sends votes through confirmVote, waiting only for a final block");
  const act = fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8");
  const run = act.slice(act.indexOf("export async function runDue"), act.indexOf("export async function judgeMotions"));
  ok(/A\.coVoters\(/.test(run), "runDue's co-gods vote only as many times as the motion needs");
}
