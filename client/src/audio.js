// Sons synthétisés en WebAudio (aucun fichier à télécharger) + ambiance d'émeute.
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.7; this.listener = { x: 0, z: 0, yaw: 0 }; this.dest = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  noiseBurst(dur, freq, q, gain, type = 'bandpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.dest || this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain, type = 'sine', slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Son positionné : distance + panoramique stéréo selon l'orientation du joueur
  at(name, x, z) {
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    this.play(name, d, d > 0.5 ? (-dx * Math.cos(L.yaw) + dz * Math.sin(L.yaw)) / d : 0);
  }

  play(name, dist = 0, pan = 0) {
    if (!this.ctx) return;
    const a = Math.max(0, 1 - dist / 60);
    if (a <= 0.02) return;
    this.dest = null;
    if (pan && this.ctx.createStereoPanner) {
      const pn = this.ctx.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, pan * 0.85));
      pn.connect(this.master);
      this.dest = pn;
      setTimeout(() => pn.disconnect(), 3000);
    }
    this.playRaw(name, a);
    this.dest = null;
  }

  playRaw(name, a) {
    switch (name) {
      case 'swing': this.noiseBurst(0.12, 1800, 1, 0.25 * a); break;
      case 'hit': this.noiseBurst(0.15, 500, 1.5, 0.7 * a); this.tone(90, 0.12, 0.4 * a, 'square', -40); break;
      case 'hurt': this.tone(160, 0.25, 0.3, 'sawtooth', -90); break;
      case 'shoot': this.noiseBurst(0.08, 2500, 2, 0.4 * a); this.tone(300, 0.08, 0.15 * a, 'square', -200); break;
      case 'pistol': this.noiseBurst(0.12, 1400, 0.8, 0.9 * a); this.tone(160, 0.08, 0.35 * a, 'square', -100); break;
      case 'rifle': this.noiseBurst(0.16, 900, 0.6, 1.1 * a); this.tone(110, 0.1, 0.45 * a, 'square', -60); break;
      case 'shotgun': this.noiseBurst(0.3, 500, 0.5, 1.3 * a, 'lowpass'); this.tone(80, 0.2, 0.5 * a, 'sawtooth', -40); break;
      case 'sniper': this.noiseBurst(0.45, 700, 0.4, 1.4 * a); this.tone(70, 0.3, 0.5 * a, 'square', -30); break;
      case 'flare': this.noiseBurst(0.35, 2500, 0.5, 0.6 * a, 'highpass'); break;
      case 'reload': this.tone(900, 0.04, 0.12, 'square'); setTimeout(() => this.tone(600, 0.05, 0.12, 'square'), 380); break;
      case 'empty': this.tone(1800, 0.02, 0.1, 'square'); break;
      case 'jump': this.noiseBurst(0.1, 900, 0.8, 0.15); break;
      case 'land': this.noiseBurst(0.14, 250, 0.8, 0.45, 'lowpass'); this.tone(70, 0.1, 0.25, 'sine', -20); break;
      case 'step': this.noiseBurst(0.06, 600 + Math.random() * 400, 1.2, 0.12 * a); break;
      case 'alarm': for (let i = 0; i < 6; i++) setTimeout(() => this.tone(i % 2 ? 950 : 1250, 0.22, 0.12 * Math.max(0.3, a), 'square'), i * 240); break;
      case 'chant': for (let i = 0; i < 4; i++) setTimeout(() => this.noiseBurst(0.35, 380 + (i % 2) * 120, 2.5, 0.22 * a), i * 420); break;
      case 'hitmark': this.tone(2200, 0.04, 0.08, 'triangle'); break;
      case 'lbd': this.noiseBurst(0.18, 900, 0.7, 0.9 * a); break;
      case 'boom': this.noiseBurst(0.9, 200, 0.5, 1.2 * a, 'lowpass'); this.tone(60, 0.6, 0.6 * a, 'sine', -30); break;
      case 'gas': this.noiseBurst(1.4, 3000, 0.3, 0.25 * a, 'highpass'); break;
      case 'pick': this.tone(660, 0.07, 0.15); this.tone(990, 0.1, 0.12); break;
      case 'cash': this.tone(1200, 0.06, 0.15, 'triangle'); setTimeout(() => this.tone(1600, 0.12, 0.15, 'triangle'), 70); break;
      case 'full': this.tone(200, 0.2, 0.2, 'square'); break;
      case 'spotted': this.tone(880, 0.12, 0.2, 'square'); setTimeout(() => this.tone(660, 0.18, 0.2, 'square'), 130); break;
      case 'sirene': this.tone(700, 0.6, 0.06 * Math.max(0.3, a), 'sawtooth', 300); break;
      case 'glass': for (let i = 0; i < 3; i++) setTimeout(() => this.noiseBurst(0.1, 5000 + Math.random() * 3000, 3, 0.3 * a), i * 40); break;
      case 'extract': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.2, 'triangle'), i * 110)); break;
      case 'ko': [400, 300, 200].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 0.25, 'sawtooth'), i * 160)); break;
    }
  }

  // Rotor d'hélicoptère : bruit grave modulé en amplitude (~13 Hz), volume selon la distance
  setRotor(dist) {
    if (!this.ctx) return;
    if (!this.rotor) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const am = this.ctx.createGain(); am.gain.value = 0.5;
      const lfo = this.ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 12.5;
      const lg = this.ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(am).connect(g).connect(this.master);
      src.start(); lfo.start();
      this.rotor = { src, lfo, g };
    }
    const v = dist == null ? 0 : Math.max(0, 1 - dist / 140) ** 1.5 * 0.9;
    this.rotor.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  // Intensité de l'émeute (0-100) : la foule gronde plus fort, sirènes plus fréquentes
  setTension(h) { this.tension = h; if (this.amb) this.amb.g.gain.setTargetAtTime(0.12 + h / 100 * 0.18, this.ctx.currentTime, 1); }

  // sirène deux tons « pin-pon » qui passe au loin, avec effet de distance
  siren(gain = 0.05) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    o.type = 'square'; f.type = 'lowpass'; f.frequency.value = 1400;
    for (let i = 0; i < 8; i++) { o.frequency.setValueAtTime(435, t + i * 0.9); o.frequency.setValueAtTime(580, t + i * 0.9 + 0.45); }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 2.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 7.2);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + 7.3);
  }

  // foule lointaine (bruit filtré modulé) + détonations aléatoires
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 450; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = 0.18;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = this.ctx.createGain(); lg.gain.value = 0.08;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    this.amb = { src, lfo, g };
    this.ambT = setInterval(() => {
      const k = 0.5 + (this.tension || 0) / 100;
      if (Math.random() < 0.35 * k) this.noiseBurst(0.5, 150 + Math.random() * 200, 0.6, 0.15 + Math.random() * 0.2, 'lowpass');
      if (Math.random() < 0.1 * k) this.play('glass', 30 + Math.random() * 20, Math.random() * 2 - 1);
      if (Math.random() < 0.04 * k) this.siren(0.03 + Math.random() * 0.03);
      if (Math.random() < 0.06 * k) this.play('chant', 35 + Math.random() * 15, Math.random() * 2 - 1);
      if (Math.random() < 0.05 * k) this.play('boom', 45 + Math.random() * 12, Math.random() * 2 - 1);
    }, 1500);
  }
  stopAmbience() {
    if (!this.amb) return;
    this.amb.src.stop(); this.amb.lfo.stop();
    if (this.rotor) { this.rotor.src.stop(); this.rotor.lfo.stop(); this.rotor = null; }
    clearInterval(this.ambT);
    this.amb = null;
  }
}
