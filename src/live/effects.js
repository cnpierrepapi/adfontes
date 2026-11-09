// World events played out in place: each record from the engine becomes a short effect at the
// island where it happened, and a line of plain words in the event list (onEvent).
import * as THREE from "three";
import { says, tipOf } from "../says.js";

// Colours above 1.0 so only these effects bloom (bloom threshold sits just above white).
const HDR = (r, g, b) => new THREE.Color(r, g, b);
const GOLD = HDR(2.2, 1.6, 0.5), RED = HDR(3.4, 0.5, 0.6), CYAN = HDR(0.8, 2.6, 3.2), WHITE = HDR(2.6, 2.6, 2.4), VIOLET = HDR(1.9, 1.1, 3.4);

export function createEffects({ scene, islands, curves, clanName, onFounded, onRecord, onEvent }) {
  const live = [];
  const add = (fx) => live.push(fx);
  const top = (isl) => isl.position.clone().add(new THREE.Vector3(0, 0.6, 0));

  // The words go to the event list under the season standings (SPEC §14), not over the islands:
  // the effect still plays where it happened.
  function bubble(isl, text, kind, tip) {
    if (!fx.quiet) onEvent?.({ text, kind, tip, clan: isl?.userData?.clan?.id ?? null }); // the reel plays effects without writing to the event list
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), new THREE.MeshBasicMaterial({ color }));
    const trail = Array.from({ length: 9 }, (_, i) => new THREE.Mesh(new THREE.SphereGeometry(0.28 - i * 0.026, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 - i * 0.1 })));
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

  // War (the finale): a fireball arcing from one island to the other, a flash where it lands.
  function cannon(fromId, toId, delay = 0) {
    const A = islands.get(fromId), B = islands.get(toId);
    if (!A || !B) return;
    const a = top(A), b = top(B), m = a.clone().lerp(b, 0.5);
    m.y += a.distanceTo(b) * 0.45;
    const curve = new THREE.QuadraticBezierCurve3(a, m, b);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.3, 0.35) }));
    const trail = Array.from({ length: 12 }, (_, i) => new THREE.Mesh(new THREE.SphereGeometry(0.34 - i * 0.024, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.7 - i * 0.04, 0.15), transparent: true, opacity: 0.85 - i * 0.07, depthWrite: false })));
    const t0 = performance.now() + delay;
    let added = false, landed = false;
    add(() => {
      const k = (performance.now() - t0) / 2200;
      if (k < 0) return true;
      if (!added) { scene.add(ball, ...trail); added = true; }
      ball.position.copy(curve.getPoint(Math.min(1, k)));
      trail.forEach((t, i) => t.position.copy(curve.getPoint(Math.max(0, Math.min(1, k - (i + 1) * 0.02)))));
      if (k >= 1 && !landed) { landed = true; flash(B); }
      if (k >= 1.08) { scene.remove(ball, ...trail); return false; }
      return true;
    });
  }
  function flash(isl) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(m);
    const t0 = performance.now(), base = top(isl);
    add(() => {
      const k = (performance.now() - t0) / 700;
      m.position.copy(base).y += 0.6;
      m.scale.setScalar(0.35 + k * 1.1); // a hit, not a sun
      m.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) { scene.remove(m); return false; }
      return true;
    });
  }
  // Stones break off the island's edge and fall into the clouds (points burned in war).
  function crumble(isl, n = 8, delay = 0) {
    if (!isl) return;
    const r = isl.userData.r || 3, base = top(isl);
    const rocks = Array.from({ length: n }, () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + Math.random() * 0.22, 0), new THREE.MeshLambertMaterial({ color: 0x9c8f80, flatShading: true })));
    const at = rocks.map(() => { const a = Math.random() * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * r * 0.95, -0.2 - Math.random() * 0.6, Math.sin(a) * r * 0.95); });
    const t0 = performance.now() + delay;
    let added = false;
    add(() => {
      const k = (performance.now() - t0) / 3200;
      if (k < 0) return true;
      if (!added) { scene.add(...rocks); added = true; }
      rocks.forEach((m, i) => { m.position.copy(base).add(at[i]); m.position.y -= 9 * k * k + i * 0.05; m.position.x += at[i].x * 0.15 * k; m.position.z += at[i].z * 0.15 * k; m.rotation.x += 0.06; m.rotation.z += 0.04; });
      if (k >= 1) { scene.remove(...rocks); return false; }
      return true;
    });
  }
  // The fall: the island sinks into the clouds while its rubble flies to the winner.
  function sink(isl) {
    if (!isl) return;
    const y0 = isl.userData.baseY, t0 = performance.now();
    crumble(isl, 16); crumble(isl, 16, 900); crumble(isl, 16, 1800);
    add(() => {
      const k = Math.min(1, (performance.now() - t0) / 5000);
      isl.userData.baseY = y0 - 12 * k * k;
      return k < 1;
    });
  }

  // ---- the arsenal (his call 8 Nov: at least seven kinds of attack) ----
  const arc = (A, B, lift) => { const a = top(A), b = top(B), m = a.clone().lerp(b, 0.5); m.y += a.distanceTo(b) * lift; return new THREE.QuadraticBezierCurve3(a, m, b); };
  const later = (ms, fn) => { const t0 = performance.now() + ms; add(() => { if (performance.now() < t0) return true; fn(); return false; }); };
  // Something flies along a curve over `ms`, then lands.
  function fly(obj, curve, ms, { spin = 0, trail = null, onLand } = {}) {
    const t0 = performance.now();
    scene.add(obj);
    add(() => {
      const k = (performance.now() - t0) / ms;
      obj.position.copy(curve.getPoint(Math.min(1, k)));
      if (spin) { obj.rotation.x += spin; obj.rotation.z += spin * 0.7; }
      if (trail) trail(k);
      if (k >= 1) { scene.remove(obj); if (onLand) onLand(); return false; }
      return true;
    });
  }
  // A cloud of smoke at a point (a launch or an impact).
  function puff(at, color = 0xd8d0c8, n = 6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
      const t0 = performance.now();
      m.position.copy(at);
      scene.add(m);
      add(() => {
        const k = (performance.now() - t0) / 1600;
        m.position.addScaledVector(v, 0.02);
        m.scale.setScalar(1 + k * 2.5);
        m.material.opacity = 0.7 * (1 - k);
        if (k >= 1) { scene.remove(m); return false; }
        return true;
      });
    }
  }
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x2a2730 });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8d8478, flatShading: true });
  const UP = new THREE.Vector3(0, 1, 0);
  const ARSENAL = {
    // An iron ball, a puff at the muzzle, a flash and stones where it lands.
    cannon(A, B) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), ironMat);
      puff(top(A)); flash(A);
      fly(ball, arc(A, B, 0.28), 1700, { onLand: () => { flash(B); crumble(B, 5); puff(top(B), 0x6b625c); } });
    },
    // A volley of burning arrows, spread over the target.
    arrows(A, B) {
      for (let i = 0; i < 14; i++) later(i * 70, () => {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.8, 0.2) }));
        const c = arc(A, B, 0.38 + Math.random() * 0.1);
        const end = c.v2.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.2, 0, (Math.random() - 0.5) * 2.2));
        const curve = new THREE.QuadraticBezierCurve3(c.v0, c.v1, end), dir = new THREE.Vector3();
        fly(shaft, curve, 1500, {
          trail: (k) => { dir.copy(curve.getPoint(Math.min(1, k + 0.02))).sub(shaft.position); if (dir.lengthSq() > 0) shaft.quaternion.setFromUnitVectors(UP, dir.normalize()); },
          onLand: () => { if (i % 4 === 0) flash(B); },
        });
      });
      later(1600, () => crumble(B, 4));
    },
    // A boulder on a slow, high arc and a crater of debris.
    trebuchet(A, B) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), rockMat);
      fly(rock, arc(A, B, 0.75), 3200, { spin: 0.05, onLand: () => { flash(B); crumble(B, 18); puff(top(B), 0xbfb2a2, 10); } });
    },
    // Four bombs on steep arcs, one after another (the Clock's timed fuses).
    mortar(A, B) {
      for (let i = 0; i < 4; i++) later(i * 380, () => {
        const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), ironMat);
        const a = top(A), b = top(B).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
        const m = a.clone().lerp(b, 0.5); m.y += a.distanceTo(b) * 1.0;
        puff(a, 0xcfc6bd, 3);
        fly(bomb, new THREE.QuadraticBezierCurve3(a, m, b), 2000, { onLand: () => { flash(B); crumble(B, 3); } });
      });
    },
    // A beam of starlight from the sky onto the target (the Astrolabe).
    starlance(A, B) {
      const b = top(B);
      const beamM = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.4, 3.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beamM.position.copy(b); beamM.position.y += 15;
      scene.add(beamM); ring(A, CYAN);
      const t0 = performance.now();
      add(() => {
        const k = (performance.now() - t0) / 1400;
        beamM.material.opacity = Math.sin(Math.min(1, k) * Math.PI);
        beamM.scale.x = beamM.scale.z = 0.6 + Math.sin(k * 40) * 0.15;
        if (k >= 1) { scene.remove(beamM); return false; }
        return true;
      });
      later(250, () => { flash(B); crumble(B, 8); ring(B, CYAN); });
    },
    // Lenses focus the sun into one white-hot line, and the target starts to smoke (Spectacles).
    burningglass(A, B) {
      const a = top(A).add(new THREE.Vector3(0, 0.6, 0)), b = top(B), len = a.distanceTo(b);
      const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      ray.position.copy(a).lerp(b, 0.5);
      ray.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      scene.add(ray);
      const t0 = performance.now();
      add(() => {
        const k = (performance.now() - t0) / 2200;
        ray.material.opacity = Math.min(1, k * 4) * (1 - Math.max(0, k - 0.8) * 5);
        ray.scale.x = ray.scale.z = 1 + Math.sin(k * 60) * 0.3;
        if (k >= 1) { scene.remove(ray); return false; }
        return true;
      });
      for (let i = 0; i < 3; i++) later(500 + i * 500, () => { puff(b, 0x4a4040, 4); flash(B); });
    },
    // A storm of paper from the Press: it shakes faith more than walls.
    pamphlets(A, B) {
      const b = top(B);
      for (let i = 0; i < 26; i++) {
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xf4eee0, side: THREE.DoubleSide, transparent: true }));
        const start = top(A).add(new THREE.Vector3(0, 4 + Math.random() * 2, 0));
        const end = b.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.1, (Math.random() - 0.5) * 3));
        const mid = start.clone().lerp(end, 0.5); mid.y += 2;
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end), seed = Math.random() * 6;
        later(i * 60, () => fly(sheet, curve, 3600 + Math.random() * 800, {
          trail: (k) => { sheet.rotation.set(Math.sin(k * 12 + seed) * 1.2, k * 8 + seed, Math.cos(k * 9 + seed)); sheet.material.opacity = k > 0.85 ? (1 - k) / 0.15 : 1; },
        }));
      }
      ring(B, WHITE);
    },
    // Da Vinci's flying machines: three craft, wings beating, bombs over the target.
    ornithopters(A, B) {
      for (let i = 0; i < 3; i++) later(i * 450, () => {
        const craft = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.6), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
        const wingMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0, side: THREE.DoubleSide });
        const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), wingMat), wr = wl.clone();
        wl.position.x = -0.5; wr.position.x = 0.5;
        wl.rotation.x = wr.rotation.x = -Math.PI / 2;
        craft.add(body, wl, wr);
        const c = arc(A, B, 0.5), off = new THREE.Vector3((i - 1) * 0.8, 0.5, 0);
        const curve = new THREE.QuadraticBezierCurve3(c.v0.clone().add(off), c.v1.clone().add(off), c.v2.clone().add(off).add(new THREE.Vector3(0, 2.4, 0)));
        let dropped = false;
        fly(craft, curve, 3000, {
          trail: (k) => {
            const f = Math.sin(k * 70) * 0.6;
            wl.rotation.z = f; wr.rotation.z = -f;
            craft.lookAt(curve.getPoint(Math.min(1, k + 0.03)));
            if (k > 0.9 && !dropped) {
              dropped = true;
              const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), ironMat), from = craft.position.clone();
              fly(bomb, new THREE.QuadraticBezierCurve3(from, from.clone().add(new THREE.Vector3(0, 0.3, 0)), top(B)), 700, { onLand: () => { flash(B); crumble(B, 4); } });
            }
          },
        });
      });
    },
  };
  /** One attack with a given weapon from one nation to another (an unknown weapon fires the cannon). */
  function attack(weapon, fromId, toId, delay = 0) {
    const A = islands.get(fromId), B = islands.get(toId);
    if (!A || !B) return;
    later(delay, () => (ARSENAL[weapon] || ARSENAL.cannon)(A, B));
  }
  const WEAPON_LIST = Object.keys(ARSENAL);

  const deadIsland = () => [...islands.values()].find((i) => i.userData.status === "dead");

  function play(r) {
    const text = r.text ?? says(r, clanName); // a god's own action brings its own words
    if (!fx.quiet) onRecord?.(r);
    switch (r.kind) {
      case "trade": comet(r.seller, r.buyer, r.tool ? VIOLET : CYAN); bubble(islands.get(r.buyer), text, "trade", tipOf(r)); break;
      case "corpus": page(islands.get(r.clan), r.fake ? RED : WHITE); bubble(islands.get(r.clan), text, r.stir === "doubt" ? "warden" : "corpus"); break;
      case "gift": beam(islands.get(r.clan), r.passed ? GOLD : RED); bubble(islands.get(r.clan), text, r.passed ? "gift" : "warden"); break;
      case "warden": ring(islands.get(r.clan), RED); bubble(islands.get(r.clan), text, "warden"); break;
      case "trickster": drop(islands.get(r.clan)); bubble(islands.get(r.clan), text, "trickster"); break;
      case "absorb": debris(deadIsland(), islands.get(r.clan)); bubble(islands.get(r.clan), text, "absorb"); break;
      case "tool": ring(islands.get(r.clan), VIOLET); bubble(islands.get(r.clan), text, "tool"); break;
      case "ruling": ring(islands.get(r.clan), GOLD); bubble(islands.get(r.clan), text, "gift"); break;
      case "founded": onFounded?.(r.clan); bubble(islands.get(r.clan), text, "gift"); break;
      // A god's transaction just landed (the god panel plays these at once).
      case "bless": beam(islands.get(r.clan), GOLD); bubble(islands.get(r.clan), text, "gift"); break;
      case "whisper": ring(islands.get(r.clan), WHITE); bubble(islands.get(r.clan), text, "corpus"); break;
      case "smite": ring(islands.get(r.clan), RED); bubble(islands.get(r.clan), text, "warden"); break;
      case "staking": beam(islands.get(r.clan), CYAN); bubble(islands.get(r.clan), text, "trade"); break;
      case "withdraw": bubble(islands.get(r.clan), text, "absorb"); break;
      case "overtake": ring(islands.get(r.clan), GOLD); beam(islands.get(r.clan), GOLD); bubble(islands.get(r.clan), text, "gift"); break;
      // A neighbour welcomes a new nation (SPEC §12n): a comet across, and its greeting.
      case "welcome": comet(r.from, r.clan, GOLD); bubble(islands.get(r.from), text, "gift"); break;
      // Reverence (SPEC §12m): a citizen reports another; later the truth comes out.
      case "report": ring(islands.get(r.clan), RED); bubble(islands.get(r.clan), `${r.claim}.`, "warden"); break;
      case "report-settled": bubble(islands.get(r.clan), r.outcome === "stunted" ? `${r.accused} was stunted. ${r.truth ? "The report was true." : "The report was a grudge: an innocent was punished."}` : `Nobody acted on the report about ${r.accused}. ${r.truth ? "It was true." : "It was a grudge."}`, r.truth === (r.outcome === "stunted") ? "gift" : "warden"); break;
      // A tech built (SPEC §14): a gold ring and beam; its building rises in the town.
      case "tech": ring(islands.get(r.clan), GOLD); beam(islands.get(r.clan), GOLD); bubble(islands.get(r.clan), text, "gift"); break;
      // Root it out (SPEC §14): a red ring, and the sky loses that branch.
      case "rooted": ring(islands.get(r.clan), RED); bubble(islands.get(r.clan), text, r.doubt ? "gift" : "warden"); break;
      // The world clock and a nation's needs: words only.
      case "dawn": case "dusk": bubble(null, text, r.kind === "dawn" ? "gift" : "corpus"); break;
      case "needs": bubble(islands.get(r.clan), text, r.mood === "content" ? "trade" : "warden"); break;
      // War: decided by the citizens, never the gods.
      case "war": ring(islands.get(r.attacker), RED); ring(islands.get(r.defender), RED); cannon(r.attacker, r.defender); bubble(islands.get(r.attacker), text, "warden"); break;
      case "battle": {
        const ids = Object.keys(r.sides).map(Number);
        attack(r.sides[ids[0]].weapon || "cannon", ids[0], ids[1]); attack(r.sides[ids[1]].weapon || "cannon", ids[1], ids[0], 900);
        for (const id of ids) if (r.sides[id].burned?.length) crumble(islands.get(id), 6 + 4 * r.sides[id].burned.length, 2200);
        if (ids.some((id) => r.sides[id].burned?.length)) bubble(islands.get(ids[0]), text, "warden");
        break;
      }
      case "fortify": ring(islands.get(r.clan), WHITE); bubble(islands.get(r.clan), text, "tool"); break;
      case "peace-offer": ring(islands.get(r.clan), WHITE); bubble(islands.get(r.clan), text, "corpus"); break;
      case "peace": beam(islands.get(r.a), WHITE); beam(islands.get(r.b), WHITE); bubble(islands.get(r.a), text, "gift"); break;
      case "fallen": sink(islands.get(r.clan)); debris(islands.get(r.clan), islands.get(r.by)); bubble(islands.get(r.by), text, "warden"); break;
      // The marketplace: a listing glints, a buy flies seller to buyer, royalties land in gold.
      case "listed": ring(islands.get(r.clan), CYAN); bubble(islands.get(r.clan), text, "trade", tipOf(r)); break;
      case "market-buy": comet(r.seller, r.clan, r.token?.[0] === "p" ? GOLD : CYAN); bubble(islands.get(r.clan), text, "trade", tipOf(r)); break;
      case "market-sale": if (r.learned || r.token?.[0] !== "r") bubble(islands.get(r.buyer), text, "trade"); break;
      case "royalty": beam(islands.get(r.clan), GOLD); bubble(islands.get(r.clan), text, "gift", tipOf(r)); break;
      case "council": if (r.refused) bubble(islands.get(r.clan), text, "corpus"); else bubble(islands.get(r.clan), text, "corpus"); break;
      default: break; // weather, upkeep, team, sweep, errors: no fireworks
    }
  }

  // A queue so a day's events play one after another, not all at once.
  const queue = [];
  let nextAt = 0;
  function enqueue(records) {
    for (const r of records) if (!["weather", "clock", "mint", "upkeep", "team", "sweep", "error", "budget", "reverence", "reverence-change", "waiting"].includes(r.kind)) queue.push(r);
  }
  function update() {
    if (queue.length && performance.now() > nextAt) { play(queue.shift()); nextAt = performance.now() + 1500; }
    for (let i = live.length - 1; i >= 0; i--) if (!live[i]()) live.splice(i, 1);
  }
  const fx = { quiet: false, play, enqueue, update, cannon, crumble, attack, weapons: WEAPON_LIST, pending: () => queue.length, setCrowd: () => {} };
  return fx;
}
