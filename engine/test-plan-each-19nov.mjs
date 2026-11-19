// One Claude call per AI god (his call 19 Nov). In batches of 6, Claude left about 5 gods a plan out of its answer
// entirely, never the first god of a batch (debug/plan-cost: 3 real runs each way; one god per call left nobody out
// and kept 83 actions a plan against 72, at about twice the planner's cost, ~$0.035 a plan). Written before the code:
//  1. aigods.planEach: one call per god, at most `conc` at a time; every god gets its own plan.
//  2. a god whose answer is missing, empty or failed is asked once more; only then the stand-in (fakePlan).
//  3. aigods.planSummary: one log line a plan with who was planned, re-asked and stood in, and what it cost.
//  4. llm.json: an answer cut off at max_tokens is asked again bigger, by streaming (the SDK refuses a non-streaming
//     call that big: "Streaming is required", which put a whole batch of 6 gods on the stand-in).
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import * as A from "./aigods.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const sit = (i) => ({ god: `g${i}.op`, clans: [i], nations: [{ id: i, name: `n${i}`, standing: 10, mood: "hungry", need: 0.3, fed24h: 0 }], allowance: 1, gifts: {} });
const whisper = (s) => [{ kind: "whisper", clan: s.clans[0], text: "words" }];

// ---- 1. one call per god, a few at a time ----
{
  const sits = Array.from({ length: 13 }, (_, i) => sit(i));
  const sizes = [];
  let inFlight = 0, most = 0;
  const plan = async (batch) => {
    sizes.push(batch.length); inFlight++; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5 + (batch[0].clans[0] % 3) * 5));
    inFlight--;
    return { [batch[0].god]: whisper(batch[0]) };
  };
  const { plans, outcomes } = await A.planEach(sits, plan, { conc: 5 });
  ok(sizes.length === 13 && sizes.every((n) => n === 1), `13 gods, 13 calls of one god each (${sizes.length} calls, sizes ${[...new Set(sizes)]})`);
  ok(most <= 5 && most > 1, `at most 5 calls at once, and they do overlap (${most})`);
  ok(sits.every((s) => plans[s.god]?.[0]?.text === "words"), "every god keeps Claude's own plan");
  ok(sits.every((s) => outcomes[s.god] === "planned"), "every god's outcome is 'planned'");
}

// ---- 2. one more try, then the stand-in ----
{
  const sits = [sit(1), sit(2), sit(3), sit(4), sit(5)];
  const tries = {};
  const plan = async ([s]) => {
    tries[s.god] = (tries[s.god] || 0) + 1;
    const n = tries[s.god];
    if (s.god === "g1.op") return { [s.god]: [] }; // always empty
    if (s.god === "g2.op") { if (n === 1) throw new Error("Unterminated string in JSON"); return { [s.god]: whisper(s) }; } // fails, then fine
    if (s.god === "g3.op") return n === 1 ? {} : { [s.god]: whisper(s) }; // left out, then fine
    if (s.god === "g4.op") return { "g4": whisper(s) }; // Claude shortened the account: one god asked, one answer, so it's that god's
    throw new Error("the AI gods' $1.75 for today is spent"); // g5: always fails
  };
  const { plans, outcomes, failed } = await A.planEach(sits, plan, { conc: 2 });
  ok(tries["g1.op"] === 2 && outcomes["g1.op"] === "stand-in" && plans["g1.op"].some((a) => a.kind === "bless"), "a god Claude leaves empty twice is asked twice, then gets the stand-in (it feeds the hungry)");
  ok(tries["g2.op"] === 2 && outcomes["g2.op"] === "retried" && plans["g2.op"][0].text === "words", "a failed call is asked once more and the second answer is kept");
  ok(tries["g3.op"] === 2 && outcomes["g3.op"] === "retried", "a god left out of the answer is asked once more");
  ok(tries["g4.op"] === 1 && outcomes["g4.op"] === "planned" && plans["g4.op"][0].text === "words", "one god asked, one entry back under another name: it's that god's plan, no retry");
  ok(tries["g5.op"] === 2 && outcomes["g5.op"] === "stand-in" && plans["g5.op"].length > 0, "a spent pot: tried twice, then the stand-in, never idle");
  ok(failed.length === 3 && failed.every((e) => typeof e === "string"), `failed calls are counted, never thrown (${failed.length})`);
  const none = await A.planEach([], plan);
  ok(Object.keys(none.plans).length === 0, "no gods, no calls");
}

// ---- 3. the plan's log line ----
{
  const outcomes = { "a.op": "planned", "b.op": "planned", "c.op": "retried", "d.op": "stand-in" };
  const line = A.planSummary(outcomes, { actions: 9, dropped: 3, usd: 0.0351 });
  ok(/2 planned/.test(line) && /1 re-asked/.test(line) && /1 stand-in/.test(line), `counts each outcome: "${line}"`);
  ok(/re-asked: c\b/.test(line) && /stand-in: d\b/.test(line), "names the gods re-asked and on the stand-in (short names)");
  ok(/9 actions/.test(line) && /3 dropped/.test(line) && /\$0\.0351/.test(line), "says how many actions were kept, dropped by the checks, and what Claude cost");
  const act = fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8").slice(fs.readFileSync(new URL("./aiact.mjs", import.meta.url), "utf8").indexOf("export async function planGods"));
  ok(/A\.planEach\(/.test(act) && !/A\.planInBatches\(/.test(act), "planGods plans one god per call (planEach), not in batches");
  ok(/maxTokens: 16000/.test(act), "each god's call has room to think (16000; no tight cap, his call)");
  ok(/planSummary\(/.test(act) && /log\(/.test(act), "planGods logs the summary line every plan");
}

// ---- 4. a cut-off answer is asked again by streaming ----
{
  const proto = Object.getPrototypeOf(new Anthropic({ apiKey: "x" }).messages);
  const seen = [];
  const msg = (stop, text) => ({ stop_reason: stop, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text }] });
  proto.create = async function (req) { seen.push({ how: "create", max: req.max_tokens }); return msg("max_tokens", '{"gods":[{"god":"g1.op","actions":[{"kind":"whis'); };
  proto.stream = function (req) { seen.push({ how: "stream", max: req.max_tokens }); return { finalMessage: async () => msg("end_turn", '{"gods":[{"god":"g1.op","actions":[{"kind":"whisper","clan":1,"text":"hi"}]}]}') }; };
  const { godsPlan } = await import("./llm.mjs");
  let got = null, err = null;
  try { got = await godsPlan([sit(1)], A.fakePlan, undefined, { maxTokens: 16000 }); } catch (e) { err = String(e.message || e); }
  ok(!err, `a cut-off answer doesn't throw (${err || "ok"})`);
  ok(seen[0]?.how === "create" && seen[0].max === 16000 && seen[1]?.how === "stream" && seen[1].max === 64000, `asked again 4x bigger by streaming (${seen.map((x) => `${x.how} ${x.max}`).join(", ")})`);
  ok(got?.["g1.op"]?.[0]?.text === "hi", "and the second, whole answer is used");
  seen.length = 0;
  proto.create = async function (req) { seen.push({ how: "create", max: req.max_tokens }); return msg("end_turn", '{"gods":[]}'); };
  await godsPlan([sit(1)], A.fakePlan);
  ok(seen.length === 1 && seen[0].how === "create" && seen[0].max === 6000, "a normal answer is one plain call (6000 by default)");
}
