// The cinematic intro (his call 8 Nov): first visit only. A title card (the click lets the voice
// play: browsers block sound until the visitor acts), then a short film: animated plates and stills
// of the real world, an old narrator, captions in sync. When it ends it fades straight into the
// live world, which has been loading underneath the whole time, and the tutorial starts.
const CAPTIONS = [ // [from s, to s, text], timed to the voiceover's words (whisper, 8 Nov, with the war line)
  [0.0, 6.0, "Long ago, scholars had a rule. Go back to the sources. Ad fontes."],
  [6.6, 9.0, "This is a world of small nations."],
  [9.3, 15.4, "Their citizens read real research, trade what they learn, and try to invent what comes next."],
  [15.7, 20.9, "Every nation has its gods. Put NEAR in, and you're one of them."],
  [21.16, 25.9, "When NEAR climbs, the sun is up. When it falls, night comes."],
  [26.2, 32.6, "Feed your people and they might find something new. Forget them, and they fall to ruin."],
  [32.86, 40.6, "And sometimes they go to war. Nobody asks the gods. It ends in peace, or with an island falling from the sky."],
  [40.94, 43.4, "Go on. They're waiting."],
];
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };

/** Plays the intro if this is a first visit (or force). Resolves when the world is showing. */
export function playCinematic({ force = false } = {}) {
  if (!force && localStorage.getItem("adf-cinema-seen")) return Promise.resolve(false);
  return new Promise((resolve) => {
    // 1080p for big screens, 720p for phones (same film, a third of the size).
    // The 1080p file needs about 1 MB/s to stream without stalling: a slow link gets 720p.
    const slow = (navigator.connection?.downlink ?? 10) < 9 || navigator.connection?.saveData;
    const big = !slow && Math.max(screen.width, screen.height) * (devicePixelRatio || 1) > 1400;
    const video = el("video", { src: big ? "/intro/intro.mp4" : "/intro/intro-720.mp4", playsInline: true, preload: "auto" });
    const cap = el("p", { className: "cine-cap" });
    const title = el("div", { className: "cine-title" },
      el("img", { src: "/mark.svg", alt: "", width: 64, height: 64 }),
      el("h1", { textContent: "AD FONTES" }),
      el("p", { textContent: "A world of small nations, run by AI, on NEAR." }),
      el("button", { type: "button", className: "cine-begin", textContent: "Begin" }));
    const skip = el("button", { type: "button", className: "cine-skip", textContent: "Skip intro" });
    const box = el("div", { className: "cinema" }, video, cap, title, skip);
    document.body.append(box);
    let done = false;
    const end = () => {
      if (done) return; done = true;
      localStorage.setItem("adf-cinema-seen", "1");
      box.classList.add("out");
      video.pause();
      setTimeout(() => { box.remove(); resolve(true); }, 1400);
      removeEventListener("keydown", esc);
    };
    const esc = (e) => { if (e.key === "Escape") end(); };
    addEventListener("keydown", esc);
    skip.addEventListener("click", end);
    // Stalls (his note 8 Nov): Begin waits until the first ~12 s are downloaded (or 10 s have passed,
    // so nobody is stuck), showing how far along it is.
    const begin = title.querySelector("button"), shownAt = performance.now();
    begin.disabled = true; begin.textContent = "Loading the film…";
    const ahead = () => (video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0);
    const gate = setInterval(() => {
      const need = Math.min(12, video.duration || 12), have = ahead();
      if (have >= need || video.readyState >= 4 || performance.now() - shownAt > 10000) { clearInterval(gate); begin.disabled = false; begin.textContent = "Begin"; }
      else begin.textContent = `Loading the film… ${Math.min(99, Math.round((have / need) * 100))}%`;
    }, 250);
    begin.addEventListener("click", () => {
      clearInterval(gate);
      title.classList.add("gone");
      video.play().catch(() => end()); // can't play: straight to the world
    });
    // (No mid-film switch to 720p: swapping the file played the opening again for a moment and then
    // skipped a scene, his note 8 Nov. A stall now just waits, like any video.)
    video.addEventListener("timeupdate", () => {
      const t = video.currentTime, c = CAPTIONS.find(([a, b]) => t >= a && t < b);
      const text = c ? c[2] : "";
      if (cap.textContent !== text) { cap.classList.remove("in"); void cap.offsetWidth; cap.textContent = text; if (text) cap.classList.add("in"); }
      if (video.duration && t > video.duration - 1.2) box.classList.add("fading");
    });
    video.addEventListener("ended", end);
    video.addEventListener("error", end);
  });
}
