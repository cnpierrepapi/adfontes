// The season world (/timelapse/, his calls 9 Nov): the whole season in its own 3D world, from the
// first nation to the end of the god simulation. It runs the live world's own 3D code on the season
// data (src/season/source.js), one turn at a time: islands rise when nations are founded, skies grow
// as they learn, wars put crews on the war machines and fire the weapons that were really used, a
// fallen nation turns to ruins. Turns 1 to 15 are the real season; after that it's the simulation, and
// the turn chip says which. Pause on any turn and every nation's panel shows where it stood then.
import { loadSeason } from "./source.js";
import { makeCut } from "./cut.js";
import { says } from "../says.js";
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const n2 = (x) => (Math.round(x * 100) / 100).toString();
const q = new URLSearchParams(location.search);

const season = await loadSeason();
const S = season.S;
const startAt = Math.max(1, Math.min(S.last, Number(q.get("turn")) || 1));
season.turn = startAt;
globalThis.__adfApi = season.api; // the live world's code now reads the season, not the live API

// The cut, warmed up through the turns before the start (so "firsts" stay firsts after a jump).
const cut = makeCut();
for (let d = 1; d < startAt; d++) cut(season.records(d));

const { startLive } = await import("../live/live.js");
const live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: showClan, theme: "night", cut, noReplay: true });
live.fx.paused = true; // nothing plays until you press Play

// ---- playing ----
let playing = false, speed = Number(localStorage.getItem("adf-season-speed")) || 1, nextAt = 0, stepping = false;
const lastPoints = new Map();
function setSpeed(s) {
  speed = s;
  localStorage.setItem("adf-season-speed", String(s));
  live.fx.gap = 800 / s;
  for (const b of $("speed").querySelectorAll("button")) b.classList.toggle("on", Number(b.dataset.s) === s);
}
function setPlaying(on) {
  playing = on && season.turn < S.last;
  live.fx.paused = !playing;
  $("play").textContent = playing ? "❚❚" : "▶";
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  document.body.classList.toggle("ss-paused", !playing);
}
async function step() {
  if (stepping || season.turn >= S.last) return;
  stepping = true;
  try {
    season.turn += 1;
    const now = await live.poll();
    // Skies follow the true mind maps every turn, even when the record that changed them didn't make the cut.
    for (const c of now?.clans || []) if (lastPoints.get(c.id) !== c.points) { lastPoints.set(c.id, c.points); live.loadMind(c.id); }
    showTurn();
    if ($("panel").hidden === false && shown != null) showClan({ id: shown });
    if (!$("allbox").hidden) showAll();
    if (season.turn >= S.last) { setPlaying(false); setTimeout(() => { const cap = $("cap"); cap.textContent = `That's the season to turn ${S.last}. The real world is still going: open the live world to see where it stands now.`; cap.classList.add("in"); }, 2500 / speed); }
  } finally { stepping = false; }
}
function loop() {
  const t = performance.now();
  if (playing && !stepping && !live.fx.paused && live.fx.pending() === 0 && t >= nextAt) {
    step();
    // A quiet turn ticks by fast; a busy one waits for its moments to play; a turn at war lingers so
    // you can watch the crews fire between rounds.
    nextAt = t + (season.world(season.turn).wars.length ? 500 : 220) / speed;
  }
  requestAnimationFrame(loop);
}

// ---- what you see: the turn, the dial, captions ----
function showTurn() {
  const d = season.turn, sim = season.isSim(d), W = season.world(d), c = W.clock;
  $("turn").textContent = `Turn ${d} · ${sim ? "simulated" : "real"}`;
  $("turn").classList.toggle("sim", sim);
  $("scrub").value = String(d);
  $("dial").textContent = `${S.season} · turn ${d} of ${S.last}${c ? ` · ${c.phase === "day" ? "☀ day" : "☾ night"} · NEAR $${c.price.toFixed(2)}` : ""} · ${sim ? "simulated" : "real, sealed on NEAR"}`;
  $("dial").className = `dial ${sim ? "sim" : ""}`;
}
let capTimer = null;
live.onRecord((r) => {
  const cap = $("cap");
  cap.textContent = r.text ?? (says(r, season.nameOf) || "");
  direct(r);
  hold(r);
  cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
  clearTimeout(capTimer);
  capTimer = setTimeout(() => cap.classList.remove("in"), 4200 / speed + 800);
});

// ---- big moments hold the screen a little longer (the queue waits; so does the next turn) ----
const HOLD = { fallen: 5200, war: 2600, peace: 2600, founded: 2400, "peace-offer": 2000 };
let holdTimer = null;
function hold(r) {
  const ms = HOLD[r.kind];
  if (!ms || !playing) return;
  live.fx.paused = true;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { if (playing) live.fx.paused = false; }, ms / speed);
}

