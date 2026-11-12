// The hero world: bright floating islands with temples, waterfalls, fountains, schools of
// fish-birds and tiny agents. Everything is built in code (no model files).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const PAL = {
  skyTop: 0x6fe3ff,
  skyMid: 0x37c9e6,
  horizon: 0xffe2a8,
  sea: 0x10b8cc,
  grass: [0x7ef0a0, 0xb6f26a, 0xff9fc6, 0x9ff3e0, 0xffd36e],
  rock: [0xffb37a, 0xff8f8f, 0xc9a2ff, 0xffc98f],
  stone: 0xfff6e6,
  dome: [0xffc93c, 0xff6f61, 0x8a5cff, 0x2fa8ff, 0xff4fa3],
  water: 0xbff8ff,
  agent: [0x8a5cff, 0x33c481, 0x2fa8ff, 0xffb21e],
};

let seed = 7;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const range = (a, b) => a + (b - a) * rnd();
export const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

export function facetColors(geo, base, jitter = 0.08, light = new THREE.Vector3(-0.4, 1, 0.5).normalize()) {
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color(base);
  const hsl = {};
  c.getHSL(hsl);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const lit = Math.max(0, n.dot(light));
    const j = (rnd() - 0.5) * jitter;
    const t = new THREE.Color().setHSL(hsl.h + j * 0.2, Math.min(1, hsl.s * 1.05), Math.min(0.92, hsl.l * (0.78 + 0.32 * lit) + j));
    for (let k = 0; k < 3; k++) cols.set([t.r, t.g, t.b], (i + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}

const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

export function mesh(geo, color, jitter) {
  return new THREE.Mesh(facetColors(geo, color, jitter), flatMat);
}

/** Merge the still pieces under `root` that share the flat material into one drawn shape per shadow setting
 *  (12 Nov: ~3,400 draw calls a frame with 13 nations, most of them single planks and rocks). The merged
 *  shape stays in `root`'s own space, so `root` keeps its place, size and tags. Skips: anything under an
 *  object with userData.noMerge (animated or read by other code), skinned or instanced meshes, other materials.
 *  Tested in tests/merge.test.mjs. */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  // The size as three.js measured it before (a box of each piece's box): the townsfolk walk round buildings
  // by this footprint, so it's kept exactly (a merged shape measures tighter).
  if (!root.userData.size) root.userData.size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).toArray();
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.material !== flatMat || o.isSkinnedMesh || o.isInstancedMesh || o.userData.noMerge) return;
    for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData.noMerge) return;
    const g = o.geometry;
    const key = `${o.castShadow}|${o.receiveShadow}|${Object.keys(g.attributes).sort().join(",")}|${g.index ? "i" : "n"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  let merged = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => o.geometry.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld)));
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    const m = new THREE.Mesh(geo, flatMat);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
    m.userData.merged = list.length;
    for (const o of list) { o.removeFromParent(); o.geometry.dispose(); }
    root.add(m);
    merged += list.length;
  }
  // Groups left empty by the merge are dropped (they drew nothing). (A building keeps its group: see townShell.)
  const empty = [];
  root.traverse((o) => { if (o !== root && o.isGroup && !o.children.length && !o.userData.noMerge && Object.keys(o.userData).length === 0) empty.push(o); });
  for (const o of empty) o.removeFromParent();
  return merged;
}

// One floating island: a grass cap with an overhanging lip, a cliff band, and a layered rock
// underside (strata) tapering to a point, with boulders and hanging crystals.
export function island(radius, opts = {}) {
  const g = new THREE.Group();
  const grass = opts.grass ?? pick(PAL.grass);
  const rock = opts.rock ?? pick(PAL.rock);
  const seg = 14;
  const jag = Array.from({ length: seg }, () => range(0.9, 1.08));
  const shape = (geo, yMin, yMax, amt) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      const k = jag[Math.round((a / (Math.PI * 2)) * seg) % seg];
      if (y >= yMin && y <= yMax) { pos.setX(i, x * (1 + (k - 1) * amt)); pos.setZ(i, z * (1 + (k - 1) * amt)); }
    }
  };

  // Grass cap: gently domed top, lip slightly wider than the cliff below.
  const cap = new THREE.CylinderGeometry(radius * 1.04, radius * 1.0, radius * 0.16, seg, 2);
  cap.translate(0, -radius * 0.08, 0);
  shape(cap, -10, 10, 1);
  const cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i), r = Math.hypot(cp.getX(i), cp.getZ(i)) / radius;
    if (y > -radius * 0.01) cp.setY(i, y + (1 - r * r) * radius * 0.05 + range(-0.012, 0.02) * radius);
  }
  const capM = mesh(cap, grass, 0.1);
  capM.receiveShadow = true;
  g.add(capM);

  // Cliff band just under the grass, lighter earth.
  const band = new THREE.CylinderGeometry(radius * 0.98, radius * 0.9, radius * 0.22, seg, 1);
  band.translate(0, -radius * 0.27, 0);
  shape(band, -10, 10, 1);
  g.add(mesh(band, 0xffe0b0, 0.08));

  // Rock underside in three strata of shifting colour.
  const tones = [rock, new THREE.Color(rock).offsetHSL(0.02, 0, -0.06).getHex(), new THREE.Color(rock).offsetHSL(-0.02, 0.05, -0.12).getHex()];
  const layers = [[0.9, 0.6, 0.42], [0.6, 0.28, 0.5], [0.28, 0.0, 0.7]];
  let y0 = -radius * 0.38;
  layers.forEach(([rTop, rBot, h], i) => {
    const hh = h * radius;
    const geo = new THREE.CylinderGeometry(radius * rTop, Math.max(0.001, radius * rBot), hh, seg, 2);
    geo.translate(0, y0 - hh / 2, 0);
    shape(geo, -100, 100, 1.2 + i * 0.2);
    const gp = geo.attributes.position;
    for (let k = 0; k < gp.count; k++) gp.setX(k, gp.getX(k) + range(-0.02, 0.02) * radius);
    g.add(mesh(geo, tones[i], 0.14));
    y0 -= hh;
  });

  // Boulders on the grass edge and crystals hanging below.
  for (let i = 0; i < Math.round(radius * 2); i++) {
    const a = rnd() * Math.PI * 2;
    const b = mesh(new THREE.DodecahedronGeometry(radius * range(0.04, 0.08), 0), pick([0xfff1e0, 0xe9d8ff, 0xffd9c2]), 0.1);
    b.position.set(Math.cos(a) * radius * 0.9, 0.02, Math.sin(a) * radius * 0.9);
    b.castShadow = true;
    g.add(b);
  }
  for (let i = 0; i < 6; i++) {
    const c = mesh(new THREE.OctahedronGeometry(radius * range(0.06, 0.12), 0), pick([0xffffff, 0xbff8ff, 0xffd6f0, 0xd9c8ff]), 0.1);
    const a = rnd() * Math.PI * 2;
    c.position.set(Math.cos(a) * radius * range(0.25, 0.5), -radius * range(0.6, 1.2), Math.sin(a) * radius * range(0.25, 0.5));
    c.scale.y = 1.9;
    g.add(c);
  }
  g.userData.radius = radius;
  return g;
}

export function shadowed(o) {
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return o;
}

// A temple: three stepped plinths, columns with capitals, an architrave ring, a dome and spire.
export function temple(h, dome) {
  const g = new THREE.Group();
  [[1.0, 0.0], [0.86, 0.07], [0.74, 0.14]].forEach(([w, y]) => {
    const step = mesh(new THREE.BoxGeometry(h * w, h * 0.07, h * w), PAL.stone, 0.04);
    step.position.y = y * h + h * 0.035;
    g.add(step);
  });
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * h * 0.3, z = Math.sin(a) * h * 0.3;
    const col = mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.042, h * 0.56, 8), PAL.stone, 0.03);
    col.position.set(x, h * 0.49, z);
    g.add(col);
    const cap = mesh(new THREE.BoxGeometry(h * 0.1, h * 0.04, h * 0.1), 0xffe9c4, 0.03);
    cap.position.set(x, h * 0.79, z);
    g.add(cap);
  }
  const inner = mesh(new THREE.CylinderGeometry(h * 0.2, h * 0.2, h * 0.56, 10), new THREE.Color(dome).offsetHSL(0, -0.2, 0.25).getHex(), 0.05);
  inner.position.y = h * 0.49;
  g.add(inner);
  const ring = mesh(new THREE.CylinderGeometry(h * 0.38, h * 0.38, h * 0.09, 16), PAL.stone, 0.03);
  ring.position.y = h * 0.85;
  g.add(ring);
  const trim = mesh(new THREE.CylinderGeometry(h * 0.39, h * 0.39, h * 0.025, 16), dome, 0.05);
  trim.position.y = h * 0.81;
  g.add(trim);
  const d = mesh(new THREE.SphereGeometry(h * 0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome, 0.08);
  d.position.y = h * 0.89;
  g.add(d);
  const lantern = mesh(new THREE.CylinderGeometry(h * 0.06, h * 0.07, h * 0.12, 8), PAL.stone, 0.03);
  lantern.position.y = h * 1.26;
  g.add(lantern);
  const spire = mesh(new THREE.ConeGeometry(h * 0.05, h * 0.26, 6), 0xffe27a, 0.05);
  spire.position.y = h * 1.45;
  g.add(spire);
  return shadowed(g);
}

// A tower: tapered body with window slits, a balcony ring, a pointed roof and a banner.
export function tower(h, roof) {
  const g = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(h * 0.15, h * 0.2, h, 8), PAL.stone, 0.05);
  body.position.y = h / 2;
  g.add(body);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const w = mesh(new THREE.BoxGeometry(h * 0.05, h * 0.12, h * 0.02), 0x3a2a5c, 0.02);
    const r = h * 0.165;
    w.position.set(Math.cos(a) * r, h * (0.45 + (i % 2) * 0.25), Math.sin(a) * r);
    w.rotation.y = -a + Math.PI / 2;
    g.add(w);
  }
  const bal = mesh(new THREE.CylinderGeometry(h * 0.23, h * 0.2, h * 0.06, 10), new THREE.Color(roof).offsetHSL(0, 0, 0.15).getHex(), 0.05);
  bal.position.y = h * 0.98;
  g.add(bal);
  const r = mesh(new THREE.ConeGeometry(h * 0.25, h * 0.5, 8), roof, 0.1);
  r.position.y = h + h * 0.27;
  g.add(r);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.008, h * 0.008, h * 0.25, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  pole.position.y = h * 1.62;
  g.add(pole);
  const fg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(h * 0.16, -h * 0.04, 0), new THREE.Vector3(0, -h * 0.09, 0)]);
  const flag = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: pick([0xff4fa3, 0xff6f61, 0x8a5cff]), side: THREE.DoubleSide }));
  flag.position.y = h * 1.74;
  g.add(flag);
  return shadowed(g);
}

// A house: walls, a door and windows, a hip roof with a small chimney.
export function house(s, roof) {
  const g = new THREE.Group();
  const b = mesh(new THREE.BoxGeometry(s, s * 0.8, s * 0.9), pick([0xffffff, 0xfff1d6, 0xffe6f2, 0xe8f7ff]), 0.04);
  b.position.y = s * 0.4;
  g.add(b);
  const door = mesh(new THREE.BoxGeometry(s * 0.2, s * 0.36, s * 0.02), 0xb86a3c, 0.02);
  door.position.set(0, s * 0.18, s * 0.46);
  g.add(door);
  [-0.3, 0.3].forEach((x) => {
    const w = mesh(new THREE.BoxGeometry(s * 0.16, s * 0.16, s * 0.02), 0x5ad1f0, 0.02);
    w.position.set(x * s, s * 0.5, s * 0.46);
    g.add(w);
  });
  const r = mesh(new THREE.ConeGeometry(s * 0.82, s * 0.62, 4), roof, 0.1);
  r.rotation.y = Math.PI / 4;
  r.position.y = s * 0.8 + s * 0.31;
  g.add(r);
  const ch = mesh(new THREE.BoxGeometry(s * 0.12, s * 0.3, s * 0.12), 0xfff1e0, 0.03);
  ch.position.set(s * 0.25, s * 1.1, -s * 0.15);
  g.add(ch);
  return shadowed(g);
}

// A tree: trunk and two or three stacked faceted canopies in related colours.
export function tree(s) {
  const g = new THREE.Group();
  const t = mesh(new THREE.CylinderGeometry(s * 0.05, s * 0.08, s * 0.55, 6), 0xc98a5a, 0.05);
  t.position.y = s * 0.27;
  g.add(t);
  const base = pick([0x4fe39a, 0x9cf06a, 0xff8fc8, 0x5ff2df, 0xffb86b]);
  const layers = rnd() < 0.5 ? 2 : 3;
  for (let i = 0; i < layers; i++) {
    const c = new THREE.Color(base).offsetHSL(0, 0, i * 0.06).getHex();
    const f = mesh(new THREE.IcosahedronGeometry(s * (0.36 - i * 0.08), 1), c, 0.14);
    f.position.set(range(-0.05, 0.05) * s, s * (0.62 + i * 0.22), range(-0.05, 0.05) * s);
    f.scale.y = 0.85;
    g.add(f);
  }
  return shadowed(g);
}

// A fountain: stone basin, a pillar, and a particle spray that rises and falls.
export function fountain(s, sprays) {
  const g = new THREE.Group();
  const basin = mesh(new THREE.CylinderGeometry(s, s * 1.05, s * 0.3, 10), PAL.stone, 0.04);
  basin.position.y = s * 0.15;
  g.add(basin);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(s * 0.88, 10), new THREE.MeshBasicMaterial({ color: 0x8ff4ff }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = s * 0.31;
  g.add(pool);
  const pillar = mesh(new THREE.CylinderGeometry(s * 0.12, s * 0.16, s * 0.7, 6), PAL.stone, 0.04);
  pillar.position.y = s * 0.55;
  g.add(pillar);
  const bowl = mesh(new THREE.CylinderGeometry(s * 0.42, s * 0.18, s * 0.16, 8), PAL.stone, 0.04);
  bowl.position.y = s * 0.92;
  g.add(bowl);

  const N = 140;
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: s * 0.09, transparent: true, opacity: 0.95, depthWrite: false }));
  g.add(pts);
  const life = Array.from({ length: N }, () => rnd());
  const dir = Array.from({ length: N }, () => [range(-1, 1), range(-1, 1)]);
  sprays.push((t) => {
    for (let i = 0; i < N; i++) {
      const k = (life[i] + t * 0.45) % 1;
      const r = k * s * 0.85;
      p[i * 3] = dir[i][0] * r;
      p[i * 3 + 2] = dir[i][1] * r;
      p[i * 3 + 1] = s * 1.0 + s * 1.6 * k - s * 2.2 * k * k;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return g;
}

// A waterfall: a ribbon falling off an island edge, with a scrolling striped shader and mist.
export const fallUniforms = { uTime: { value: 0 } };
const fallMat = new THREE.ShaderMaterial({
  uniforms: fallUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform float uTime; varying vec2 vUv;
    float h(float x){ return fract(sin(x*91.7)*437.5); }
    void main(){
      float col = floor(vUv.x * 9.0);
      float speed = 0.9 + h(col) * 0.6;
      float s = fract(vUv.y * 5.0 + uTime * speed + h(col) * 3.0);
      float streak = smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.55, 1.0, s));
      vec3 c = mix(vec3(0.55,0.95,1.0), vec3(1.0), streak);
      float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
      float fade = smoothstep(0.0, 0.35, vUv.y);
      gl_FragColor = vec4(c, (0.55 + 0.45 * streak) * edge * fade);
    }`,
});

