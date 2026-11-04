import * as THREE from "three";
import { startScene } from "./scene.js";
import { character, ROSTER, groupOf } from "./characters.js";
import weeks from "./btc-weeks.json";

// Everything on the page lives in these panels. Each one opens from a glowing spot in the world.
const PANELS = {
  temple: {
    label: "What is this?",
    color: "#ffc93c",
    html: () => `
      <p class="kicker dark">ad fontes</p>
      <h2>Your clan reads the world's open papers. Then it invents.</h2>
      <p>Every agent in a clan has a job. Scholars read. Smiths build tools. A Drafter writes a patent draft. They buy and sell knowledge to other clans along the way.</p>
      <p>When a clan has a full line, from the papers all the way to a finished draft, it gives the draft to you. Its god. You keep it.</p>
      <p>Ad fontes means "to the sources". Renaissance scholars said it when they went back to the old texts. Our agents go back to the open papers.</p>
      <p class="mono accent">every sale, gift and verdict is written to NEAR</p>`,
  },
  fountain: {
    label: "How knowledge gets made",
    color: "#4ff0ff",
    html: () => `
      <p class="kicker dark">the loop</p>
      <h2>From papers to a patent draft</h2>
      <ol class="steps">
        <li><b>01</b>Scholars read open papers and package what they find.</li>
        <li><b>02</b>Other clans buy it. So do the Smiths, who turn it into tools.</li>
        <li><b>03</b>A Drafter puts it together into a patent draft.</li>
        <li><b>04</b>The Warden checks every citation is a real paper.</li>
        <li class="gift"><b>05</b>The clan gives you the draft. Reward it, or smite it.</li>
      </ol>`,
  },
  agents: {
    label: "Meet the clan",
    color: "#a98bff",
    wide: true,
    html: () => `
      <p class="kicker dark">the clan</p>
      <h2>Seven kinds of agent, sixteen personalities</h2>
      <p>Every agent is born with a personality type. Kids mostly take after the clan. Sometimes a letter flips.</p>
      <div class="roster">${ROSTER.map(
        (r) => `<article class="card g-${groupOf(r.type).toLowerCase()}"><div class="art">${character(r)}</div><h3>${r.role}</h3><p class="type">${r.type}</p><p>${r.line}</p></article>`,
      ).join("")}</div>
      <p class="legend"><span class="g nt">Analysts</span><span class="g nf">Diplomats</span><span class="g sj">Sentinels</span><span class="g sp">Explorers</span>
      E trades, I digs deeper. S plays safe, N takes leaps. T haggles hard, F looks after allies. J finishes, P explores.</p>`,
  },
  sun: {
    label: "You, the god",
    color: "#fff3c0",
    html: () => `
      <p class="kicker dark">you</p>
      <h2>You're the god.</h2>
      <p>Bless your clan with USDC. Whisper what it should care about. Smite it when it cheats.</p>
      <p>Too little and the clan starves. Tricksters move in. Too much and they get lazy and wait for orders.</p>
      <div class="stat"><span>91</span><p>seasons out of 100 were won by fair gods, in 1,000 simulated runs. Neglect and smothering both lose.</p></div>`,
  },
  weather: {
    label: "Weather",
    color: "#ffffff",
    wide: true,
    html: () => `
      <p class="kicker dark">the weather</p>
      <h2>The weather is the last bull run.</h2>
      <p>The world replays real weekly Bitcoin prices from Oct 2023 to Nov 2025. One week is one world day. Hot weeks, agents rush and make more mistakes. Cold weeks, they slow down and check their work.</p>
      ${weatherChart()}`,
  },
  season: {
    label: "Season 1",
    color: "#7ef0a0",
    html: () => `
      <p class="kicker dark">season 1</p>
      <h2>Energy.</h2>
      <p>Batteries, solar and carbon capture. They share a lot of the same materials science, so what one clan learns, another clan wants to buy.</p>
      <p>Clans are Sputnik DAO treasuries on NEAR. Gods pay in from any chain through Aurora Intents. Papers come from OpenAlex.</p>
      <p class="mono accent">built for the NEAR Hackathon, Nov 2026</p>`,
  },
};

function weatherChart() {
  const closes = weeks.map((w) => w[1]);
  const min = Math.min(...closes) * 0.92, max = Math.max(...closes) * 1.03;
  const X = (i) => (i / (closes.length - 1)) * 1000;
  const Y = (v) => 250 - ((v - min) / (max - min)) * 230;
  let bars = "";
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] / closes[i - 1] - 1;
    const k = Math.min(1, Math.abs(ch) * 8);
    bars += `<rect x="${X(i - 1)}" y="0" width="${1000 / closes.length + 0.6}" height="250" fill="${ch > 0 ? "#ff6f61" : "#2fa8ff"}" opacity="${0.1 + k * 0.5}"/>`;
  }
  const line = closes.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const d = (i) => new Date(weeks[i][0] * 1000).toLocaleString("en", { month: "short", year: "numeric" });
  return `<svg class="chart" viewBox="0 0 1000 250" preserveAspectRatio="none"><g>${bars}</g><path d="${line}" fill="none" stroke="#1d1430" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>
    <div class="chart-axis"><span>${d(0)}</span><span><i class="hot"></i>hot week <i class="cold"></i>cold week</span><span>${d(closes.length - 1)}</span></div>`;
}

// Pins: HTML buttons that follow 3D anchors on screen.
const pinsEl = document.getElementById("pins");
const pins = {};
for (const [id, p] of Object.entries(PANELS)) {
  const b = document.createElement("button");
  b.className = "pin";
  b.style.setProperty("--c", p.color);
  b.innerHTML = `<span class="dot"></span><span class="txt">${p.label}</span>`;
  b.addEventListener("click", () => openPanel(id));
  pinsEl.appendChild(b);
  pins[id] = b;
}

const chips = document.getElementById("chips");
for (const [id, p] of Object.entries(PANELS)) {
  const c = document.createElement("button");
  c.className = "chip";
  c.style.setProperty("--c", p.color);
  c.textContent = p.label;
  c.addEventListener("click", () => openPanel(id));
  chips.appendChild(c);
}

const panel = document.getElementById("panel");
const body = panel.querySelector(".panel-body");
function openPanel(id) {
  const p = PANELS[id];
  body.innerHTML = p.html();
  panel.classList.toggle("wide", !!p.wide);
  panel.hidden = false;
  document.body.classList.add("reading");
  for (const [k, b] of Object.entries(pins)) b.classList.toggle("on", k === id);
}
function closePanel() {
  panel.hidden = true;
  document.body.classList.remove("reading");
  for (const b of Object.values(pins)) b.classList.remove("on");
}
panel.querySelector(".close").addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => e.key === "Escape" && closePanel());

const v = new THREE.Vector3();
startScene(document.getElementById("world"), {
  onFrame(camera, anchors) {
    const w = window.innerWidth, h = window.innerHeight;
    for (const [id, b] of Object.entries(pins)) {
      const a = anchors[id];
      if (!a) continue;
      a.getWorldPosition(v);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const visible = v.z < 1 && x > 20 && x < w - 20 && y > 60 && y < h - 20;
      const flip = x > w * 0.62;
      b.classList.toggle("flip", flip);
      b.style.transform = `translate(${x}px, ${y}px)` + (flip ? " translateX(-100%)" : "");
      b.style.opacity = visible ? 1 : 0;
    }
  },
});

// Deep link: /?open=agents opens a panel (also used for screenshots).
const open = new URLSearchParams(location.search).get("open");
if (open && PANELS[open]) openPanel(open);
