// Phase C step 2 (12 Nov, written before mergeStatic): still pieces that share the one flat material merge
// into one drawn shape per group, with nothing moved, lost or resized. Runs in Node (no WebGL needed).
//   node tests/merge.test.mjs
import * as THREE from "three";
import { island, house, tree, temple, mesh, mergeStatic } from "../src/scene.js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const meshes = (o) => { let n = 0; o.traverse((x) => { if (x.isMesh) n++; }); return n; };
const verts = (o) => { let n = 0; o.updateMatrixWorld(true); o.traverse((x) => { if (x.isMesh) n += x.geometry.attributes.position.count; }); return n; };
const box = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const same = (a, b, eps = 1e-4) => a.min.distanceTo(b.min) < eps && a.max.distanceTo(b.max) < eps;

// A bridge's planks: many small boxes along a curve, each its own draw call today.
const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, -1, 2), new THREE.Vector3(10, 0, 4));
const bridge = new THREE.Group();
for (let i = 1; i < 60; i++) { const p = mesh(new THREE.BoxGeometry(0.42, 0.03, 0.11), i % 2 ? 0xffd36e : 0xffe9b0, 0.05); p.position.copy(curve.getPoint(i / 60)); p.lookAt(curve.getPoint(Math.min(1, i / 60 + 0.01))); bridge.add(p); }
const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.02, 4), new THREE.MeshBasicMaterial({ color: 0xff4fa3 }));
bridge.add(rope);
const b0 = box(bridge), v0 = verts(bridge), n0 = meshes(bridge);
mergeStatic(bridge);
ok(n0 === 60 && meshes(bridge) === 2, `a bridge's 59 planks become 1 shape, the rope (another material) stays (${n0} -> ${meshes(bridge)} meshes)`);
ok(same(b0, box(bridge)), "the bridge's bounds are exactly the same");
ok(verts(bridge) === v0, `no vertex lost or added (${v0})`);
ok(bridge.children.includes(rope), "the rope is untouched");

// An island's rock base, with a town group that must stay as it is.
const isl = island(3, {});
const town = new THREE.Group(); town.userData.noMerge = true; isl.add(town);
const h = house(0.4, 0xd8202a); h.position.set(1.5, 0, 0.5); h.rotation.y = 0.7; h.userData.kind = "house"; town.add(h);
const tr = tree(0.8); tr.position.set(-1, 0, 1); town.add(tr);
const tp = temple(1.5, 0x3366ff); town.add(tp);
const islBox = box(isl), islVerts = verts(isl), townMeshes = meshes(town), baseMeshes = meshes(isl) - townMeshes;
mergeStatic(isl);
ok(meshes(isl) - meshes(town) <= 3 && baseMeshes > 5, `the island's rock base merges (${baseMeshes} -> ${meshes(isl) - meshes(town)} meshes)`);
ok(meshes(town) === townMeshes && town.parent === isl, "a group marked noMerge (the town) is left exactly as it was");
ok(same(islBox, box(isl)) && verts(isl) === islVerts, "the island keeps its bounds and every vertex");

// Each building merges inside itself: same group, same place, same size (the townsfolk walk round these).
const hb = box(h), hm = meshes(h), hv = verts(h);
mergeStatic(h);
ok(h.parent === town && h.userData.kind === "house" && h.position.x === 1.5, "the house keeps its group, place and tag");
ok(meshes(h) === 1 && hm > 1, `the house is one shape now (${hm} -> ${meshes(h)})`);
const precise = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o, true); };
ok(verts(h) === hv, `the house keeps every vertex (${hv})`);
ok(h.userData.size && Math.abs(h.userData.size[0] - (hb.max.x - hb.min.x)) < 1e-9 && Math.abs(h.userData.size[2] - (hb.max.z - hb.min.z)) < 1e-9, "the house keeps its walking footprint exactly (the size measured before the merge)");
ok(Math.abs(precise(h).min.y - hb.min.y) < 1e-6 && Math.abs(precise(h).max.y - hb.max.y) < 1e-6, "same height, floor to roof (to a millionth)");
const tpm = meshes(tp); mergeStatic(tp);
ok(meshes(tp) < tpm, `the temple merges too (${tpm} -> ${meshes(tp)})`);

// Something animated stays apart.
const spin = mesh(new THREE.BoxGeometry(1, 1, 1), 0xffffff); spin.userData.noMerge = true;
const g2 = new THREE.Group(); g2.add(spin, mesh(new THREE.BoxGeometry(1, 1, 1), 0xffffff), mesh(new THREE.SphereGeometry(1), 0xffffff));
mergeStatic(g2);
ok(g2.children.includes(spin) && meshes(g2) === 2, "a piece marked noMerge stays its own mesh");

// One shape for a whole town (12 Nov, step 2b): the buildings stay as groups (the townsfolk read them, the
// close-up town hides some) but draw as one merged shape; hiding a building and rebuilding drops just it.
import { townShell, mergeInto } from "../src/scene.js";
const town2 = new THREE.Group();
const bs = [0, 1, 2, 3, 4, 5].map((i) => { const o = i < 3 ? house(0.4, 0x8844aa) : tree(0.7); o.position.set(Math.cos(i) * 2, 0, Math.sin(i) * 2); o.rotation.y = i; o.userData.kind = i < 3 ? "house" : "tree"; town2.add(o); mergeStatic(o); return o; });
const spray = mesh(new THREE.SphereGeometry(0.2), 0x66ccff); spray.userData.noMerge = true; town2.add(spray);
town2.scale.set(1, 0.4, 1); // mid-rise: the shell must not bake the rise in
const vAll = verts(town2) - verts(spray);
townShell(town2);
const drawn = () => { let n = 0; town2.traverse((x) => { if (x.isMesh) { let v = true; for (let p = x; p; p = p.parent) if (!p.visible) v = false; if (v) n++; } }); return n; };
const shell = () => town2.children.filter((c) => c.userData.shell);
ok(drawn() === shell().length + 1 && shell().length >= 1 && shell().length <= 2, `a town of 6 buildings draws as ${shell().length} shape(s) plus the spray (${drawn()} drawn)`);
ok(bs.every((o) => o.parent === town2 && o.visible && o.userData.size), "every building is still there, visible as a group, with its footprint");
ok(shell().reduce((a, m) => a + m.geometry.attributes.position.count, 0) === vAll, `the shape holds every building's vertices (${vAll})`);
const hiddenVerts = verts(bs[1]);
bs[1].visible = false; townShell(town2);
ok(shell().reduce((a, m) => a + m.geometry.attributes.position.count, 0) === vAll - hiddenVerts, "a house the close-up town hides drops out of the shape when it's rebuilt");
ok(town2.children.filter((c) => c.userData.shell).length === shell().length && shell().every((m) => m.parent === town2), "rebuilding replaces the old shape (no copies left behind)");

// Lamps: many glowing spheres, one shape.
const lamps = new THREE.Group(), lampMat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lampMat); m.position.set(i, 0.2, 0); lamps.add(m); }
const lb = box(lamps), lv = verts(lamps);
mergeInto(lamps, lampMat);
ok(meshes(lamps) === 1 && verts(lamps) === lv && same(lb, box(lamps)), `8 lamps become 1 shape, same place and size (${lv} vertices)`);
