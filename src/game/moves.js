// Your moves (step 3, 27 Nov): the action menu and the whisper list. Each move is planned here and written into
// your game's copy when you press End turn (timelapse/game.mjs queue / apply), the way the same move lands live.
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const r1 = (x) => (Math.round(x * 10) / 10).toLocaleString("en");
const signed = (x) => `${x > 0 ? "+" : ""}${r1(x)}`;
const opt = (value, text) => el("option", { value: String(value), textContent: text });
const btn = (text, onclick, cls = "sb-preset") => el("button", { type: "button", className: cls, textContent: text, onclick });

/** Words for a planned move. */
export function moveText(x, nameOf) {
  if (x.kind === "whisper") return `Whisper: "${x.text}"`;
  if (x.kind === "pitch") return `Scholars: research ${x.point}`;
  if (x.kind === "root_out") return `Root out ${x.point}`;
  if (x.kind === "rule") return x.reward ? "Reward a gift" : `Punish a gift: stun ${x.agent}`;
  if (x.kind === "ask") return `Ask ${x.agent} to answer the report`;
  if (x.kind === "dismiss") return `Ignore the report on ${x.agent}`;
  if (x.kind === "smite") return `Smite ${x.agent} (stunned 3 days)`;
  if (x.kind === "act_of_god") return `Act of God on ${nameOf(x.target)}`;
  if (x.kind === "war") return x.action === "declare" ? `War on ${nameOf(x.target)}` : x.action === "fortify" ? `Walls: ${x.florins} florins` : x.action === "offer_peace" ? "Offer peace" : "Accept peace";
  return x.kind;
}

