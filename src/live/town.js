// A lived-in nation (SPEC §12i). Around the real citizens: each role's place of work, built in code,
// and townsfolk who are NOT in the game (plain clothes, no name, no hover card, no far-view dot)
// doing ordinary things. The scenes read the game:
//   school   (Scholar)  class size = the nation's mindmap points
//   workshop (Smith)    forge lit and sparking only on a day a Smith built a tool
//   table    (Patron)   coin stacks = NEAR the nation has to spend
//   desk     (Drafter)  papers and scrolls = clean gifts
//   stall    (Broker)   buyers at the counter
//   post     (Warden)   a lamp; at night a watchman with a torch walks the island's edge
// Neglected nations: the class is empty and townsfolk hurry. Rich, lazy nations: someone dances.
// Ruins: empty benches, a cold anvil, a fallen table.
// Props are built in citizen metres inside a group scaled by the citizen scale `s`, front (+Z)
// facing the middle of the island.
import * as THREE from "three";
import { mesh } from "../scene.js";
import { makeCitizen, citizenGlow } from "./citizens.js";

const WOOD = 0xb07a4a, DARK_WOOD = 0x7a5232, STONE = 0xbdb6c8, IRON = 0x5a5f6e, CLOTH = 0xf2ead8, PAPER = 0xfffaf0;
const GOLD_MAT = new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0x8a5a00, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.35, flatShading: true });
const EMBER_HOT = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.25) });
const EMBER_COLD = new THREE.MeshStandardMaterial({ color: 0x3a3436, roughness: 1, flatShading: true });
const FLAME = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.35) });

const box = (w, h, d, c, x = 0, y = 0, z = 0) => { const m = mesh(new THREE.BoxGeometry(w, h, d), c, 0.04); m.position.set(x, y, z); return m; };
const cyl = (rt, rb, h, c, x = 0, y = 0, z = 0, seg = 8) => { const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), c, 0.04); m.position.set(x, y, z); return m; };
const shadows = (g) => g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));

// ---------- props (metres) ----------
function stool(h, c = WOOD) { const g = new THREE.Group(); g.add(cyl(0.2, 0.2, 0.06, c, 0, h - 0.03, 0)); for (const [x, z] of [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) g.add(box(0.04, h - 0.06, 0.04, DARK_WOOD, x, (h - 0.06) / 2, z)); return g; }
function bench(w, h) { const g = new THREE.Group(); g.add(box(w, 0.06, 0.34, WOOD, 0, h - 0.03, 0)); for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) g.add(box(0.06, h - 0.06, 0.3, DARK_WOOD, x, (h - 0.06) / 2, 0)); return g; }
function table(w, d, h = 0.75) { const g = new THREE.Group(); g.add(box(w, 0.07, d, WOOD, 0, h - 0.035, 0)); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(box(0.07, h - 0.07, 0.07, DARK_WOOD, x * (w / 2 - 0.08), (h - 0.07) / 2, z * (d / 2 - 0.08))); return g; }

function blackboard() {
  const g = new THREE.Group();
  g.add(box(1.5, 1.0, 0.06, 0x2f4a3a, 0, 1.3, 0)); // the board
  g.add(box(1.62, 0.07, 0.1, DARK_WOOD, 0, 1.83, 0), box(1.62, 0.07, 0.1, DARK_WOOD, 0, 0.77, 0));
  for (const x of [-0.72, 0.72]) g.add(box(0.07, 1.9, 0.07, DARK_WOOD, x, 0.95, 0));
  // chalk: a little tree of knowledge
  const chalk = 0xf4f1e6;
  g.add(box(0.03, 0.5, 0.01, chalk, 0, 1.25, 0.04), box(0.32, 0.03, 0.01, chalk, -0.12, 1.42, 0.04), box(0.36, 0.03, 0.01, chalk, 0.14, 1.32, 0.04));
  for (const [x, y] of [[-0.3, 1.43], [0.33, 1.33], [0, 1.52], [-0.45, 1.12], [0.45, 1.6]]) g.add(box(0.07, 0.07, 0.01, chalk, x, y, 0.04));
  return g;
}

