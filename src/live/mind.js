// The mind constellation (SPEC §12f): a nation's mindmap drawn as stars above its island.
// Root just over the plate, each step of depth one layer higher, branches fanning out inside
// their parent's slice of the circle (a canopy). Positions come from a hash of each keyword, so
// a nation's sky looks the same on every visit and only grows.
//   researched = field colour · bought = white-gold + a thread to the seller's sky
//   absorbed from ruins = stone with a glint · frontier = faint dots · dead nation = all stone
//   the deepest unbroken line burns brighter · drafts = scrolls at the tip of that line
// Only the nation you're focused on shows its sky (live.js decides); the world view shows none.
// New points light in place. (Star launches wait for the Scholar figures, his call.)
import * as THREE from "three";

const HDR = (r, g, b) => new THREE.Color(r, g, b);
// The sky is bright day, so stars are solid coloured gems with a white rim (normal blending),
// not additive glow, which washes out to white haze on a gold sky. Cores sit a touch above 1.0
// so bloom gives them a soft glow.
const FIELD_HDR = { batteries: HDR(0.12, 0.5, 1.35), "solar cells": HDR(1.35, 0.62, 0.0), "carbon capture": HDR(0.0, 0.85, 0.42) };
const OTHER_HDR = HDR(0.75, 0.25, 1.2);
const BOUGHT = HDR(1.3, 0.2, 0.62); // the pink of the trade bridges
const FRONTIER = new THREE.Color(0.32, 0.3, 0.45);
const LINE_HOT = HDR(1.3, 0.56, 0.0);
const STONE = new THREE.Color(0xb3a99c);
const STONE_DARK = new THREE.Color(0x8a8074);
const GOLD_SCROLL = new THREE.Color(0xf0b02a), DULL_SCROLL = new THREE.Color(0x9a6a5a);

/** Stable 0..1 from a string (FNV-1a). */
function h(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return ((x >>> 0) % 100000) / 100000;
}
const now = () => performance.now() / 1000;
export const mindBase = (r) => r * 1.3 + 3.2; // the root sits just above the name plate

/** Lay the tree out: name -> { pos, level, node }. */
function layout(data, r) {
  const nodes = new Map();
  for (const p of data.points) nodes.set(p.point, { ...p, kind: "owned", kids: [] });
  for (const f of data.frontier || []) if (!nodes.has(f.point)) nodes.set(f.point, { ...f, kind: "frontier", kids: [] });
  const rootName = data.points.find((p) => !p.parent)?.point ?? data.field;
  if (!nodes.has(rootName)) nodes.set(rootName, { point: rootName, parent: null, kind: "owned", how: "root", kids: [] });
  const root = nodes.get(rootName);
  for (const n of nodes.values()) {
    if (n === root) continue;
    const par = nodes.get(n.parent);
    (par && par !== n ? par : root).kids.push(n);
  }
  // Walk from the root; anything not reached (a loop in the data) hangs off the root instead.
  const seen = new Set([root]), order = [root];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    n.kids = n.kids.filter((k) => !seen.has(k));
    for (const k of n.kids) { seen.add(k); order.push(k); }
  }
  for (const n of nodes.values()) if (!seen.has(n)) { n.kids = []; root.kids.push(n); seen.add(n); }

  const weight = (n) => (n.w ??= (n.kind === "owned" ? 1 : 0.45) + n.kids.reduce((a, k) => a + weight(k), 0));
  weight(root);
  let maxL = 1;
  (function lv(n, l) { n.level = l; if (l > maxL) maxL = l; for (const k of n.kids) lv(k, l + 1); })(root, 0);

  const Rmax = r * 1.25 + 2.6;
  const step = Math.min(1.0, 7 / maxL);
  const base = mindBase(r);
  const out = new Map();
  (function place(n, a0, a1) {
    const span = a1 - a0;
    const ang = (a0 + a1) / 2 + (h(n.point) - 0.5) * span * 0.3;
    const rad = n.level === 0 ? 0 : Rmax * Math.pow(n.level / maxL, 0.8) * (0.92 + h(n.point + "r") * 0.16);
    const y = base + n.level * step + (n.level ? (h(n.point + "y") - 0.5) * step * 0.5 : 0);
    out.set(n.point, { pos: new THREE.Vector3(Math.cos(ang) * rad, y, Math.sin(ang) * rad), level: n.level, node: n });
    const kids = [...n.kids].sort((a, b) => h(a.point) - h(b.point));
    let a = a0;
    for (const k of kids) { const s = (span * k.w) / (n.w - (n.kind === "owned" ? 1 : 0.45) || 1); place(k, a, a + s); a += s; }
  })(root, h(data.field || "x") * Math.PI * 2, h(data.field || "x") * Math.PI * 2 + Math.PI * 2);
  return { at: out, root: rootName, maxL, step, base, reach: Rmax };
}

