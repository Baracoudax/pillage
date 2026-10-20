// Sons synthétisés en WebAudio (aucun fichier à télécharger) + ambiance d'émeute.
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.7; }

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
    src.connect(f).connect(g).connect(this.master);
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
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, dist = 0) {
    if (!this.ctx) return;
    const a = Math.max(0, 1 - dist / 60);
    if (a <= 0.02) return;
    switch (name) {
      case 'swing': this.noiseBurst(0.12, 1800, 1, 0.25 * a); break;
      case 'hit': this.noiseBurst(0.15, 500, 1.5, 0.7 * a); this.tone(90, 0.12, 0.4 * a, 'square', -40); break;
      case 'hurt': this.tone(160, 0.25, 0.3, 'sawtooth', -90); break;
      case 'shoot': this.noiseBurst(0.08, 2500, 2, 0.4 * a); this.tone(300, 0.08, 0.15 * a, 'square', -200); break;
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
      if (Math.random() < 0.35) this.noiseBurst(0.5, 150 + Math.random() * 200, 0.6, 0.15 + Math.random() * 0.2, 'lowpass');
      if (Math.random() < 0.1) this.play('glass', 30 + Math.random() * 20);
    }, 1500);
  }
  stopAmbience() {
    if (!this.amb) return;
    this.amb.src.stop(); this.amb.lfo.stop();
    clearInterval(this.ambT);
    this.amb = null;
  }
}
