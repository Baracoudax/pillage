// Personnages 3D animés (Quaternius Universal Base Characters + Universal Animation Library, CC0).
// Les corps de base sont « habillés » par un shader qui peint les vêtements par zone du corps
// (chaussures, pantalon, haut, manches, gants, cagoule), selon la faction. Les accessoires
// (casque, visière, bouclier, gilet, sac, arme) sont des maillages accrochés aux os.
// Optimisation : seuls les N personnages les plus proches sont animés (N selon la qualité) ;
// les autres restent en silhouettes instanciées (chars.js).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './assets.js';
import { WEAPONS } from '../../shared/items.js';

const C = (hex) => new THREE.Color(hex);
const NONE = new THREE.Color(-1, -1, -1);
let base = null;

export async function loadHumans() {
  if (base) return base;
  const [male, female, anims, hair] = await Promise.all(['chars/male', 'chars/female', 'chars/anims', 'chars/hair'].map(loadModel));
  if (!male || !female || !anims) return null;
  const tl = new THREE.TextureLoader();
  const dark = await Promise.all(['male_dark', 'female_dark'].map((n) => tl.loadAsync(import.meta.env.BASE_URL + `models/chars/${n}.webp`).catch(() => null)));
  for (const t of dark) if (t) { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; }
  const clips = {};
  for (const c of anims.animations || []) clips[c.name] = c;
  const hairs = {};
  hair?.scene.updateMatrixWorld(true);
  hair?.scene.traverse((x) => { if (x.isMesh) { x.material = new THREE.MeshLambertMaterial({ map: x.material.map, color: x.material.color }); hairs[x.name] = x; } });
  base = { bodies: [male, female], dark, clips, hairs };
  return base;
}

// ------------------------------------------------------------------ tenues
const HOODIES = [0x121212, 0x1c1c1c, 0x24272d, 0x2b2b2b];
const CASUAL = [0x5b1a1a, 0x22304a, 0x3d4a2a, 0x6a5a40, 0x4a4a4a, 0x7a3b10, 0x2f5f6f, 0x8a8a8a, 0x5a2a6a];
const JEANS = [0x1f2a3a, 0x2b3d5c, 0x161616, 0x3a3a3a, 0x4a3b2a];
const SHOES = [0x111111, 0xdddddd, 0x3a2a1a, 0x222222];

