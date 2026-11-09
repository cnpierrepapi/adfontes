// The season, fast-forwarded now lives in its own 3D world at /timelapse/ (src/season/, his call
// 9 Nov). These keep the old entry points (the Season button, the offer after the intro, ?timelapse)
// pointing there.
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };

export function playTimelapse() { location.href = "/timelapse/"; return new Promise(() => {}); }

/** The offer after the intro: watch the season fast-forwarded, or not now. Resolves when settled. */
export function offerTimelapse() {
  return new Promise((resolve) => {
    const card = el("div", { className: "tl-offer" },
      el("b", { textContent: "Watch the season, fast-forwarded" }),
      el("small", { textContent: "A few minutes in its own world: the nations founded, then a simulated run ahead with wars, strange weapons and a fall. Pause on any turn to see every nation as it stood." }));
    const go = el("a", { className: "tl-go", href: "/timelapse/", textContent: "▶ Play" });
    const no = el("button", { type: "button", className: "tl-no", textContent: "Not now" });
    card.append(el("div", { className: "tl-row" }, go, no));
    document.body.append(card);
    no.addEventListener("click", () => { card.remove(); resolve(false); });
  });
}
