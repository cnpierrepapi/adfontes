// Dialogue boxes (his call 11 Nov): when a citizen talks to you, they appear the way an RPG character
// does: their own 3D figure from the chest up on the left, their name and role, and one or two short
// lines at a time. Tap, click or press space (or Enter) for the next box; the last one closes it.
// Only real words are shown: what a citizen said about a whisper, a report on another citizen, a
// Patron's reason at the war council. Nothing here is written by the page.
import * as THREE from "three";
import { loadCitizenKit, makeCitizen, ROLES } from "./citizens.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };

/** Splits a reply into short boxes: whole sentences, about 110 characters each at most. */
export function boxes(text, max = 110) {
  const sentences = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
  const out = [];
  for (let s of sentences.map((x) => x.trim()).filter(Boolean)) {
    while (s.length > max) { // one very long sentence: break at the last space before the limit
      const cut = s.lastIndexOf(" ", max);
      out.push(s.slice(0, cut > 40 ? cut : max).trim() + "…");
      s = s.slice(cut > 40 ? cut : max).trim();
    }
    if (out.length && (out[out.length - 1] + " " + s).length <= max && !out[out.length - 1].endsWith("…")) out[out.length - 1] += " " + s;
    else out.push(s);
  }
  return out;
}

export function createDialogue() {
  const portrait = el("canvas", { className: "dlg-face", width: 220, height: 240 });
  const who = el("b", { className: "dlg-who" });
  const tag = el("span", { className: "dlg-tag" });
  const text = el("p", { className: "dlg-text" });
  const more = el("span", { className: "dlg-more", textContent: "▸" });
  const box = el("div", { className: "dlg", role: "dialog", hidden: true }, portrait, el("div", { className: "dlg-body" }, el("div", { className: "dlg-head" }, who, tag), text, more));
  document.body.append(box);

  // The portrait: a small scene of its own (the world's camera is far away; this one is a close-up).
  let renderer = null, scene, camera, kitP = null, current = null, mixer = null, clock = new THREE.Clock(), raf = 0;
  function setup() {
    renderer = new THREE.WebGLRenderer({ canvas: portrait, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(portrait.width, portrait.height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a8a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-1.2, 2.4, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc27a, 1.4); rim.position.set(1.5, 2, -1.5); scene.add(rim);
    camera = new THREE.PerspectiveCamera(24, portrait.width / portrait.height, 0.1, 20);
  }
  async function showFace(name, role) {
    if (!renderer) setup();
    kitP ??= loadCitizenKit();
    const kit = await kitP;
    if (current) { scene.remove(current); current = null; mixer = null; }
    const c = await makeCitizen(kit, ROLES[role] ? role : "Scholar", name);
    current = c.root; mixer = c.mixer;
    c.play?.("Idle_Talking_Loop");
    scene.add(current);
    // Chest up: the eyes sit about 1.7 high on a 1.8-tall citizen.
    camera.position.set(0.14, 1.6, 1.08); camera.lookAt(0, 1.55, 0);
    if (!raf) loop();
  }
  function loop() {
    raf = requestAnimationFrame(loop);
    if (box.hidden) { cancelAnimationFrame(raf); raf = 0; return; }
    mixer?.update(clock.getDelta());
    renderer?.render(scene, camera);
  }

  // The queue: one speaker at a time, one box at a time.
  const queue = [], seen = new Set();
  let lines = [], at = 0, onDone = null;
  function next() {
    if (at < lines.length - 1) { at++; text.textContent = lines[at]; more.textContent = at < lines.length - 1 ? "▸" : "✓"; return; }
    onDone?.(); onDone = null;
    if (queue.length) return open(queue.shift());
    box.hidden = true;
  }
  function open(d) {
    lines = boxes(d.text); at = 0;
    if (!lines.length) return next();
    who.textContent = d.name;
    tag.textContent = [d.role, d.nation, d.badge].filter(Boolean).join(" · ");
    text.textContent = lines[0];
    more.textContent = lines.length > 1 ? "▸" : "✓";
    box.hidden = false;
    box.classList.remove("in"); void box.offsetWidth; box.classList.add("in");
    onDone = d.onDone || null;
    showFace(d.name, d.role).catch(() => {});
  }
  box.addEventListener("click", next);
  addEventListener("keydown", (e) => {
    if (box.hidden || !(e.key === " " || e.key === "Enter")) return;
    if (/input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
    e.preventDefault(); next();
  });

  /** Someone says something to you. d = { key, name, role, nation, text, badge }. Repeats (same key) are skipped. */
  function say(d) {
    if (!d?.text || (d.key && seen.has(d.key))) return;
    if (d.key) seen.add(d.key);
    if (box.hidden) open(d); else if (queue.length < 6) queue.push(d);
  }
  return { say, busy: () => !box.hidden };
}
