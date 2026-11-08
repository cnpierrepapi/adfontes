// The season standings (SPEC §12k step 3, ranked by reverence per §12m): a small table in the HUD.
// Nations ranked by the reverence of the god they follow; an arrow for how each moved since you
// last looked (remembered on this device); tap a row to fly there. When one nation passes another
// between two looks at the world, the world shows it.
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };

export function createStandings({ visor, W, flyTo, onOvertake }) {
  const box = el("aside", { className: "standings" });
  const head = el("button", { type: "button", className: "head" });
  const list = el("ol");
  // The event list (SPEC §14): what just happened, newest on top; tap a line to fly there.
  const evHead = el("button", { type: "button", className: "head ev-head" });
  const events = el("ul", { className: "events" });
  box.append(head, list, evHead, events);
  let evOpen = innerWidth > 700;
  const drawEvHead = () => { evHead.textContent = `${evOpen ? "▾" : "▸"} Events`; events.hidden = !evOpen; };
  drawEvHead();
  evHead.addEventListener("click", () => { evOpen = !evOpen; drawEvHead(); });
  const MAX_EVENTS = 30;
  function event({ text, kind, clan, tip }) {
    if (!text) return;
    const li = el("li", { className: `ev ${kind || ""}${clan != null ? " go" : ""}${tip ? " has-tip" : ""}`, textContent: text, title: clan != null && !tip ? "Fly there" : "" });
    // A trade's price sum and the merchant's reason: shown on hover, or on a tap (phones).
    if (tip) li.append(el("span", { className: "tip", textContent: tip }));
    li.addEventListener("click", () => { if (tip) li.classList.toggle("open"); if (clan != null) flyTo(clan); });
    events.prepend(li);
    while (events.children.length > MAX_EVENTS) events.lastChild.remove();
  }
  visor.append(box);
  let open = innerWidth > 700; // phones start folded
  head.addEventListener("click", () => { open = !open; draw(last); });
  const key = `adf-ranks-${W.net}`;
  const seen = JSON.parse(localStorage.getItem(key) || "{}"); // nation id -> rank when you last looked
  let last = null, prevOrder = null;

  const rank = (clans) => clans.filter((c) => c.alive !== false)
    .map((c) => ({ id: c.id, name: c.name, standing: c.reverence?.standing ?? 0, waiting: c.reverence?.waiting, follows: c.reverence?.followed }))
    .sort((a, b) => b.standing - a.standing || a.id - b.id);

  function draw(rows) {
    if (!rows) return;
    head.textContent = `${open ? "▾" : "▸"} Season standings${W.jackpot ? ` · jackpot ${W.jackpot.near.toFixed(3)} NEAR` : ""}`;
    list.hidden = !open;
    list.replaceChildren(...rows.map((r, i) => {
      const was = seen[r.id];
      const move = was == null ? "" : was > i + 1 ? `▲${was - i - 1}` : was < i + 1 ? `▼${i + 1 - was}` : "";
      const li = el("li", { title: r.waiting ? "waiting for its god's first whisper" : `follows ${r.follows ?? "no god"}` },
        el("span", { className: "n", textContent: String(i + 1) }),
        el("span", { className: "name", textContent: r.name }),
        el("span", { className: `mv ${move.startsWith("▲") ? "up" : move ? "down" : ""}`, textContent: move }),
        el("b", { textContent: r.waiting ? "…" : String(r.standing) }));
      li.addEventListener("click", () => flyTo(r.id));
      return li;
    }));
  }

  /** Called with the world each time it's read (page load, then every poll). */
  function update(world) {
    const rows = rank(world.clans);
    last = rows;
    draw(rows);
    // Overtakes since the previous look this session.
    if (prevOrder) {
      rows.forEach((r, i) => {
        const before = prevOrder.indexOf(r.id);
        if (before > i) { const passed = prevOrder[i]; const p = rows.find((x) => x.id === passed); if (p) onOvertake?.(r, p, i + 1); }
      });
    }
    prevOrder = rows.map((r) => r.id);
  }
  // What you saw is remembered when you leave, so next visit's arrows say what changed meanwhile.
  addEventListener("pagehide", () => { if (last) localStorage.setItem(key, JSON.stringify(Object.fromEntries(last.map((r, i) => [r.id, i + 1])))); });
  return { update, event, ranks: () => Object.fromEntries((last || []).map((r, i) => [r.id, i + 1])) };
}
