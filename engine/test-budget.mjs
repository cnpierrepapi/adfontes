// Phase B (12 Nov, written before the code): his budgets.
// 1. Claude: $1 a UTC day in all; the AI gods share one $0.25 pot inside it, the citizens get $0.75.
//    Neither side can spend the other's share, and the total never passes $1.
// 2. Fair share: when money runs short, the nations that waited longest for a Claude turn go first.
// 3. OpenAlex: live searches stop once 75% of the day's credits are used (remaining < 25% of the limit);
//    research then reads the closest cached search. The budget is read from OpenAlex, never guessed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };

// Papers run on a temp folder, no database, a fake key and a fake OpenAlex (set before any import reads env).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-budget-"));
Object.assign(process.env, { ADF_STATE_DIR: dir, ADF_PAPERS_CACHE: path.join(dir, "papers.json"), DATABASE_URL: "", OPENALEX_API_KEY: "test-key" });
delete process.env.ADF_SIM_CHAIN; delete process.env.ADF_DAILY_CAP;
fs.writeFileSync(process.env.ADF_PAPERS_CACHE, JSON.stringify({ "lithium battery cathode|10": [{ id: "W1", title: "Cathodes", year: 2020, abstract: "a", keywords: ["cathode"] }] }));

const { CFG } = await import("./config.mjs");
const L = await import("./llm.mjs");
const B = await import("./budget.mjs");

// 1. Claude pots.
ok(CFG.dailyCapUsd === 3.5 && CFG.godsCapUsd === 1.75 && CFG.citizensCapUsd === 1.75, `caps: $${CFG.dailyCapUsd} total, $${CFG.godsCapUsd} AI gods, $${CFG.citizensCapUsd} citizens`);
const CC = CFG.citizensCapUsd, GC = CFG.godsCapUsd;
L.setSpentToday(CC - 0.01, 0);
ok(L.canSpend("agent") && !L.canSpend("draft"), `citizens $0.01 short of their pot: a research call fits, a draft (worst $0.05) doesn't`);
ok(L.canSpend("god"), "citizens nearly out doesn't touch the gods' pot");
L.setSpentToday(0.1, GC - 0.01);
ok(!L.canSpend("god") && L.canSpend("draft"), "gods $0.01 short of their pot: no god call (worst $0.03), citizens still fine");
L.setSpentToday(CC, GC);
ok(!L.canSpend("agent") && !L.canSpend("god"), "both pots full: nothing runs");
ok(Math.abs(L.spentToday() - CFG.dailyCapUsd) < 1e-9 && Math.abs(L.spentToday("gods") - GC) < 1e-9 && Math.abs(L.spentToday("citizens") - CC) < 1e-9, "spentToday reads the total and each pot");

// 2. Fair share order.
const s = { clans: { 1: { lastThoughtAt: 500 }, 2: {}, 3: { lastThoughtAt: 100 }, 4: { lastThoughtAt: 100 }, 5: { lastThoughtAt: 900 } } };
const order = B.fairOrder([1, 2, 3, 4, 5].map((id) => ({ id })), s).map((c) => c.id);
ok(order.join() === "2,3,4,1,5", `longest-waiting first, never-thought first of all, ties by id (${order})`);
// Policy check: 6 nations, money for 2 Claude turns a turn: in 3 turns every nation gets one.
const sim = { clans: Object.fromEntries([1, 2, 3, 4, 5, 6].map((id) => [id, {}])) };
let t = 0; const got = new Set();
for (let turn = 0; turn < 3; turn++) for (const c of B.fairOrder([1, 2, 3, 4, 5, 6].map((id) => ({ id })), sim).slice(0, 2)) { sim.clans[c.id].lastThoughtAt = ++t; got.add(c.id); }
ok(got.size === 6, `money for 2 of 6 a turn: all 6 think within 3 turns (${[...got]})`);
const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
ok(/for \(const oc of B\.fairOrder\(live, s\)\)/.test(run) && /lastThoughtAt = /.test(run), "run.mjs walks the nations in fair order and stamps who got a Claude turn");
ok(/CFG\.citizensCapUsd \/ \(Math\.max\(1, alive\.length\) \* CFG\.nationDayUsd\)/.test(run), "the pace rule shares the citizens' pot, not the total");

// 3. OpenAlex: 75% of the day's credits, read from OpenAlex.
ok(B.openAlexOpen({ limit: 10000, remaining: 2600 }) && !B.openAlexOpen({ limit: 10000, remaining: 2400 }) && B.openAlexOpen(null), "open above 25% left, shut below; unknown = open (the first search reads the budget)");
let remaining = 2600, works = 0, budgetReads = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  const head = (h) => ({ "x-ratelimit-limit": "10000", "x-ratelimit-remaining": String(remaining), "retry-after": null }[h.toLowerCase()] ?? null);
  if (u.includes("/rate-limit")) { budgetReads++; return { ok: true, status: 200, headers: { get: head }, json: async () => ({ rate_limit: { credits_limit: 10000, credits_remaining: remaining } }) }; }
  works++; remaining -= 10;
  return { ok: true, status: 200, headers: { get: head }, json: async () => ({ results: [{ id: "https://openalex.org/W9", title: "Live", publication_year: 2024, abstract_inverted_index: { live: [0] }, keywords: [] }] }) };
};
const P = await import("./papers.mjs");
const a = await P.papersFor("sodium battery anode", 10);
ok(a[0].id === "W9" && works === 1 && budgetReads === 1, "with 2600 of 10000 left, a new search goes live (budget read once first)");
remaining = 2400;
await P.papersFor("solid state electrolyte", 10).catch(() => null);
const b = await P.papersFor("lithium battery cathode anode", 10).catch((e) => ({ err: e.message }));
ok(works === 2, `after the reply said 2400 left, no more live searches (${works} live in all)`);
ok(Array.isArray(b) && b[0]?.id === "W1", "research then reads the closest cached search");
ok(P.openAlexCut() === true, "papers.mjs says the 75% line was crossed (run.mjs logs it once a day)");
fs.rmSync(dir, { recursive: true, force: true });
