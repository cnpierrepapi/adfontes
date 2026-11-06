import { startLive } from "./live.js";

const $ = (id) => document.getElementById(id);
const n3 = (x) => (Math.round(x * 1000) / 1000).toString();

function showClan(c, status) {
  const p = $("panel");
  if (!c) { p.hidden = true; return; }
  p.replaceChildren();
  const h = document.createElement("h2"); h.textContent = c.name;
  const m = document.createElement("p"); m.className = "meta";
  m.textContent = `${c.field ?? ""} · ${c.mbti ?? ""} · ${c.gods} god${c.gods === 1 ? "" : "s"}${status === "dead" ? " · ruins" : status === "rich" ? " · rich, so lazy" : status === "neglected" ? " · neglected" : ""}`;
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

const live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: showClan, stills: new URLSearchParams(location.search).has("stills") });
const W = live.world, w = W.weather;
const mood = !w ? "" : w.change > 0.1 ? "hot" : w.change < -0.05 ? "cold" : "mild";
$("dial").className = `dial ${mood}`;
$("dial").textContent = `${W.season} · day ${W.day}${w ? ` · ${mood} week, NEAR $${w.price.toFixed(2)} (${w.change > 0 ? "+" : ""}${(w.change * 100).toFixed(1)}%)` : ""}${W.net === "mainnet" ? "" : " · testnet"}`;
$("home").addEventListener("click", () => live.home());
setTimeout(() => ($("hint").style.opacity = 0), 9000);
window.__live = live;
