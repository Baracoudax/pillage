// Construit la scène 3D d'un quartier à partir des données de carte partagées.
// Optimisation : toute la géométrie statique est fusionnée par matériau (≈ 12 draw calls pour la ville).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, STREET, WALL_H } from '../../shared/map.js';
import { SHOP_TYPES } from '../../shared/config.js';
import { ITEMS, RARITY } from '../../shared/items.js';
import { getModel } from './assets.js';
import { CityDetail, DETAIL_MODEL_PATHS, loadTexture, shelfTexture, modelParts } from './cityDetail.js';

// Modèles 3D (Kenney City Kit Commercial, packs CC0 3dmodelscc0)
export const BUILDINGS = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n'];
export const TOWERS = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e'];
export const DECOR_MODELS = { bench: ['props/StreetBench', 1], trash: ['props/PlasticTrashBin', 1], mailbox: ['props/CityMailBox', 1], payphone: ['props/Payphone', 1.2], atm: ['props/ATM', 1.25], ebox: ['props/RealisticElectricalBox', 1], busstop: ['props/Bus_Stop', 1], cone: ['props/Traffic_Cone', 1.3], portaloo: ['props/Portaloo', 1], dumpster: ['props/Dumpster', 1], roadblock: ['props/RoadBlock', 2], tree: ['street/tree-large', 8], treeS: ['street/tree-small', 8.5], tlight: ['street/traffic-light', 6.4] };
// objet de butin -> [modèle, taille max (m)]
export const LOOT_MODELS = {
  console: ['loot/Console', 0.32], enceinte: ['loot/Radio', 0.3], radio: ['loot/Radio', 0.34], micro: ['loot/Microphone', 0.35], casque_vr: ['loot/VRGoggles', 0.22],
  appareil: ['loot/Digital_Camera', 0.15], routeur: ['loot/Router', 0.22], cle_usb: ['loot/USB_Stick', 0.08], talkie: ['loot/WalkieTalkie', 0.16],
  surgeles: ['loot/FrozenPizza', 0.32], thon: ['loot/Canned_Tuna', 0.12], lait: ['loot/Milk', 0.3], glace: ['loot/Ice_Cream', 0.25], tartiner: ['loot/CannedFood', 0.2],
};
export const CITY_MODEL_PATHS = [...BUILDINGS, ...TOWERS].map((b) => 'city/' + b)
  .concat(Object.values(DECOR_MODELS).map((x) => x[0]), [...new Set(Object.values(LOOT_MODELS).map((x) => x[0]))], DETAIL_MODEL_PATHS);

// géométrie unique d'un modèle (transformée du nœud appliquée), matériau Lambert (léger)
function flatModel(path) {
  const m = getModel(path);
  if (!m) return null;
  let mesh = null;
  m.scene.updateMatrixWorld(true);
  m.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return null;
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const src = mesh.material;
  const mat = new THREE.MeshLambertMaterial({ map: src.map || null, color: src.map ? 0xffffff : src.color });
  return { geo, mat, box: geo.boundingBox };
}

const _c = new THREE.Color();

// Boîte axis-aligned avec couleur par sommet. uvMode 'facade' => UV en mètres pour la texture de fenêtres.
function box(x0, y0, z0, x1, y1, z1, color, uvMode, uvScale = 2) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvMode === 'world' || uvMode === 'shelf') {
    // UV en mètres (texture répétée) ; 'shelf' : la face avant/arrière couvre la hauteur du meuble
    const uv = g.attributes.uv, sc = uvScale;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const offs = [[z0, y0], [z0, y0], [x0, z0], [x0, z0], [x0, y0], [x0, y0]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (uvMode === 'shelf') {
        if (f === 2 || f === 3) { uv.setXY(i, 0.01, 0.99); continue; }
        uv.setXY(i, (uv.getX(i) * dims[f][0] + offs[f][0]) / sc, uv.getY(i) * 0.98 + 0.01);
      } else uv.setXY(i, (uv.getX(i) * dims[f][0] + offs[f][0]) / sc, (uv.getY(i) * dims[f][1] + offs[f][1]) / sc);
    }
  }
  if (uvMode === 'facade') {
    const uv = g.attributes.uv;
    // ordre des faces BoxGeometry : +x, -x, +y, -y, +z, -z (4 sommets chacune)
    const fw = [d, d, 0, 0, w, w];
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        if (fw[f] === 0) { uv.setXY(i, 0.01, 0.01); continue; }
        uv.setXY(i, (uv.getX(i) * fw[f]) / 14, (uv.getY(i) * h + y0) / 12.8);
      }
    }
  }
  return g;
}

