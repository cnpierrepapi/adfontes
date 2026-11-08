import { startLive } from "./live.js";
import { createWeatherSound, weatherKind } from "./sound.js";
import { switchNet } from "../net.js";
import { createRoute } from "./route.js";
import { playCinematic } from "./intro.js";
import { runTutorial } from "./tutorial.js";

// The cinematic intro starts at once on a first visit and covers the world loading underneath.
const cinema = new URLSearchParams(location.search).has("stills") ? Promise.resolve(false) : playCinematic();

const $ = (id) => document.getElementById(id);
let gods = null; // the god panel, once the wallet code has loaded
const n3 = (x) => (Math.round(x * 1000) / 1000).toString();

function showClan(c, status) {
  const p = $("panel");
  if (!c) { p.hidden = true; return; }
  p.replaceChildren();
  const h = document.createElement("h2"); h.textContent = c.name;
  const m = document.createElement("p"); m.className = "meta";
  m.textContent = `${[c.field, c.mbti, `${c.gods} god${c.gods === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}${status === "dead" ? " · ruins" : status === "rich" ? " · sated, so a bit lazy" : status === "neglected" ? ((c.tricksters || 0) > 0 ? " · neglected, a Trickster moved in" : " · hungry, it needs a blessing") : status === "new" ? " · new, waiting for its first day" : ""}`;
  const nums = document.createElement("div"); nums.className = "nums";
  for (const [v, l] of [[c.points, "points on its mindmap"], [Math.round(c.florins ?? 0), `florins, worth ${n3(c.worth ?? 0)} NEAR`], [c.clean_gifts, "clean gifts"]]) {
    const d = document.createElement("div"); d.textContent = v;
    const s = document.createElement("small"); s.textContent = l; d.append(s); nums.append(d);
  }
  const line = document.createElement("p"); line.className = "line";
  line.textContent = c.line?.length ? `Deepest line: ${c.line.join(" → ")}` : "Nothing learned yet.";
  // Views of this nation: its sky (the fly-in) and its plaza (the closest the camera goes).
  const views = document.createElement("div"); views.className = "views";
  const btn = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "viewbtn"; b.textContent = label; b.addEventListener("click", fn); views.append(b); return b; };
  btn("Sky", () => live.flyTo(c.id));
  btn("Plaza", () => live.viewPlaza(c.id));
  p.append(h, m, nums, line, views);
  if (gods) p.append(gods.section(c, status)); // the god panel: bless, and your powers if you're a god here
  p.hidden = false;
}

// The sky follows the world (SPEC §14): while NEAR's replayed price rises it is day, while it falls
// it is night. ?theme=day|night still overrides (stills). Old worlds with no clock stay at night.
const q = new URLSearchParams(location.search);
const forcedTheme = q.get("theme");
let theme = forcedTheme || "night";
// Filled in below; a poll that lands before then waits for the next one (module-level, no TDZ).
let liveApi = null, sound = null;
document.body.classList.toggle("night", theme === "night");
const live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: showClan, stills: q.has("stills"), theme, onDay: (now) => onDay(now), onPoll: (now) => onClock(now) });
function onClock(now) {
  if (!liveApi || !sound) return;
  const want = forcedTheme || (now.clock?.phase === "day" ? "day" : "night");
  if (want !== theme) { theme = want; liveApi.setTheme(theme); }
  showDial(now);
  sound.setKind(soundKind(now));
}
// Day: birds (a strong rise: hot). Night: wind and rain (a steep fall: a storm).
function soundKind(W) {
  const c = W.clock;
  if (!c) return weatherKind(W.weather?.change);
  return c.phase === "day" ? (c.change > 0.1 ? "hot" : "mild") : c.change < -0.1 ? "storm" : "cold";
}
// The dial says the week in words; the sound plays it (the sky no longer does).
const MOOD_WORD = { hot: "hot", mild: "mild", cold: "cold", storm: "stormy" };
function showDial(W) {
  const c = W.clock;
  if (c) {
    const mood = soundKind(W);
    const pct = `${c.change > 0 ? "+" : ""}${(c.change * 100).toFixed(1)}%`;
    $("dial").className = `dial ${mood === "storm" ? "cold" : mood}`;
    $("dial").textContent = `${W.season} · turn ${W.day} · ${c.phase === "day" ? "☀ day" : "☾ night"} · NEAR $${c.price.toFixed(2)} (${pct})${W.net === "mainnet" ? (W.jackpot ? ` · jackpot ${W.jackpot.near.toFixed(3)} NEAR` : "") : ` · testnet${W.jackpot ? ` · jackpot ${W.jackpot.near.toFixed(3)}` : ""}`}`;
    return;
  }
  const w = W.weather, mood = w ? weatherKind(w.change) : "";
  $("dial").className = `dial ${mood === "storm" ? "cold" : mood}`;
  $("dial").textContent = `${W.season} · turn ${W.day}${w ? ` · ${MOOD_WORD[mood]} week, NEAR $${w.price.toFixed(2)} (${w.change > 0 ? "+" : ""}${(w.change * 100).toFixed(1)}%)` : ""}${W.net === "mainnet" ? (W.jackpot ? ` · jackpot ${W.jackpot.near.toFixed(3)} NEAR` : "") : " · testnet"}`;
}
const W = live.world;
showDial(W);
sound = createWeatherSound({ button: $("sound"), kind: soundKind(W) });
liveApi = live;
if (!forcedTheme && W.clock?.phase === "day") { theme = "day"; live.setTheme(theme); }
function onDay(now) { showDial(now); sound.setKind(soundKind(now)); }
$("home").addEventListener("click", () => live.home());
// Testnet (practice, free test NEAR) or mainnet (real NEAR): same world, same rules.
const netBtn = $("net");
netBtn.innerHTML = W.net === "mainnet" ? `◉ <span class="word">Mainnet</span>` : `○ <span class="word">Testnet</span>`;
netBtn.classList.toggle("main", W.net === "mainnet");
netBtn.addEventListener("click", () => switchNet(W.net === "mainnet" ? "testnet" : "mainnet"));
setTimeout(() => ($("hint").style.opacity = 0), 9000);
// A short line at the bottom for wallet news (a refused connection, nothing to smite).
function toast(text) {
  const t = Object.assign(document.createElement("p"), { className: "toast", textContent: text });
  $("visor").append(t);
  setTimeout(() => t.remove(), 6000);
}
// The gods' wallet loads after the world is up, so a slow wallet script never holds the world back.
// The god's route and the first-visit intro (SPEC §12n).
const route = createRoute({ live, W, account: () => window.__gods?.wallet.account() ?? null });
// After the intro (or straight away for a returning visitor): the world, then the tutorial once.
if (!q.has("stills")) cinema.then((played) => { if (played) live.home(); setTimeout(() => runTutorial(), played ? 900 : 1500); });
import("./gods.js").then(({ createGods }) => createGods({ live, W, nav: document.querySelector(".hud-top nav"), toast, route, replayIntro: () => playCinematic({ force: true }).then(() => { live.home(); runTutorial({ force: true }); }) })).then((g) => {
  gods = g;
  window.__gods = g;
  // A god coming back starts on their own nation with its panel open (his call 8 Nov), once the
  // intro is over and unless the tutorial is still running or a link asked for somewhere else.
  if (!q.has("stills") && !location.hash && localStorage.getItem("adf-tutorial-done"))
    cinema.then(() => g.myNations()).then((ids) => { if (ids.length) setTimeout(() => live.flyTo(ids[0]), 1200); }).catch(() => {});
  // A panel already open gets its powers now.
  const open = !$("panel").hidden && W.clans.find((c) => c.name === $("panel").querySelector("h2")?.textContent);
  if (open) $("panel").append(g.section(open, open.alive === false ? "dead" : ""));
}).catch((e) => console.warn("wallet unavailable", e));
window.__live = live;
window.__sound = sound;
