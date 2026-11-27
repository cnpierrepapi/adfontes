// The game (/play, his call 26-27 Nov): your nation and 3 AI nations taken from the live world as they stand right
// now, 7 turns, your god's reverence gained is your score. The server side is timelapse/game.mjs; the 3D world is
// the live world's own code reading the game's copy. Nothing here touches NEAR: the purse is play NEAR.
import { me, headers, logIn, signUp, logOut } from "./login.js";
import { mountMoves, moveText } from "./moves.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const r0 = (x) => Math.round(x).toLocaleString("en");
const r1 = (x) => (Math.round(x * 10) / 10).toLocaleString("en");
const signed = (x) => `${x > 0 ? "+" : ""}${r1(x)}`;

const call = (p, method = "GET", body = null) => fetch(`/sbx/game${p}`, { method, cache: "no-store", headers: { "content-type": "application/json", ...headers() }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.status === 401) { logOut(); throw Object.assign(new Error(j.error || "Log in to play."), { login: true }); } if (!r.ok) throw Object.assign(new Error(j.error || `error ${r.status}`), { status: r.status }); return j; });

let g = null, live = null, names = {}, lastK = -1, tickT = null;
const moves = mountMoves($("moves"), { call: (p, method, body) => call(p, method, body), getGame: () => g, onChange: (x) => { g = x; bar(); }, nameOf: (id) => names[id] ?? `nation ${id}` });

// ---- the card: log in, the draw, founding, the result ----
function card(text, ...body) {
  $("card").hidden = false;
  $("card-p").textContent = text;
  $("card-body").replaceChildren(...body);
  $("card-err").hidden = true;
}
function oops(e) { $("card-err").hidden = false; $("card-err").textContent = e.message || String(e); }

function loginCard() {
  $("out").hidden = true;
  const email = el("input", { type: "email", placeholder: "you@email.com", autocomplete: "email", className: "gm-in" });
  const pass = el("input", { type: "password", placeholder: "passphrase, 10 characters or more", autocomplete: "current-password", className: "gm-in" });
  const go = (f) => async () => {
    if (!email.value || !pass.value) return oops(new Error("Your email and a passphrase, please."));
    for (const b of $("card-body").querySelectorAll("button")) b.disabled = true;
    $("card-p").textContent = "Checking your passphrase. This takes a few seconds on purpose.";
    try { await f(email.value, pass.value); start(); } catch (e) { oops(e); for (const b of $("card-body").querySelectorAll("button")) b.disabled = false; $("card-p").textContent = "Log in with your email to play."; }
  };
  card("Log in with your email to play. The same log-in works on the live world.",
    email, pass,
    el("div", { className: "gm-row" },
      el("button", { type: "button", className: "tl-go", textContent: "Log in", onclick: go(logIn) }),
      el("button", { type: "button", className: "sb-reset", textContent: "New here? Sign up", onclick: go(signUp) })),
    el("p", { className: "gm-small", textContent: "Your passphrase never leaves this browser. Lose it and the log-in is gone: there's no reset." }));
}

function homeCard(last) {
  $("out").hidden = false;
  const body = [];
  if (last?.result) body.push(resultBox(last));
  body.push(el("button", { type: "button", className: "tl-go", textContent: last ? "Play again" : "New game", onclick: newGame }));
  body.push(el("p", { className: "gm-small", textContent: "A new game draws 3 AI nations from the live world as they stand right now, the ones played least so far. You get play NEAR worth a little more than the poorest of them holds. 7 turns, a world day each. Free games aren't saved once they end." }));
  card(last ? "Your last game" : `Logged in as ${me().email}.`, ...body);
}

function resultBox(x) {
  const r = x.result;
  return el("div", { className: "gm-result" },
    el("b", { textContent: r.fell ? `${x.name} fell on turn ${r.turns}` : `${x.name}: 7 turns done` }),
    el("p", { className: "gm-big", textContent: `${signed(r.gain)} reverence` }),
    el("p", { textContent: `Your god ended at ${r1(r.reverence ?? 50)}, from 50.` }),
    el("ul", {}, ...r.ai.map((a) => el("li", { textContent: `${a.name}: its top god ${a.gain == null ? "n/a" : signed(a.gain)}${a.fallen ? ", fell" : ""}` }))));
}

