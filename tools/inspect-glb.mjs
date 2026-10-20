// Affiche triangles, textures, bbox et matériaux de fichiers .glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds as bounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  const tex = root.listTextures().map((t) => `${t.getMimeType()} ${t.getSize()?.join('x')}`);
  const b = bounds(root.listScenes()[0]);
  const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  const mats = root.listMaterials().map((m) => `${m.getName()}[${m.getBaseColorTexture() ? 'C' : ''}${m.getNormalTexture() ? 'N' : ''}${m.getMetallicRoughnessTexture() ? 'MR' : ''}]`);
  console.log(`${f.split('/').pop()}: ${tris} tris, meshes ${root.listMeshes().length}, size ${size}, min ${b.min.map((v) => v.toFixed(2))}, tex ${tex.length} [${[...new Set(tex)].join(', ')}], mats ${mats.join(' ')}`);
}
