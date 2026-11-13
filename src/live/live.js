// The live world (step 1): islands and bridges built from the real world (API), and the
// floating god's camera. Zoom levels become information levels in later steps.
import { createStandings } from "./standings.js";
import { createFeed } from "./feed.js";
import { isNorthPole } from "../season.js";
import { api as netApi } from "../net.js";
import { endedName } from "../says.js";
import * as THREE from "three";
import { createWarLayer } from "./war.js";
import CameraControls from "camera-controls";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createEffects } from "./effects.js";
import { buildMind, mindBase } from "./mind.js";
import { createFolk } from "./folk.js";
import { statusOf, plateWords } from "./status.js";
import { TIERS, pickTier, readDevice, chosen, createStepper } from "./quality.js";
import { citizenGlow } from "./citizens.js";
import { PAL, island, temple, tower, house, tree, fountain, waterfall, mist, mesh, school, fallUniforms, range, pick, mergeStatic, townShell, mergeInto } from "../scene.js";

CameraControls.install({ THREE });

const FIELD_ANGLE = { batteries: -0.35, "solar cells": 1.75, "carbon capture": 3.85 };

// Islands sit on ONE global hex grid (SPEC §12g). A cell is wider than the biggest island plus room
// for a bridge, so no two nations can ever crowd each other. Each field owns a wedge of the grid
// round the empty centre; nation k of a field takes the k-th nearest cell in its wedge, so a nation's
// cell never changes when others are founded.
const CELL = 14;
const HEX = (() => {
  const cells = [];
  for (let q = -9; q <= 9; q++) for (let r = -9; r <= 9; r++) {
    if (Math.abs(q + r) > 9 || (q === 0 && r === 0)) continue;
    const x = CELL * (q + r / 2), z = CELL * (Math.sqrt(3) / 2) * r;
    cells.push({ x, z, d: Math.hypot(x, z), a: Math.atan2(z, x) });
  }
  return cells;
})();
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const FIELD_COLOR = { batteries: 0x2fa8ff, "solar cells": 0xffc93c, "carbon capture": 0x22c47e };