async function newGame() {
  try { g = await call("/new", "POST"); show(); } catch (e) { oops(e); }
}

function foundCard() {
  const name = el("input", { type: "text", placeholder: "Name your nation", maxLength: 24, className: "gm-in" });
  const field = el("select", { className: "gm-in" }, ...g.fields.map((f) => el("option", { value: f, textContent: f })));
  const btn = el("button", { type: "button", className: "tl-go", textContent: "Found my nation" });
  btn.onclick = async () => { btn.disabled = true; try { g = await call(`/${g.id}/found`, "POST", { name: name.value, field: field.value }); show(); } catch (e) { oops(e); btn.disabled = false; } };
  card(`You'll play against these three. Your purse: ${r1(g.purse.florins)} florins (${g.purse.near.toFixed(3)} play NEAR), 10% more than ${g.purse.poorest.name} holds.`,
    el("div", { className: "gm-drawn" }, ...g.drawn.map((n) => el("div", { className: "gm-nation" }, el("b", { textContent: n.name }), el("span", { textContent: `${r0(n.florins ?? 0)} florins` })))),
    name, el("label", { className: "gm-small", textContent: "Field your scholars research" }), field, btn,
    el("button", { type: "button", className: "sb-reset gm-quit", textContent: "Give up this draw", onclick: quit }));
}

async function quit() {
  if (!g) return;
  try { await call(`/${g.id}/quit`, "POST"); g = null; location.reload(); } catch (e) { oops(e); }
}

// ---- the game screen ----
async function open3D() {
  if (live) return;
  $("card").hidden = true;
  globalThis.__adfApi = (p) => fetch(`/sbx/game/${g.id}/api/${p}${p.includes("?") ? "&" : "?"}net=testnet`, { cache: "no-store" }).then((r) => r.json());
  const { startLive } = await import("../live/live.js");
  live = await startLive($("world"), { plates: $("plates"), visor: $("visor") }, { onSelect: () => {}, theme: "night", noReplay: true, sandbox: true });
  live.fx.gap = 700;
  live.onRecord((r) => { const id = r.kind === "fire" ? r.clan : r.kind === "war" ? r.attacker : r.kind === "fallen" ? r.clan : null; if (id != null) { live.flyTo(id); live.feed?.setFocus(id); } });
  setTimeout(() => live.flyTo(g.mine), 1200);
}

function bar() {
  const mine = g.nations?.find((n) => n.mine);
  $("bar").hidden = false;
  $("turn").textContent = `${g.name} · turn ${Math.min(g.turn + 1, g.turns)} of ${g.turns}`;
  $("stat").textContent = mine ? `${r0(mine.florins)} florins · ${mine.points} point${mine.points === 1 ? "" : "s"} · reverence ${r1(mine.rev)} (${signed(g.gain ?? 0)})${mine.at_war != null ? ` · at war with ${names[mine.at_war] ?? "a rival"}` : ""}` : "";
  $("run").textContent = g.running ? `${g.running.what}: ${g.running.done} of ${g.running.of}…` : g.error ? `a turn failed: ${g.error}` : "";
  $("end").disabled = !!g.running;
  $("report").hidden = !g.report;
}
$("end").addEventListener("click", async () => {
  $("end").disabled = true;
  try { g = await call(`/${g.id}/end-turn`, "POST"); $("panel").hidden = true; $("moves").classList.remove("under"); bar(); moves.refresh(); } catch (e) { $("run").textContent = e.message; $("end").disabled = false; }
  clearTimeout(tickT); tickT = setTimeout(tick, 800);
});
$("report").addEventListener("click", () => { if ($("panel").hidden) showReport(); else { $("panel").hidden = true; $("moves").classList.remove("under"); } });
$("home").addEventListener("click", () => live?.home());
$("out").addEventListener("click", () => { logOut(); location.reload(); });