// h : entier pseudo-aléatoire stable par personnage
export function outfitFor(kind, h0, extra = {}) {
  let h = Math.imul(h0 ^ 0x9e3779b9, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  const pick = (a, s) => a[(h >>> s) % a.length];
  const female = (h >>> 17) % 4 === 0;
  const darkSkin = (h >>> 19) % 3 === 0;
  const hair = female ? pick(['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale'], 21) : pick(['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Buzzed+Hair_Beard', 'Hair_SimpleParted+Hair_Beard'], 21);
  const hairColor = C(pick([0x1a1410, 0x2b1d14, 0x4a3420, 0x111111, 0x6b4a2a, 0x8a6a3a], 23));
  const o = { female, darkSkin, hair, hairColor, top: C(pick(CASUAL, 1)), pants: C(pick(JEANS, 5)), shoes: C(pick(SHOES, 9)), hands: NONE, head: NONE, headMode: 0, sleeve: 1, acc: [] };
  switch (kind) {
    case 'rioter':
      o.top = C(pick(HOODIES, 1)); o.pants = C(pick([0x111111, 0x1a1a1a, 0x22252b], 5)); o.shoes = C(0x0c0c0c);
      o.hands = C(0x101010); o.head = C(0x0c0c0c); o.headMode = 1; o.acc = ['hood'];
      break;
    case 'crs':
      o.female = (h >>> 17) % 6 === 0;
      o.top = C(0x1a2130); o.pants = C(0x141923); o.shoes = C(0x0a0a0a); o.hands = C(0x0e0e0e);
      o.acc = ['helmet', 'visor', 'padL', 'padR', 'shield', 'baton'];
      o.weapon = 'lbd';
      break;
    case 'gign':
      o.female = false;
      o.top = C(0x0f1013); o.pants = C(0x0e0f12); o.shoes = C(0x0a0a0a); o.hands = C(0x0c0c0c); o.head = C(0x0b0b0b); o.headMode = 1;
      o.acc = ['helmetGign', 'goggles'];
      o.vest = C(0x262a22); o.vestPlain = true;
      o.weapon = 'm4a1';
      break;
    case 'gj':
      o.vest = C(0xd7f20f);
      if ((h >>> 11) % 3 === 0) o.sign = true;
      break;
    case 'looter':
      if ((h >>> 9) % 3 === 0) { o.head = C(0x0e0e0e); o.headMode = 1; o.acc.push('hood'); }
      o.acc.push('backpack');
      o.pack = C([0x7a2a8a, 0x1d4ed8, 0x9a3412, 0x111111][(h >>> 3) % 4]);
      break;
    case 'player':
      o.top = C(extra.color ?? 0xff7a18);
      o.acc.push('backpack');
      o.pack = C({ sac_plastique: 0xf2f2f2, sac_dos: 0x1d4ed8, sac_sport: 0x111111, sac_rando: 0x9a3412 }[extra.pack] ?? 0x333333);
      if (extra.tenue === 'gilet_jaune') o.vest = C(0xd7f20f);
      if (extra.tenue === 'cagoule') { o.top = C(0x1c1c1c); o.hands = C(0x101010); o.head = C(0x0c0c0c); o.headMode = 1; o.acc.push('hood'); }
      break;
  }
  return o;
}

// ------------------------------------------------------------------ accessoires
// positions en mètres dans le repère du personnage, pose de référence (T-pose)
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
let ACC = null;
function accessories() {
  if (ACC) return ACC;
  const lam = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  ACC = {
    // capuche ouverte sur le visage
    hood:       { bone: 'Head', geo: new THREE.SphereGeometry(0.145, 14, 10, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5), mat: new THREE.MeshLambertMaterial({ color: 0x141414, side: THREE.DoubleSide }), pos: [0, 1.7, -0.025], scale: [1, 1.12, 1.08] },
    helmet:     { bone: 'Head', geo: new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mat: lam(0x1f2738), pos: [0, 1.68, -0.01], scale: [1, 1.05, 1.12] },
    visor:      { bone: 'Head', geo: box(0.25, 0.14, 0.02), mat: lam(0x0d1118), pos: [0, 1.66, 0.155], rot: [-0.15, 0, 0] },
    helmetGign: { bone: 'Head', geo: new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat: lam(0x15171b), pos: [0, 1.69, -0.01], scale: [1, 1, 1.1] },
    goggles:    { bone: 'Head', geo: box(0.2, 0.05, 0.03), mat: lam(0x2b3a30), pos: [0, 1.665, 0.13] },
    padL:       { bone: 'upperarm_l', geo: box(0.17, 0.1, 0.2), mat: lam(0x2c3446), pos: [0.27, 1.5, -0.06] },
    padR:       { bone: 'upperarm_r', geo: box(0.17, 0.1, 0.2), mat: lam(0x2c3446), pos: [-0.27, 1.5, -0.06] },
    // bouclier sur l'avant-bras gauche (en T-pose, l'avant-bras est le long de +X)
    shield:     { bone: 'spine_02', geo: box(0.55, 0.95, 0.03), mat: new THREE.MeshLambertMaterial({ color: 0xa8bccd, transparent: true, opacity: 0.55, depthWrite: false }), pos: [0.12, 1.12, 0.33] },
    baton:      { bone: 'pelvis', geo: box(0.04, 0.5, 0.04), mat: lam(0x111111), pos: [-0.2, 0.85, 0.02] },
    vest:       { bone: 'spine_03', geo: new THREE.CylinderGeometry(0.19, 0.17, 0.42, 12), mat: lam(0xd7f20f, 0x3a4000), pos: [0, 1.25, -0.01], scale: [1.05, 1, 0.72] },
    stripe1:    { bone: 'spine_03', geo: new THREE.CylinderGeometry(0.188, 0.188, 0.035, 12), mat: lam(0xb9c2c9, 0x555555), pos: [0, 1.17, -0.01], scale: [1.07, 1, 0.74] },
    stripe2:    { bone: 'spine_03', geo: new THREE.CylinderGeometry(0.193, 0.193, 0.035, 12), mat: lam(0xb9c2c9, 0x555555), pos: [0, 1.32, -0.01], scale: [1.07, 1, 0.74] },
    tacvest:    { bone: 'spine_03', geo: new THREE.CylinderGeometry(0.2, 0.18, 0.4, 10), mat: lam(0x262a22), pos: [0, 1.26, -0.01], scale: [1.05, 1, 0.78] },
    backpack:   { bone: 'spine_03', geo: box(0.32, 0.4, 0.16), mat: lam(0x333333), pos: [0, 1.24, -0.2] },
    lbd:        { bone: 'hand_r', geo: box(0.4, 0.09, 0.07), mat: lam(0x23262b), pos: [-0.9, 1.45, 0] },
    sign:       { bone: 'spine_03', geo: box(0.04, 0.03, 0.03), mat: lam(0x6b4f2a), pos: [-0.22, 1.45, -0.05], extra: 'sign' },
  };
  return ACC;
}

// ------------------------------------------------------------------ shader « vêtements »
function dressMaterial(src, o, box, skinTex) {
  const m = new THREE.MeshLambertMaterial({ map: skinTex || src.map });
  const u = {
    uMin: { value: box.min.clone() }, uSize: { value: box.getSize(new THREE.Vector3()) },
    uTop: { value: o.top }, uPants: { value: o.pants }, uShoes: { value: o.shoes }, uHands: { value: o.hands },
    uHead: { value: o.head }, uHeadMode: { value: o.headMode }, uSleeve: { value: o.sleeve },
    uVest: { value: o.vest || NONE }, uVestPlain: { value: o.vestPlain ? 1 : 0 },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;
uniform vec3 uMin, uSize, uTop, uPants, uShoes, uHands, uHead, uVest;
uniform float uHeadMode, uSleeve, uVestPlain;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 n = (vBind - uMin) / uSize;
  float t = n.y, ax = abs(n.x - 0.5) * 2.0;
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float shade = 0.7 + 0.45 * smoothstep(0.05, 0.6, lum);
  vec3 cloth = vec3(-1.0);
  if (t < 0.055) cloth = uShoes;
  else if (t < 0.52 && ax < 0.3) cloth = uPants;
  else if (t < 0.86 && (t < 0.835 || ax > 0.075)) {
    if (ax < 0.245) cloth = uTop;
    else if (ax < 0.765) { if (uSleeve > 0.5) cloth = uTop; }
    else cloth = uHands;
  } else if (uHeadMode > 0.5) {
    bool eyes = t > 0.9 && t < 0.935 && n.z > 0.55;
    if (!eyes) cloth = uHead;
  }
  // gilet (jaune fluo avec bandes réfléchissantes, ou gilet tactique) sur le torse
  bool torso = t > 0.56 && t < 0.815 && ax < 0.255;
  if (uVest.x >= 0.0 && torso) {
    bool band = uVestPlain < 0.5 && (abs(t - 0.635) < 0.012 || abs(t - 0.7) < 0.012);
    cloth = band ? vec3(0.85, 0.88, 0.9) : uVest;
    shade = max(shade, 0.95);
  }
  if (cloth.x >= 0.0) diffuseColor.rgb = cloth * shade;
}`);
  };
  m.customProgramCacheKey = () => 'dressed';
  return m;
}

// ------------------------------------------------------------------ un personnage
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();

class Human {
  constructor(scene, kind, h, extra) {
    const o = (this.o = outfitFor(kind, h, extra));
    const b = base.bodies[o.female ? 1 : 0];
    this.root = cloneSkinned(b.scene);
    this.root.updateMatrixWorld(true);
    this.bones = {};
    this.rest = {};
    const skinTex = o.darkSkin ? base.dark[o.female ? 1 : 0] : null;
    this.root.traverse((x) => {
      if (x.isBone) { this.bones[x.name] = x; this.rest[x.name] = x.matrixWorld.clone(); }
      if (!x.isSkinnedMesh) return;
      x.frustumCulled = false;
      x.castShadow = !!extra.shadows;
      const name = x.material.name;
      if (/Hair/.test(name)) x.visible = o.headMode === 0 && !o.acc.some((a) => /helmet|hood/.test(a));
      else if (/Eyes/.test(name)) x.visible = true;
      else {
        x.geometry.computeBoundingBox();
        x.material = dressMaterial(x.material, o, x.geometry.boundingBox, skinTex);
      }
    });
    // accessoires accrochés aux os (transformation calculée en pose de référence)
    const A = accessories();
    const list = [...o.acc];
    if (o.sign) list.push('sign');
    for (const key of list) {
      const a = A[key];
      const bone = this.bones[a.bone];
      if (!bone) continue;
      let mesh;
      if (a.extra === 'sign') {
        // pancarte portée sur l'épaule
        mesh = new THREE.Group();
        const pole = new THREE.Mesh(box(0.03, 1.3, 0.03), a.mat); pole.position.y = 0.35;
        const board = new THREE.Mesh(box(0.62, 0.42, 0.02), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 })); board.position.y = 1.0;
        mesh.add(pole, board);
      } else {
        mesh = new THREE.Mesh(a.geo, key === 'backpack' && o.pack ? new THREE.MeshLambertMaterial({ color: o.pack }) : a.mat);
      }
      const desired = new THREE.Matrix4().compose(tmpV.fromArray(a.pos), tmpQ.setFromEuler(new THREE.Euler(...(a.rot || [0, 0, 0]))), tmpS.fromArray(a.scale || [1, 1, 1]));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(tmpM.copy(bone.matrixWorld).invert().multiply(desired));
      bone.add(mesh);
    }
    // coiffure (si la tête n'est pas couverte)
    const covered = o.headMode > 0 || o.acc.some((a) => /helmet|hood/.test(a));
    if (!covered && base.hairs) {
      for (const hn of o.hair.split('+')) {
        const src = base.hairs[hn];
        if (!src) continue;
        const hm = new THREE.Mesh(src.geometry, src.material.clone());
        hm.material.color.copy(o.hairColor);
        const head = this.bones.Head;
        hm.matrixAutoUpdate = false;
        hm.matrix.copy(tmpM.copy(this.rest.Head).invert().multiply(src.matrixWorld));
        head.add(hm);
      }
    }
    this.weaponObj = null;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    this.cur = null;
    this.key = null;
    scene.add(this.root);
  }

  setWeapon(model, melee) {
    if (this.weaponId === (model?.id ?? null)) return;
    this.weaponId = model?.id ?? null;
    if (this.weaponObj) { this.weaponObj.parent?.remove(this.weaponObj); this.weaponObj = null; }
    if (!model) return;
    const hand = this.bones.hand_r;
    const obj = model.scene.clone();
    // en T-pose la main droite pointe vers -X : canon (−Z du modèle) vers −X, ou manche (+Y) vers l'avant
    const q = melee ? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)) : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const desired = new THREE.Matrix4().compose(new THREE.Vector3(-0.8, 1.43, melee ? -0.05 : 0.0), q, new THREE.Vector3(1, 1, 1));
    // la pose courante n'est plus la T-pose : offset calculé avec la matrice de l'os en pose de référence
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(tmpM.copy(this.rest.hand_r).invert().multiply(desired));
    hand.add(obj);
    this.weaponObj = obj;
  }

  play(name, { once = false, fade = 0.2, speed = 1 } = {}) {
    const clip = base.clips[name];
    if (!clip) return;
    let a = this.actions[name];
    if (!a) { a = this.actions[name] = this.mixer.clipAction(clip); }
    a.timeScale = speed;
    if (this.cur === a && !once) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.enabled = true;
    a.play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false);
    this.cur = a;
    this.curName = name;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.mixer.stopAllAction();
    this.root.traverse((x) => { if (x.isSkinnedMesh) x.material.dispose(); });
  }
}

// ------------------------------------------------------------------ pool + niveau de détail
export class HumanPool {
  constructor(scene, q) {
    this.scene = scene;
    this.cap = q.humans;
    this.shadows = q.shadows;
    this.range2 = (q.humanRange || 35) ** 2;
    this.byKey = new Map();
    this.assignT = 0;
  }
  get ready() { return !!base && this.cap > 0; }

  // cands : [{ key, kind, h, extra, d2 }] ; renvoie l'ensemble des clés rendues en 3D
  assign(cands, dt) {
    this.assignT -= dt;
    if (this.assignT > 0 || !this.ready) return;
    this.assignT = 0.3;
    const want = cands.filter((c) => c.d2 < this.range2).sort((a, b) => a.d2 - b.d2).slice(0, this.cap);
    const keep = new Set(want.map((c) => c.key));
    for (const [k, hu] of this.byKey) if (!keep.has(k)) { hu.dispose(this.scene); this.byKey.delete(k); }
    // créations étalées sur plusieurs passes pour éviter les à-coups
    let budget = 3;
    for (const c of want) if (!this.byKey.has(c.key) && budget-- > 0) {
      const hu = new Human(this.scene, c.kind, c.h, { ...c.extra, shadows: this.shadows });
      hu.key = c.key;
      this.byKey.set(c.key, hu);
    }
    if (budget < 0) this.assignT = 0.05;
    for (const c of want) { const hu = this.byKey.get(c.key); if (hu) hu.lod = c.d2 < 225 ? 1 : c.d2 < 625 ? 2 : 3; }
  }

  has(key) { return this.byKey.has(key); }

  // s : état interpolé { x, z, rot, moving, run, crouch, down, attack, throw, stun, armed, melee, shoot, grab }
  update(key, s, dt, weaponModel) {
    const hu = this.byKey.get(key);
    if (!hu) return;
    hu.root.position.set(s.x, 0, s.z);
    hu.root.rotation.y = s.rot;
    hu.setWeapon(s.down ? null : weaponModel, s.melee);
    let anim, opts = {};
    if (s.down) { anim = 'Death01'; opts.once = true; }
    else if (s.stun) anim = 'Hit_Chest';
    else if (s.attack) { anim = s.armed && !s.melee ? 'Pistol_Shoot' : s.melee ? 'Sword_Attack' : 'Punch_Cross'; opts = { once: true, fade: 0.1, speed: 1.4 }; }
    else if (s.throw) { anim = 'Spell_Simple_Shoot'; opts = { once: true, fade: 0.1 }; }
    else if (s.moving && s.crouch) anim = 'Crouch_Fwd_Loop';
    else if (s.crouch) anim = 'Crouch_Idle_Loop';
    else if (s.moving && s.run) anim = s.sprint ? 'Sprint_Loop' : 'Jog_Fwd_Loop';
    else if (s.moving) anim = 'Walk_Loop';
    else if (hu.o.sign) anim = 'Idle_Torch_Loop';
    else if (s.armed && !s.melee) anim = 'Pistol_Idle_Loop';
    else anim = 'Idle_Loop';
    // une action « une fois » en cours n'est pas interrompue par l'état suivant
    if (hu.cur && hu.curOnce && hu.cur.isRunning() && !s.down) { /* on laisse finir */ }
    else if (anim !== hu.curName || opts.once && !hu.cur?.isRunning()) { hu.play(anim, opts); hu.curOnce = !!opts.once && anim !== 'Death01'; }
    // animation des personnages lointains mise à jour 1 image sur 2 ou 3
    hu.acc = (hu.acc || 0) + dt;
    hu.tick = ((hu.tick || 0) + 1) % (hu.lod || 1);
    if (hu.tick === 0 || opts.once) { hu.mixer.update(hu.acc); hu.acc = 0; }
  }

  dispose() { for (const hu of this.byKey.values()) hu.dispose(this.scene); this.byKey.clear(); }
}

export { WEAPONS };
