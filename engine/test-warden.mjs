// Warden checks: run with `node engine/test-warden.mjs`. Exits 1 on any failure.
import { wardenDraft, wardenCorpus, absorbRuins } from "./world.mjs";

let bad = 0;
const t = (name, ok) => { console.log(ok ? "PASS" : "FAIL", name); if (!ok) bad++; };
const fig = (texts) => ({ label: "FIG. 1", caption: "x", svg: `<svg>${texts.map((x) => `<text x="1" y="1">${x}</text>`).join("")}</svg>` });
const draft = (figs, description, support = [["a"]]) => ({ claims: support.map((s) => ({ text: "c", supported_by: s })), description, figures: figs });

t("numerals alone are found", wardenDraft(draft([fig(["10", "12"]), fig(["30"])], "part (10) and (12) and step (30)"), ["a"]).passed);
t("numerals after a step label are found", wardenDraft(draft([fig(["10"]), fig(["Measure output 30", "Log trend 32"])], "(10) (30) (32)"), ["a"]).passed);
t("FIG. titles are not numerals", wardenDraft(draft([fig(["FIG. 1", "10"]), fig(["FIG. 2", "20"])], "(10) (20)"), ["a"]).passed);
t("an unexplained numeral fails", !wardenDraft(draft([fig(["10", "14"]), fig(["20"])], "(10) (20)"), ["a"]).passed);
t("a figure with no numerals fails", !wardenDraft(draft([fig(["Measure output"]), fig(["20"])], "(20)"), ["a"]).passed);
t("a claim citing outside the chain fails", !wardenDraft(draft([fig(["10"]), fig(["20"])], "(10) (20)", [["a", "elsewhere"]]), ["a"]).passed);
t("one figure is not enough", !wardenDraft(draft([fig(["10"])], "(10)"), ["a"]).passed);
t("clean corpus passes", wardenCorpus({ findings: [{ claim: "x", cites: ["W1", "W2"] }] }, ["W1", "W2"]).clean);
t("made-up citation is caught", !wardenCorpus({ findings: [{ claim: "x", cites: ["W1", "W999"] }] }, ["W1"]).clean);

// Ruins: nothing without a matching gain; a match pulls in the ruin point and what grew from it.
const world = () => ({
  corpora: { cx: { children: ["porosity"] } },
  ruins: { "metal-organic frameworks": { depth: 2, parent: "x", corpus: "r1", from: 1 }, "mof linkers": { depth: 3, parent: "metal-organic frameworks", corpus: "r2", from: 1 }, "llzo": { depth: 2, parent: "y", corpus: "r3", from: 1 } },
});
const clan = () => ({ owned: { root: { depth: 0 } }, frontier: {} });
{ const s = world(), c = clan(); t("no gain, nothing absorbed", absorbRuins(s, c, []).length === 0 && Object.keys(s.ruins).length === 3); }
{ const s = world(), c = clan(); c.owned["metal-organic frameworks"] = { depth: 1, corpus: "cx" };
  const got = absorbRuins(s, c, ["metal-organic frameworks"]);
  t("a matching gain pulls the point's descendants, not unrelated ruins", got.join() === "mof linkers" && !!s.ruins.llzo); }
{ const s = world(), c = clan(); s.corpora.cy = { children: ["metal-organic frameworks"] }; c.owned["zif-8"] = { depth: 1, corpus: "cy" };
  const got = absorbRuins(s, c, ["zif-8"]);
  t("a gain whose papers are tagged with a ruin absorbs it + its subtree", got.join() === "metal-organic frameworks,mof linkers"); }
process.exit(bad ? 1 : 0);
