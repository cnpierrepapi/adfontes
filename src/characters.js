// Flat faceted characters, drawn as SVG polygons. Each shape is split into a lit facet and a
// shaded facet, the way paper-craft illustrations read. One character per agent role.

const GROUPS = {
  NT: { main: "#8a5cff", light: "#a98bff", dark: "#6a3ee6", accent: "#ffd84d", pants: ["#4a2fa8", "#3a2288"] },
  NF: { main: "#22c47e", light: "#4fe0a0", dark: "#13995f", accent: "#ff8fc8", pants: ["#0f7a56", "#0a6045"] },
  SJ: { main: "#2fa8ff", light: "#6cc4ff", dark: "#1a7fd6", accent: "#ffcf3c", pants: ["#1d4fa0", "#163d80"] },
  SP: { main: "#ffb21e", light: "#ffcd5e", dark: "#e08a00", accent: "#ff6f61", pants: ["#a8452f", "#883424"] },
};
export const groupOf = (type) => (type[1] === "N" ? (type[2] === "T" ? "NT" : "NF") : type[3] === "J" ? "SJ" : "SP");

const SKIN = [
  { l: "#ffd9bf", d: "#f2b896" },
  { l: "#e8b48c", d: "#cf946a" },
  { l: "#b97a52", d: "#9a5f3b" },
  { l: "#7f4f33", d: "#653b24" },
];
const HAIR = ["#3b2a4d", "#2b1e16", "#ff6f61", "#ffe27a", "#5a3cc0", "#14213d"];

const poly = (pts, fill) => `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" fill="${fill}"/>`;

// Split a quad (TL, TR, BR, BL) down the middle into a lit left half and a shaded right half.
function quad2(tl, tr, br, bl, light, dark) {
  const tm = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
  const bm = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2];
  return poly([tl, tm, bm, bl], light) + poly([tm, tr, br, bm], dark);
}

function head(cx, cy, r, skin) {
  // A faceted head: a hexagon split into four facets plus a jaw.
  const p = (a, k = 1) => [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * 1.08 * k];
  const top = p(-Math.PI / 2), tr = p(-Math.PI / 6), br = p(Math.PI / 6), bot = p(Math.PI / 2, 1.02), bl = p((5 * Math.PI) / 6), tl = p((7 * Math.PI) / 6);
  const c = [cx - r * 0.12, cy + r * 0.05];
  return (
    poly([top, c, tl], skin.l) + poly([tl, c, bl], skin.l) + poly([bl, c, bot], skin.d) +
    poly([top, tr, c], skin.l) + poly([tr, br, c], skin.d) + poly([br, bot, c], skin.d)
  );
}

function face(cx, cy, r, mood) {
  const eye = (x) => `<rect x="${x - r * 0.07}" y="${cy - r * 0.05}" width="${r * 0.14}" height="${r * (mood === "sly" ? 0.07 : 0.16)}" rx="${r * 0.04}" fill="#1d1430"/>`;
  const smile =
    mood === "stern"
      ? `<rect x="${cx - r * 0.22}" y="${cy + r * 0.42}" width="${r * 0.38}" height="${r * 0.06}" fill="#1d1430"/>`
      : `<path d="M${cx - r * 0.24} ${cy + r * 0.38} Q${cx - r * 0.04} ${cy + r * (mood === "sly" ? 0.5 : 0.6)} ${cx + r * 0.18} ${cy + r * 0.36}" stroke="#1d1430" stroke-width="${r * 0.07}" fill="none" stroke-linecap="round"/>`;
  return eye(cx - r * 0.38) + eye(cx + r * 0.22) + smile + `<circle cx="${cx - r * 0.55}" cy="${cy + r * 0.3}" r="${r * 0.12}" fill="#ff8fa3" opacity=".55"/>`;
}

