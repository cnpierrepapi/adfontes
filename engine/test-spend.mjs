// The Claude cap (his rule, 8 Nov; $1 with a $0.75 citizens' pot since 12 Nov): one cap a day across every network, kept in one ledger that
// a world wipe can't reset; more nations than the cap feeds all slow down evenly.
import fs from "node:fs";
import { CFG } from "./config.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
delete process.env.DATABASE_URL;
const F = "engine/state/llm_spend.json", keep = fs.existsSync(F) ? fs.readFileSync(F) : null;
const store = await import("./store.mjs");
const day = "2099-01-01";
await store.addSpend(day, 0.2); await store.addSpend(day, 0.15); await store.addSpend(day, 0);
ok(Math.abs((await store.spendOn(day)) - 0.35) < 1e-9, "the ledger adds every call's cost: 0.2 + 0.15 = 0.35");
ok((await store.spendOn("2099-01-02")) === 0, "a new UTC day starts at zero");
const llm = await import("./llm.mjs");
llm.setSpentToday(await store.spendOn(day));
ok(llm.canSpend("agent"), `$0.35 spent: a research call still fits under the citizens' ${CFG.citizensCapUsd}`);
const near = +(CFG.citizensCapUsd - 0.03).toFixed(3), full = +(CFG.citizensCapUsd - 0.001).toFixed(3);
llm.setSpentToday(near);
ok(!llm.canSpend("draft") && llm.canSpend("agent"), `${near} spent: no $0.05 draft, a $0.002 research call still fits`);
llm.setSpentToday(full);
ok(!llm.canSpend("agent"), `${full} spent: nothing more today`);
const share = (n) => Math.min(1, CFG.citizensCapUsd / (Math.max(1, n) * CFG.nationDayUsd));
const fullPace = Math.floor(CFG.citizensCapUsd / CFG.nationDayUsd);
ok(share(fullPace) === 1 && share(fullPace + 1) < 1, `${fullPace} nations run at full pace; the ${fullPace + 1}th slows everyone (${Math.round(share(fullPace + 1) * 100)}%)`);
ok(Math.abs(share(100) * 100 * CFG.nationDayUsd - CFG.citizensCapUsd) < 1e-9, `100 nations: the slowed pace adds up to exactly the citizens' ${CFG.citizensCapUsd} (each at ${Math.round(share(100) * 100)}%)`);
if (keep) fs.writeFileSync(F, keep); else { const m = JSON.parse(fs.readFileSync(F, "utf8")); delete m[day]; fs.writeFileSync(F, JSON.stringify(m)); }
