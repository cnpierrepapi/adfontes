// engine/market.mjs: the marketplace's rules on the engine side (his calls 9 Nov).
import * as MK from "./market.mjs";
import { clampPrice, PRICES } from "./prices.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const FL = { corpusBase: 1, kit: 1, patentBase: 5, royalty: 1 };
const world = () => ({
  clans: {
    1: { field: "batteries", owned: { batteries: { depth: 0, parent: null }, cathodes: { depth: 1, parent: "batteries", corpus: "c1" }, nickel: { depth: 2, parent: "cathodes", corpus: "c2" } }, frontier: {} },
    2: { field: "solar cells", owned: { "solar cells": { depth: 0, parent: null } }, frontier: { nickel: { depth: 1, parent: "solar cells" } } },
    3: { field: "carbon", owned: { carbon: { depth: 0 } }, frontier: {}, fallen: { day: 9 } },
  },
  corpora: { c1: { id: "c1", clan: 1, node: "cathodes", title: "Cathodes", children: ["coatings"] }, c2: { id: "c2", clan: 1, node: "nickel", title: "Nickel", children: [] } },
  drafts: { d5: { id: "d5", clan: 1, passed: true, title: "A cathode patent", chain: ["batteries", "cathodes", "nickel"] }, d6: { id: "d6", clan: 1, passed: false, chain: ["nickel"] } },
  tools: { t1: { id: "t1", clan: 1 } },
});

let s = world();
const f = MK.fairOf(s, "r:c2", FL);
ok(f.kind === "research" && f.price === 1 * 3 * (2 / 2) && /depth 2/.test(f.why), `research is priced by the prices.mjs rule: ${f.why}`);
ok(MK.fairOf(s, "p:d5", FL).price === 15 && MK.fairOf(s, "p:d6", FL) === null, "a passed patent is priced per link in its chain (3 links = 15); a failed draft isn't for sale");
ok(clampPrice(100, 10) === PRICES.marketMax * 10 && clampPrice(1, 10) === PRICES.marketMin * 10 && clampPrice(12, 10) === 12, "asking prices are held to 0.5x-3x of fair");
const sell = MK.sellable(s, 1, FL).map((x) => x.token_id);
ok(["r:c1", "r:c2", "p:d5", "k:t1"].every((t) => sell.includes(t)) && !sell.includes("p:d6"), "a Broker can sell its nation's own research, patents and kits");
ok(MK.useful(s, 2, "r:c2") && !MK.useful(s, 1, "r:c2"), "research is only useful to a nation that doesn't know it");

const r = MK.applySale(s, { buyer: 2, seller: 1, token_id: "r:c2", price: 2 });
ok(r.learned === "nickel" && s.clans[2].owned.nickel?.corpus === "c2" && !s.clans[2].frontier.nickel && /market from clan 1/.test(s.clans[2].owned.nickel.how), "bought research joins the buyer's knowledge and leaves its open questions");
ok(s.clans[2].owned.nickel.parent === "solar cells", "a point whose parent the buyer lacks hangs off its root");
const again = MK.applySale(s, { buyer: 2, seller: 1, token_id: "r:c2" });
ok(again.learned === null && s.clans[2].marketCorpora.includes("c2"), "buying a point it already knew still leaves the token to mint");
MK.applySale(s, { buyer: 2, seller: 1, token_id: "k:t1" });
ok(s.clans[2].hasKit && s.clans[2].kits.includes("t1"), "a bought kit helps the Drafter");

s = world();
const roy = MK.royaltiesFor(s, ["nickel"], 2);
ok(roy.length === 1 && roy[0].clan === 1 && roy[0].draft === "d5", "research bought on a patent's chain pays its holder (failed drafts pay nothing)");
ok(MK.royaltiesFor(s, ["nickel"], 1).length === 0, "a holder never pays itself a royalty");
MK.applySale(s, { buyer: 2, seller: 1, token_id: "p:d5" });
ok(MK.holderOfPatent(s, "d5") === 2 && MK.royaltiesFor(s, ["cathodes"], 3)[0].clan === 2, "a sold patent takes its royalties to the new holder");
s.clans[2].fallen = { day: 10 };
ok(MK.royaltiesFor(s, ["cathodes"], 1).length === 0, "a fallen nation earns no royalties");
delete s.clans[2].fallen; s.clans[2].alive = false; // its last god claimed out (10 Nov: Colo Colo)
ok(MK.royaltiesFor(s, ["cathodes"], 1).length === 0, "an ended nation earns no royalties");
s.clans[2].alive = true;
ok(MK.royaltiesFor(s, ["cathodes"], 1).length === 1, "a living holder still does");
