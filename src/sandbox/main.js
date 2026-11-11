// The sandbox (/timelapse/, his call 11 Nov): your own copy of the live world, run by the same engine.
// Shock it (an Act of God, or a bully war) and fast-forward a turn, a day or a week; the live world's
// own 3D code plays every turn as it lands. After a shock the server runs the same copy 12 turns ahead
// several times with the shock and without it, and the lab says whether the nation got back on its
// feet. Nothing here touches NEAR. Server: timelapse/service.mjs.
import { says } from "../says.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const r0 = (x) => Math.round(x).toLocaleString("en");
const KEY = "adf-sandbox";

const post = (p, body = {}) => fetch(`/sbx/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `error ${r.status}`); return j; });
const get = (p) => fetch(`/sbx/${p}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `error ${r.status}`); return j; });

let id = sessionStorage.getItem(KEY), st = null, live = null, names = {};
// Opened from a god's "Try it in a copy first" (live world, Act of God card): that fire, set up.
const Q = new URLSearchParams(location.search);
let PRE = Q.has("target") ? { caster: Number(Q.get("caster")), target: Number(Q.get("target")) } : null;

async function open() {
  $("start").hidden = true;
  globalThis.__adfApi = (p) => fetch(`/sbx/${id}/api/${p}${p.includes("?") ? "&" : "?"}net=testnet`, { cache: "no-store" }).then((r) => r.json());
  const { startLive } = await import("../live/live.js");
  live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: showClan, theme: "night", noReplay: true, sandbox: true });
  live.onRecord((r) => follow(r)); // words come from the feed and the citizens' dialogue boxes, not captions
  live.fx.gap = 700; // a sandbox fast-forwards: its turns play quicker than the live world's
  for (const n of st.nations) names[n.id] = n.name;
  showBar(); showLab(); tick();
  if (innerWidth < 700 && !PRE) $("lab").classList.add("folded"); // phones: the world first, the lab one tap away
}
const nameOf = (x) => names[x] ?? `nation ${x}`;

// ---- captions: what just happened, in words ----
let capTimer = null;
function caption(r) {
  const cap = $("cap");
  // The copy's records read as live ones do; in a copy nothing is on NEAR, so say so.
  cap.textContent = (r.text ?? (says(r, nameOf) || "")).replace(/ (on|to) NEAR( now)?/g, " in the copy").replace(/NEAR transaction/g, "copy's record");
  cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
  clearTimeout(capTimer); capTimer = setTimeout(() => cap.classList.remove("in"), 5000);
}

// ---- the camera goes where the shock lands: fire on an island, a war declared, peace, a fall ----
function follow(r) {
  const id = r.kind === "fire" ? r.clan : r.kind === "war" ? r.attacker : r.kind === "peace" ? r.a : r.kind === "fallen" ? r.clan : null;
  if (id != null) { live.flyTo(id); live.feed?.setFocus(id); }
}

// ---- keeping up with the server: while turns or futures run, look often ----
let lastDone = 0, lastTurns = -1;
async function tick() {
  try {
    const was = st;
    st = await get(`${id}/state`);
    for (const n of st.nations) names[n.id] = n.name;
    const moved = st.turns !== lastTurns || (st.running && st.done !== lastDone);
    lastDone = st.running ? st.done : 0; lastTurns = st.turns;
    // A new turn: whatever the last one hadn't finished playing is dropped, so the turn you just ran
    // plays now, its big moments (fire, war, peace, a fall) first.
    if (moved) { live.fx.clear(); await live.poll(); }
    showBar();
    if (moved || !!was?.pending !== !!st.pending || !!was?.running !== !!st.running) showLab();
    else if (JSON.stringify(was?.futures) !== JSON.stringify(st.futures) || was?.log?.length !== st.log.length) showOut();
    if (shown != null) showClan({ id: shown });
  } catch (e) {
    if (/gone/.test(e.message)) { sessionStorage.removeItem(KEY); $("start").hidden = false; $("start-p").textContent = e.message; return; }
  }
  setTimeout(tick, st?.running || st?.futures?.status === "running" ? 1200 : 8000);
}

