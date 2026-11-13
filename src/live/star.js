// Looking into a nation's mind (PLAN_13NOV step 3): tap a star in any nation's sky and this card says what it is,
// how deep it sits, which nations know it, what it's worth and whether it's on the market. On your own nation, and
// when it's research your nation made, you can whisper to your Broker to list it (a signed choice, kind "list";
// the Broker listens by your reverence, engine/brokerword.mjs). Game copy stays web2 (12 Nov).
import { api } from "../net.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
const fl = (x) => `${(Math.round(x * 100) / 100).toLocaleString("en")} florin${x === 1 ? "" : "s"}`;

export function createStarCard({ getGods }) {
  const box = el("aside", { className: "starcard" });
  box.hidden = true;
  document.body.append(box);
  let token = 0;
  const close = () => { box.hidden = true; token++; };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close(); });

  async function show(clan, point) {
    const my = ++token;
    box.replaceChildren(el("p", { className: "fine", textContent: "Reading the stars…" }));
    box.hidden = false;
    const S = await api(`star?clan=${clan}&point=${encodeURIComponent(point)}`).catch(() => null);
    if (my !== token) return;
    if (!S || S.error) { box.replaceChildren(el("p", { className: "fine", textContent: S?.error || "Couldn't read that star just now." }), closeBtn()); return; }
    const others = S.known_by.filter((k) => k.id !== S.clan);
    const where = S.state === "known" ? (S.how && /^bought from clan/.test(S.how) ? `${S.nation} bought this` : `${S.nation} knows this`) : S.state === "frontier" ? `${S.nation}'s Scholars could study this next` : `${S.nation} doesn't know this`;
    const kids = [
      el("button", { type: "button", className: "x", textContent: "×", title: "Close", onclick: close }),
      el("h4", { textContent: S.title }),
      S.title !== S.point ? el("p", { className: "fine pt", textContent: S.point }) : null,
      el("p", { className: "fine" }, where, S.depth != null ? ` · depth ${S.depth}` : "", S.stir && S.stir !== "calm" ? ` · stirs ${S.stir}` : ""),
      el("p", { className: "fine" }, others.length ? `Also known in ${others.slice(0, 4).map((k) => k.name).join(", ")}${others.length > 4 ? ` and ${others.length - 4} more` : ""}.` : "No other nation knows it yet."),
      S.fair != null ? el("p", { className: "fine" }, "Worth about ", el("b", { textContent: fl(S.fair) }), " on the market.") : null,
      ...S.listings.slice(0, 3).map((l) => el("p", { className: "fine" }, `On sale from ${l.seller_name} at `, el("b", { textContent: fl(l.price) }), ".")),
    ];
    box.replaceChildren(...kids);
    // Your own research: whisper to your Broker to list it.
    const gods = getGods();
    if (!S.sellable || !gods?.account?.() || S.listings.some((l) => l.seller === S.clan)) return;
    const mine = new Set(await gods.myNations().catch(() => []));
    if (my !== token || !mine.has(S.clan)) return;
    const N = await api("next").catch(() => null);
    const asked = (N?.lists || []).find((x) => x.clan === S.clan && x.god === gods.account())?.tokens || [];
    if (asked.includes(S.token)) { box.append(el("p", { className: "fine", textContent: "You've asked your Broker to list this. It listens more the more it reveres you." })); return; }
    const b = el("button", { type: "button", className: "viewbtn gold", textContent: "Ask your Broker to sell it" });
    b.addEventListener("click", async () => {
      b.disabled = true;
      const tokens = [...asked.filter((t) => t !== S.token), S.token].slice(-3);
      const done = await gods.choose("list", S.clan, { tokens }, N.choice_day);
      if (done) { b.replaceWith(el("p", { className: "fine", textContent: "Whispered. Your Broker decides in a moment." })); } else b.disabled = false;
    });
    box.append(b, el("small", { className: "fine", textContent: "Your Broker listens more the more it reveres you, and still sets the price. If it sells above what it's worth, you gain a little reverence." }));
  }
  const closeBtn = () => el("button", { type: "button", className: "x", textContent: "×", title: "Close", onclick: close });
  return { show, close };
}