function showReport() {
  const r = g.report; if (!r) return;
  const p = $("panel");
  p.hidden = false; $("moves").classList.add("under");
  const row = (n) => el("tr", { className: n.mine ? "me" : "" },
    el("td", { textContent: n.name }),
    el("td", { textContent: n.after?.fallen ? "fell" : `${r0(n.before?.florins ?? 0)} → ${r0(n.after?.florins ?? 0)}` }),
    el("td", { textContent: `${n.before?.points ?? "–"} → ${n.after?.points ?? "–"}` }),
    el("td", { textContent: n.after?.rev == null ? "–" : `${r1(n.before?.rev ?? 0)} → ${r1(n.after.rev)}` }));
  p.replaceChildren(
    el("button", { type: "button", className: "gm-x", textContent: "×", onclick: () => { p.hidden = true; $("moves").classList.remove("under"); } }),
    el("h2", { textContent: `Turn ${r.turn} report` }),
    el("table", { className: "gm-t" }, el("tr", {}, el("th", { textContent: "" }), el("th", { textContent: "florins" }), el("th", { textContent: "points" }), el("th", { textContent: "reverence" })), ...r.nations.map(row)),
    el("h3", { textContent: "What happened" }),
    r.events.length ? el("ul", {}, ...r.events.map((e) => el("li", { textContent: e }))) : el("p", { className: "line", textContent: "A quiet day: research, trade, upkeep." }),
    el("h3", { textContent: "Your moves" }),
    (r.orders || []).length || (r.yours || []).length ? el("ul", {}, ...(r.orders || []).map((x) => el("li", { textContent: moveText(x, (id) => names[id] ?? `nation ${id}`) })), ...(r.yours || []).map((x) => el("li", { textContent: x }))) : el("p", { className: "line", textContent: "You made none." }),
    el("h3", { textContent: "Your god's reverence" }),
    r.reverence.length ? el("ul", {}, ...r.reverence.map((x) => el("li", { textContent: `${signed(x.d)}: ${x.why}` }))) : el("p", { className: "line", textContent: "Unchanged." }));
}

// ---- keeping up ----
async function tick() {
  clearTimeout(tickT);
  try {
    const before = g;
    g = await call(`/${g.id}/state`);
    show(before);
  } catch (e) {
    if (e.status === 404) return start(); // finished (a free game is deleted when it ends) or given up
    if (e.login) return loginCard();
  }
  tickT = setTimeout(tick, g?.running || g?.status === "drawing" ? 1500 : 10000);
}

async function show(before = null) {
  for (const n of g.nations || []) names[n.id] = n.name;
  if (g.status === "drawing") { card("Copying your 3 nations from the live world. Half a minute or so.", el("div", { className: "gm-drawn" }, ...g.drawn.map((n) => el("div", { className: "gm-nation" }, el("b", { textContent: n.name }))))); clearTimeout(tickT); tickT = setTimeout(tick, 1500); return; }
  if (g.status === "failed") { card("That draw didn't copy.", el("p", { className: "gm-small", textContent: g.error || "" }), el("button", { type: "button", className: "tl-go", textContent: "Try again", onclick: async () => { await quit(); } })); return; }
  if (g.status === "founding") { if (before?.status !== "founding") foundCard(); return; }
  await open3D();
  bar();
  if (!before || before.running !== g.running || before.turn !== g.turn || !$("moves").childElementCount) moves.refresh();
  const k = (g.turn * g.per_turn) + (g.running?.done ?? 0);
  if (k !== lastK) { lastK = k; live.fx.clear(); await live.poll(); }
  if (before?.reports != null && g.reports > before.reports) showReport(); // a turn just ended
  if (!tickT) tickT = setTimeout(tick, g.running ? 1500 : 10000);
}

async function start() {
  if (!me()) return loginCard();
  try {
    const m = await call("/mine");
    $("out").hidden = false;
    if (m.game) { g = m.game; show(); tickT = setTimeout(tick, 1500); }
    else homeCard(m.last);
  } catch (e) { if (e.login) loginCard(); else { card("Couldn't reach the game just now.", el("button", { type: "button", className: "tl-go", textContent: "Try again", onclick: start })); oops(e); } }
}
start();
