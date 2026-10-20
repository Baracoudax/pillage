// Particules (feu, fumée, gaz, étincelles), projectiles et pool de lumières dynamiques.
import * as THREE from 'three';

const VERT = `
attribute float size;
attribute vec4 rgba;
varying vec4 vC;
uniform float scale;
void main() {
  vC = rgba;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vC;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d));
  if (a * vC.a < 0.01) discard;
  gl_FragColor = vec4(vC.rgb, a * vC.a);
}`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.base = new Float32Array(max * 4);
    this.buoy = new Float32Array(max);
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rgba', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, size, life, r, g, b, a, grow = 0, buoy = 0) {
    const i = this.i;
    this.i = (i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grow[i] = grow; this.buoy[i] = buoy;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
  }

  update(dt) {
    const { pos, vel, col, size, life, maxLife, base, grow, buoy } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (col[i * 4 + 3] !== 0) col[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      vel[i * 3 + 1] += buoy[i] * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] += grow[i] * dt;
      const k = Math.max(0, life[i] / maxLife[i]);
      const fade = Math.min(1, k * 3) * Math.min(1, (1 - k) * 8 + 0.2);
      col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1] * (0.6 + 0.4 * k); col[i * 4 + 2] = base[i * 4 + 2];
      col[i * 4 + 3] = base[i * 4 + 3] * fade;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.rgba.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.points); this.geo.dispose(); this.mat.dispose(); }
}

const PROJ_STYLE = {
  bille: { color: 0xcccccc, s: 0.07, g: 4 },
  lbd:   { color: 0x111111, s: 0.09, g: 2.5 },
  pave:  { color: 0x777777, s: 0.18, g: 16 },
  fusee: { color: 0xff3df0, s: 0.12, g: 9, trail: [1, 0.4, 0.9] },
  gaz:   { color: 0x9fa69a, s: 0.11, g: 14, trail: [0.8, 0.8, 0.8] },
};

