// A god's card (his ask 16 Nov): tap an AI god's name (its AI tag in the season standings, or its name
// in a nation's reverence list) and a card shows who it is, the nations it sits on, the grace it has
// put into them and how its holdings stand today. Read-only: two public reads, nothing signed.
// The numbers come from src/godinfo.js (tests/god-card.test.mjs).
import { api } from "../net.js";
import { godName, isAi, endedName } from "../says.js";
import { godInfo, actionWords } from "../godinfo.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
const g2 = (x) => `${(+x).toFixed(2)} grace`;
const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "");
const pctOf = (pct) => (pct != null ? ` (${sign(pct)}${Math.abs(pct)}%)` : "");
const signed = (x, pct) => `${sign(x)}${Math.abs(x).toFixed(2)}${pctOf(pct)}`;
const tone = (x) => (x > 0.005 ? "up" : x < -0.005 ? "down" : "");

let open = null;
/** flyTo(id): optional, a nation's row flies the camera there. ranks(): the standings table's places
 *  right now ({ nationId: place }), so the card shows exactly what the table shows. */
export async function openGodCard(account, { flyTo, ranks } = {}) {
  open?.remove();
  const box = el("div", { className: "txcard godcard", role: "dialog", ariaLabel: `${godName(account)}'s card` });
  const shade = el("div", { className: "txshade" }, box);
  open = shade;
  const close = () => { shade.remove(); if (open === shade) open = null; };
  shade.addEventListener("pointerdown", (e) => { if (e.target === shade) close(); });
  const onKey = (e) => { if (e.key === "Escape") { close(); removeEventListener("keydown", onKey); } };
  addEventListener("keydown", onKey);
  const shut = el("button", { type: "button", className: "viewbtn", textContent: "Close" });
  shut.addEventListener("click", close);
  const head = el("h3", {}, godName(account), isAi(account) ? " " : null, isAi(account) ? el("i", { className: "aitag", textContent: "AI" }) : null);
  box.append(head, el("p", { className: "fine", textContent: "Reading the world…" }));
  document.body.append(shade);

  const [world, stakes, log] = await Promise.all([api("world").catch(() => null), api("stakes").catch(() => null), api(`godlog?account=${encodeURIComponent(account)}`).catch(() => null)]);
  if (open !== shade) return; // closed (or another card opened) while it loaded
  if (!world?.clans) { box.replaceChildren(head, el("p", { className: "fine warn", textContent: "The world didn't answer. Try again in a minute." }), el("div", { className: "row" }, shut)); return; }
  const G = godInfo(account, world, stakes?.stakes ? stakes : null, ranks?.() ?? {});
  const standing = G.nations.filter((n) => n.alive);

  // "It leads Helios." / "It leads 3 nations. It also sits on Vaelmoor's council."
  const names = (list) => (list.length > 2 ? `${list.length} nations` : list.map((n) => n.name).join(" and "));
  const led = standing.filter((n) => n.leads), sits = standing.filter((n) => !n.leads);
  const where = !standing.length ? "It sits on no council right now."
    : [led.length ? `It leads ${names(led)}.` : null, sits.length ? `It ${led.length ? "also " : ""}sits on ${sits.length > 2 ? `${sits.length} other councils` : `${names(sits)}'s council${sits.length > 1 ? "s" : ""}`}.` : null].filter(Boolean).join(" ");
  const who = el("p", { className: "words" }, G.ai ? "An AI god. Claude picks its moves and code checks them, with the same powers a player has. " : "", where);

  // The money, all seats together (only seats whose stake loaded).
  const T = G.totals;
  const money = T ? el("dl", { className: "godsums" },
    el("dt", { textContent: "Grace put in" }), el("dd", { textContent: g2(T.given) }),
    ...(T.granted > 0 ? [el("dt", { textContent: "Given by the world" }), el("dd", { textContent: g2(T.granted) })] : []),
    el("dt", { textContent: "Stake counts" }), el("dd", { textContent: g2(T.counts) }),
    el("dt", { textContent: "Worth today" }), el("dd", { textContent: g2(T.worth) }),
    el("dt", { textContent: "Gain or loss" }), el("dd", { className: tone(T.gain), textContent: `${signed(T.gain)} grace${pctOf(T.pct)}` }))
    : el("p", { className: "fine", textContent: G.nations.length ? "Its stakes didn't load just now, so the money isn't shown." : "" });

  const rows = el("div", { className: "godnations" }, ...G.nations.map((n) => {
    const sub = !n.alive ? (n.fallen ? "fell in war" : "gone")
      : [n.leads ? "leads it" : "sits on its council", n.rank ? `#${n.rank} of ${n.of}` : null, n.reverence != null ? `reverence ${n.reverence}` : null].filter(Boolean).join(" · ");
    const name = el("button", { type: "button", className: "gn-name", textContent: n.name, disabled: !flyTo || !n.alive, title: n.alive ? `Fly to ${n.name}` : "" });
    name.addEventListener("click", () => { close(); flyTo?.(n.id); });
    return el("div", { className: `gn${n.alive ? "" : " gone"}` },
      el("div", {}, name, el("small", { textContent: sub })),
      n.counts == null ? el("span", { className: "fine", textContent: "stake not loaded" })
        : el("span", { className: "gn-money" }, `${g2(n.worth)} `, el("b", { className: tone(n.gain), textContent: signed(n.gain, n.pct) }), el("small", { textContent: `of ${g2(n.counts)} it counts` })));
  }));

  // Everything it has done (his ask 16 Nov), newest first, in its own scrolling box (/api/godlog).
  const nameOf = (id) => world.clans.find((c) => c.id === Number(id))?.name ?? endedName(id) ?? `nation ${id}`;
  const when = (ms) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const acts = Array.isArray(log?.actions) ? log.actions : null;
  const history = acts == null ? el("p", { className: "fine", textContent: "Its history didn't load just now." })
    : !acts.length ? el("p", { className: "fine", textContent: "Nothing yet." })
    : el("ol", { className: "godlog" }, ...acts.map((e) => el("li", { className: e.ok ? "" : "failed" },
      el("time", { textContent: when(e.at) }),
      el("span", { textContent: actionWords(e, nameOf) }),
      e.tx && world.explorer ? el("a", { href: `${world.explorer}/txns/${e.tx}`, target: "_blank", rel: "noopener", textContent: "record ↗", title: "Its public record" }) : null)));

  box.replaceChildren(head, who, money, G.nations.length ? el("h4", { textContent: "Its nations" }) : null, G.nations.length ? rows : null,
    el("h4", { textContent: `Everything it has done${acts?.length ? ` (${acts.length}${acts.length >= 400 ? ", the latest" : ""})` : ""}` }), history,
    el("p", { className: "fine", textContent: `Worth today is what its florins would pay if it claimed now. The stake counts what it put in plus anything the world gave it.${G.nations.some((n) => n.rank) ? " Places are the season standings." : ""}` }),
    el("div", { className: "row" }, shut));
}
