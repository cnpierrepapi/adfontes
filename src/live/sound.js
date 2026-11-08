// What you hear (his call 8 Nov): one faint, calm piece of music, a soft piano and music-box loop
// made for the game (public/sound/calm.mp3, 91 s, seamless). It replaced the weather recordings
// (insects, wind, rain, thunder), which were too busy under the narration and the world.
// Browsers only allow sound after a tap, so the first tap/click/key starts it; the chip mutes it
// (remembered per device). It stays quiet while the intro plays.

const FILES = { calm: "/sound/calm.mp3" };
const QUIET = { calm: 0.32 }; // faint, under everything
const MIX = { hot: QUIET, mild: QUIET, cold: QUIET, storm: QUIET };

/** The weather word for a week's NEAR price change (shared with the dial). */
export function weatherKind(change) {
  if (change == null) return "mild";
  return change > 0.1 ? "hot" : change < -0.2 ? "storm" : change < -0.05 ? "cold" : "mild";
}

export function createWeatherSound({ button, kind: startKind }) {
  let kind = startKind || "mild";
  let on = localStorage.getItem("adf-sound") !== "off";
  let ctx = null, master = null, started = false;
  const buffers = new Map(), voices = new Map(); // name -> { src, gain }

  const label = () => {
    button.innerHTML = `${on ? "♪" : "<s>♪</s>"} <span class="word">${on ? (started ? "Sound on" : "Tap to hear") : "Sound off"}</span>`;
    button.setAttribute("aria-pressed", String(on));
  };

  async function load(name) {
    if (!buffers.has(name)) buffers.set(name, fetch(FILES[name]).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)));
    return buffers.get(name);
  }

  // Fade every voice toward the current weather's mix (missing voices start, unused ones fade out).
  async function apply(fade = 3) {
    if (!ctx) return;
    const want = MIX[kind] || MIX.mild, t = ctx.currentTime;
    for (const [name, v] of voices) if (!(name in want)) v.gain.gain.setTargetAtTime(0, t, fade / 3);
    for (const [name, level] of Object.entries(want)) {
      let v = voices.get(name);
      if (!v) {
        const buf = await load(name).catch(() => null);
        if (!buf) continue;
        const src = ctx.createBufferSource(), gain = ctx.createGain();
        src.buffer = buf; src.loop = true;
        gain.gain.value = 0;
        src.connect(gain).connect(master);
        src.start(0, Math.random() * buf.duration); // a different moment each visit
        v = { src, gain };
        voices.set(name, v);
      }
      v.gain.gain.setTargetAtTime(level, ctx.currentTime, fade / 3);
    }
  }

  // The intro has its own narration: the weather waits until the film is gone (his note 8 Nov).
  const filmOn = () => !!document.querySelector(".cinema");
  function start() {
    if (started || !on) return;
    if (filmOn()) { setTimeout(start, 400); return; }
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    apply(4);
    label();
  }

  // The first gesture anywhere starts it (the chip's own click is handled below).
  const first = (e) => { if (e.target === button) return; start(); };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, first, { passive: true });

  button.addEventListener("click", () => {
    on = !on;
    localStorage.setItem("adf-sound", on ? "on" : "off");
    if (on && !started) start();
    else if (ctx) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.4);
    label();
  });

  // Silent while the intro plays again ("Watch the intro"), back after it.
  setInterval(() => { if (ctx && on) master.gain.setTargetAtTime(filmOn() ? 0 : 0.9, ctx.currentTime, 0.5); }, 400);

  // Quiet while the tab is hidden.
  document.addEventListener("visibilitychange", () => { if (ctx) document.hidden ? ctx.suspend() : ctx.resume(); });

  label();
  return {
    /** A new game day: crossfade to its weather. */
    setKind(k) { if (k === kind) return; kind = k; apply(6); },
    get kind() { return kind; },
    /** For tests: what's playing and how loud. */
    state() { return { started, on, ctx: ctx?.state ?? null, voices: [...voices].map(([n, v]) => [n, +v.gain.gain.value.toFixed(2)]) }; },
  };
}
