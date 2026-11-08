// The season in a minute (his call 8 Nov; the games track asks for a fast-forward so judges can
// watch the economy move). It replays the real, sealed records of every turn so far as a short film
// in the live world: nations founded, research, trades, patents, techs, war. Each beat gets its own
// camera: a close orbit, a low plaza angle, the sky above, or a wide shot over two islands.
import { api } from "../net.js";
import { says } from "../says.js";
import * as THREE from "three";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const BEAT_MS = 2600;
const MAX_BEATS = 28;

/** Pick the highlights from every turn's records, in order: firsts and big moments first. */
function highlights(days) {
  const seen = new Set(), out = [];
  const key = (r) => `${r.kind}:${r.clan ?? r.buyer ?? r.attacker ?? r.war}`;
  for (const { day, records } of days) for (const r of records) {
    const k = r.kind;
    if (k === "tech") { if (!seen.has(`tech:${r.clan}`)) { seen.add(`tech:${r.clan}`); out.push({ day, r, weight: 2 }); } } // one tech beat per nation
    else if (k === "founded" || k === "war" || k === "fallen" || k === "peace" || (k === "gift" && r.passed)) out.push({ day, r, weight: 3 });
    else if (k === "trade" && !r.tool && !seen.has(`trade:${r.buyer}-${r.seller}`)) { seen.add(`trade:${r.buyer}-${r.seller}`); out.push({ day, r, weight: 2 }); }
    else if (k === "corpus" && !r.fake && !seen.has(key(r))) { seen.add(key(r)); out.push({ day, r, weight: 2 }); }
    else if (k === "battle" && Object.values(r.sides).some((x) => x.burned?.length)) out.push({ day, r, weight: 2 });
    else if (k === "fortify") out.push({ day, r, weight: 1 });
    else if (k === "corpus" && !r.fake) out.push({ day, r, weight: 0 });
  }
  // Keep every big moment, then fill with the rest, then put them back in time order.
  const ranked = out.map((b, i) => ({ ...b, i })).sort((a, b) => b.weight - a.weight || a.i - b.i).slice(0, MAX_BEATS * 2).sort((a, b) => a.i - b.i);
  // Variety: never the same nation three beats running (drop the extra small beats).
  const who = (b) => b.r.clan ?? b.r.buyer ?? b.r.attacker ?? b.r.a;
  const varied = [];
  for (const b of ranked) { const n = varied.length; if (n >= 2 && who(varied[n - 1]) === who(b) && who(varied[n - 2]) === who(b) && b.weight < 3) continue; varied.push(b); }
  return varied.slice(0, MAX_BEATS);
}

