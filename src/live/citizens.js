// Citizens (SPEC §12h): Quaternius CC0 outfits wearing the free head and hair, driven by the
// Universal Animation Library, recoloured bright in code. Packed files live in /citizens/
// (scripts/pack-citizens.mjs). An outfit's skeleton is the citizen's skeleton; the head, hair and
// brows from other files are rebound onto it by bone name.
// The role sets the outfit and its colours; gender, hair and hair colour come from the citizen's
// name, so two Scholars never look the same but every Scholar reads as a Scholar.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

// Brightest shade of each role's colours (his call, 7 Nov). Keys match outfit mesh names.
export const ROLES = {
  Patron: { outfit: "ranger", hood: false, tints: { Body: 0xffcc00, Arms: 0xffcc00, Legs: 0xfff4d6, Pauldron: 0xffffff, Belt: 0xffaa00, Bracer: 0xffffff }, work: "Idle_Talking_Loop", dot: 0xffcc00 },
  Scholar: { outfit: "peasant", tints: { Body: 0x00c3ff, Arms: 0xf2fcff, Legs: 0xffffff }, work: "Interact", dot: 0x00c3ff },
  Smith: { outfit: "peasant", tints: { Body: 0xff5a36, Arms: 0xff5a36, Legs: 0xffe9b0 }, work: "Fixing_Kneeling", dot: 0xff5a36 },
  Drafter: { outfit: "peasant", tints: { Body: 0xb86cff, Arms: 0xb86cff, Legs: 0xfff4d6 }, work: "Sitting_Idle_Loop", dot: 0xb86cff },
  Broker: { outfit: "ranger", hood: false, tints: { Body: 0x00f0b0, Arms: 0x00f0b0, Legs: 0xff5cb0, Pauldron: 0xffd400, Belt: 0xff5cb0, Bracer: 0xffd400 }, work: "Idle_Talking_Loop", dot: 0x00f0b0 },
  Warden: { outfit: "ranger", tints: { Body: 0xffffff, Arms: 0xffffff, Legs: 0xff1f6e, Pauldron: 0xffd400, Hood: 0xffffff, Belt: 0xff1f6e, Bracer: 0xffd400 }, work: "Idle_Loop", dot: 0xffffff },
  Trickster: { outfit: "ranger", tints: { Body: 0xff1fae, Arms: 0xff1fae, Legs: 0xb6ff1f, Pauldron: 0xb6ff1f, Hood: 0xff1fae, Belt: 0xb6ff1f, Bracer: 0xb6ff1f }, work: "Jog_Fwd_Loop", dot: 0xff1fae },
};
const HAIR = { male: [["hair_simpleparted"], ["hair_buzzed"], ["hair_simpleparted", "hair_beard"], ["hair_buzzed", "hair_beard"]], female: [["hair_buns"], ["hair_long"], ["hair_buzzedfemale"]] };
const HAIR_TINTS = [0x2a1a14, 0x3a2618, 0x5a3a22, 0x8a3a1c, 0xc98a3a, 0xe8b85a, 0x1a1a22];