function forge(lit) {
  const g = new THREE.Group();
  g.add(box(0.9, 0.75, 0.8, STONE, 0, 0.375, 0));
  g.add(box(0.7, 0.08, 0.6, 0x4a4040, 0, 0.78, 0));
  const coals = new THREE.Group();
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + (i % 3) * 0.02, 0), lit ? EMBER_HOT : EMBER_COLD); m.position.set(((i % 3) - 1) * 0.18, 0.84, (Math.floor(i / 3) - 1) * 0.15); coals.add(m); }
  g.add(coals);
  g.add(box(0.5, 1.2, 0.5, STONE, 0, 1.4, -0.1)); // hood + chimney
  g.add(box(0.26, 0.9, 0.26, STONE, 0, 2.4, -0.1));
  if (lit) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(1.6, 0.6, 0.15), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.8); glow.position.y = 0.95; g.add(glow);
    g.userData.glow = glow;
  }
  return g;
}
function anvil() { const g = new THREE.Group(); g.add(cyl(0.22, 0.26, 0.5, DARK_WOOD, 0, 0.25, 0)); g.add(box(0.2, 0.14, 0.18, IRON, 0, 0.57, 0)); g.add(box(0.5, 0.12, 0.2, IRON, 0.05, 0.7, 0)); return g; }
function sparks() {
  const n = 22, geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(2.4, 1.2, 0.3), size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  pts.userData.seed = Array.from({ length: n }, () => [Math.random() * 6.28, Math.random(), 0.6 + Math.random() * 0.8]);
  return pts;
}
function toolRack() { const g = new THREE.Group(); g.add(box(1.2, 0.06, 0.08, DARK_WOOD, 0, 1.5, 0)); for (let i = 0; i < 5; i++) { const x = -0.48 + i * 0.24; g.add(box(0.03, 0.5, 0.03, DARK_WOOD, x, 1.22, 0.04)); g.add(box(0.12, 0.08, 0.04, IRON, x, 0.98, 0.04)); } return g; }

function workshop(lit) {
  const g = new THREE.Group();
  for (const [x, z] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.6], [1.3, 0.6]]) g.add(box(0.12, 2.3, 0.12, DARK_WOOD, x, 1.15, z));
  const roof = box(3.0, 0.08, 1.9, 0xc0704a, 0, 2.35, -0.15); roof.rotation.x = -0.18; g.add(roof);
  const f = forge(lit); f.position.set(-0.75, 0, -0.55); g.add(f);
  const a = anvil(); a.position.set(0.25, 0, 0.1); g.add(a);
  const bench0 = table(1.1, 0.5, 0.85); bench0.position.set(0.85, 0, -0.65); g.add(bench0);
  for (let i = 0; i < 3; i++) g.add(box(0.14, 0.06, 0.1, IRON, 0.6 + i * 0.22, 0.89, -0.62));
  const rack = toolRack(); rack.position.set(0.8, 0, -0.95); g.add(rack);
  g.add(cyl(0.22, 0.2, 0.45, 0x6a7a8a, 1.05, 0.225, 0.35, 10)); // quench barrel
  let sp = null;
  if (lit) { sp = sparks(); sp.position.set(0.3, 0.75, 0.1); g.add(sp); }
  g.userData = { forge: f, sparks: sp };
  return g;
}

