// Dev-only lab: the seven roles built by the real runtime module (src/live/citizens.js) from the
// PACKED files in /citizens/, so what this shows is what the site will load.
import * as THREE from "three";
import { loadCitizenKit, makeCitizen, ROLES } from "../live/citizens.js";

const log = (s) => (document.getElementById("log").textContent += s + "\n");
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd8e8);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0xffd9b0, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
sun.position.set(-2, 4, 3);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshLambertMaterial({ color: 0x9ff3e0 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const t0 = performance.now();
const kit = await loadCitizenKit();
log(`kit loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s, clips: ${Object.keys(kit.clips).length}`);
const q = new URLSearchParams(location.search);
const names = (q.get("names") || "Ada Okafor,Wren Sato,Mira Duarte,Kemi Nakamura,Ilse Castell,Viggo Lindqvist,Zora Ulloa").split(",");
const roles = Object.keys(ROLES);
const XS = roles.map((_, i) => (i - (roles.length - 1) / 2) * 1.25);
const mixers = [], labels = [];
for (let i = 0; i < roles.length; i++) {
  const c = await makeCitizen(kit, roles[i], names[i]);
  c.root.position.x = XS[i];
  scene.add(c.root);
  c.play(ROLES[roles[i]].work, 0);
  mixers.push(c.mixer);
  const el = document.createElement("div");
  el.textContent = `${roles[i]} · ${names[i]}`;
  el.style.cssText = "position:fixed;transform:translate(-50%,0);font:600 13px Arial;color:#1d1430;background:rgba(255,255,255,.85);padding:4px 9px;border-radius:10px;white-space:nowrap";
  document.body.append(el);
  labels.push({ el, x: XS[i] });
}
log("citizens: " + roles.length);
camera.position.set(0, 1.3, 13);
camera.lookAt(0, 0.95, 0);
const close = q.get("close");
if (close != null) { const x = XS[+close]; camera.position.set(x, 1.65, 1.6); camera.lookAt(x, 1.55, 0); }
const tmp = new THREE.Vector3();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const m of mixers) m.update(dt);
  renderer.render(scene, camera);
  for (const l of labels) {
    tmp.set(l.x, 0.05, 0.6).project(camera);
    Object.assign(l.el.style, { left: `${(tmp.x + 1) / 2 * innerWidth}px`, top: `${(1 - tmp.y) / 2 * innerHeight}px`, display: close != null ? "none" : "" });
  }
});
window.__lab = { scene, camera, kit };
