// Construit la scène 3D d'un quartier à partir des données de carte partagées.
// Optimisation : toute la géométrie statique est fusionnée par matériau (≈ 12 draw calls pour la ville).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, STREET, WALL_H } from '../../shared/map.js';
import { SHOP_TYPES } from '../../shared/config.js';
import { ITEMS, RARITY } from '../../shared/items.js';

const _c = new THREE.Color();

// Boîte axis-aligned avec couleur par sommet. uvMode 'facade' => UV en mètres pour la texture de fenêtres.
function box(x0, y0, z0, x1, y1, z1, color, uvMode) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3b3d44 });
    const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(S + 60, S + 60), groundMat));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(S / 2, 0, S / 2);
    ground.receiveShadow = q.shadows;

    // trottoirs + marquages
    const walk = [], marks = [];
    const P = BLOCK + STREET;
    for (let i = 0; i < map.d.size; i++) for (let j = 0; j < map.d.size; j++) {
      const x = STREET + i * P, z = STREET + j * P;
      walk.push(box(x, 0, z, x + BLOCK, 0.14, z + BLOCK, 0x6b6a67));
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
      walk.push(box(f.x0, 0, f.z0, f.x1, 0.16, f.z1, _c.getHex()));
    }
    const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const walkMesh = add(new THREE.Mesh(mergeGeometries(walk), vcMat));
    walkMesh.receiveShadow = q.shadows;
    add(new THREE.Mesh(mergeGeometries(marks), new THREE.MeshBasicMaterial({ vertexColors: true })));

    // immeubles (une seule géométrie, texture de fenêtres procédurale)
    const ft = facadeTextures();
    const bld = map.buildings.map((b) => box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.c, 'facade'));
    const bldMat = new THREE.MeshLambertMaterial({
      vertexColors: true, map: ft.map, emissive: 0xffffff, emissiveMap: ft.emit, emissiveIntensity: 0.85,
    });
    const bldMesh = add(new THREE.Mesh(mergeGeometries(bld), bldMat));
    bldMesh.castShadow = bldMesh.receiveShadow = q.shadows;

    // murs, étagères, comptoirs des magasins
    const walls = [], shelves = [], goods = [];
    for (const s of map.solids) if (s.kind === 'wall') walls.push(box(s.x0, 0, s.z0, s.x1, WALL_H, s.z1, 0xd9d4c7));
    for (const s of map.shelves) {
      const col = s.kind === 'counter' ? 0x6d4c33 : 0x9aa1a8;
      shelves.push(box(s.x0, 0, s.z0, s.x1, s.h, s.z1, col));
      // marchandises renversées en vrac (décor)
      if (s.kind === 'shelf') {
        const lx = s.x1 - s.x0, lz = s.z1 - s.z0;
        for (let k = 0; k < 6; k++) {
          const u = (k + 0.5) / 6;
          const x = lx > lz ? s.x0 + lx * u : (s.x0 + s.x1) / 2;
          const z = lx > lz ? (s.z0 + s.z1) / 2 : s.z0 + lz * u;
          const hue = (k * 0.17 + s.x0 * 0.01) % 1;
          _c.setHSL(hue, 0.5, 0.45);
          goods.push(box(x - 0.18, s.h * 0.45, z - 0.18, x + 0.18, s.h * 0.45 + 0.3, z + 0.18, _c.getHex()));
        }
      }
    }
    const wallMesh = add(new THREE.Mesh(mergeGeometries(walls), vcMat));
    wallMesh.castShadow = wallMesh.receiveShadow = q.shadows;
    add(new THREE.Mesh(mergeGeometries([...shelves, ...goods]), vcMat));

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
    for (const p of map.props) {
      const s = p.solid;
      if (p.type === 'car') {
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

  setLoot(id, itemId) {
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