function countingTable(coins, gifts) {
  const g = new THREE.Group();
  g.add(table(1.5, 0.8));
  // coin stacks, one per ~0.8 NEAR to spend (at least one, at most 12)
  const n = Math.max(1, Math.min(12, Math.round(coins / 0.8)));
  for (let i = 0; i < n; i++) {
    const h = 0.06 + ((i * 37) % 7) * 0.025;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, h, 12), GOLD_MAT);
    c.position.set(-0.6 + (i % 6) * 0.17, 0.75 + h / 2, -0.15 + Math.floor(i / 6) * 0.2);
    g.add(c);
  }
  // the ledger, open
  const l = box(0.36, 0.03, 0.26, PAPER, 0.42, 0.765, 0.05); l.rotation.y = 0.15; g.add(l);
  g.add(box(0.36, 0.035, 0.27, 0x8a2a3a, 0.42, 0.75, 0.05));
  // a strongbox beside it
  const chest = new THREE.Group();
  chest.add(box(0.6, 0.4, 0.4, DARK_WOOD, 0, 0.2, 0), box(0.62, 0.05, 0.42, 0xd8a43a, 0, 0.42, 0));
  chest.position.set(1.05, 0, -0.3); g.add(chest);
  return g;
}

function desk(gifts) {
  const g = new THREE.Group();
  const t = table(1.2, 0.65, 0.72); g.add(t);
  // papers, one per clean gift (at least two), and a few scrolls
  const n = Math.max(2, Math.min(8, gifts + 2));
  for (let i = 0; i < n; i++) { const p = box(0.21, 0.004, 0.29, PAPER, -0.35 + (i % 4) * 0.08, 0.725 + i * 0.006, 0.04 + (i % 2) * 0.03); p.rotation.y = (i * 0.37) % 0.6 - 0.3; g.add(p); }
  for (let i = 0; i < 3; i++) { const s = cyl(0.03, 0.03, 0.34, 0xf3e3b8, 0.35, 0.75, -0.15 + i * 0.07, 8); s.rotation.z = Math.PI / 2; g.add(s); }
  g.add(cyl(0.03, 0.035, 0.08, 0x2a2a3a, 0.15, 0.76, -0.2, 8)); // ink
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), FLAME); lamp.position.set(0.5, 0.82, 0.2); g.add(lamp);
  g.add(cyl(0.05, 0.06, 0.06, 0xd8a43a, 0.5, 0.75, 0.2, 8));
  const chair = stool(0.46); chair.position.set(0, 0, 0.55); g.add(chair);
  return g;
}

function stall(c1, c2) {
  const g = new THREE.Group();
  g.add(box(1.8, 0.95, 0.55, WOOD, 0, 0.475, 0));
  for (const x of [-0.85, 0.85]) g.add(box(0.08, 2.1, 0.08, DARK_WOOD, x, 1.05, -0.3), box(0.08, 1.8, 0.08, DARK_WOOD, x, 0.9, 0.35));
  // striped awning in the Broker's colours
  for (let i = 0; i < 6; i++) { const st = box(0.32, 0.04, 1.0, i % 2 ? c1 : c2, -0.8 + i * 0.32, 2.0, 0.05); st.rotation.x = 0.28; g.add(st); }
  // goods
  const goods = [0xffb347, 0x9fd36a, 0xff6f91, 0xfff1a8, 0x7fc8ff];
  for (let i = 0; i < 7; i++) g.add(box(0.16, 0.12, 0.16, goods[i % goods.length], -0.7 + i * 0.22, 1.01, 0.05 + (i % 2) * 0.08));
  for (const [x, z] of [[1.25, -0.2], [1.3, 0.3], [-1.25, 0.1]]) g.add(box(0.42, 0.36, 0.42, DARK_WOOD, x, 0.18, z));
  return g;
}

