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
    for (const a of agents || []) {
      const seed = h32(a.name), R = rnd(seed);
      if (!a.alive || isl.userData.status === "dead") { group.add(gravestone(r, s, R)); continue; }
      const c = await makeCitizen(kit, a.role, a.name);
      c.root.scale.setScalar(s);
      const stunted = a.stunted_until > day;
      if (stunted) c.root.traverse((o) => o.isMesh && o.material?.color && (o.material = Object.assign(o.material.clone(), { color: new THREE.Color(0x8a8a96) })));
      const st = STATION[a.role] ?? [R() * 6.28, 0.45];
      const home = (h32(String(id)) % 628) / 100;
      const p = { c, a, R, r, s, stunted, station: [Math.cos(home + st[0]) * r * st[1], Math.sin(home + st[0]) * r * st[1]], pos: [0, 0], target: null, until: 0, mode: "idle" };
      const a0 = R() * 6.28, rad = r * (0.38 + R() * 0.15);
      p.pos = [Math.cos(a0) * rad, Math.sin(a0) * rad];
      c.root.position.set(p.pos[0], groundY(r, ...p.pos), p.pos[1]);
      c.mixer.timeScale = stunted ? 0.5 : 0.9 + R() * 0.2;
      c.play("Idle_Loop", 0);
      group.add(c.root);
      people.push(p);
    }
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
  async function focus(id) {
    if (id == null) return;
    if (!crowds.has(id)) {
      await ensureKit();
      if (!crowds.has(id)) await rebuildCrowd(id, agentsOf.get(id) ?? dots.get(id)?.living ?? []);
    }
    for (const k of [...crowds.keys()]) if (k !== id && crowds.size > 2) dropCrowd(k);
  }

  // A citizen's day: walk to a spot on the plaza, idle a little, sometimes go to work at the
  // role's station (Smiths kneel, Scholars study at the temple, Brokers haggle at the edge).
  function think(p, now) {
    const { c, a, R, r } = p;
    if (p.mode === "walk") return;
    if (now < p.until) return;
    const work = R() < 0.45;
    const [tx, tz] = work ? p.station : (() => { const ang = R() * 6.28, rad = r * (0.38 + R() * 0.16); return [Math.cos(ang) * rad, Math.sin(ang) * rad]; })();
    p.target = [tx, tz];
    p.next = work ? (ROLES[a.role]?.work ?? "Idle_Loop") : R() < 0.3 ? "Idle_Talking_Loop" : "Idle_Loop";
    p.mode = "walk";
    c.play(a.role === "Trickster" ? "Jog_Fwd_Loop" : a.role === "Patron" || a.role === "Broker" ? "Walk_Formal_Loop" : "Walk_Loop");
  }

  const tmp = new THREE.Vector3();
  function update(dt, camera, focusId, nearK) {
    const now = performance.now() / 1000;
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

  /** The Scholar who wrote a corpus (for the star-gun), as { root, play, pos } or null. */
  function scholar(id, name) {
    return crowds.get(id)?.people.find((p) => p.a.name === name) ?? null;
  }

  return { setAgents, focus, update, pick, scholar, crowds };
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
