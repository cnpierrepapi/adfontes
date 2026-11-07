// The people of each nation (SPEC §12h).
// Far away: one coloured dot per citizen, circling its island (every nation, cheap Points).
// Up close (the nation you're focused on): the real citizens from the contract, walking the plaza
// between the temple and the houses, going to their role's spot to work. Stunted = grey and slow;
// dead = a gravestone. The kit (6.9 MB) loads the first time you fly to a nation.
import * as THREE from "three";
import { loadCitizenKit, makeCitizen, ROLES } from "./citizens.js";

const h32 = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const rnd = (seed) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)) >>> 0) / 4294967296;
const groundY = (r, x, z) => r * 0.05 * (1 - Math.min(1, (x * x + z * z) / (r * r))) + r * 0.004; // the island's domed top

// Where each role goes to work, as (angle offset, radius fraction) on the plaza ring.
const STATION = { Patron: [0, 0.4], Scholar: [0.9, 0.37], Smith: [2.1, 0.5], Drafter: [3.2, 0.45], Broker: [4.4, 0.55], Trickster: [5.3, 0.5] };

export function createFolk({ scene, islands }) {
  let kit = null, kitLoading = null;
  const dots = new Map(); // nation id -> { pts, agents, seeds }
  const crowds = new Map(); // nation id -> { group, people: [...] }
  let day = 0;

  // ---- dots (every nation) ----
  function setAgents(id, agents, today) {
    day = today ?? day;
    const isl = islands.get(id);
    if (!isl) return;
    const living = isl.userData.status === "dead" ? [] : (agents || []).filter((a) => a.alive); // a dead nation's people are gone
    const old = dots.get(id);
    if (old && old.key === living.map((a) => a.name + a.stunted_until).join()) return;
    old?.pts.removeFromParent(); old?.pts.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(living.length * 3), 3));
    const col = new Float32Array(living.length * 3);
    living.forEach((a, i) => {
      const c = new THREE.Color(ROLES[a.role]?.dot ?? 0xffffff).multiplyScalar(a.stunted_until > day ? 0.45 : 1.6); // a touch over 1: they glow a little
      col.set([c.r, c.g, c.b], i * 3);
    });
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.0, map: beadTex(), alphaTest: 0.05, vertexColors: true, transparent: true, depthWrite: false, opacity: 1 }));
    pts.frustumCulled = false;
    isl.add(pts);
    dots.set(id, { pts, living, key: living.map((a) => a.name + a.stunted_until).join(), seeds: living.map((a) => h32(a.name)) });
    if (crowds.has(id)) rebuildCrowd(id, agents);
  }

  // ---- real citizens (the focused nation) ----
  async function ensureKit() {
    if (kit) return kit;
    kitLoading ??= loadCitizenKit().then((k) => (kit = k));
    return kitLoading;
  }
  const agentsOf = new Map();
  async function rebuildCrowd(id, agents) {
    agentsOf.set(id, agents);
    const isl = islands.get(id);
    if (!isl || !kit) return;
    crowds.get(id)?.group.removeFromParent();
    const r = isl.userData.r, s = (0.11 + r * 0.03) * 1.5; // a citizen stands about half a house tall: readable from the fly-in
    const group = new THREE.Group();
    const people = [];
    const town = isl.children.find((ch) => ch.isGroup && ch.children.length);
    // Things to walk round: every building, tree and fountain on the island (town-space x, z, radius).
    const blocks = [];
    for (const o of town?.children ?? []) {
      if (o.name === "folk" || o === isl.userData.lamps) continue; // ourselves, and the lamp lights
      const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      if (!isFinite(size.x) || size.x === 0) continue;
      blocks.push([o.position.x, o.position.z, Math.max(size.x, size.z) * 0.55 + r * 0.04]);
    }
    // The open spot nearest to (x, z): tries rings of nudges until nothing is in the way.
    const clear = (x, z) => !blocks.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br);
    const open = (x, z) => {
      if (clear(x, z)) return [x, z];
      for (let ring = 1; ring <= 6; ring++) for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, d = ring * r * 0.06;
        let nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
        const len = Math.hypot(nx, nz), max = r * 0.86;
        if (len > max) { nx *= max / len; nz *= max / len; } // stay on the island
        if (clear(nx, nz)) return [nx, nz];
      }
      return [x, z];
    };
    for (const a of agents || []) {
      const seed = h32(a.name), R = rnd(seed);
      if (!a.alive || isl.userData.status === "dead") { group.add(gravestone(r, s, R)); continue; }
      const c = await makeCitizen(kit, a.role, a.name);
      c.root.scale.setScalar(s);
      const stunted = a.stunted_until > day;
      if (stunted) c.root.traverse((o) => o.isMesh && o.material?.color && (o.material = Object.assign(o.material.clone(), { color: new THREE.Color(0x8a8a96) })));
      const st = STATION[a.role] ?? [R() * 6.28, 0.45];
      const home = (h32(String(id)) % 628) / 100;
      const p = { c, a, R, r, s, stunted, open, station: open(Math.cos(home + st[0]) * r * st[1], Math.sin(home + st[0]) * r * st[1]), pos: [0, 0], target: null, until: 0, mode: "idle" };
      const a0 = R() * 6.28, rad = r * (0.38 + R() * 0.15);
      p.pos = open(Math.cos(a0) * rad, Math.sin(a0) * rad);
      c.root.position.set(p.pos[0], groundY(r, ...p.pos), p.pos[1]);
      c.mixer.timeScale = stunted ? 0.5 : 0.9 + R() * 0.2;
      c.play("Idle_Loop", 0);
      group.add(c.root);
      people.push(p);
    }
    group.name = "folk";
    (town || isl).add(group);
    crowds.set(id, { group, people });
  }
  function dropCrowd(id) {
    const cr = crowds.get(id);
    if (!cr) return;
    cr.group.removeFromParent();
    cr.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
    crowds.delete(id);
  }

  /** Who's up close: build that nation's citizens (and let others go, keeping at most two). */
  // One build per nation at a time: the frame loop and a panel button can both ask at once on a
  // first visit (while the kit is still loading); both must get the SAME crowd.
  const building = new Map();
  function focus(id) {
    if (id == null) return Promise.resolve();
    if (crowds.has(id)) { trim(id); return Promise.resolve(); }
    if (!building.has(id)) {
      building.set(id, (async () => {
        await ensureKit();
        if (!crowds.has(id)) await rebuildCrowd(id, agentsOf.get(id) ?? dots.get(id)?.living ?? []);
        trim(id);
      })().finally(() => building.delete(id)));
    }
    return building.get(id);
  }
  function trim(id) { for (const k of [...crowds.keys()]) if (k !== id && crowds.size > 2) dropCrowd(k); }

  // A citizen's day: walk to a spot on the plaza, idle a little, sometimes go to work at the
  // role's station (Smiths kneel, Scholars study at the temple, Brokers haggle at the edge).
  function think(p, now) {
    const { c, a, R, r } = p;
    if (p.mode === "walk") return;
    if (now < p.until) return;
    const work = R() < 0.45;
    const [tx, tz] = work ? p.station : (() => { const ang = R() * 6.28, rad = r * (0.38 + R() * 0.16); return p.open(Math.cos(ang) * rad, Math.sin(ang) * rad); })();
    p.target = [tx, tz];
    p.next = work ? (ROLES[a.role]?.work ?? "Idle_Loop") : R() < 0.3 ? "Idle_Talking_Loop" : "Idle_Loop";
    p.mode = "walk";
    c.play(a.role === "Trickster" ? "Jog_Fwd_Loop" : a.role === "Patron" || a.role === "Broker" ? "Walk_Formal_Loop" : "Walk_Loop");
  }

  const tmp = new THREE.Vector3();
  function update(dt, camera, focusId, nearK) {
    const now = performance.now() / 1000;
    shotsStep(now);
    // Dots: everyone circles their island gently; hidden where the real citizens are showing.
    for (const [id, d] of dots) {
      const isl = islands.get(id);
      const pos = d.pts.geometry.attributes.position;
      const r = isl.userData.r;
      for (let i = 0; i < d.living.length; i++) {
        const sd = d.seeds[i], sp = (0.05 + (sd % 100) / 1000) * (sd & 2 ? 1 : -1) * (d.living[i].stunted_until > day ? 0.3 : 1);
        const ang = (sd % 628) / 100 + now * sp, rad = r * (0.36 + ((sd >>> 8) % 20) / 100 + Math.sin(now * 0.3 + sd) * 0.04);
        const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        pos.setXYZ(i, x, groundY(r, x, z) + 0.4, z);
      }
      pos.needsUpdate = true;
      const close = crowds.has(id) && id === focusId ? nearK : 0;
      d.pts.material.opacity = 1 - close;
      d.pts.visible = d.pts.material.opacity > 0.02 && isl.userData.rose !== "rising";
    }
    // Citizens: walk toward their target at a stroll, face where they go, then do the next thing.
    for (const [id, cr] of crowds) {
      cr.group.visible = id === focusId && nearK > 0.05;
      if (!cr.group.visible) continue;
      for (const p of cr.people) {
        if (p.mode === "gun") { gunStep(p, dt, now); p.c.mixer.update(dt); continue; }
        think(p, now);
        if (p.mode === "walk") {
          const dx = p.target[0] - p.pos[0], dz = p.target[1] - p.pos[1], dist = Math.hypot(dx, dz);
          const speed = p.r * 0.09 * (p.stunted ? 0.4 : 1) * (p.a.role === "Trickster" ? 2 : 1);
          if (dist < 0.02) {
            p.mode = "stay";
            p.until = now + 3 + p.R() * 6;
            p.c.play(p.next);
            if (p.next === ROLES[p.a.role]?.work) p.c.root.rotation.y = Math.atan2(-p.pos[0], -p.pos[1]); // work facing the temple
          } else {
            const step = Math.min(dist, speed * dt);
            p.pos[0] += (dx / dist) * step; p.pos[1] += (dz / dist) * step;
            const want = Math.atan2(dx, dz);
            p.c.root.rotation.y += Math.atan2(Math.sin(want - p.c.root.rotation.y), Math.cos(want - p.c.root.rotation.y)) * Math.min(1, dt * 6);
          }
          p.c.root.position.set(p.pos[0], groundY(p.r, ...p.pos), p.pos[1]);
        }
        p.c.mixer.update(dt);
      }
    }
  }

  /** Citizen under the cursor (for the hover card), or null. */
  function pick(ray, focusId) {
    const cr = crowds.get(focusId);
    if (!cr?.group.visible) return null;
    let best = null, bd = Infinity;
    for (const p of cr.people) {
      p.c.root.getWorldPosition(tmp);
      const top = tmp.clone(); top.y += p.s * 1.7;
      const mid = tmp.clone().lerp(top, 0.5);
      const d = ray.ray.distanceToPoint(mid);
      if (d < p.s * 0.45 && d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    const left = best.a.stunted_until - day;
    return { title: best.a.name, sub: `${best.a.role}${best.stunted ? ` · stunted, ${left} more day${left === 1 ? "" : "s"}` : ""} · since day ${best.a.born_day}`, kind: best.stunted ? "stone" : "corpus" };
  }

  // ---- the star-gun (SPEC §12e) ----
  // A Scholar who finishes a corpus shoulders a star-gun almost their own height, staggers to the
  // island edge under the star's slot, aims up and fires the star into the constellation. A corpus
  // with a made-up citation misfires: the star climbs, turns red, fizzles and drops.
  const shots = [];
  /** Queue a shot. Returns false if that Scholar isn't on screen (caller lights the star in place). */
  function launch(id, name, job) {
    const cr = crowds.get(id);
    const p = cr?.people.find((q) => q.a.name === name);
    if (!p || !cr.group.visible) return false;
    (p.queue ||= []).push(job);
    if (p.mode !== "gun") nextShot(p);
    return true;
  }
  function nextShot(p) {
    const job = p.queue.shift();
    if (!job) { p.mode = "stay"; p.until = 0; p.gun?.removeFromParent(); p.c.root.rotation.z = 0; p.c.mixer.timeScale = 1; return; }
    p.job = job;
    p.mode = "gun";
    p.phase = "walk";
    p.gun ??= starGun();
    p.c.root.add(p.gun);
    gunPose(p.gun, 0);
    // Walk out to the nearby edge, turned at most 35° toward the star's side: never across the
    // plaza through the temple (the shot's arc carries the star the rest of the way).
    const local = p.c.root.parent.worldToLocal(job.to.clone());
    const here = Math.atan2(p.pos[1], p.pos[0]), there = Math.atan2(local.z, local.x);
    const turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(there - here), Math.cos(there - here)), -0.6, 0.6);
    p.target = p.open(Math.cos(here + turn) * p.r * 0.68, Math.sin(here + turn) * p.r * 0.68);
    p.c.play("Walk_Loop");
    p.c.mixer.timeScale = 0.7; // heavy
  }
  // 0 = carried on the shoulder, leaning forward; 1 = held straight up to fire.
  function gunPose(g, k) {
    g.position.set(-0.2 + k * 0.12, 1.3 + k * 0.25, 0.05 - k * 0.05);
    g.rotation.set(THREE.MathUtils.lerp(1.05, 0.12, k), 0, THREE.MathUtils.lerp(0.25, 0, k));
  }
  function gunStep(p, dt, now) {
    const { c } = p;
    if (p.phase === "walk") {
      const dx = p.target[0] - p.pos[0], dz = p.target[1] - p.pos[1], dist = Math.hypot(dx, dz);
      if (dist < 0.02) { p.phase = "aim"; p.t0 = now; c.mixer.timeScale = 1; c.play("Pistol_Aim_Up", 0.3); c.root.rotation.z = 0; return; }
      const step = Math.min(dist, p.r * 0.075 * dt); // a heavy stagger
      p.pos[0] += (dx / dist) * step; p.pos[1] += (dz / dist) * step;
      const want = Math.atan2(dx, dz);
      c.root.rotation.y += Math.atan2(Math.sin(want - c.root.rotation.y), Math.cos(want - c.root.rotation.y)) * Math.min(1, dt * 5);
      c.root.rotation.z = Math.sin(now * 5.5) * 0.09; // swaying under the weight
      c.root.position.set(p.pos[0], groundY(p.r, ...p.pos), p.pos[1]);
    } else if (p.phase === "aim") {
      const k = Math.min(1, (now - p.t0) / 0.7);
      gunPose(p.gun, k * k * (3 - 2 * k));
      if (now - p.t0 > 1.3) { p.phase = "fire"; p.t0 = now; c.play("Pistol_Shoot", 0.1); fire(p); }
    } else if (p.phase === "fire") {
      const k = Math.min(1, (now - p.t0) / 0.35);
      p.gun.position.y = 1.55 - Math.sin(k * Math.PI) * 0.12; // recoil
      if (now - p.t0 > 1.6) nextShot(p);
    }
  }
  const GOLD = new THREE.Color(2.4, 1.9, 0.7), RED = new THREE.Color(3.2, 0.45, 0.5);
  function fire(p) {
    const from = p.gun.localToWorld(new THREE.Vector3(0, 0.82, 0));
    const job = p.job, to = job.to.clone();
    const mid = from.clone().lerp(to, 0.5);
    mid.y += from.distanceTo(to) * 0.25;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    // Sized to the island, not the citizen, so the shot reads from the fly-in view.
    const s = p.r * 0.11;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.5, 1), new THREE.MeshBasicMaterial({ color: GOLD.clone() }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: GOLD.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(s * 3.2);
    head.add(halo);
    const trail = Array.from({ length: 16 }, (_, i) => new THREE.Mesh(new THREE.SphereGeometry(s * (0.38 - i * 0.021), 8, 6), new THREE.MeshBasicMaterial({ color: GOLD.clone(), transparent: true, opacity: 0.85 - i * 0.05 })));
    const flash = new THREE.Mesh(new THREE.SphereGeometry(s * 0.7, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), transparent: true }));
    flash.position.copy(from);
    scene.add(head, ...trail, flash);
    shots.push({ curve, head, trail, flash, t0: performance.now() / 1000, fake: job.fake, onArrive: job.onArrive, dur: 1.5, s });
  }
  function shotsStep(now) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i], t = now - sh.t0;
      sh.flash.material.opacity = Math.max(0, 1 - t * 4);
      sh.flash.scale.setScalar(1 + t * 4);
      let k = t / sh.dur, done = false;
      if (sh.fake && k > 0.45) {
        // Misfire: it stalls, turns red, sputters and falls.
        if (!sh.fell) { sh.fell = sh.curve.getPoint(0.45); sh.tf = now; sh.head.material.color.copy(RED); sh.head.children[0].material.color.copy(RED); sh.trail.forEach((m) => m.material.color.copy(RED)); sh.onArrive?.(); }
        const tf = now - sh.tf;
        sh.head.position.copy(sh.fell).add(new THREE.Vector3(Math.sin(tf * 40) * sh.s * 0.08, -4.9 * tf * tf * 0.35, 0));
        sh.head.scale.setScalar(Math.max(0.01, 1 - tf * 0.7));
        sh.trail.forEach((m, j) => { m.position.copy(sh.head.position).y += (j + 1) * sh.s * 0.12; m.material.opacity = Math.max(0, (0.6 - j * 0.06) * (1 - tf * 0.8)); });
        done = tf > 1.4;
      } else {
        const e = 1 - Math.pow(1 - Math.min(1, k), 2.2); // fast out of the barrel, easing into its slot
        sh.head.position.copy(sh.curve.getPoint(e));
        sh.head.rotation.y += 0.2;
        sh.trail.forEach((m, j) => m.position.copy(sh.curve.getPoint(Math.max(0, e - (j + 1) * 0.022))));
        if (k >= 1) { sh.onArrive?.(); done = true; }
      }
      if (done) { scene.remove(sh.head, ...sh.trail, sh.flash); shots.splice(i, 1); }
    }
  }

  return { setAgents, focus, update, pick, launch, crowds, shots };
}

