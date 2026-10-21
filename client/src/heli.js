// Hélicoptère de police : silhouette procédurale, rotor, feux de position, faisceau du projecteur (cône additif + tache au sol).
// Aucune vraie lumière : le faisceau est un maillage additif, coût quasi nul.
import * as THREE from 'three';
import { radialTexture } from './cityView.js';

const ALT = 34;

export class Heli {
  constructor(scene) {
    this.scene = scene;
    this.on = false;
    this.lx = 0; this.lz = 0; this.tx = 0; this.tz = 0;
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d2128 });
    const g = (this.body = new THREE.Group());
    const cab = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), dark);
    cab.scale.set(1, 0.85, 1.6);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 5.5, 6), dark);
    tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.3, -4);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), dark);
    fin.position.set(0, 0.8, -6.6);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 3), dark);
    skid.position.y = -1.35;
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.05, 0.3), dark);
    this.rotor.position.y = 1.35;
    const rotor2 = this.rotor.clone(); rotor2.rotation.y = Math.PI / 2; this.rotor.add(rotor2);
    this.navR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.navR.position.set(0, -1.1, 0.5);
    this.navW = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.navW.position.set(0, 1.4, -6.6);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
    lamp.position.set(0, -1.2, 1.4);
    g.add(cab, tail, fin, skid, this.rotor, this.navR, this.navW, lamp);
    // cône du projecteur : sommet en haut (y=1), base au sol (y=0), dégradé vertical
    const cone = new THREE.CylinderGeometry(0.25, 4.5, 1, 20, 1, true);
    cone.translate(0, 0.5, 0);
    this.cone = new THREE.Mesh(cone, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { a: { value: 0.16 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float a; varying float vY; void main(){ gl_FragColor = vec4(vec3(1.0,0.97,0.88) * a * (0.35 + vY * 0.65), 1.0); }',
    }));
    const spotGeo = new THREE.PlaneGeometry(11, 11);
    spotGeo.rotateX(-Math.PI / 2);
    this.spot = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,250,230,0.9)', 'rgba(255,250,230,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.spot.renderOrder = 2;
    for (const o of [g, this.cone, this.spot]) { o.visible = false; o.frustumCulled = false; scene.add(o); }
  }

  // hl : [x, z] du point éclairé (snapshot serveur) ou undefined
  set(hl) {
    if (!hl) { this.on = false; return; }
    if (!this.on) { this.lx = hl[0]; this.lz = hl[1]; this.hx = hl[0] - 14; this.hz = hl[1] - 14; }
    this.on = true; this.tx = hl[0]; this.tz = hl[1];
  }

  update(dt, t, cam) {
    const vis = this.on;
    this.body.visible = this.cone.visible = this.spot.visible = vis;
    if (!vis) return 0;
    const k = Math.min(1, dt * 3);
    this.lx += (this.tx - this.lx) * k; this.lz += (this.tz - this.lz) * k;
    // l'appareil tourne lentement autour de la zone éclairée
    const a = t * 0.12;
    const hx = this.lx + Math.cos(a) * 16, hz = this.lz + Math.sin(a) * 16;
    this.hx += (hx - this.hx) * Math.min(1, dt * 0.8); this.hz += (hz - this.hz) * Math.min(1, dt * 0.8);
    this.body.position.set(this.hx, ALT + Math.sin(t * 0.6) * 0.4, this.hz);
    this.body.rotation.set(0.08, Math.atan2(this.lx - this.hx, this.lz - this.hz), Math.sin(t * 0.4) * 0.05);
    this.rotor.rotation.y = t * 38;
    const blink = Math.floor(t * 1.5) % 2;
    this.navR.visible = !!blink; this.navW.visible = !blink;
    // cône orienté du projecteur vers le sol
    const from = new THREE.Vector3(this.hx, ALT - 1.3, this.hz), to = new THREE.Vector3(this.lx, 0, this.lz);
    const dir = new THREE.Vector3().subVectors(from, to);
    const len = dir.length();
    this.cone.position.copy(to);
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.cone.scale.set(1, len, 1);
    this.spot.position.set(this.lx, 0.2, this.lz);
    // distance pour le son du rotor
    return Math.hypot(cam.x - this.hx, cam.z - this.hz);
  }

  dispose() { for (const o of [this.body, this.cone, this.spot]) this.scene.remove(o); }
}
