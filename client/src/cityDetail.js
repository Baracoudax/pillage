// Détails du quartier : véhicules, débris, vitrines brisées, rideaux métalliques, tags, mobilier des magasins.
// Tout est instancié ou fusionné (quelques draw calls), rien n'est simulé : purement visuel et déterministe.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOT, WALL_H, WALL_T, DOOR_W } from '../../shared/map.js';
import { mulberry32 } from '../../shared/rng.js';
import { getModel } from './assets.js';

const CARS = ['cars/sedan', 'cars/suv', 'cars/taxi', 'cars/hatchback-sports', 'cars/van', 'cars/delivery', 'cars/sedan', 'cars/suv'];
const DEBRIS = ['cars/debris-tire', 'cars/debris-door', 'cars/debris-bumper', 'street/barrel', 'street/box-large', 'shop/cardboardBoxOpen', 'shop/cardboardBoxClosed', 'cars/debris-tire'];
const FOOD = ['food/apple', 'food/bag', 'food/banana', 'food/bread', 'food/can', 'food/candy-bar', 'food/carton', 'food/cheese', 'food/chocolate', 'food/croissant', 'food/honey', 'food/loaf-baguette', 'food/orange', 'food/peanut-butter', 'food/pizza-box', 'food/soda-bottle', 'food/soda-can', 'food/wine-red', 'food/wine-white', 'food/carton-small', 'food/donut-chocolate'];
const SHOP = ['shop/bookcaseOpen', 'shop/bookcaseOpenLow', 'shop/cabinetTelevision', 'shop/cardboardBoxClosed', 'shop/cardboardBoxOpen', 'shop/coatRackStanding', 'shop/computerScreen', 'shop/kitchenFridge', 'shop/kitchenFridgeLarge', 'shop/lampSquareCeiling', 'shop/laptop', 'shop/radio', 'shop/speaker', 'shop/televisionModern', 'shop/televisionVintage', 'shop/trashcan'];
export const DETAIL_MODEL_PATHS = [...new Set([...CARS, 'cars/police', ...DEBRIS, ...FOOD, ...SHOP, 'street/construction-barrier', 'street/construction-light', 'street/tree-large', 'street/tree-small', 'street/traffic-light'])];

const TEX = import.meta.env.BASE_URL + 'textures/';
const texCache = new Map();
export function loadTexture(name) {
  if (!texCache.has(name)) {
    const t = new THREE.TextureLoader().load(TEX + name + '.webp');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(name, t);
  }
  return texCache.get(name);
}

// Fusionne tous les maillages d'un modèle : un groupe par texture, couleurs des matériaux sans texture -> couleurs de sommets.
const partsCache = new Map();
export function modelParts(path) {
  if (partsCache.has(path)) return partsCache.get(path);
  const m = getModel(path);
  if (!m) return null;
  m.scene.updateMatrixWorld(true);
  const groups = new Map();
  const c = new THREE.Color();
  m.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const geoGroups = o.geometry.groups.length && Array.isArray(o.material) ? o.geometry.groups : [{ start: 0, count: src.attributes.position.count, materialIndex: 0 }];
    for (const gr of geoGroups) {
      const mat = mats[gr.materialIndex] || mats[0];
      const n = gr.count;
      const g = new THREE.BufferGeometry();
      // copie en Float32 (les attributs meshopt sont quantifiés/normalisés)
      const copy = (attr, size) => {
        const out = new Float32Array(n * size);
        for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(gr.start + i, k);
        return new THREE.BufferAttribute(out, size);
      };
      g.setAttribute('position', copy(src.attributes.position, 3));
      if (src.attributes.normal) g.setAttribute('normal', copy(src.attributes.normal, 3));
      g.setAttribute('uv', src.attributes.uv ? copy(src.attributes.uv, 2) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      c.copy(mat.map ? new THREE.Color(1, 1, 1) : mat.color || new THREE.Color(1, 1, 1));
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(o.matrixWorld);
      if (g.attributes.normal) g.attributes.normal.array.forEach((_, i, a) => { if (i % 3 === 0) { const l = Math.hypot(a[i], a[i + 1], a[i + 2]) || 1; a[i] /= l; a[i + 1] /= l; a[i + 2] /= l; } });
      else g.computeVertexNormals();
      const key = mat.map ? mat.map.uuid : 'none';
      if (!groups.has(key)) groups.set(key, { map: mat.map || null, geos: [] });
      groups.get(key).geos.push(g);
    }
  });
  const parts = [...groups.values()].map((gr) => ({
    geo: mergeGeometries(gr.geos),
    mat: new THREE.MeshLambertMaterial({ map: gr.map, vertexColors: true }),
  }));
  if (!parts.length) return null;
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const res = { parts, box, size: box.getSize(new THREE.Vector3()) };
  partsCache.set(path, res);
  return res;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _t = new THREE.Matrix4();

