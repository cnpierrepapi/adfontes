import { startLive } from "./live.js";
import { createWeatherSound, weatherKind } from "./sound.js";

const $ = (id) => document.getElementById(id);
const n3 = (x) => (Math.round(x * 1000) / 1000).toString();

function showClan(c, status) {
  const p = $("panel");
  if (!c) { p.hidden = true; return; }
  p.replaceChildren();
  const h = document.createElement("h2"); h.textContent = c.name;
  const m = document.createElement("p"); m.className = "meta";
  m.textContent = `${c.field ?? ""} · ${c.mbti ?? ""} · ${c.gods} god${c.gods === 1 ? "" : "s"}${status === "dead" ? " · ruins" : status === "rich" ? " · rich, so lazy" : status === "neglected" ? " · neglected, a Trickster moved in" : status === "new" ? " · new, waiting for its first day" : ""}`;
  const nums = document.createElement("div"); nums.className = "nums";
  for (const [v, l] of [[c.points, "points on its mindmap"], [n3(c.play), "NEAR to spend"], [c.clean_gifts, "clean gifts"]]) {
    const d = document.createElement("div"); d.textContent = v;
    const s = document.createElement("small"); s.textContent = l; d.append(s); nums.append(d);
  }
  const line = document.createElement("p"); line.className = "line";
  line.textContent = c.line?.length ? `Deepest line: ${c.line.join(" → ")}` : "Nothing learned yet.";
  p.append(h, m, nums, line);
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
setTimeout(() => ($("hint").style.opacity = 0), 9000);
window.__live = live;
window.__sound = sound;