function lampPost() {
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.07, 2.4, IRON, 0, 1.2, 0, 6), box(0.4, 0.05, 0.05, IRON, 0.18, 2.3, 0));
  const glass = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), FLAME); glass.position.set(0.36, 2.15, 0); g.add(glass);
  g.userData.flame = glass;
  return g;
}
function torch() { const g = new THREE.Group(); g.add(cyl(0.025, 0.03, 0.5, DARK_WOOD, 0, 0.2, 0, 6)); const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), FLAME); f.position.y = 0.52; g.add(f); return g; }
function cart() { const g = new THREE.Group(); g.add(box(0.8, 0.3, 1.0, WOOD, 0, 0.45, 0)); for (const x of [-0.45, 0.45]) { const w = cyl(0.28, 0.28, 0.06, DARK_WOOD, x, 0.28, 0.1, 10); w.rotation.z = Math.PI / 2; g.add(w); } g.add(box(0.05, 0.05, 0.6, DARK_WOOD, -0.3, 0.6, -0.7), box(0.05, 0.05, 0.6, DARK_WOOD, 0.3, 0.6, -0.7)); for (let i = 0; i < 4; i++) g.add(box(0.22, 0.18, 0.22, [0xffb347, 0x9fd36a, 0xfff1a8, 0xff6f91][i], -0.18 + (i % 2) * 0.36, 0.69, -0.2 + Math.floor(i / 2) * 0.4)); return g; }

let glow = null;
function glowTex() {
  if (glow) return glow;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.35, "rgba(255,255,255,0.3)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(c));
}

// Where each scene goes, as (angle offset, radius fraction) on the plaza ring (matches the roles'
// old work spots, so citizens keep their part of the island).
const SPOT = { Scholar: [0.9, 0.4], Smith: [2.1, 0.52], Drafter: [3.2, 0.46], Broker: [4.4, 0.55], Patron: [0, 0.36], Warden: [5.4, 0.62] };
const FOOT = { Scholar: 2.4, Smith: 2.0, Drafter: 1.3, Broker: 1.7, Patron: 1.4, Warden: 0.6 };

/**
 * Build a nation's scenes and townsfolk. Returns { group, actors, stations } where stations maps a
 * role to the places its citizens work: [{ x, z, face, clip }].
 */
