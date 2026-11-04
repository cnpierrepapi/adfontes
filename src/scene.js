// The hero world: bright floating islands with temples, waterfalls, fountains, schools of
// fish-birds and tiny agents. Everything is built in code (no model files).
import * as THREE from "three";

const PAL = {
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
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const range = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

function facetColors(geo, base, jitter = 0.08, light = new THREE.Vector3(-0.4, 1, 0.5).normalize()) {
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

function mesh(geo, color, jitter) {
  return new THREE.Mesh(facetColors(geo, color, jitter), flatMat);
}

// One floating island: faceted grass top, a jagged rock cone below, a little town on top.
function island(radius, opts = {}) {
  const g = new THREE.Group();
  const grass = opts.grass ?? pick(PAL.grass);
  const rock = opts.rock ?? pick(PAL.rock);

  const top = new THREE.CylinderGeometry(radius, radius * 0.92, radius * 0.28, 9, 1);
  top.translate(0, -radius * 0.14, 0);
  const topPos = top.attributes.position;
  for (let i = 0; i < topPos.count; i++) {
    const y = topPos.getY(i);
    if (y > -radius * 0.05) topPos.setY(i, y + range(-0.04, 0.06) * radius);
  }
  g.add(mesh(top, grass, 0.12));

  const under = new THREE.ConeGeometry(radius * 0.95, radius * 2.1, 9, 4);
  under.rotateX(Math.PI);
  under.translate(0, -radius * 1.3, 0);
  const up = under.attributes.position;
  for (let i = 0; i < up.count; i++) {
    const y = up.getY(i);
    if (y > -radius * 2.3 && y < -radius * 0.35) {
      up.setX(i, up.getX(i) * range(0.8, 1.2));
      up.setZ(i, up.getZ(i) * range(0.8, 1.2));
    }
  }
  g.add(mesh(under, rock, 0.16));

  // Small hanging crystals under the rock.
  for (let i = 0; i < 4; i++) {
    const c = mesh(new THREE.OctahedronGeometry(radius * range(0.07, 0.13), 0), pick([0xffffff, 0xbff8ff, 0xffd6f0]), 0.1);
    const a = rnd() * Math.PI * 2;
    c.position.set(Math.cos(a) * radius * 0.45, -radius * range(0.9, 1.7), Math.sin(a) * radius * 0.45);
    c.scale.y = 1.8;
    g.add(c);
  }
  g.userData.radius = radius;
  return g;
}

function temple(h, dome) {
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(h * 0.9, h * 0.18, h * 0.9), PAL.stone, 0.05);
  base.position.y = h * 0.09;
  g.add(base);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const col = mesh(new THREE.CylinderGeometry(h * 0.045, h * 0.05, h * 0.62, 6), PAL.stone, 0.04);
    col.position.set(Math.cos(a) * h * 0.32, h * 0.49, Math.sin(a) * h * 0.32);
    g.add(col);
  }
  const ring = mesh(new THREE.CylinderGeometry(h * 0.4, h * 0.4, h * 0.08, 12), PAL.stone, 0.04);
  ring.position.y = h * 0.84;
  g.add(ring);
  const d = mesh(new THREE.SphereGeometry(h * 0.36, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dome, 0.1);
  d.position.y = h * 0.88;
  g.add(d);
  const spire = mesh(new THREE.ConeGeometry(h * 0.05, h * 0.3, 5), 0xffe27a, 0.05);
  spire.position.y = h * 1.36;
  g.add(spire);
  return g;
}

function tower(h, roof) {
  const g = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(h * 0.16, h * 0.2, h, 7), PAL.stone, 0.06);
  body.position.y = h / 2;
  g.add(body);
  const r = mesh(new THREE.ConeGeometry(h * 0.26, h * 0.45, 7), roof, 0.1);
  r.position.y = h + h * 0.22;
  g.add(r);
  return g;
}

function house(s, roof) {
  const g = new THREE.Group();
  const b = mesh(new THREE.BoxGeometry(s, s * 0.8, s * 0.9), pick([0xffffff, 0xfff1d6, 0xffe6f2]), 0.05);
  b.position.y = s * 0.4;
  g.add(b);
  const r = mesh(new THREE.ConeGeometry(s * 0.8, s * 0.6, 4), roof, 0.1);
  r.rotation.y = Math.PI / 4;
  r.position.y = s * 0.8 + s * 0.3;
  g.add(r);
  return g;
}

function tree(s) {
  const g = new THREE.Group();
  const t = mesh(new THREE.CylinderGeometry(s * 0.06, s * 0.09, s * 0.5, 5), 0xc98a5a, 0.05);
  t.position.y = s * 0.25;
  g.add(t);
  const f = mesh(new THREE.IcosahedronGeometry(s * 0.38, 0), pick([0x4fe39a, 0x9cf06a, 0xff8fc8, 0x5ff2df]), 0.15);
  f.position.y = s * 0.7;
  g.add(f);
  return g;
}

// A fountain: stone basin, a pillar, and a particle spray that rises and falls.
function fountain(s, sprays) {
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
const fallUniforms = { uTime: { value: 0 } };
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

function waterfall(width, height) {
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

function mist(count, spread, sprays) {
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
function agent(color) {
  const g = new THREE.Group();
  const body = mesh(new THREE.ConeGeometry(0.11, 0.3, 5), color, 0.12);
  body.position.y = 0.15;
  g.add(body);
  const head = mesh(new THREE.IcosahedronGeometry(0.08, 0), 0xffd2b0, 0.08);
  head.position.y = 0.36;
  g.add(head);
  return g;
}

// Schools of fish-birds circling between islands (the ABZU-ish life of the sky).
function school(n, color, sprays, radius, y) {
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
  scene.add(sunL);

  // A bright sea of cloud-water far below.
  const seaGeo = new THREE.PlaneGeometry(260, 260, 80, 80);
  seaGeo.rotateX(-Math.PI / 2);
  const seaBase = seaGeo.attributes.position.array.slice();
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ color: PAL.sea, flatShading: true, emissive: 0x05606e, emissiveIntensity: 0.3 }));
  sea.position.y = -14;
  scene.add(sea);

  const sprays = [];
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
      anchors.fountain.position.set(1.6, 1.9, 1.2);
      town.add(anchors.fountain);
      anchors.agents = new THREE.Object3D();
      anchors.agents.position.set(-1.6, 1.1, 2.1);
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

  // Rope bridges of light between the main island and two neighbours.
  const bridgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  [[0, 1], [0, 2], [0, 3]].forEach(([a, b]) => {
    const A = new THREE.Vector3(layout[a].x, layout[a].y + 0.05, layout[a].z);
    const B = new THREE.Vector3(layout[b].x, layout[b].y + 0.05, layout[b].z);
    const mid = A.clone().lerp(B, 0.5);
    mid.y -= 0.9;
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(30)), bridgeMat));
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

  let mx = 0, my = 0;
  window.addEventListener("pointermove", (e) => {
    mx = e.clientX / window.innerWidth - 0.5;
    my = e.clientY / window.innerHeight - 0.5;
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
    const ang = -0.25 + Math.sin(t * 0.05) * 0.1 + mx * 0.12;
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
