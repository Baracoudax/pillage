// Prépare les personnages Quaternius (Universal Base Characters, CC0) et leurs animations
// (Universal Animation Library, CC0) pour le jeu.
// Usage : node tools/build-characters.mjs <dossier "Universal Base Characters[Standard]"> <UAL1_Standard.glb> <sortie>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, quantize, meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [kit, ual, out] = process.argv.slice(2);
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(out, { recursive: true });

// Animations utilisées par le jeu
const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Death01', 'Hit_Chest',
  'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Punch_Cross', 'Sword_Attack', 'PickUp_Table', 'Idle_Torch_Loop', 'Spell_Simple_Shoot',
];

const finish = async (doc, file, tex) => {
  await doc.transform(
    dedup(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.001 }),
    resample(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
    quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(path.join(out, file), doc);
  console.log(`${file.padEnd(16)} ${(fs.statSync(path.join(out, file)).size / 1e3).toFixed(0)} ko`);
};

// --- corps (homme / femme) : on garde la couleur de peau, on enlève normales et rugosité (mobile)
const src = path.join(kit, 'Base Characters', 'Godot - UE');
const tdir = path.join(kit, 'Base Characters', 'Textures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chars-'));
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
// noms d'images attendus par les .gltf mais absents du kit
const alias = { 'T_Hair_1_Normal_png.png': 'T_Hair_1_Normal.png', 'T_Eye_Normal_png.png': 'T_Eye_Normal.png' };
for (const [a, b] of Object.entries(alias)) if (!fs.existsSync(path.join(tmp, a))) fs.copyFileSync(path.join(src, b), path.join(tmp, a));

for (const [file, outName, skins] of [
  ['Superhero_Male_FullBody.gltf', 'male.glb', { light: 'T_Superhero_Male_Ligh.png', dark: 'T_Superhero_Male_Dark.png' }],
  ['Superhero_Female_FullBody.gltf', 'female.glb', { light: 'T_Superhero_Female_Light_BaseColor.png', dark: 'T_Superhero_Female_Dark_BaseColor.png' }],
]) {
  const doc = await io.read(path.join(tmp, file));
  const root = doc.getRoot();
  for (const m of root.listMaterials()) {
    m.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setMetallicFactor(0).setRoughnessFactor(0.8);
    if (/Superhero/.test(m.getName())) {
      m.setBaseColorTexture(doc.createTexture('skin').setImage(fs.readFileSync(path.join(tdir, skins.light))).setMimeType('image/png'));
    }
  }
  await finish(doc, outName, 512);
  // peau foncée : texture séparée, appliquée côté jeu
  await sharp(path.join(tdir, skins.dark)).resize(512, 512).webp({ quality: 80 }).toFile(path.join(out, outName.replace('.glb', '_dark.webp')));
}

// --- coiffures (« Origin at 0 » : déjà placées sur la tête en pose de référence), regroupées dans un fichier
{
  const hdir = path.join(kit, 'Hairstyles', 'Origin at 0', 'glTF (Godot)');
  const htex = path.join(kit, 'Hairstyles', 'Textures');
  const merged = new (await import('@gltf-transform/core')).Document();
  merged.createBuffer();
  const scene = merged.createScene('hair');
  const { mergeDocuments } = await import('@gltf-transform/functions');
  for (const f of ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard', 'Hair_BuzzedFemale']) {
    const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hair-'));
    for (const x of fs.readdirSync(hdir)) fs.copyFileSync(path.join(hdir, x), path.join(t2, x));
    for (const x of fs.readdirSync(htex)) if (x.endsWith('.png') && !fs.existsSync(path.join(t2, x))) fs.copyFileSync(path.join(htex, x), path.join(t2, x));
    // alias éventuels *_png.png
    for (const x of fs.readdirSync(t2)) if (x.endsWith('.png')) { const a = x.replace('.png', '_png.png'); if (!fs.existsSync(path.join(t2, a))) fs.copyFileSync(path.join(t2, x), path.join(t2, a)); }
    const d = await io.read(path.join(t2, f + '.gltf'));
    for (const n of d.getRoot().listNodes()) { n.setSkin(null); if (n.getMesh()) n.setName(f); }
    for (const m of d.getRoot().listMaterials()) m.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.9);
    const map = mergeDocuments(merged, d);
    for (const n of d.getRoot().listScenes()[0].listChildren()) scene.addChild(map.get(n));
    fs.rmSync(t2, { recursive: true, force: true });
  }
  for (const sc of merged.getRoot().listScenes()) if (sc !== scene) sc.dispose();
  for (const b of merged.getRoot().listBuffers().slice(1)) b.dispose();
  for (const a of merged.getRoot().listAccessors()) a.setBuffer(merged.getRoot().listBuffers()[0]);
  for (const sk of merged.getRoot().listSkins()) sk.dispose();
  await finish(merged, 'hair.glb', 256);
}

// --- animations : squelette + clips sélectionnés, sans maillage
{
  const doc = await io.read(ual);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (CLIPS.includes(a.getName())) continue;
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
  // doigts et translations (hors bassin) : invisibles à distance de jeu, très lourds
  for (const a of root.listAnimations()) {
    for (const ch of a.listChannels()) {
      const n = ch.getTargetNode()?.getName() || '';
      const finger = /index|middle|pinky|ring|thumb|leaf/.test(n);
      const path = ch.getTargetPath();
      if (finger || path === 'scale' || (path === 'translation' && !/pelvis|root/.test(n))) {
        const sm = ch.getSampler(), inp = sm?.getInput(), outp = sm?.getOutput();
        ch.dispose(); sm?.dispose();
        for (const acc of [inp, outp]) if (acc && acc.listParents().every((x) => x.propertyType === 'Root')) acc.dispose();
      }
    }
  }
  for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  // données orphelines des clips supprimés
  for (const acc of root.listAccessors()) if (acc.listParents().every((x) => x.propertyType === 'Root')) acc.dispose();
  await doc.transform(resample({ tolerance: 0.002 }), prune({ keepLeaves: true }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(path.join(out, 'anims.glb'), doc);
  console.log(`anims.glb        ${(fs.statSync(path.join(out, 'anims.glb')).size / 1e3).toFixed(0)} ko, ${root.listAnimations().length} clips`);
}
fs.rmSync(tmp, { recursive: true, force: true });
