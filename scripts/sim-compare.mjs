// Two fast-forward runs side by side (his ask 8 Nov): is the run with simulated gods a better picture
// of the full game loop than the godless one?   node scripts/sim-compare.mjs <godless dir> <gods dir>
import fs from "node:fs";
import { standings } from "../engine/reverence.mjs";

function load(DIR) {
  const S = JSON.parse(fs.readFileSync(`${DIR}/state/testnet.json`, "utf8"));
  const C = JSON.parse(fs.readFileSync(`${DIR}/chain.json`, "utf8"));
  const dir = `${DIR}/state/testnet`;
  const days = fs.readdirSync(dir).filter((f) => /^day-\d+\.json$/.test(f)).map((f) => Number(f.match(/\d+/)[0])).sort((a, b) => a - b);
  const recs = days.flatMap((d) => JSON.parse(fs.readFileSync(`${dir}/day-${d}.json`, "utf8")).map((r) => ({ ...r, day: d })));
  return { S, C, days, recs };
}
const fl = (u) => Number(BigInt(u) / 10n ** 16n) / 1e6;

function measure({ S, C, days, recs }) {
  const n = (k) => recs.filter((r) => r.kind === k).length;
  const changes = recs.flatMap((r) => r.changes || []);
  const godMoves = changes.filter((c) => /^(whisper|blessed|rewarded|claimed|punished|stunted|killed|released|rooted|cut)/.test(c.why)).length;
  const corpus = recs.filter((r) => r.kind === "corpus");
  const faked = corpus.filter((r) => (r.fake || 0) > 0).length; // the Warden's count of made-up citations
  const living = C.clans.filter((c) => c.alive && !S.clans[c.id]?.fallen);
  const tricksters = Object.values(C.agents).flat().filter((a) => a.role === "Trickster" && a.alive).length;
  const citizens = Object.values(C.agents).flat().filter((a) => a.role !== "Trickster" && a.alive).length;
  const treas = living.map((c) => fl(c.florins));
  const broke = treas.filter((x) => x < 1).length;
  const moods = {}; for (const c of living) { const m = S.clans[c.id].mood ?? "?"; moods[m] = (moods[m] || 0) + 1; }
  const st = standings(S, C.clans).map((r) => r.standing);
  const zero = st.filter((x) => x < 1).length;
  const spread = st.length ? Math.max(...st) - Math.min(...st) : 0;
  // How long standings sat at zero: share of (nation, turn) samples with standing < 1, from reverence records.
  const revRecs = recs.filter((r) => r.kind === "reverence");
  const techs = Object.values(S.clans).reduce((a, c) => a + (c.techs?.length || 0), 0);
  const wars = Object.values(S.wars || {});
  return {
    turns: days.length,
    "god actions counted by the engine": godMoves,
    "rewarded gifts": n("ruling") ? recs.filter((r) => r.kind === "ruling" && r.status === "Rewarded").length : 0,
    "unruled gifts": recs.filter((r) => r.kind === "ruling" && r.status === "Unruled").length,
    "Tricksters arrived": n("trickster"),
    "Tricksters alive at the end": tricksters,
    "research pieces": corpus.length,
    "with a faked citation": `${faked} (${corpus.length ? Math.round((100 * faked) / corpus.length) : 0}%)`,
    "fines/upkeep records": n("upkeep") + n("fine"),
    "citizens alive (not Tricksters)": citizens,
    "nations standing": living.length,
    "broke nations (< 1 florin)": `${broke} of ${living.length}`,
    "florins held (min / median / max)": treas.length ? `${Math.min(...treas).toFixed(1)} / ${treas.sort((a, b) => a - b)[Math.floor(treas.length / 2)].toFixed(1)} / ${Math.max(...treas).toFixed(1)}` : "-",
    moods: Object.entries(moods).map(([k, v]) => `${v} ${k}`).join(", "),
    "standings (top to bottom)": st.map((x) => x.toFixed(0)).join(" · "),
    "nations at ~0 reverence": `${zero} of ${st.length}`,
    "standings spread": spread.toFixed(1),
    "techs held": techs,
    "drafts / passed": `${n("gift")} / ${recs.filter((r) => r.kind === "gift" && r.passed).length}`,
    "trades": n("trade"),
    "wars declared / fallen / surrendered / peace": `${n("war")} / ${n("fallen")} / ${recs.filter((r) => r.kind === "fallen" && r.surrendered).length} / ${n("peace")}`,
    "wars still on": wars.filter((w) => w.status === "on").length,
    "engine errors": n("error"),
    _revRecs: revRecs.length,
  };
}

const [A, B] = process.argv.slice(2);
const a = measure(load(A)), b = measure(load(B));
const w = Math.max(...Object.keys(a).map((k) => k.length));
console.log(`${"".padEnd(w)}  ${"GODLESS".padEnd(28)} WITH GODS`);
for (const k of Object.keys(a)) if (!k.startsWith("_")) console.log(`${k.padEnd(w)}  ${String(a[k]).padEnd(28)} ${b[k]}`);
