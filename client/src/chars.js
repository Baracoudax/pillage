// Rendu instancié des personnages : chaque membre est un InstancedMesh partagé par tous les persos.
// => coût constant (~20 draw calls) même avec 80 PNJ à l'écran.
// Quand des modèles 3D animés seront validés, ce module servira de LOD lointain.
import * as THREE from 'three';

const MAX = 200;
const part = (w, h, d, ox, oy, oz) => new THREE.BoxGeometry(w, h, d).translate(ox, oy, oz);

// géométries (pivot à l'articulation)
const PARTS = {
  legL:    { geo: part(0.19, 0.85, 0.21, 0, -0.425, 0), pivot: [-0.11, 0.85, 0] },
  legR:    { geo: part(0.19, 0.85, 0.21, 0, -0.425, 0), pivot: [0.11, 0.85, 0] },
  torso:   { geo: part(0.48, 0.62, 0.27, 0, 0.31, 0), pivot: [0, 0.85, 0] },
  head:    { geo: part(0.26, 0.29, 0.27, 0, 0.145, 0), pivot: [0, 1.49, 0] },
  armL:    { geo: part(0.14, 0.62, 0.16, 0, -0.29, 0), pivot: [-0.32, 1.43, 0] },
  armR:    { geo: part(0.14, 0.62, 0.16, 0, -0.29, 0), pivot: [0.32, 1.43, 0] },
  // cagoule : bandeau des yeux + capuche
  eyes:    { geo: part(0.2, 0.055, 0.02, 0, 0.19, 0.14), pivot: [0, 1.49, 0] },
  hood:    { geo: part(0.32, 0.34, 0.2, 0, 0.16, -0.06), pivot: [0, 1.49, 0] },
  // CRS
  helmet:  { geo: part(0.34, 0.26, 0.36, 0, 0.19, 0.0), pivot: [0, 1.49, 0] },
  visor:   { geo: part(0.3, 0.16, 0.025, 0, 0.12, 0.19), pivot: [0, 1.49, 0] },
  padL:    { geo: part(0.2, 0.12, 0.26, 0, 0.02, 0), pivot: [-0.32, 1.43, 0] },
  padR:    { geo: part(0.2, 0.12, 0.26, 0, 0.02, 0), pivot: [0.32, 1.43, 0] },
  shield:  { geo: part(0.62, 1.05, 0.04, 0.12, -0.35, 0.3), pivot: [-0.32, 1.43, 0] },
  lbd:     { geo: part(0.11, 0.42, 0.14, 0, -0.66, 0.06), pivot: [0.32, 1.43, 0] },
  // gilets jaunes
  vest:    { geo: part(0.5, 0.5, 0.29, 0, 0.33, 0), pivot: [0, 0.85, 0] },
  stripe:  { geo: part(0.51, 0.045, 0.3, 0, 0, 0), pivot: [0, 0.85, 0] },
  sign:    { geo: part(0.62, 0.42, 0.03, 0, -1.25, 0.05), pivot: [0.32, 1.43, 0] },
  pole:    { geo: part(0.04, 1.0, 0.04, 0, -0.7, 0.05), pivot: [0.32, 1.43, 0] },
  pack:    { geo: part(0.4, 0.46, 0.22, 0, 0.32, -0.24), pivot: [0, 0.85, 0] },
  tacvest: { geo: part(0.52, 0.46, 0.33, 0, 0.36, 0), pivot: [0, 0.85, 0] },
  stick:   { geo: part(0.06, 0.06, 0.75, 0, -0.58, 0.3), pivot: [0.32, 1.43, 0] },
};

const DARK = [0x111111, 0x1a1a1a, 0x222222, 0x2b2b2b, 0x1d2026];
const PANTS = [0x161616, 0x2a2a2a, 0x2b3d5c, 0x1f2a3a];
const SKIN = [0xe0b48f, 0xc68c62, 0x8d5a3b, 0x5e3a26, 0xf1c9a5];
const CASUAL = [0x5b1a1a, 0x22304a, 0x3d4a2a, 0x6a5a40, 0x4a4a4a, 0x7a3b10, 0x2f5f6f];
const PLAYER_COLORS = [0xff7a18, 0x22c55e, 0x3b82f6, 0xe11d48, 0xa855f7, 0xfacc15, 0x14b8a6, 0xf472b6];
const PACK_COLORS = { sac_plastique: 0xf2f2f2, sac_dos: 0x1d4ed8, sac_sport: 0x111111, sac_rando: 0x9a3412 };
const GJ_YELLOW = 0xd7f20f, STRIPE = 0xb9c2c9;

