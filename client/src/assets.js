// Chargement des modèles .glb (compressés meshopt + textures WebP), avec cache.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const BASE = import.meta.env.BASE_URL + 'models/';

// Modèles générés par le code (pas de fichier à télécharger)
const PROC = {
  mortier() {
    // tube de mortier d'artifice en carton, bouche vers -Z
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#f1c40f'; for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 64, 12);
    g.fillStyle = '#2c3e50'; g.fillRect(0, 56, 64, 6);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const grp = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.52, 14, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
    tube.rotation.x = Math.PI / 2; tube.position.z = -0.17;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    inner.position.z = -0.4;
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.055, 14), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }));
    cap.rotation.y = Math.PI; cap.position.z = 0.09;
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 4), new THREE.MeshBasicMaterial({ color: 0x33aa33 }));
    fuse.position.set(0, 0.07, 0.04); fuse.rotation.x = -0.6;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.05), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
    grip.position.set(0, -0.09, 0.0);
    grp.add(tube, inner, cap, fuse, grip);
    return grp;
  },
  pierre() {
    const geo = new THREE.DodecahedronGeometry(0.075, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.8 + ((i * 7) % 5) * 0.08), pos.getY(i) * 0.75, pos.getZ(i) * (0.85 + ((i * 3) % 4) * 0.07));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1, flatShading: true }));
  },
};

// Retourne { scene, box } ; box = boîte englobante en coordonnées du modèle.
export function loadModel(path) {
  if (!cache.has(path) && path.startsWith('proc/')) {
    const scene = PROC[path.slice(5)]();
    const res = { scene, box: new THREE.Box3().setFromObject(scene) };
    cache.set(path, { promise: Promise.resolve(res), value: res });
  }
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

export function weaponPath(model) { return model; }
