// War on screen (his note 8 Nov: "it should be fierce and look like they are at war").
// The engine fights one round per turn (every 2 hours); this layer keeps the war visible between
// rounds, from the world's current state only (W.wars and each nation's walls):
// - the two islands trade cannon fire every few seconds, with stones knocked off where shots land;
// - fires burn and smoke rises on both islands while the war lasts;
// - walls: a crenellated stone wall around the rim of any nation that has built them, taller the
//   more florins went into them (they wear down a little each round, like the engine's walls).
import * as THREE from "three";

export function createWarLayer({ islands, fx }) {
  const walls = new Map(); // island id -> { mesh, h }
  const fires = new Map(); // island id -> { group, flames, smoke }
  let wars = [], nextShot = 0, side = 0;
  const stone = new THREE.MeshLambertMaterial({ color: 0xb7aa98, flatShading: true });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.45, 0.06), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x9b8f9c, emissive: 0x2a2128, transparent: true, opacity: 0.5, depthWrite: false });

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

  return {
    /** The world's current wars and each nation's walls (called whenever the world refreshes). */
    update(world) {
      wars = (world.wars || []).filter((w) => islands.has(w.a) && islands.has(w.b));
      const fighting = new Set(wars.flatMap((w) => [w.a, w.b]));
      for (const id of fires.keys()) if (!fighting.has(id)) stopFires(id);
      for (const id of fighting) startFires(id);
      for (const c of world.clans || []) setWalls(c.id, c.alive === false ? 0 : c.war?.walls || 0);
    },
    atWar: (id) => wars.some((w) => w.a === id || w.b === id),
    /** Every frame: flicker, smoke, and the next volley. */
    tick(t, now) {
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
      fx.cannon(from, to);
      if (Math.random() < 0.45) fx.crumble(islands.get(to), 4 + Math.floor(Math.random() * 4), 2200);
      nextShot = now + 2500 + Math.random() * 2500;
    },
  };
}
