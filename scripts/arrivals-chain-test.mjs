// Phase E against the REAL testnet chain, on the spare test world v2d (never the live world): two newcomer AI gods
// arrive through aiact.arrive (stand-in minds, $0): one founds a nation of its own, one blesses an AI-led nation.
// Names are made up and off the god list, so no live AI account is ever taken. Costs ~8 testnet grace from the
// operator. Prints no key.   node scripts/arrivals-chain-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORLD = "v2d.adf-pool1-hf0w8.testnet";
Object.assign(process.env, { ADF_WORLD: WORLD, ADF_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "adf-arrchain-")), DATABASE_URL: "", ADF_FAKE_LLM: "1" });
const { connect } = await import("../engine/chain.mjs");
const { arrive } = await import("../engine/aiact.mjs");
const AR = await import("../engine/arrivals.mjs");
const store = await import("../engine/store.mjs");
const chain = connect("testnet");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const tag = Date.now().toString(36).slice(-4);
const before = await chain.clans();
// The AI-led nation it may bless: v2d's nation 3 (its god counts as AI here).
const n3 = before.find((c) => c.id === 3);
await store.addAiGod("testnet", n3.gods[0].account, "Inanna", "devout");
const s = { day: 1, clans: { 3: { mood: "hungry" } }, arrivals: AR.init(Date.now(), "v2d-test") };

const founder = `Zq${tag}ab`; // even length: the stand-in founds
const r1 = await arrive({ net: "testnet", s, chain, log: console.log, forceName: founder });
await new Promise((r) => setTimeout(r, 6000));
const after1 = await chain.clans();
const made = after1.find((c) => c.name === r1.nation);
ok(r1.kind === "found" && !!made, `${founder} founded "${r1.nation}" (${r1.kind}, ${r1.why})`);
ok(made && made.gods[0].account === r1.god && made.gods[0].account.endsWith(".adfontes-mw1fjpfx.testnet"), "the newcomer is its god, an account under the operator");
ok((await store.aiGods("testnet")).some((g) => g.account === r1.god), "registered as an AI god at once");
if (made) { const pol = await chain.dao(made.dao, "get_policy"); ok(pol.roles.some((x) => x.kind?.Group?.includes(r1.god)), "it sits on its new nation's council"); }

s.arrivals = AR.advance(s.arrivals, Date.now());
const blesser = `Zq${tag}abc`; // odd length: the stand-in blesses
const r2 = await arrive({ net: "testnet", s, chain, log: console.log, forceName: blesser });
await new Promise((r) => setTimeout(r, 6000));
const c3 = (await chain.clans()).find((c) => c.id === 3);
ok(r2.kind === "bless" && c3.gods.some((g) => g.account === r2.god), `${blesser} blessed nation 3 and is one of its gods (${r2.kind}, ${r2.why})`);
ok(!(await chain.clans()).filter((c) => c.gods.some((g) => g.account === r2.god)).some((c) => c.gods.some((g) => /^v2d?g\d/.test(g.account))), "it joined no nation with a human god");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