// ---- the camera: it follows the big moments (drag the world yourself and it stops; Follow brings it back) ----
let follow = true, shotN = 0;
const C = live.controls;
const posOf = (id) => live.islands.get(Number(id))?.getWorldPosition(new THREE.Vector3());
const rOf = (id) => live.islands.get(Number(id))?.userData.r ?? 3;
const far = () => Math.max(1, Math.pow(innerHeight / innerWidth, 0.8)); // a tall phone screen: pull back
function look(pos, target) { const k = far(); C.setLookAt(target[0] + (pos[0] - target[0]) * k, target[1] + (pos[1] - target[1]) * k, target[2] + (pos[2] - target[2]) * k, ...target, true); }
function orbit(id, a) { const p = posOf(id), r = rOf(id); if (p) look([p.x + Math.cos(a) * r * 2.8, p.y + r * 1.4, p.z + Math.sin(a) * r * 2.8], [p.x, p.y + 0.3, p.z]); }
function pair(a, b, s = 1) {
  const A = posOf(a), B = posOf(b);
  if (!A || !B) return orbit(a ?? b, 0);
  const m = A.clone().lerp(B, 0.5), d = A.distanceTo(B), n = new THREE.Vector3(B.z - A.z, 0, A.x - B.x).normalize();
  look([m.x + n.x * d * 0.85 * s, m.y + d * 0.5, m.z + n.z * d * 0.85 * s], [m.x, m.y, m.z]);
}
function direct(r) {
  if (!follow) return;
  const a = ++shotN * 1.7, s = shotN % 2 ? 1 : -1;
  switch (r.kind) {
    case "founded": setTimeout(() => follow && orbit(r.clan, a), 300); break;
    case "war": pair(r.attacker, r.defender, s); break;
    case "battle": { const ids = Object.keys(r.sides).map(Number); pair(ids[0], ids[1], s); break; }
    case "peace": pair(r.a, r.b, s); break;
    case "peace-offer": orbit(r.clan, a); break;
    case "fallen": pair(r.clan, r.by, s); break;
    case "gift": case "trickster": case "fortify": orbit(r.clan, a); break;
    case "bless": if (r.mode === "rescue") orbit(r.clan, a); break;
    default: break;
  }
}
const followBtn = $("follow");
const setFollow = (on) => { follow = on; followBtn.classList.toggle("on", on); followBtn.title = on ? "The camera follows the big moments. Click to stop." : "Click to let the camera follow the big moments again."; };
followBtn.addEventListener("click", () => { setFollow(!follow); if (follow) live.home(); });
$("world").addEventListener("pointerdown", () => setFollow(false));
$("world").addEventListener("wheel", () => setFollow(false), { passive: true });
setFollow(true);

// ---- the timeline: scrub to any turn (the world is rebuilt as it stood then) ----
$("scrub").max = String(S.last);
const MARK = { founded: "found", war: "war", peace: "peace", fallen: "fall" };
for (const t of S.turns) for (const r of t.records) if (MARK[r.kind]) {
  const m = el("i", { className: `m ${MARK[r.kind]}`, title: `Turn ${t.day}: ${says(r, season.nameOf)}` });
  m.style.left = `${((t.day - 1) / (S.last - 1)) * 100}%`;
  $("marks").append(m);
}
{ const r = el("i", { className: "m realend", title: `Turns 1 to ${S.real_to} really happened; after that, the simulation` }); r.style.left = `${((S.real_to - 0.5) / (S.last - 1)) * 100}%`; $("marks").append(r); }
$("scrub").addEventListener("change", () => {
  const d = Number($("scrub").value);
  if (d === season.turn) return;
  const u = new URL(location.href);
  u.searchParams.set("turn", String(d));
  u.searchParams.set("play", playing ? "1" : "0");
  location.replace(u.toString());
});
$("play").addEventListener("click", () => setPlaying(!playing));
for (const b of $("speed").querySelectorAll("button")) b.addEventListener("click", () => setSpeed(Number(b.dataset.s)));
$("home").addEventListener("click", () => live.home());
addEventListener("keydown", (e) => { if (e.key === " " && e.target === document.body) { e.preventDefault(); setPlaying(!playing); } });

