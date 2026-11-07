// Proves the daily cap (CFG.dailyCapUsd) refuses a call BEFORE it reaches Anthropic.
// Safe to run with a dead key: a call that slipped past the cap would come back 401 instead.
import { CFG } from "./config.mjs";
import { setSpentToday, canSpend, scholarTurn, draftTurn, BudgetError } from "./llm.mjs";
let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", label); };
setSpentToday(0);
check("fresh day: research and drafts allowed", canSpend("agent") && canSpend("draft"));
setSpentToday(CFG.dailyCapUsd - 0.01);
check(`$${(CFG.dailyCapUsd - 0.01).toFixed(2)} spent: research allowed, a draft (worst $${CFG.worstCallUsd.draft}) refused`, canSpend("agent") && !canSpend("draft"));
setSpentToday(CFG.dailyCapUsd - 0.001);
check("$0.499 spent: research refused too", !canSpend("agent"));
for (const [name, fn] of [["scholarTurn", () => scholarTurn({ field: "batteries", topic: "batteries", parent: null, papers: [], temperament: "INTJ", whisper: "" })], ["draftTurn", () => draftTurn({ field: "batteries", chain: [], gaps: [] })]]) {
  try { await fn(); check(`${name} over the cap: refused`, false); }
  catch (e) { check(`${name} over the cap: refused locally (${e instanceof BudgetError ? "cap" : "reached the API: " + String(e.message).slice(0, 40)})`, e instanceof BudgetError); }
}
console.log(bad ? `${bad} FAILED` : "ALL PASS");