export class Fx {
  constructor(scene, q, map) {
    this.scene = scene;
    this.q = q;
    this.map = map;
    this.glow = new Particles(scene, Math.round(1400 * q.particles) + 200, true);
    this.smoke = new Particles(scene, Math.round(1600 * q.particles) + 200, false);
    this.proj = new Map();
    this.projGeo = new THREE.SphereGeometry(1, 6, 4);
    this.projMats = {};
    for (const k in PROJ_STYLE) this.projMats[k] = new THREE.MeshBasicMaterial({ color: PROJ_STYLE[k].color });
    this.gas = [];
    this.flashes = [];
    // pool fixe de lumières (nombre constant => pas de recompilation de shaders)
    this.lights = [];
    for (let i = 0; i < q.lights; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 16, 1.6);
      l.position.set(0, -100, 0);
      scene.add(l);
      this.lights.push(l);
    }
    this.fireT = 0;
    this.lightT = 0;
  }

  setScale(h, fov) { const s = h / (2 * Math.tan((fov * Math.PI) / 360)); this.glow.mat.uniforms.scale.value = s; this.smoke.mat.uniforms.scale.value = s; }

  addProj(m) {
    const st = PROJ_STYLE[m.k] || PROJ_STYLE.bille;
    const mesh = new THREE.Mesh(this.projGeo, this.projMats[m.k]);
    mesh.scale.setScalar(st.s);
    mesh.position.set(m.x, m.y, m.z);
    this.scene.add(mesh);
    this.proj.set(m.id, { ...m, mesh, g: st.g, trail: st.trail });
  }
  endProj(m) {
    const p = this.proj.get(m.id);
    if (!p) return;
    this.scene.remove(p.mesh);
    this.proj.delete(m.id);
    if (p.k === 'pave' || p.k === 'bille' || p.k === 'lbd') this.dust(m.x, m.y, m.z, 4);
  }

  hit(x, y, z) {
    for (let i = 0; i < 8; i++) this.glow.emit(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.12, 0.3, 1, 0.9, 0.6, 1);
  }
  dust(x, y, z, n) {
    for (let i = 0; i < n; i++) this.smoke.emit(x, y, z, (Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5), 0.4, 0.8, 0.5, 0.5, 0.5, 0.5, 0.6);
  }
  boom(x, y, z) {
    const colors = [[1, 0.3, 0.9], [0.3, 0.8, 1], [1, 0.85, 0.2], [0.4, 1, 0.4]];
    const c = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 70 * this.q.particles + 20; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.5, v = 4 + Math.random() * 6;
      this.glow.emit(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, 0.18, 0.6 + Math.random() * 0.5, c[0], c[1], c[2], 1, -0.1, -6);
    }
    this.glow.emit(x, y, z, 0, 0, 0, 5, 0.25, 1, 0.9, 0.8, 1, 8);
    for (let i = 0; i < 10; i++) this.smoke.emit(x, y, z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 1.2, 2.5, 0.4, 0.4, 0.42, 0.55, 1.2, 0.2);
    this.flash(x, y + 0.5, z, 0xff88ee, 0.3);
  }
  addGas(x, z, r, ttl) { this.gas.push({ x, z, r, ttl }); }
  flash(x, y, z, color, t) { this.flashes.push({ x, y, z, color, t, t0: t }); }

  update(dt, cam, fires) {
    // feux (émission limitée aux feux proches de la caméra)
    const drawD2 = this.q.drawDist * this.q.drawDist;
    const rate = this.q.particles;
    this.fireT += dt;
    if (this.fireT > 0.05) {
      const k = this.fireT; this.fireT = 0;
      for (const f of fires) {
        const d2 = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2;
        if (d2 > drawD2) continue;
        const n = Math.max(1, Math.round(f.s * 5 * rate * k * 20 * (d2 > 1600 ? 0.4 : 1)));
        for (let i = 0; i < n; i++) {
          const ox = (Math.random() - 0.5) * f.s * 1.6, oz = (Math.random() - 0.5) * f.s * 1.6;
          this.glow.emit(f.x + ox, 0.9 + Math.random() * 0.4, f.z + oz, ox * 0.2, 1.5 + Math.random() * 1.5, oz * 0.2, (0.5 + Math.random() * 0.6) * f.s, 0.5 + Math.random() * 0.4, 1, 0.45 + Math.random() * 0.3, 0.1, 0.85, -0.5 * f.s);
        }
        if (Math.random() < 0.45 * rate) this.smoke.emit(f.x, 2.2, f.z, (Math.random() - 0.5) * 0.4, 1.4, (Math.random() - 0.5) * 0.4, 1.0 * f.s, 4, 0.12, 0.12, 0.13, 0.55, 0.9, 0.1);
        if (Math.random() < 0.08) this.glow.emit(f.x, 1.2, f.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.06, 1.2, 1, 0.7, 0.3, 1, 0, -2);
      }
      for (let i = this.gas.length - 1; i >= 0; i--) {
        const g = this.gas[i];
        g.ttl -= k;
        if (g.ttl <= 0) { this.gas.splice(i, 1); continue; }
        const n = Math.round(6 * rate * k * 20);
        for (let j = 0; j < n; j++) {
          const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * g.r;
          this.smoke.emit(g.x + Math.cos(a) * r, 0.3 + Math.random() * 1.2, g.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 0.15, (Math.random() - 0.5) * 0.6, 1.6, 2.2, 0.82, 0.86, 0.78, 0.35, 0.5);
        }
      }
    }
    // projectiles (simulation locale identique au serveur)
    for (const p of this.proj.values()) {
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      if (p.trail) {
        if (p.k === 'fusee') this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 0.25, 0.3, p.trail[0], p.trail[1], p.trail[2], 1);
        else this.smoke.emit(p.x, p.y, p.z, 0, 0.2, 0, 0.5, 1.2, 0.8, 0.8, 0.8, 0.5, 0.8);
      }
      if (p.y < -2) { this.scene.remove(p.mesh); this.proj.delete(p.id); }
    }
    this.glow.update(dt);
    this.smoke.update(dt);
    // lumières : assignées aux feux les plus proches + flashs
    this.lightT -= dt;
    if (this.lights.length) {
      if (this.lightT <= 0) {
        this.lightT = 0.5;
        const sorted = fires.map((f) => [f, (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2]).sort((a, b) => a[1] - b[1]);
        this.lights.forEach((l, i) => {
          const f = sorted[i]?.[0];
          l.userData.fire = f && sorted[i][1] < 3600 ? f : null;
          if (l.userData.fire) l.position.set(f.x, 1.6, f.z);
        });
      }
      const fl = this.flashes[0];
      this.lights.forEach((l, i) => {
        if (i === this.lights.length - 1 && fl) {
          l.position.set(fl.x, fl.y, fl.z); l.color.set(fl.color); l.intensity = 60 * (fl.t / fl.t0);
          return;
        }
        l.color.set(0xff7a2a);
        l.intensity = l.userData.fire ? (14 + Math.random() * 6) * l.userData.fire.s : 0;
      });
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) if ((this.flashes[i].t -= dt) <= 0) this.flashes.splice(i, 1);
  }

  dispose() {
    this.glow.dispose(this.scene); this.smoke.dispose(this.scene);
    for (const p of this.proj.values()) this.scene.remove(p.mesh);
    for (const l of this.lights) this.scene.remove(l);
    this.projGeo.dispose();
    for (const k in this.projMats) this.projMats[k].dispose();
  }
}
