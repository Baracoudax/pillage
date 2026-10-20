// Moteur de rendu : création du renderer, presets de qualité, résolution dynamique.
import * as THREE from 'three';

export const QUALITY = {
  low:    { label: 'Bas',   maxPR: 1,    minPR: 0.5, shadows: false, lights: 0, fogFar: 70,  drawDist: 60,  particles: 0.35, aa: false },
  medium: { label: 'Moyen', maxPR: 1.25, minPR: 0.6, shadows: false, lights: 2, fogFar: 95,  drawDist: 80,  particles: 0.7,  aa: false },
  high:   { label: 'Haut',  maxPR: 2,    minPR: 0.7, shadows: true,  lights: 4, fogFar: 125, drawDist: 105, particles: 1,    aa: true },
};

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function detectQuality() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isTouch();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  // GPU logiciel / intégré très faible
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  } catch { /* ignore */ }
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return 'low';
  if (mobile) return mem >= 6 && cores >= 8 ? 'medium' : 'low';
  if (/Intel/i.test(gpu) && cores < 8) return 'medium';
  return cores >= 8 ? 'high' : 'medium';
}

export class Gfx {
  constructor(container, qualityName) {
    this.qName = QUALITY[qualityName] ? qualityName : detectQuality();
    this.q = QUALITY[this.qName];
    this.renderer = new THREE.WebGLRenderer({ antialias: this.q.aa, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pr = Math.min(window.devicePixelRatio || 1, this.q.maxPR);
    this.renderer.setPixelRatio(this.pr);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, this.q.fogFar + 10);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.frames = 0; this.acc = 0; this.fps = 60;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 80 : 65; // portrait mobile : champ plus large
    this.camera.updateProjectionMatrix();
  }

  // Ajuste la résolution interne pour tenir ~55-60 FPS.
  adapt(dt) {
    this.frames++; this.acc += dt;
    if (this.acc < 1) return;
    this.fps = this.frames / this.acc;
    this.frames = 0; this.acc = 0;
    const cap = Math.min(window.devicePixelRatio || 1, this.q.maxPR);
    let pr = this.pr;
    if (this.fps < 45) pr -= 0.1;
    else if (this.fps > 57) pr += 0.05;
    pr = Math.max(this.q.minPR, Math.min(cap, pr));
    if (Math.abs(pr - this.pr) > 0.01) {
      this.pr = pr;
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

  render(scene) { this.renderer.render(scene, this.camera); }
}