export function waterfall(width, height) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(width, height, 1, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (height / 2 - y) / height;
    pos.setZ(i, t * t * width * 1.4);
  }
  geo.translate(0, -height / 2, 0);
  g.add(new THREE.Mesh(geo, fallMat));
  return g;
}

export function mist(count, spread, sprays) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  const base = Array.from({ length: count }, () => [range(-spread, spread), range(0, spread * 0.6), range(-spread, spread) * 0.5]);
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: spread * 0.22, transparent: true, opacity: 0.35, depthWrite: false }));
  sprays.push((t) => {
    for (let i = 0; i < count; i++) {
      const b = base[i];
      p[i * 3] = b[0] + Math.sin(t * 0.7 + i) * spread * 0.1;
      p[i * 3 + 1] = (b[1] + t * 0.5 * spread * 0.2) % (spread * 0.6);
      p[i * 3 + 2] = b[2];
    }
    geo.attributes.position.needsUpdate = true;
  });
  return pts;
}

// Tiny agents walking a loop on an island top, coloured by temperament group.
export function agent(color) {
  const g = new THREE.Group();
  const dark = new THREE.Color(color).offsetHSL(0, 0, -0.25).getHex();
  [-0.035, 0.035].forEach((x) => {
    const leg = mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), dark, 0.05);
    leg.position.set(x, 0.06, 0);
    g.add(leg);
  });
  const body = mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.17, 6), color, 0.12);
  body.position.y = 0.2;
  g.add(body);
  const head = mesh(new THREE.IcosahedronGeometry(0.075, 0), pick([0xffd9bf, 0xe8b48c, 0xb97a52, 0x7f4f33]), 0.08);
  head.position.y = 0.36;
  g.add(head);
  const hair = mesh(new THREE.SphereGeometry(0.078, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2.2), pick([0x3b2a4d, 0x2b1e16, 0xff6f61, 0xffe27a]), 0.05);
  hair.position.y = 0.37;
  g.add(hair);
  return shadowed(g);
}

