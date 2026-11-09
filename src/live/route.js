// The god's route (SPEC §12n): the first minutes of a god, one event after another, each met with
// confetti and a short card, saved per account and world. Also: the founding moment (your island,
// confetti, "You are a god", the neighbours' welcome) and the first-visit intro. Everything here
// listens to the same records the world plays, so it can't disagree with the replay or the panels.
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };

// ---- confetti: one canvas, a short burst ----
function confettiBurst(n = 160) {
  const c = el("canvas", { className: "confetti" });
  document.body.append(c);
  const ctx = c.getContext("2d"), W = (c.width = innerWidth), H = (c.height = innerHeight);
  const cols = ["#ffc93c", "#ff4fa3", "#4ff0ff", "#8a5cff", "#22c47e", "#ff6f61", "#fff8e7"];
  const ps = Array.from({ length: n }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 12, r: 4 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / 2800;
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k * k); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

// ---- cards: one at a time, a few seconds each ----
const cards = [];
let showing = false;
function card(title, line, kind = "gift") {
  cards.push({ title, line, kind });
  if (!showing) next();
}
function next() {
  const c = cards.shift();
  if (!c) { showing = false; return; }
  showing = true;
  confettiBurst();
  const box = el("div", { className: `congrats ${c.kind}` }, el("b", { textContent: c.title }), el("span", { textContent: c.line }));
  document.body.append(box);
  const done = () => { box.classList.add("out"); setTimeout(() => { box.remove(); next(); }, 350); };
  box.addEventListener("click", done);
  setTimeout(done, 5200);
}

// The steps, in the order a new god usually meets them. `hint` says how to get there.
const STEPS = [
  { id: "god", title: "You're a god now.", line: (n) => `${n} answers to you. Its people are watching the sky.`, hint: "Found a nation, or bless one." },
  { id: "whisper", title: "They heard you.", line: () => "Your whisper reached the plaza. Watch them gather at the temple.", hint: "Whisper to your nation." },
  { id: "star", title: "First star.", line: () => "A Scholar just fired your nation's first idea into the sky. It's knowledge your nation owns now.", hint: "Wait for a Scholar to finish research. Whispering helps." },
  { id: "report", title: "Someone's talking.", line: () => "A citizen reported another. Stunt the accused or let it go. You won't know who lied until later.", hint: "Watch your nation's panel for a report." },
  { id: "judged", title: "You made a call.", line: (n, r) => (r?.truth ? "The report was true. People noticed." : "The report was a grudge. People noticed that too."), hint: "Answer a report, or let one lapse." },
  { id: "trade", title: "First trade.", line: () => "Your Broker bought another nation's research. Cheaper than doing it yourself.", hint: "Your Broker trades when it finds a deal." },
  { id: "climb", title: "Moving up.", line: (n) => `${n} just passed another nation in the standings.`, hint: "Keep your people's reverence up." },
  { id: "second", title: "Two nations.", line: () => "You're a god of more than one now. Spread your bets.", hint: "Bless a second nation." },
  { id: "gift", title: "Your first gift.", line: () => "Your nation wrote a draft and offered it to you. Rule on it within a day.", hint: "Wait for your Drafter's first draft." },
];

export function createRoute({ live, W, account, onChange }) {
  const key = () => `adf-route-${W.net}-${account() || "anon"}`;
  const load = () => new Set(JSON.parse(localStorage.getItem(key()) || "[]"));
  let done = load(), lastAccount = account();
  const mine = () => {
    const a = account();
    if (!a) return new Map();
    const out = new Map();
    for (const isl of live.islands.values()) { const c = isl.userData.clan; if (c?.reverence?.gods?.[a] && isl.userData.status !== "dead") out.set(c.id, c.name); }
    return out;
  };
  function hit(id, r) {
    if (!account() || done.has(id)) return;
    const s = STEPS.find((x) => x.id === id);
    done.add(id);
    localStorage.setItem(key(), JSON.stringify([...done]));
    const n = mine().get(r?.clan) ?? [...mine().values()][0] ?? "Your nation";
    card(s.title, s.line(n, r));
    onChange?.();
  }
  // Steps that are about state: checked every few seconds (and when the account changes).
  setInterval(() => {
    if (account() !== lastAccount) { lastAccount = account(); done = load(); onChange?.(); }
    const m = mine();
    if (m.size >= 1) hit("god");
    if (m.size >= 2) hit("second");
  }, 3000);
  // Steps that are about events: every record the world plays.
  live.onRecord((r) => {
    const m = mine(), a = account();
    if (!a) return;
    if (r.kind === "reverence" && (r.changes || []).some((c) => c.god === a && /^whisper/.test(c.why))) hit("whisper", r);
    if (!m.has(r.clan) && !m.has(r.buyer)) return;
    if (r.kind === "corpus" && !r.fake) hit("star", r);
    if (r.kind === "report") hit("report", r);
    if (r.kind === "report-settled") hit("judged", r);
    if (r.kind === "trade" && m.has(r.buyer)) hit("trade", r);
    if (r.kind === "overtake") hit("climb", r);
    if (r.kind === "gift") hit("gift", r);
  });

  // ---- the founding moment, and the neighbours' welcome ----
  const GREET = [(a, b) => `${a} welcomes ${b}.`, (a, b) => `${a} sends ${b} a little light.`, (a, b) => `${a} is curious about ${b}.`, (a, b) => `${a} says hello to ${b}.`];
  function welcome(id, name) {
    const others = [...live.islands.values()].map((i) => i.userData.clan).filter((c) => c && c.id !== id && c.alive !== false).slice(0, 4);
    others.forEach((o, k) => setTimeout(() => live.fx.play({ kind: "welcome", from: o.id, clan: id, text: GREET[k % GREET.length](o.name, name) }), 2600 + k * 1400));
  }
  // Called after you sign a founding: when your island appears, it's your moment.
  function founded(name) {
    const t0 = Date.now();
    const look = setInterval(() => {
      const isl = [...live.islands.values()].find((i) => i.userData.clan?.name === name);
      if (!isl && Date.now() - t0 < 180e3) return;
      clearInterval(look);
      if (!isl) return;
      const id = isl.userData.clan.id;
      live.flyTo(id);
      setTimeout(() => card("You are a god.", `${name} is yours. Its people are waiting on the plaza for your first word. Whisper to them.`, "found"), 1500);
      welcome(id, name);
    }, 1000);
  }
  // Anyone watching sees a new nation welcomed by its neighbours.
  live.onRecord((r) => { if (r.kind === "founded" && !mine().has(r.clan)) welcome(r.clan, r.name); });

  return {
    founded,
    progress: () => STEPS.map((s) => ({ id: s.id, title: s.title, done: done.has(s.id), hint: s.hint })),
  };
}
