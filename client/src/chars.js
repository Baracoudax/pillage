// Rendu instancié des personnages : chaque membre est un InstancedMesh partagé par tous les persos.
// => coût constant (~10 draw calls) même avec 60 émeutiers et CRS à l'écran.
// Quand les assets 3D animés seront fournis, ce module servira de LOD lointain.
import * as THREE from 'three';

const MAX = 160;
const part = (w, h, d, ox, oy, oz) => new THREE.BoxGeometry(w, h, d).translate(ox, oy, oz);

// géométries (pivot à l'articulation)
const PARTS = {
  legL:   { geo: part(0.19, 0.85, 0.21, 0, -0.425, 0), pivot: [-0.11, 0.85, 0] },
  legR:   { geo: part(0.19, 0.85, 0.21, 0, -0.425, 0), pivot: [0.11, 0.85, 0] },
  torso:  { geo: part(0.48, 0.62, 0.27, 0, 0.31, 0), pivot: [0, 0.85, 0] },
  head:   { geo: part(0.26, 0.29, 0.27, 0, 0.145, 0), pivot: [0, 1.49, 0] },
  armL:   { geo: part(0.14, 0.62, 0.16, 0, -0.29, 0), pivot: [-0.32, 1.43, 0] },
  armR:   { geo: part(0.14, 0.62, 0.16, 0, -0.29, 0), pivot: [0.32, 1.43, 0] },
  helmet: { geo: part(0.34, 0.24, 0.36, 0, 0.2, 0.01), pivot: [0, 1.49, 0] },
  shield: { geo: part(0.62, 1.05, 0.05, 0.12, -0.35, 0.28), pivot: [-0.32, 1.43, 0] },
  pack:   { geo: part(0.4, 0.46, 0.22, 0, 0.32, -0.24), pivot: [0, 0.85, 0] },
  stick:  { geo: part(0.06, 0.06, 0.75, 0, -0.58, 0.3), pivot: [0.32, 1.43, 0] },
};

const HOODIES = [0x1c1c1c, 0x4a4a4a, 0x22304a, 0x5b1a1a, 0x3d4a2a, 0xd8d8d8, 0x2a2a2a, 0x6a5a40];
const PANTS = [0x161616, 0x3a3a3a, 0x2b3d5c, 0x1f2a3a];
const SKIN = [0xe0b48f, 0xc68c62, 0x8d5a3b, 0x5e3a26, 0xf1c9a5];
const PLAYER_COLORS = [0xff7a18, 0x22c55e, 0x3b82f6, 0xe11d48, 0xa855f7, 0xfacc15, 0x14b8a6, 0xf472b6];
const PACK_COLORS = { sac_plastique: 0xf2f2f2, sac_dos: 0x1d4ed8, sac_sport: 0x111111, sac_rando: 0x9a3412 };

export function playerColor(id) { return PLAYER_COLORS[(id - 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length]; }

export function appearance(kind, id, extra = {}) {
  const h = (id * 2654435761) >>> 0;
  const pick = (arr, s) => arr[(h >>> s) % arr.length];
  if (kind === 'crs') return { torso: 0x1b2230, legs: 0x151a24, arm: 0x1b2230, head: pick(SKIN, 3), helmet: 0x23293a, shield: 0x8fa3b8, stick: 0x111111 };
  if (kind === 'player') {
    return { torso: extra.color ?? playerColor(id), legs: 0x1e1e1e, arm: extra.color ?? playerColor(id), head: SKIN[id % SKIN.length], pack: PACK_COLORS[extra.pack] ?? 0x333333, stick: extra.stick ? 0x8a8a8a : null, helmet: extra.helmet ? 0x202020 : null };
  }
  const hood = pick(HOODIES, 1);
  const masked = (h >>> 9) % 3 === 0;
  return { torso: hood, legs: pick(PANTS, 5), arm: hood, head: masked ? 0x111111 : pick(SKIN, 7), stick: (h >>> 12) % 4 === 0 ? 0x5a4632 : null };
}

const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), tmp = new THREE.Matrix4(), rot = new THREE.Matrix4();
const col = new THREE.Color();
const mLegL = new THREE.Matrix4(), mLegR = new THREE.Matrix4(), mTorso = new THREE.Matrix4(), mArmL = new THREE.Matrix4(), mArmR = new THREE.Matrix4();

export class CharacterRenderer {
  constructor(scene, shadows) {
    this.scene = scene;
    this.mat = new THREE.MeshLambertMaterial();
    this.meshes = {};
    for (const k in PARTS) {
      const mesh = new THREE.InstancedMesh(PARTS[k].geo, this.mat, MAX);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, col.set(0xffffff));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.meshes[k] = mesh;
    }
  }

  begin() { for (const k in this.meshes) this.meshes[k].count = 0; }

  put(k, color, local) {
    const mesh = this.meshes[k];
    if (mesh.count >= MAX) return;
    const p = PARTS[k].pivot;
    m4.makeTranslation(p[0], p[1], p[2]);
    if (local) m4.multiply(local);
    tmp.multiplyMatrices(base, m4);
    mesh.setMatrixAt(mesh.count, tmp);
    mesh.setColorAt(mesh.count, col.set(color));
    mesh.count++;
  }

  // s = {x, z, rot, phase, moving, run, crouch, down, attack(0..1), stun, throw}
  draw(s, look) {
    base.makeTranslation(s.x, 0, s.z);
    base.multiply(rot.makeRotationY(s.rot));
    if (s.down) {
      base.multiply(tmp.makeTranslation(0, 0.15, 0.9));
      base.multiply(rot.makeRotationX(-Math.PI / 2));
    } else if (s.crouch) {
      base.multiply(tmp.makeScale(1, 0.72, 1));
    }
    if (s.stun) base.multiply(rot.makeRotationZ(Math.sin(s.phase * 3) * 0.12));
    const sw = s.moving && !s.down ? Math.sin(s.phase) * (s.run ? 0.9 : 0.55) : 0;
    const legL = mLegL.makeRotationX(sw);
    const legR = mLegR.makeRotationX(-sw);
    this.put('legL', look.legs, legL);
    this.put('legR', look.legs, legR);
    const lean = s.run ? 0.18 : 0;
    const torso = lean ? mTorso.makeRotationX(lean) : null;
    this.put('torso', look.torso, torso);
    this.put('head', look.head, null);
    if (look.helmet) this.put('helmet', look.helmet, null);
    if (look.pack) this.put('pack', look.pack, torso);
    // bras : balancement ou frappe
    let ar = -sw * 0.8, al = sw * 0.8;
    if (s.attack > 0) ar = -2.4 + (1 - s.attack) * 2.2;
    if (s.throw > 0) ar = -2.8 + (1 - s.throw) * 3;
    if (look.shield) { al = -1.2; }
    const armL = mArmL.makeRotationX(al);
    const armR = mArmR.makeRotationX(ar);
    this.put('armL', look.arm, armL);
    this.put('armR', look.arm, armR);
    if (look.shield) this.put('shield', look.shield, null);
    if (look.stick) this.put('stick', look.stick, armR);
  }

  end() {
    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const k in this.meshes) { this.scene.remove(this.meshes[k]); this.meshes[k].dispose(); }
    this.mat.dispose();
  }
}
