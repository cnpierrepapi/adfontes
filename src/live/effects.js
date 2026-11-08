// World events played out in place: each record from the engine becomes a short effect at the
// island where it happened, and a line of plain words in the event list (onEvent).
import * as THREE from "three";
import { says } from "../says.js";

// Colours above 1.0 so only these effects bloom (bloom threshold sits just above white).
const HDR = (r, g, b) => new THREE.Color(r, g, b);
const GOLD = HDR(2.2, 1.6, 0.5), RED = HDR(3.4, 0.5, 0.6), CYAN = HDR(0.8, 2.6, 3.2), WHITE = HDR(2.6, 2.6, 2.4), VIOLET = HDR(1.9, 1.1, 3.4);

export function createEffects({ scene, islands, curves, clanName, onFounded, onRecord, onEvent }) {
  const live = [];
  const add = (fx) => live.push(fx);
  const top = (isl) => isl.position.clone().add(new THREE.Vector3(0, 0.6, 0));

  // The words go to the event list under the season standings (SPEC §14), not over the islands:
  // the effect still plays where it happened.
  function bubble(isl, text, kind) {
    onEvent?.({ text, kind, clan: isl?.userData?.clan?.id ?? null });
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

  const deadIsland = () => [...islands.values()].find((i) => i.userData.status === "dead");

  function play(r) {
    const text = r.text ?? says(r, clanName); // a god's own action brings its own words
    onRecord?.(r);
    switch (r.kind) {
      case "trade": comet(r.seller, r.buyer, r.tool ? VIOLET : CYAN); bubble(islands.get(r.buyer), text, "trade"); break;
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
        cannon(ids[0], ids[1]); cannon(ids[1], ids[0], 900);
        for (const id of ids) if (r.sides[id].burned?.length) crumble(islands.get(id), 6 + 4 * r.sides[id].burned.length, 2200);
        if (ids.some((id) => r.sides[id].burned?.length)) bubble(islands.get(ids[0]), text, "warden");
        break;
      }
      case "fortify": ring(islands.get(r.clan), WHITE); bubble(islands.get(r.clan), text, "tool"); break;
      case "peace-offer": ring(islands.get(r.clan), WHITE); bubble(islands.get(r.clan), text, "corpus"); break;
      case "peace": beam(islands.get(r.a), WHITE); beam(islands.get(r.b), WHITE); bubble(islands.get(r.a), text, "gift"); break;
      case "fallen": sink(islands.get(r.clan)); debris(islands.get(r.clan), islands.get(r.by)); bubble(islands.get(r.by), text, "warden"); break;
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
  return { play, enqueue, update, cannon, crumble, pending: () => queue.length, setCrowd: () => {} };
}
