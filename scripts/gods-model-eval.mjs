// Sonnet vs Haiku as the AI gods' planner (his ask 13 Nov): same live situation, same prompt, N plans each.
// Measures cost per plan from the real token counts, and quality on what recovery needs:
//   kept (actions that pass the checks), coverage (gods with a plan), first move on the most fallen nation,
//   hungry nations fed, waiting gifts ruled, variety, and whispers as the LIVE judge hears them (hearWhisper,
//   the same Claude call the game uses: delta -15..+25). Real Claude calls (~$0.15 for N=3). Never touches testnet.
//   node scripts/gods-model-eval.mjs [N=3]
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const N = Number(process.argv[2]) || 3, DIR = "debug/eval-gods";
fs.rmSync(DIR, { recursive: true, force: true });
const seed = spawnSync(process.execPath, ["scripts/sim-seed.mjs", DIR], { encoding: "utf8" });
if (seed.status !== 0) { console.log(seed.stdout, seed.stderr); process.exit(1); }
Object.assign(process.env, { ADF_SIM_CHAIN: `${DIR}/chain.json`, ADF_STATE_DIR: `${DIR}/state`, DATABASE_URL: "", ADF_DAILY_CAP: "50" });
delete process.env.ADF_FAKE_LLM;
const store = await import("../engine/store.mjs");
const A = await import("../engine/aigods.mjs");
const { NAMES } = await import("../engine/godnames.mjs");
const { situations, temperamentOf } = await import("../engine/aiact.mjs");
const L = await import("../engine/llm.mjs");
const { connectSim } = await import("../engine/chain-sim.mjs");

// The copy's AI gods: the live accounts named <god>.adfontes-mw1fjpfx.testnet.
const chain = connectSim(`${DIR}/chain.json`), onchain = await chain.clans();
const byAcct = new Map(NAMES.map((n) => [A.accountFor(n, "adfontes-mw1fjpfx.testnet"), n]));
for (const c of onchain) for (const g of c.gods || []) if (byAcct.has(g.account)) await store.addAiGod("testnet", g.account, byAcct.get(g.account), temperamentOf(byAcct.get(g.account)));
const s = JSON.parse(fs.readFileSync(`${DIR}/state/testnet.json`, "utf8"));
// The live copy may be calm (no hunger, gifts or reports right now); plant the troubles recovery is about, in
// this in-memory copy only: 4 hungry nations (2 with Tricksters), 3 waiting gifts, 2 reports.
const aiClans = onchain.filter((c) => c.alive && (c.gods || []).some((g) => byAcct.has(g.account))).map((c) => c.id);
aiClans.slice(0, 4).forEach((id, i) => { Object.assign(s.clans[id], { mood: "hungry", need: 0.4, blessings: [], tricksters: i < 2 ? 2 : 0 }); });
s.gifts ||= {}; s.reports ||= {};
aiClans.slice(1, 4).forEach((id, i) => { s.gifts[9001 + i] = { clan: id, draft: null, day: s.day, at: Date.now(), applied: false }; });
aiClans.slice(0, 2).forEach((id, i) => { s.reports[`r99-${i}`] = { id: `r99-${i}`, clan: id, accuser: "Ada Moss", accused: "Ivo Kane", claim: "Ada Moss says Ivo Kane is a Trickster who cites papers that don't exist", day: s.day }; });
const sits = await situations({ net: "testnet", s, onchain });
console.log(`${sits.length} AI gods, ${sits.reduce((a, x) => a + x.nations.length, 0)} seats; hungry nations: ${new Set(sits.flatMap((x) => x.nations.filter((n) => n.mood === "hungry").map((n) => n.id))).size}; waiting gifts: ${sits.reduce((a, x) => a + Object.values(x.gifts).flat().length, 0)}; open reports: ${sits.reduce((a, x) => a + Object.values(x.reports).flat().length, 0)}`);

// What a nation's citizens see when they judge a whisper (as engine/run.mjs builds it, from the copy).
const nameOf = (id) => onchain.find((c) => c.id === id)?.name ?? `nation ${id}`;
function hearIt(clanId, text) {
  const c = s.clans[clanId], war = Object.values(s.wars || {}).find((w) => w.status === "on" && (w.a === clanId || w.b === clanId));
  const foe = war ? (war.a === clanId ? war.b : war.a) : null, frontier = Object.keys(c.frontier || {}).slice(0, 5);
  const situation = [war ? `At war with ${nameOf(foe)}.` : "", `Mood: ${c.mood ?? "unknown"}.`, (c.tricksters || 0) ? `${c.tricksters} Trickster(s) have moved in and slip fakes into the research.` : "No Tricksters among them.", `The scholars are looking at: ${frontier.join(", ") || "nothing new"}.`].filter(Boolean).join("\n");
  const keywords = [foe != null ? nameOf(foe) : null, war ? "war" : null, war ? "walls" : null, c.mood === "hungry" ? "hungry" : null, (c.tricksters || 0) ? "trickster" : null, ...frontier];
  return L.hearWhisper({ name: nameOf(clanId), field: c.field, temperament: c.mbti, situation, keywords, citizens: ["a citizen"], text });
}