export function mountMoves(box, { call, getGame, onChange, nameOf }) {
  let tab = "moves", menu = null, folded = innerWidth < 700;
  async function refresh() {
    const g = getGame();
    if (!g || g.status !== "playing") { box.hidden = true; return; }
    box.hidden = false;
    if (!g.running) { try { menu = await call(`/${g.id}/menu`); } catch { /* the next refresh tries again */ } }
    draw();
  }
  const plan = async (body) => {
    const g = getGame();
    try { onChange(await call(`/${g.id}/queue`, "POST", body)); note(""); } catch (e) { note(e.message); }
    draw();
  };
  let msg = "";
  const note = (m) => { msg = m; };
  function draw() {
    const g = getGame();
    if (!g) return;
    const head = el("div", { className: "sb-head" }, el("b", { textContent: g.running ? "The day plays out" : `Turn ${g.turn + 1}: your moves` }),
      btn(folded ? "▸" : "▾", () => { folded = !folded; draw(); }, "ss-x"));
    const tabs = el("div", { className: "sb-tabs" },
      el("button", { type: "button", className: tab === "moves" ? "on" : "", textContent: `Moves (${g.queue.length}/${g.limits.actions})`, onclick: () => { tab = "moves"; draw(); } }),
      el("button", { type: "button", className: tab === "whispers" ? "on" : "", textContent: `Whispers (${g.whispers.length})`, onclick: () => { tab = "whispers"; draw(); } }));
    const body = el("div", { className: "sb-body" }, tabs, tab === "moves" ? movesTab(g) : whispersTab(g));
    box.replaceChildren(...[head, folded ? null : body].filter(Boolean));
  }

  function movesTab(g) {
    if (g.running) return el("p", { className: "sb-note", textContent: "Your moves went in. Plan the next turn when this one is done." });
    const m = menu, out = [];
    const planned = g.queue.map((x, i) => el("p", { className: "gm-q" }, el("span", { textContent: moveText(x, nameOf) }),
      btn("×", async () => { try { onChange(await call(`/${g.id}/unqueue`, "POST", { i })); } catch (e) { note(e.message); } draw(); }, "gm-qx")));
    out.push(el("div", { className: "gm-planned" }, el("small", { textContent: "Planned for this turn" }), ...(planned.length ? planned : [el("p", { className: "sb-note", textContent: "Nothing yet. End turn with nothing planned and the day just plays out." })])));
    if (msg) out.push(el("p", { className: "sb-pending", textContent: msg }));
    if (!m) { out.push(el("p", { className: "sb-note", textContent: "Loading what you can do…" })); return el("div", { className: "sb-form" }, ...out); }

    // Whisper
    const used = g.queue.filter((x) => x.kind === "whisper").length;
    const wt = el("textarea", { className: "gm-in", rows: 2, maxLength: 200, placeholder: "Say something to your citizens" });
    out.push(section("Whisper", `${g.limits.whispers - used} of ${g.limits.whispers} left this turn. Your citizens judge what you say against how the nation is doing. Whispers alone can't lift your god past 60.`,
      wt, btn("Plan this whisper", () => plan({ kind: "whisper", text: wt.value }))));
    // Scholars
    if (m.frontier.length) {
      const sel = el("select", {}, ...m.frontier.map((p) => opt(p, p)));
      out.push(section("Scholars", "Point your Scholars at one thing for the whole day.", sel, btn("Plan it", () => plan({ kind: "pitch", point: sel.value }))));
    }
    // Gifts
    for (const [i, gf] of m.gifts.entries()) {
      const who = el("select", {}, ...m.citizens.map((c) => opt(c.name, `${c.name} (${c.role})`)));
      out.push(section(`Gift ${i + 1} of ${m.gifts.length} waits for your ruling`, `${gf.passed ? "The Warden passed it." : "The Warden flagged it."} Leave it a day and your god loses 5.`,
        btn("Reward it", () => plan({ kind: "rule", gift: gf.id, reward: true })), who, btn("Punish: stun this citizen", () => plan({ kind: "rule", gift: gf.id, reward: false, agent: who.value }))));
    }
    // Reports
    for (const r of m.reports) {
      out.push(section(`${r.accuser} accuses ${r.accused}`, `${r.claim}${r.answer ? ` They answered: "${r.answer}"` : ""}`,
        r.asked ? null : btn("Ask them first", () => plan({ kind: "ask", report: r.id })),
        btn("Ignore it", () => plan({ kind: "dismiss", report: r.id })),
        btn("Smite: stun 3 days", () => plan({ kind: "smite", report: r.id }))));
    }
    // War
    const w = m.war, war = [];
    if (!w.fair_game) war.push(el("p", { className: "sb-note", textContent: "Your nation isn't fair game yet: once a gift of yours passes the Warden you can go to war, and be attacked." }));
    if (w.at_war == null) {
      const free = m.rivals.filter((r) => !r.at_war && r.fair_game);
      if (free.length) { const t = el("select", {}, ...free.map((r) => opt(r.id, `${r.name} · ${Math.round(r.florins)} florins`))); war.push(t, btn("Declare war", () => plan({ kind: "war", action: "declare", target: Number(t.value) }))); }
    } else {
      war.push(el("p", { className: "sb-note", textContent: `At war with ${w.enemy_name}.${w.offer_from_them ? " They offered peace." : ""}${w.offer_from_us ? " You offered peace." : ""}` }));
      if (w.offer_from_them) war.push(btn("Accept peace", () => plan({ kind: "war", action: "accept_peace" })));
      else if (!w.offer_from_us) war.push(btn("Offer peace", () => plan({ kind: "war", action: "offer_peace" })));
    }
    const fl = el("input", { type: "number", min: 1, max: Math.floor(w.florins), step: 1, value: Math.max(1, Math.floor(w.florins * 0.1)), className: "gm-in gm-num" });
    war.push(el("div", { className: "gm-row" }, fl, btn("Build walls with these florins", () => plan({ kind: "war", action: "fortify", florins: Number(fl.value) }))));
    out.push(section("War", `One war order a turn. Walls: ${Math.round(w.walls)}. Florins: ${Math.round(w.florins)}.`, ...war));
    // Root out
    if (m.owned.length) {
      const sel = el("select", {}, ...m.owned.map((o) => opt(o.point, `${o.point}${o.doubt ? " (in doubt)" : ""}`)));
      out.push(section("Root out", "Cut a point your nation knows, and everything built on it. Worth it when a point is in doubt.", sel, btn("Plan it", () => plan({ kind: "root_out", point: sel.value }))));
    }
    // Act of God
    if (m.act_of_god.open) { const t = el("select", {}, ...m.rivals.map((r) => opt(r.id, r.name))); out.push(section("Act of God", "Call fire on a rival. Your nation pays a tenth of what burns.", t, btn("Call the fire", () => plan({ kind: "act_of_god", target: Number(t.value) })))); }
    else out.push(section("Act of God", m.act_of_god.why));
    return el("div", { className: "sb-form" }, ...out);
  }

  function whispersTab(g) {
    const ws = g.whispers || [];
    if (!ws.length) return el("p", { className: "sb-note", textContent: "Every whisper you send shows here after its turn: who heard it, what they made of it, what it did to your reverence." });
    const net = ws.reduce((a, x) => a + (Number(x.d) || 0), 0);
    const by = {};
    for (const x of ws) by[x.verdict || "?"] = (by[x.verdict || "?"] || 0) + 1;
    return el("div", { className: "gm-whispers" },
      el("p", { className: "sb-note", textContent: `${ws.length} whisper${ws.length === 1 ? "" : "s"}, ${signed(net)} reverence from words. ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ")}.` }),
      ...ws.slice().reverse().map((x) => el("div", { className: "gm-w" },
        el("small", { textContent: `Turn ${x.turn} · ${x.citizen ?? "a citizen"} heard it as ${x.verdict ?? "?"} · ${signed(Number(x.d) || 0)}` }),
        el("b", { textContent: `"${x.text}"` }),
        x.says ? el("p", { textContent: x.says }) : null)));
  }

  function section(title, text, ...kids) {
    return el("div", { className: "gm-sec" }, el("small", { textContent: title }), text ? el("p", { className: "sb-note", textContent: text }) : null, ...kids);
  }
  return { refresh, draw };
}
