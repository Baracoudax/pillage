// Optimise les .glb sources pour le web/mobile :
//   textures redimensionnées + WebP, fusion des meshes, soudure, quantification, compression meshopt.
// Usage : node tools/optimize-assets.mjs <dossier_source> <dossier_sortie> [nom=taille_texture ...]
//   ex. node tools/optimize-assets.mjs ~/raw/guns client/public/models/weapons AK47=1024
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, flatten, quantize, textureCompress, resample, simplify, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, out, ...overrides] = process.argv.slice(2);
if (!src || !out) { console.error('usage: optimize-assets.mjs <src> <out> [name=texSize]'); process.exit(1); }
const sizes = Object.fromEntries(overrides.map((o) => o.split('=')).map(([k, v]) => [k, Number(v)]));
const DEFAULT_TEX = Number(process.env.TEX || 512);
// Corrections par modèle : pièces mal placées à retirer, orientation (le jeu attend l'avant vers -Z)
const FIXES = {
  Makarov: { remove: ['Magazine'] },
  Luger: { remove: ['Clip'], rotateY: 180 },
  // armes de mêlée : manche vers le bas, tête vers +Y
  Crowbar: { rotateX: -90 },
};

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.toLowerCase().endsWith('.glb')) files.push(p);
  }
})(src);

fs.mkdirSync(out, { recursive: true });
let tin = 0, tout = 0;
for (const f of files.sort()) {
  const name = path.basename(f, '.glb');
  const tex = sizes[name] ?? DEFAULT_TEX;
  const doc = await io.read(f);
  const fix = FIXES[name];
  if (fix?.remove) for (const n of doc.getRoot().listNodes()) if (fix.remove.includes(n.getName())) n.dispose();
  if (fix?.rotateY || fix?.rotateX) {
    const scene = doc.getRoot().listScenes()[0];
    const a = ((fix.rotateY || fix.rotateX) * Math.PI) / 360;
    const pivot = doc.createNode('pivot').setRotation(fix.rotateY ? [0, Math.sin(a), 0, Math.cos(a)] : [Math.sin(a), 0, 0, Math.cos(a)]);
    for (const c of scene.listChildren()) { scene.removeChild(c); pivot.addChild(c); }
    scene.addChild(pivot);
  }
  await doc.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.85, error: 0.0004 }),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dst = path.join(out, name + '.glb');
  await io.write(dst, doc);
  const a = fs.statSync(f).size, b = fs.statSync(dst).size;
  tin += a; tout += b;
  console.log(`${name.padEnd(18)} ${(a / 1e6).toFixed(2).padStart(6)} Mo -> ${(b / 1e3).toFixed(0).padStart(5)} ko  (tex ${tex})`);
}
console.log(`TOTAL ${(tin / 1e6).toFixed(1)} Mo -> ${(tout / 1e6).toFixed(2)} Mo`);
void EXTMeshoptCompression;
