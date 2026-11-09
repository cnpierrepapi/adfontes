// The season, fast-forwarded (his calls 8 and 9 Nov): about 90 seconds of the best moments, with
// captions, played in the live world. The first turns are the real season; after that it's the god
// simulation run forward from the live world (scripts/reel-build.mjs picks the beats and writes
// public/reel.json). Every beat says which it is. No film look: the world stays full screen, with a
// caption card, a turn chip, a thin progress line and Skip.
// Each beat gets its own camera: a close orbit, a low plaza angle, the sky above, or a wide shot
// over two islands.
import * as THREE from "three";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function playTimelapse(live) {
  const cap = el("p", { className: "tl-cap" }), turn = el("p", { className: "tl-turn" });
  const prog = el("i"), progress = el("div", { className: "tl-progress" }, prog);
  const skip = el("button", { type: "button", className: "tl-skip", textContent: "Skip" });
  const title = el("div", { className: "tl-title" }, el("small", { textContent: "The season, fast-forwarded" }), el("b", { textContent: "Loading…" }), el("p", {}));
  const box = el("div", { className: "timelapse" }, title, turn, cap, progress, skip);
  document.body.append(box);
  document.body.classList.add("tl-on");
  let stop = false;
  skip.addEventListener("click", () => (stop = true));
  const esc = (e) => { if (e.key === "Escape") stop = true; };
  addEventListener("keydown", esc);
  const [big, sub] = [title.querySelector("b"), title.querySelector("p")];

  let reel;
  try { reel = await fetch("/reel.json", { cache: "no-cache" }).then((r) => r.json()); }
  catch { big.textContent = "The reel didn't load. Try again in a minute."; await wait(2000); return finish(false); }
  big.textContent = `Turns 1 to ${reel.real_to} really happened. After that, it's a simulation.`;
  sub.textContent = "We ran the live world forward on its own, AI gods and all, to see where it goes.";
  for (let t = 0; t < 3200 && !stop; t += 50) await wait(50);
  title.classList.add("gone");

  const C = live.controls, smooth = C.smoothTime;
  C.smoothTime = 0.55; // quicker camera moves while it plays
  const posOf = (id) => live.islands.get(Number(id))?.getWorldPosition(new THREE.Vector3());
  const rOf = (id) => live.islands.get(Number(id))?.userData.r ?? 3;
  const at = (id, f) => { const p = posOf(id); return p ? f(p, rOf(id)) : null; };
  // The camera angles. Each returns [camera position, target].
  const SHOTS = {
    orbit: (id, a) => at(id, (p, r) => [[p.x + Math.cos(a) * r * 2.6, p.y + r * 1.3, p.z + Math.sin(a) * r * 2.6], [p.x, p.y + 0.3, p.z]]),
    plaza: (id, a) => at(id, (p, r) => [[p.x + Math.cos(a) * r * 1.5, p.y + r * 0.55, p.z + Math.sin(a) * r * 1.5], [p.x, p.y + 0.2, p.z]]),
    sky: (id, a) => at(id, (p, r) => [[p.x + Math.cos(a) * r * 4, p.y + r * 1.2, p.z + Math.sin(a) * r * 4], [p.x, p.y + r * 2.4, p.z]]),
    pair(a, b, s) { const A = posOf(a), B = posOf(b); if (!A || !B) return null; const m = A.clone().lerp(B, 0.5), d = A.distanceTo(B), n = new THREE.Vector3(B.z - A.z, 0, A.x - B.x).normalize(); return [[m.x + n.x * d * 0.8 * s, m.y + d * 0.45, m.z + n.z * d * 0.8 * s], [m.x, m.y, m.z]]; },
  };
  const shotFor = (r, i) => {
    const a = i * 1.7;
    if (r.kind === "trade") return SHOTS.pair(r.seller, r.buyer, i % 2 ? 1 : -1);
    if (r.kind === "war" || r.kind === "peace") return SHOTS.pair(r.attacker ?? r.a, r.defender ?? r.b, 1);
    if (r.kind === "battle") { const ids = Object.keys(r.sides).map(Number); return i % 2 ? SHOTS.pair(ids[0], ids[1], -1) : SHOTS.plaza(ids.find((id) => r.sides[id].burned?.length) ?? ids[0], a); }
    if (r.kind === "fallen") return SHOTS.pair(r.clan, r.by, -1) ?? SHOTS.orbit(r.clan, a); // wide: watch it sink, the debris fly to the winner
    if (r.kind === "corpus") return i % 2 ? SHOTS.sky(r.clan, a) : SHOTS.plaza(r.clan, a);
    return SHOTS.orbit(r.clan, a);
  };

  // The reel's moments play in the world but never reach the event list, the "while you were away"
  // note or the towns: they aren't the live world's news (and most are simulated).
  live.fx.quiet = true;
  const beats = reel.beats, total = beats.reduce((t, b) => t + b.ms, 0);
  let done = 0, sank = false;
  // ?timelapse=<n> starts at beat n (for checking one moment).
  const from = Math.max(0, Math.min(beats.length - 1, Number(new URLSearchParams(location.search).get("timelapse")) || 0));
  for (let i = from; i < beats.length && !stop; i++) {
    const { day, sim, r, cap: words, ms } = beats[i];
    const shot = shotFor(r, i);
    // A tall phone screen sees less from side to side: pull the camera back so both islands fit.
    const far = Math.max(1, Math.pow(innerHeight / innerWidth, 0.8));
    if (shot && far > 1) shot[0] = shot[0].map((v, k) => shot[1][k] + (v - shot[1][k]) * far);
    if (shot) C.setLookAt(...shot[0], ...shot[1], true); // don't wait for it to settle: the beat starts now
    turn.textContent = `Turn ${day} · ${sim ? "simulated" : "real"}`;
    turn.classList.toggle("sim", sim);
    cap.textContent = words;
    cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
    done += ms;
    prog.style.width = `${(done / total) * 100}%`;
    // The moment itself, in the world: battles with their weapons, the rest through the usual effects.
    if (r.kind === "battle") { const ids = Object.keys(r.sides).map(Number); live.fx.attack(r.sides[ids[0]].weapon || "cannon", ids[0], ids[1]); live.fx.attack(r.sides[ids[1]].weapon || "cannon", ids[1], ids[0], 700); }
    else if (r.kind !== "founded") live.fx.play(r);
    if (r.kind === "fallen") sank = true;
    // A slow drift while it plays.
    const t0 = performance.now();
    while (performance.now() - t0 < ms && !stop) { C.rotate(0.0016, 0, true); await wait(30); }
  }
  C.smoothTime = smooth;

  // The end: back to now.
  if (!stop) {
    cap.classList.remove("in"); turn.textContent = "";
    big.textContent = `${reel.sim_to} turns in ${reel.seconds} seconds.`;
    sub.textContent = `The real world is on turn ${live.world?.day ?? reel.real_to} right now. Click any island to see where it actually stands.`;
    title.classList.remove("gone");
    for (let t = 0; t < 3600 && !stop; t += 50) await wait(50);
  }
  return finish(sank);

  async function finish(reload) {
    removeEventListener("keydown", esc);
    live.fx.quiet = false;
    box.classList.add("out");
    document.body.classList.remove("tl-on");
    await wait(700);
    box.remove();
    // A simulated fall sank a real island: reload the world as it really is.
    if (reload) { const u = new URL(location.href); u.searchParams.delete("timelapse"); location.replace(u.toString()); return; }
    live.home();
  }
}

/** The offer after the intro: watch the season fast-forwarded, or not now. Resolves when settled. */
export function offerTimelapse(live) {
  return new Promise((resolve) => {
    const card = el("div", { className: "tl-offer" },
      el("b", { textContent: "Watch the season, fast-forwarded" }),
      el("small", { textContent: "About 90 seconds. The nations rising for real, then a simulated run ahead: wars, strange weapons, a fall." }));
    const go = el("button", { type: "button", className: "tl-go", textContent: "▶ Play" });
    const no = el("button", { type: "button", className: "tl-no", textContent: "Not now" });
    card.append(el("div", { className: "tl-row" }, go, no));
    document.body.append(card);
    const done = (played) => { card.remove(); resolve(played); };
    go.addEventListener("click", async () => { card.remove(); await playTimelapse(live); resolve(true); });
    no.addEventListener("click", () => done(false));
  });
}