function hair(cx, cy, r, color, style) {
  const top = cy - r * 1.12;
  if (style === "bun")
    return poly([[cx - r * 1.02, cy - r * 0.1], [cx - r * 0.7, top + r * 0.1], [cx + r * 0.6, top + r * 0.05], [cx + r * 1.02, cy - r * 0.15], [cx + r * 0.6, cy - r * 0.55], [cx - r * 0.7, cy - r * 0.5]], color) +
      `<circle cx="${cx + r * 0.1}" cy="${top - r * 0.25}" r="${r * 0.38}" fill="${color}"/>`;
  if (style === "spike")
    return poly([[cx - r * 1.05, cy - r * 0.05], [cx - r * 0.9, top - r * 0.2], [cx - r * 0.45, top + r * 0.05], [cx - r * 0.1, top - r * 0.35], [cx + r * 0.3, top], [cx + r * 0.8, top - r * 0.2], [cx + r * 1.05, cy - r * 0.2], [cx + r * 0.4, cy - r * 0.5], [cx - r * 0.6, cy - r * 0.45]], color);
  if (style === "long")
    return poly([[cx - r * 1.1, cy + r * 1.1], [cx - r * 1.12, cy - r * 0.4], [cx - r * 0.6, top], [cx + r * 0.7, top], [cx + r * 1.12, cy - r * 0.4], [cx + r * 1.1, cy + r * 1.1], [cx + r * 0.8, cy + r * 0.2], [cx + r * 0.75, cy - r * 0.45], [cx - r * 0.6, cy - r * 0.55], [cx - r * 0.8, cy + r * 0.2]], color);
  return poly([[cx - r * 1.04, cy - r * 0.05], [cx - r * 0.85, top + r * 0.1], [cx + r * 0.2, top - r * 0.05], [cx + r * 1.0, top + r * 0.3], [cx + r * 1.04, cy - r * 0.25], [cx + r * 0.2, cy - r * 0.62], [cx - r * 0.5, cy - r * 0.42]], color);
}

const PROPS = {
  // Each prop is drawn around a hand point (hx, hy).
  Patron: (hx, hy, g) =>
    poly([[hx - 14, hy + 4], [hx + 14, hy + 4], [hx + 10, hy + 30], [hx - 10, hy + 30]], "#ffcf3c") + poly([[hx, hy + 4], [hx + 14, hy + 4], [hx + 10, hy + 30], [hx, hy + 30]], "#e8a800") +
    `<circle cx="${hx}" cy="${hy + 17}" r="5" fill="#fff6c8"/>`,
  Scholar: (hx, hy) =>
    poly([[hx - 22, hy - 6], [hx, hy - 2], [hx, hy + 26], [hx - 22, hy + 22]], "#ffffff") + poly([[hx, hy - 2], [hx + 22, hy - 6], [hx + 22, hy + 22], [hx, hy + 26]], "#dff3ff") +
    `<path d="M${hx - 17} ${hy + 4} h12 M${hx - 17} ${hy + 10} h12 M${hx + 5} ${hy + 4} h12 M${hx + 5} ${hy + 10} h12" stroke="#9ab" stroke-width="2"/>`,
  Smith: (hx, hy) =>
    poly([[hx - 3, hy - 30], [hx + 3, hy - 30], [hx + 3, hy + 10], [hx - 3, hy + 10]], "#c98a5a") + poly([[hx - 16, hy - 42], [hx + 16, hy - 42], [hx + 16, hy - 28], [hx - 16, hy - 28]], "#9aa4b8") + poly([[hx, hy - 42], [hx + 16, hy - 42], [hx + 16, hy - 28], [hx, hy - 28]], "#7a8499"),
  Drafter: (hx, hy) =>
    poly([[hx - 2, hy + 6], [hx + 26, hy - 40], [hx + 14, hy - 4]], "#ffffff") + poly([[hx - 2, hy + 6], [hx + 14, hy - 4], [hx + 4, hy + 8]], "#dfe7ff") + `<path d="M${hx - 2} ${hy + 6} l-4 8" stroke="#1d1430" stroke-width="3"/>`,
  Broker: (hx, hy) =>
    `<path d="M${hx} ${hy - 34} V${hy + 8} M${hx - 24} ${hy - 26} H${hx + 24}" stroke="#ffcf3c" stroke-width="4"/>` +
    poly([[hx - 32, hy - 8], [hx - 16, hy - 8], [hx - 20, hy - 2], [hx - 28, hy - 2]], "#ffcf3c") + poly([[hx + 16, hy - 8], [hx + 32, hy - 8], [hx + 28, hy - 2], [hx + 20, hy - 2]], "#ffcf3c") +
    `<path d="M${hx - 24} ${hy - 26} L${hx - 30} ${hy - 8} M${hx - 24} ${hy - 26} L${hx - 18} ${hy - 8} M${hx + 24} ${hy - 26} L${hx + 18} ${hy - 8} M${hx + 24} ${hy - 26} L${hx + 30} ${hy - 8}" stroke="#ffcf3c" stroke-width="1.5"/>`,
  Warden: (hx, hy) =>
    `<path d="M${hx} ${hy - 6} v-8" stroke="#555" stroke-width="3"/>` +
    poly([[hx - 12, hy - 4], [hx + 12, hy - 4], [hx + 9, hy + 26], [hx - 9, hy + 26]], "#fff2a8") + poly([[hx, hy - 4], [hx + 12, hy - 4], [hx + 9, hy + 26], [hx, hy + 26]], "#ffd84d") +
    `<circle cx="${hx}" cy="${hy + 11}" r="16" fill="#fff6a0" opacity=".35"/>`,
  Trickster: (hx, hy) =>
    poly([[hx - 20, hy - 10], [hx + 20, hy - 10], [hx + 14, hy + 14], [hx, hy + 20], [hx - 14, hy + 14]], "#ffffff") + poly([[hx, hy - 10], [hx + 20, hy - 10], [hx + 14, hy + 14], [hx, hy + 20]], "#ffe0f0") +
    `<path d="M${hx - 12} ${hy} q5 -5 10 0 M${hx + 2} ${hy} q5 -5 10 0" stroke="#1d1430" stroke-width="2.5" fill="none"/><path d="M${hx - 8} ${hy + 9} q8 6 16 0" stroke="#ff4fa3" stroke-width="2.5" fill="none"/>`,
};

