// The Claude cap (his rule, 8 Nov): one $0.50 a day across every network, kept in one ledger that
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
ok(llm.canSpend("agent"), "$0.35 spent: a research call still fits under $0.50");
llm.setSpentToday(0.47);
ok(!llm.canSpend("draft") && llm.canSpend("agent"), "$0.47 spent: no $0.05 draft, a $0.002 research call still fits");
llm.setSpentToday(0.499);
ok(!llm.canSpend("agent"), "$0.499 spent: nothing more today");
const share = (n) => Math.min(1, CFG.dailyCapUsd / (Math.max(1, n) * CFG.nationDayUsd));
ok(share(7) === 1 && share(8) < 1, `7 nations run at full pace; the 8th slows everyone (${Math.round(share(8) * 100)}%)`);
ok(Math.abs(share(20) * 20 * CFG.nationDayUsd - CFG.dailyCapUsd) < 1e-9, "20 nations: the slowed pace adds up to exactly the cap");
if (keep) fs.writeFileSync(F, keep); else { const m = JSON.parse(fs.readFileSync(F, "utf8")); delete m[day]; fs.writeFileSync(F, JSON.stringify(m)); }
