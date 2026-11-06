// World events played out in place: each record from the engine becomes a short effect at the
// island where it happened, plus a bubble of plain words rising from it.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { says } from "../says.js";

// Colours above 1.0 so only these effects bloom (bloom threshold sits just above white).
const HDR = (r, g, b) => new THREE.Color(r, g, b);
const GOLD = HDR(2.2, 1.6, 0.5), RED = HDR(3.4, 0.5, 0.6), CYAN = HDR(0.8, 2.6, 3.2), WHITE = HDR(2.6, 2.6, 2.4), VIOLET = HDR(1.9, 1.1, 3.4);

export function createEffects({ scene, islands, curves, clanName }) {
  const live = [];
  const add = (fx) => live.push(fx);
  const top = (isl) => isl.position.clone().add(new THREE.Vector3(0, 0.6, 0));

  // One bubble per island at a time, above its name plate, one sentence long.
  const current = new Map();
  function bubble(isl, text, kind) {
    if (!isl) return;
    current.get(isl)?.();
    if (text.length > 110) text = text.slice(0, 107).replace(/\s+\S*$/, "") + "…";
    const el = document.createElement("div");
    el.className = `bubble ${kind}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    const r = isl.userData.r;
    obj.position.set(0, r * 1.3 + 4.4, 0);
    isl.add(obj);
    const t0 = performance.now();
    let gone = false;
    current.set(isl, () => { gone = true; });
    add(() => {
      const k = gone ? 1 : (performance.now() - t0) / 6000;
      obj.position.y = r * 1.3 + 4.4 + k * 2.4;
      el.style.opacity = String(k < 0.1 ? k * 10 : k > 0.75 ? Math.max(0, (1 - k) * 4) : 1);
      if (k >= 1) { isl.remove(obj); el.remove(); if (current.get(isl) && gone === false) current.delete(isl); return false; }
      return true;
    });
  }

  // A comet of knowledge along the bridge, seller -> buyer.
  function comet(seller, buyer, color) {
    const A = islands.get(seller), B = islands.get(buyer);
    if (!A || !B) return;
    const key = [seller, buyer].sort((a, b) => a - b).join("-");
    let curve = curves.get(key), forward = seller < buyer;
    if (!curve) { // no bridge yet: an arc through the air
      const a = top(A), b = top(B), m = a.clone().lerp(b, 0.5);
      m.y += a.distanceTo(b) * 0.35;
      curve = new THREE.QuadraticBezierCurve3(a, m, b);
      forward = true;
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color }));
    const trail = Array.from({ length: 7 }, (_, i) => new THREE.Mesh(new THREE.SphereGeometry(0.16 - i * 0.018, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 - i * 0.1 })));
    scene.add(head, ...trail);
    const t0 = performance.now();
    add(() => {
      const k = (performance.now() - t0) / 2400;
      const at = (u) => curve.getPoint(Math.max(0, Math.min(1, forward ? u : 1 - u)));
      head.position.copy(at(k)).y += 0.3;
      trail.forEach((m, i) => m.position.copy(at(k - (i + 1) * 0.025)).setY(at(k - (i + 1) * 0.025).y + 0.3));
      if (k >= 1.05) { scene.remove(head, ...trail); return false; }
      return true;
    });
  }

  // A page of light rising out of the island (a new corpus).
  function page(isl, color) {
    if (!isl) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(m);
    const t0 = performance.now(), base = top(isl);
    add(() => {
      const k = (performance.now() - t0) / 3200;
      m.position.copy(base).y += 0.4 + k * 4.5;
      m.rotation.y = k * 6;
      m.material.opacity = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.6) / 0.4);
      if (k >= 1) { scene.remove(m); return false; }
      return true;
    });
  }

  // A beam to the gods (a gift). Gold if the Warden passed it, red if not.
  function beam(isl, color) {
    if (!isl) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.26, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(m);
    const t0 = performance.now(), base = top(isl);
    add(() => {
      const k = (performance.now() - t0) / 4200;
      m.position.copy(base).y += 30;
      m.scale.x = m.scale.z = 1 + Math.sin(k * Math.PI) * 0.6;
      m.material.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.45;
      if (k >= 1) { scene.remove(m); return false; }
      return true;
    });
  }

  // An expanding ring on the island (the Warden caught something).
  function ring(isl, color) {
    if (!isl) return;
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.rotation.x = Math.PI / 2;
    scene.add(m);
    const t0 = performance.now(), base = top(isl), r = isl.userData.r;
    add(() => {
      const k = (performance.now() - t0) / 1800;
      m.position.copy(base).y += 0.3;
      m.scale.setScalar(0.4 + k * r * 1.3);
      m.material.opacity = 1 - k;
      if (k >= 1) { scene.remove(m); return false; }
      return true;
    });
  }

  // A dark spark dropping onto the island (a Trickster moves in).
  function drop(isl) {
    if (!isl) return;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: 0x1d1430 }));
    scene.add(m);
    const t0 = performance.now(), base = top(isl);
    add(() => {
      const k = (performance.now() - t0) / 2000;
      m.position.copy(base).y += Math.max(0, 9 * (1 - k * 1.4));
      m.rotation.x += 0.2; m.rotation.y += 0.13;
      if (k > 0.72) m.scale.setScalar(Math.max(0.01, 1 - (k - 0.72) * 3.5));
      if (k >= 1) { scene.remove(m); return false; }
      return true;
    });
  }

  // Debris flying from a dead clan's ruins to the clan that absorbed them.
  function debris(fromIsl, toIsl) {
    if (!fromIsl || !toIsl) return;
    const rocks = Array.from({ length: 12 }, () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.12, 0), new THREE.MeshLambertMaterial({ color: 0xc9bfb3, flatShading: true })));
    scene.add(...rocks);
    const a = top(fromIsl), b = top(toIsl), t0 = performance.now();
    const offs = rocks.map(() => new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2));
    add(() => {
      const k = (performance.now() - t0) / 3400;
      rocks.forEach((m, i) => {
        const u = Math.max(0, Math.min(1, k * 1.2 - i * 0.02));
        m.position.copy(a).lerp(b, u).add(offs[i].clone().multiplyScalar(Math.sin(u * Math.PI))).y += Math.sin(u * Math.PI) * 3;
        m.rotation.x += 0.05; m.rotation.z += 0.03;
      });
      if (k >= 1) { scene.remove(...rocks); return false; }
      return true;
    });
  }

  const deadIsland = () => [...islands.values()].find((i) => i.userData.status === "dead");

  function play(r) {
    const text = says(r, clanName);
    switch (r.kind) {
      case "trade": comet(r.seller, r.buyer, r.tool ? VIOLET : CYAN); bubble(islands.get(r.buyer), text, "trade"); break;
      case "corpus": page(islands.get(r.clan), r.fake ? RED : WHITE); bubble(islands.get(r.clan), text, "corpus"); break;
      case "gift": beam(islands.get(r.clan), r.passed ? GOLD : RED); bubble(islands.get(r.clan), text, r.passed ? "gift" : "warden"); break;
      case "warden": ring(islands.get(r.clan), RED); bubble(islands.get(r.clan), text, "warden"); break;
      case "trickster": drop(islands.get(r.clan)); bubble(islands.get(r.clan), text, "trickster"); break;
      case "absorb": debris(deadIsland(), islands.get(r.clan)); bubble(islands.get(r.clan), text, "absorb"); break;
      case "tool": ring(islands.get(r.clan), VIOLET); bubble(islands.get(r.clan), text, "tool"); break;
      case "ruling": ring(islands.get(r.clan), GOLD); bubble(islands.get(r.clan), text, "gift"); break;
      default: break; // weather, upkeep, team, sweep, errors: no fireworks
    }
  }

  // A queue so a day's events play one after another, not all at once.
  const queue = [];
  let nextAt = 0;
  function enqueue(records) {
    for (const r of records) if (!["weather", "upkeep", "team", "sweep", "error"].includes(r.kind)) queue.push(r);
  }
  function update() {
    if (queue.length && performance.now() > nextAt) { play(queue.shift()); nextAt = performance.now() + 1500; }
    for (let i = live.length - 1; i >= 0; i--) if (!live[i]()) live.splice(i, 1);
  }
  return { play, enqueue, update, pending: () => queue.length };
}