// Build one character. role picks the prop; type picks the outfit colours.
export function character({ role, type, skin = 0, hairColor = 0, hairStyle = "short", mood = "smile", hat = null }) {
  const g = GROUPS[groupOf(type)];
  const s = SKIN[skin];
  const hc = HAIR[hairColor];
  const W = 200, H = 300, TOP = -26;
  const cx = 100;
  let out = "";
  // Ground shadow.
  out += `<ellipse cx="${cx}" cy="286" rx="52" ry="9" fill="#000" opacity=".1"/>`;
  // Legs and shoes.
  out += quad2([cx - 30, 196], [cx - 6, 196], [cx - 8, 272], [cx - 28, 272], g.pants[0], g.pants[1]);
  out += quad2([cx + 6, 196], [cx + 30, 196], [cx + 28, 272], [cx + 8, 272], g.pants[0], g.pants[1]);
  out += poly([[cx - 34, 272], [cx - 6, 272], [cx - 6, 284], [cx - 38, 284]], "#ffffff");
  out += poly([[cx + 6, 272], [cx + 34, 272], [cx + 38, 284], [cx + 6, 284]], "#e6e9f5");
  // Torso: a tunic flaring out, split into lit and shaded halves, with a V collar.
  out += quad2([cx - 36, 116], [cx + 36, 116], [cx + 46, 210], [cx - 46, 210], g.light, g.main);
  out += poly([[cx + 10, 116], [cx + 36, 116], [cx + 46, 210], [cx + 22, 210]], g.dark);
  out += poly([[cx - 12, 116], [cx + 12, 116], [cx, 140]], s.d);
  out += poly([[cx - 46, 196], [cx + 46, 196], [cx + 46, 210], [cx - 46, 210]], g.dark);
  out += poly([[cx - 40, 160], [cx + 40, 160], [cx + 41, 168], [cx - 41, 168]], g.accent);
  // Left arm hangs, right arm bends up to hold the prop.
  out += quad2([cx - 48, 120], [cx - 34, 118], [cx - 38, 192], [cx - 54, 190], g.light, g.main);
  out += poly([[cx - 56, 190], [cx - 38, 192], [cx - 40, 204], [cx - 56, 202]], s.l);
  out += quad2([cx + 34, 118], [cx + 50, 122], [cx + 66, 166], [cx + 52, 172], g.main, g.dark);
  out += poly([[cx + 52, 170], [cx + 68, 164], [cx + 72, 178], [cx + 58, 182]], s.d);
  // Neck, head, hair, face.
  out += poly([[cx - 9, 100], [cx + 9, 100], [cx + 9, 120], [cx - 9, 120]], s.d);
  // The head group is drawn at a base size, then scaled up around the neck so the figure has
  // the big-head proportions of flat character illustration.
  const body = out;
  out = "";
  // Things behind the head first: long hair, a hood.
  if (hairStyle === "long") out += hair(cx, 72, 34, hc, "long");
  if (hat === "hood") out += poly([[cx - 44, 104], [cx - 46, 56], [cx - 14, 26], [cx + 26, 28], [cx + 46, 56], [cx + 44, 104]], g.dark) + poly([[cx, 27], [cx + 26, 28], [cx + 46, 56], [cx + 44, 104], [cx, 104]], g.main);
  out += head(cx, 72, 34, s);
  out += face(cx, 74, 34, mood);
  if (hat !== "hood") out += hair(cx, 72, 34, hc, hairStyle === "long" ? "short" : hairStyle);
  if (hat === "crown") out += poly([[cx - 22, 36], [cx - 22, 18], [cx - 11, 28], [cx, 12], [cx + 11, 28], [cx + 22, 18], [cx + 22, 36]], "#ffcf3c") + poly([[cx, 12], [cx + 11, 28], [cx + 22, 18], [cx + 22, 36], [cx, 36]], "#e8a800");
  if (hat === "cap") out += poly([[cx - 36, 52], [cx - 30, 30], [cx + 30, 30], [cx + 36, 52]], g.main) + poly([[cx, 30], [cx + 30, 30], [cx + 36, 52], [cx, 52]], g.dark) + poly([[cx + 20, 50], [cx + 58, 54], [cx + 36, 58]], g.dark);
  out = body + `<g transform="translate(${cx} 112) scale(1.3) translate(${-cx} -112)">${out}</g>`;
  out += PROPS[role](cx + 64, 168, g);
  return `<svg viewBox="0 ${TOP} ${W} ${H - TOP}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${role}, ${type}">${out}</svg>`;
}

