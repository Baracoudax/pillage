// Liste les nœuds (nom, bbox) d'un .glb
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  console.log(f.split('/').pop());
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getMesh()) continue;
    const b = getBounds(n);
    console.log(`  ${n.getName().padEnd(24)} min ${b.min.map((v) => v.toFixed(2))} max ${b.max.map((v) => v.toFixed(2))}`);
  }
}
