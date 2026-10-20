// Chargement des modèles .glb (compressés meshopt + textures WebP), avec cache.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const BASE = import.meta.env.BASE_URL + 'models/';

// Retourne { scene, box } ; box = boîte englobante en coordonnées du modèle.
export function loadModel(path) {
  if (!cache.has(path)) {
    const p = loader.loadAsync(BASE + path + '.glb').then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
      });
      const box = new THREE.Box3().setFromObject(g.scene);
      const res = { scene: g.scene, box };
      cache.get(path).value = res;
      return res;
    }).catch((e) => { console.warn('modèle introuvable', path, e); return null; });
    cache.set(path, { promise: p, value: null });
  }
  return cache.get(path).promise;
}

export function getModel(path) { return cache.get(path)?.value || null; }

export function weaponPath(model) { return 'weapons/' + model; }
