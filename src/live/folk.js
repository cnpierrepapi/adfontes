// The people of each nation (SPEC §12h).
// Far away: one coloured dot per citizen, circling its island (every nation, cheap Points).
// Up close (the nation you're focused on): the real citizens from the contract, walking the plaza
// between the temple and the houses, going to their role's spot to work. Stunted = grey and slow;
// dead = a gravestone. The kit (6.9 MB) loads the first time you fly to a nation.
import * as THREE from "three";
import { planWalk, walkStep, turnToward } from "./steer.js";
import { loadCitizenKit, makeCitizen, ROLES } from "./citizens.js";
import { buildTown, stepTown } from "./town.js";

const h32 = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const rnd = (seed) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)) >>> 0) / 4294967296;
const groundY = (r, x, z) => r * 0.05 * (1 - Math.min(1, (x * x + z * z) / (r * r))) + r * 0.004; // the island's domed top

// Where each role goes to work, as (angle offset, radius fraction) on the plaza ring.
const STATION = { Patron: [0, 0.4], Scholar: [0.9, 0.37], Smith: [2.1, 0.5], Drafter: [3.2, 0.45], Broker: [4.4, 0.55], Trickster: [5.3, 0.5] };

export function createFolk({ scene, islands, renderer, camera }) {
  let kit = null, kitLoading = null;
  const dots = new Map(); // nation id -> { pts, agents, seeds }
  const crowds = new Map(); // nation id -> { group, people: [...] }
  let day = 0;
  // Nations where a Smith built a tool on the latest day (the forge is lit there).
  const toolDays = new Map();
  function dayRecords(records, d) { for (const r of records || []) if (r.kind === "tool") { if (!toolDays.has(d)) toolDays.set(d, new Set()); toolDays.get(d).add(r.clan); } }
  const phone = matchMedia("(pointer: coarse)").matches || innerWidth < 700;

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
    const blocks = [], houseBlocks = []; // houseBlocks: the island's own houses and trees, which can be cleared
    for (const o of town?.children ?? []) {
      if (o.name === "folk" || o === isl.userData.lamps) continue; // ourselves, and the lamp lights
      if (!o.visible) continue; // cleared earlier for the town
      const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      if (!isFinite(size.x) || size.x === 0) continue;
      const b = [o.position.x, o.position.z, Math.max(size.x, size.z) * 0.55 + r * 0.04];
      blocks.push(b);
      houseBlocks.push({ b, o });
    }
    // The open spot nearest to (x, z): tries rings of nudges until nothing is in the way.
    const clear = (x, z, rad = 0) => !blocks.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br + rad);
    const open = (x, z, rad = 0) => {
      if (clear(x, z, rad)) return [x, z];
      for (let ring = 1; ring <= 6; ring++) for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, d = ring * r * 0.06;
        let nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
        const len = Math.hypot(nx, nz), max = r * 0.86;
        if (len > max) { nx *= max / len; nz *= max / len; } // stay on the island
        if (clear(nx, nz, rad)) return [nx, nz];
      }
      return [x, z];
    };
    // The nation's scenes and townsfolk go down first (SPEC §12i), so everyone walks round them.
    const place = (x, z, rad) => { const p = open(x, z, rad); if (rad > 0) blocks.push([p[0], p[1], rad]); return p; };
    const living = (agents || []).filter((a) => a.alive && isl.userData.status !== "dead");
    const latest = Math.max(day, ...toolDays.keys());
    const home = (h32(String(id)) % 628) / 100;
    const life = await buildTown({ kit, r, s, clan: isl.userData.clan, status: isl.userData.status, roles: new Set(living.map((a) => a.role)), smithWorked: !!toolDays.get(latest)?.has(id), phone, place, open, blocks, groundY, R: rnd(h32(`town${id}`)), home });
    // Clear the land under the town (SPEC §14b): a house or tree under a scene's footprint, or under
    // a spot where someone works, comes down, so nobody works or stands inside one. The temple and
    // the fountain (near the middle) always stay.
    {
      const sceneBlocks = Object.values(life.scenes || {}).map((sc) => blocks.find((b) => Math.hypot(b[0] - sc.x, b[1] - sc.z) < 1e-3)).filter(Boolean);
      const spots = [...life.stations.values()].flat().concat(Object.values(life.scenes || {}).map((sc) => sc.visit).filter(Boolean));
      for (const { b, o } of houseBlocks) {
        if (Math.hypot(b[0], b[1]) < r * 0.3) continue;
        const under = sceneBlocks.some((sb) => Math.hypot(sb[0] - b[0], sb[1] - b[1]) < sb[2] + b[2] * 0.8) || spots.some((sp) => Math.hypot(sp.x - b[0], sp.z - b[1]) < b[2] + s * 0.3);
        if (!under) continue;
        o.visible = false;
        blocks.splice(blocks.indexOf(b), 1);
      }
    }
    life.blocks = blocks; // every footprint on the island: nobody walks through them (SPEC §14b)
    group.add(life.group);
    const taken = new Map();
    for (const a of agents || []) {
      const seed = h32(a.name), R = rnd(seed);
      if (!a.alive || isl.userData.status === "dead") { group.add(gravestone(r, s, R)); continue; }
      const c = await makeCitizen(kit, a.role, a.name);
      c.root.scale.setScalar(s);
      const stunted = a.stunted_until > day;
      if (stunted) c.root.traverse((o) => o.isMesh && o.material?.color && (o.material = Object.assign(o.material.clone(), { color: new THREE.Color(0x8a8a96) })));
      const st = STATION[a.role] ?? [R() * 6.28, 0.45];
      // Work at the role's scene if it has one (two spots each; more citizens share them).
      const spots = life.stations.get(a.role), k = taken.get(a.role) ?? 0;
      taken.set(a.role, k + 1);
      const spot = spots?.[k % spots.length];
      const p = { c, a, R, r, s, stunted, open, isl, life, blocks, maxR: r * 0.88, cr: s * 0.28, station: spot ? [spot.x, spot.z] : open(Math.cos(home + st[0]) * r * st[1], Math.sin(home + st[0]) * r * st[1]), stationFace: spot?.face, stationClip: spot?.clip, pos: [0, 0], target: null, until: 0, mode: "idle" };
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
    crowds.set(id, { group, people, life, open });
    // Compile its shaders now (in parallel where the GPU allows) so the first close look doesn't
    // stall. compileAsync reads what's visible at the call, so the group shows for that instant.
    if (renderer) {
      const was = group.visible;
      group.visible = true;
      renderer.compileAsync(group, camera, scene).catch(() => {});
      group.visible = was;
    }
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
  // Keep every nation's people (a handful of nations, built once); only a very big world lets go.
  function trim(id) { for (const k of [...crowds.keys()]) if (k !== id && crowds.size > 12) dropCrowd(k); }

  /** Page load: fetch the kit at once, then build each nation's people one by one in idle time. */
  async function preload(ids) {
    await ensureKit();
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 30)));
    for (const id of ids) {
      await idle();
      await focus(id).catch(() => {});
    }
  }

  // A citizen's day: walk to a spot on the plaza, idle a little, sometimes go to work at the
  // role's station (Smiths kneel, Scholars study at the temple, Brokers haggle at the edge).
  function think(p, now) {
    const { c, a, R, r } = p;
    if (p.mode === "walk") return;
    if (now < p.until) return;
    p.errandStep = null;
    // Errands come first (SPEC §14b): the money and the people a job needs, before the job.
    if (p.errands?.length) {
      const st = p.errands.shift();
      planWalk(p, st.to, p.blocks, p.maxR, now);
      p.next = st.clip; p.errandStep = st; p.atWork = false; p.faceTemple = false; p.mode = "walk";
      c.play(a.role === "Patron" || a.role === "Broker" ? "Walk_Formal_Loop" : "Walk_Loop");
      return;
    }
    if (p.queue?.length) { nextShot(p); return; } // a star waiting for its Scholar
    // Reverence (SPEC §12m) shows in the town: waiting for a first whisper, they stand in the
    // plaza facing the temple; revered, they work more; neglected, they drift to the edge.
    const rev = p.isl?.userData.clan?.reverence;
    if (rev?.waiting && a.role !== "Trickster") {
      const ang = R() * 6.28;
      planWalk(p, p.open(Math.cos(ang) * r * 0.24, Math.sin(ang) * r * 0.24, p.cr), p.blocks, p.maxR, now, true);
      p.next = "Idle_Loop"; p.atWork = false; p.faceTemple = true; p.mode = "walk";
      c.play("Walk_Loop");
      return;
    }
    p.faceTemple = false;
    const standing = rev?.standing ?? 50;
    const work = R() < (a.role === "Patron" ? (standing < 30 ? 0.5 : 0.85) : standing < 30 ? 0.15 : standing > 70 ? 0.6 : 0.45);
    const far = standing < 30; // they've stopped listening: away from the temple, to the edge
    const [tx, tz] = work ? p.station : (() => { const ang = R() * 6.28, rad = r * (far ? 0.62 + R() * 0.16 : 0.38 + R() * 0.16); return p.open(Math.cos(ang) * rad, Math.sin(ang) * rad, p.cr); })();
    planWalk(p, [tx, tz], p.blocks, p.maxR, now, !work); // a stroll never cuts into a building
    p.next = work ? (p.stationClip ?? ROLES[a.role]?.work ?? "Idle_Loop") : R() < 0.3 ? "Idle_Talking_Loop" : "Idle_Loop";
    p.atWork = work;
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
      stepTown(cr.life, dt, now, { r: islands.get(id).userData.r, s: 0, open: cr.open, groundY });
      for (const p of cr.people) {
        if (p.mode === "gun") { gunStep(p, dt, now); p.c.mixer.update(dt); continue; }
        if (p.mode === "struck") { p.c.mixer.update(dt); continue; }
        think(p, now);
        if (p.mode === "walk") {
          const speed = p.r * 0.09 * (p.stunted ? 0.4 : 1) * (p.a.role === "Trickster" ? 2 : 1);
          if (walkStep(p, dt, speed, p.blocks, p.maxR, now)) {
            p.mode = "stay";
            const st = p.errandStep;
            p.until = now + (st?.dur ?? 3 + p.R() * 6);
            p.c.play(p.next);
            if (st) { p.c.root.rotation.y = st.face; if (st.at === "Patron") payOut(cr, p, now); } // at the desk: the Patron pays
            else if (p.atWork) p.c.root.rotation.y = p.stationFace ?? Math.atan2(-p.pos[0], -p.pos[1]); // facing their work (or the temple)
            else if (p.faceTemple) p.c.root.rotation.y = Math.atan2(-p.pos[0], -p.pos[1]); // waiting on their god
          } else turnToward(p.c.root, p.heading, dt);
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

  // ---- errands (SPEC §14b): who goes where before a job ----
  // Where a visitor stands at a role's scene, facing it: the Patron's bank desk has its own spot.
  function visitStep(cr, role, dur, clip = "Interact") {
    const sc = cr.life.scenes?.[role];
    if (!sc) return null;
    const spot = sc.visit;
    return { to: [spot.x, spot.z], face: spot.face, clip, dur, at: role }; // beside the scene on purpose: its own footprint doesn't block it
  }
  const stationStep = (p) => ({ to: p.station, face: p.stationFace ?? 0, clip: p.stationClip ?? ROLES[p.a.role]?.work ?? "Idle_Loop", dur: 6 + p.R() * 4, at: "work" });
  // Real work cuts a stroll or a rest short (never a job, an errand already under way, or a shot).
  function interrupt(p) {
    const strolling = p.mode === "walk" && !p.errandStep && !p.atWork;
    if (p.mode === "stay" || p.mode === "idle" || strolling) { p.mode = "idle"; p.until = 0; p.target = null; p.legs = null; }
  }
  // The Patron looks up and pays out to whoever came to the desk.
  function payOut(cr, visitor, now) {
    const q = cr.people.find((x) => x.a.role === "Patron" && x !== visitor && x.mode !== "gun" && x.mode !== "struck");
    if (!q || q.mode === "walk") return;
    q.c.play("Interact"); q.until = now + 2.6; q.mode = "stay";
  }
  /** A world event a citizen has to run around for: a Smith's kit, a Broker's purchase, a draft. */
  function errand(id, kind, name = null) {
    const cr = crowds.get(id);
    if (!cr?.group.visible) return false;
    const role = { tool: "Smith", trade: "Broker", draft: "Drafter" }[kind];
    const p = cr.people.find((q) => q.a.role === role && (!name || q.a.name === name) && q.mode !== "struck");
    if (!p) return false;
    const steps = kind === "tool" ? [visitStep(cr, "Scholar", 2.4, "Idle_Talking_Loop"), visitStep(cr, "Patron", 2.2)] // what the Scholar needs drawn; the Patron pays for metal
      : kind === "trade" ? [visitStep(cr, "Patron", 2.2)] // money for the purchase
      : [visitStep(cr, "Scholar", 2.4, "Idle_Talking_Loop")]; // the research the draft is built on
    p.errands = [...steps.filter(Boolean), stationStep(p)];
    interrupt(p);
    return true;
  }

  // ---- the gods' smite (SPEC §12j): a hit, then a fall (kill) or grey and slow (stunt) ----
  function smite(id, name, verdict) {
    const p = crowds.get(id)?.people.find((q) => q.a.name === name);
    if (!p) return false;
    p.mode = "struck";
    const hit = p.c.play("Hit_Chest", 0.12);
    if (hit) { hit.setLoop(THREE.LoopOnce, 1); hit.clampWhenFinished = true; }
    setTimeout(() => {
      if (verdict === "Kill") {
        const fall = p.c.play("Death01", 0.2);
        if (fall) { fall.setLoop(THREE.LoopOnce, 1); fall.clampWhenFinished = true; }
        return; // lies there until the chain's new state puts a gravestone in their place
      }
      p.stunted = true;
      p.c.root.traverse((o) => o.isMesh && o.material?.color && (o.material = Object.assign(o.material.clone(), { color: new THREE.Color(0x8a8a96) })));
      p.c.mixer.timeScale = 0.5;
      p.mode = "idle"; p.until = 0;
      p.c.play("Idle_Loop");
    }, 900);
    return true;
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
    const now = performance.now() / 1000;
    // Research needs money (SPEC §14b): to the Patron's bank desk first (once per stretch of work).
    const pay = visitStep(cr, "Patron", 2.6);
    // One trip covers all the research waiting at the time: no second trip while one is queued or under way.
    const goingAlready = p.errandStep?.at === "Patron" || p.errands?.some((e) => e.at === "Patron");
    if (pay && !goingAlready && now - (p.paidAt ?? -99) > 20 && p.mode !== "gun") { p.paidAt = now; (p.errands ||= []).push(pay); interrupt(p); return true; }
    if (p.mode !== "gun" && !p.errands?.length && !goingAlready) nextShot(p);
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
    planWalk(p, p.open(Math.cos(here + turn) * p.r * 0.68, Math.sin(here + turn) * p.r * 0.68, p.cr), p.blocks, p.maxR, performance.now() / 1000);
    p.c.play("Walk_Loop");
    p.c.mixer.timeScale = 0.7; // heavy
    p.walkT0 = p.lastT = performance.now() / 1000;
  }
  // 0 = carried on the shoulder, leaning forward; 1 = held straight up to fire.
  function gunPose(g, k) {
    g.position.set(-0.2 + k * 0.12, 1.3 + k * 0.25, 0.05 - k * 0.05);
    g.rotation.set(THREE.MathUtils.lerp(1.05, 0.12, k), 0, THREE.MathUtils.lerp(0.25, 0, k));
  }
  function gunStep(p, dt, now) {
    const { c } = p;
    if (p.phase === "walk") {
      // Real time, not frames: on a slow machine (few frames a second) the walk would crawl and the
      // shot never come. And never more than 8 s of walking: they fire from wherever they got to.
      const rdt = Math.min(0.25, Math.max(0, now - (p.lastT ?? now)));
      p.lastT = now;
      const there = walkStep(p, rdt, p.r * 0.075, p.blocks, p.maxR, now); // a heavy stagger, round the buildings
      if (there || now - (p.walkT0 ?? now) > 8) { p.target = null; p.phase = "aim"; p.t0 = now; c.mixer.timeScale = 1; c.play("Pistol_Aim_Up", 0.3); c.root.rotation.z = 0; return; }
      turnToward(c.root, p.heading, dt, 5);
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

  // A nation's town changed (a tech was built): rebuild it if it's on screen.
  const retown = (id) => { if (crowds.has(id) && agentsOf.has(id)) rebuildCrowd(id, agentsOf.get(id)); };
  return { setAgents, focus, update, pick, launch, smite, preload, crowds, shots, dayRecords, retown, errand };
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