// A star-gun, almost a citizen's height (citizen-local metres; the barrel runs along +Y):
// a teal tube with brass rings, a flared brass bell, a stock and a star glowing in the muzzle.
function starGun() {
  const g = new THREE.Group();
  // A little self-glow so it still reads as bright teal and brass by moonlight.
  const teal = new THREE.MeshStandardMaterial({ color: 0x2ee6d0, emissive: 0x0b6f66, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.4, flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0x8a5200, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.35, flatShading: true });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 1.25, 12), teal);
  barrel.position.y = 0.1;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.09, 0.22, 14, 1, true), brass);
  bell.position.y = 0.82;
  bell.material.side = THREE.DoubleSide;
  for (const y of [-0.42, 0.1, 0.6]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 16), brass); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring); }
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.2), brass);
  stock.position.set(0, -0.6, -0.05);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.16), brass);
  fin.position.set(0, 0.45, -0.12);
  const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.7) }));
  star.position.y = 0.84;
  g.add(barrel, bell, stock, fin, star);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  const wrap = new THREE.Group(); // scale the gun without touching the pose offsets
  g.scale.setScalar(1.25);
  wrap.add(g);
  return wrap;
}

// A soft radial glow for the shot's halo.
let glow = null;
function glowTex() {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.3, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

// A round, soft-edged bead for the far-view dots (Points are squares without a texture).
let bead = null;
function beadTex() {
  if (bead) return bead;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.45, "rgba(255,255,255,1)"); gr.addColorStop(0.62, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  bead = new THREE.CanvasTexture(c);
  bead.colorSpace = THREE.SRGBColorSpace;
  return bead;
}

function gravestone(r, s, R) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9c3d6, roughness: 0.9, flatShading: true });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.12), stone);
  slab.position.y = 0.3;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.12, 12, 1, false, 0, Math.PI), stone);
  top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  top.position.y = 0.6;
  g.add(slab, top);
  g.scale.setScalar(s * 1.6);
  const a = R() * 6.28, rad = r * (0.62 + R() * 0.12);
  g.position.set(Math.cos(a) * rad, groundY(r, Math.cos(a) * rad, Math.sin(a) * rad), Math.sin(a) * rad);
  g.rotation.y = R() * 6.28;
  return g;
}
