// Transports : même interface pour le solo (simulation dans le navigateur) et le multi (WebSocket).
import { World } from '../../shared/world.js';
import { TICK_DT } from '../../shared/config.js';

export class LocalTransport {
  constructor(districtId, name, loadout) {
    this.queue = [];
    this.world = new World(districtId, { snapEvery: 1, pvp: false });
    this.world.addPlayer(1, name, loadout, (m) => this.queue.push(m));
    this.acc = 0;
    this.paused = false;
    this.multi = false;
  }
  send(m) { this.world.onMessage(1, m); }
  poll(dt) {
    if (!this.paused) {
      this.acc = Math.min(this.acc + dt, 0.25);
      while (this.acc >= TICK_DT) { this.world.step(TICK_DT); this.acc -= TICK_DT; }
    }
    const q = this.queue;
    this.queue = [];
    return q;
  }
  close() { this.world = null; }
}

export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.replace(/^http/, 'ws').replace(/\/?$/, '') + '/ws';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

export class NetTransport {
  constructor() {
    this.queue = [];
    this.multi = true;
    this.closed = false;
    this.paused = false;
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(serverUrl()));
      const to = setTimeout(() => { ws.close(); reject(new Error('Serveur injoignable')); }, 6000);
      ws.onopen = () => { clearTimeout(to); resolve(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('Serveur injoignable')); };
      ws.onmessage = (e) => { try { this.queue.push(JSON.parse(e.data)); } catch { /* ignore */ } };
      ws.onclose = () => { this.closed = true; this.queue.push({ t: 'disconnected' }); };
    });
  }
  // attend un message d'un type donné (pour le lobby)
  waitFor(types, ms = 6000) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const tick = () => {
        const i = this.queue.findIndex((m) => types.includes(m.t));
        if (i >= 0) return resolve(this.queue.splice(i, 1)[0]);
        if (performance.now() - t0 > ms || this.closed) return reject(new Error('Pas de réponse du serveur'));
        setTimeout(tick, 30);
      };
      tick();
    });
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  poll() { const q = this.queue; this.queue = []; return q; }
  close() { this.closed = true; this.ws?.close(); }
}
