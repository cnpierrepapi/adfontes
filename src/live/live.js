// The live world (step 1): islands and bridges built from the real world (API), and the
// floating god's camera. Zoom levels become information levels in later steps.
import * as THREE from "three";
import CameraControls from "camera-controls";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createEffects } from "./effects.js";
import { PAL, island, temple, tower, house, tree, fountain, waterfall, mist, mesh, school, fallUniforms, range, pick } from "../scene.js";

CameraControls.install({ THREE });

const FIELD_ANGLE = { batteries: -0.35, "solar cells": 1.75, "carbon capture": 3.85 };
const FIELD_COLOR = { batteries: 0x2fa8ff, "solar cells": 0xffc93c, "carbon capture": 0x22c47e };

export async function startLive(canvas, hud, opts = {}) {
  const api = (p) => fetch(`/api/${p}`, { cache: "no-store" }).then((r) => r.json());

  // ---- renderer, labels, scene ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opts.stills });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const labels = new CSS2DRenderer({ element: hud.plates });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
  scene.fog = new THREE.Fog(0xf3dfae, 55, 300); // fades into the sky's own horizon gold, so the sea has no edge
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, mid: { value: new THREE.Color(PAL.skyMid) }, hor: { value: new THREE.Color(PAL.horizon) }, sun: { value: new THREE.Vector3(-0.5, 0.35, -0.8).normalize() }, chill: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top, mid, hor, sun; uniform float chill; varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 c = mix(hor, mid, smoothstep(-0.05, 0.25, y));
          c = mix(c, top, smoothstep(0.25, 0.8, y));
          float s = max(0.0, dot(vP, sun));
          c += vec3(1.0, 0.85, 0.55) * (pow(s, 24.0) * 0.9 + pow(s, 4.0) * 0.25) * (1.0 - chill * 0.7);
          c = mix(c, vec3(0.62, 0.74, 0.86), chill * 0.45);
          gl_FragColor = vec4(min(c, vec3(0.98)), 1.0); // never above white, so the sky never blooms
        }`,
    }),
  );
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xdff9ff, 0xffc7a0, 1.6));
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

  // Archipelagos by field; clans of a field ring around its centre.
  const byField = {};
  for (const c of W.clans) (byField[c.field || "unknown"] ||= []).push(c);
  for (const [field, clans] of Object.entries(byField)) {
    const a = FIELD_ANGLE[field] ?? Object.keys(byField).indexOf(field) * 2.1;
    const cx = Math.cos(a) * 10, cz = Math.sin(a) * 10;
    clans.forEach((c, i) => {
      const r = 1.8 + Math.min(2.6, Math.sqrt(c.points || 1) * 0.24);
      const ring = clans.length === 1 ? 0 : 4 + r;
      const b = (i / clans.length) * Math.PI * 2 + a;
      const pos = new THREE.Vector3(cx + Math.cos(b) * ring, range(-1.5, 2.5), cz + Math.sin(b) * ring);
      const status = !c.alive ? "dead" : c.total_in > avgIn * 1.0001 && live.length > 1 ? "rich" : c.total_in < avgIn / 4 ? "neglected" : "ok";
      const isl = buildClanIsland(c, r, status, sprays);
      isl.position.copy(pos);
      isl.userData = { ...isl.userData, clan: c, baseY: pos.y, bob: Math.random() * Math.PI * 2, r, status };
      world.add(isl);
      islands.set(c.id, isl);

      // Floating name plate (always faces you).
      const plate = document.createElement("button");
      plate.className = `plate ${status}`;
      plate.innerHTML = `<b></b><span></span>`;
      plate.querySelector("b").textContent = c.name;
      plate.querySelector("span").textContent = `${c.field ?? ""} · ${c.points} points${status === "dead" ? " · ruins" : status === "rich" ? " · rich, lazy" : status === "neglected" ? " · neglected" : ""}`;
      plate.addEventListener("click", () => flyTo(c.id));
      const lbl = new CSS2DObject(plate);
      lbl.position.set(0, r * 1.3 + 2.2, 0);
      isl.add(lbl);
      isl.userData.plate = plate;
      isl.userData.plateObj = lbl;
    });
  }

  // Bridges = trade routes; beads of light run seller -> buyer.
  const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.45, depthWrite: false });
  const seen = new Set();
  const curves = new Map();
  for (const route of T.routes) {
    const A = islands.get(route.seller), B = islands.get(route.buyer);
    if (!A || !B) continue;
    const key = [route.seller, route.buyer].sort().join("-");
    const curve = bridgeCurve(A, B);
    curves.set(key, curve);
    if (!seen.has(key)) { world.add(bridge(curve, Math.min(3, 1 + Math.log2(1 + route.count)))); seen.add(key); }
    const beads = [];
    for (let i = 0; i < Math.min(5, route.count); i++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), beadMat);
      bead.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowMat));
      world.add(bead);
      beads.push(bead);
    }
    const ab = route.seller < route.buyer; // curve runs low-id -> high-id
    sprays.push((t) => beads.forEach((bead, i) => {
      const u = (t * 0.1 + i / beads.length) % 1;
      bead.position.copy(curve.getPoint(ab ? u : 1 - u));
      bead.position.y += 0.14;
    }));
  }

  // Weather: the real week's NEAR price change tints the sky and fog.
  const change = W.weather?.change ?? 0;
  const chill = Math.max(0, Math.min(1, -change * 4));
  sky.material.uniforms.chill.value = chill;
  scene.fog.color.lerp(new THREE.Color(0xb7c7d4), chill * 0.55);

  // ---- events: replay the latest day, then follow new days as the engine runs ----
  const clanName = (id) => W.clans.find((c) => c.id === Number(id))?.name ?? `clan ${id}`;
  const fx = createEffects({ scene, islands, curves, clanName });
  let lastDay = W.day;
  api(`day?d=${W.day}`).then((d) => fx.enqueue(d.records || [])).catch(() => {});
  setInterval(async () => {
    try {
      const now = await api("world");
      for (let d = lastDay + 1; d <= now.day; d++) fx.enqueue((await api(`day?d=${d}`)).records || []);
      if (now.day > lastDay) { lastDay = now.day; opts.onDay?.(now); }
    } catch {}
  }, 30000);

  // ---- camera: damped springs, zoom to cursor, bounds, float ----
  const controls = new CameraControls(camera, renderer.domElement);
  controls.smoothTime = 0.45;
  controls.draggingSmoothTime = 0.18;
  controls.dollyToCursor = true;
  controls.minDistance = 4;
  controls.maxDistance = 95;
  controls.maxPolarAngle = Math.PI * 0.47; // never below the horizon
  controls.minPolarAngle = Math.PI * 0.08;
  controls.setBoundary(new THREE.Box3(new THREE.Vector3(-45, -8, -45), new THREE.Vector3(45, 30, 45)));
  controls.boundaryEnclosesCamera = false;
  controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
  controls.mouseButtons.right = CameraControls.ACTION.TRUCK;
  controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
  controls.touches.three = CameraControls.ACTION.TOUCH_TRUCK;
  const HOME = { pos: [22, 10, 27], target: [0, 2.5, 0] }; // low, lots of sky: floating, not a map
  controls.setLookAt(...HOME.pos, ...HOME.target, false);

  let lastInput = performance.now(), flying = null;
  for (const ev of ["pointerdown", "wheel", "touchstart", "keydown"]) window.addEventListener(ev, () => (lastInput = performance.now()), { passive: true });

  // Fly to a clan on a curve; the lens widens mid-flight and settles (the "dolly" feel).
  function flyTo(id) {
    const isl = islands.get(id);
    if (!isl) return;
    const p = isl.position, r = isl.userData.r;
    const dir = new THREE.Vector3().subVectors(camera.position, p).setY(0).normalize();
    const dest = p.clone().addScaledVector(dir, r * 4.4 + 6).setY(p.y + r * 1.1 + 1.6); // low arrival: horizon stays in view
    controls.setLookAt(dest.x, dest.y, dest.z, p.x, p.y + 0.8, p.z, true);
    flying = { t0: performance.now(), dur: 1400 };
    opts.onSelect?.(isl.userData.clan, isl.userData.status);
    lastInput = performance.now();
  }
  function home() {
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
    const hit = ray.intersectObjects([...islands.values()], true)[0];
    if (!hit) return;
    let o = hit.object;
    while (o && !o.userData.clan) o = o.parent;
    if (o) flyTo(o.userData.clan.id);
  });

  // ---- post: depth of field on what you're looking at + bloom on HDR effects (desktop) ----
  const lowPower = !opts.stills && (matchMedia("(pointer: coarse)").matches || innerWidth < 900);
  let composer = null, bokeh = null;
  if (!lowPower) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bokeh = new BokehPass(scene, camera, { focus: 30, aperture: 0.00003, maxblur: 0.004 }); // gentle: far haze softens, focus stays crisp
    composer.addPass(bokeh);
    // Threshold just above white: daylight stays crisp, only the >1.0 effect colours glow.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.35, 1.05));
    composer.addPass(new OutputPass());
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  const tmpV = new THREE.Vector3();
  let prevAz = controls.azimuthAngle, bank = 0;
  const baseFov = 46;
  function frame() {
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
    for (const isl of islands.values()) isl.position.y = isl.userData.baseY + Math.sin(t * 0.45 + isl.userData.bob) * 0.3;
    const sp = sea.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, Math.sin(seaBase[i * 3] * 0.12 + t * 0.6) * 0.6 + Math.cos(seaBase[i * 3 + 2] * 0.1 + t * 0.4) * 0.6);
    sp.needsUpdate = true;
    motes.rotation.y = t * 0.008;
    fx.update();
    if (bokeh) bokeh.uniforms.focus.value = controls.distance;
    if (composer) composer.render(); else renderer.render(scene, camera);
    labels.render(scene, camera);
    // Plates fade out before they slide under the HUD bar at the top.
    for (const isl of islands.values()) {
      const el = isl.userData.plate;
      if (!el) continue;
      const v = isl.userData.plateObj.getWorldPosition(tmpV).project(camera);
      const y = (1 - v.y) / 2 * canvas.clientHeight;
      el.style.opacity = String(Math.max(0, Math.min(1, (y - 70) / 50)));
      el.style.pointerEvents = y < 90 ? "none" : "auto";
    }
    requestAnimationFrame(frame);
  }
  frame();
  return { world: W, flyTo, home, controls, camera, fx };
}

// A clan's island: size from its mindmap, town from its state.
function buildClanIsland(c, r, status, sprays) {
  const dead = status === "dead";
  const isl = island(r, dead ? { grass: 0xb9b1a6, rock: 0x8f857c } : { grass: status === "neglected" ? 0xc8b46a : pick(PAL.grass), rock: pick(PAL.rock) });
  const town = new THREE.Group();
  isl.add(town);
  const accent = FIELD_COLOR[c.field] ?? pick(PAL.dome);
  if (dead) {
    // Broken pillars: what's left of the temple.
    for (let i = 0; i < 6; i++) {
      const col = mesh(new THREE.CylinderGeometry(0.12, 0.14, range(0.3, 1.2), 6), 0xe8e0d4, 0.06);
      const a = (i / 6) * Math.PI * 2;
      col.position.set(Math.cos(a) * r * 0.35, 0.3, Math.sin(a) * r * 0.35);
      col.rotation.z = range(-0.4, 0.4);
      town.add(col);
    }
    return isl;
  }
  town.add(temple(r * 0.5, accent));
  if (c.points > 30) {
    const tw = tower(r * 0.55, accent);
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
    o.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    o.rotation.y = range(0, Math.PI);
    town.add(o);
  }
  if (c.clean_gifts > 0) {
    const f = fountain(r * 0.16, sprays);
    f.position.set(-r * 0.45, 0, r * 0.3);
    town.add(f);
  }
  const wf = waterfall(r * 0.3, r * 4 + 10);
  const a = 0.7;
  wf.position.set(Math.cos(a) * r * 0.96, 0.02, Math.sin(a) * r * 0.96);
  wf.rotation.y = -a + Math.PI / 2;
  isl.add(wf);
  const m = mist(30, r * 0.5, sprays);
  m.position.set(Math.cos(a) * r * 1.25, -(r * 4 + 10) + 0.5, Math.sin(a) * r * 1.25);
  isl.add(m);
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
  return g;
}