// Accumule des instances par modèle puis crée les InstancedMesh.
class Batch {
  constructor() { this.items = new Map(); }
  // o : {x, y, z, ry, rx, rz, s (uniforme) ou sx/sy/sz, fit: taille max (m), color}
  add(path, o) {
    if (!this.items.has(path)) this.items.set(path, []);
    this.items.get(path).push(o);
  }
  build(scene, objects, shadows) {
    const out = [];
    for (const [path, list] of this.items) {
      const md = modelParts(path);
      if (!md) continue;
      const { box, size } = md;
      const mats = list.map((o) => {
        let s = o.s ?? 1;
        if (o.fit) s = o.fit / Math.max(size.x, size.y, size.z);
        if (o.len) s = o.len / Math.max(size.x, size.z);
        if (o.height) s = o.height / size.y;
        _s.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s);
        _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
        _v.set(o.x, o.y ?? 0, o.z);
        _m.compose(_v, _q, _s);
        // origine du modèle : centre au sol
        _t.makeTranslation(-(box.min.x + box.max.x) / 2, o.hang ? -box.max.y : -box.min.y, -(box.min.z + box.max.z) / 2);
        return _m.clone().multiply(_t);
      });
      for (const p of md.parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        if (list.some((o) => o.color != null)) list.forEach((o, i) => im.setColorAt(i, new THREE.Color(o.color ?? 0xffffff)));
        im.castShadow = im.receiveShadow = shadows;
        im.computeBoundingSphere();
        scene.add(im); objects.push(im);
        out.push(im);
      }
    }
    return out;
  }
}

// ---- textures procédurales -------------------------------------------------
function canvasTex(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Rayonnages garnis (4 niveaux de produits avec des trous laissés par les pillards)
export function shelfTexture() {
  return canvasTex(512, 256, (g, W, H) => {
    let seed = 99;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#4b4f55'; g.fillRect(0, 0, W, H);
    const rows = 4, rh = H / rows;
    for (let k = 0; k < rows; k++) {
      const y0 = k * rh;
      g.fillStyle = '#2a2d31'; g.fillRect(0, y0, W, rh);
      g.fillStyle = '#9aa1a8'; g.fillRect(0, y0 + rh - 8, W, 8);
      for (let x = 2; x < W - 6;) {
        const kind = r();
        const w = kind < 0.35 ? 8 + r() * 4 : kind < 0.7 ? 18 + r() * 26 : 12 + r() * 8;
        if (r() < 0.3) { x += w * 2 + 6; continue; } // trou : rayon pillé
        const hue = Math.floor(r() * 360), sat = 45 + r() * 40, lum = 35 + r() * 30;
        const n = 1 + Math.floor(r() * 4); // plusieurs exemplaires identiques côte à côte
        for (let k = 0; k < n && x < W - 6; k++) {
          const base = y0 + rh - 8;
          g.fillStyle = `hsl(${hue},${sat}%,${lum}%)`;
          if (kind < 0.35) {
            // bouteille : corps + goulot + bouchon
            const h = rh * (0.55 + r() * 0.1);
            g.fillRect(x, base - h * 0.7, w, h * 0.7);
            g.fillRect(x + w * 0.3, base - h, w * 0.4, h * 0.3);
            g.fillStyle = '#ddd'; g.fillRect(x + w * 0.3, base - h - 3, w * 0.4, 3);
            g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x, base - h * 0.45, w, h * 0.15);
          } else if (kind < 0.7) {
            // paquet / carton : étiquette + logo
            const h = rh * (0.35 + r() * 0.35);
            g.fillRect(x, base - h, w, h);
            g.fillStyle = `hsl(${(hue + 180) % 360},70%,60%)`; g.beginPath(); g.arc(x + w / 2, base - h * 0.6, Math.min(w, h) * 0.22, 0, 7); g.fill();
            g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x + 2, base - h * 0.25, w - 4, 3);
          } else {
            // conserves empilées
            const h = rh * 0.22;
            for (let j = 0; j < 2; j++) {
              g.fillRect(x, base - h * (j + 1), w, h - 1);
              g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(x, base - h * (j + 1) + h * 0.35, w, h * 0.3);
              g.fillStyle = `hsl(${hue},${sat}%,${lum}%)`;
            }
          }
          g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w - 1, base - rh * 0.6, 1, rh * 0.6);
          x += w + 1;
        }
        x += 2 + r() * 4;
      }
    }
  }, { repeat: true });
}