const glowVert = `
  attribute float size; attribute float born; attribute float phase; attribute vec3 color;
  uniform float uTime, uPx, uFade; varying vec3 vC; varying float vA, vF;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float k = clamp((uTime - born) / 1.8, 0.0, 1.0);
    float grow = k < 1.0 ? 1.0 + 2.70158 * pow(k - 1.0, 3.0) + 1.70158 * pow(k - 1.0, 2.0) : 1.0; // ease out, small overshoot
    float tw = 0.88 + 0.12 * sin(uTime * 2.1 + phase);
    gl_PointSize = max(0.0, size * grow * tw * uPx / -mv.z);
    vC = color; vF = 1.0 - k; // a new star flashes white as it lights
    vA = uFade;
    gl_Position = projectionMatrix * mv;
  }`;
const glowFrag = `
  varying vec3 vC; varying float vA, vF;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    // gem: coloured core with a highlight, a white rim, then a soft halo of its own colour
    float core = 1.0 - smoothstep(0.5, 0.56, d);
    float rim = smoothstep(0.5, 0.56, d) * (1.0 - smoothstep(0.64, 0.7, d));
    float halo = (1.0 - smoothstep(0.66, 1.0, d)) * smoothstep(0.62, 0.7, d) * 0.16;
    vec3 col = vC * (0.85 + 0.6 * smoothstep(0.5, 0.0, length(c - vec2(-0.08, -0.1)) * 2.0));
    col = mix(col, vec3(1.0), rim * 0.95);
    col = mix(col, vec3(2.2, 2.1, 1.9), vF);
    float a = max(core, rim) + halo;
    gl_FragColor = vec4(col, min(1.0, a) * vA);
  }`;
const stoneVert = `
  attribute float size; attribute float born; attribute float phase; attribute float glint; attribute float hollow; attribute vec3 color;
  uniform float uTime, uPx, uFade; varying vec3 vC; varying float vA, vG, vH, vP;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float k = clamp((uTime - born) / 1.8, 0.0, 1.0);
    float grow = k < 1.0 ? 1.0 + 2.70158 * pow(k - 1.0, 3.0) + 1.70158 * pow(k - 1.0, 2.0) : 1.0;
    gl_PointSize = max(0.0, size * grow * uPx / -mv.z);
    vC = color; vA = uFade * (hollow > 0.5 ? 0.5 : 1.0); vG = glint * (1.0 + (1.0 - k) * 3.0); vH = hollow; vP = phase;
    gl_Position = projectionMatrix * mv;
  }`;
const stoneFrag = `
  uniform float uTime; varying vec3 vC; varying float vA, vG, vH, vP;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0 || (vH > 0.5 && d < 0.62)) discard; // taken by another nation: an empty socket
    float lit = 0.78 + 0.5 * (-c.x - c.y);             // light from the upper left, like the sun
    vec3 col = vC * lit * (1.0 - smoothstep(0.72, 1.0, d) * 0.4);
    float spark = vG * pow(max(0.0, sin(uTime * 1.6 + vP)), 10.0) * smoothstep(0.28, 0.0, length(c - vec2(-0.14, -0.16)));
    col += vec3(2.6, 2.4, 1.9) * spark;
    gl_FragColor = vec4(col, vA);
  }`;