// ---- the bar: where the copy stands, fast-forward, a fresh copy ----
function showBar() {
  $("turn").textContent = `Copy of turn ${st.seed_day ?? "?"} · +${st.turns} turn${st.turns === 1 ? "" : "s"}`;
  $("dial").textContent = `Sandbox · a copy, nothing here is on NEAR`;
  $("run").textContent = st.running ? `running ${st.done} of ${st.target}…` : st.error ? "a turn failed, try again" : st.pending ? "the shock lands on the next turn" : st.newer ? `The live world has moved on${st.newer.nations ? ` (${st.newer.nations} nations now)` : ""}. Fresh copy to catch up.` : "";
  $("reset").classList.toggle("newer", !!st.newer);
  for (const b of $("bar").querySelectorAll(".sb-ff button")) b.disabled = !!st.running;
}
for (const b of $("bar").querySelectorAll(".sb-ff button")) b.addEventListener("click", async () => {
  try { st = await post(`${id}/forward`, { turns: Number(b.dataset.n) }); showBar(); } catch (e) { caption({ text: e.message }); }
  clearTimeout(tickT); tickT = setTimeout(tick, 600);
});
let tickT = null;
$("reset").addEventListener("click", async () => {
  if (st?.running) return caption({ text: "Wait for the turns that are running to finish." });
  $("reset").disabled = true;
  try { st = await post(`${id}/reset`); id = st.id; sessionStorage.setItem(KEY, id); location.reload(); }
  catch (e) { caption({ text: e.message }); $("reset").disabled = false; }
});
$("home").addEventListener("click", () => live?.home());

// ---- the lab: shock it, and what the futures say ----
// Act of God damage, as engine/fire.mjs: 5% + 20% x (florins / the richest's), walls shield up to 30%.
let mode = "fire";
function showLab() {
  const box = $("lab");
  const peace = st.nations.filter((n) => !n.at_war && n.spendable > 1).sort((a, b) => b.spendable - a.spendable);
  const top = Math.max(...st.nations.map((n) => n.spendable), 1);
  const opt = (n, extra = "") => el("option", { value: String(n.id), textContent: `${n.name} · ${r0(n.spendable)} florins${extra}` });
  const tabs = el("div", { className: "sb-tabs" },
    el("button", { type: "button", className: mode === "fire" ? "on" : "", textContent: "Act of God", onclick: () => { mode = "fire"; showLab(); } }),
    el("button", { type: "button", className: mode === "bully" ? "on" : "", textContent: "Bully war", onclick: () => { mode = "bully"; showLab(); } }));
  let form;
  if (mode === "fire") {
    const target = el("select", {}, ...peace.map((n) => opt(n, ` · loses about ${r0(n.spendable * (0.05 + 0.2 * (n.spendable / top)))}`)));
    const caster = el("select", {}, ...st.nations.filter((n) => n.gods > 0).map((n) => opt(n)));
    const preset = () => { target.value = String(peace[0]?.id ?? ""); const poor = st.nations.filter((n) => n.gods > 0 && String(n.id) !== target.value).sort((a, b) => a.spendable - b.spendable)[0]; if (poor) caster.value = String(poor.id); };
    preset();
    if (PRE) { if ([...target.options].some((o) => o.value === String(PRE.target))) target.value = String(PRE.target); if ([...caster.options].some((o) => o.value === String(PRE.caster))) caster.value = String(PRE.caster); }
    form = el("div", { className: "sb-form" },
      el("button", { type: "button", className: "sb-preset", textContent: "🔥 Burn the richest", onclick: preset }),
      el("label", {}, "Rain fire on", target),
      el("label", {}, "Called by the gods of", caster),
      el("p", { className: "sb-note", textContent: "It goes through that nation's DAO vote, as on the live world, and burns on the next turn. The caster's nation pays a tenth. One call per god per day of world time, never on your own nation, never on a nation at war." }),
      el("button", { type: "button", className: "tl-go sb-cast", textContent: "Call the fire", disabled: !!st.pending || !!st.running, onclick: () => shock({ kind: "fire", target: Number(target.value), caster: Number(caster.value) }) }));
  } else {
    const all = st.nations.filter((n) => !n.at_war).sort((a, b) => b.spendable - a.spendable);
    const att = el("select", {}, ...all.map((n) => opt(n))), def = el("select", {}, ...all.map((n) => opt(n)));
    const note = el("p", { className: "sb-note" });
    const judge = () => { const a = all.find((n) => String(n.id) === att.value), d = all.find((n) => String(n.id) === def.value); note.textContent = a && d && a.spendable >= 3 * Math.max(d.spendable, 1) ? `${a.name} has ${(a.spendable / Math.max(d.spendable, 1)).toFixed(1)}x ${d.name}'s florins: picking on it brings fire from the heavens the moment it declares.` : "A nation with 3x its target's florins or more is a bully: the heavens burn it as it declares. This pair isn't, so it's a plain war."; };
    const preset = () => { att.value = String(all[0]?.id ?? ""); def.value = String(all.at(-1)?.id ?? ""); judge(); };
    att.onchange = def.onchange = judge; preset();
    form = el("div", { className: "sb-form" },
      el("button", { type: "button", className: "sb-preset", textContent: "⚔ The richest picks on the poorest", onclick: preset }),
      el("label", {}, "This nation declares war", att),
      el("label", {}, "on", def),
      note,
      el("button", { type: "button", className: "tl-go sb-cast", textContent: "Declare it", disabled: !!st.pending || !!st.running, onclick: () => shock({ kind: "bully", attacker: Number(att.value), target: Number(def.value) }) }));
  }
  box.replaceChildren(
    el("div", { className: "sb-head" }, el("b", { textContent: "Shock it" }), el("button", { type: "button", className: "ss-x", textContent: "–", title: "Fold the lab", onclick: () => box.classList.toggle("folded") })),
    el("div", { className: "sb-body" },
      tabs, form,
      st.pending ? el("p", { className: "sb-pending", textContent: `Waiting for the next turn: ${st.pending.kind === "fire" ? `fire on ${nameOf(st.pending.target)}` : `${nameOf(st.pending.attacker)} declares war on ${nameOf(st.pending.target)}`}. Press +1 turn.` }) : null,
      el("div", { id: "sb-out" })),
  );
  box.hidden = false;
  showOut();
}
// The futures and the heavens' log redraw on their own, so a half-made choice in the form stays put.
function showOut() {
  $("sb-out")?.replaceChildren(...[futuresView(),
    st.log.length ? el("div", { className: "sb-log" }, el("small", { textContent: "What the heavens did" }), ...st.log.slice().reverse().map((r) => el("p", { textContent: `Turn +${r.turn}: ${r.kind === "fire" ? `${r.cause === "god" ? `the gods of ${nameOf(r.from)} rained fire on` : r.cause === "bully" ? "the heavens burned the bully" : "the heavens struck"} ${nameOf(r.clan)}, ${r0(r.florins)} florins burned${r.cost?.florins ? ` (${nameOf(r.from)} paid ${r0(r.cost.florins)})` : ""}` : `refused: ${r.why}`}` }))) : null].filter(Boolean));
}
async function shock(body) {
  PRE = null; // the preset was used; the form is yours now
  try { st = await post(`${id}/shock`, body); showLab(); showBar(); clearTimeout(tickT); tickT = setTimeout(tick, 800); }
  catch (e) { caption({ text: e.message }); }
}

