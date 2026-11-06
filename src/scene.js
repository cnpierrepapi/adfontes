// The hero world: bright floating islands with temples, waterfalls, fountains, schools of
// fish-birds and tiny agents. Everything is built in code (no model files).
import * as THREE from "three";

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

// opts.onFrame(camera) runs after every render so the page can pin labels to 3D anchors.
// Returns { anchors }: named Object3Ds the page can point at.
export function startScene(canvas, opts = {}) {
  const anchors = {};
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  // Sky dome with a vertical gradient and a warm sun glow.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, mid: { value: new THREE.Color(PAL.skyMid) }, hor: { value: new THREE.Color(PAL.horizon) }, sun: { value: new THREE.Vector3(-0.5, 0.35, -0.8).normalize() } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top, mid, hor, sun; varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 c = mix(hor, mid, smoothstep(-0.05, 0.25, y));
          c = mix(c, top, smoothstep(0.25, 0.8, y));
          float s = max(0.0, dot(vP, sun));
          c += vec3(1.0, 0.85, 0.55) * (pow(s, 24.0) * 0.9 + pow(s, 4.0) * 0.25);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(0x63d9ee, 30, 95);

  scene.add(new THREE.HemisphereLight(0xdff9ff, 0xffc7a0, 1.6));
  const sunL = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sunL.position.set(-8, 14, 6);
  sunL.castShadow = true;
  sunL.shadow.mapSize.set(2048, 2048);
  Object.assign(sunL.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
  sunL.shadow.bias = -0.0008;
  sunL.shadow.normalBias = 0.02;
  scene.add(sunL);

  // A bright sea of cloud-water far below.
  const seaGeo = new THREE.PlaneGeometry(260, 260, 80, 80);
  seaGeo.rotateX(-Math.PI / 2);
  const seaBase = seaGeo.attributes.position.array.slice();
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshPhongMaterial({ color: PAL.sea, flatShading: true, emissive: 0x05606e, emissiveIntensity: 0.3, specular: 0xffffff, shininess: 60 }));
  sea.position.y = -14;
  scene.add(sea);

  const sprays = [];

  // A low bank of cloud between the islands and the sea, for depth.
  const bank = new THREE.Group();
  const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xd8f6ff, emissiveIntensity: 0.7, flatShading: true, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 30; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(range(0.9, 1.9), 1), puffMat);
    p.position.set(range(-10, 34), range(-13.5, -11.5), range(-34, 2));
    p.scale.y = 0.55;
    bank.add(p);
  }
  scene.add(bank);
  sprays.push((t) => { bank.position.x = Math.sin(t * 0.03) * 2; });
  const world = new THREE.Group();
  scene.add(world);

  const layout = [
    { x: 0, y: 0, z: 0, r: 3.4, main: true },
    { x: -4, y: 5.5, z: -13, r: 2.0 },
    { x: 8, y: 1.2, z: -4, r: 2.4 },
    { x: 9.5, y: -3.6, z: 5, r: 1.7 },
    { x: 6.5, y: 3.8, z: -12, r: 2.0 },
    { x: -12, y: 7, z: -22, r: 1.5 },
    { x: 13.5, y: -1, z: 4, r: 1.5 },
  ];
  const walkers = [];
  layout.forEach((L, idx) => {
    const isl = island(L.r, idx === 0 ? { grass: 0x7ef0a0, rock: 0xffb37a } : {});
    isl.position.set(L.x, L.y, L.z);
    isl.userData.bob = rnd() * Math.PI * 2;
    isl.userData.baseY = L.y;
    world.add(isl);

    const town = new THREE.Group();
    isl.add(town);
    if (L.main) {
      const t = temple(2.0, 0xffc93c);
      town.add(t);
      anchors.temple = new THREE.Object3D();
      anchors.temple.position.set(0, 3.4, 0);
      town.add(anchors.temple);
      const f = fountain(0.5, sprays);
      f.position.set(1.6, 0, 1.2);
      town.add(f);
      anchors.fountain = new THREE.Object3D();
      anchors.fountain.position.set(2.2, 0.9, 1.6);
      town.add(anchors.fountain);
      anchors.agents = new THREE.Object3D();
      anchors.agents.position.set(-2.5, 0.5, 2.4);
      town.add(anchors.agents);
      [[-1.9, 0.6, 1.4], [1.9, -1.3, 1.1], [-1.2, -1.9, 1.6]].forEach(([x, z, h]) => {
        const tw = tower(h, pick(PAL.dome));
        tw.position.set(x, 0, z);
        town.add(tw);
      });
    } else {
      const roll = rnd();
      if (roll < 0.45) town.add(temple(L.r * 0.55, pick(PAL.dome)));
      else if (roll < 0.75) town.add(tower(L.r * 0.7, pick(PAL.dome)));
      else {
        const f = fountain(L.r * 0.22, sprays);
        town.add(f);
      }
    }
    const nh = Math.round(L.r * 1.6);
    for (let i = 0; i < nh; i++) {
      const a = (i / nh) * Math.PI * 2 + rnd();
      const rr = L.r * range(0.55, 0.78);
      const o = rnd() < 0.55 ? house(L.r * 0.16, pick(PAL.dome)) : tree(L.r * 0.32);
      o.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      o.rotation.y = rnd() * Math.PI;
      town.add(o);
    }

    if (idx === 2) {
      anchors.season = new THREE.Object3D();
      anchors.season.position.set(0, L.r * 0.9, 0);
      isl.add(anchors.season);
    }

    // Waterfalls off the edge, facing the camera side.
    const falls = L.main ? 2 : rnd() < 0.7 ? 1 : 0;
    for (let i = 0; i < falls; i++) {
      const a = (L.main ? [0.35, 1.25][i] : range(0.2, 1.3)) * Math.PI * 0.5;
      const wf = waterfall(L.r * 0.32, L.r * 4 + 6);
      wf.position.set(Math.cos(a) * L.r * 0.96, 0.02, Math.sin(a) * L.r * 0.96);
      wf.rotation.y = -a + Math.PI / 2;
      isl.add(wf);
      for (let k = 0; k < 4; k++) {
        const foam = mesh(new THREE.IcosahedronGeometry(L.r * range(0.05, 0.08), 0), 0xffffff, 0.04);
        foam.position.set(Math.cos(a) * L.r * 0.97 + range(-0.1, 0.1), 0.03, Math.sin(a) * L.r * 0.97 + range(-0.1, 0.1));
        isl.add(foam);
      }
      const stream = new THREE.Mesh(new THREE.PlaneGeometry(L.r * 0.22, L.r * 0.7), new THREE.MeshBasicMaterial({ color: 0x8ff4ff }));
      stream.rotation.x = -Math.PI / 2;
      stream.rotation.z = -a + Math.PI / 2;
      stream.position.set(Math.cos(a) * L.r * 0.68, 0.035, Math.sin(a) * L.r * 0.68);
      isl.add(stream);
      const m = mist(40, L.r * 0.5, sprays);
      m.position.set(Math.cos(a) * (L.r * 1.25), -(L.r * 4 + 6) + 0.5, Math.sin(a) * (L.r * 1.25));
      isl.add(m);
    }

    // Agents walking around the town.
    const na = L.main ? 9 : 3;
    for (let i = 0; i < na; i++) {
      const ag = agent(PAL.agent[i % 4]);
      town.add(ag);
      walkers.push({ ag, r: L.r * range(0.25, 0.85), off: rnd() * Math.PI * 2, sp: range(0.15, 0.35) * (rnd() < 0.5 ? 1 : -1) });
    }
  });

  // Rope bridges between islands: two bright ropes, gold planks, and beads of light running
  // along them (knowledge being traded between clans).
  const ropeMats = [new THREE.MeshBasicMaterial({ color: 0xff4fa3 }), new THREE.MeshBasicMaterial({ color: 0xffc93c })];
  const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.45, depthWrite: false });
  [[0, 2], [0, 3], [0, 1], [2, 4], [2, 6]].forEach(([ia, ib], bi) => {
    const A0 = new THREE.Vector3(layout[ia].x, layout[ia].y, layout[ia].z);
    const B0 = new THREE.Vector3(layout[ib].x, layout[ib].y, layout[ib].z);
    const dir = B0.clone().sub(A0).setY(0).normalize();
    const A = A0.clone().addScaledVector(dir, layout[ia].r * 0.92).setY(A0.y + 0.08);
    const B = B0.clone().addScaledVector(dir, -layout[ib].r * 0.92).setY(B0.y + 0.08);
    const mid = A.clone().lerp(B, 0.5);
    mid.y -= Math.max(0.6, A.distanceTo(B) * 0.12);
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.16);
    [-1, 1].forEach((k, i) => {
      const off = side.clone().multiplyScalar(k);
      const rail = new THREE.QuadraticBezierCurve3(A.clone().add(off).setY(A.y + 0.22), mid.clone().add(off).setY(mid.y + 0.22), B.clone().add(off).setY(B.y + 0.22));
      world.add(new THREE.Mesh(new THREE.TubeGeometry(rail, 40, 0.025, 5), ropeMats[i]));
      world.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(A.clone().add(off), mid.clone().add(off), B.clone().add(off)), 40, 0.018, 4), ropeMats[i]));
    });
    const n = Math.round(A.distanceTo(B) / 0.22);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const plank = mesh(new THREE.BoxGeometry(0.38, 0.03, 0.1), i % 2 ? 0xffd36e : 0xffe9b0, 0.05);
      plank.position.copy(curve.getPoint(t));
      plank.lookAt(curve.getPoint(Math.min(1, t + 0.01)));
      world.add(plank);
    }
    const beads = [];
    for (let i = 0; i < 3; i++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), beadMat);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), glowMat);
      bead.add(glow);
      world.add(bead);
      beads.push(bead);
    }
    sprays.push((t) => {
      beads.forEach((bead, i) => {
        const u = (t * 0.12 + i / 3 + bi * 0.17) % 1;
        const fwd = bi % 2 ? u : 1 - u;
        bead.position.copy(curve.getPoint(fwd));
        bead.position.y += 0.12;
      });
    });
  });

  world.add(school(22, 0xffffff, sprays, 6.5, 3.2));
  world.add(school(16, 0xffc93c, sprays, 9.5, 5.5));
  world.add(school(14, 0xff8fc8, sprays, 5, -1.8));

  // Floating motes of light.
  const moteN = 260;
  const mg = new THREE.BufferGeometry();
  const mp = new Float32Array(moteN * 3);
  for (let i = 0; i < moteN; i++) mp.set([range(-30, 30), range(-10, 14), range(-30, 12)], i * 3);
  mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xfff6c8, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false }));
  scene.add(motes);

  // The god's eye: a sun disc with a halo, where the "you" label sits.
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color: 0xfff3c0, fog: false }));
  const halo = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
  const sunG = new THREE.Group();
  sunG.add(halo, sunDisc);
  sunG.position.set(-2, 9.5, -34);
  scene.add(sunG);
  anchors.sun = sunG;

  // A storm cloud drifting off to one side: the weather.
  const cloud = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(range(0.55, 0.95), 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xbfeaff, emissiveIntensity: 0.55, flatShading: true }));
    puff.position.set(i * 0.62 - 1.6, range(-0.2, 0.35) + (i % 2) * 0.3, range(-0.3, 0.3));
    cloud.add(puff);
  }
  cloud.position.set(9, 7.2, -7);
  scene.add(cloud);
  anchors.weather = new THREE.Object3D();
  anchors.weather.position.set(0, 1.4, 0);
  cloud.add(anchors.weather);
  sprays.push((t) => { cloud.position.x = 9 + Math.sin(t * 0.08) * 1.2; });

  // God rays: soft additive beams from the sun side.
  const rayMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(range(1.5, 3.5), 60), rayMat);
    ray.position.set(range(-14, 4), 10, range(-14, -4));
    ray.rotation.set(0.15, range(-0.4, 0.4), 0.5);
    scene.add(ray);
  }

  let mx = 0, my = 0, camT = 0, lastT = 0;
  // The camera drifts a little with the pointer, but holds still while a pin is hovered so the
  // pin doesn't slide out from under the cursor.
  let tx = 0, ty = 0;
  window.addEventListener("pointermove", (e) => {
    if (window.__holdCamera) return;
    tx = e.clientX / window.innerWidth - 0.5;
    ty = e.clientY / window.innerHeight - 0.5;
  });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 58 : 42;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  const fixedT = new URLSearchParams(location.search).get("t");
  function frame() {
    const t = fixedT !== null ? Number(fixedT) : clock.getElapsedTime();
    fallUniforms.uTime.value = t;
    for (const s of sprays) s(t);
    for (const w of walkers) {
      const a = w.off + t * w.sp;
      w.ag.position.set(Math.cos(a) * w.r, 0, Math.sin(a) * w.r);
      w.ag.rotation.y = -a;
      w.ag.position.y = Math.abs(Math.sin(t * 6 + w.off)) * 0.03;
    }
    world.children.forEach((c) => {
      if (c.userData.baseY !== undefined) c.position.y = c.userData.baseY + Math.sin(t * 0.5 + c.userData.bob) * 0.25;
    });
    const sp = sea.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = seaBase[i * 3], z = seaBase[i * 3 + 2];
      sp.setY(i, Math.sin(x * 0.15 + t * 0.6) * 0.5 + Math.cos(z * 0.12 + t * 0.4) * 0.5);
    }
    sp.needsUpdate = true;
    sea.geometry.computeVertexNormals();
    motes.rotation.y = t * 0.01;

    const narrow = camera.aspect < 0.8;
    // Camera clock: it only advances while no pin is hovered, so holding pauses the drift exactly
    // where it is instead of snapping it back (that snap was the jolt).
    const dt = Math.min(0.05, t - lastT);
    lastT = t;
    if (fixedT !== null) camT = t;
    else if (!window.__holdCamera) { camT += dt; mx += (tx - mx) * 0.04; my += (ty - my) * 0.04; }
    const ang = -0.25 + Math.sin(camT * 0.05) * 0.1 + mx * 0.12;
    const dist = narrow ? 36 : 22;
    camera.position.set(Math.sin(ang) * dist, 6 - my * 1.5, Math.cos(ang) * dist);
    camera.lookAt(narrow ? 1 : -3, narrow ? -6 : 1.2, 0);
    renderer.render(scene, camera);
    opts.onFrame?.(camera, anchors);
    if (fixedT === null) requestAnimationFrame(frame);
    else window.__frameDone = true;
  }
  frame();
  return { anchors, camera };
}
