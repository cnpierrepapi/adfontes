// engine/tokens.mjs: what every nation should hold as NEP-245 tokens, and what's left to mint.
import { wanted, toMint } from "./tokens.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const s = {
  clans: {
    1: { name: "Helios", owned: { root: { corpus: null }, a: { corpus: "c1" }, b: { corpus: "c1" }, c: { corpus: "c2" } }, kits: ["t9"] },
    2: { name: "Salamanco", owned: { root: { corpus: null }, x: { corpus: "c2", how: "bought from clan 1" } } },
    3: { name: "Gone", owned: { y: { corpus: "c3" } } },
  },
  corpora: { c1: { title: "Batteries" }, c2: { title: "Solar" }, c3: { title: "Lost" } },
  drafts: { d5: { id: "d5", clan: 1, passed: true, title: "A patent" }, d6: { id: "d6", clan: 2, passed: false } },
  tools: { t9: { id: "t9", clan: 2 } },
};
const dao = { 1: "dao1", 2: "dao2" }; // nation 3 has no DAO on chain: skipped
const w = wanted(s, (id) => dao[id] ?? null);
const has = (owner, t) => w.some((m) => m.owner_id === owner && m.token_id === t);
ok(has("dao1", "r:c1") && w.filter((m) => m.token_id === "r:c1").length === 1, "a corpus behind two points is one token for that nation");
ok(has("dao1", "r:c2") && has("dao2", "r:c2"), "bought research: the seller keeps its copy, the buyer gets one");
ok(has("dao1", "p:d5") && !w.some((m) => m.token_id === "p:d6"), "only passed drafts become patents");
ok(has("dao2", "k:t9") && has("dao1", "k:t9"), "a kit goes to its maker and a copy to each buyer");
ok(!w.some((m) => m.token_id === "r:c3"), "a nation with no DAO is skipped");
const left = toMint({ ...s, mtDone: ["1|r:c1", "1|p:d5"] }, (id) => dao[id] ?? null);
ok(!left.some((m) => m.key === "1|r:c1" || m.key === "1|p:d5") && left.length === w.length - 2, "what was minted isn't minted again");
ok(toMint(s, (id) => dao[id] ?? null)[0].token_id === "p:d5", "patents go first");
