// The first-visit tutorial (his call 8 Nov): everything dims except one thing, an arrow points at
// it, a small box says what to do, and it only moves on when you've done it. A step whose target
// isn't on screen (an empty world, say) passes itself after a few seconds, so nobody is stuck.
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };

export function runTutorial({ force = false } = {}) {
  if (!force && localStorage.getItem("adf-tutorial-done")) return;
  const $ = (s) => document.querySelector(s);
  const visible = (e) => e && e.offsetParent !== null && e.getBoundingClientRect().width > 0;
  const panelOpen = () => visible($("#panel"));
  const STEPS = [
    { text: "This is a nation. Click its name to fly there.", target: () => [...document.querySelectorAll("#plates .plate")].find(visible), done: () => panelOpen() },
    { text: "This panel is the nation: what it knows, its florins, and the gods who back it.", target: () => $("#panel"), next: "Got it" },
    { text: "Every star in its sky is something its people found out. Click Sky.", target: () => [...document.querySelectorAll("#panel button")].find((b) => b.textContent.trim() === "Sky"), click: true },
    { text: "Everything that happens lands here. Click the newest event.", target: () => $(".standings .events li"), click: true },
    { text: "The season race. The most revered nation on 30 November wins the jackpot.", target: () => $(".standings ol"), next: "Got it" },
    { text: "Become a god. Connect a wallet, or play without one.", target: () => $(".chip.wallet"), click: true },
    { text: "Pick one. \"Play without a wallet\" gets you started in seconds.", target: () => [...document.querySelectorAll(".walletpick")].find(visible), done: () => !!document.querySelector(".chip.wallet")?.textContent.match(/[0-9a-f]{6}|\.testnet|\.near|@/) }, // an email shows once signed up
    { text: "Last step: found your own nation. It rises out of the clouds.", target: () => $(".chip.wallet"), click: true },
    { text: "Click Found a nation.", target: () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Found a nation" && visible(b)), click: true, final: true },
  ];

  const shade = el("div", { className: "tut-shade" });
  const hole = el("div", { className: "tut-hole" });
  const box = el("div", { className: "tut-box" }, el("p", {}), el("div", { className: "tut-row" }, el("small", {}), el("button", { type: "button", className: "tut-next" })));
  const arrow = el("div", { className: "tut-arrow" });
  arrow.innerHTML = '<svg viewBox="0 0 60 60" width="56" height="56"><path d="M8 8 C 30 10, 44 22, 50 46" fill="none" stroke="#ffd34d" stroke-width="5" stroke-linecap="round"/><path d="M38 40 L50 50 L54 34" fill="none" stroke="#ffd34d" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Four blockers around the hole: only the spotlit thing can be clicked.
  const blockers = [0, 1, 2, 3].map(() => el("div", { className: "tut-block" }));
  document.body.append(shade, hole, ...blockers, box, arrow);
  let i = 0, t0 = performance.now(), raf = 0, clicked = false, target = null;

  const place = () => {
    // Past the wallet step and the found card is open (Play without a wallet opens it by itself):
    // that's the tutorial's last step done, so get out of the card's way.
    if (document.querySelector(".txshade")) return finish();
    const s = STEPS[i];
    target = s.target();
    const r = target && visible(target) ? target.getBoundingClientRect() : null;
    const pad = 8, W = innerWidth, H = innerHeight;
    const R = r ? { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 } : { x: W / 2, y: H / 2, w: 0, h: 0 };
    Object.assign(hole.style, { left: `${R.x}px`, top: `${R.y}px`, width: `${R.w}px`, height: `${R.h}px`, opacity: r ? 1 : 0 });
    const [b0, b1, b2, b3] = blockers;
    Object.assign(b0.style, { left: 0, top: 0, width: `${W}px`, height: `${Math.max(0, R.y)}px` });
    Object.assign(b1.style, { left: 0, top: `${R.y + R.h}px`, width: `${W}px`, height: `${Math.max(0, H - R.y - R.h)}px` });
    Object.assign(b2.style, { left: 0, top: `${R.y}px`, width: `${Math.max(0, R.x)}px`, height: `${R.h}px` });
    Object.assign(b3.style, { left: `${R.x + R.w}px`, top: `${R.y}px`, width: `${Math.max(0, W - R.x - R.w)}px`, height: `${R.h}px` });
    // The text box sits beside the target, on whichever side has room; the arrow points from it.
    const bw = Math.min(320, W - 24), bh = box.offsetHeight || 110;
    const below = R.y + R.h + bh + 70 < H;
    const bx = Math.min(W - bw - 12, Math.max(12, R.x + R.w / 2 - bw / 2 - (R.x > W / 2 ? 120 : -120)));
    const by = below ? R.y + R.h + 64 : Math.max(12, R.y - bh - 64);
    Object.assign(box.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px` });
    const ax = R.x + R.w / 2 + (R.x > W / 2 ? -60 : 0), ay = below ? R.y + R.h + 4 : R.y - 60;
    Object.assign(arrow.style, { left: `${ax}px`, top: `${ay}px`, transform: below ? "rotate(-110deg)" : "rotate(70deg)", opacity: r ? 1 : 0 });
    // Missing target: pass after 4 s so the visitor is never stuck.
    if (!r && performance.now() - t0 > 4000) return advance();
    const doneNow = (s.done && s.done()) || (s.click && clicked);
    if (doneNow) return advance();
    raf = requestAnimationFrame(place);
  };
  const show = () => {
    const s = STEPS[i];
    box.querySelector("p").textContent = s.text;
    box.querySelector("small").textContent = `${i + 1} of ${STEPS.length}`;
    const nb = box.querySelector(".tut-next");
    nb.hidden = !s.next; nb.textContent = s.next || "";
    clicked = false; t0 = performance.now();
    box.classList.remove("in"); void box.offsetWidth; box.classList.add("in");
    cancelAnimationFrame(raf); raf = requestAnimationFrame(place);
  };
  const advance = () => {
    cancelAnimationFrame(raf);
    if (STEPS[i].final || i >= STEPS.length - 1) return finish();
    i++; setTimeout(show, 250);
  };
  const finish = () => {
    localStorage.setItem("adf-tutorial-done", "1");
    for (const n of [shade, hole, box, arrow, ...blockers]) n.remove();
    removeEventListener("click", onClick, true);
  };
  // A click inside the spotlit target counts as doing the step (captured before the target acts).
  const onClick = (e) => { if (target && (target === e.target || target.contains(e.target))) clicked = true; };
  addEventListener("click", onClick, true);
  box.querySelector(".tut-next").addEventListener("click", advance);
  show();
  return { finish };
}
