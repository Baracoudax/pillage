// Fond animé du menu : travelling lent dans une rue de la Cité en feu, survolée par l'hélicoptère.
import * as THREE from 'three';
import { getMap, STREET, BLOCK } from '../../shared/map.js';
import { CityView, CITY_MODEL_PATHS } from './cityView.js';
import { Fx } from './fx.js';
import { Heli } from './heli.js';
import { loadModel } from './assets.js';

export class Backdrop {
  constructor(gfx) {
    this.gfx = gfx;
    this.scene = null;
    this.t = 0;
    this.loading = null;
  }

  // construit la scène (une seule fois, après le chargement des modèles)
  async start() {
    if (this.scene || this.loading) return this.loading;
    this.loading = Promise.all(CITY_MODEL_PATHS.map(loadModel)).catch(() => {}).then(() => {
      if (this.disposed) return;
      const q = { ...this.gfx.q, shadows: false, lights: Math.min(2, this.gfx.q.lights) };
      const map = (this.map = getMap('cite'));
      const scene = (this.scene = new THREE.Scene());
      scene.background = new THREE.Color(0x1b1820);
      scene.fog = new THREE.Fog(0x1b1820, 14, 85);
      scene.add(new THREE.HemisphereLight(0x9fb0d8, 0x6a4028, 2.4));
      const moon = new THREE.DirectionalLight(0xb4c2ff, 1.3);
      moon.position.set(40, 80, 20);
      scene.add(moon);
      this.city = new CityView(scene, map, q);
      this.fx = new Fx(scene, q, map);
      this.heli = new Heli(scene);
      this.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      this.cam.rotation.order = 'YXZ';
      // rue intérieure parcourue d'un bout à l'autre
      this.z = STREET + BLOCK + STREET / 2;
      this.x0 = 8; this.x1 = map.size - 8;
      this.loading = null;
    });
    return this.loading;
  }

  render(dt) {
    if (!this.scene) return;
    this.t += dt;
    const t = this.t, span = this.x1 - this.x0;
    // aller-retour lent le long de la rue
    const u = (t * 1.3) % (span * 2);
    const fwd = u < span;
    const x = fwd ? this.x0 + u : this.x1 - (u - span);
    const cam = this.cam;
    const c = this.gfx.camera;
    cam.aspect = c.aspect; cam.updateProjectionMatrix();
    cam.position.set(x, 2.1 + Math.sin(t * 0.7) * 0.15, this.z + Math.sin(t * 0.13) * 2.5);
    cam.rotation.set(0.05 + Math.sin(t * 0.21) * 0.04, (fwd ? -Math.PI / 2 : Math.PI / 2) + Math.sin(t * 0.17) * 0.35, 0);
    this.heli.set([x + (fwd ? 22 : -22) + Math.sin(t * 0.3) * 6, this.z + Math.cos(t * 0.25) * 8]);
    this.heli.update(dt, t, cam.position);
    this.fx.update(dt, cam.position, this.map.fires);
    this.city.update(t, 1e9);
    this.gfx.renderer.render(this.scene, cam);
  }

  dispose() {
    this.disposed = true;
    if (!this.scene) return;
    this.city.dispose(); this.fx.dispose(); this.heli.dispose();
    this.scene = null;
  }
}