// Schools of fish-birds circling between islands (the ABZU-ish life of the sky).
export function school(n, color, sprays, radius, y) {
  const g = new THREE.Group();
  const fish = [];
  for (let i = 0; i < n; i++) {
    const f = mesh(new THREE.ConeGeometry(0.045, 0.2, 4), color, 0.15);
    f.rotation.z = -Math.PI / 2;
    const w = new THREE.Group();
    w.add(f);
    g.add(w);
    fish.push({ w, off: rnd() * Math.PI * 2, r: radius + range(-0.8, 0.8), h: y + range(-0.5, 0.5), sp: range(0.12, 0.18) });
  }
  sprays.push((t) => {
    for (const f of fish) {
      const a = t * f.sp + f.off * 0.15;
      f.w.position.set(Math.cos(a) * f.r + Math.sin(f.off) * 0.6, f.h + Math.sin(t * 2 + f.off) * 0.15, Math.sin(a) * f.r + Math.cos(f.off) * 0.6);
      f.w.rotation.y = -a;
    }
  });
  return g;
}

/** One drawn shape for a whole town (12 Nov). Each building (already merged by mergeStatic) stays in `town` as
 *  its own group, with its place, tags and footprint, because the townsfolk read them and the close-up town
 *  hides some; but its pieces stop drawing and the visible buildings draw together as one shape (one per
 *  shadow setting) inside `town`. Call again after hiding or showing a building. Matrices are taken from
 *  inside the town, so a town mid-rise (scaled) is baked in at full size. Tested in tests/merge.test.mjs. */