export async function startLive(canvas, hud, opts = {}) {
  const api = netApi; // this world's API (testnet or mainnet, src/net.js)

  // ---- renderer, labels, scene ----
  // Graphics quality (12 Nov, src/live/quality.js): the player's choice, else picked from the device. Stills
  // keep today's look. The GPU's name comes from a throwaway context, read before the real one is made.
  const pick = chosen();
  let tierName = opts.stills ? "high" : pick !== "auto" ? pick : (() => { const c = document.createElement("canvas"), gl = c.getContext("webgl2") || c.getContext("webgl"); const d = readDevice(gl); gl?.getExtension("WEBGL_lose_context")?.loseContext(); return pickTier(d); })();
  const stepper = createStepper({ start: tierName, auto: pick === "auto" && !opts.stills });
  const T0 = TIERS[tierName];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: T0.antialias, preserveDrawingBuffer: !!opts.stills, powerPreference: tierName === "low" ? "low-power" : "default" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, T0.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = T0.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const labels = new CSS2DRenderer({ element: hud.plates });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
  scene.fog = new THREE.Fog(0xf3dfae, 55, 300); // fades into the sky's own horizon gold, so the sea has no edge
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, mid: { value: new THREE.Color(PAL.skyMid) }, hor: { value: new THREE.Color(PAL.horizon) }, sun: { value: new THREE.Vector3(-0.5, 0.35, -0.8).normalize() }, sunCol: { value: new THREE.Color(1.0, 0.85, 0.55) }, disc: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top, mid, hor, sun, sunCol; uniform float disc; varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 c = mix(hor, mid, smoothstep(-0.05, 0.25, y));
          c = mix(c, top, smoothstep(0.25, 0.8, y));
          float s = max(0.0, dot(vP, sun));
          c += sunCol * (pow(s, 24.0) * 0.9 * (1.0 - disc * 0.75) + pow(s, 4.0) * 0.25 * (1.0 - disc * 0.6));
          c += vec3(0.95, 0.96, 1.0) * smoothstep(0.9993, 0.9996, s) * disc; // the moon's disc at night
          gl_FragColor = vec4(min(c, vec3(0.98)), 1.0); // never above white, so the sky never blooms
        }`,
    }),
  );
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xdff9ff, 0xffc7a0, 1.6);
  scene.add(hemi);
  let theme = opts.theme === "day" ? "day" : "night"; // night by default (SPEC §12g)
  // Night sky stars: a fixed dome of small points above the horizon (hidden by day).
  const starG = new THREE.BufferGeometry(), sp0 = [];
  for (let i = 0; i < 1800; i++) {
    const u = Math.random() * Math.PI * 2, y = 0.03 + Math.pow(Math.random(), 0.7) * 0.97, rr = Math.sqrt(1 - y * y);
    sp0.push(Math.cos(u) * rr * 300, y * 300, Math.sin(u) * rr * 300);
  }
  starG.setAttribute("position", new THREE.Float32BufferAttribute(sp0, 3));
  const skyStars = new THREE.Points(starG, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  scene.add(skyStars);
  const sunL = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sunL.position.set(-20, 30, 14);
  sunL.castShadow = true;
  sunL.shadow.mapSize.set(2048, 2048);
  Object.assign(sunL.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
  sunL.shadow.bias = -0.0008;
  sunL.shadow.normalBias = 0.03;
  scene.add(sunL);

  const seaGeo = new THREE.PlaneGeometry(1400, 1400, 140, 140);
  seaGeo.rotateX(-Math.PI / 2);
  const seaBase = seaGeo.attributes.position.array.slice();
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshPhongMaterial({ color: PAL.sea, flatShading: true, emissive: 0x05606e, emissiveIntensity: 0.3, specular: 0xffffff, shininess: 60 }));
  sea.position.y = -18;
  scene.add(sea);

  const sprays = [];
  const puffMat = new THREE.MeshLambertMaterial({ color: 0xf2fbff, emissive: 0xd8f6ff, emissiveIntensity: 0.28, flatShading: true, transparent: true, opacity: 0.85 }); // under white: clouds don't bloom
  const clouds = new THREE.Group();
  for (let i = 0; i < 70; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(range(1.2, 2.6), 1), puffMat);
    p.position.set(range(-60, 60), range(-17, -14), range(-60, 60));
    p.scale.y = 0.55;
    clouds.add(p);
  }
  scene.add(clouds);
  const moteG = new THREE.BufferGeometry();
  const mp = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) mp.set([range(-60, 60), range(-12, 22), range(-60, 60)], i * 3);
  moteG.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteG, new THREE.PointsMaterial({ color: 0xfff6c8, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false }));
  scene.add(motes);

  const world = new THREE.Group();
  scene.add(world);
  world.add(school(26, 0xffffff, sprays, 12, 5));
  world.add(school(18, 0xffc93c, sprays, 18, 8));

  // ---- the live world ----
  const W = await api("world");
  const T = await api("trades?days=20").catch(() => ({ routes: [] }));
  const islands = new Map();
  const live = W.clans.filter((c) => c.alive);
  const avgIn = live.reduce((a, c) => a + (c.total_in || 0), 0) / Math.max(1, live.length);

  // Archipelagos by field. Every nation gets a PERMANENT slot: its rank by id within its field,
  // on a golden-angle spiral round the field's centre. Founding a new nation never moves others.
  const slotOf = (c) => W.clans.filter((x) => x.field === c.field && x.id < c.id).length;
  // Fields = the three known ones plus any new field in order of first appearance (a 4th field
  // re-divides the wedges; that only happens when Season 2 adds one).
  const fieldList = () => [...new Set([...Object.keys(FIELD_ANGLE), ...W.clans.map((x) => x.field).filter(Boolean)])];
  const fieldAngle = (field) => {
    const list = fieldList();
    return list.length <= 3 && FIELD_ANGLE[field] != null ? FIELD_ANGLE[field] : FIELD_ANGLE.batteries + (list.indexOf(field) * Math.PI * 2) / list.length;
  };
  function cellOf(c) {
    const a = fieldAngle(c.field), half = Math.PI / fieldList().length;
    const mine = HEX.filter((h) => { const d = angDiff(h.a, a); return d >= -half && d < half; })
      .sort((p, q) => p.d - q.d || Math.abs(angDiff(p.a, a)) - Math.abs(angDiff(q.a, a)));
    return mine[slotOf(c)] ?? mine[mine.length - 1];
  }
  const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  function addNation(c) {
    const cell = cellOf(c);
    const r = 1.8 + Math.min(2.6, Math.sqrt(c.points || 1) * 0.24);
    // A little drift inside the cell so the grid doesn't read as a grid.
    // North Pole (the Season of Cheer's demo nation) takes the empty centre of the map (HEX skips it).
    const pos = isNorthPole(c) ? new THREE.Vector3(0, 0.5, 0) : new THREE.Vector3(cell.x + (hash(c.id + 3) - 0.5) * 2.4, -1.5 + hash(c.id) * 4, cell.z + (hash(c.id + 5) - 0.5) * 2.4);
    // From the game (SPEC §14): a Trickster moved in or the citizens are hungry = neglected;
    // sated (more NEAR than they need) = rich and a bit lazy.
    const status = statusOf(c); // src/live/status.js: neglected = no god acted for 24 h (13 Nov)
    const isl = buildClanIsland(c, r, status, sprays);
    isl.position.copy(pos);
    isl.userData = { ...isl.userData, clan: c, baseY: pos.y, bob: hash(c.id + 7) * Math.PI * 2, r, status };
    world.add(isl);
    islands.set(c.id, isl);
    // Night lamps: a warm light by the temple and each house (they bloom; hidden by day).
    const town = isl.children.find((ch) => ch.isGroup && ch.children.length);
    if (town) {
      const lamps = new THREE.Group(), lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 0.9, 0.4) }); // just over white: a glow, not a flare
      for (const o of town.children) if (o.userData.lamp) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.012 + 0.025, 8, 6), lampMat);
        const out = new THREE.Vector3(o.position.x, 0, o.position.z).normalize().multiplyScalar(r * 0.09);
        m.position.set(o.position.x + out.x, o.userData.lamp * r, o.position.z + out.z);
        lamps.add(m);
      }
      mergeInto(lamps, lampMat); // one shape for every lamp on the island (12 Nov)
      lamps.userData.noMerge = true; // not a building: the town shape and footprints leave it alone
      town.add(lamps);
      lamps.visible = theme === "night";
      isl.userData.lamps = lamps;
    }

    // Floating name plate (always faces you).
    const plate = document.createElement("button");
    plate.className = `plate ${status}`;
    plate.innerHTML = `<b></b><span></span>`;
    plate.querySelector("b").textContent = c.name;
    plate.querySelector("span").textContent = `${c.field ?? ""} nation · ${c.reverence && status !== "dead" ? `reverence ${c.reverence.standing}` : `${c.points} points`}${plateWords(c, status)}`;
    plate.addEventListener("click", () => flyTo(c.id));
    const lbl = new CSS2DObject(plate);
    lbl.position.set(0, r * 0.75 + 1.5, 0);
    isl.add(lbl);
    isl.userData.plate = plate;
    isl.userData.plateObj = lbl;
    if (status !== "dead") setHealth(isl, c.war);
    return isl;
  }
  // His call 10 Nov: a nation whose last god claimed out leaves the map (no ruins). One that fell in
  // a war keeps its ruins: that's part of the war's story.
  const gone = (c) => !c.alive && !c.fallen && !(c.gods > 0 || c.gods?.length > 0);
  // Born (10 Nov): a nation goes on the map only once the engine has made its people ("ready"), so its
  // island rises with them on it. (Older servers and the season world don't send the flag: ready.)
  const ready = (c) => c.ready !== false;
  const unready = new Set(W.clans.filter((c) => !ready(c)).map((c) => c.id));
  W.clans = W.clans.filter(ready);
  for (const c of W.clans) if (!gone(c)) addNation(c);
  function takeDown(id) {
    const isl = islands.get(id);
    if (!isl) return;
    isl.visible = false;
    isl.userData.status = "dead";
    if (isl.userData.plate) isl.userData.plate.style.display = "none";
    const m = minds.get(id); if (m?.group) m.group.visible = false;
    for (const [key, g] of routeGroups) if (key.split("-").map(Number).includes(id)) g.visible = false;
  }

  // Founding: a seed of light falls, the island rises out of the clouds turning, its town builds
  // up, then the plate fades in. Plays once per nation (on its "founded" record or when it appears).
  const rising = new Map();
  const atLoad = new Set(W.clans.map((c) => c.id)); // nations standing when the page loaded (ready ones)
  // A nation being born (10 Nov): its people and town are built out of sight, then the island rises
  // with them already on it. If that takes more than 8 s it rises anyway and they appear as they load.
  const birthing = new Set();
  async function birth(c) {
    birthing.add(c.id);
    W.clans.push(c);
    const isl = addNation(c); fitWorld();
    isl.visible = false;
    try {
      await Promise.race([
        (async () => { await loadMind(c.id, [], { fresh: true }); await folk.focus(c.id); })(),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
    } catch {}
    isl.visible = true;
    // Watching the whole world? Glide to the new home view (re-picked for one more island).
    if (focusId == null && !flying) controls.setLookAt(...HOME.pos, ...HOME.target, true);
    riseNation(c.id);
    birthing.delete(c.id);
  }
  // What a nation does waits until its island has risen (10 Nov): research, trades and reports from a
  // nation still being born are held, then played in order the moment it lands.
  const held = new Map();
  const waiting = (id) => id != null && (unready.has(Number(id)) || birthing.has(Number(id)) || rising.has(Number(id)));
  function holdBack(recs) {
    const now = [];
    for (const r of recs || []) {
      if (waiting(r.clan)) { const k = Number(r.clan); if (!held.has(k)) held.set(k, []); held.get(k).push(r); }
      else now.push(r);
    }
    return now;
  }
  function letGo(id) {
    const recs = held.get(id);
    if (!recs?.length) return;
    held.delete(id);
    fx.enqueue(recs);
  }
  function riseNation(id) {
    const isl = islands.get(id);
    if (!isl || isl.userData.rose) return;
    // Only a nation founded while you watch rises; one already standing at page load stays put
    // (the "while you were away" replay plays its founding record again).
    // His note 8 Nov: no replayed births. A nation already on the map when the page loaded never
    // rises again; only one founded while you're here comes up out of the clouds.
    // 10 Nov fix: any nation that wasn't on the map at page load rises. (It used to also skip one the
    // engine had already "seen", but the engine now starts a new nation within seconds, so by the
    // time the page noticed it, it was always "seen" and no island ever rose.)
    if (atLoad.has(id)) { isl.userData.rose = true; return; }
    isl.userData.rose = "rising";
    showRoutesOf(id, false); // bridges wait until the island has landed
    rising.set(id, performance.now());
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.3, 1.2) }));
    scene.add(seed);
    isl.userData.seed = seed;
    if (controls.distance > 26) { // watching the whole world: drift toward the new nation
      const t = new THREE.Vector3(); controls.getTarget(t);
      t.lerp(restOf(isl), 0.45); // where it will land, not where it is under the clouds
      controls.setTarget(t.x, t.y, t.z, true);
    }
  }
  function updateRising() {
    for (const [id, t0] of rising) {
      const isl = islands.get(id), k = (performance.now() - t0) / 6000;
      const seedK = Math.min(1, k / 0.2); // 0-1.2 s: the seed falls into the cloud bank
      if (isl.userData.seed) {
        isl.userData.seed.position.set(isl.position.x, isl.userData.baseY + 26 - seedK * 46, isl.position.z);
        if (seedK >= 1) { scene.remove(isl.userData.seed); isl.userData.seed = null; }
      }
      const u = Math.max(0, Math.min(1, (k - 0.15) / 0.65)); // 0.9-4.8 s: the island rises
      // Slow start and finish (smoothstep) so you watch it climb out of the clouds,
      // plus a small overshoot-and-settle in the last fifth.
      const sm = u * u * (3 - 2 * u), settle = u > 0.8 ? Math.sin(((u - 0.8) / 0.2) * Math.PI) * 0.6 : 0;
      isl.userData.riseY = (1 - sm) * -24 + settle;
      isl.scale.setScalar(0.15 + 0.85 * sm);
      isl.rotation.y = (1 - u) * Math.PI * 1.5;
      const town = isl.children.find((ch) => ch.isGroup && ch.children.length);
      if (town) town.scale.set(1, Math.max(0.01, Math.min(1, (k - 0.55) / 0.35)), 1); // the town builds up
      isl.userData.plateFade = Math.max(0, Math.min(1, (k - 0.8) / 0.2));
      if (k >= 1) { rising.delete(id); isl.userData.rose = true; showRoutesOf(id, true); isl.userData.riseY = 0; isl.userData.plateFade = 1; isl.scale.setScalar(1); isl.rotation.y = 0; letGo(id); }
    }
  }

  // Bridges = trade routes; beads of light run seller -> buyer. Each route lives in its own group
  // so it can be hidden while one of its islands is still rising, and new routes appear live.
  const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.45, depthWrite: false });
  const curves = new Map(), routeGroups = new Map(), routeDirs = new Set();
  const paths = new Map(); // nation pair -> faint path (until their first trade)
  const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false });
  const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-"); // numeric, same as effects.js
  function addRoute(route) {
    const A = islands.get(route.seller), B = islands.get(route.buyer);
    if (!A || !B) return;
    const key = pairKey(route.seller, route.buyer), dirKey = `${route.seller}>${route.buyer}`;
    if (routeDirs.has(dirKey)) return;
    routeDirs.add(dirKey);
    let g = routeGroups.get(key);
    if (!g) {
      g = new THREE.Group();
      const curve = bridgeCurve(A, B);
      curves.set(key, curve);
      g.add(bridge(curve, Math.min(3, 1 + Math.log2(1 + route.count))));
      g.userData.ends = [route.seller, route.buyer];
      world.add(g);
      routeGroups.set(key, g);
      const p = paths.get(key); if (p) { p.removeFromParent(); p.geometry.dispose(); paths.delete(key); } // the path becomes the bridge
      if (A.userData.rose === "rising" || B.userData.rose === "rising") g.visible = false;
    }
    const curve = curves.get(key), beads = [];
    for (let i = 0; i < Math.min(5, route.count); i++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), beadMat);
      bead.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowMat));
      g.add(bead);
      beads.push(bead);
    }
    const ab = route.seller < route.buyer; // curve runs low-id -> high-id
    sprays.push((t) => beads.forEach((bead, i) => {
      const u = (t * 0.1 + i / beads.length) % 1;
      bead.position.copy(curve.getPoint(ab ? u : 1 - u));
      bead.position.y += 0.14;
    }));
  }
  for (const route of T.routes) addRoute(route);
  const showRoutesOf = (id, on) => {
    for (const g of routeGroups.values()) if (g.userData.ends.includes(id)) g.visible = on;
    for (const m of paths.values()) if (m.userData.ends.includes(id)) m.visible = on;
  };
  // Paths (his call 8 Nov): every nation gets a faint path to its two nearest neighbours right
  // away; the first trade between two nations turns their path into the full bridge.
  function updatePaths() {
    const live = [...islands.entries()].filter(([, isl]) => isl.userData.status !== "dead");
    const want = new Set();
    for (const [id, isl] of live) {
      const near = live.filter(([o]) => o !== id).map(([o, oi]) => [o, isl.position.distanceTo(oi.position)]).sort((a, b) => a[1] - b[1]).slice(0, 2);
      for (const [o] of near) want.add(pairKey(id, o));
    }
    for (const [key, m] of paths) if (!want.has(key) || routeGroups.has(key)) { m.removeFromParent(); m.geometry.dispose(); paths.delete(key); }
    for (const key of want) {
      if (paths.has(key) || routeGroups.has(key)) continue;
      const [a, b] = key.split("-").map(Number), A = islands.get(a), B = islands.get(b);
      if (!A || !B) continue;
      const m = new THREE.Mesh(new THREE.TubeGeometry(bridgeCurve(A, B), 40, 0.035, 4), pathMat);
      m.userData.ends = [a, b];
      m.visible = A.userData.rose !== "rising" && B.userData.rose !== "rising";
      world.add(m);
      paths.set(key, m);
    }
  }
  updatePaths();

  // War (the finale): a red, pulsing line between two nations at war, and each side's war in its clan.
  // Plain red, not HDR: an over-bright red washed out to white and looked like an ordinary path.
  const warMat = new THREE.MeshBasicMaterial({ color: 0xff2238, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false });
  const warLinks = new Map();
  // A health bar on a warring nation's plate (12 Nov): knowledge points left of what it would hold
  // without the war (left + burned in this war). Empty = the island falls. Gone when the war ends.
  function setHealth(isl, war) {
    const plate = isl.userData.plate;
    if (!plate) return;
    let bar = plate.querySelector(".hp");
    if (!war?.id || isl.userData.status === "dead") { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement("i");
      bar.className = "hp";
      bar.innerHTML = `<em><u></u></em><small></small>`;
      plate.append(bar);
    }
    const left = war.hp ?? 0, full = Math.max(1, left + (war.burned ?? 0));
    const k = Math.max(0, Math.min(1, left / full));
    // Winning or losing (his call 12 Nov: the two sides' bars must differ by colour, not just length):
    // the side with more of its island left is winning; equal health = more points left; else even.
    const eLeft = war.enemyHp ?? 0, eK = eLeft / Math.max(1, eLeft + (war.enemyBurned ?? 0));
    const side = k > eK + 1e-9 ? "winning" : k < eK - 1e-9 ? "losing" : left > eLeft ? "winning" : left < eLeft ? "losing" : "even";
    bar.dataset.side = side;
    bar.querySelector("u").style.width = `${(k * 100).toFixed(1)}%`;
    bar.querySelector("small").textContent = `${side} · ${left}/${full}`;
    bar.title = `${left} knowledge points left; ${war.burned ?? 0} burned in this war. At 0 the nation falls.`;
  }

  function updateWars() {
    const want = new Set((W.wars || []).map((w) => pairKey(w.a, w.b)));
    for (const [k, m] of warLinks) if (!want.has(k)) { m.removeFromParent(); m.geometry.dispose(); warLinks.delete(k); }
    for (const w of W.wars || []) {
      const k = pairKey(w.a, w.b), A = islands.get(w.a), B = islands.get(w.b);
      if (warLinks.has(k) || !A || !B) continue;
      const m = new THREE.Mesh(new THREE.TubeGeometry(bridgeCurve(A, B), 48, 0.12, 8), warMat);
      world.add(m); warLinks.set(k, m);
    }
  }
  updateWars();


  // ---- night (default) and day (SPEC §12g). The sky no longer shows the weather; sound does. ----
  const THEMES = {
    day: { top: PAL.skyTop, mid: PAL.skyMid, hor: PAL.horizon, sunCol: [1.0, 0.85, 0.55], disc: 0, fog: 0xf3dfae, hemi: [0xdff9ff, 0xffc7a0, 1.6], sun: [0xfff0d0, 2.2],
      sea: [PAL.sea, 0x05606e, 0.3], cloud: [0xf2fbff, 0xd8f6ff, 0.28], mote: [1, 0.96, 0.78], moteSize: 0.16, exposure: 1.12, stars: 0, lamps: false, seaSpec: 0x9fc4d0, seaShine: 30, cloudOpacity: 0.85 },
    night: { top: 0x050822, mid: 0x111a4c, hor: 0x3d2f6a, sunCol: [0.55, 0.62, 0.95], disc: 1, fog: 0x231e4c, hemi: [0x6a78c8, 0x2a1a48, 1.15], sun: [0xb4c4ff, 1.15],
      sea: [0x0b3a58, 0x06223e, 0.45], cloud: [0x575c94, 0x2a2d5c, 0.4], mote: [1.7, 1.35, 0.45], moteSize: 0.13, exposure: 1.0, stars: 0.9, lamps: true, seaSpec: 0x2a3866, seaShine: 18, cloudOpacity: 0.55 },
  };
  function setTheme(name) {
    const T = THEMES[name] ?? THEMES.night;
    theme = THEMES[name] ? name : "night";
    const u = sky.material.uniforms;
    u.top.value.set(T.top); u.mid.value.set(T.mid); u.hor.value.set(T.hor); u.sunCol.value.setRGB(...T.sunCol); u.disc.value = T.disc;
    scene.fog.color.set(T.fog);
    hemi.color.set(T.hemi[0]); hemi.groundColor.set(T.hemi[1]); hemi.intensity = T.hemi[2];
    sunL.color.set(T.sun[0]); sunL.intensity = T.sun[1];
    sea.material.color.set(T.sea[0]); sea.material.emissive.set(T.sea[1]); sea.material.emissiveIntensity = T.sea[2];
    sea.material.specular.set(T.seaSpec); sea.material.shininess = T.seaShine; // no tiled moon glare
    puffMat.color.set(T.cloud[0]); puffMat.emissive.set(T.cloud[1]); puffMat.emissiveIntensity = T.cloud[2]; puffMat.opacity = T.cloudOpacity;
    motes.material.color.setRGB(...T.mote); motes.material.size = T.moteSize; // fireflies at night (they bloom)
    renderer.toneMappingExposure = T.exposure;
    skyStars.material.opacity = T.stars;
    for (const isl of islands.values()) if (isl.userData.lamps) isl.userData.lamps.visible = T.lamps;
    document.body.classList.toggle("night", theme === "night");
    citizenGlow.value = theme === "night" ? 0.22 : 0;
  }

  // ---- events: replay the latest day, then follow new days as the engine runs ----
  const clanName = (id) => W.clans.find((c) => c.id === Number(id))?.name ?? endedName(id) ?? `nation ${id}`;
  // Event lines go to the list under the standings; held until that list exists (no TDZ).
  // A tech record: add it to the nation and rebuild its town so the building stands there now.
  let retownLater = () => {}; // set once the people exist (folk is made further down; no TDZ)
  let errandLater = () => {};
  function techBuilt(r) {
    const isl = islands.get(r.clan);
    if (!isl) return;
    const t = (isl.userData.clan.techs ||= []);
    if (!t.includes(r.tech)) { t.push(r.tech); retownLater(r.clan); }
  }
  const early = [];
  let eventSink = (e) => early.push(e);
  const fx = createEffects({ scene, islands, curves, clanName, onFounded: (id) => riseNation(id), onRecord: (r) => { noteMissed(r); mindRecord(r); if (r.kind === "tech") techBuilt(r); if (r.kind === "rooted") loadMind(r.clan);
      // Citizens run their errands for what just happened (SPEC §14b).
      if (r.kind === "tool") errandLater(r.clan, "tool"); else if (r.kind === "trade") errandLater(r.buyer, "trade"); else if (r.kind === "gift") errandLater(r.clan, "draft"); for (const f of recordHooks) f(r); }, onEvent: (e) => eventSink(e) });
  const recordHooks = new Set(); // other modules (the god's route) hear every record the world plays
  // War on screen between rounds: cannon fire, fires and smoke, walls (src/live/war.js).
  let warLayer = { update() {}, tick() {}, atWar: () => false }; // made once the people exist (folk comes later)
  // The season standings, ranked by reverence; an overtake plays in the world (and in the replay).
  const standings = createStandings({ visor: hud.visor, W, flyTo: (id) => flyTo(id), onOvertake: (a, b, rank) => fx.play({ kind: "overtake", clan: a.id, day: W.day, text: `${a.name} passed ${b.name} and is now number ${rank}` }) });
  standings.update(W);
  eventSink = () => {}; // no event list (11 Nov): the feed and dialogue boxes say what matters
  // The personal feed and the citizens' dialogue boxes (11 Nov) hear every record the moment it arrives
  // (13 Nov, his note: they used to wait for the 3D queue to play it, minutes behind, frozen in a background
  // tab). The 3D queue plays your own nations' events first.
  const feed = createFeed({ box: standings.box, W, flyTo: (id) => flyTo(id), sandbox: !!opts.sandbox });
  const hear = (recs) => { for (const r of recs) feed.record(r); };
  fx.isMine = (r) => feed.mine(r);
  early.splice(0).forEach(standings.event);
  let lastDay = W.day;
  // Which of a turn's records play on screen (the season world plays its cut; the live world, all).
  const cut = (recs) => (opts.cut ? opts.cut(recs) : recs);
  // A turn's records arrive while it runs (the engine saves them nation by nation), so the open turn is
  // read again on every poll and only records not seen yet play (11 Nov: an Act of God, which burns at
  // the very end of a turn, never played on an open page). Big moments jump the queue.
  const seenRec = new Set();
  const fresh = (recs, d) => recs.filter((r) => { const k = `${d}:${r.i ?? JSON.stringify(r)}`; if (seenRec.has(k)) return false; seenRec.add(k); return true; });
  const BIG = new Set(["fire", "war", "peace", "fallen"]);
  const bigFirst = (recs) => [...recs.filter((r) => BIG.has(r.kind)), ...recs.filter((r) => !BIG.has(r.kind))];
  api(`day?d=${W.day}`).then((d) => { const recs = cut(fresh(d.records || [], W.day)); hear(recs); folk.dayRecords(recs, W.day); fx.enqueue(bigFirst(recs)); }).catch(() => {});
  // The game days before it in the last 24 hours (11 more) don't play on the world view, but
  // count as missed: flying in replays them.
  for (let d = Math.max(1, W.day - 11); d < W.day; d++) api(`day?d=${d}`).then((x) => (x.records || []).forEach((r) => noteMissed(r, true))).catch(() => {});

  // ---- replay what you missed (SPEC §12k) ----
  // Every world event that plays while you aren't watching that nation up close (or from before
  // you arrived) is kept per nation. Fly in and they play again in order, with the Scholars firing
  // their star-guns, under a strip that says what's replaying and lets you skip.
  const REPLAY = new Set(["fire", "corpus", "gift", "warden", "ruling", "trade", "tool", "trickster", "absorb", "report", "report-settled", "overtake"]);
  const missed = new Map(), missedKeys = new Set();
  let nearNow = 0, replaying = false, replay = null;
  const ownerOf = (r) => (r.kind === "trade" ? r.buyer : r.clan);
  const watching = (id) => focusId === id && nearNow > 0.5 && !!folk.crowds.get(id)?.group.visible;
  function noteMissed(r, old = false) {
    if (replaying || !REPLAY.has(r.kind)) return;
    const id = ownerOf(r), key = `${r.day}:${r.i ?? JSON.stringify(r).length}:${r.kind}:${id}`;
    if (id == null || missedKeys.has(key) || (!old && watching(id))) return;
    missedKeys.add(key);
    const list = missed.get(id) || [];
    list.push(r);
    list.sort((a, b) => (a.day - b.day) || ((a.i ?? 0) - (b.i ?? 0)));
    missed.set(id, list.slice(-12)); // the latest dozen is plenty
  }
  const strip = document.createElement("div");
  strip.className = "replay";
  strip.hidden = true;
  const stripText = document.createElement("span");
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Skip";
  skip.addEventListener("click", () => { if (replay) { replay.i = replay.list.length; replay.skipped = true; } });
  strip.append(stripText, skip);
  hud.visor.append(strip);
  function stepReplay(now) {
    if (opts.noReplay) return; // the season world plays its own cut, never "while you were away"
    // Left the nation mid-replay: what didn't play yet waits for the next visit.
    if (replay && (replay.id !== focusId || nearNow < 0.3)) {
      const rest = replay.list.slice(replay.i);
      if (rest.length) missed.set(replay.id, [...rest, ...(missed.get(replay.id) || [])]);
      replay = null;
      strip.hidden = true;
    }
    if (!replay && focusId != null && !flying && watching(focusId) && missed.get(focusId)?.length) {
      replay = { id: focusId, list: missed.get(focusId), i: 0, next: now + 1200 };
      missed.delete(focusId);
    }
    if (!replay) return;
    if (replay.i >= replay.list.length) {
      if (now >= replay.next || replay.skipped) { replay = null; strip.hidden = true; }
      return;
    }
    if (now < replay.next) return;
    const r = replay.list[replay.i];
    // The strip names the event that's playing now (it stays up while a star-gun shot runs).
    strip.hidden = false;
    stripText.textContent = `↺ ${replay.i + 1}/${replay.list.length}`; // the replay is the effects themselves, no words (11 Nov)
    replaying = true;
    try { fx.play(r); } finally { replaying = false; }
    replay.i++;
    replay.next = now + (r.kind === "corpus" ? 8000 : 2500); // a star-gun shot takes about 8 s
  }
  let polling = null;
  async function poll() {
    try {
      const now = await api("world");
      unready.clear();
      for (const c of now.clans) if (!ready(c) && !gone(c)) unready.add(c.id);
      for (const c of now.clans) if (!islands.has(c.id) && !gone(c) && ready(c) && !birthing.has(c.id)) birth(c);
      // Reverence moves every game day: the plates, panels and towns read the latest.
      for (const c of now.clans) {
        const isl = islands.get(c.id);
        // Techs (SPEC §14): a new building appears in the town as soon as the world knows of it.
        if (isl && (c.techs?.length ?? 0) !== (isl.userData.clan.techs?.length ?? 0)) { isl.userData.clan.techs = c.techs; retownLater(c.id); }
        if (isl) isl.userData.clan.mood = c.mood;
        // The panel reads these: keep them current (the season world pauses on any turn and reads them).
        if (isl) for (const k of ["florins", "worth", "points", "depth", "line", "clean_gifts", "fortune", "tricksters", "gods", "total_in", "alive"]) if (k in c) isl.userData.clan[k] = c[k];
        if (!isl || !c.reverence) continue;
        isl.userData.clan.reverence = c.reverence;
        const span = isl.userData.plate?.querySelector("span");
        if (span && isl.userData.status !== "dead") span.textContent = span.textContent.replace(/reverence [\d.]+|\d+ points/, `reverence ${c.reverence.standing}`);
      }
      // A nation a god just left for good: its island goes to ruins now, not on the next game day.
      for (const c of now.clans) {
        const isl = islands.get(c.id);
        if (isl && gone(c) && isl.visible) { takeDown(c.id); continue; }
        if (isl && !c.alive && isl.userData.status !== "dead") {
          isl.userData.status = "dead"; Object.assign(isl.userData.clan, c); loadMind(c.id);
          const span = isl.userData.plate?.querySelector("span");
          if (span) span.textContent = `${c.field ?? ""} nation · ${c.fallen ? "fallen" : "gone"} · ruins`;
          isl.userData.plate?.classList.add("dead");
        }
      }
      for (const route of (await api("trades?days=20")).routes || []) addRoute(route);
      updatePaths(); // a new nation gets its paths; a first trade turned a path into a bridge
      W.wars = now.wars || []; updateWars(); warLayer.update(now);
      for (const c of now.clans) { const isl = islands.get(c.id); if (isl) { isl.userData.clan.war = c.war; isl.userData.clan.fallen = c.fallen; setHealth(isl, c.war); } }
      for (let d = Math.max(1, lastDay); d <= now.day; d++) { const recs = cut(fresh(((await api(`day?d=${d}`)).records || []).filter((r) => !r.live || !playedLive.has(r.live)), d)); if (!recs.length) continue; hear(recs); folk.dayRecords(recs, d); fx.enqueue(holdBack(bigFirst(recs))); }
      W.jackpot = now.jackpot;
      standings.update(now);
      opts.onPoll?.(now); // the world clock: day or night now
      if (now.day > lastDay) { lastDay = now.day; fx.endTurn(); opts.onDay?.(now); }
      return now;
    } catch { return null; }
  }
  const pollNow = () => (polling ??= poll().finally(() => (polling = null)));
  setInterval(pollNow, 30000);
  // The live feed (SPEC §12n): what the gods' actions and new nations set off between game days,
  // within seconds. Same queue as the day's records; anything played here is skipped when its day
  // arrives. New citizens, research and reverence refresh the world at once.
  const playedLive = new Set();
  let liveSince = 0, liveBusy = false;
  async function livePoll() {
    if (liveBusy) return;
    liveBusy = true;
    try {
      const L = await api(`live?since=${liveSince}`);
      const fresh = (L.records || []).filter((r) => r.live && !playedLive.has(r.live));
      for (const r of fresh) { playedLive.add(r.live); liveSince = Math.max(liveSince, r.at || 0); }
      if (!fresh.length) return;
      for (const r of fresh) feed.record(r); // the feed and dialogue hear it now, whatever the 3D queue is doing
      folk.dayRecords(fresh, W.day + 1);
      for (const r of fresh) if (r.kind === "team" || r.kind === "corpus") loadMind(r.clan);
      fx.enqueue(holdBack(fresh));
      opts.onLive?.(fresh);
      pollNow(); // reverence, standings, panels
    } catch {} finally { liveBusy = false; }
  }
  setInterval(livePoll, 5000);
  livePoll();
  // After a god's transaction: look again now and after the API's 20 s cache, and fly to a nation
  // they just founded (by name) once it shows up.
  async function refresh(foundedName) {
    // A founding: look every 2 s for up to 2 minutes, so the island rises the moment its people are made.
    const waits = foundedName ? Array(60).fill(2000) : [2500, 12000, 23000];
    for (const wait of waits) {
      await new Promise((r) => setTimeout(r, wait));
      const now = await poll();
      const c = foundedName && now?.clans.find((x) => x.name === foundedName && islands.has(x.id) && !birthing.has(x.id));
      if (c) { setTimeout(() => flyTo(c.id), 1500); return; }
      if (!foundedName && now) return;
    }
  }
  // A smite lands: the citizen staggers, then falls (kill) or greys and slows (stunt), before the
  // chain's new state rebuilds the crowd.
  function smite(id, name, verdict) {
    fx.play({ kind: "smite", clan: id, text: `The gods ${verdict === "Kill" ? "struck down" : "stunted"} ${name}` });
    folk.smite(id, name, verdict);
    setTimeout(() => loadMind(id), 22000); // after the API's 20 s cache
  }

  // ---- the mind constellations (SPEC §12f): each nation's mindmap as stars over its island ----
  const minds = new Map(), mindQueue = new Map();
  const folk = createFolk({ scene, islands, renderer, camera }); // the people: dots far out, citizens up close
  // War on screen (src/live/war.js): weapons, crewed machines, fires, walls; only crews outside.
  warLayer = createWarLayer({ islands, fx, folk });
  warLayer.update(W);
  retownLater = folk.retown;
  errandLater = folk.errand;
  // One load at a time per nation, so two quick records can't both build a sky.
  function loadMind(id, light = [], o = {}) {
    const run = (mindQueue.get(id) || Promise.resolve()).then(async () => {
      const isl = islands.get(id);
      if (!isl) return;
      const d = await api(`clan?id=${id}&d=${lastDay}${o.fresh ? "&fresh=1" : ""}`).catch(() => null);
      if (!d || d.error) return;
      folk.setAgents(id, d.agents, lastDay);
      const old = minds.get(id);
      const all = [...d.points.map((p) => p.point), ...(d.frontier || []).map((p) => p.point)];
      const added = old ? all.filter((n) => !old.names.has(n)) : [];
      const sameShape = old && !added.length && old.drafts === (d.drafts || []).length && old.alive === d.alive;
      if (sameShape) { old.light(light); return; } // nothing new: just light the named stars again
      const m = buildMind(d, isl, { islands, clanName, fresh: new Set([...added, ...light]), fade: old?.fade, detail: old?.detail });
      m.drafts = (d.drafts || []).length;
      m.alive = d.alive;
      old?.dispose();
      isl.add(m.group);
      minds.set(id, m);
    });
    mindQueue.set(id, run.catch(() => {}));
    return run;
  }
  // Every nation's people are built in the background as soon as their sky is in, so flying in
  // shows them at once instead of waiting for the 6.7 MB citizen kit and the shader compiles.
  // Towns at page load: as many as the tier allows, nearest the view first (low: none until you fly in).
  folk.setTowns?.(T0.towns);
  Promise.allSettled(W.clans.map((c) => loadMind(c.id))).then(() => { if (!opts.stills) folk.preload([...islands.keys()].sort((a, b) => islands.get(a).position.length() - islands.get(b).position.length()).slice(0, T0.preload)); });
  // A finished corpus: if you're watching that nation, its Scholar fires the star into the sky
  // with the star-gun (it lights when it lands); otherwise the star just lights in place.
  // A made-up citation misfires (the Warden's ring follows from its own record).
  async function starGun(r) {
    // At war the citizens fight, not research: no star-gun shots, the star just lights.
    if (warLayer.atWar(r.clan)) { await loadMind(r.clan); return minds.get(r.clan)?.light([r.point]); }
    if (!r.fake) await loadMind(r.clan);
    const m = minds.get(r.clan), isl = islands.get(r.clan);
    if (!m || !isl) return;
    let to = r.fake ? null : m.worldPos(r.point);
    if (!to && !r.fake) return m.light([r.point]);
    if (r.fake) { // aim at where a new star would go: above the sky's root
      to = isl.getWorldPosition(new THREE.Vector3());
      to.y += mindBase(isl.userData.r) + 2.5;
    }
    if (!r.fake) m.hold([r.point]);
    let landed = false;
    const land = () => { if (landed) return; landed = true; if (!r.fake) m.light([r.point]); };
    if (!folk.launch(r.clan, r.scholar, { to, fake: !!r.fake, onArrive: land })) return land();
    setTimeout(land, 20000); // flew away mid-shot: never leave a star hidden
  }
  // Records that change a sky (corpus records go through the star-gun above).
  function mindRecord(r) {
    if (r.kind === "corpus") starGun(r);
    else if (r.kind === "trade" && r.point) loadMind(r.buyer, [r.point]);
    else if (r.kind === "absorb") {
      loadMind(r.clan, r.points || []);
      for (const [id, isl] of islands) if (isl.userData.status === "dead") loadMind(id); // their sockets empty
    } else if (r.kind === "gift" || r.kind === "founded") loadMind(r.clan); // a new scroll / a first root
  }
  // Hover a star or a scroll: a small card with the keyword and where it came from.
  const tip = document.createElement("div");
  tip.className = "star-tip";
  tip.hidden = true;
  document.body.append(tip);
  let hoverAt = null;
  canvas.addEventListener("pointermove", (e) => (hoverAt = e.pointerType === "mouse" ? [e.clientX, e.clientY] : null));
  canvas.addEventListener("pointerleave", () => (hoverAt = null));
  let tipKey = "";
  function hoverMinds() {
    let found = null;
    if (hoverAt) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((hoverAt[0] - rect.left) / rect.width) * 2 - 1, -((hoverAt[1] - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      ray.params.Points.threshold = 0.22;
      for (const m of minds.values()) { found = m.pick(ray); if (found) break; }
      if (!found) found = folk.pick(ray, focusId);
      ray.params.Points.threshold = 1;
    }
    if (!found) { tip.hidden = true; tipKey = ""; canvas.style.cursor = ""; return; }
    const key = found.title + found.sub;
    if (key !== tipKey) {
      tipKey = key;
      tip.className = `star-tip ${found.kind}`;
      tip.replaceChildren();
      const b = document.createElement("b"); b.textContent = found.title;
      const s = document.createElement("span"); s.textContent = found.sub;
      tip.append(b, s);
      if (found.corpus) { const c = document.createElement("i"); c.textContent = found.corpus; tip.append(c); }
    }
    tip.hidden = false;
    tip.style.transform = `translate(${hoverAt[0] + 16}px, ${hoverAt[1] + 14}px)`;
    canvas.style.cursor = "help";
  }

  // ---- camera: damped springs, zoom to cursor, bounds, float ----
  const controls = new CameraControls(camera, renderer.domElement);
  controls.smoothTime = 0.45;
  controls.draggingSmoothTime = 0.18;
  controls.dollyToCursor = true;
  controls.minDistance = 3; // the plaza view of the smallest island: towns are watched, not walked into
  controls.maxDistance = 95;
  controls.maxPolarAngle = Math.PI * 0.47; // never below the horizon
  controls.minPolarAngle = Math.PI * 0.08;
  // Bounds and the whole-world view grow with the occupied grid.
  function fitWorld() {
    let ext = 16;
    for (const isl of islands.values()) ext = Math.max(ext, Math.hypot(isl.position.x, isl.position.z) + isl.userData.r);
    const k = ext / 16;
    // Pick the home view where no island hides behind another. For each candidate angle and
    // height, project every island with a real camera (this screen's shape) and measure the gap
    // between the closest pair of islands ON SCREEN, both ways, allowing for each island's size
    // (its top plus the hanging rock). Keep the view whose worst pair is furthest apart; prefer
    // low cameras (floating, not a map) and the original angle when it's a near tie.
    const R = Math.hypot(22, 27) * k, isls = [...islands.values()];
    const probe = new THREE.PerspectiveCamera(46, camera.aspect || 16 / 9, 0.1, 600);
    const tgt = new THREE.Vector3(...HOME.target), v = new THREE.Vector3();
    let best = { az: Math.atan2(22, 27), H: 10 * Math.sqrt(k) }, bestScore = -Infinity;
    for (const hk of [1, 1.5, 2.1]) {
      const H = 10 * Math.sqrt(k) * hk;
      for (let deg = 0; deg < 360; deg += 5) {
        const az = (deg * Math.PI) / 180;
        probe.position.set(Math.sin(az) * R, H, Math.cos(az) * R);
        probe.lookAt(tgt);
        probe.updateMatrixWorld();
        const sp = isls.map((i) => {
          const r = i.userData.r, c = v.copy(i.position).setY(i.position.y - r * 0.6).project(probe);
          const x = c.x * probe.aspect, y = c.y;
          const d = probe.position.distanceTo(i.position);
          const sr = (r * 1.05) / (d * Math.tan(THREE.MathUtils.degToRad(23)));
          return { x, y, sr, sy: sr * 1.5 }; // the hanging rock makes an island taller than wide
        });
        let score = isls.length < 2 ? 0 : Infinity, out = 0;
        for (let a = 0; a < sp.length; a++) {
          if (Math.abs(sp[a].y) > 0.8 || Math.abs(sp[a].x) > probe.aspect * 0.85) out++;
          for (let b = a + 1; b < sp.length; b++) {
            const dx = Math.abs(sp[a].x - sp[b].x) - (sp[a].sr + sp[b].sr);
            const dy = Math.abs(sp[a].y - sp[b].y) - (sp[a].sy + sp[b].sy) * 0.5;
            score = Math.min(score, Math.max(dx, dy)); // apart on either axis counts
          }
        }
        score -= out * 0.5 + (hk - 1) * 0.06 + Math.abs(angDiff(az, Math.atan2(22, 27))) * 0.003;
        if (score > bestScore + 1e-6) { bestScore = score; best = { az, H }; }
      }
    }
    HOME.pos = [Math.sin(best.az) * R, best.H, Math.cos(best.az) * R];
    controls.maxDistance = 95 * Math.max(1, k * 0.8);
    controls.setBoundary(new THREE.Box3(new THREE.Vector3(-ext - 30, -8, -ext - 30), new THREE.Vector3(ext + 30, 30, ext + 30)));
    scene.fog.near = 55 * Math.max(1, k * 0.7);
  }
  controls.boundaryEnclosesCamera = false;
  controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
  // His preference (8 Nov): dragging up tips the view down, dragging down tips it up (inverted vertical).
  controls.polarRotateSpeed = -1;
  controls.mouseButtons.right = CameraControls.ACTION.TRUCK;
  controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
  controls.touches.three = CameraControls.ACTION.TOUCH_TRUCK;
  const HOME = { pos: [22, 10, 27], target: [0, 2.5, 0] }; // low, lots of sky: floating, not a map
  fitWorld();
  controls.setLookAt(...HOME.pos, ...HOME.target, false);

  let lastInput = performance.now(), flying = null, focusId = null;
  for (const ev of ["pointerdown", "wheel", "touchstart", "keydown"]) window.addEventListener(ev, () => (lastInput = performance.now()), { passive: true });

  // Fly to a clan on a curve; the lens widens mid-flight and settles (the "dolly" feel).
  // Where an island rests: during a founding rise it starts 24 below its place, under the clouds,
  // so the camera aims at where it will land (his note 9 Nov) and the island climbs into the shot.
  function restOf(isl) { return isl.position.clone().setY(isl.userData.baseY); }
  function flyTo(id) {
    const isl = islands.get(id);
    if (!isl) return;
    const p = restOf(isl), r = isl.userData.r;
    const dir = new THREE.Vector3().subVectors(camera.position, p).setY(0).normalize();
    // A little closer and lower (his note 9 Nov): aim between the island and the foot of its sky, so
    // the island fills the lower half of the frame and its knowledge still shows above it.
    const lookY = p.y + mindBase(r) * 0.4 + 0.6;
    const fit = camera.aspect < 1 ? 1 / Math.pow(camera.aspect, 0.55) : 1; // portrait phones stand back to fit the sky
    const dest = p.clone().addScaledVector(dir, (r * 3.6 + 7.5) * fit).setY(p.y + r * 0.95 + 1.6);
    focusId = id;
    controls.setLookAt(dest.x, dest.y, dest.z, p.x, lookY, p.z, true);
    flying = { t0: performance.now(), dur: 1400 };
    opts.onSelect?.(isl.userData.clan, isl.userData.status);
    lastInput = performance.now();
  }
  // The close view of a nation (the panel's Plaza button): a three-quarter look at the island top.
  async function viewPlaza(id) {
    const isl = islands.get(id);
    if (!isl) return;
    focusId = id;
    const p = restOf(isl), r = isl.userData.r;
    const dir = new THREE.Vector3().subVectors(camera.position, p).setY(0).normalize();
    const d = p.clone().addScaledVector(dir, r * 1.55).setY(p.y + r * 0.85);
    controls.setLookAt(d.x, d.y, d.z, p.x, p.y + r * 0.08, p.z, true);
    flying = { t0: performance.now(), dur: 1400 };
    lastInput = performance.now();
    folkFor = id;
    await folk.focus(id);
  }
  function home() {
    focusId = null;
    controls.setLookAt(...HOME.pos, ...HOME.target, true);
    flying = { t0: performance.now(), dur: 1400 };
    opts.onSelect?.(null);
  }

  // Click an island to fly there.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // a drag, not a click
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const inSky = (o) => { for (; o; o = o.parent) if (o.name === "mind") return true; return false; };
    // Looking into a mind (PLAN_13NOV step 3): a tap on a star of a sky that's showing opens that star (onStar).
    ray.params.Points = { threshold: 0.35 };
    const star = ray.intersectObjects([...islands.values()], true).find((x) => x.object.isPoints && x.object.userData.list && inSky(x.object) && (x.object.material.uniforms?.uFade?.value ?? 0) > 0.3);
    if (star && opts.onStar) {
      let o = star.object;
      while (o && !o.userData.clan) o = o.parent;
      const s = star.object.userData.list[star.index];
      if (o && s) return opts.onStar(o.userData.clan.id, s.name);
    }
    const hit = ray.intersectObjects([...islands.values()], true).find((x) => !inSky(x.object));
    if (!hit) return;
    let o = hit.object;
    while (o && !o.userData.clan) o = o.parent;
    if (o) flyTo(o.userData.clan.id);
  });

  // ---- post: depth of field on what you're looking at + bloom on HDR effects (desktop) ----
  const lowPower = !opts.stills && (matchMedia("(pointer: coarse)").matches || innerWidth < 900);
  let composer = null, bokeh = null;
  if (!lowPower && T0.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bokeh = new BokehPass(scene, camera, { focus: 30, aperture: 0.00003, maxblur: 0.004 }); // gentle: far haze softens, focus stays crisp
    composer.addPass(bokeh);
    // Threshold just above white: daylight stays crisp, only the >1.0 effect colours glow.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.35, 1.05));
    composer.addPass(new OutputPass());
  }

  // Phones (his note 8 Nov): with the nation's sheet open at the bottom, the view slides up by
  // `viewShift` px so the island sits in the open top part of the screen, not under the sheet.
  let viewShift = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    if (viewShift) camera.setViewOffset(w, h, 0, viewShift, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  const tmpV = new THREE.Vector3(), tmpT = new THREE.Vector3();
  let prevAz = controls.azimuthAngle, bank = 0, frameN = 0, folkFor = null;
  const baseFov = 46;
  // The quality stepper (12 Nov): low draws at most 30 times a second; a slow machine steps down a tier,
  // and the lighter settings apply at once (antialias, fixed at start, waits for the next visit).
  let lastDraw = performance.now();
  function applyTier(name) {
    const T = TIERS[name];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, T.pixelRatio));
    if (!T.bloom && composer) { composer.dispose?.(); composer = null; bokeh = null; }
    if (!T.shadows && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); }
    folk.setTowns?.(T.towns);
    resize();
    console.info(`[quality] ${name}`);
  }
  function frame() {
    const nowMs = performance.now();
    if (!stepper.shouldDraw(nowMs - lastDraw)) { requestAnimationFrame(frame); return; }
    const stepped = stepper.frame(nowMs - lastDraw);
    lastDraw = nowMs;
    if (stepped) { tierName = stepped; applyTier(stepped); }
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    // Idle: after 20 s without input the gods' view slowly orbits.
    if (performance.now() - lastInput > 20000 && !flying) controls.rotate(dt * 0.035, 0, false);
    controls.update(dt);

    // Lens swell during a flight (sin bump), back to normal on arrival.
    if (flying) {
      const k = Math.min(1, (performance.now() - flying.t0) / flying.dur);
      camera.fov = baseFov + Math.sin(k * Math.PI) * 14;
      camera.updateProjectionMatrix();
      if (k >= 1) flying = null;
    }
    // Float: a slow breath, and a bank into turns (roll follows the azimuth speed).
    const azVel = (controls.azimuthAngle - prevAz) / Math.max(dt, 1e-3);
    prevAz = controls.azimuthAngle;
    bank += (THREE.MathUtils.clamp(-azVel * 0.05, -0.09, 0.09) - bank) * Math.min(1, dt * 3);
    camera.position.y += Math.sin(t * 0.55) * 0.06;
    camera.rotateZ(bank + Math.sin(t * 0.31) * 0.004);
    hud.visor.style.transform = `translate(${-azVel * 6}px, ${Math.sin(t * 0.55) * 3}px) rotate(${bank * 30}deg)`;

    fallUniforms.uTime.value = t;
    for (const s of sprays) s(t);
    updateRising();
    for (const isl of islands.values()) isl.position.y = isl.userData.baseY + (isl.userData.riseY || 0) + Math.sin(t * 0.45 + isl.userData.bob) * 0.3;
    warMat.opacity = 0.55 + 0.35 * Math.sin(t * 3);
    warLayer.tick(t, performance.now());
    const sp = sea.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, Math.sin(seaBase[i * 3] * 0.12 + t * 0.6) * 0.6 + Math.cos(seaBase[i * 3 + 2] * 0.1 + t * 0.4) * 0.6);
    sp.needsUpdate = true;
    motes.rotation.y = t * 0.008;
    fx.setCrowd(controls.distance > 26 ? 1 : 3);
    hud.plates.classList.toggle("far", controls.distance > 30); // world view: names only, smaller
    // A nation's sky shows only when you're looking at that nation from close in (the camera's
    // target sits over it and you're zoomed in). From the whole-world view the skies are gone.
    const px = canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    // One sky at a time: the focused nation's. Flying to a nation focuses it; zooming in near an
    // island focuses that one; panning well past the canopy lets go. The whole-world view
    // (camera far out) shows none.
    controls.getTarget(tmpT);
    let focusNear = 0;
    const offOf = (id) => { const i = islands.get(id); return Math.hypot(tmpT.x - i.position.x, tmpT.z - i.position.z); };
    const fitNow = camera.aspect < 1 ? 1 / Math.pow(camera.aspect, 0.55) : 1; // same stand-back as flyTo
    const zoomK = 1 - THREE.MathUtils.smoothstep(controls.distance, 31 * fitNow, 35 * fitNow);
    if (focusId != null && (!minds.has(focusId) || offOf(focusId) > minds.get(focusId).layout.reach + 6)) focusId = null;
    if (focusId == null && zoomK > 0.5 && !flying) {
      let best = null, bd = Infinity;
      for (const [id, isl] of islands) { const o = offOf(id); if (o < isl.userData.r * 1.5 + 2 && o < bd) { bd = o; best = id; } }
      focusId = best;
    }
    for (const [id, m] of minds) {
      const isl = islands.get(id);
      const focused = id !== focusId || isl.userData.rose === "rising" ? 0 : zoomK * (1 - THREE.MathUtils.smoothstep(offOf(id), m.layout.reach + 1, m.layout.reach + 6));
      // Every nation's sky can be seen dimly from the whole world, day or night (his note 8 Nov: by day
      // they all vanished when the clock turned). Flown in: only your nation's sky.
      const near = Math.max(focused, isl.userData.rose !== "rising" && focusId == null && TIERS[tierName].skies !== false ? (theme === "night" ? 0.38 : 0.34) : 0);
      m.update(near, px, focused);
      if (id === focusId) focusNear = focused;
    }
    // Citizens: built the first time you come close to a nation (the kit loads then).
    if (focusId == null) folkFor = null; // coming back later rebuilds them if they were let go
    if (focusId != null && focusNear > 0.3 && folkFor !== focusId) { folkFor = focusId; folk.focus(focusId); }
    folk.update(dt, camera, focusId, focusNear);
    nearNow = focusNear;
    stepReplay(performance.now());
    if ((frameN++ & 1) === 0) hoverMinds();
    fx.update();
    if (bokeh) bokeh.uniforms.focus.value = controls.distance;
    if (composer) composer.render(); else renderer.render(scene, camera);
    labels.render(scene, camera);
    // Plates: fade before the HUD bar at the top, and when plates overlap on screen the
    // nearer one wins (farther ones fade back), so names never stack into mush.
    const shown = [];
    const plates = [...islands.values()].filter((i) => i.userData.plate).map((isl) => {
      const v = isl.userData.plateObj.getWorldPosition(tmpV).project(camera);
      return { isl, x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight, d: camera.position.distanceTo(isl.position), w: isl.userData.plate.offsetWidth || 220, h: isl.userData.plate.offsetHeight || 46 };
    }).sort((a, b) => a.d - b.d);
    for (const p of plates) {
      const el = p.isl.userData.plate;
      const hidden = shown.some((q) => Math.abs(q.x - p.x) < (q.w + p.w) / 2 - 6 && Math.abs(q.y - p.y) < (q.h + p.h) / 2 - 4);
      if (!hidden) shown.push(p);
      el.style.opacity = String(Math.max(0, Math.min(1, (p.y - 70) / 50)) * (p.isl.userData.plateFade ?? 1) * (hidden ? 0.12 : 1));
      el.style.pointerEvents = p.y < 90 || hidden ? "none" : "auto";
    }
    requestAnimationFrame(frame);
  }
  frame();
  setTheme(opts.theme || "night");
  // setWars: show war lines without a world refresh (the intro recorder; display only).
  return { quality: () => ({ tier: tierName, auto: pick === "auto", memory: { ...renderer.info.memory }, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, towns: folk.crowds.size }), setViewShift: (px) => { viewShift = Math.max(0, Math.round(px)); resize(); }, setWars: (w) => { W.wars = w; updateWars(); }, world: W, flyTo, home, controls, camera, fx, riseNation, minds, loadMind, setTheme, theme: () => theme, folk, viewPlaza, refresh, poll: pollNow, smite, missed: () => missed, onRecord: (f) => recordHooks.add(f), islands, feed, standingsRank: () => standings.ranks?.() ?? {} };
}

// A clan's island: size from its mindmap, town from its state.
// The pole at the North Pole: red and white stripes wound round it, a gold ball on top.
function northPole(r) {
  const cv = document.createElement("canvas"); cv.width = 64; cv.height = 256;
  const g = cv.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 256);
  g.fillStyle = "#d8202a";
  for (let y = -64; y < 320; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y - 32); g.lineTo(64, y - 8); g.lineTo(0, y + 24); g.fill(); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 2);
  const h = r * 1.5;
  const grp = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, h, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  stick.position.y = h / 2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.6, roughness: 0.25, emissive: 0x6a3a00, emissiveIntensity: 0.35 }));
  ball.position.y = h + 0.2;
  grp.add(stick, ball);
  grp.position.set(-r * 0.78, 0, -r * 0.42); // near the rim, clear of the plaza's buildings
  return grp;
}
function buildClanIsland(c, r, status, sprays) {
  const dead = status === "dead";
  const pole = isNorthPole(c);
  // North Pole: snow on top, ice below, red roofs, and the pole itself.
  const isl = island(r, dead ? { grass: 0xb9b1a6, rock: 0x8f857c } : pole ? { grass: 0xf4f8ff, rock: 0x9fb6cc } : { grass: status === "neglected" ? 0xc8b46a : pick(PAL.grass), rock: pick(PAL.rock) });
  const town = new THREE.Group();
  town.userData.noMerge = true; // its buildings merge one by one (the townsfolk read each one), see mergeIsland
  isl.add(town);
  const accent = pole ? 0xd8202a : FIELD_COLOR[c.field] ?? pick(PAL.dome);
  if (pole && !dead) { const np = northPole(r); np.userData.noMerge = true; isl.add(np); } // on the island itself: the plaza's close-up town replaces `town`
  if (dead) {
    // Broken pillars: what's left of the temple.
    for (let i = 0; i < 6; i++) {
      const col = mesh(new THREE.CylinderGeometry(0.12, 0.14, range(0.3, 1.2), 6), 0xe8e0d4, 0.06);
      const a = (i / 6) * Math.PI * 2;
      col.position.set(Math.cos(a) * r * 0.35, 0.3, Math.sin(a) * r * 0.35);
      col.rotation.z = range(-0.4, 0.4);
      town.add(col);
    }
    return mergeIsland(isl, town);
  }
  const tp = temple(r * 0.5, accent);
  tp.userData.lamp = 0.16;
  town.add(tp);
  if (c.points > 30) {
    const tw = tower(r * 0.55, accent);
    tw.userData.lamp = 0.5;
    tw.position.set(r * 0.5, 0, -r * 0.35);
    town.add(tw);
  }
  // Houses = agents' homes; trees = fortune (rich clans overgrow, neglected ones thin out).
  const trees = Math.round((status === "rich" ? 10 : status === "neglected" ? 2 : 5) * Math.min(1.6, c.fortune || 1));
  const n = 4 + trees;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + range(0, 0.4);
    const rr = r * range(0.55, 0.82);
    const o = i < 4 ? house(r * 0.14, accent) : tree(r * range(0.22, 0.34));
    if (i < 4) o.userData.lamp = 0.1;
    o.userData.kind = i < 4 ? "house" : "tree"; // people walk under a tree's leaves, never through a house
    o.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    o.rotation.y = range(0, Math.PI);
    town.add(o);
  }
  if (c.clean_gifts > 0) {
    const f = fountain(r * 0.16, sprays);
    f.userData.noMerge = true; // its water moves
    f.position.set(-r * 0.45, 0, r * 0.3);
    town.add(f);
  }
  const wf = waterfall(r * 0.3, r * 4 + 10);
  const a = 0.7;
  wf.position.set(Math.cos(a) * r * 0.96, 0.02, Math.sin(a) * r * 0.96);
  wf.rotation.y = -a + Math.PI / 2;
  wf.userData.noMerge = true; // a flowing shader
  isl.add(wf);
  const m = mist(30, r * 0.5, sprays);
  m.userData.noMerge = true;
  m.position.set(Math.cos(a) * r * 1.25, -(r * 4 + 10) + 0.5, Math.sin(a) * r * 1.25);
  isl.add(m);
  return mergeIsland(isl, town);
}
// Fewer draw calls (12 Nov): each building merges inside itself (same group, place, tags and footprint), then
// the island's own rocks merge; anything marked noMerge (water, mist, the pole) is left as it was.
function mergeIsland(isl, town) {
  for (const o of town.children) if (!o.userData.noMerge) mergeStatic(o);
  mergeStatic(isl);
  // Then the whole town draws as one shape; the buildings stay as groups (folk.js reads and hides them and
  // calls reshell after).
  townShell(town);
  isl.userData.reshell = () => townShell(town);
  return isl;
}

function bridgeCurve(A, B) {
  const [P, Q] = A.userData.clan.id < B.userData.clan.id ? [A, B] : [B, A];
  const a0 = P.position, b0 = Q.position;
  const dir = b0.clone().sub(a0).setY(0).normalize();
  const a = a0.clone().addScaledVector(dir, P.userData.r * 0.92).setY(a0.y + 0.1);
  const b = b0.clone().addScaledVector(dir, -Q.userData.r * 0.92).setY(b0.y + 0.1);
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= Math.max(0.8, a.distanceTo(b) * 0.12);
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function bridge(curve, weight) {
  const g = new THREE.Group();
  const ropes = [new THREE.MeshBasicMaterial({ color: 0xff4fa3 }), new THREE.MeshBasicMaterial({ color: 0xffc93c })];
  const A = curve.v0, M = curve.v1, B = curve.v2;
  const dir = B.clone().sub(A).setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.18);
  [-1, 1].forEach((k, i) => {
    const off = side.clone().multiplyScalar(k);
    const lift = (v, y) => v.clone().add(off).setY(v.y + y);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(lift(A, 0.24), lift(M, 0.24), lift(B, 0.24)), 48, 0.026 * weight, 5), ropes[i]));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(lift(A, 0), lift(M, 0), lift(B, 0)), 48, 0.02 * weight, 4), ropes[i]));
  });
  const n = Math.round(A.distanceTo(B) / 0.24);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const plank = mesh(new THREE.BoxGeometry(0.42, 0.03, 0.11), i % 2 ? 0xffd36e : 0xffe9b0, 0.05);
    plank.position.copy(curve.getPoint(t));
    plank.lookAt(curve.getPoint(Math.min(1, t + 0.01)));
    g.add(plank);
  }
  mergeStatic(g); // ~130 planks -> one shape (12 Nov)
  return g;
}
