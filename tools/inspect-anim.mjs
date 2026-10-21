// Liste animations, os et maillages d'un glTF/GLB (personnages riggés)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const r = doc.getRoot();
  console.log('==', f.split('/').pop());
  console.log('  anims', r.listAnimations().length + ':', r.listAnimations().map((a) => a.getName()).join(', '));
  const skins = r.listSkins();
  console.log('  skins', skins.length, 'joints', skins[0]?.listJoints().length, skins[0]?.listJoints().slice(0, 70).map((j) => j.getName()).join(','));
  for (const m of r.listMeshes()) {
    let t = 0; for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() || 0) / 3;
    console.log('  mesh', m.getName(), Math.round(t), 'tris', m.listPrimitives().map((p) => p.getMaterial()?.getName()).join('/'));
  }
  console.log('  textures', r.listTextures().map((t) => `${t.getName() || t.getURI()} ${t.getSize()?.join('x')}`).join(' | '));
}