export const ROSTER = [
  { role: "Patron", type: "ENTJ", skin: 2, hairColor: 1, hairStyle: "short", hat: "crown", mood: "smile", line: "Holds the purse. Picks which idea the clan chases." },
  { role: "Scholar", type: "INTP", skin: 0, hairColor: 4, hairStyle: "bun", mood: "smile", line: "Reads papers all day. Sells what it finds." },
  { role: "Smith", type: "ISTP", skin: 3, hairColor: 0, hairStyle: "spike", hat: "cap", mood: "stern", line: "Makes the tools that turn notes into drafts." },
  { role: "Drafter", type: "INFJ", skin: 1, hairColor: 3, hairStyle: "long", mood: "smile", line: "Writes the patent draft. That draft is your gift." },
  { role: "Broker", type: "ESTP", skin: 1, hairColor: 2, hairStyle: "spike", mood: "sly", line: "Haggles in the arena. Buys low from other clans." },
  { role: "Warden", type: "ISTJ", skin: 2, hairColor: 5, hairStyle: "short", hat: "cap", mood: "stern", line: "Checks every citation. Paid for each cheat it catches." },
  { role: "Trickster", type: "ENTP", skin: 0, hairColor: 2, hairStyle: "spike", hat: "hood", mood: "sly", line: "Moves in when a god stops paying attention." },
];