function h32(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

// Recolour textured clothes toward a bright colour; the fabric's shading stays as a gentle ripple.
// Hands (past the wrist in bind pose) are never tinted.
function brighten(mat, hex, amt, handX) {
  mat = mat.clone();
  const col = new THREE.Color(hex);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTint: { value: col }, uAmt: { value: amt }, uHand: { value: handX } });
    sh.vertexShader = "varying vec3 vBind;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vBind = position;");
    sh.fragmentShader = "uniform vec3 uTint; uniform float uAmt, uHand; varying vec3 vBind;\n" + sh.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       float k = uAmt * (1.0 - step(uHand, abs(vBind.x)));
       diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.78 + lum * 0.5), k);`,
    );
  };
  mat.customProgramCacheKey = () => `tint${hex}|${amt}|${handX}`;
  return mat;
}

// The free base body is used for its head only: cut below the neck and beside it (the Superhero
// trapezius sits higher than the outfit's collar), by bind-pose position.
function headOnly(mat, cutY) {
  mat = mat.clone();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCut = { value: cutY };
    sh.vertexShader = "varying float vBindY, vBindX;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vBindY = position.y; vBindX = position.x;");
    sh.fragmentShader = "uniform float uCut; varying float vBindY, vBindX;\n" + sh.fragmentShader.replace("void main() {", "void main() {\n if (vBindY < uCut || (abs(vBindX) > 0.075 && vBindY < uCut + 0.13)) discard;");
  };
  mat.customProgramCacheKey = () => `head${cutY}`;
  return mat;
}

function bonesByName(root) { const m = {}; root.traverse((o) => o.isBone && (m[o.name] = o)); return m; }

// Rebind another file's skinned meshes onto `root`'s skeleton (same bone names).
function attach(root, gltf, fix) {
  const bones = bonesByName(root);
  const meshes = [];
  gltf.scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
  for (const m0 of meshes) {
    const m = m0.clone();
    if (fix) { const mat = fix(m); if (!mat) continue; m.material = mat; } // null = leave this mesh out
    const skel = new THREE.Skeleton(m0.skeleton.bones.map((b) => bones[b.name]), m0.skeleton.boneInverses);
    root.add(m);
    m.bind(skel, m0.bindMatrix);
  }
}

/** Load the shared parts once (about 5.6 MB). Hair loads as needed. */
export async function loadCitizenKit(base = "/citizens/") {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (f) => loader.loadAsync(base + f + ".glb");
  const names = ["anims", "male_peasant", "female_peasant", "male_ranger", "female_ranger", "head_male", "head_female"];
  const G = {};
  for (const n of names) G[n] = await load(n); // one at a time keeps a busy page responsive
  const hairCache = {};
  const hair = (n) => (hairCache[n] ??= load(n));
  const clips = Object.fromEntries(G.anims.animations.map((a) => [a.name, a]));
  // Neck height and wrist width from each base body's bind pose.
  const dims = {};
  for (const g of ["male", "female"]) {
    const s = G[`head_${g}`].scene, b = bonesByName(s);
    s.updateMatrixWorld(true);
    dims[g] = {
      neckY: new THREE.Vector3().setFromMatrixPosition(b.neck_01.matrixWorld).y,
      handX: Math.abs(new THREE.Vector3().setFromMatrixPosition(b.hand_l.matrixWorld).x) + 0.02,
    };
  }
  return { G, hair, clips, dims };
}

/**
 * Make one citizen. Returns { root, mixer, play(name, fade), role, female }.
 * The root is ~1.8 units tall at scale 1; the caller scales it to the island.
 */
export async function makeCitizen(kit, roleName, name) {
  const role = ROLES[roleName] ?? ROLES.Scholar;
  const h = h32(name || roleName);
  const female = (h & 1) === 1;
  const g = female ? "female" : "male";
  const root = clone(kit.G[`${g}_${role.outfit}`].scene);
  if (role.hood === false) { const drop = []; root.traverse((o) => o.isMesh && o.name.includes("Hood") && drop.push(o)); drop.forEach((o) => o.removeFromParent()); }
  const { neckY, handX } = kit.dims[g];
  attach(root, kit.G[`head_${g}`], (m) => (m.geometry.attributes.position.count > 3000 ? headOnly(m.material, neckY - 0.02) : /^MI_Hair/.test(m.material.name) ? null : m.material));
  const hairs = HAIR[g][(h >>> 3) % HAIR[g].length].concat(female ? "eyebrows_female" : "eyebrows_regular");
  const hairTint = HAIR_TINTS[(h >>> 7) % HAIR_TINTS.length];
  const hooded = role.hood !== false && role.outfit === "ranger";
  for (const n of hairs) {
    if (hooded && n.startsWith("hair_") && n !== "hair_beard") continue; // hair under the hood would poke through
    attach(root, await kit.hair(n), (m) => brighten(m.material, hairTint, 0.9, 99));
  }
  root.traverse((o) => {
    const n = o.material?.name || "";
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } // skinned bounds lag the pose; tiny cost
    if (!o.isMesh || !n || /^MI_(Superhero|Hair|Eye|Regular)/.test(n)) return;
    const part = Object.keys(role.tints).find((k) => o.name.includes(k));
    if (part) o.material = brighten(o.material, role.tints[part], 0.95, handX);
  });
  const mixer = new THREE.AnimationMixer(root);
  let current = null;
  function play(clipName, fade = 0.35) {
    const clip = kit.clips[clipName];
    if (!clip) return null;
    const next = mixer.clipAction(clip);
    if (current === next) return next;
    next.reset().fadeIn(fade).play();
    current?.fadeOut(fade);
    current = next;
    return next;
  }
  return { root, mixer, play, role: roleName, female };
}
