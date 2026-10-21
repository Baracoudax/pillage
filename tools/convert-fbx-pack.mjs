// Convertit un pack FBX (un sous-dossier par modèle + textures PNG à côté) en .glb texturés.
// Usage : node tools/convert-fbx-pack.mjs <FBX2glTF> <dossier_pack> <dossier_sortie>
// La texture de couleur (*Base_Color* / *BaseMap*) est réappliquée sur tous les matériaux du modèle ;
// les cartes de rugosité / métal / normales sont ignorées (inutiles en éclairage mobile simple).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [bin, src, out] = process.argv.slice(2);
if (!bin || !src || !out) { console.error('usage: convert-fbx-pack.mjs <FBX2glTF> <pack> <out>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-'));

for (const dir of fs.readdirSync(src)) {
  const d = path.join(src, dir);
  if (!fs.statSync(d).isDirectory()) continue;
  const fbx = fs.readdirSync(d).find((f) => f.toLowerCase().endsWith('.fbx'));
  if (!fbx) { console.log(`  (ignoré, pas de FBX) ${dir}`); continue; }
  const name = path.basename(fbx, path.extname(fbx)).replace(/[^\w-]/g, '_');
  const glb = path.join(tmp, name + '.glb');
  try {
    execFileSync(bin, ['--binary', '--input', path.join(d, fbx), '--output', path.join(tmp, name)], { stdio: 'pipe' });
  } catch (e) { console.log(`  ÉCHEC ${dir}: ${String(e.stderr || e).slice(0, 200)}`); continue; }
  const doc = await io.read(glb);
  const root = doc.getRoot();
  for (const t of root.listTextures()) t.dispose();
  const colorFile = fs.readdirSync(d).find((f) => /base_?colou?r|basemap|albedo|diffuse/i.test(f) && /\.(png|jpe?g)$/i.test(f));
  let tex = null;
  if (colorFile) {
    tex = doc.createTexture(name + '_color').setImage(fs.readFileSync(path.join(d, colorFile))).setMimeType(colorFile.endsWith('.png') ? 'image/png' : 'image/jpeg');
  }
  const hasMetal = fs.readdirSync(d).some((f) => /metal/i.test(f));
  for (const m of root.listMaterials()) {
    m.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.75).setMetallicFactor(hasMetal ? 0.3 : 0);
    m.setBaseColorTexture(tex).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
  }
  await io.write(path.join(out, name + '.glb'), doc);
  console.log(`  ${name}${colorFile ? '' : ' (sans texture)'}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
