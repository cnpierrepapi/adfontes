// Citizens (SPEC §12h): Quaternius CC0 outfits wearing the free head and hair, driven by the
// Universal Animation Library, recoloured bright in code. Packed files live in /citizens/
// (scripts/pack-citizens.mjs). An outfit's skeleton is the citizen's skeleton; the head, hair and
// brows from other files are rebound onto it by bone name.
// The role sets the outfit and its colours. Everything else comes from the citizen's name: gender,
// skin tone, eye colour, hair style and colour, and the shape of the face (head proportions, jaw,
// chin, nose, cheekbones), so no two citizens share a face but every Scholar reads as a Scholar.
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
/** Night glow on the clothes and skin (live.js sets it with the theme), so citizens still read by moonlight. */
export const citizenGlow = { value: 0 };
const HAIR = { male: [["hair_simpleparted"], ["hair_buzzed"], ["hair_simpleparted", "hair_beard"], ["hair_buzzed", "hair_beard"], ["hair_simpleparted"]], female: [["hair_buns"], ["hair_long"], ["hair_long"], ["hair_buzzedfemale"]] };
// Blond, ash, golden, light brown, chestnut, dark brown, near black, auburn, copper, silver.
const HAIR_TINTS = [0xf0d27a, 0xd8c39a, 0xe0a850, 0xa0703e, 0x7a4a26, 0x4a2e1a, 0x22191a, 0x8a3a1c, 0xc8642a, 0xc8c8cc];
// Skin tones, fair to light tan (sRGB).
const SKIN = [0xf6d2bf, 0xf2c6ae, 0xedbfa2, 0xf0c7a8, 0xe6b592, 0xe3b898, 0xdcaa84, 0xd6a07a];
// Iris colours: blue, pale blue, grey, green, grey-green, hazel, amber, brown.
const EYES = [0x3f7fd0, 0x7fb2e6, 0x8a9aa8, 0x4f9a5a, 0x6f8f7a, 0x9a7a3a, 0xb0802a, 0x6a4128];