// ---- a nation, as it stood on this turn ----
let shown = null;
function showClan(c) {
  const p = $("panel");
  if (!c) { p.hidden = true; shown = null; return; }
  const d = season.turn, x = season.clanAt(c.id, d);
  if (!x) { p.hidden = true; return; }
  shown = c.id;
  const sim = season.isSim(d);
  const rows = [
    [x.points, "points of knowledge"],
    [x.florins != null ? Math.round(x.florins) : "not recorded", x.florins != null ? "florins" : "florins (the engine started printing them on turn 15)"],
    [x.total_in != null ? n2(x.total_in) : "not recorded", "NEAR its gods put in"],
    [x.clean_gifts, x.clean_gifts === 1 ? "patent" : "patents"],
  ];
  const war = x.fallen ? `Fallen in war to ${season.nameOf(x.fallen.by)} on turn ${x.fallen.day}.`
    : x.war?.enemy ? `At war with ${season.nameOf(x.war.enemy)} · round ${x.war.rounds} · ${x.war.hp} vs ${x.war.enemyHp} points left · walls ${x.walls}${x.war.offer ? (x.war.offer === x.id ? " · offered peace" : " · peace on offer") : ""}`
    : x.walls ? `At peace · walls ${x.walls}` : "At peace.";
  const TECH = { press: "Printing Press", spectacles: "Spectacles", clock: "Mechanical Clock", bookkeeping: "Bookkeeping", astrolabe: "Astrolabe" };
  p.replaceChildren(
    el("p", { className: `ss-chip ${sim ? "sim" : ""}`, textContent: `Turn ${d} · ${sim ? "simulated" : "real"}` }),
    el("h2", { textContent: x.name }),
    el("p", { className: "meta", textContent: [x.field, x.mbti, `${x.gods} god${x.gods === 1 ? "" : "s"}`, x.mood, x.tricksters ? `${x.tricksters} Trickster${x.tricksters === 1 ? "" : "s"} so far` : null].filter(Boolean).join(" · ") }),
    el("div", { className: "nums" }, ...rows.map(([v, l]) => el("div", {}, String(v), el("small", { textContent: l })))),
    el("p", { className: "warline", textContent: war }),
    el("p", { className: "line", textContent: x.techs?.length ? `Techs: ${x.techs.map((t) => TECH[t] ?? t).join(", ")}` : "No techs yet." }),
    el("p", { className: "line", textContent: x.reverence ? `Reverence for the god it follows: ${x.reverence.standing}` : "No god yet." }),
    el("p", { className: "line", textContent: x.line?.length ? `Deepest line: ${x.line.join(" → ")}` : "Nothing learned yet." }),
    el("div", { className: "views" },
      el("button", { type: "button", className: "viewbtn", textContent: "Sky", onclick: () => live.flyTo(x.id) }),
      el("button", { type: "button", className: "viewbtn", textContent: "Plaza", onclick: () => live.viewPlaza(x.id) })),
  );
  p.hidden = false;
}

// ---- every nation at once, on this turn ----
function showAll() {
  const d = season.turn, sim = season.isSim(d);
  const xs = S.nations.map((n) => season.clanAt(n.id, d)).filter(Boolean);
  const box = $("allbox");
  const head = el("tr", {}, ...["Nation", "Points", "Florins", "NEAR in", "Mood", "Gods", "Reverence", "Techs", "Walls", "War"].map((h) => el("th", { textContent: h })));
  const rows = xs.map((x) => el("tr", { className: x.fallen ? "fallen" : "", onclick: () => { live.flyTo(x.id); showClan(x); } },
    el("td", {}, el("b", { textContent: x.name })),
    el("td", { textContent: String(x.points) }),
    el("td", { textContent: x.florins != null ? String(Math.round(x.florins)) : "–" }),
    el("td", { textContent: x.total_in != null ? n2(x.total_in) : "–" }),
    el("td", { textContent: x.mood ?? "–" }),
    el("td", { textContent: String(x.gods) }),
    el("td", { textContent: x.reverence ? String(x.reverence.standing) : "–" }),
    el("td", { textContent: String(x.techs?.length ?? 0) }),
    el("td", { textContent: String(x.walls ?? 0) }),
    el("td", { textContent: x.fallen ? `fell, turn ${x.fallen.day}` : x.war?.enemy ? `vs ${season.nameOf(x.war.enemy)}, round ${x.war.rounds}` : "peace" }),
  ));
  box.replaceChildren(
    el("div", { className: "ss-all-head" }, el("b", { textContent: `Every nation on turn ${d}` }), el("span", { className: `ss-chip ${sim ? "sim" : ""}`, textContent: sim ? "simulated" : "real" }), el("button", { type: "button", className: "ss-x", textContent: "✕", onclick: () => (box.hidden = true) })),
    xs.length ? el("div", { className: "ss-all-scroll" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...rows))) : el("p", { textContent: "No nation has been founded yet." }),
    el("small", { textContent: d < S.real_to ? `Florins and NEAR in weren't printed per turn before turn ${S.real_to}, so they show as –.` : "Click a nation to fly there." }),
  );
  box.hidden = false;
}
$("all").addEventListener("click", () => ($("allbox").hidden ? showAll() : ($("allbox").hidden = true)));

// ---- start ----
setSpeed(speed);
showTurn();
for (const c of season.world(season.turn).clans) lastPoints.set(c.id, c.points);
$("start-p").textContent = `Turns 1 to ${S.real_to} really happened and are sealed on NEAR. Turns ${S.real_to + 1} to ${S.last} are a simulation: the same engine ran the world forward on its own, with AI gods visiting. Pause on any turn to see every nation as it stood.`;
const begin = () => { $("start").hidden = true; setPlaying(true); };
$("go").addEventListener("click", begin);
if (q.get("play") === "1" || q.get("play") === "0") { $("start").hidden = true; setPlaying(q.get("play") === "1"); }
requestAnimationFrame(loop);
window.__season = { season, live, step, setPlaying };