// Vitrine brisée : verre sombre, reflets, impacts et trou.
function vitrineTexture() {
  return canvasTex(256, 256, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#2d3b4a'); gr.addColorStop(0.5, '#111820'); gr.addColorStop(1, '#25313d');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,235,190,0.12)'; g.fillRect(20, 120, 210, 90); // intérieur éclairé
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(30, 0); g.lineTo(0, 60); g.moveTo(90, 0); g.lineTo(0, 140); g.stroke();
    // fissures en étoile
    g.strokeStyle = 'rgba(230,240,255,0.75)'; g.lineWidth = 1.5;
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [cx, cy] of [[170, 110], [70, 180]]) {
      for (let k = 0; k < 14; k++) {
        const a = r() * Math.PI * 2, L = 40 + r() * 90;
        g.beginPath(); g.moveTo(cx, cy);
        let x = cx, y = cy;
        for (let s = 0; s < 4; s++) { x += Math.cos(a + (r() - 0.5) * 0.5) * L / 4; y += Math.sin(a + (r() - 0.5) * 0.5) * L / 4; g.lineTo(x, y); }
        g.stroke();
      }
      for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(cx, cy, k * 14, 0, 7); g.stroke(); }
    }
    g.fillStyle = '#05070a'; g.beginPath(); g.ellipse(170, 112, 26, 34, 0.4, 0, 7); g.fill();
    g.fillStyle = '#3a3d42'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6); g.fillRect(0, 0, 6, H); g.fillRect(W - 6, 0, 6, H);
  });
}

// Rideau métallique ondulé
function shutterTexture() {
  return canvasTex(64, 256, (g, W, H) => {
    for (let y = 0; y < H; y += 8) {
      const gr = g.createLinearGradient(0, y, 0, y + 8);
      gr.addColorStop(0, '#9aa0a6'); gr.addColorStop(0.5, '#6c7177'); gr.addColorStop(1, '#4a4e53');
      g.fillStyle = gr; g.fillRect(0, y, W, 8);
    }
    g.fillStyle = 'rgba(80,50,30,0.35)'; for (let i = 0; i < 30; i++) g.fillRect(Math.random() * W, Math.random() * H, 3, 10);
  }, { repeat: true });
}

// Atlas de tags (4x2 cases)
function tagAtlas() {
  const words = ['RÉVOLTE', 'NO FUTURE', 'ZBEUL', '93', 'FREEDOM', 'DÉFENSE', 'LA RUE EST À NOUS', 'ANTI'];
  const colors = ['#ff3b3b', '#f8f8f8', '#ffd43b', '#4dabf7', '#51cf66', '#ff6bcb', '#ffa94d', '#e9ecef'];
  return canvasTex(1024, 256, (g) => {
    words.forEach((w, i) => {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
      g.save();
      g.translate(x + 128, y + 64); g.rotate(-0.08 + (i % 3) * 0.06);
      g.font = `900 ${w.length > 10 ? 26 : 44}px Impact, Arial Black, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = '#111'; g.strokeText(w, 0, 0);
      g.fillStyle = colors[i]; g.fillText(w, 0, 0);
      g.globalAlpha = 0.6; g.fillStyle = colors[i];
      for (let k = 0; k < 5; k++) g.fillRect(-100 + k * 45 + (i * 13) % 20, 18, 3, 12 + ((k * 7 + i) % 5) * 6); // coulures
      g.restore();
    });
  });
}

// Atlas de décalques au sol (4 cases) : brûlure, éclats de verre, papiers, pavés
function decalAtlas() {
  return canvasTex(512, 128, (g) => {
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // 0 brûlure
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(8,6,5,0.95)'); gr.addColorStop(0.6, 'rgba(20,16,12,0.7)'); gr.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    // 1 éclats de verre
    for (let i = 0; i < 70; i++) {
      const x = 128 + 10 + r() * 108, y = 10 + r() * 108, s = 2 + r() * 7;
      g.fillStyle = `rgba(${200 + r() * 55},${225 + r() * 30},255,${0.5 + r() * 0.5})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * 0.4); g.lineTo(x + s * 0.3, y + s); g.fill();
    }
    // 2 papiers, emballages
    for (let i = 0; i < 16; i++) {
      const x = 256 + 12 + r() * 100, y = 12 + r() * 100;
      g.save(); g.translate(x, y); g.rotate(r() * 6);
      g.fillStyle = ['#e9e4d8', '#d94848', '#f2c94c', '#ffffff', '#5aa0d8', '#7a6a55'][i % 6];
      g.fillRect(-6, -4, 8 + r() * 10, 6 + r() * 8);
      g.restore();
    }
    // 3 pavés arrachés et cailloux
    for (let i = 0; i < 26; i++) {
      const x = 384 + 14 + r() * 100, y = 14 + r() * 100, s = 5 + r() * 9;
      g.fillStyle = `rgb(${90 + r() * 40},${88 + r() * 35},${84 + r() * 30})`;
      g.fillRect(x, y, s, s * (0.7 + r() * 0.5));
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + s * 0.7, s, 2);
    }
  });
}