function h32(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
// Small seeded generator: each trait draws its own number, so traits don't move together.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];
const span = (r, lo, hi) => lo + (hi - lo) * r();

// Face shape, applied in the vertex shader to every mesh above the neck (head, eyes, brows, hair,
// beard) so they stay together. Positions are bind pose in metres: +Y up, +Z forward, feet at 0.
// Every face region is placed relative to the eyes (male eyes sit at 1.698, female at 1.656).
const SHAPE_GLSL = `
uniform vec4 uShapeA; // head width, head height, head depth, jaw width
uniform vec4 uShapeB; // chin drop, chin forward, nose length, cheekbones
uniform vec2 uFace;   // neck height, eye height
vec3 shapeHead(vec3 p) {
  float e = uFace.y;
  float head = smoothstep(uFace.x, uFace.x + 0.06, p.y);
  float front = smoothstep(-0.01, 0.06, p.z);
  // jaw: widen or narrow everything below the eyes, most at the jaw line
  float low = smoothstep(e - 0.015, e - 0.09, p.y) * head;
  p.x *= 1.0 + uShapeA.w * low;
  // cheekbones: out at the sides just under the eyes
  float cheek = smoothstep(0.03, 0.06, abs(p.x)) * smoothstep(e - 0.06, e - 0.03, p.y) * smoothstep(e + 0.005, e - 0.02, p.y) * front * head;
  p.x *= 1.0 + uShapeB.w * cheek;
  // chin: the front of the lower face drops and comes forward
  float chin = smoothstep(e - 0.07, e - 0.11, p.y) * front * head;
  p.y -= uShapeB.x * chin;
  p.z += uShapeB.y * chin;
  // nose: the ridge and tip come forward (longer nose) or sit back (button nose)
  float nose = (1.0 - smoothstep(0.006, 0.024, abs(p.x))) * smoothstep(e - 0.07, e - 0.05, p.y) * smoothstep(e + 0.005, e - 0.02, p.y) * smoothstep(0.075, 0.105, p.z);
  p.z += uShapeB.z * nose;
  p.y -= uShapeB.z * 0.35 * nose;
  // whole-head proportions, pivoting on the neck
  vec3 piv = vec3(0.0, uFace.x, 0.0);
  return piv + (p - piv) * mix(vec3(1.0), uShapeA.xyz, head);
}
`;

/**
 * One patched material for any part of a citizen. Options:
 *  shape: { a: Vector4, b: Vector4, face: Vector2 }  face shape (meshes above the neck)
 *  tint: [hex, amount, handX]  bright recolour of textured clothes or hair; hands past handX untouched
 *  skin: Color (linear)  skin tone; the texture's own shading and lips stay as relative detail
 *  eye: Color (linear)   iris colour
 *  cut: neck height      keep only the head of the base body
 */
function patch(mat, o) {
  mat = mat.clone();
  mat.onBeforeCompile = (sh) => {
    const U = sh.uniforms;
    U.uGlow = citizenGlow;
    let vHead = "varying vec3 vBind;\n", vMain = " vBind = position;";
    if (o.shape) {
      Object.assign(U, { uShapeA: { value: o.shape.a }, uShapeB: { value: o.shape.b }, uFace: { value: o.shape.face } });
      vHead += SHAPE_GLSL;
      vMain += "\n transformed = shapeHead(transformed);";
    }
    sh.vertexShader = vHead + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + vMain);
    let fHead = "uniform float uGlow; varying vec3 vBind;\n", fMain = "", fGlow = "";
    if (o.cut != null) {
      U.uCut = { value: o.cut };
      fHead += "uniform float uCut;\n";
      sh.fragmentShader = sh.fragmentShader.replace("void main() {", "void main() {\n if (vBind.y < uCut || (abs(vBind.x) > 0.075 && vBind.y < uCut + 0.13)) discard;");
    }
    if (o.tint) {
      Object.assign(U, { uTint: { value: new THREE.Color(o.tint[0]) }, uAmt: { value: o.tint[1] }, uHand: { value: o.tint[2] } });
      fHead += "uniform vec3 uTint; uniform float uAmt, uHand;\n";
      fMain += `
       float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       float k = uAmt * (1.0 - step(uHand, abs(vBind.x)));
       diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.78 + lum * 0.5), k);
       // past the wrist: dark leather gloves become light tan leather (bare skin there is left alone)
       float glove = step(uHand, abs(vBind.x)) * step(uHand, 50.0) * (1.0 - smoothstep(0.12, 0.2, lum));
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.42, 0.25) * (0.7 + lum * 2.5), glove);`;
      fGlow += "\n totalEmissiveRadiance += uTint * uGlow * uAmt * (1.0 - step(uHand, abs(vBind.x)));";
    }
    if (o.skin) {
      U.uSkin = { value: o.skin };
      fHead += "uniform vec3 uSkin;\n";
      // The source skin texture's typical colour (linear); each texel's ratio to it is kept as
      // detail (shading, lips, brows), toned down so the new skin tone decides the colour.
      fMain += `
       vec3 sr = clamp(diffuseColor.rgb / vec3(0.397, 0.168, 0.080), 0.35, 1.6);
       sr = mix(vec3(dot(sr, vec3(0.3333))), sr, 0.5);
       diffuseColor.rgb = uSkin * sr;`;
      fGlow += "\n totalEmissiveRadiance += uSkin * uGlow * 0.55;";
    }
    if (o.eye) {
      U.uEye = { value: o.eye };
      fHead += "uniform vec3 uEye;\n";
      fMain += `
       float el = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       float es = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
       float iris = smoothstep(0.03, 0.1, es) * (1.0 - smoothstep(0.45, 0.7, el));
       diffuseColor.rgb = mix(diffuseColor.rgb, uEye * (0.6 + el * 2.0), iris);`;
      fGlow += "\n totalEmissiveRadiance += vec3(uGlow * 0.25);";
    }
    sh.fragmentShader = fHead + sh.fragmentShader
      .replace("#include <map_fragment>", "#include <map_fragment>" + fMain)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>" + fGlow);
  };
  // Programs are shared by every citizen with the same options; colours and shapes are uniforms.
  const key = `cit|${o.shape ? "s" : ""}|${o.cut != null ? "c" : ""}|${o.tint ? "t" : ""}|${o.skin ? "k" : ""}|${o.eye ? "e" : ""}`;
  mat.customProgramCacheKey = () => key;
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
      eyeY: g === "male" ? 1.698 : 1.656, // measured from the source meshes
    };
  }
  return { G, hair, clips, dims };
}