export async function buildTown(ctx) {
  const { kit, r, s, clan, status, roles, smithWorked, phone, place, groundY, R, home } = ctx;
  const group = new THREE.Group();
  group.name = "town";
  const actors = [], stations = new Map();
  const dead = status === "dead";

  // Put a scene on the island: returns a frame for converting its local metres to town space.
  const scenes = {};
  function put(role, obj) {
    const [a, f] = SPOT[role];
    const [x, z] = place(Math.cos(home + a) * r * f, Math.sin(home + a) * r * f, FOOT[role] * s);
    const rot = Math.atan2(-x, -z); // front faces the middle of the island
    const g = new THREE.Group();
    g.position.set(x, groundY(r, x, z), z);
    g.rotation.y = rot;
    obj.scale.setScalar(s);
    g.add(obj);
    shadows(obj);
    group.add(g);
    const frame = { x, z, rot, obj, at: (lx, lz) => [x + (lx * Math.cos(rot) + lz * Math.sin(rot)) * s, z + (-lx * Math.sin(rot) + lz * Math.cos(rot)) * s], face: (a) => a + rot };
    scenes[role] = frame;
    return frame;
  }
  const station = (role, list) => stations.set(role, list);

  // People who aren't in the game. `kind` = "child" | "adult"; returns the citizen, already placed.
  let folkN = 0;
  async function person(kind, x, z, face, clip, extra = {}) {
    const name = `${clan.name}#${folkN++}`;
    const c = await makeCitizen(kit, null, name, { plain: true, child: kind === "child" });
    const k = kind === "child" ? 0.62 : kind === "teen" ? 0.86 : 1;
    c.root.scale.setScalar(s * k);
    c.root.position.set(x, groundY(r, x, z) + (extra.lift ?? 0) * s, z);
    c.root.rotation.y = face;
    c.mixer.timeScale = 0.85 + R() * 0.3;
    const act = c.play(clip, 0);
    if (act) act.time = R() * act.getClip().duration; // out of step with each other
    group.add(c.root);
    const actor = { c, kind, pos: [x, z], k, mode: extra.mode ?? "fixed", ...extra };
    actors.push(actor);
    return actor;
  }

  if (dead) {
    // Ruins: empty benches, a cold anvil, a fallen table. No one.
    const b = new THREE.Group(); for (let i = 0; i < 3; i++) { const be = bench(1.2, 0.3); be.position.set(-1.2 + i * 1.2, 0, 0.6); be.rotation.y = (i - 1) * 0.5; be.rotation.z = i === 2 ? 0.4 : 0; b.add(be); } put("Scholar", b);
    put("Smith", anvil());
    const t = table(1.5, 0.8); t.rotation.z = 1.35; t.position.y = 0.4; const tw = new THREE.Group(); tw.add(t); put("Patron", tw);
    return { group, actors, stations };
  }

  const neglected = status === "neglected";
  const pts = Math.max(0, clan.points || 0);

  // ---- school: the Scholar teaches; children sit in an arc on low benches ----
  if (roles.has("Scholar")) {
    const g = new THREE.Group();
    const bb = blackboard(); bb.position.set(0, 0, -1.0); g.add(bb);
    const sc = put("Scholar", g);
    station("Scholar", [{ ...pt(sc, -0.85, -0.55), face: sc.face(Math.PI * 0.15), clip: "Idle_Talking_Loop" }, { ...pt(sc, 0.95, -0.6), face: sc.face(-Math.PI * 0.15), clip: "Interact" }]);
    const kids = neglected ? 0 : Math.min(phone ? 3 : 5, 2 + Math.floor(pts / 20));
    for (let i = 0; i < kids; i++) {
      const a = (i / Math.max(1, kids - 1) - 0.5) * 1.6; // arc
      const lx = Math.sin(a) * 1.25, lz = 0.35 + Math.cos(a) * 0.55;
      const st = stool(0.28); st.position.set(lx, 0, lz + 0.05); g.add(st); shadows(st);
      const [x, z] = sc.at(lx, lz);
      await person("child", x, z, sc.face(Math.atan2(-lx, -1.0 - lz)), i % 2 ? "Sitting_Talking_Loop" : "Sitting_Idle_Loop");
    }
    if (neglected) for (let i = 0; i < 3; i++) { const st = stool(0.28); st.position.set(-0.6 + i * 0.6, 0, 0.6); st.rotation.z = i === 1 ? 1.4 : 0; g.add(st); shadows(st); }
  }

  // ---- workshop: the Smith kneels at the anvil; the forge is lit on a day a tool was built ----
  if (roles.has("Smith")) {
    const ws = workshop(smithWorked);
    const sc = put("Smith", ws);
    station("Smith", [{ ...pt(sc, 0.25, 0.75), face: sc.face(Math.PI), clip: "Fixing_Kneeling" }, { ...pt(sc, -0.75, 0.35), face: sc.face(Math.PI), clip: "Interact" }]);
    // the apprentice at the workbench
    const [x, z] = sc.at(0.85, -0.15);
    await person("teen", x, z, sc.face(Math.PI), "PickUp_Table");
    sc.sparks = ws.userData.sparks; sc.forge = ws.userData.forge;
  }

  // ---- counting table by the temple: the Patron counts the nation's NEAR ----
  if (roles.has("Patron")) {
    const sc = put("Patron", countingTable(clan.play || 0, clan.clean_gifts || 0));
    station("Patron", [{ ...pt(sc, -0.2, -0.65), face: sc.face(0), clip: "PickUp_Table" }, { ...pt(sc, 0.5, -0.65), face: sc.face(0), clip: "Idle_Talking_Loop" }]);
    // a clerk on a stool at the end, taking notes
    const st = stool(0.46); st.position.set(-1.05, 0, 0.1); sc.obj.add(st); shadows(st);
    const [x, z] = sc.at(-1.05, 0.1);
    await person("adult", x, z, sc.face(Math.PI / 2), "Sitting_Talking_Loop");
  }

  // ---- drafter's desk ----
  if (roles.has("Drafter")) {
    const sc = put("Drafter", desk(clan.clean_gifts || 0));
    station("Drafter", [{ ...pt(sc, 0, 0.55), face: sc.face(Math.PI), clip: "Sitting_Idle_Loop" }, { ...pt(sc, 0.7, 0.4), face: sc.face(Math.PI * 0.8), clip: "Idle_Loop" }]);
  }

  // ---- market stall: the Broker behind the counter, buyers in front ----
  if (roles.has("Broker")) {
    const sc = put("Broker", stall(0x00f0b0, 0xff5cb0));
    station("Broker", [{ ...pt(sc, -0.35, -0.7), face: sc.face(0), clip: "Idle_Talking_Loop" }, { ...pt(sc, 0.45, -0.7), face: sc.face(0), clip: "Idle_Talking_Loop" }]);
    const buyers = phone ? 1 : neglected ? 1 : 2;
    for (let i = 0; i < buyers; i++) { const [x, z] = sc.at(-0.4 + i * 0.85, 0.75); await person("adult", x, z, sc.face(Math.PI + (i - 0.5) * 0.4), i ? "Idle_Loop" : "Idle_Talking_Loop"); }
  }

  // ---- warden's post: a lamp; the Warden stands watch; at night a watchman walks the edge ----
  if (roles.has("Warden")) {
    const sc = put("Warden", lampPost());
    station("Warden", [{ ...pt(sc, 0.3, 0.35), face: sc.face(0), clip: "Idle_Loop" }]);
    sc.flame = sc.obj.userData.flame;
  }
  {
    const a0 = R() * 6.28, rad = r * 0.78;
    const w = await person("adult", Math.cos(a0) * rad, Math.sin(a0) * rad, 0, "Walk_Loop", { mode: "watch", ang: a0, rad, night: true });
    const t = torch(); const hand = boneNamed(w.c.root, "hand_r");
    if (hand) { const ws = hand.getWorldScale(new THREE.Vector3()).x; t.scale.setScalar(ws > 0 ? (s * w.k) / ws : 1); hand.add(t); w.torch = t; }
    w.c.mixer.timeScale = 0.8;
  }

  // ---- everyday townsfolk ----
  const walkers = phone ? 1 : neglected ? 3 : 2;
  for (let i = 0; i < walkers; i++) {
    const a = R() * 6.28, rad = r * (0.35 + R() * 0.3);
    const [x, z] = place(Math.cos(a) * rad, Math.sin(a) * rad, 0);
    await person(R() < 0.25 ? "teen" : "adult", x, z, R() * 6.28, "Idle_Loop", { mode: "walk", until: 0, hurry: neglected });
  }
  if (!phone) {
    // a cart pusher doing the rounds
    const a0 = R() * 6.28, rad = r * 0.66;
    const p = await person("adult", Math.cos(a0) * rad, Math.sin(a0) * rad, 0, "Push_Loop", { mode: "ring", ang: a0, rad, dir: R() < 0.5 ? 1 : -1 });
    const ct = cart(); ct.position.set(0, 0, 0.95); p.c.root.add(ct); shadows(ct);
    // two children chasing each other round a little circle
    if (!neglected) {
      const a = home + 1.6, [cx, cz] = place(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 1.2 * s);
      for (let i = 0; i < 2; i++) await person("child", cx, cz, 0, "Jog_Fwd_Loop", { mode: "ring", cx, cz, ang: i * 2.4, rad: 0.9 * s, dir: 1, speed: 1.1 });
    }
  }
  if (status === "rich") {
    const [x, z] = place(Math.cos(home + 0.45) * r * 0.24, Math.sin(home + 0.45) * r * 0.24, 0);
    await person("adult", x, z, R() * 6.28, "Dance_Loop");
  }

  return { group, actors, stations, scenes };
}

