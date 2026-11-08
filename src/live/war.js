// War on screen (his note 8 Nov: "it should be fierce and look like they are at war").
// The engine fights one round per turn (every 2 hours); this layer keeps the war visible between
// rounds, from the world's current state only (W.wars and each nation's walls):
// - the two islands attack each other every few seconds with whatever their arsenal holds (eight
//   weapons, from cannon to Da Vinci's flying machines), each fired by a crewed war machine;
// - only the crews are outside: everyone else is indoors (folk.setWar);
// - fires burn and smoke rises on both islands while the war lasts;
// - walls: a crenellated stone wall around the rim of any nation that has built them, taller the
//   more florins went into them (they wear down a little each round, like the engine's walls).
import * as THREE from "three";

export function createWarLayer({ islands, fx, folk }) {
  const walls = new Map(); // island id -> { mesh, h }
  const fires = new Map(); // island id -> { group, flames, smoke }
  let wars = [], nextShot = 0, side = 0;
  const stone = new THREE.MeshLambertMaterial({ color: 0xb7aa98, flatShading: true });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.45, 0.06), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xd6cfd6, emissive: 0x3a3238, transparent: true, opacity: 0.5, depthWrite: false });

  /** A wall around the rim: merged blocks with battlements. h in island units. */
  function buildWall(isl, h) {
    const r = isl.userData.r * 0.97, n = Math.max(24, Math.round(r * 14));
    const seg = (2 * Math.PI * r) / n;
    const geos = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const tall = h * (i % 2 ? 1 : 1.35); // the battlements: every other block stands taller
      const g = new THREE.BoxGeometry(seg * 1.02, tall, Math.max(0.08, r * 0.035));
      g.rotateY(-a + Math.PI / 2);
      g.translate(Math.cos(a) * r, tall / 2 - 0.02, Math.sin(a) * r);
      geos.push(g);
    }
    // Merge by hand (no addons needed): one mesh per wall.
    const merged = new THREE.BufferGeometry();
    const pos = [], nor = [], idx = [];
    let base = 0;
    for (const g of geos) {
      const ng = g.toNonIndexed();
      pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array);
      for (let k = 0; k < ng.attributes.position.count; k++) idx.push(base + k);
      base += ng.attributes.position.count;
      g.dispose(); ng.dispose();
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    merged.setIndex(idx);
    const m = new THREE.Mesh(merged, stone);
    m.castShadow = true; m.receiveShadow = true;
    isl.add(m);
    return m;
  }

  function setWalls(id, value) {
    const isl = islands.get(id);
    const have = walls.get(id);
    const h = value > 0.5 ? 0.16 + Math.min(0.5, value / 50) : 0; // 16.8 florins of walls ~ 0.5 tall
    if (have && Math.abs(have.h - h) < 0.03) return;
    if (have) { have.mesh.removeFromParent(); have.mesh.geometry.dispose(); walls.delete(id); }
    if (isl && h > 0) walls.set(id, { mesh: buildWall(isl, h), h });
  }

  function startFires(id) {
    const isl = islands.get(id);
    if (!isl || fires.has(id)) return;
    const group = new THREE.Group(), r = isl.userData.r;
    const flames = [], smoke = [];
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.35 + Math.random() * 0.55);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.12 + Math.random() * 0.08, 0.5, 7), flameMat);
      f.position.set(Math.cos(a) * d, 0.2, Math.sin(a) * d);
      f.userData.seed = Math.random() * 10;
      flames.push(f); group.add(f);
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), smokeMat.clone());
        s.userData = { base: f.position.clone(), t: Math.random() * 4, speed: 0.5 + Math.random() * 0.4 };
        smoke.push(s); group.add(s);
      }
    }
    isl.add(group);
    fires.set(id, { group, flames, smoke });
  }
  function stopFires(id) {
    const f = fires.get(id);
    if (!f) return;
    f.group.removeFromParent();
    f.group.traverse((o) => { o.geometry?.dispose(); if (o.material !== flameMat && o.material !== smokeMat) o.material?.dispose?.(); });
    fires.delete(id);
  }


  // ---- war machines (his call 8 Nov): one for each weapon a nation can field, on the rim facing
  // the enemy, each with its crew of one. Simple shapes, like the rest of the town.
  const WOOD = new THREE.MeshLambertMaterial({ color: 0x7a4f2a, flatShading: true });
  const IRON = new THREE.MeshLambertMaterial({ color: 0x34313a, flatShading: true });
  const BRASS = new THREE.MeshLambertMaterial({ color: 0xc9a227, flatShading: true });
  const PAPER = new THREE.MeshLambertMaterial({ color: 0xefe8d6 });
  const GLASS = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.1) });
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (r1, r2, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
  // Each machine faces +X (toward the enemy) before it's turned into place.
  const MACHINES = {
    cannon() {
      const g = new THREE.Group(), barrel = cyl(0.07, 0.09, 0.6, IRON);
      barrel.rotation.z = Math.PI / 2 - 0.35; barrel.position.set(0.08, 0.2, 0);
      for (const z of [-0.12, 0.12]) { const w = cyl(0.1, 0.1, 0.04, WOOD, 12); w.rotation.x = Math.PI / 2; w.position.set(-0.02, 0.1, z); g.add(w); }
      g.add(box(0.36, 0.08, 0.2, WOOD), barrel); g.userData.recoil = barrel; return g;
    },
    arrows() { // a rack of fire arrows on a ballista
      const g = new THREE.Group(), bow = box(0.04, 0.04, 0.5, WOOD), rail = box(0.5, 0.04, 0.05, WOOD);
      bow.position.set(0.18, 0.28, 0); rail.position.set(0.05, 0.28, 0); rail.rotation.z = 0.3;
      const legs = box(0.06, 0.28, 0.06, WOOD); legs.position.y = 0.14;
      g.add(legs, rail, bow); g.userData.recoil = rail; return g;
    },
    trebuchet() {
      const g = new THREE.Group();
      for (const z of [-0.16, 0.16]) { const leg = box(0.05, 0.6, 0.05, WOOD); leg.position.set(0, 0.3, z); g.add(leg); }
      const pivot = new THREE.Group(); pivot.position.y = 0.58;
      const arm = box(0.9, 0.04, 0.04, WOOD); arm.position.x = 0.2;
      const weight = box(0.16, 0.16, 0.16, IRON); weight.position.set(-0.22, -0.08, 0);
      pivot.add(arm, weight); pivot.rotation.z = -0.5;
      g.add(box(0.5, 0.05, 0.4, WOOD), pivot); g.userData.arm = pivot; return g;
    },
    mortar() {
      const g = new THREE.Group(), tube = cyl(0.1, 0.13, 0.26, IRON);
      tube.rotation.z = -0.5; tube.position.set(0, 0.2, 0);
      g.add(box(0.3, 0.1, 0.3, WOOD), tube); g.userData.recoil = tube; return g;
    },
    starlance() { // a brass sighting ring and tube, aimed at the sky
      const g = new THREE.Group(), ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 20), BRASS), tube = cyl(0.04, 0.05, 0.5, BRASS);
      ring.position.y = 0.42; tube.position.set(0.05, 0.42, 0); tube.rotation.z = -0.9;
      const post = cyl(0.03, 0.04, 0.4, WOOD); post.position.y = 0.2;
      g.add(post, ring, tube); g.userData.spin = ring; return g;
    },
    burningglass() { // a great lens on a post
      const g = new THREE.Group(), post = cyl(0.03, 0.05, 0.45, WOOD), lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 18), GLASS), rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 22), BRASS);
      post.position.y = 0.22; lens.position.set(0, 0.55, 0); rim.position.copy(lens.position);
      lens.rotation.y = rim.rotation.y = Math.PI / 2;
      g.add(post, lens, rim); g.userData.spin = rim; return g;
    },
    pamphlets() { // a printing press and its stacks of paper
      const g = new THREE.Group(), frame = box(0.3, 0.36, 0.22, WOOD), plate = box(0.24, 0.04, 0.18, IRON);
      frame.position.y = 0.18; plate.position.y = 0.4;
      for (const x of [-0.24, 0.24]) { const st = box(0.14, 0.1, 0.18, PAPER); st.position.set(x, 0.05, 0); g.add(st); }
      g.add(frame, plate); g.userData.recoil = plate; return g;
    },
    ornithopters() { // a flying machine on its launch frame
      const g = new THREE.Group(), body = box(0.4, 0.08, 0.1, WOOD), wl = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.55), new THREE.MeshLambertMaterial({ color: 0xe8dcc0, side: THREE.DoubleSide }));
      body.position.y = 0.34; wl.position.set(0, 0.36, 0); wl.rotation.x = -Math.PI / 2;
      const legs = box(0.05, 0.3, 0.05, WOOD); legs.position.y = 0.15;
      g.add(legs, body, wl); g.userData.flap = wl; return g;
    },
  };
  // Mirrors engine/war.mjs: what a nation can field from its techs.
  const ARSENAL_RULES = { cannon: () => true, arrows: () => true, trebuchet: () => true, mortar: (t) => t.includes("clock"), starlance: (t) => t.includes("astrolabe"), burningglass: (t) => t.includes("spectacles"), pamphlets: (t) => t.includes("press"), ornithopters: (t) => t.length >= 3 };
  const arsenalOf = (id) => { const t = islands.get(id)?.userData.clan?.techs || []; return Object.keys(ARSENAL_RULES).filter((w) => ARSENAL_RULES[w](t)); };
  const engines = new Map(); // island id -> { group, byWeapon: Map(weapon -> machine) }
  function placeMachines(id, enemyId) {
    const isl = islands.get(id), foe = islands.get(enemyId);
    if (!isl || !foe || engines.has(id)) return;
    const local = isl.worldToLocal(foe.getWorldPosition(new THREE.Vector3()));
    const toward = Math.atan2(local.z, local.x), r = isl.userData.r, list = arsenalOf(id);
    const group = new THREE.Group(), byWeapon = new Map(), stations = [];
    const scale = Math.max(1.4, r / 2); // big enough to read as machines next to the town
    list.forEach((w, i) => {
      const spread = (i - (list.length - 1) / 2) * (1.05 / Math.max(1, list.length - 1) * Math.min(list.length - 1, 4)) / 2;
      const ang = toward + spread * 1.4, d = r * 0.74;
      const m = MACHINES[w](); m.scale.setScalar(scale);
      m.position.set(Math.cos(ang) * d, 0, Math.sin(ang) * d);
      m.rotation.y = -ang; // +X points outward, toward the enemy
      group.add(m); byWeapon.set(w, m);
      // The crew stands just behind the machine, facing it.
      const cd = d - 0.3 * scale;
      stations.push({ x: Math.cos(ang) * cd, z: Math.sin(ang) * cd, face: Math.PI / 2 - ang });
    });
    isl.add(group);
    engines.set(id, { group, byWeapon });
    folk?.setWar(id, stations);
  }
  function clearMachines(id) {
    const e = engines.get(id);
    if (!e) return;
    e.group.removeFromParent();
    e.group.traverse((o) => o.geometry?.dispose());
    engines.delete(id);
    folk?.setWar(id, null);
  }
  // The machine that fired moves: the cannon kicks back, the trebuchet's arm swings, the lens turns.
  function work(id, weapon) {
    const m = engines.get(id)?.byWeapon.get(weapon);
    if (!m) return;
    m.userData.firedAt = performance.now();
  }
  function animateMachines(t) {
    const now = performance.now();
    for (const { byWeapon } of engines.values()) for (const m of byWeapon.values()) {
      const k = m.userData.firedAt ? (now - m.userData.firedAt) / 900 : 9;
      if (m.userData.recoil) m.userData.recoil.position.x = (m.userData.recoil.userData.x0 ??= m.userData.recoil.position.x) - (k < 1 ? Math.sin(k * Math.PI) * 0.08 : 0);
      if (m.userData.arm) m.userData.arm.rotation.z = k < 1 ? -0.5 + Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * 2.2 : -0.5;
      if (m.userData.spin) m.userData.spin.rotation.z = t * (k < 1 ? 6 : 0.6);
      if (m.userData.flap) m.userData.flap.rotation.z = Math.sin(t * (k < 1 ? 30 : 3)) * 0.3;
    }
  }

  return {
    /** The world's current wars and each nation's walls (called whenever the world refreshes). */
    update(world) {
      wars = (world.wars || []).filter((w) => islands.has(w.a) && islands.has(w.b));
      const fighting = new Set(wars.flatMap((w) => [w.a, w.b]));
      for (const id of fires.keys()) if (!fighting.has(id)) stopFires(id);
      for (const id of fighting) startFires(id);
      for (const id of [...engines.keys()]) if (!fighting.has(id)) clearMachines(id);
      for (const w of wars) { placeMachines(w.a, w.b); placeMachines(w.b, w.a); }
      for (const c of world.clans || []) setWalls(c.id, c.alive === false ? 0 : c.war?.walls || 0);
    },
    atWar: (id) => wars.some((w) => w.a === id || w.b === id),
    /** Every frame: flicker, smoke, and the next volley. */
    tick(t, now) {
      animateMachines(t);
      for (const { flames, smoke } of fires.values()) {
        for (const f of flames) { const k = f.userData.seed; f.scale.set(1, 0.7 + 0.5 * Math.abs(Math.sin(t * 7 + k)), 1); f.rotation.y = t * 2 + k; }
        for (const s of smoke) {
          const u = s.userData; u.t += 0.016 * u.speed;
          const k = u.t % 4 / 4;
          s.position.set(u.base.x + Math.sin(u.t * 1.7) * 0.25 * k, u.base.y + 0.3 + k * 3.2, u.base.z + Math.cos(u.t * 1.3) * 0.25 * k);
          s.scale.setScalar(0.6 + k * 2.2);
          s.material.opacity = 0.6 * (1 - k);
        }
      }
      if (!wars.length || now < nextShot) return;
      // A volley every 2.5 to 5 seconds, sides taking turns; every few shots knock stones loose.
      const w = wars[Math.floor(Math.random() * wars.length)];
      const [from, to] = side++ % 2 ? [w.a, w.b] : [w.b, w.a];
      // A weapon from this nation's own arsenal; its machine moves as it fires.
      const list = arsenalOf(from), weapon = list[Math.floor(Math.random() * list.length)] || "cannon";
      work(from, weapon);
      fx.attack(weapon, from, to);
      nextShot = now + 2200 + Math.random() * 2300;
    },
  };
}