const MODELS = [["Sonnet 5.5", "claude-sonnet-5-5"], ["Haiku 5.5", "claude-haiku-5-5"]];
const results = {};
for (const [label, model] of MODELS) {
  const runs = [];
  for (let i = 0; i < N; i++) {
    const usd0 = L.meter.usd, t0 = Date.now();
    let plans;
    try { plans = await L.godsPlan(sits, A.fakePlan, model); } catch (e) { runs.push({ error: String(e.message || e).slice(0, 120) }); continue; }
    const cost = L.meter.usd - usd0, secs = (Date.now() - t0) / 1000;
    let proposed = 0, kept = 0, firstOnWorst = 0, gods = 0, fed = 0, hungry = 0, ruled = 0, gifts = 0, overSpend = 0;
    const kinds = {}, whispers = [];
    for (const sit of sits) {
      const raw = plans[sit.god] || [];
      proposed += raw.length;
      const v = A.validatePlan(raw, sit);
      kept += v.length;
      if (v.length) gods++;
      const worst = A.recoveryOrder(sit.nations)[0]?.id;
      if (v[0] && v[0].clan === worst) firstOnWorst++;
      for (const a of v) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
      for (const n of sit.nations.filter((x) => x.mood === "hungry")) { hungry++; if (v.some((a) => a.kind === "bless" && a.clan === n.id)) fed++; }
      for (const g of Object.values(sit.gifts).flat()) { gifts++; if (v.some((a) => a.kind === "rule" && a.gift === g.id)) ruled++; }
      if (raw.filter((a) => a.kind === "bless").reduce((x, a) => x + (Number(a.near) || 0), 0) > sit.allowance + 1e-9) overSpend++;
      for (const a of v.filter((x) => x.kind === "whisper")) whispers.push(a);
    }
    // The live judge on every whisper this plan would send.
    const usd1 = L.meter.usd;
    const heard = [];
    for (const w of whispers) { try { heard.push(await hearIt(w.clan, w.text)); } catch { /* skip */ } }
    const judgeCost = L.meter.usd - usd1;
    runs.push({ cost, secs, proposed, kept, gods, firstOnWorst, hungry, fed, gifts, ruled, overSpend, kinds, whispers: whispers.length, heardAvg: heard.length ? heard.reduce((a, h) => a + (Number(h.delta) || 0), 0) / heard.length : null, verdicts: heard.map((h) => h.verdict), sample: whispers.slice(0, 2).map((w) => w.text), judgeCost });
    console.log(`${label} run ${i + 1}: $${cost.toFixed(4)} ${secs.toFixed(0)}s, kept ${kept}/${proposed}, whispers heard avg ${runs.at(-1).heardAvg?.toFixed(1)}`);
  }
  results[label] = runs;
}
fs.writeFileSync(`${DIR}/results.json`, JSON.stringify({ sits: sits.length, results }, null, 1));
const avg = (rs, f) => { const v = rs.filter((r) => !r.error).map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
console.log("\n| | " + MODELS.map(([l]) => l).join(" | ") + " |");
const row = (name, f, fmt = (x) => x?.toFixed(2)) => console.log(`| ${name} | ${MODELS.map(([l]) => fmt(avg(results[l], f))).join(" | ")} |`);
row("cost per plan ($)", (r) => r.cost, (x) => `$${x?.toFixed(4)}`);
row("seconds per plan", (r) => r.secs, (x) => x?.toFixed(0));
row("actions kept of proposed (%)", (r) => (100 * r.kept) / Math.max(1, r.proposed), (x) => `${x?.toFixed(0)}%`);
row("actions per god", (r) => r.kept / sits.length);
row("gods with a plan (%)", (r) => (100 * r.gods) / sits.length, (x) => `${x?.toFixed(0)}%`);
row("first move on its most fallen nation (%)", (r) => (100 * r.firstOnWorst) / sits.length, (x) => `${x?.toFixed(0)}%`);
row("hungry nations fed (%)", (r) => (r.hungry ? (100 * r.fed) / r.hungry : null), (x) => (x == null ? "-" : `${x.toFixed(0)}%`));
row("waiting gifts ruled (%)", (r) => (r.gifts ? (100 * r.ruled) / r.gifts : null), (x) => (x == null ? "-" : `${x.toFixed(0)}%`));
row("gods proposing over their allowance", (r) => r.overSpend, (x) => x?.toFixed(1));
row("whispers heard, average reverence change", (r) => r.heardAvg, (x) => (x == null ? "-" : (x >= 0 ? "+" : "") + x.toFixed(1)));
console.log("\nverdicts:", MODELS.map(([l]) => `${l}: ${JSON.stringify(results[l].flatMap((r) => r.verdicts || []).reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {}))}`).join(" | "));
for (const [l] of MODELS) console.log(`\n${l} sample whispers:\n  - ${results[l].flatMap((r) => r.sample || []).slice(0, 3).join("\n  - ")}`);
console.log(`\neval spend: $${L.meter.usd.toFixed(4)}`);
await store.close();
