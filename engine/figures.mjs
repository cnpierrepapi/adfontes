// Patent-style figure renderer (the "figure kit"). The Drafter describes a figure as data;
// this draws it the way patent drawings look: black lines on white, hatching per material,
// a numeral on every part with a lead line, "FIG. n" underneath. Deterministic, so the
// Warden can check it and the site can show a named-parts key next to it.

import dagre from "@dagrejs/dagre";

const W = 520, H = 380;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const DEFS = `<defs>
<pattern id="h-diag" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#000" stroke-width="0.9"/></pattern>
<pattern id="h-cross" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V7M0 0H7" stroke="#000" stroke-width="0.8"/></pattern>
<pattern id="h-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="0.9" fill="#000"/></pattern>
<pattern id="h-wave" width="12" height="6" patternUnits="userSpaceOnUse"><path d="M0 3Q3 0 6 3T12 3" fill="none" stroke="#000" stroke-width="0.8"/></pattern>
<pattern id="h-brick" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M0 0H12M0 4H12M6 0V4M0 4V8" fill="none" stroke="#000" stroke-width="0.7"/></pattern>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#000"/></marker>
</defs>`;
const FILL = { none: "#fff", diagonal: "url(#h-diag)", cross: "url(#h-cross)", dots: "url(#h-dots)", wave: "url(#h-wave)", brick: "url(#h-brick)", solid: "#000" };

// A numeral with a curved lead line from (x,y) on the part to (tx,ty) outside it.
function numeral(n, x, y, tx, ty) {
  const mx = (x + tx) / 2 + (ty - y) * 0.15, my = (y + ty) / 2 - (tx - x) * 0.15;
  const anchor = tx < x ? "end" : "start";
  return `<path d="M${x} ${y}Q${mx} ${my} ${tx} ${ty}" fill="none" stroke="#000" stroke-width="0.9"/>` +
    `<text x="${tx + (anchor === "end" ? -4 : 4)}" y="${ty + 4}" font-family="Arial, sans-serif" font-size="13" text-anchor="${anchor}">${n}</text>`;
}

const frame = (label, body, w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${DEFS}${body}` +
  `<text x="${w / 2}" y="${h - 12}" font-family="Arial, sans-serif" font-size="15" font-weight="bold" text-anchor="middle">${esc(label)}</text></svg>`;

// Layers drawn bottom-up. width/offset let an electrode or contact sit on part of a layer.
function crossSection(f) {
  const layers = f.parts;
  const total = layers.reduce((a, p) => a + Math.max(0.5, Math.min(4, p.thickness || 1)), 0);
  const x0 = 110, x1 = 410, yBottom = 300, span = 230;
  let y = yBottom, out = "";
  layers.forEach((p, i) => {
    const h = (Math.max(0.5, Math.min(4, p.thickness || 1)) / total) * span;
    const w = (x1 - x0) * Math.max(0.1, Math.min(1, p.width || 1));
    const left = x0 + (x1 - x0 - w) * Math.max(0, Math.min(1, p.offset ?? 0.5));
    y -= h;
    out += `<rect x="${left}" y="${y}" width="${w}" height="${h}" fill="${FILL[p.hatch] || "#fff"}" stroke="#000" stroke-width="1.4"/>`;
    const side = i % 2 === 0 ? 1 : -1; // alternate numerals right/left so they never collide
    const px = side > 0 ? left + w - 8 : left + 8;
    out += numeral(p.n, px, y + h / 2, side > 0 ? x1 + 42 : x0 - 42, y + h / 2 - 6);
  });
  return frame(f.label, out);
}

