// Pack the Quaternius CC0 citizen parts for the web (SPEC §12h): every part becomes ONE .glb
// (no separate .bin files), textures 512px WebP, meshes meshopt-compressed losslessly (not quantized: see below), and the animation
// library cut to the clips the game uses (its mesh dropped, the skeleton kept).
// Usage: node scripts/pack-citizens.mjs <assetsRoot>   (default C:/Users/user/adf-assets)
// Output: public/citizens/*.glb + CREDITS.txt
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, resample, textureCompress, reorder, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const ROOT = process.argv[2] || "C:/Users/user/adf-assets";
const OUT = "public/citizens";
const SRC = {
  outfits: `${ROOT}/outfits/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits`,
  base: `${ROOT}/ubc/Universal Base Characters[Standard]/Base Characters/Godot - UE`,
  hair: `${ROOT}/ubc/Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)`,
  anims: `${ROOT}/anims/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb`,
};
// Clips the game plays (see SPEC §12h): walking, idling, each role's work, the star-gun, rulings.
const KEEP = ["Idle_Loop", "Walk_Loop", "Walk_Formal_Loop", "Idle_Talking_Loop", "Fixing_Kneeling", "Interact",
  "Pistol_Aim_Up", "Pistol_Shoot", "Dance_Loop", "Hit_Chest", "Death01", "Jog_Fwd_Loop", "Sitting_Idle_Loop"];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
fs.mkdirSync(OUT, { recursive: true });

// Some files point at "X_png.png" textures that ship as "X.png": read the JSON ourselves and
// fix (or drop) any image whose file is missing, so one bad path never sinks a part.
async function readFixed(file) {
  if (file.endsWith(".glb")) return io.read(file);
  const dir = path.dirname(file);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const resources = {};
  for (const b of json.buffers || []) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(dir, b.uri)));
  for (const img of json.images || []) {
    if (!img.uri) continue;
    let p = path.join(dir, img.uri);
    if (!fs.existsSync(p)) {
      const alt = path.join(dir, img.uri.replace(/_png\.png$/, ".png"));
      if (fs.existsSync(alt)) { img.uri = path.basename(alt); p = alt; }
    }
    if (fs.existsSync(p)) resources[img.uri] = new Uint8Array(fs.readFileSync(p));
    else { console.log(`  (dropping missing image ${img.uri})`); img.uri = undefined; img.mimeType = "image/png"; img.bufferView = undefined; }
  }
  // Drop textures that point at images we could not find.
  const bad = new Set((json.images || []).map((im, i) => (im.uri ? -1 : i)).filter((i) => i >= 0));
  const badTex = new Set((json.textures || []).map((t, i) => (bad.has(t.source) ? i : -1)).filter((i) => i >= 0));
  for (const m of json.materials || []) for (const k of ["normalTexture", "occlusionTexture", "emissiveTexture"]) if (m[k] && badTex.has(m[k].index)) delete m[k];
  for (const m of json.materials || []) { const pbr = m.pbrMetallicRoughness; if (pbr) for (const k of ["baseColorTexture", "metallicRoughnessTexture"]) if (pbr[k] && badTex.has(pbr[k].index)) delete pbr[k]; }
  json.images = (json.images || []).map((im) => (im.uri ? im : { name: im.name, uri: "missing.png" }));
  resources["missing.png"] = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#8080ff" } }).png().toBuffer());
  return io.readJSON({ json, resources });
}

async function pack(src, out, { animsOnly = false } = {}) {
  const doc = await readFixed(src);
  if (animsOnly) {
    for (const a of doc.getRoot().listAnimations()) if (!KEEP.includes(a.getName())) a.dispose();
    for (const m of doc.getRoot().listMeshes()) m.dispose(); // clips only; the skeleton nodes stay
  }
  await doc.transform(
    dedup(),
    ...(animsOnly ? [resample()] : [weld()]),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 82 }),
    reorder({ encoder: MeshoptEncoder }),
  );
  // Lossless meshopt compression only. NO quantization: the citizens' shaders read bind-pose
  // positions in metres (neck cut, hand mask), and quantized positions are rescaled integers.
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(`${OUT}/${out}`, doc);
  const kb = (fs.statSync(`${OUT}/${out}`).size / 1024).toFixed(0);
  const before = (fs.statSync(src).size / 1024).toFixed(0);
  console.log(`${out.padEnd(26)} ${kb.padStart(6)} KB${animsOnly ? `, clips: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(" ")}` : ""}`);
}

for (const o of ["Male_Peasant", "Female_Peasant", "Male_Ranger", "Female_Ranger"]) await pack(`${SRC.outfits}/${o}.gltf`, `${o.toLowerCase()}.glb`);
await pack(`${SRC.base}/Superhero_Male_FullBody.gltf`, "head_male.glb");
await pack(`${SRC.base}/Superhero_Female_FullBody.gltf`, "head_female.glb");
for (const h of ["Hair_SimpleParted", "Hair_Beard", "Hair_Buzzed", "Hair_BuzzedFemale", "Hair_Buns", "Hair_Long", "Eyebrows_Regular", "Eyebrows_Female"]) await pack(`${SRC.hair}/${h}.gltf`, `${h.toLowerCase()}.glb`);
await pack(SRC.anims, "anims.glb", { animsOnly: true });

fs.writeFileSync(`${OUT}/CREDITS.txt`, `Citizens of the AD FONTES live world. All CC0 (public domain) by Quaternius (quaternius.com):
Universal Base Characters (heads, hair), Modular Character Outfits - Fantasy (peasant, ranger),
Universal Animation Library (clips). Packed by scripts/pack-citizens.mjs (512px WebP, meshopt).
`);
const total = fs.readdirSync(OUT).filter((f) => f.endsWith(".glb")).reduce((a, f) => a + fs.statSync(`${OUT}/${f}`).size, 0);
console.log(`TOTAL ${(total / 1048576).toFixed(2)} MB`);
