// /timelapse/ is the sandbox now (src/sandbox/, timelapse/service.mjs, his call 11 Nov): a copy of the
// live world to shock and fast-forward. These keep the old entry points (the HUD button, the offer
// after the intro, ?timelapse) pointing there.
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };

export function playTimelapse() { location.href = "/timelapse/"; return new Promise(() => {}); }

/** The offer after the intro: watch the season fast-forwarded, or not now. Resolves when settled. */
export function offerTimelapse() {
  return new Promise((resolve) => {
    const card = el("div", { className: "tl-offer" },
      el("b", { textContent: "Try the sandbox" }),
      el("small", { textContent: "A copy of this world you can shock. Rain fire on a nation or start a war, run it ahead a day or a week, and see if it gets back on its feet. Nothing in it touches the real world." }));
    const go = el("a", { className: "tl-go", href: "/timelapse/", textContent: "Open it" });
    const no = el("button", { type: "button", className: "tl-no", textContent: "Not now" });
    card.append(el("div", { className: "tl-row" }, go, no));
    document.body.append(card);
    no.addEventListener("click", () => { card.remove(); resolve(false); });
  });
}
