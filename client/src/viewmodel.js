// Vue à la première personne : arme en main rendue dans une scène dédiée (pas de clipping dans les murs).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS, THROWABLES } from '../../shared/items.js';
import { loadModel, weaponPath } from './assets.js';
import { radialTexture } from './cityView.js';

let envTex = null;

export class ViewModel {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xc8d2ff, 0x5a3a28, 1.6));
    const key = new THREE.DirectionalLight(0xffd2a8, 1.4);
    key.position.set(1, 2, 1);
    this.scene.add(key);
    if (!envTex) {
      const pm = new THREE.PMREMGenerator(renderer);
      envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.35;
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.gun = null;
    this.wid = null;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,230,160,1)', 'rgba(255,140,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flashT = 0;
    this.kick = 0; this.kickRot = 0; this.adsK = 0; this.switchT = 0; this.bobT = 0;
    this.swayX = 0; this.swayY = 0; this.throwT = 0; this.throwMesh = null; this.meleeT = 0;
    this.hip = new THREE.Vector3(); this.ads = new THREE.Vector3();
  }

  async setWeapon(wid) {
    if (wid === this.wid) return;
    this.wid = wid;
    this.switchT = 1;
    const w = WEAPONS[wid];
    if (this.gun) { this.holder.remove(this.gun); this.gun = null; }
    if (!w) return;
    const m = await loadModel(weaponPath(w.model));
    if (!m || this.wid !== wid) return;
    const g = m.scene.clone();
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const b = m.box, cx = (b.min.x + b.max.x) / 2;
    const long = w.slot === 'primary';
    if (long) {
      this.hip.set(0.13 - cx, -0.1 - b.max.y, 0.02 - b.max.z);
      this.ads.set(-cx, -b.max.y + 0.004, 0.1 - b.max.z);
    } else {
      this.hip.set(0.15 - cx, -0.12 - b.max.y, -0.3 - b.max.z);
      this.ads.set(-cx, -b.max.y + 0.002, -0.32 - b.max.z);
    }
    this.flash.position.set(cx, b.max.y - (b.max.y - b.min.y) * 0.22, b.min.z - 0.05);
    this.flash.scale.setScalar(long ? 0.28 : 0.18);
    g.add(this.flash);
    this.gun = g;
    this.holder.add(g);
    this.scope = !!w.zoom;
  }

  fire(strength = 1) {
    this.kick = Math.min(0.09, this.kick + 0.035 * strength);
    this.kickRot = Math.min(0.25, this.kickRot + 0.07 * strength);
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * 6.28;
  }

  async throwAnim(k) {
    this.throwT = 0.55;
    const m = await loadModel(weaponPath(THROWABLES[k].model));
    if (!m) return;
    if (this.throwMesh) this.scene.remove(this.throwMesh);
    this.throwMesh = m.scene.clone();
    this.scene.add(this.throwMesh);
  }
  melee() { this.meleeT = 0.35; }

  update(dt, st) {
    const aspect = window.innerWidth / window.innerHeight;
    if (this.cam.aspect !== aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }
    this.adsK += ((st.ads ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.switchT = Math.max(0, this.switchT - dt * 3);
    this.kick *= Math.exp(-dt * 14);
    this.kickRot *= Math.exp(-dt * 10);
    this.swayX += (-st.lookX * 0.0004 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (st.lookY * 0.0004 - this.swayY) * Math.min(1, dt * 8);
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY));
    if (st.moving) this.bobT += dt * (st.sprint ? 13 : 8.5);
    const bobA = (st.moving ? (st.sprint ? 1.6 : 1) : 0.15) * (1 - this.adsK * 0.85);
    const h = this.holder;
    const k = this.adsK;
    h.position.lerpVectors(this.hip, this.ads, k);
    h.position.x += Math.sin(this.bobT) * 0.012 * bobA + this.swayX;
    h.position.y += -Math.abs(Math.cos(this.bobT)) * 0.012 * bobA + this.swayY - this.switchT * 0.25;
    h.position.z += this.kick;
    let rx = this.kickRot * (1 - k * 0.6), ry = 0, rz = 0;
    if (st.sprint && !st.ads) { rx -= 0.35; ry += 0.6; h.position.x += 0.05; }
    if (st.reload > 0) {
      const r = Math.sin(Math.min(1, st.reload) * Math.PI);
      rx -= r * 0.6; rz += r * 0.5; h.position.y -= r * 0.12;
    }
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      const r = Math.sin((1 - this.meleeT / 0.35) * Math.PI);
      ry -= r * 0.9; h.position.z -= r * 0.15; h.position.x -= r * 0.08;
    }
    h.rotation.set(rx, ry, rz);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.throwMesh) {
      this.throwT -= dt;
      const t = 1 - Math.max(0, this.throwT) / 0.55;
      this.throwMesh.position.set(0.12 - t * 0.1, -0.16 + Math.sin(t * Math.PI) * 0.12, -0.3 - t * 0.5);
      this.throwMesh.rotation.x = t * 4;
      if (this.throwT <= 0) { this.scene.remove(this.throwMesh); this.throwMesh = null; }
      h.position.y -= Math.sin(Math.min(1, t * 1.5) * Math.PI) * 0.1;
    }
    // lunette : on masque l'arme quand on vise
    if (this.gun) this.gun.visible = !(this.scope && k > 0.85);
  }

  render(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.autoClear = true;
  }

  dispose() {
    if (this.gun) this.holder.remove(this.gun);
    this.flash.material.map.dispose();
    this.flash.material.dispose();
  }
}
