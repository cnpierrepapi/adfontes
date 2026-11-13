import { startLive } from "./live.js";
import { createWeatherSound, weatherKind } from "./sound.js";
import { switchNet, MAINNET_OPEN } from "../net.js";
import { chosen, KEY } from "./quality.js";
import { endedName } from "../says.js";
import { createRoute } from "./route.js";
import { playCinematic } from "./intro.js";
import { runTutorial } from "./tutorial.js";
import { panelWords } from "./status.js";
import { playTimelapse, offerTimelapse } from "./timelapse.js";
import { seasonLabel } from "../season.js";
import { panelSig } from "./panelsig.js";

// The cinematic intro starts at once on a first visit and covers the world loading underneath.
const cinema = new URLSearchParams(location.search).has("stills") ? Promise.resolve(false) : playCinematic();

const $ = (id) => document.getElementById(id);
let gods = null; // the god panel, once the wallet code has loaded
let openPanel = null; // { id, sig } of the nation panel on screen (13 Nov: it follows its nation)
const n3 = (x) => (Math.round(x * 1000) / 1000).toString();

function showClan(c, status) {
  const p = $("panel");
  if (!c) { p.hidden = true; openPanel = null; phoneSheet(); return; }
  openPanel = { id: c.id, sig: panelSig(c) };
  window.__live?.feed?.setFocus(c.id); // a visitor hears the citizens of the nation they're looking at
  p.replaceChildren();
  const h = document.createElement("h2"); h.textContent = c.name;
  const m = document.createElement("p"); m.className = "meta";
  m.textContent = `${[c.field, c.mbti, `${c.gods} god${c.gods === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}${panelWords(c, status)}`;
  const nums = document.createElement("div"); nums.className = "nums";
  for (const [v, l] of [[c.points, "points on its mindmap"], [Math.round(c.florins ?? 0), `florins, worth ${n3(c.worth ?? 0)} grace`], [c.clean_gifts, "clean gifts"]]) {
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
  // War (the finale): who it's fighting and how both islands are holding up; or how it fell.
  const war = document.createElement("p"); war.className = "warline";
  const nm = (id) => W.clans.find((k) => k.id === id)?.name ?? endedName(id) ?? `nation ${id}`;
  if (c.fallen) war.textContent = `Fallen in war to ${nm(c.fallen.by)} on turn ${c.fallen.day}.`;
  else if (c.war?.enemy) war.textContent = `At war with ${nm(c.war.enemy)} · round ${c.war.rounds} · island ${c.war.hp} vs ${c.war.enemyHp} · walls ${c.war.walls}${c.war.offer ? (c.war.offer === c.id ? " · offered peace" : " · peace on offer") : ""}`;
  else if (c.war && !c.war.fairGame) war.textContent = "Safe from war until its first patent passes.";
  // Its named account (9 Nov): anything sent there goes on to the nation's treasury, its DAO.
  const named = document.createElement("p"); named.className = "named";
  // (Its named account, a NEAR address, isn't shown: the game reads web2, 12 Nov. /judge lists it.)
  // What its DAO holds as NEP-245 tokens: research copies, patents (one of a kind), figure kits.
  if (c.tokens && (c.tokens.research || c.tokens.patents || c.tokens.kits)) {
    const t = c.tokens, pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    named.append(...(named.childNodes.length ? [document.createElement("br")] : []), `Its Broker holds ${pl(t.research, "piece")} of research, ${pl(t.patents, "patent")} and ${pl(t.kits, "kit")}, to trade.`);
  }
  // Phones (his note 11 Nov: the panel hid the world): the sheet opens short and a grab bar expands it.
  p.classList.remove("full");
  const grip = document.createElement("button"); grip.type = "button"; grip.className = "sheetgrip"; grip.setAttribute("aria-label", "Show more or less");
  grip.addEventListener("click", () => { p.classList.toggle("full"); p.scrollTop = 0; });
  p.append(grip, h, m, nums, ...(war.textContent ? [war] : []), line, ...(named.childNodes.length ? [named] : []), views);
  if (gods) p.append(gods.section(c, status)); // the god panel: bless, and your powers if you're a god here
  p.hidden = false;
  phoneSheet();
}
// Phones: the panel is a bottom sheet; the world slides up so the nation stays in view above it.
const phone = () => innerWidth <= 700;
function phoneSheet() {
  const p = $("panel"), open = !p.hidden;
  document.body.classList.toggle("panel-open", open);
  try { live.setViewShift(open && phone() ? Math.min(p.offsetHeight, innerHeight * 0.55) / 2 : 0); } catch { /* the world isn't up yet */ }
}
new ResizeObserver(() => phoneSheet()).observe(document.getElementById("panel"));
addEventListener("resize", () => phoneSheet());

// The sky follows the world (SPEC §14): while NEAR's replayed price rises it is day, while it falls
// it is night. ?theme=day|night still overrides (stills). Old worlds with no clock stay at night.
const q = new URLSearchParams(location.search);
const forcedTheme = q.get("theme");
let theme = forcedTheme || "night";
// Filled in below; a poll that lands before then waits for the next one (module-level, no TDZ).
let liveApi = null, sound = null;
document.body.classList.toggle("night", theme === "night");
const live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: showClan, stills: q.has("stills"), theme, onDay: (now) => onDay(now), onPoll: (now) => { onClock(now); redrawPanel(false); }, onLive: (recs) => panelHeard(recs) });
// The open panel follows its nation (13 Nov, his note: after he acted nothing on it changed). It redraws when
// what it shows changes (panelSig, after each world poll), and a little after that nation's live records arrive
// (its god section reads reverence and reports fresh), at most every 10 s. Never while you type in it.
function redrawPanel(force) {
  const p = $("panel");
  if (!openPanel || p.hidden) return;
  const a = document.activeElement;
  if (a && p.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const isl = live.islands.get(openPanel.id);
  if (!isl) return;
  const c = isl.userData.clan;
  if (!force && panelSig(c) === openPanel.sig) return;
  const top = p.scrollTop, full = p.classList.contains("full");
  showClan(c, isl.userData.status);
  if (full) p.classList.add("full");
  p.scrollTop = top;
}
let panelTimer = null, panelLast = 0;
function panelHeard(recs) {
  if (!openPanel) return;
  const id = openPanel.id;
  const about = (r) => [r.clan, r.a, r.b, r.attacker, r.defender, r.buyer, r.seller, ...Object.keys(r.sides || {})].some((x) => x != null && Number(x) === id);
  if (!recs.some(about) || panelTimer) return;
  const wait = Math.max(2500, panelLast + 10_000 - Date.now());
  panelTimer = setTimeout(() => { panelTimer = null; panelLast = Date.now(); redrawPanel(true); }, wait);
}
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
    $("dial").className = `dial ${mood === "storm" ? "cold" : mood}`;
    if (phone()) { $("dial").textContent = `turn ${W.day} · ${c.phase === "day" ? "☀ day" : "☾ night"}`; return; } // one short line on phones
    $("dial").textContent = `${seasonLabel()} · turn ${W.day} · ${c.phase === "day" ? "☀ day" : "☾ night"}${W.jackpot ? ` · jackpot ${W.jackpot.near.toFixed(3)} grace` : ""}`;
    return;
  }
  const w = W.weather, mood = w ? weatherKind(w.change) : "";
  $("dial").className = `dial ${mood === "storm" ? "cold" : mood}`;
  $("dial").textContent = `${seasonLabel()} · turn ${W.day}${w ? ` · ${MOOD_WORD[mood]} week` : ""}${W.jackpot ? ` · jackpot ${W.jackpot.near.toFixed(3)} grace` : ""}`;
}
const W = live.world;
showDial(W);
sound = createWeatherSound({ button: $("sound"), kind: soundKind(W) });
liveApi = live;
if (!forcedTheme && W.clock?.phase === "day") { theme = "day"; live.setTheme(theme); }
function onDay(now) { showDial(now); sound.setKind(soundKind(now)); }
$("home").addEventListener("click", () => live.home());
// The network switch (testnet / mainnet) is hidden: the game reads web2 (12 Nov) and mainnet is closed.
// switchNet + MAINNET_OPEN (src/net.js) stay for when it opens.
$("net").hidden = true;
// Graphics (12 Nov, src/live/quality.js): Auto, Low, High. A change reloads the page (smoothing is set when the
// 3D view starts). Auto shows what it picked.
{
  const q = $("quality"), word = q.querySelector(".word");
  const show = () => { const c = chosen(), now = live.quality?.().tier; word.textContent = c === "auto" ? "Auto" : c === "low" ? "Low" : "High"; q.title = c === "auto" ? `Graphics: auto, running ${now ?? "…"} for this machine. Tap for Low.` : `Graphics: ${c}. Tap for ${c === "low" ? "High" : "Auto"}.`; };
  show(); setInterval(show, 5000);
  q.addEventListener("click", () => { const next = { auto: "low", low: "high", high: "auto" }[chosen()]; try { localStorage.setItem(KEY, next); } catch {} toast(`Graphics: ${next === "auto" ? "Auto" : next === "low" ? "Low" : "High"}. Reloading…`); setTimeout(() => location.reload(), 600); });
}
setTimeout(() => ($("hint").style.opacity = 0), 9000);
// A short line at the bottom for wallet news (a refused connection, nothing to smite).
function toast(text) {
  // One notice at a time: a new one replaces the last (two used to print on top of each other).
  for (const old of document.querySelectorAll(".toast")) old.remove();
  const t = Object.assign(document.createElement("p"), { className: "toast", textContent: text });
  $("visor").append(t);
  setTimeout(() => t.remove(), 6000);
}
// The gods' wallet loads after the world is up, so a slow wallet script never holds the world back.
// The god's route and the first-visit intro (SPEC §12n).
const route = createRoute({ live, W, account: () => window.__gods?.wallet.account() ?? null });
// After the intro (or straight away for a returning visitor): the world, then the tutorial once.
// The sandbox (/timelapse/, his call 11 Nov; it replaced the season film): offered straight after the intro, before the tutorial;
// ?timelapse plays it at once (the judge page links there); a HUD button plays it any time.
if (!q.has("stills")) cinema.then(async (played) => {
  if (played) live.home();
  if (q.has("timelapse")) await playTimelapse(live);
  else if (played) await offerTimelapse(live);
  setTimeout(() => runTutorial(), played ? 900 : 1500);
});
{
  const b = Object.assign(document.createElement("button"), { type: "button", className: "chip season", title: "Shock a copy of this world and fast-forward it" });
  b.innerHTML = '🔥 <span class="word">Sandbox</span>';
  b.addEventListener("click", () => playTimelapse(live));
  document.querySelector(".hud-top nav")?.prepend(b, " ");
}
import("./gods.js").then(({ createGods }) => createGods({ live, W, nav: document.querySelector(".hud-top nav"), toast, route, replayIntro: () => playCinematic({ force: true }).then(() => { live.home(); runTutorial({ force: true }); }) })).then((g) => {
  gods = g;
  window.__gods = g;
  live.feed?.setGods(g); // the feed's buttons open the god's cards; its "yours" means your nations
  // A god coming back starts in their own nation's plaza with its panel open (his call 8 Nov), once the
  // intro is over and unless the tutorial is still running or a link asked for somewhere else.
  if (!q.has("stills") && !location.hash && localStorage.getItem("adf-tutorial-done"))
    cinema.then(() => g.myNations()).then((ids) => {
      if (!ids.length) return;
      // Down in its plaza among the citizens (his call 8 Nov), with the nation's panel open.
      setTimeout(() => { const isl = live.islands.get(ids[0]); if (!isl) return; live.viewPlaza(ids[0]); showClan(isl.userData.clan, isl.userData.status); }, 1200);
    }).catch(() => {});
  // A panel already open gets its powers now.
  const open = !$("panel").hidden && W.clans.find((c) => c.name === $("panel").querySelector("h2")?.textContent);
  if (open) $("panel").append(g.section(open, open.alive === false ? "dead" : ""));
}).catch((e) => console.warn("wallet unavailable", e));
window.__live = live;
window.__sound = sound;