export function playerColor(id) { return PLAYER_COLORS[(id - 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length]; }

export function appearance(kind, id, extra = {}) {
  const look = appearance0(kind, id, extra);
  look.kind = kind;
  return look;
}

function appearance0(kind, id, extra = {}) {
  const h = (id * 2654435761) >>> 0;
  const pick = (arr, s) => arr[(h >>> s) % arr.length];
  if (kind === 'crs') {
    return { torso: 0x1a2130, legs: 0x141923, arm: 0x1a2130, head: 0x1e2533, helmet: 0x1f2738, visor: 0x0d1118, pads: 0x2c3446, shield: 0x9fb0c2, lbd: 0x23262b, aim: true };
  }
  if (kind === 'gign') {
    // noir intégral, cagoule, casque à lunettes, gilet tactique, fusil d'assaut
    return { torso: 0x101114, legs: 0x0e0f12, arm: 0x101114, head: 0x0b0b0b, eyes: 0x6a5040, helmet: 0x15171b, visor: 0x2b3a30, pads: 0x1a1c20, tacvest: 0x262a22, gun: true };
  }
  if (kind === 'looter') {
    // pilleur rival : tenue de rue, sac à dos, parfois capuche ou cagoule
    const top = pick(CASUAL.concat(DARK), 1);
    const masked = (h >>> 9) % 3 === 0;
    return { torso: top, legs: pick(PANTS, 5), arm: top, head: masked ? 0x0e0e0e : pick(SKIN, 7), eyes: masked ? pick(SKIN, 7) : null, hood: (h >>> 13) % 2 ? top : null, pack: [0x7a2a8a, 0x1d4ed8, 0x9a3412, 0x111111][(h >>> 3) % 4] };
  }
  if (kind === 'gj') {
    const shirt = pick(CASUAL, 1);
    return { torso: shirt, legs: pick(PANTS, 5), arm: shirt, head: pick(SKIN, 7), vest: GJ_YELLOW, stripe: STRIPE, sign: (h >>> 11) % 3 === 0 ? 0xf2f2f2 : null };
  }
  if (kind === 'player') {
    const c = extra.color ?? playerColor(id);
    const look = { torso: c, legs: 0x1e1e1e, arm: c, head: SKIN[id % SKIN.length], pack: PACK_COLORS[extra.pack] ?? 0x333333 };
    if (extra.tenue === 'gilet_jaune') { look.vest = GJ_YELLOW; look.stripe = STRIPE; }
    if (extra.tenue === 'cagoule') { look.head = 0x111111; look.eyes = SKIN[id % SKIN.length]; look.hood = 0x111111; look.torso = look.arm = 0x1c1c1c; }
    return look;
  }
  // émeutier cagoulé (black bloc)
  const hood = pick(DARK, 1);
  return { torso: hood, legs: pick(PANTS, 5), arm: hood, head: 0x0e0e0e, eyes: pick(SKIN, 7), hood, stick: (h >>> 12) % 4 === 0 ? 0x5a4632 : null };
}

const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), tmp = new THREE.Matrix4(), rot = new THREE.Matrix4();
const col = new THREE.Color();
// repère arme glTF (avant = -Z, haut = +Y) -> repère du bras (avant = -Y, haut = +Z)
const GUN_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
const mLegL = new THREE.Matrix4(), mLegR = new THREE.Matrix4(), mTorso = new THREE.Matrix4(), mArmL = new THREE.Matrix4(), mArmR = new THREE.Matrix4(), mStripe = new THREE.Matrix4();

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
    // le gilet jaune est réfléchissant : un peu d'émissif pour qu'il ressorte la nuit
    this.meshes.vest.material = new THREE.MeshLambertMaterial({ emissive: 0x3a4000 });
    this.meshes.stripe.material = new THREE.MeshLambertMaterial({ emissive: 0x555555 });
    this.handMatrix = new THREE.Matrix4();
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

  // s = {x, z, rot, phase, moving, run, crouch, down, attack(0..1), stun, throw, aim(-1..1 tangage) }
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
    this.put('legL', look.legs, mLegL.makeRotationX(sw));
    this.put('legR', look.legs, mLegR.makeRotationX(-sw));
    const lean = s.run ? 0.18 : 0;
    const torso = lean ? mTorso.makeRotationX(lean) : null;
    this.put('torso', look.torso, torso);
    this.put('head', look.head, null);
    if (look.eyes) this.put('eyes', look.eyes, null);
    if (look.hood) this.put('hood', look.hood, null);
    if (look.helmet) { this.put('helmet', look.helmet, null); this.put('visor', look.visor, null); }
    if (look.pads) { this.put('padL', look.pads, null); this.put('padR', look.pads, null); }
    if (look.vest) {
      this.put('vest', look.vest, torso);
      for (const y of [0.18, 0.36]) {
        mStripe.makeTranslation(0, y, 0);
        if (torso) mStripe.premultiply(torso);
        this.put('stripe', look.stripe, mStripe);
      }
    }
    if (look.pack) this.put('pack', look.pack, torso);
    if (look.tacvest) this.put('tacvest', look.tacvest, torso);
    // bras : balancement, visée, frappe, lancer, pancarte
    let ar = -sw * 0.8, al = sw * 0.8;
    const armed = look.aim || look.gun;
    if (armed && !s.down) ar = -1.45 - (s.aim || 0);
    if (look.sign && !s.down) ar = -2.9;
    if (s.attack > 0) ar = armed ? ar + 0.25 * s.attack : -2.4 + (1 - s.attack) * 2.2;
    if (s.throw > 0) ar = -2.8 + (1 - s.throw) * 3;
    if (look.shield) al = -1.2;
    else if (look.gun && !s.down) al = -1.35 - (s.aim || 0);
    const armL = mArmL.makeRotationX(al);
    const armR = mArmR.makeRotationX(ar);
    this.put('armL', look.arm, armL);
    this.put('armR', look.arm, armR);
    if (look.shield) this.put('shield', look.shield, null);
    if (look.lbd) this.put('lbd', look.lbd, armR);
    if (look.stick) this.put('stick', look.stick, armR);
    if (look.sign && !s.down) { this.put('pole', 0x6b4f2a, armR); this.put('sign', look.sign, armR); }
    // matrice de la main droite (pour accrocher une arme 3D)
    m4.makeTranslation(0.32, 1.43, 0).multiply(armR);
    this.handMatrix.multiplyMatrices(base, m4).multiply(tmp.makeTranslation(0, -0.58, 0.04)).multiply(GUN_BASIS);
    return this.handMatrix;
  }

  end() {
    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const k in this.meshes) { this.scene.remove(this.meshes[k]); this.meshes[k].dispose(); this.meshes[k].material.dispose?.(); }
    this.mat.dispose();
  }
}