function facadeTextures() {
  const S = 256;
  const make = (emit) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = emit ? '#000' : '#bdbdbd';
    g.fillRect(0, 0, S, S);
    if (!emit) { g.fillStyle = '#aaaaaa'; for (let y = 0; y < S; y += 64) g.fillRect(0, y + 60, S, 4); }
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const lit = rnd() < 0.3, fire = rnd() < 0.04;
      const x = i * 64 + 19, y = j * 64 + 16, w = 26, h = 32;
      if (emit) {
        if (lit || fire) { g.fillStyle = fire ? '#ff6a1a' : rnd() < 0.5 ? '#ffd27a' : '#cfe3ff'; g.fillRect(x + 2, y + 2, w - 4, h - 4); }
      } else {
        g.fillStyle = '#5a5a5a'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
        g.fillStyle = lit || fire ? '#ffffff' : '#20242c'; g.fillRect(x, y, w, h);
        g.fillStyle = '#5a5a5a'; g.fillRect(x + w / 2 - 1, y, 2, h);
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: make(false), emit: make(true) };
}

function signAtlas() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  const types = Object.keys(SHOP_TYPES);
  types.forEach((t, i) => {
    const y = i * 64;
    g.fillStyle = SHOP_TYPES[t].color;
    g.fillRect(0, y, 512, 64);
    g.strokeStyle = '#ffffff55'; g.lineWidth = 4; g.strokeRect(4, y + 4, 504, 56);
    g.fillStyle = '#fff';
    g.font = 'bold 38px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(SHOP_TYPES[t].name, 256, y + 34, 490);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, row: (type) => types.indexOf(type) };
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class CityView {
  constructor(scene, map, q) {
    this.scene = scene;
    this.map = map;
    this.objects = [];
    const add = (o) => { scene.add(o); this.objects.push(o); return o; };
    const S = map.size;

    // sol
    const asphalt = loadTexture('asphalt_02');
    asphalt.repeat.set((S + 60) / 5, (S + 60) / 5);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x8a8c94, map: asphalt });
    const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(S + 60, S + 60), groundMat));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(S / 2, 0, S / 2);
    ground.receiveShadow = q.shadows;

    // trottoirs + marquages
    const walk = [], marks = [], floors = [];
    const P = BLOCK + STREET;
    for (let i = 0; i < map.d.size; i++) for (let j = 0; j < map.d.size; j++) {
      const x = STREET + i * P, z = STREET + j * P;
      walk.push(box(x, 0, z, x + BLOCK, 0.14, z + BLOCK, 0x9a9894, 'world', 2.5));
      // bordure de trottoir en granit
      for (const [a0, b0, a1, b1] of [[x, z, x + BLOCK, z + 0.25], [x, z + BLOCK - 0.25, x + BLOCK, z + BLOCK], [x, z, x + 0.25, z + BLOCK], [x + BLOCK - 0.25, z, x + BLOCK, z + BLOCK]]) marks.push(box(a0, 0.005, b0, a1, 0.15, b1, 0x6f6e6a));
    }
    for (let i = 0; i <= map.d.size; i++) {
      const c = i * P + STREET / 2;
      for (let t = 2; t < S - 2; t += 6) {
        marks.push(box(c - 0.08, 0.01, t, c + 0.08, 0.02, t + 2.5, 0xb8b29a));
        marks.push(box(t, 0.01, c - 0.08, t + 2.5, 0.02, c + 0.08, 0xb8b29a));
      }
    }
    // sols des magasins
    for (const f of map.floors) {
      _c.set(SHOP_TYPES[f.type].floor);
      _c.lerp(new THREE.Color(0xffffff), 0.45);
      floors.push(box(f.x0, 0, f.z0, f.x1, 0.16, f.z1, _c.getHex(), 'world', 2));
    }
    const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const walkMesh = add(new THREE.Mesh(mergeGeometries(walk), new THREE.MeshLambertMaterial({ vertexColors: true, map: loadTexture('concrete_pavement') })));
    walkMesh.receiveShadow = q.shadows;
    if (floors.length) add(new THREE.Mesh(mergeGeometries(floors), new THREE.MeshLambertMaterial({ vertexColors: true, map: loadTexture('interior_tiles') }))).receiveShadow = q.shadows;
    add(new THREE.Mesh(mergeGeometries(marks), vcMat));

    // immeubles : modèles Kenney (2x2 par parcelle) quand ils sont chargés, sinon blocs à fenêtres
    const ft = facadeTextures();
    const kenney = this.kenneyBuildings(map, q);
    const bld = map.buildings.filter((b) => !kenney.has(b)).map((b) => box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.c, 'facade'));
    const bldMat = new THREE.MeshLambertMaterial({
      vertexColors: true, map: ft.map, emissive: 0xffffff, emissiveMap: ft.emit, emissiveIntensity: 0.85,
    });
    const bldMesh = add(new THREE.Mesh(mergeGeometries(bld), bldMat));
    bldMesh.castShadow = bldMesh.receiveShadow = q.shadows;

    // murs, étagères, comptoirs des magasins
    const walls = [], shelves = [], goods = [];
    for (const s of map.solids) if (s.kind === 'wall') walls.push(box(s.x0, 0, s.z0, s.x1, WALL_H, s.z1, 0xe8e2d6, 'world', 3));
    for (const s of map.shelves) {
      // rayonnages : texture de produits ; comptoirs : bois
      if (s.kind === 'shelf') shelves.push(box(s.x0, 0, s.z0, s.x1, s.h, s.z1, 0xffffff, 'shelf', 2));
      else goods.push(box(s.x0, 0, s.z0, s.x1, s.h, s.z1, 0x6d4c33));
    }
    const wallMesh = add(new THREE.Mesh(mergeGeometries(walls), new THREE.MeshLambertMaterial({ vertexColors: true, map: loadTexture('painted_plaster_wall') })));
    wallMesh.castShadow = wallMesh.receiveShadow = q.shadows;
    if (shelves.length) add(new THREE.Mesh(mergeGeometries(shelves), new THREE.MeshLambertMaterial({ vertexColors: true, map: shelfTexture() })));
    if (goods.length) add(new THREE.Mesh(mergeGeometries(goods), vcMat));

    // enseignes (atlas de texte unique)
    const atlas = signAtlas();
    const signGeos = map.signs.map((s) => {
      const g = new THREE.PlaneGeometry(6, 0.85);
      const row = atlas.row(s.type);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / 8);
      g.rotateY(s.rot);
      g.translate(s.x, s.y, s.z);
      return g;
    });
    if (signGeos.length) add(new THREE.Mesh(mergeGeometries(signGeos), new THREE.MeshBasicMaterial({ map: atlas.tex })));
    // éclairage intérieur des magasins : dalles lumineuses au plafond
    const ceil = map.floors.map((f) => {
      const g = new THREE.PlaneGeometry((f.x1 - f.x0) * 0.5, (f.z1 - f.z0) * 0.25);
      g.rotateX(Math.PI / 2);
      g.translate((f.x0 + f.x1) / 2, WALL_H - 0.02, (f.z0 + f.z1) / 2);
      return g;
    });
    if (ceil.length) add(new THREE.Mesh(mergeGeometries(ceil), new THREE.MeshBasicMaterial({ color: 0xfff4d6 })));

    // voitures et barricades
    const props = [];
    const kenneyCars = !!modelParts('cars/sedan');
    for (const p of map.props) {
      const s = p.solid;
      if ((p.type === 'car' || p.type === 'police') && kenneyCars) continue;
      if (p.type === 'car' || p.type === 'police') {
        const col = p.burning ? 0x1b1715 : [0x7a1f1f, 0x2e4a6b, 0x9b9b9b, 0x2b2b2b, 0xd6d0c4][Math.floor(p.x * 7 + p.z) % 5];
        props.push(box(s.x0, 0.25, s.z0, s.x1, 0.95, s.z1, col));
        const ix = (s.x1 - s.x0) * 0.2, iz = (s.z1 - s.z0) * 0.2;
        props.push(box(s.x0 + ix, 0.95, s.z0 + iz, s.x1 - ix, 1.5, s.z1 - iz, p.burning ? 0x121010 : 0x22262e));
        for (const [a, b] of [[0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]]) {
          const wx = s.x0 + (s.x1 - s.x0) * (p.alongX ? b : a), wz = s.z0 + (s.z1 - s.z0) * (p.alongX ? a : b);
          props.push(box(wx - 0.3, 0, wz - 0.3, wx + 0.3, 0.55, wz + 0.3, 0x111111));
        }
      } else {
        // poubelles + palettes
        const n = 3;
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n;
          const x = p.alongX ? s.x0 + (s.x1 - s.x0) * u : (s.x0 + s.x1) / 2;
          const z = p.alongX ? (s.z0 + s.z1) / 2 : s.z0 + (s.z1 - s.z0) * u;
          props.push(box(x - 0.5, 0, z - 0.45, x + 0.5, 1.15, z + 0.45, p.burning ? 0x1c1a17 : [0x2f6b3a, 0x50565c, 0x6b5a2f][k]));
        }
      }
    }
    // lampadaires
    for (const l of map.lamps) {
      props.push(box(l.x - 0.08, 0, l.z - 0.08, l.x + 0.08, 5.2, l.z + 0.08, 0x3a3d42));
      const hx = l.x + l.dir[0] * 0.9, hz = l.z + l.dir[1] * 0.9;
      props.push(box(Math.min(l.x, hx) - 0.08, 5.1, Math.min(l.z, hz) - 0.08, Math.max(l.x, hx) + 0.08, 5.2, Math.max(l.z, hz) + 0.08, 0x3a3d42));
    }
    const propMesh = add(new THREE.Mesh(mergeGeometries(props), vcMat));
    propMesh.castShadow = q.shadows;
    const heads = map.lamps.map((l) => box(l.x + l.dir[0] * 0.9 - 0.25, 4.95, l.z + l.dir[1] * 0.9 - 0.25, l.x + l.dir[0] * 0.9 + 0.25, 5.1, l.z + l.dir[1] * 0.9 + 0.25, 0xffd9a0));
    add(new THREE.Mesh(mergeGeometries(heads), new THREE.MeshBasicMaterial({ vertexColors: true })));
    // halos lumineux au sol sous les lampadaires (décalques additifs, pas de vraies lumières)
    const halo = radialTexture('rgba(255,200,130,0.55)', 'rgba(255,200,130,0)');
    const haloGeo = map.lamps.map((l) => {
      const g = new THREE.PlaneGeometry(9, 9);
      g.rotateX(-Math.PI / 2);
      g.translate(l.x + l.dir[0] * 1.5, 0.17, l.z + l.dir[1] * 1.5);
      return g;
    });
    for (const f of map.fires) {
      const g = new THREE.PlaneGeometry(10 * f.s, 10 * f.s);
      g.rotateX(-Math.PI / 2);
      g.translate(f.x, 0.18, f.z);
      haloGeo.push(g);
    }
    add(new THREE.Mesh(mergeGeometries(haloGeo), new THREE.MeshBasicMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

    this.decorProps(map, q);
    this.detail = new CityDetail(scene, map, q, this.objects);

    // points d'extraction
    this.exitMeshes = map.exits.map((e) => {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.5, 32), new THREE.MeshBasicMaterial({ color: 0x40ff80, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 30, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      beam.position.y = 15;
      grp.add(ring, beam);
      grp.position.set(e.x, 0, e.z);
      add(grp);
      return { e, grp, ring, beam };
    });

    // objets à piller : un seul InstancedMesh pour tout le loot
    const n = map.lootSpots.length;
    const lootGeo = new THREE.BoxGeometry(0.34, 0.26, 0.34);
    this.lootMesh = add(new THREE.InstancedMesh(lootGeo, new THREE.MeshLambertMaterial({ emissive: 0x222222 }), n));
    this.lootMesh.frustumCulled = false;
    this.lootItems = new Array(n).fill(null);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeScale(0, 0, 0);
      this.lootMesh.setMatrixAt(i, m);
      this.lootMesh.setColorAt(i, _c.set(0xffffff));
    }
    // marqueur au-dessus de l'objet ciblé
    this.marker = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xffffff })));
    this.marker.visible = false;
    // sacs au sol
    this.bagGeo = new THREE.BoxGeometry(0.6, 0.45, 0.45);
    this.bagMat = new THREE.MeshLambertMaterial({ color: 0x3b3b3b, emissive: 0x332200 });
    this.bags = new Map();
  }

  // Remplace les immeubles pleins (au sol) par des modèles Kenney instanciés, 2x2 par parcelle.
  kenneyBuildings(map, q) {
    const done = new Set();
    const types = [...BUILDINGS, ...TOWERS].map((n) => flatModel('city/' + n));
    if (types.some((t) => !t)) return done;
    const inst = types.map(() => []);
    let seed = map.d.seed;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const S = map.size;
    for (const b of map.buildings) {
      if (b.y0 > 0) continue;
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      const outside = b.x1 <= 0 || b.z1 <= 0 || b.x0 >= S || b.z0 >= S;
      // façade tournée vers la rue la plus proche
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const x = b.x0 + (i + 0.5) * (w / 2), z = b.z0 + (j + 0.5) * (d / 2);
        const tall = b.y1 > 14 && rnd() < 0.5;
        const k = tall ? BUILDINGS.length + Math.floor(rnd() * TOWERS.length) : Math.floor(rnd() * BUILDINGS.length);
        const t = types[k];
        const sz = t.box.getSize(new THREE.Vector3());
        const s = (Math.min(w, d) / 2 - 0.05) / Math.max(sz.x, sz.z);
        let rot;
        if (outside) rot = b.z1 <= 0 ? 0 : b.z0 >= S ? Math.PI : b.x1 <= 0 ? Math.PI / 2 : -Math.PI / 2;
        else {
          const dx = i === 0 ? -1 : 1, dz = j === 0 ? -1 : 1;
          rot = rnd() < 0.5 ? (dx < 0 ? -Math.PI / 2 : Math.PI / 2) : (dz < 0 ? Math.PI : 0);
        }
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -t.box.min.y * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(s, s, s));
        m.multiply(new THREE.Matrix4().makeTranslation(-(t.box.min.x + t.box.max.x) / 2, 0, -(t.box.min.z + t.box.max.z) / 2));
        inst[k].push(m);
        void cx; void cz;
      }
      done.add(b);
    }
    types.forEach((t, k) => {
      if (!inst[k].length) return;
      const im = new THREE.InstancedMesh(t.geo, t.mat, inst[k].length);
      inst[k].forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = im.receiveShadow = q.shadows;
      this.scene.add(im); this.objects.push(im);
    });
    return done;
  }

  // Mobilier urbain (bancs, poubelles, cabines, distributeurs, abribus...) : un InstancedMesh par type
  decorProps(map, q) {
    const groups = {};
    for (const o of map.decor || []) (groups[o.type] ||= []).push(o);
    for (const type in groups) {
      const def = DECOR_MODELS[type];
      const t = def && flatModel(def[0]);
      if (!t) continue;
      const s = def[1];
      const im = new THREE.InstancedMesh(t.geo, t.mat, groups[type].length);
      groups[type].forEach((o, i) => {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, 0.14 - t.box.min.y * s, o.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, o.rot, 0)), new THREE.Vector3(s, s, s));
        m.multiply(new THREE.Matrix4().makeTranslation(-(t.box.min.x + t.box.max.x) / 2, 0, -(t.box.min.z + t.box.max.z) / 2));
        im.setMatrixAt(i, m);
      });
      im.castShadow = q.shadows;
      this.scene.add(im); this.objects.push(im);
    }
    // objets de butin modélisés : un InstancedMesh par modèle, capacité = nombre d'emplacements
    this.lootTypes = {};
    const n = map.lootSpots.length;
    for (const item in LOOT_MODELS) {
      const [path, size] = LOOT_MODELS[item];
      if (!this.lootTypes[path]) {
        const t = flatModel(path);
        if (!t) continue;
        const im = new THREE.InstancedMesh(t.geo, t.mat, n);
        im.frustumCulled = false;
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < n; i++) im.setMatrixAt(i, zero);
        this.scene.add(im); this.objects.push(im);
        this.lootTypes[path] = { im, t };
      }
    }
  }

  setLoot(id, itemId) {
    const lm = itemId && LOOT_MODELS[itemId];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const k in this.lootTypes || {}) {
      const { im } = this.lootTypes[k];
      im.setMatrixAt(id, zero);
      im.instanceMatrix.needsUpdate = true;
    }
    const lt = lm && this.lootTypes?.[lm[0]];
    if (lt) {
      const s = this.map.lootSpots[id], t = lt.t;
      const sz = t.box.getSize(new THREE.Vector3());
      const sc = lm[1] / Math.max(sz.x, sz.y, sz.z);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y - t.box.min.y * sc, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, id * 1.3, 0)), new THREE.Vector3(sc, sc, sc));
      m.multiply(new THREE.Matrix4().makeTranslation(-(t.box.min.x + t.box.max.x) / 2, 0, -(t.box.min.z + t.box.max.z) / 2));
      lt.im.setMatrixAt(id, m);
      lt.im.instanceMatrix.needsUpdate = true;
      this.lootItems[id] = itemId;
      const m0 = new THREE.Matrix4().makeScale(0, 0, 0);
      this.lootMesh.setMatrixAt(id, m0);
      this.lootMesh.instanceMatrix.needsUpdate = true;
      return;
    }
    this.setLootBox(id, itemId);
  }

  setLootBox(id, itemId) {
    const s = this.map.lootSpots[id];
    this.lootItems[id] = itemId;
    const m = new THREE.Matrix4();
    if (itemId) {
      const r = ITEMS[itemId].r;
      const sc = itemId === 'tv' ? 2.2 : 1;
      m.compose(new THREE.Vector3(s.x, s.y + 0.13 * sc, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, id * 1.3, 0)), new THREE.Vector3(sc, sc, sc));
      this.lootMesh.setColorAt(id, _c.set(RARITY[r].color));
    } else m.makeScale(0, 0, 0);
    this.lootMesh.setMatrixAt(id, m);
    this.lootMesh.instanceMatrix.needsUpdate = true;
    if (this.lootMesh.instanceColor) this.lootMesh.instanceColor.needsUpdate = true;
  }

  addBag(id, x, z) {
    if (this.bags.has(id)) return;
    const mesh = new THREE.Mesh(this.bagGeo, this.bagMat);
    mesh.position.set(x, 0.23, z);
    mesh.rotation.y = id;
    this.scene.add(mesh);
    this.bags.set(id, { id, x, z, mesh });
  }
  removeBag(id) {
    const b = this.bags.get(id);
    if (!b) return;
    this.scene.remove(b.mesh);
    this.bags.delete(id);
  }

  update(t, time) {
    for (const x of this.exitMeshes) {
      const active = time >= x.e.activeFrom;
      x.ring.material.color.set(active ? 0x40ff80 : 0x777777);
      x.beam.material.color.set(active ? 0x40ff80 : 0x555555);
      x.beam.material.opacity = active ? 0.1 + Math.sin(t * 3) * 0.04 : 0.05;
    }
    this.marker.rotation.y = t * 3;
    this.detail.update(t);
  }

  dispose() {
    for (const o of this.objects) {
      this.scene.remove(o);
      o.traverse?.((c) => {
        c.geometry?.dispose();
        const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
        for (const mm of mats) { mm.map?.dispose(); mm.emissiveMap?.dispose(); mm.dispose(); }
      });
    }
    for (const b of this.bags.values()) this.scene.remove(b.mesh);
    this.bagGeo.dispose(); this.bagMat.dispose();
  }
}