export async function playTimelapse(live) {
  const W = live.world;
  const clanName = (id) => W.clans.find((c) => c.id === Number(id))?.name ?? `nation ${id}`;
  // The overlay: letterbox, a title, captions, progress, skip.
  const top = el("div", { className: "tl-bar tl-top" }), bottom = el("div", { className: "tl-bar tl-bottom" });
  const cap = el("p", { className: "tl-cap" }), turn = el("p", { className: "tl-turn" });
  const prog = el("i"), progress = el("div", { className: "tl-progress" }, prog);
  const skip = el("button", { type: "button", className: "tl-skip", textContent: "Skip" });
  const title = el("div", { className: "tl-title" }, el("small", { textContent: "The season so far" }), el("b", { textContent: "Loading the records…" }));
  const box = el("div", { className: "timelapse" }, top, bottom, title, turn, cap, progress, skip);
  document.body.append(box);
  document.body.classList.add("tl-on");
  let stop = false;
  skip.addEventListener("click", () => (stop = true));
  addEventListener("keydown", function esc(e) { if (e.key === "Escape") { stop = true; removeEventListener("keydown", esc); } });

  // Every sealed turn's records (the same ones the Merkle roots on NEAR cover).
  let got = 0;
  const all = await Promise.all(Array.from({ length: W.day }, (_, i) => api(`day?d=${i + 1}`).catch(() => null).then((x) => { title.querySelector("b").textContent = `Loading the records… ${++got} of ${W.day} turns`; return x?.records?.length ? { day: i + 1, records: x.records } : null; })));
  const days = all.filter(Boolean);
  const beats = highlights(days);
  title.querySelector("b").textContent = `${days.length} turns, ${beats.length} moments`;
  await new Promise((r) => setTimeout(r, 1400));
  title.classList.add("gone");

  const C = live.controls, smooth = C.smoothTime;
  C.smoothTime = 0.55; // quicker camera moves while the film plays
  const posOf = (id) => live.islands.get(Number(id))?.getWorldPosition(new THREE.Vector3());
  const rOf = (id) => live.islands.get(Number(id))?.userData.r ?? 3;
  // The camera angles. Each returns [camera position, target].
  const SHOTS = {
    orbit(id, a) { const p = posOf(id), r = rOf(id); return [[p.x + Math.cos(a) * r * 2.6, p.y + r * 1.3, p.z + Math.sin(a) * r * 2.6], [p.x, p.y + 0.3, p.z]]; },
    plaza(id, a) { const p = posOf(id), r = rOf(id); return [[p.x + Math.cos(a) * r * 1.5, p.y + r * 0.55, p.z + Math.sin(a) * r * 1.5], [p.x, p.y + 0.2, p.z]]; },
    sky(id, a) { const p = posOf(id), r = rOf(id); return [[p.x + Math.cos(a) * r * 4, p.y + r * 1.2, p.z + Math.sin(a) * r * 4], [p.x, p.y + r * 2.4, p.z]]; },
    pair(a, b, s) { const A = posOf(a), B = posOf(b); if (!A || !B) return null; const m = A.clone().lerp(B, 0.5), d = A.distanceTo(B), n = new THREE.Vector3(B.z - A.z, 0, A.x - B.x).normalize(); return [[m.x + n.x * d * 0.8 * s, m.y + d * 0.45, m.z + n.z * d * 0.8 * s], [m.x, m.y, m.z]]; },
  };
  const shotFor = (r, i) => {
    const a = i * 1.7;
    if (r.kind === "trade") return SHOTS.pair(r.seller, r.buyer, i % 2 ? 1 : -1);
    if (r.kind === "war" || r.kind === "peace") return SHOTS.pair(r.attacker ?? r.a, r.defender ?? r.b, 1);
    if (r.kind === "battle") { const ids = Object.keys(r.sides).map(Number); return i % 2 ? SHOTS.pair(ids[0], ids[1], -1) : SHOTS.plaza(ids.find((id) => r.sides[id].burned?.length) ?? ids[0], a); }
    if (r.kind === "fallen") return SHOTS.orbit(r.clan, a);
    if (r.kind === "corpus") return i % 2 ? SHOTS.sky(r.clan, a) : SHOTS.plaza(r.clan, a);
    if (r.kind === "gift" || r.kind === "tech") return SHOTS.orbit(r.clan, a);
    return SHOTS.orbit(r.clan, a);
  };

  for (let i = 0; i < beats.length && !stop; i++) {
    const { day, r } = beats[i];
    const shot = shotFor(r, i);
    if (shot) C.setLookAt(...shot[0], ...shot[1], true); // don't wait for it to settle: the beat starts now
    turn.textContent = `Turn ${day}`;
    cap.textContent = says(r, clanName) || "";
    cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
    prog.style.width = `${((i + 1) / beats.length) * 100}%`;
    // The moment itself, in the world: battles with their weapons, the rest through the usual effects.
    if (r.kind === "battle") { const ids = Object.keys(r.sides).map(Number); live.fx.attack(r.sides[ids[0]].weapon || "cannon", ids[0], ids[1]); live.fx.attack(r.sides[ids[1]].weapon || "cannon", ids[1], ids[0], 700); }
    else if (r.kind !== "founded") live.fx.play(r);
    // A slow drift while it plays.
    const t0 = performance.now();
    while (performance.now() - t0 < BEAT_MS && !stop) { C.rotate(0.0016, 0, true); await new Promise((res) => setTimeout(res, 30)); }
  }
  C.smoothTime = smooth;
  box.classList.add("out");
  document.body.classList.remove("tl-on");
  await new Promise((r) => setTimeout(r, 700));
  box.remove();
  live.home();
}

/** The offer after the intro: watch the season in a minute, or not now. Resolves when settled. */
export function offerTimelapse(live) {
  return new Promise((resolve) => {
    const card = el("div", { className: "tl-offer" },
      el("b", { textContent: "Watch the season so far" }),
      el("small", { textContent: "Every turn since day one, in about a minute: nations rising, research, trades, war." }));
    const go = el("button", { type: "button", className: "tl-go", textContent: "▶ Play" });
    const no = el("button", { type: "button", className: "tl-no", textContent: "Not now" });
    card.append(el("div", { className: "tl-row" }, go, no));
    document.body.append(card);
    const done = (played) => { card.remove(); resolve(played); };
    go.addEventListener("click", async () => { card.remove(); await playTimelapse(live); resolve(true); });
    no.addEventListener("click", () => done(false));
  });
}