/** The look a name gives a citizen (deterministic). Exported for the lab. */
export function looksFor(name) {
  const h = h32(name);
  const r = rng(h);
  const female = (h & 1) === 1;
  return {
    female,
    hair: pick(r, HAIR[female ? "female" : "male"]),
    hairTint: pick(r, HAIR_TINTS),
    skin: pick(r, SKIN),
    eye: pick(r, EYES),
    // head width, height, depth, jaw; chin drop, chin forward, nose, cheekbones
    a: [span(r, 0.9, 1.08), span(r, 0.94, 1.07), span(r, 0.94, 1.06), span(r, -0.16, 0.22)],
    b: [span(r, -0.008, 0.018), span(r, -0.008, 0.016), span(r, -0.01, 0.016), span(r, -0.08, 0.16)],
  };
}

/**
 * Make one citizen. Returns { root, mixer, play(name, fade), role, female }.
 * The root is ~1.8 units tall at scale 1; the caller scales it to the island.
 */
export async function makeCitizen(kit, roleName, name) {
  const role = ROLES[roleName] ?? ROLES.Scholar;
  const L = looksFor(name || roleName);
  const g = L.female ? "female" : "male";
  const root = clone(kit.G[`${g}_${role.outfit}`].scene);
  if (role.hood === false) { const drop = []; root.traverse((o) => o.isMesh && o.name.includes("Hood") && drop.push(o)); drop.forEach((o) => o.removeFromParent()); }
  const { neckY, handX, eyeY } = kit.dims[g];
  const shape = { a: new THREE.Vector4(...L.a), b: new THREE.Vector4(...L.b), face: new THREE.Vector2(neckY, eyeY) };
  const skin = new THREE.Color(L.skin); // Color() converts the sRGB hex to linear
  const eye = new THREE.Color(L.eye);
  attach(root, kit.G[`head_${g}`], (m) => {
    const n = m.material.name;
    if (/^MI_Hair/.test(n)) return null;
    if (/^MI_Eye/.test(n)) return patch(m.material, { shape, eye });
    if (m.geometry.attributes.position.count > 3000) return patch(m.material, { shape, cut: neckY - 0.02, skin });
    return patch(m.material, { shape });
  });
  const hairs = L.hair.concat(L.female ? "eyebrows_female" : "eyebrows_regular");
  const hooded = role.hood !== false && role.outfit === "ranger";
  for (const n of hairs) {
    if (hooded && n.startsWith("hair_") && n !== "hair_beard") continue; // hair under the hood would poke through
    attach(root, await kit.hair(n), (m) => patch(m.material, { shape, tint: [L.hairTint, 0.9, 99] }));
  }
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false; // skinned bounds lag the pose; tiny cost
    const n = o.material?.name || "";
    if (!n || /^MI_(Superhero|Hair|Eye)/.test(n) || o.material.customProgramCacheKey?.().startsWith("cit|")) return;
    if (/^MI_Regular/.test(n)) { o.material = patch(o.material, { skin }); return; } // the outfit's own skin (hands, neck)
    const part = Object.keys(role.tints).find((k) => o.name.includes(k));
    if (part) o.material = patch(o.material, { tint: [role.tints[part], 0.95, handX] });
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
  return { root, mixer, play, role: roleName, female: L.female };
}