// ---- the futures: the copy 12 turns ahead, with the shock and without, several times each ----
const C_PLAIN = "#5f8bf0", C_SHOCK = "#e0661f"; // validated on the night panel (dataviz check: both pass)
function futuresView() {
  const F = st.futures;
  if (!F) return el("p", { className: "sb-note", textContent: "After a shock, the sandbox runs this same copy 12 turns ahead, 8 times with the shock and 8 without, to see whether the nation gets back to where it would have been." });
  const who = nameOf(F.shock.kind === "bully" ? F.shock.attacker : F.shock.target);
  if (F.status === "running") return el("div", { className: "sb-fut" }, el("b", { textContent: `Running ${who}'s futures` }), el("div", { className: "sb-prog" }, el("i", { style: `width:${(100 * F.done) / (F.runs * 2)}%` })), el("small", { textContent: `${F.done} of ${F.runs * 2} runs, 12 turns each. About two minutes; keep playing meanwhile.` }));
  if (F.status !== "done") return el("p", { className: "sb-note", textContent: `The futures didn't finish (${F.error ?? "unknown"}).` });
  const verdict = F.recovered === 0 ? `In none of the ${F.runs} futures did ${who} get back to where it would have been within 12 turns (a day).`
    : `${who} got back to where it would have been in ${F.recovered} of ${F.runs} futures, after about ${Math.round(F.recover_turns)} turns.`;
  return el("div", { className: "sb-fut" }, el("b", { textContent: verdict }), chart(F, who),
    el("small", { textContent: `"Back" means 95% or more of the florins it can spend in the futures without the ${F.shock.kind === "fire" ? "fire" : "war"}. Each line is the middle of its ${F.runs} runs.` }));
}
function chart(F, who) {
  const W = 300, Hh = 150, L = 40, R = 64, T = 12, B = 24;
  const a = F.plain_median, b = F.shocked_median, n = a.length - 1;
  const lo = Math.min(...a, ...b), hi = Math.max(...a, ...b), pad = (hi - lo) * 0.15 || 5;
  const y0 = Math.max(0, lo - pad), y1 = hi + pad;
  const x = (t) => L + (t / n) * (W - L - R), y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (Hh - T - B);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, class: "sb-chart", role: "img", "aria-label": `${who}'s spendable florins over 12 turns, with and without the shock` });
  for (const v of [y0, (y0 + y1) / 2, y1]) { svg.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" })); const t = svgEl("text", { x: L - 6, y: y(v) + 3, class: "ax", "text-anchor": "end" }); t.textContent = r0(v); svg.append(t); }
  for (const t of [0, 6, 12]) { const tx = svgEl("text", { x: x(t), y: Hh - 6, class: "ax", "text-anchor": "middle" }); tx.textContent = t ? `+${t}` : "now"; svg.append(tx); }
  const line = (vals, c, label) => {
    svg.append(svgEl("path", { d: vals.map((v, t) => `${t ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(""), fill: "none", stroke: c, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const tx = svgEl("text", { x: x(n) + 6, y: y(vals[n]) + 4, class: "lbl" }); tx.textContent = label; svg.append(tx);
  };
  line(a, C_PLAIN, "without"); line(b, C_SHOCK, "with");
  // Hover: a crosshair and both values on that turn.
  const cross = svgEl("line", { y1: T, y2: Hh - B, class: "cross", visibility: "hidden" }), tip = el("div", { className: "sb-tip", hidden: true });
  const dots = [svgEl("circle", { r: 4, fill: C_PLAIN, stroke: "#1d1430", "stroke-width": 2, visibility: "hidden" }), svgEl("circle", { r: 4, fill: C_SHOCK, stroke: "#1d1430", "stroke-width": 2, visibility: "hidden" })];
  svg.append(cross, ...dots);
  const hit = svgEl("rect", { x: L, y: 0, width: W - L - R, height: Hh, fill: "transparent" });
  hit.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect(), px = ((e.clientX - box.left) / box.width) * W, t = Math.max(0, Math.min(n, Math.round(((px - L) / (W - L - R)) * n)));
    cross.setAttribute("x1", x(t)); cross.setAttribute("x2", x(t)); cross.setAttribute("visibility", "visible");
    dots[0].setAttribute("cx", x(t)); dots[0].setAttribute("cy", y(a[t])); dots[1].setAttribute("cx", x(t)); dots[1].setAttribute("cy", y(b[t]));
    for (const d of dots) d.setAttribute("visibility", "visible");
    tip.replaceChildren(el("b", { textContent: t ? `Turn +${t}` : "Now" }), el("span", { textContent: `without: ${r0(a[t])}` }), el("span", { textContent: `with: ${r0(b[t])}` }));
    tip.hidden = false; tip.style.left = `${(x(t) / W) * 100}%`;
  });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); for (const d of dots) d.setAttribute("visibility", "hidden"); tip.hidden = true; });
  svg.append(hit);
  const legend = el("div", { className: "sb-legend" }, el("span", {}, el("i", { style: `background:${C_PLAIN}` }), `without the ${F.shock.kind === "fire" ? "fire" : "war"}`), el("span", {}, el("i", { style: `background:${C_SHOCK}` }), `with it`), el("span", { className: "u", textContent: `${who}'s florins it can spend` }));
  const table = el("details", { className: "sb-table" }, el("summary", { textContent: "The numbers" }), el("table", {},
    el("thead", {}, el("tr", {}, el("th", { textContent: "Turn" }), el("th", { textContent: "Without" }), el("th", { textContent: "With" }))),
    el("tbody", {}, ...a.map((v, t) => el("tr", {}, el("td", { textContent: t ? `+${t}` : "now" }), el("td", { textContent: r0(v) }), el("td", { textContent: r0(b[t]) }))))));
  return el("div", { className: "sb-chartbox" }, legend, el("div", { className: "sb-plot" }, svg, tip), table);
}

// ---- a nation, as it stands in the copy ----
let shown = null;
async function showClan(c) {
  const p = $("panel");
  if (!c) { p.hidden = true; shown = null; return; }
  const n = st?.nations.find((x) => x.id === c.id);
  const w = live ? (await globalThis.__adfApi("world").catch(() => null))?.clans?.find((x) => x.id === c.id) : null;
  if (!n && !w) { p.hidden = true; return; }
  shown = c.id;
  live?.feed?.setFocus(c.id);
  const fenced = n ? Math.max(0, n.florins - n.spendable) : 0;
  // What the heavens did to this nation in your copy, newest first.
  const hits = st.log.filter((r) => r.kind === "fire" && r.clan === c.id).reverse().map((r) => el("p", { className: "line burnt", textContent: `🔥 Turn +${r.turn}: ${r0(r.florins)} florins burned${r.cause === "god" ? ` by the gods of ${nameOf(r.from)}` : r.cause === "bully" ? " for picking on a weaker nation" : ""}.` }));
  p.replaceChildren(...[
    el("p", { className: "ss-chip sim", textContent: `Sandbox · +${st.turns} turn${st.turns === 1 ? "" : "s"}` }),
    el("h2", { textContent: n?.name ?? w?.name }),
    el("p", { className: "meta", textContent: [w?.field, w?.mbti, w?.mood, n?.at_war ? "at war" : "at peace"].filter(Boolean).join(" · ") }),
    el("div", { className: "nums" },
      el("div", {}, r0(n?.spendable ?? w?.florins ?? 0), el("small", { textContent: "florins it can spend" })),
      el("div", {}, String(w?.points ?? "–"), el("small", { textContent: "points of knowledge" })),
      el("div", {}, String(w?.clean_gifts ?? "–"), el("small", { textContent: "patents" }))),
    ...hits,
    fenced > 1 ? el("p", { className: "line", textContent: `Plus ${r0(fenced)} ring-fenced florins: its gods' grant, which it can't spend and fire can't burn.` }) : null,
    el("p", { className: "line", textContent: w?.war?.enemy ? `At war with ${nameOf(w.war.enemy)}, round ${w.war.rounds}.` : "At peace." }),
    el("div", { className: "views" },
      el("button", { type: "button", className: "viewbtn", textContent: "Sky", onclick: () => live.flyTo(c.id) }),
      el("button", { type: "button", className: "viewbtn", textContent: "Plaza", onclick: () => live.viewPlaza(c.id) })),
  ].filter(Boolean));
  p.hidden = false;
}

// ---- every nation at once ----
function showAll() {
  const box = $("allbox");
  const xs = st.nations.slice().sort((a, b) => b.spendable - a.spendable);
  box.replaceChildren(
    el("div", { className: "ss-all-head" }, el("b", { textContent: `Every nation in your copy, +${st.turns} turns` }), el("span", { className: "ss-chip sim", textContent: "sandbox" }), el("button", { type: "button", className: "ss-x", textContent: "✕", onclick: () => (box.hidden = true) })),
    el("div", { className: "ss-all-scroll" }, el("table", {},
      el("thead", {}, el("tr", {}, ...["Nation", "Florins it can spend", "All florins", "Gods", "War"].map((h) => el("th", { textContent: h })))),
      el("tbody", {}, ...xs.map((n) => el("tr", { onclick: () => { live.flyTo(n.id); showClan(n); box.hidden = true; } },
        el("td", {}, el("b", { textContent: n.name })), el("td", { textContent: r0(n.spendable) }), el("td", { textContent: r0(n.florins) }), el("td", { textContent: String(n.gods) }), el("td", { textContent: n.at_war ? "at war" : "peace" })))))),
    el("small", { textContent: "Click a nation to fly there." }),
  );
  box.hidden = false;
}
$("all").addEventListener("click", () => ($("allbox").hidden ? (st && showAll()) : ($("allbox").hidden = true)));
window.__sandbox = { get st() { return st; }, live: () => live };

// ---- start: reuse this tab's copy if it's still there, else offer a new one ----
const info = await get("info").catch(() => null);
$("start-p").textContent = info?.base_day
  ? `This is a copy of the live world as it stood at turn ${info.base_day}: the same nations, florins, citizens, wars and gods. The same engine runs it, with stand-in minds instead of Claude, and nothing in it touches NEAR. Rain fire on a nation or start a bully war, then run it ahead a day or a week.`
  : "The sandbox is taking its first copy of the live world. Give it a minute.";
if (id) st = await get(`${id}/state`).catch(() => { sessionStorage.removeItem(KEY); id = null; return null; });
if (st) await open(); else $("go").addEventListener("click", async () => {
  $("go").disabled = true; $("go").textContent = "Copying the world…"; $("start-err").hidden = true;
  try { st = await post("new"); id = st.id; sessionStorage.setItem(KEY, id); await open(); }
  catch (e) { $("start-err").textContent = e.message; $("start-err").hidden = false; $("go").disabled = false; $("go").textContent = "Try again"; }
});