// ---- construction ----------------------------------------------------------
export class CityDetail {
  constructor(scene, map, q, objects) {
    this.scene = scene;
    this.objects = objects;
    this.policeLights = [];
    const rng = mulberry32(map.d.seed + 101);
    const B = new Batch();
    const shadows = q.shadows;
    this.cars(B, map, rng);
    this.debris(B, map, rng);
    this.shops(B, map, rng, objects);
    this.gjCamp(B, map, objects);
    B.build(scene, objects, shadows);
    this.decals(map, rng, objects);
    this.police(map);
  }

  cars(B, map, rng) {
    for (const p of map.props) {
      if (p.type !== 'car' && p.type !== 'police') continue;
      const ry = (p.alongX ? Math.PI / 2 : 0) + (rng() < 0.5 ? Math.PI : 0) + (rng() - 0.5) * 0.12;
      if (p.type === 'police') {
        const path = p.van ? 'cars/van' : 'cars/police';
        const md = modelParts(path);
        B.add(path, { x: p.x, z: p.z, ry, len: p.van ? 5 : 4.6, sy: p.van ? 1.05 : 0.9, sx: 0.95, color: p.van ? 0xe8ecf4 : 0xffffff });
        if (md) {
          const h = (p.van ? 5 : 4.6) / Math.max(md.size.x, md.size.z) * md.size.y * (p.van ? 1.05 : 0.9);
          this.policeLights.push({ x: p.x, z: p.z, y: h + 0.08, alongX: p.alongX });
        }
        continue;
      }
      const path = CARS[Math.floor(rng() * CARS.length)];
      const flipped = p.burning && rng() < 0.3;
      const tint = p.burning ? 0x2a2420 : [0xffffff, 0xd8d8d8, 0xffe0d0, 0xd0e0ff][Math.floor(rng() * 4)];
      B.add(path, { x: p.x, z: p.z, y: flipped ? 1.45 : 0, ry, rz: flipped ? Math.PI : (p.burning ? (rng() - 0.5) * 0.08 : 0), len: 4.3, sy: 0.85, sx: 0.92, color: tint });
    }
  }