function pt(sc, lx, lz) { const [x, z] = sc.at(lx, lz); return { x, z }; }
function boneNamed(root, name) { let b = null; root.traverse((o) => { if (o.isBone && o.name === name) b = o; }); return b; }

/**
 * Animate a nation's townsfolk and scenes. `open(x, z)` finds a clear spot; `groundY` the ground.
 */
export function stepTown(town, dt, now, { r, s, open, groundY }) {
  const night = citizenGlow.value > 0;
  for (const a of town.actors) {
    const c = a.c;
    if (a.night) c.root.visible = night;
    if (!c.root.visible) continue;
    if (a.mode === "watch") {
      a.ang += dt * 0.05;
      const x = Math.cos(a.ang) * a.rad, z = Math.sin(a.ang) * a.rad;
      c.root.position.set(x, groundY(r, x, z), z);
      c.root.rotation.y = Math.atan2(-Math.sin(a.ang), Math.cos(a.ang)); // walking round the rim
      if (a.torch) { // the flame stays upright whatever the hand does
        c.root.updateMatrixWorld(true);
        a.torch.parent.getWorldQuaternion(a.torch.quaternion).invert();
      }
    } else if (a.mode === "ring") {
      a.ang += dt * (a.speed ?? 0.06) * a.dir;
      const x = (a.cx ?? 0) + Math.cos(a.ang) * a.rad, z = (a.cz ?? 0) + Math.sin(a.ang) * a.rad;
      c.root.position.set(x, groundY(r, x, z), z);
      c.root.rotation.y = Math.atan2(-Math.sin(a.ang) * a.dir, Math.cos(a.ang) * a.dir);
    } else if (a.mode === "walk") {
      if (!a.target && now > a.until) {
        const ang = Math.random() * 6.28, rad = r * (0.3 + Math.random() * 0.4);
        a.target = open(Math.cos(ang) * rad, Math.sin(ang) * rad);
        c.play(a.hurry ? "Jog_Fwd_Loop" : "Walk_Loop");
      }
      if (a.target) {
        const dx = a.target[0] - a.pos[0], dz = a.target[1] - a.pos[1], d = Math.hypot(dx, dz);
        if (d < 0.02) { a.target = null; a.until = now + 2 + Math.random() * 6; c.play(Math.random() < 0.4 ? "Idle_Talking_Loop" : "Idle_Loop"); }
        else {
          const step = Math.min(d, r * (a.hurry ? 0.16 : 0.07) * a.k * dt);
          a.pos[0] += (dx / d) * step; a.pos[1] += (dz / d) * step;
          const want = Math.atan2(dx, dz);
          c.root.rotation.y += Math.atan2(Math.sin(want - c.root.rotation.y), Math.cos(want - c.root.rotation.y)) * Math.min(1, dt * 6);
          c.root.position.set(a.pos[0], groundY(r, ...a.pos), a.pos[1]);
        }
      }
    }
    c.mixer.update(dt);
  }
  // forge sparks + glow, the post's flame
  for (const sc of Object.values(town.scenes || {})) {
    if (sc.sparks) {
      const pos = sc.sparks.geometry.attributes.position;
      sc.sparks.userData.seed.forEach(([a, ph, sp], i) => {
        const t = (now * sp + ph) % 1;
        pos.setXYZ(i, Math.cos(a + i) * t * 0.35, t * 0.7 - t * t * 0.5, Math.sin(a + i) * t * 0.35);
      });
      pos.needsUpdate = true;
      sc.sparks.material.opacity = 0.6 + Math.sin(now * 13) * 0.3;
    }
    if (sc.forge?.userData.glow) sc.forge.userData.glow.material.opacity = 0.7 + Math.sin(now * 3.1) * 0.15 + Math.sin(now * 7.3) * 0.1;
    if (sc.flame) sc.flame.visible = night;
  }
}