/**
 * Build one nation's constellation. `ctx` = { islands, clanName, fresh: Set of names to light now, fade }.
 * Returns { group, update(nearK, px), pick(ray) -> tip | null, light(names), names, dispose() }.
 */
export function buildMind(data, isl, ctx) {
  const r = isl.userData.r;
  const dead = data.alive === false;
  const L = layout(data, r);
  const field = FIELD_HDR[data.field] ?? OTHER_HDR;
  const lineSet = new Set(data.line || []);
  const fresh = ctx.fresh || new Set();
  const t0 = now();
  const group = new THREE.Group();
  group.name = "mind";

  // Sort every point into glowing stars or stone ones.
  const glow = [], stone = [];
  for (const [name, { pos, node }] of L.at) {
    const born = fresh.has(name) ? t0 : -1e4;
    const hot = lineSet.has(name);
    if (node.kind === "frontier") { glow.push({ name, pos, color: FRONTIER.clone(), size: dead ? 0.36 : 0.5, born, node }); continue; }
    const how = node.how || "";
    if (dead) { stone.push({ name, pos, color: name === L.root ? STONE_DARK : STONE, size: name === L.root ? 0.7 : 0.48, born, glint: 0, hollow: node.taken ? 1 : 0, node }); continue; }
    if (how.startsWith("absorbed")) { stone.push({ name, pos, color: STONE, size: hot ? 0.6 : 0.5, born, glint: 1, hollow: 0, node }); continue; }
    const c = name === L.root ? field.clone().multiplyScalar(1.15) : how.startsWith("bought") ? BOUGHT.clone() : field.clone();
    glow.push({ name, pos, color: c, size: name === L.root ? 1.5 : hot ? 1.15 : 0.85, born, node });
  }

  const uniforms = { uTime: { value: now() }, uPx: { value: 600 }, uFade: { value: 0 } };
  function points(list, vert, frag, extra, matOpts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(list.flatMap((s) => s.pos.toArray()), 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(list.flatMap((s) => [s.color.r, s.color.g, s.color.b]), 3));
    g.setAttribute("size", new THREE.Float32BufferAttribute(list.map((s) => s.size), 1));
    g.setAttribute("born", new THREE.Float32BufferAttribute(list.map((s) => s.born), 1));
    g.setAttribute("phase", new THREE.Float32BufferAttribute(list.map((s) => h(s.name + "p") * 6.283), 1));
    for (const a of extra) g.setAttribute(a, new THREE.Float32BufferAttribute(list.map((s) => s[a]), 1));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, ...matOpts }));
    m.userData.list = list;
    m.frustumCulled = false;
    group.add(m);
    return m;
  }
  const glowPts = glow.length ? points(glow, glowVert, glowFrag, [], { depthWrite: false }) : null;
  const stonePts = stone.length ? points(stone, stoneVert, stoneFrag, ["glint", "hollow"], { depthWrite: false }) : null;

  // Links: each point to its parent. Owned links glow faintly; frontier ones barely.
  const lv = [], lc = [];
  for (const [name, { pos, node }] of L.at) {
    if (name === L.root) continue;
    const par = L.at.get(node.parent) ?? L.at.get(L.root);
    const c = dead ? STONE_DARK.clone() : node.kind === "frontier" ? FRONTIER.clone() : (node.how || "").startsWith("bought") ? BOUGHT.clone().multiplyScalar(0.8) : field.clone().multiplyScalar(0.8);
    if (node.kind === "frontier") c.lerp(new THREE.Color(0xf3dfae), 0.45); // frontier links melt into the sky
    lv.push(...par.pos.toArray(), ...pos.toArray());
    lc.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lv, 3));
  lg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
  const links = new THREE.LineSegments(lg, linkMat);
  group.add(links);

  // The deepest unbroken line: a burning thread with beads of light climbing it.
  const hotMat = new THREE.MeshBasicMaterial({ color: LINE_HOT, transparent: true, opacity: 0, depthWrite: false });
  const beadMat = new THREE.MeshBasicMaterial({ color: HDR(2.4, 2.2, 1.7), transparent: true, opacity: 0, depthWrite: false });
  const chain = (data.line || []).map((n) => L.at.get(n)?.pos).filter(Boolean);
  let hotCurve = null;
  const beads = [];
  if (!dead && chain.length >= 2) {
    hotCurve = new THREE.CatmullRomCurve3(chain, false, "centripetal");
    group.add(new THREE.Mesh(new THREE.TubeGeometry(hotCurve, chain.length * 10, 0.04, 6), hotMat));
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), beadMat); group.add(b); beads.push(b); }
  }

  // Threads to the seller's sky for bought points.
  const tv = [], ta = [];
  const me = new THREE.Vector3(isl.position.x, isl.userData.baseY, isl.position.z);
  for (const s of glow) {
    const m = /^bought from clan (\d+)/.exec(s.node.how || "");
    const seller = m && ctx.islands.get(Number(m[1]));
    if (!seller) continue;
    const end = new THREE.Vector3(seller.position.x, seller.userData.baseY + mindBase(seller.userData.r), seller.position.z).sub(me);
    const mid = s.pos.clone().lerp(end, 0.5);
    mid.y += 1.5 + s.pos.distanceTo(end) * 0.12;
    const curve = new THREE.QuadraticBezierCurve3(s.pos, mid, end);
    const pts = curve.getPoints(28);
    for (let i = 0; i < pts.length - 1; i++) {
      tv.push(...pts[i].toArray(), ...pts[i + 1].toArray());
      ta.push(1 - i / 28, 1 - (i + 1) / 28); // fades toward the seller
    }
  }
  // Per-vertex alpha so a thread fades out toward the seller.
  const threadMat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 }, uC: { value: BOUGHT } }, transparent: true, depthWrite: false,
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uFade; uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC, vA * vA * uFade); }`,
  });
  if (tv.length) {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.Float32BufferAttribute(tv, 3));
    tg.setAttribute("alpha", new THREE.Float32BufferAttribute(ta, 1));
    const threads = new THREE.LineSegments(tg, threadMat);
    threads.frustumCulled = false;
    group.add(threads);
  }

  // Drafts: little scrolls hanging round the tip of the line (gold = the Warden passed it).
  const scrolls = [];
  const tip = chain.length ? chain[chain.length - 1] : L.at.get(L.root).pos;
  const drafts = dead ? [] : (data.drafts || []).slice(0, 6);
  drafts.forEach((d, i) => {
    const g = new THREE.Group();
    const col = d.passed ? GOLD_SCROLL : DULL_SCROLL;
    // Lit and shaded (flat colour washed out to cream under the tone mapping).
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: d.passed ? 0x8a5200 : 0x2a1410, emissiveIntensity: 0.55, metalness: d.passed ? 0.35 : 0, roughness: 0.45, transparent: true, opacity: 0, side: THREE.DoubleSide, flatShading: true });
    const capMat = new THREE.MeshStandardMaterial({ color: d.passed ? 0x8a4a0c : 0x5a3a30, roughness: 0.6, transparent: true, opacity: 0, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.36, 10), mat);
    body.rotation.z = Math.PI / 2;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), mat);
    sheet.position.y = -0.11;
    for (const x of [-0.2, 0.2]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), capMat); cap.rotation.z = Math.PI / 2; cap.position.x = x; g.add(cap); }
    g.add(body, sheet);
    const a = (i / Math.max(1, drafts.length)) * Math.PI * 2 + h(d.id) * 0.6;
    g.position.copy(tip).add(new THREE.Vector3(Math.cos(a) * 1.1, 0.8 + (i % 2) * 0.4, Math.sin(a) * 1.1));
    g.scale.setScalar(1.9);
    g.userData = { draft: d, a, base: g.position.clone(), mats: [mat, capMat] };
    group.add(g);
    scrolls.push(g);
  });

  const names = new Set(L.at.keys());
  let fade = ctx.fade ?? 0; // carried over on a rebuild, so the sky doesn't blink
  return {
    group, names, layout: L,
    get fade() { return fade; },
    /** nearK: 0 far away (only a faint shimmer) .. 1 flown in. px = pixels per world unit at distance 1. */
    update(nearK, px) {
      fade += (nearK - fade) * 0.08;
      const t = now();
      uniforms.uTime.value = t;
      uniforms.uPx.value = px;
      uniforms.uFade.value = fade; // far away the sky is gone; the plate already names the nation
      group.visible = fade > 0.01;
      linkMat.opacity = fade * (dead ? 0.6 : 0.7);
      threadMat.uniforms.uFade.value = fade * 0.75;
      hotMat.opacity = fade * 0.95;
      beadMat.opacity = fade;
      if (hotCurve) beads.forEach((b, i) => b.position.copy(hotCurve.getPoint(((t * 0.12) + i / beads.length) % 1)));
      for (const s of scrolls) {
        const u = s.userData;
        s.position.copy(u.base).y += Math.sin(t * 0.9 + u.a * 3) * 0.06;
        s.rotation.y = t * 0.3 + u.a;
        for (const m of u.mats) m.opacity = fade;
        s.visible = fade > 0.02;
      }
    },
    /** What the cursor is over: a star (keyword + where it came from) or a scroll (draft). */
    pick(ray) {
      if (fade < 0.5) return null;
      const hits = [];
      for (const p of [glowPts, stonePts]) if (p) for (const hit of ray.intersectObject(p)) hits.push({ ...hit, list: p.userData.list });
      for (const s of scrolls) for (const hit of ray.intersectObject(s, true)) hits.push({ ...hit, scroll: s });
      if (!hits.length) return null;
      hits.sort((a, b) => a.distanceToRay - b.distanceToRay || a.distance - b.distance);
      const top = hits.find((x) => x.scroll) ?? hits[0];
      if (top.scroll) {
        const d = top.scroll.userData.draft;
        return { title: d.title, sub: `Draft, day ${d.day} · ${d.passed ? "the Warden passed it" : "failed the Warden"}`, kind: d.passed ? "gift" : "warden" };
      }
      const s = top.list[top.index];
      return { title: s.name, sub: describe(s.node, dead, ctx.clanName), corpus: s.node.corpus?.title ?? null, kind: s.node.kind === "frontier" ? "frontier" : dead || (s.node.how || "").startsWith("absorbed") ? "stone" : (s.node.how || "").startsWith("bought") ? "trade" : "corpus" };
    },
    /** Light named stars again (a record about them just played). */
    light(list) {
      const t = now();
      for (const p of [glowPts, stonePts]) {
        if (!p) continue;
        const born = p.geometry.attributes.born;
        p.userData.list.forEach((s, i) => { if (list.includes(s.name)) born.setX(i, t); });
        born.needsUpdate = true;
      }
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      group.removeFromParent();
    },
  };
}

function describe(node, dead, clanName) {
  if (node.kind === "frontier") return "Not learned yet: one step out from what this nation knows";
  const how = node.how || "";
  if (!node.parent || how === "root") return dead ? "The root of a dead nation" : "The root: this nation's field";
  if (dead) return node.taken ? "Ruin, since absorbed by another nation" : "Ruin: waits for a nation whose map reaches it";
  let m;
  if ((m = /^bought from clan (\d+)/.exec(how))) return `Bought from ${clanName(Number(m[1]))}`;
  if ((m = /^absorbed from ruins of clan (\d+)/.exec(how))) return `Taken from the ruins of ${clanName(Number(m[1]))}`;
  return "Researched by this nation's Scholars";
}