  debris(B, map, rng) {
    const spots = map.props.filter((p) => p.type === 'barricade' || (p.type === 'car' && p.burning));
    for (const p of spots) {
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const a = rng() * 6.28, d = 2 + rng() * 2;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (map.circleBlocked(x, z, 0.3)) continue;
        const path = DEBRIS[Math.floor(rng() * DEBRIS.length)];
        const flat = path.includes('door') || path.includes('bumper');
        B.add(path, { x, z, ry: rng() * 6.28, rx: flat ? -Math.PI / 2 * 0.95 : (path.includes('tire') && rng() < 0.6 ? Math.PI / 2 : 0), fit: path.includes('tire') ? 0.75 : path.includes('door') ? 1.3 : path.includes('bumper') ? 1.8 : 0.9, y: flat ? 0.12 : 0, color: p.burning ? 0x3a3330 : 0xffffff });
      }
    }
    // barrières de chantier et lampes clignotantes près des barrages de police
    for (const o of map.decor) {
      if (o.type !== 'roadblock' || rng() < 0.5) continue;
      const along = o.rot === 0;
      const x = o.x + (along ? 0 : (o.x < 2 ? 1 : -1) * 1.2), z = o.z + (along ? (o.z < 2 ? 1 : -1) * 1.2 : 0);
      B.add('street/construction-barrier', { x, z, ry: o.rot, height: 1.05 });
      B.add('street/construction-light', { x: o.x, z: o.z, y: 1, ry: o.rot, height: 0.35 });
    }
    // détritus épars sur la chaussée
    for (let i = 0; i < map.size * 0.25; i++) {
      const x = 4 + rng() * (map.size - 8), z = 4 + rng() * (map.size - 8);
      if (map.circleBlocked(x, z, 0.4)) continue;
      const path = rng() < 0.5 ? 'shop/cardboardBoxOpen' : DEBRIS[Math.floor(rng() * DEBRIS.length)];
      B.add(path, { x, z, ry: rng() * 6.28, fit: 0.7, rx: path.includes('door') || path.includes('bumper') ? -Math.PI / 2 * 0.95 : 0, y: path.includes('door') || path.includes('bumper') ? 0.1 : 0 });
    }
  }

  // Intérieurs : mobilier par type de magasin, objets renversés, vitrines brisées, rideaux, tags
  shops(B, map, rng, objects) {
    const glass = [], shutters = [], tags = [];
    for (const s of map.shops) {
      const L = LOT, x0 = s.x0, z0 = s.z0;
      const P = (u, v) => {
        switch (s.side) {
          case 'N': return [x0 + u, z0 + v];
          case 'S': return [x0 + u, z0 + L - v];
          case 'W': return [x0 + v, z0 + u];
          default: return [x0 + L - v, z0 + u];
        }
      };
      const vd = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[s.side];
      const face = Math.atan2(-vd[0], -vd[1]);   // tourné vers la vitrine
      const back = Math.atan2(vd[0], vd[1]);     // tourné vers le fond
      const sideL = Math.atan2(...this.rot90(vd, 1));
      const sideR = Math.atan2(...this.rot90(vd, -1));
      const at = (path, u, v, o = {}) => { const [x, z] = P(u, v); B.add(path, { x, z, ...o }); };
      // plafonniers
      for (const v of [4.5, 10]) at('shop/lampSquareCeiling', L / 2, v, { y: WALL_H, hang: true, fit: 0.55 });
      switch (s.type) {
        case 'superette':
          for (let u = 8.3; u < 14; u += 1.15) at(rng() < 0.85 ? 'shop/kitchenFridgeLarge' : 'shop/kitchenFridge', u, L - WALL_T - 0.45, { ry: face, height: 2.05, color: 0xf0f4f8 });
          for (let k = 0; k < 10; k++) at(FOOD[Math.floor(rng() * FOOD.length)], 2 + rng() * 11, 2 + rng() * 9, { y: 0.16, ry: rng() * 6.28, fit: 0.25 + rng() * 0.15, rz: rng() < 0.5 ? Math.PI / 2 : 0 });
          break;
        case 'tel': case 'hifi':
          for (const v of [4.2, 7, 9.8]) {
            at(s.type === 'hifi' ? 'shop/televisionModern' : 'shop/computerScreen', 0.9, v, { y: 1.7, ry: sideR, fit: s.type === 'hifi' ? 1.1 : 0.55 });
            at(s.type === 'hifi' && rng() < 0.5 ? 'shop/televisionVintage' : 'shop/laptop', L - 0.9, v, { y: 1.7, ry: sideL, fit: 0.5 });
          }
          at('shop/computerScreen', 3.6, 12.8, { y: 1.1, ry: face, fit: 0.5 });
          at('shop/cabinetTelevision', 11, L - WALL_T - 0.35, { ry: face, len: 2.2 });
          if (s.type === 'hifi') { at('shop/speaker', 12.2, 12.5, { ry: face, height: 1.1 }); at('shop/speaker', 9.6, 12.5, { ry: face, height: 1.1 }); }
          at('shop/televisionModern', 7.5, 3.2, { ry: rng() * 6.28, rx: -Math.PI / 2, y: 0.25, fit: 1.2 }); // écran tombé au sol
          break;
        case 'sneakers':
          for (let k = 0; k < 7; k++) at('shop/cardboardBoxClosed', 2.5 + rng() * 10, 2.5 + rng() * 9, { ry: rng() * 6.28, fit: 0.45, color: [0xffffff, 0xff9966, 0x99ccff][k % 3] });
          at('shop/bookcaseOpenLow', 11.2, L - WALL_T - 0.3, { ry: face, len: 1.8 });
          at('shop/coatRackStanding', 3.2, 2.5, { ry: rng() * 6, height: 1.8 });
          break;
        case 'bijou': case 'luxe':
          for (const u of [9, 11.5]) at('shop/bookcaseOpenLow', u, L - WALL_T - 0.3, { ry: face, len: 2, color: 0xe8d8b8 });
          at('shop/coatRackStanding', 3, 3, { ry: 0.4, height: 1.8 });
          at('shop/coatRackStanding', 12, 3, { ry: 2, height: 1.8, rz: s.type === 'luxe' ? 1.4 : 0, y: s.type === 'luxe' ? 0.3 : 0 });
          break;
      }
      // désordre commun : cartons éventrés, poubelle renversée
      for (let k = 0; k < 3; k++) at('shop/cardboardBoxOpen', 2 + rng() * 11, 2 + rng() * 8, { ry: rng() * 6.28, fit: 0.6 });
      at('shop/trashcan', 13.5, 12.6, { ry: rng() * 6, rz: Math.PI / 2, y: 0.3, fit: 0.6 });

      // vitrines brisées sur la façade, de part et d'autre de la porte
      const dl = L / 2 - DOOR_W / 2, dr = L / 2 + DOOR_W / 2;
      for (const [u0, u1] of [[0.5, dl - 0.3], [dr + 0.3, L - 0.5]]) {
        const g = new THREE.PlaneGeometry(u1 - u0, 2.2);
        g.translate(0, 1.55, 0);
        g.rotateY(face);
        const [x, z] = P((u0 + u1) / 2, -0.02);
        g.translate(x, 0, z);
        glass.push(g);
        // tag sous la vitrine ou à côté
        if (rng() < 0.6) {
          const tg = new THREE.PlaneGeometry(2.4, 1.2);
          const idx = Math.floor(rng() * 8);
          const uv = tg.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, ((idx % 4) + uv.getX(i)) / 4, 1 - (Math.floor(idx / 4) + 1 - uv.getY(i)) / 2);
          tg.translate(0, rng() < 0.5 ? 0.75 : 3.05, 0);
          tg.rotateY(face);
          const uc = u1 - u0 > 2.6 ? u0 + 1.3 + rng() * (u1 - u0 - 2.6) : (u0 + u1) / 2;
          const [tx, tz] = P(uc, -0.04);
          tg.translate(tx, 0, tz);
          tags.push(tg);
        }
      }
      // rideau métallique forcé, relevé à mi-hauteur au-dessus de la porte
      const drop = 0.7 + rng() * 0.6;
      const sg = new THREE.PlaneGeometry(DOOR_W, drop);
      sg.translate(0, WALL_H - drop / 2, 0);
      sg.rotateY(face);
      const [sx, sz] = P(L / 2, 0.05);
      sg.translate(sx, 0, sz);
      const uv = sg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * DOOR_W / 1.5, uv.getY(i) * drop / 1.2);
      shutters.push(sg);
    }
    if (glass.length) {
      const m = new THREE.Mesh(mergeGeometries(glass), new THREE.MeshLambertMaterial({ map: vitrineTexture(), emissive: 0x0a0e14 }));
      this.scene.add(m); objects.push(m);
    }
    if (shutters.length) {
      const m = new THREE.Mesh(mergeGeometries(shutters), new THREE.MeshLambertMaterial({ map: shutterTexture(), side: THREE.DoubleSide }));
      this.scene.add(m); objects.push(m);
    }
    if (tags.length) {
      const m = new THREE.Mesh(mergeGeometries(tags), new THREE.MeshLambertMaterial({ map: tagAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.scene.add(m); objects.push(m);
    }
  }

  // Campement des gilets jaunes au rond-point : banderole, palettes, étal du receleur
  gjCamp(B, map, objects) {
    const r = map.roundabout;
    if (!r) return;
    const tex = canvasTex(512, 96, (g, W, H) => {
      g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#d7f20f'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
      g.font = '900 44px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#1a1a1a'; g.fillText('GILETS JAUNES · ON LÂCHE RIEN', W / 2, H / 2 + 2, W - 20);
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    banner.position.set(r.x, 2.6, r.z - 5.5);
    const poles = [-3, 3].map((dx) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0x555555 })); m.position.set(r.x + dx, 1.6, r.z - 5.5); return m; });
    for (const o of [banner, ...poles]) { this.scene.add(o); objects.push(o); }
    // palettes empilées et caisses autour des braseros
    for (const [dx, dz, ry] of [[-5.5, -3, 0.2], [5.2, 3.4, 1.4], [-3.4, 5.2, 2.2]]) B.add('street/box-large', { x: r.x + dx, z: r.z + dz, ry, height: 0.9, color: 0xc8a878 });
    B.add('street/barrel', { x: r.x - 4.5, z: r.z - 4.5, height: 0.95, color: 0x555555 });
    B.add('street/barrel', { x: r.x + 4.5, z: r.z + 4.5, height: 0.95, color: 0x555555 });
    B.add('shop/cardboardBoxOpen', { x: r.x + 1.6, z: r.z - 1.2, fit: 0.7 });
    B.add('shop/cardboardBoxClosed', { x: r.x + 2.1, z: r.z - 0.6, fit: 0.6, ry: 0.5 });
  }

  rot90(v, s) { return [v[1] * s, -v[0] * s]; }

  // Décalques au sol (un seul mesh) : brûlures sous les feux, verre devant les vitrines, papiers, pavés
  decals(map, rng, objects) {
    const geos = [];
    const add = (x, z, size, tile, y = 0.02) => {
      const g = new THREE.PlaneGeometry(size, size);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (tile + uv.getX(i)) / 4);
      g.rotateX(-Math.PI / 2);
      g.rotateY(rng() * 6.28);
      g.translate(x, y, z);
      geos.push(g);
    };
    for (const f of map.fires) add(f.x, f.z, 4 + f.s * 3, 0, 0.03);
    for (const s of map.shops) {
      add(s.door.x, s.door.z, 3.5, 1, 0.16);
      add(s.door.x + (rng() - 0.5) * 3, s.door.z + (rng() - 0.5) * 3, 2.5, 2, 0.16);
      add(s.inside.x + (rng() - 0.5) * 6, s.inside.z + (rng() - 0.5) * 6, 3, 2, 0.17);
    }
    for (let i = 0; i < map.size * 0.6; i++) {
      const x = rng() * map.size, z = rng() * map.size;
      add(x, z, 2 + rng() * 2.5, rng() < 0.55 ? 2 : 3, map.groundAt ? 0.02 + (map.groundAt(x, z, 0.1, 0) > 0.1 ? 0.14 : 0) : 0.02);
    }
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ map: decalAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.renderOrder = 1;
    this.scene.add(m); objects.push(m);
  }

  // Gyrophares bleus : deux InstancedMesh qui clignotent en alternance + halo au sol
  police(map) {
    void map;
    const n = this.policeLights.length;
    if (!n) return;
    const geo = new THREE.BoxGeometry(0.28, 0.12, 0.2);
    this.gyro = [0x2060ff, 0x2060ff].map((c, k) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: c }), n);
      this.policeLights.forEach((l, i) => {
        const off = (k ? 1 : -1) * 0.35;
        im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(l.x + (l.alongX ? 0 : off), l.y, l.z + (l.alongX ? off : 0)));
      });
      this.scene.add(im); this.objects.push(im);
      return im;
    });
    const halo = canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(60,110,255,0.8)'); gr.addColorStop(1, 'rgba(60,110,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
    const hg = this.policeLights.map((l) => { const g = new THREE.PlaneGeometry(9, 9); g.rotateX(-Math.PI / 2); g.translate(l.x, 0.05, l.z); return g; });
    this.halo = new THREE.Mesh(mergeGeometries(hg), new THREE.MeshBasicMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.halo); this.objects.push(this.halo);
  }

  update(t) {
    if (!this.gyro) return;
    const a = Math.floor(t * 6) % 2;
    this.gyro[0].material.color.setHex(a ? 0x2a6bff : 0x0a1030);
    this.gyro[1].material.color.setHex(a ? 0x0a1030 : 0xff2a2a);
    this.halo.material.opacity = 0.35 + 0.65 * Math.abs(Math.sin(t * 9));
  }
}