// Flowcharts and system drawings are laid out by dagre (layered graph layout with edge
// routing), then drawn in patent style with each part's name inside its shape.
function wrap(name, max = 18) {
  const words = String(name).split(/\s+/), lines = [""];
  for (const w of words) {
    if ((lines.at(-1) + " " + w).trim().length > max && lines.at(-1)) lines.push(w);
    else lines[lines.length - 1] = (lines.at(-1) + " " + w).trim();
  }
  return lines.slice(0, 2).map((l, i, a) => (i === 1 && words.join(" ").length > a.join(" ").length ? l.slice(0, max - 1) + "…" : l));
}
const nameText = (x, y, name, size = 11) => {
  const lines = wrap(name);
  return lines.map((l, i) => `<text x="${x}" y="${y + (i - (lines.length - 1) / 2) * (size + 2) + size / 3}" font-family="Arial, sans-serif" font-size="${size}" text-anchor="middle">${esc(l)}</text>`).join("");
};

function graphFigure(f, opts, flipped = false) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: opts.rankdir, nodesep: opts.nodesep, ranksep: opts.ranksep, edgesep: 16, marginx: 30, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const byN = new Map(f.parts.map((p) => [String(p.n), p]));
  for (const p of f.parts) {
    const longest = Math.max(...wrap(p.name).map((l) => l.length));
    const size = opts.size(p, longest);
    g.setNode(String(p.n), { width: size.w, height: size.h });
  }
  let links = f.links?.length ? f.links : opts.defaultLinks(f.parts);
  links = links.filter((l) => byN.has(String(l.from)) && byN.has(String(l.to)) && l.from !== l.to);
  links.forEach((l, i) => g.setEdge(String(l.from), String(l.to), l.label ? { label: l.label, width: l.label.length * 7 + 6, height: 14, labelpos: "c" } : {}, `e${i}`));
  dagre.layout(g);

  // Canvas sized to the layout at real text size (the page scales the image, text stays crisp).
  const gw = g.graph().width, gh = g.graph().height;
  // Too wide to read once scaled to a page column: lay it out top-to-bottom instead.
  if (!flipped && opts.rankdir === "LR" && gw > 760) return graphFigure(f, { ...opts, rankdir: "TB" }, true);
  const cw = Math.max(W, Math.ceil(gw) + 40), ch = Math.max(260, Math.ceil(gh) + 66);
  let out = `<g transform="translate(${(cw - gw) / 2} 10)">`;
  for (const e of g.edges()) {
    const ed = g.edge(e), pts = ed.points;
    const d = "M" + pts.map((p) => `${p.x} ${p.y}`).join("L");
    out += `<path d="${d}" fill="none" stroke="#000" stroke-width="${opts.pipe}" stroke-linejoin="round" marker-end="url(#arr)"/>`;
    if (ed.label) out += `<rect x="${ed.x - ed.width / 2}" y="${ed.y - 8}" width="${ed.width}" height="15" fill="#fff"/><text x="${ed.x}" y="${ed.y + 4}" font-family="Arial" font-size="11" text-anchor="middle">${esc(ed.label)}</text>`;
  }
  for (const id of g.nodes()) {
    const nd = g.node(id), p = byN.get(id), x = nd.x, y = nd.y, w = nd.width, h = nd.height;
    out += opts.shape(p, x, y, w, h);
    // Lead line starts ON the drawn shape (diamond edge, circle rim, box corner).
    const [ax, ay] = p.shape === "diamond" ? [x + w / 4, y - h / 4] : p.shape === "circle" ? [x + Math.min(w, h) * 0.35, y - Math.min(w, h) * 0.35] : [x + w / 2 - 6, y - h / 2 + 4];
    out += numeral(p.n, ax, ay, ax + 22, ay - 16);
  }
  return frame(f.label, out + "</g>", cw, ch);
}

