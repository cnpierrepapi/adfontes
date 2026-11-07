import { startLive } from "./live.js";
import { createWeatherSound, weatherKind } from "./sound.js";
import { switchNet } from "../net.js";

const $ = (id) => document.getElementById(id);
let gods = null; // the god panel, once the wallet code has loaded
const n3 = (x) => (Math.round(x * 1000) / 1000).toString();

function showClan(c, status) {
  const p = $("panel");
  if (!c) { p.hidden = true; return; }
  p.replaceChildren();
  const h = document.createElement("h2"); h.textContent = c.name;
  const m = document.createElement("p"); m.className = "meta";
  m.textContent = `${[c.field, c.mbti, `${c.gods} god${c.gods === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}${status === "dead" ? " · ruins" : status === "rich" ? " · rich, so lazy" : status === "neglected" ? " · neglected, a Trickster moved in" : status === "new" ? " · new, waiting for its first day" : ""}`;
  const nums = document.createElement("div"); nums.className = "nums";
  for (const [v, l] of [[c.points, "points on its mindmap"], [n3(c.play), "NEAR to spend"], [c.clean_gifts, "clean gifts"]]) {
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

// Night by default; the choice is remembered on this device. ?theme=day|night overrides (stills).
const q = new URLSearchParams(location.search);
let theme = q.get("theme") || localStorage.getItem("adf-theme") || "night";
document.body.classList.toggle("night", theme === "night");
const live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: showClan, stills: q.has("stills"), theme, onDay: (now) => onDay(now) });
const themeBtn = $("theme");
const showTheme = () => (themeBtn.innerHTML = theme === "night" ? `☀ <span class="word">Day</span>` : `☾ <span class="word">Night</span>`);
showTheme();
themeBtn.addEventListener("click", () => {
  theme = theme === "night" ? "day" : "night";
  localStorage.setItem("adf-theme", theme);
  live.setTheme(theme);
  showTheme();
});
// The dial says the week in words; the sound plays it (the sky no longer does).
const MOOD_WORD = { hot: "hot", mild: "mild", cold: "cold", storm: "stormy" };
function showDial(W) {
  const w = W.weather, mood = w ? weatherKind(w.change) : "";
  $("dial").className = `dial ${mood === "storm" ? "cold" : mood}`;
  $("dial").textContent = `${W.season} · day ${W.day}${w ? ` · ${MOOD_WORD[mood]} week, NEAR $${w.price.toFixed(2)} (${w.change > 0 ? "+" : ""}${(w.change * 100).toFixed(1)}%)` : ""}${W.net === "mainnet" ? "" : " · testnet"}`;
}
const W = live.world;
showDial(W);
const sound = createWeatherSound({ button: $("sound"), kind: weatherKind(W.weather?.change) });
function onDay(now) { showDial(now); sound.setKind(weatherKind(now.weather?.change)); }
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
import("./gods.js").then(({ createGods }) => createGods({ live, W, nav: document.querySelector(".hud-top nav"), toast })).then((g) => {
  gods = g;
  window.__gods = g;
  // A panel already open gets its powers now.
  const open = !$("panel").hidden && W.clans.find((c) => c.name === $("panel").querySelector("h2")?.textContent);
  if (open) $("panel").append(g.section(open, open.alive === false ? "dead" : ""));
}).catch((e) => console.warn("wallet unavailable", e));
window.__live = live;
window.__sound = sound;