export function townShell(town) {
  for (const old of town.children.filter((c) => c.userData.shell)) { old.removeFromParent(); old.geometry.dispose(); }
  const buckets = new Map();
  for (const o of town.children) {
    if (o.userData.noMerge || o.userData.shell) continue;
    o.updateMatrix();
    o.traverse((m) => {
      if (m === o || !m.isMesh || m.material !== flatMat) return;
      m.visible = false; // drawn by the shell
      if (!o.visible) return;
      // The piece's matrix relative to the town: building matrix x each step down to the piece.
      const rel = o.matrix.clone();
      const chain = [];
      for (let p = m; p && p !== o; p = p.parent) chain.unshift(p);
      for (const p of chain) { p.updateMatrix(); rel.multiply(p.matrix); }
      const key = `${m.castShadow}|${m.receiveShadow}|${Object.keys(m.geometry.attributes).sort().join(",")}|${m.geometry.index ? "i" : "n"}`;
      if (!buckets.has(key)) buckets.set(key, { cast: m.castShadow, recv: m.receiveShadow, geos: [] });
      buckets.get(key).geos.push(m.geometry.clone().applyMatrix4(rel));
    });
  }
  for (const b of buckets.values()) {
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    if (!geo) continue;
    const shell = new THREE.Mesh(geo, flatMat);
    shell.castShadow = b.cast; shell.receiveShadow = b.recv;
    shell.userData.shell = true;
    town.add(shell);
  }
}

/** Merge every mesh directly under `group` that uses `material` into one (lamps: many small spheres). */
export function mergeInto(group, material) {
  const list = group.children.filter((m) => m.isMesh && m.material === material);
  if (list.length < 2) return;
  const geos = list.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
  const geo = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!geo) return;
  for (const m of list) { m.removeFromParent(); m.geometry.dispose(); }
  group.add(new THREE.Mesh(geo, material));
}