function flowchart(f) {
  return graphFigure(f, {
    rankdir: "TB", nodesep: 36, ranksep: 30, pipe: 1.3,
    size: (p, longest) => ({ w: Math.max(110, Math.min(190, longest * 7.2 + 28)) * (p.shape === "diamond" ? 1.35 : 1), h: p.shape === "diamond" ? 54 : 36 }),
    defaultLinks: (ps) => ps.slice(1).map((s, i) => ({ from: ps[i].n, to: s.n, label: "" })),
    shape: (p, x, y, w, h) =>
      (p.shape === "diamond"
        ? `<path d="M${x} ${y - h / 2}L${x + w / 2} ${y}L${x} ${y + h / 2}L${x - w / 2} ${y}Z" fill="#fff" stroke="#000" stroke-width="1.4"/>`
        : `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${p.shape === "terminal" ? h / 2 : 3}" fill="#fff" stroke="#000" stroke-width="1.4"/>`) + nameText(x, y, p.name),
  });
}

function system(f) {
  return graphFigure(f, {
    rankdir: "LR", nodesep: 34, ranksep: 46, pipe: 2.2,
    size: (p, longest) => {
      const w = Math.max(72, Math.min(130, longest * 6.6 + 22));
      return p.shape === "tank" ? { w, h: 92 } : p.shape === "circle" ? { w: Math.max(w, 74), h: Math.max(w, 74) } : p.shape === "diamond" ? { w: w * 1.3, h: 64 } : { w, h: 56 };
    },
    defaultLinks: () => [],
    shape: (p, x, y, w, h) => {
      const fill = FILL[p.hatch] || "#fff";
      let sh;
      if (p.shape === "tank") sh = `<path d="M${x - w / 2} ${y - h / 2 + 9}V${y + h / 2 - 9}A${w / 2} 9 0 0 0 ${x + w / 2} ${y + h / 2 - 9}V${y - h / 2 + 9}" fill="${fill}" stroke="#000" stroke-width="1.4"/><ellipse cx="${x}" cy="${y - h / 2 + 9}" rx="${w / 2}" ry="9" fill="#fff" stroke="#000" stroke-width="1.4"/>`;
      else if (p.shape === "circle") sh = `<circle cx="${x}" cy="${y}" r="${Math.min(w, h) / 2}" fill="${fill}" stroke="#000" stroke-width="1.4"/>`;
      else if (p.shape === "diamond") sh = `<path d="M${x} ${y - h / 2}L${x + w / 2} ${y}L${x} ${y + h / 2}L${x - w / 2} ${y}Z" fill="${fill}" stroke="#000" stroke-width="1.4"/>`;
      else sh = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="${fill}" stroke="#000" stroke-width="1.4"/>`;
      // Hatched parts get a small white label so the name stays readable.
      const lw = Math.min(w - 8, Math.max(...wrap(p.name).map((l) => l.length)) * 6 + 10), lines = wrap(p.name).length;
      const label = fill !== "#fff" ? `<rect x="${x - lw / 2}" y="${y + 6 - lines * 7.5}" width="${lw}" height="${lines * 13 + 4}" rx="3" fill="#fff" stroke="#000" stroke-width="0.6"/>` : "";
      return sh + label + nameText(x, y + 8, p.name, 10);
    },
  });
}

/** Draw a described figure. Returns SVG text. */
export function renderFigure(f) {
  if (f.kind === "cross_section") return crossSection(f);
  if (f.kind === "flowchart") return flowchart(f);
  return system(f);
}

/** The JSON schema the Drafter fills in for each figure. */
export const FIGURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["label", "caption", "kind", "parts", "links"],
  properties: {
    label: { type: "string" },
    caption: { type: "string" },
    kind: { type: "string", enum: ["cross_section", "flowchart", "system"] },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "name", "shape", "hatch", "thickness", "width", "offset"],
        properties: {
          n: { type: "integer" },
          name: { type: "string" },
          shape: { type: "string", enum: ["layer", "box", "tank", "circle", "diamond", "terminal"] },
          hatch: { type: "string", enum: ["none", "diagonal", "cross", "dots", "wave", "brick", "solid"] },
          thickness: { type: "number" },
          width: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
    links: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["from", "to", "label"], properties: { from: { type: "integer" }, to: { type: "integer" }, label: { type: "string" } } },
    },
  },
};
