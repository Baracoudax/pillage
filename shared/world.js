// Simulation autoritaire d'un raid. Tourne dans le navigateur en solo, et sur le serveur Node en multi.
// Communication uniquement par messages JSON-compatibles (send(msg) / onMessage(id, msg)).
import { DISTRICTS, PLAYER, NPC_RADIUS, TICK_DT, INTEREST_RADIUS } from './config.js';
import { getMap } from './map.js';
import { ITEMS, GEAR_BY_ID, WEAPONS, FIST, THROWABLES, CONSUMABLES, FREE_STONES, rollItem, sanitizeLoadout, invWeight, invValue, hasFirearm } from './items.js';
import { mulberry32 } from './rng.js';

const GRAVITY = { lbd: 2.5, fusee: 6, mortier: 9, pierre: 16, pave: 16, gaz: 14, fumi: 15, flash: 15, frag: 15, molotov: 15, desenc: 15 };
const FUSE = { fumi: 1.2, flash: 1.4, frag: 2.5, desenc: 1.0, gaz: 99, mortier: 1.7 };
const BOUNCE = new Set(['fumi', 'flash', 'frag', 'desenc']);
export const NPC_RIOTER = 0, NPC_CRS = 1, NPC_GJ = 2, NPC_GIGN = 3;
const isPolice = (n) => n.kind === NPC_CRS || n.kind === NPC_GIGN;
export const F = { MOVE: 1, RUN: 2, CROUCH: 4, DOWN: 8, ATTACK: 16, STUN: 32, THROW: 64, HEAL: 128, SHOOT: 256 };
const HIST = 24;

const r2 = (v) => Math.round(v * 100) / 100;
const angDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class World {
  constructor(districtId, opts = {}) {
    this.d = DISTRICTS[districtId] || DISTRICTS.cite;
    this.map = getMap(this.d.id);
    this.rng = mulberry32((opts.seed ?? Math.random() * 2 ** 31) | 0);
    this.pvp = opts.pvp ?? true;
    this.snapEvery = opts.snapEvery ?? 2;
    this.tick = 0;
    this.time = 0;
    this.duration = this.d.raidTime;
    this.ended = false;
    this.players = new Map();
    this.npcs = [];
    this.proj = [];
    this.gas = [];
    this.smokes = [];
    this.fireZones = [];
    this.mines = new Map();
    this.bags = new Map();
    this.squads = new Map();
    this.corteges = [];
    this.hot = [];
    this.nid = 1000;
    this.heat = 0;
    this.spawnT = 8;
    this.gjT = 40;
    // escalade policière : armes à feu dans le raid -> renforts puis GIGN
    this.armed = false;
    this.gignCalled = false;
    this.gignAt = Infinity;
    this.gunShots = 0;
    this.lastShot = null;
    this.pathBudget = 0;
    this.loot = this.map.lootSpots.map((s, i) => ({ id: i, x: s.x, y: s.y, z: s.z, item: rollItem(s.table, this.d.tier, this.rng), taken: false }));
    for (let i = 0; i < this.d.rioters; i++) this.spawnRioter();
    for (let i = 0; i < Math.ceil(this.d.crsBase / 3); i++) this.spawnSquad(true);
    for (let i = 0; i < (this.d.gj || 1); i++) this.spawnCortege(i === 0);
  }

  // ---------------------------------------------------------------- joueurs
  addPlayer(id, name, loadout, send) {
    const lo = sanitizeLoadout(loadout);
    const sp = this.pickPlayerSpawn();
    const p = {
      id, name: String(name || 'Anonyme').slice(0, 16), send, lo,
      x: sp.x, z: sp.z, rot: 0, pitch: 0, hp: PLAYER.hp, maxHp: PLAYER.hp, st: 'alive',
      inv: [], cap: GEAR_BY_ID[lo.backpack].cap, armor: GEAR_BY_ID[lo.armor],
      speed: GEAR_BY_ID[lo.shoes].speed, gasImmune: GEAR_BY_ID[lo.face].gas, tenue: lo.tenue,
      wp: { melee: WEAPONS[lo.melee] ? lo.melee : null, primary: WEAPONS[lo.primary] ? lo.primary : null, sidearm: WEAPONS[lo.sidearm] ? lo.sidearm : null },
      mag: { primary: 0, sidearm: 0 }, cur: 'melee', armed: hasFirearm(lo),
      ammo: {}, thr: {}, band: lo.cons.bandage,
      fireU: 0, reloadU: 0, reloading: null, cdU: 0, throwU: 0, atkT: -9, shootT: -9, stunU: 0, healU: 0, healRate: 0,
      inGas: false, crowd: 0, ex: 0, crouch: false, sprint: false, moving: false, lastState: this.time, hitCrsT: -99, koT: 0, h: [],
    };
    for (const k of ['a9', 'a762', 'a12', 'a308', 'af', 'am']) p.ammo[k] = lo.cons[k];
    for (const k in THROWABLES) p.thr[k] = lo.cons[k];
    p.thr.pierre = Math.max(p.thr.pierre, FREE_STONES);
    for (const s of ['primary', 'sidearm']) {
      const w = WEAPONS[p.wp[s]];
      if (!w) continue;
      const n = Math.min(w.mag, p.ammo[w.ammo]);
      p.mag[s] = n; p.ammo[w.ammo] -= n;
    }
    if (p.wp.primary) p.cur = 'primary';
    else if (p.wp.sidearm) p.cur = 'sidearm';
    this.players.set(id, p);
    if (p.armed) this.onArmed();
    send({
      t: 'welcome', id, district: this.d.id, time: this.time, duration: this.duration,
      x: p.x, z: p.z, cap: p.cap,
      loot: this.loot.filter((l) => !l.taken).map((l) => [l.id, l.item]),
      bags: [...this.bags.values()].map((b) => [b.id, r2(b.x), r2(b.z)]),
      mines: [...this.mines.values()].map((m) => [m.id, r2(m.x), r2(m.z), r2(m.rot)]),
      players: [...this.players.values()].map((o) => [o.id, o.name]),
      exits: this.map.exits,
    });
    this.bcast({ t: 'pjoin', id, name: p.name });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.st === 'alive' && p.inv.length) this.dropBag(p.x, p.z, p.inv);
    this.players.delete(id);
    this.bcast({ t: 'pleave', id });
  }

  pickPlayerSpawn() {
    const pts = this.map.spawnPoints;
    let best = pts[0], bestScore = -1;
    for (let k = 0; k < 10; k++) {
      const s = pts[Math.floor(this.rng() * pts.length)];
      let dmin = 999;
      for (const n of this.npcs) if (n.kind === NPC_CRS) dmin = Math.min(dmin, Math.hypot(n.x - s.x, n.z - s.z));
      for (const p of this.players.values()) dmin = Math.min(dmin, Math.hypot(p.x - s.x, p.z - s.z) * 1.5);
      if (dmin > bestScore) { bestScore = dmin; best = s; }
    }
    return { x: best.x + (this.rng() - 0.5) * 3, z: best.z + (this.rng() - 0.5) * 3 };
  }

  onMessage(id, m) {
    const p = this.players.get(id);
    if (!p || !m || typeof m !== 'object') return;
    if (p.st !== 'alive') return;
    if (m.t === 'state') this.applyState(p, m);
    else if (m.t === 'act') this.act(p, m);
  }

  applyState(p, m) {
    const x = Number(m.x), z = Number(m.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const dt = Math.max(TICK_DT, this.time - p.lastState);
    p.lastState = this.time;
    p.rot = Number(m.r) || 0;
    p.pitch = Math.max(-1.5, Math.min(1.5, Number(m.p) || 0));
    p.crouch = !!m.c; p.sprint = !!m.s; p.moving = !!m.m;
    if (this.time < p.stunU) {
      if (Math.hypot(x - p.x, z - p.z) > 1.5) p.send({ t: 'pos', x: p.x, z: p.z });
      return;
    }
    const maxD = PLAYER.walk * PLAYER.sprintMult * p.speed * (dt + 0.15) * 1.35 + 0.3;
    let dx = x - p.x, dz = z - p.z;
    const d = Math.hypot(dx, dz);
    let corrected = false;
    if (d > maxD) { dx *= maxD / d; dz *= maxD / d; corrected = true; }
    const nx = p.x + dx, nz = p.z + dz;
    if (this.map.circleBlocked(nx, nz, PLAYER.radius * 0.7)) corrected = true;
    else { p.x = nx; p.z = nz; }
    if (corrected) p.send({ t: 'pos', x: p.x, z: p.z });
  }

  act(p, m) {
    switch (m.a) {
      case 'pick': return this.pick(p, m.id | 0);
      case 'bag': return this.pickBag(p, m.id | 0);
      case 'fire': return this.fire(p, Number(m.yaw) || 0, Number(m.pitch) || 0, !!m.ads, Number(m.rt));
      case 'reload': return this.reload(p);
      case 'switch': {
        const s = ['melee', 'primary', 'sidearm'].includes(m.s) ? m.s : 'melee';
        if ((s !== 'melee' && !p.wp[s]) || p.cur === s) return;
        p.cur = s; p.reloading = null; p.fireU = this.time + 0.35;
        return;
      }
      case 'melee': return this.melee(p, Number(m.yaw) || 0);
      case 'throw': return this.throwItem(p, String(m.k), Number(m.yaw) || 0, Number(m.pitch) || 0);
      case 'heal':
        if (p.band > 0 && p.hp < p.maxHp && this.time > p.healU) {
          p.band--; p.healU = this.time + 3; p.healRate = 35 / 3;
          p.send({ t: 'ev', e: 'heal' });
        }
        return;
      case 'drop': {
        const i = m.i | 0;
        if (i >= 0 && i < p.inv.length) {
          const item = p.inv.splice(i, 1)[0];
          this.dropBag(p.x + Math.sin(p.rot) * 0.8, p.z + Math.cos(p.rot) * 0.8, [item]);
          this.sendInv(p);
        }
      }
    }
  }

  sendInv(p) { p.send({ t: 'inv', inv: p.inv, w: r2(invWeight(p.inv)), cap: p.cap }); }

  pick(p, id) {
    const l = this.loot[id];
    if (!l || l.taken) return;
    if (Math.hypot(l.x - p.x, l.z - p.z) > PLAYER.pickRange + 0.6) return;
    const it = ITEMS[l.item];
    if (invWeight(p.inv) + it.w > p.cap + 1e-6) { p.send({ t: 'ev', e: 'full' }); return; }
    l.taken = true;
    p.inv.push(l.item);
    this.heat = Math.min(100, this.heat + (l.item.startsWith('cash') ? 3 : 1.2));
    this.hot.push({ x: l.x, z: l.z, t: this.time });
    if (this.hot.length > 20) this.hot.shift();
    this.sendInv(p);
    p.send({ t: 'ev', e: 'got', item: l.item });
    this.bcast({ t: 'loot', id });
  }

  pickBag(p, id) {
    const b = this.bags.get(id);
    if (!b || Math.hypot(b.x - p.x, b.z - p.z) > PLAYER.pickRange + 0.6) return;
    let w = invWeight(p.inv), took = 0;
    b.items.sort((a, c) => ITEMS[c].value - ITEMS[a].value);
    for (let i = 0; i < b.items.length; i++) {
      const it = ITEMS[b.items[i]];
      if (w + it.w <= p.cap + 1e-6) { w += it.w; p.inv.push(b.items[i]); b.items.splice(i, 1); i--; took++; }
    }
    if (!took) { p.send({ t: 'ev', e: 'full' }); return; }
    this.sendInv(p);
    p.send({ t: 'ev', e: 'gotbag', n: took });
    if (!b.items.length) { this.bags.delete(id); this.bcast({ t: 'bagdel', id }); }
  }

  dropBag(x, z, items) {
    if (!items.length) return;
    const id = this.nid++;
    this.bags.set(id, { id, x, z, items: items.slice() });
    this.bcast({ t: 'bag', id, x: r2(x), z: r2(z) });
  }

  // ---------------------------------------------------------------- armes
  onArmed() {
    if (this.armed) return;
    this.armed = true;
    this.gignAt = Math.min(this.gignAt, this.time + 150);
    this.bcast({ t: 'ev', e: 'armed' });
  }

  gunfire(p) {
    this.gunShots++;
    this.lastShot = { x: p.x, z: p.z, t: this.time };
    if (!this.gignCalled) {
      this.gignCalled = true;
      this.gignAt = Math.min(this.gignAt, this.time + 35);
      this.bcast({ t: 'ev', e: 'gign', eta: Math.round(this.gignAt - this.time) });
    }
  }

  // le joueur a une arme à feu en main (visible par la police)
  gunOut(p) { return !!WEAPONS[p.wp[p.cur]]?.firearm; }

  reload(p) {
    if (p.cur === 'melee') return;
    const wid = p.wp[p.cur], w = WEAPONS[wid];
    if (!w || p.reloading || p.mag[p.cur] >= w.mag || p.ammo[w.ammo] <= 0) return;
    p.reloading = p.cur;
    p.reloadU = this.time + w.reload;
  }

  fire(p, yaw, pitch, ads, rt) {
    if (p.cur === 'melee') return this.melee(p, yaw);
    const w = WEAPONS[p.wp[p.cur]];
    if (!w || this.time < p.stunU || p.reloading) return;
    if (this.time < p.fireU - 0.04) return;
    if (p.mag[p.cur] <= 0) { this.reload(p); return; }
    p.mag[p.cur]--;
    p.fireU = this.time + 60 / w.rpm;
    p.rot = yaw; p.pitch = pitch;
    p.shootT = this.time;
    const eye = p.crouch ? 1.15 : 1.6;
    if (w.proj) {
      const c = Math.cos(pitch), sx = Math.sin(yaw), sz = Math.cos(yaw);
      this.spawnProj(w.proj, p.x + sx * 0.5, eye - 0.1, p.z + sz * 0.5, sx * c * w.speed, Math.sin(pitch) * w.speed, sz * c * w.speed, p.id, 'p', { ...w, id: p.wp[p.cur] });
    } else this.hitscan(p, yaw, pitch, w, ads, rt, eye);
    this.noise(p.x, p.z, w.noise, p);
    this.heat = Math.min(100, this.heat + (w.firearm ? 0.5 : 0.25));
    if (w.firearm) this.gunfire(p);
    if (p.mag[p.cur] === 0 && p.ammo[w.ammo] > 0) this.reload(p);
  }

  // positions passées pour la compensation de latence
  rewind(e, t) {
    const h = e.h;
    if (!h.length || t >= this.time - 1e-3) return e;
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1][0] <= t) {
        const a = h[i - 1], b = h[i], k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return { x: a[1] + (b[1] - a[1]) * k, z: a[2] + (b[2] - a[2]) * k };
      }
    }
    return { x: h[0][1], z: h[0][2] };
  }

  hitscan(p, yaw, pitch, w, ads, rt, eye) {
    const t = Number.isFinite(rt) ? Math.max(this.time - 0.4, Math.min(this.time, rt)) : this.time;
    const cands = [];
    for (const n of this.npcs) {
      if (n.st === 'down') continue;
      const pos = this.rewind(n, t);
      if ((pos.x - p.x) ** 2 + (pos.z - p.z) ** 2 > w.range * w.range) continue;
      cands.push({ ref: n, x: pos.x, z: pos.z, h: 1.85, isP: false });
    }
    if (this.pvp) for (const o of this.players.values()) {
      if (o === p || o.st !== 'alive') continue;
      const pos = this.rewind(o, t);
      cands.push({ ref: o, x: pos.x, z: pos.z, h: o.crouch ? 1.3 : 1.85, isP: true });
    }
    let spread = w.spread * (ads ? 0.3 : 1) * (p.moving ? 1.8 : 1) * (p.crouch ? 0.75 : 1);
    if (w.zoom && !ads) spread = Math.max(spread, 0.06);
    const ends = [];
    let hitAny = false, head = false;
    const src = { kind: 'player', id: p.id, x: p.x, z: p.z };
    for (let k = 0; k < (w.pellets || 1); k++) {
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * spread;
      const y2 = yaw + Math.cos(a) * r, p2 = pitch + Math.sin(a) * r;
      const dx = Math.sin(y2) * Math.cos(p2), dy = Math.sin(p2), dz = Math.cos(y2) * Math.cos(p2);
      let bt = this.map.ray3(p.x, eye, p.z, dx, dy, dz, w.range), best = null, hs = false;
      const A = dx * dx + dz * dz;
      if (A > 1e-6) for (const c of cands) {
        const ox = p.x - c.x, oz = p.z - c.z;
        const B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - 0.36 * 0.36;
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const tt = (-B - Math.sqrt(disc)) / (2 * A);
        if (tt <= 0 || tt >= bt) continue;
        const y = eye + dy * tt;
        if (y < 0 || y > c.h) continue;
        best = c; bt = tt; hs = y > c.h - 0.3;
      }
      const ex = p.x + dx * bt, ey = eye + dy * bt, ez = p.z + dz * bt;
      ends.push([r2(ex), r2(ey), r2(ez), best ? 1 : 0]);
      if (!best) continue;
      const n = best.ref;
      let dmg = w.dmg * (w.pellets ? Math.max(0.35, 1 - bt / w.range) : 1);
      if (hs) dmg *= best.isP ? 2 : n.kind === NPC_CRS ? 1.6 : n.kind === NPC_GIGN ? 1.4 : 2.2;
      // bouclier des CRS : bloque les tirs de face au corps
      if (!best.isP && n.kind === NPC_CRS && !hs && n.st !== 'down' && this.time >= n.stunU) {
        const toShooter = Math.atan2(p.x - n.x, p.z - n.z);
        if (Math.abs(angDiff(toShooter, n.rot)) < 0.85) {
          if (!w.zoom) { ends[ends.length - 1][3] = 2; this.alertSquad(n, p, true); continue; }
          dmg *= 0.45;
        }
      }
      hitAny = true; head = head || hs;
      this.damage(n, dmg, src, best.isP, 0.08);
    }
    this.bcastNear(p.x, p.z, { t: 'shot', id: p.id, w: p.wp[p.cur], o: [r2(p.x), r2(eye), r2(p.z)], e: ends }, p.id);
    if (hitAny) p.send({ t: 'ev', e: 'hitc', hs: head ? 1 : 0 });
  }

  melee(p, yaw) {
    if (this.time < p.cdU || this.time < p.stunU) return;
    const MELEE = WEAPONS[p.wp.melee] || FIST;
    p.cdU = this.time + MELEE.cd;
    p.atkT = this.time;
    p.rot = yaw;
    let hits = 0;
    const tryHit = (t, isPlayer) => {
      const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
      if (d > MELEE.range + 0.35 || d < 0.01 || hits >= 2) return;
      if (Math.abs(angDiff(Math.atan2(dx, dz), yaw)) > 0.9) return;
      hits++;
      this.damage(t, MELEE.dmg, { kind: 'player', id: p.id, x: p.x, z: p.z }, isPlayer, MELEE.stun);
      this.bcastNear(t.x, t.z, { t: 'fx', k: 'hit', x: r2(t.x), y: 1.3, z: r2(t.z) });
    };
    for (const n of this.npcs) if (n.st !== 'down') tryHit(n, false);
    if (this.pvp) for (const o of this.players.values()) if (o !== p && o.st === 'alive') tryHit(o, true);
    if (hits) p.send({ t: 'ev', e: 'hitc' });
  }

  throwItem(p, k, yaw, pitch) {
    if (!THROWABLES[k] || !(p.thr[k] > 0) || this.time < p.throwU || this.time < p.stunU) return;
    p.thr[k]--;
    p.throwU = this.time + (k === 'pierre' ? 0.55 : 0.9);
    p.atkT = this.time;
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    if (k === 'claymore') {
      const x = p.x + sx * 1.1, z = p.z + sz * 1.1;
      const m = { id: this.nid++, x, z, rot: yaw, owner: p.id, armU: this.time + 1.5 };
      this.mines.set(m.id, m);
      this.bcast({ t: 'mine', id: m.id, x: r2(x), z: r2(z), rot: r2(yaw) });
      return;
    }
    const pc = Math.max(-0.6, Math.min(1.2, pitch + (k === 'pierre' ? 0.12 : 0.25))), v = k === 'pierre' ? 20 : 15;
    this.spawnProj(k, p.x + sx * 0.4, 1.5, p.z + sz * 0.4, sx * Math.cos(pc) * v, Math.sin(pc) * v, sz * Math.cos(pc) * v, p.id, 'p');
  }

  // bruit : attire les CRS, fait fuir la foule
  noise(x, z, radius, p) {
    for (const n of this.npcs) {
      if (n.st === 'down') continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > radius) continue;
      if (isPolice(n)) {
        if (p && n.mode !== 'chase') { this.alertSquad(n, p, false); n.lostT = this.time - 4; }
      } else if (n.kind === NPC_GJ && d < 20) {
        n.mode = 'scatter'; n.fx = x; n.fz = z; n.scatterU = this.time + 4 + this.rng() * 2; n.path = null;
      } else if (n.kind === NPC_RIOTER && d < 12 && n.mode === 'wander' && this.rng() < 0.5) {
        n.mode = 'flee'; n.fleeFrom = null; n.fleePt = { x, z }; n.fleeU = this.time + 4; n.path = null;
      }
    }
  }

  spawnProj(k, x, y, z, vx, vy, vz, owner, ownerKind, w) {
    const pr = { id: this.nid++, k, x, y, z, vx, vy, vz, owner, ok: ownerKind, ttl: (FUSE[k] ?? 3) + 0.01, fuse: FUSE[k], w };
    this.proj.push(pr);
    this.bcastNear(x, z, { t: 'proj', id: pr.id, k, x: r2(x), y: r2(y), z: r2(z), vx: r2(vx), vy: r2(vy), vz: r2(vz) });
  }

  stepProj(dt) {
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const pr = this.proj[i];
      const ox = pr.x, oy = pr.y, oz = pr.z;
      pr.vy -= GRAVITY[pr.k] * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      pr.ttl -= dt;
      const bounce = BOUNCE.has(pr.k);
      let hit = null;
      let end = pr.ttl <= 0;
      if (!end && (pr.y <= 0.05 || this.map.solidAt(pr.x, pr.z, pr.y))) {
        if (bounce) {
          if (pr.y <= 0.05) { pr.y = 0.05; pr.vy = Math.abs(pr.vy) * 0.3; pr.vx *= 0.55; pr.vz *= 0.55; }
          else {
            const bx = !!this.map.solidAt(pr.x, oz, pr.y), bz = !!this.map.solidAt(ox, pr.z, pr.y);
            pr.x = ox; pr.z = oz; pr.y = Math.max(0.05, oy);
            if (bx || !bz) pr.vx *= -0.4;
            if (bz || !bx) pr.vz *= -0.4;
          }
        } else end = true;
      }
      if (!end && !bounce) {
        const test = (t) => {
          if (pr.y > 1.95 || pr.y < 0) return false;
          const sx = pr.x - ox, sz = pr.z - oz, l2 = sx * sx + sz * sz || 1e-9;
          let u = ((t.x - ox) * sx + (t.z - oz) * sz) / l2;
          u = Math.max(0, Math.min(1, u));
          return Math.hypot(ox + sx * u - t.x, oz + sz * u - t.z) < 0.5;
        };
        for (const n of this.npcs) {
          if (n.st === 'down' || (pr.ok === 'n' && pr.owner === n.id)) continue;
          if (pr.ok === 'crs' && isPolice(n)) continue;
          if (pr.ok === 'n' && n.kind === NPC_RIOTER) continue;
          if (test(n)) { hit = n; break; }
        }
        if (!hit) for (const p of this.players.values()) {
          if (p.st !== 'alive' || (pr.ok === 'p' && (pr.owner === p.id || !this.pvp))) continue;
          if (test(p)) { hit = p; break; }
        }
        if (hit) end = true;
      }
      if (!end) continue;
      this.proj.splice(i, 1);
      this.bcastNear(pr.x, pr.z, { t: 'projend', id: pr.id, x: r2(pr.x), y: r2(Math.max(0.05, pr.y)), z: r2(pr.z) });
      this.impact(pr, hit);
    }
  }

  srcOf(pr) {
    const kind = pr.ok === 'p' ? 'player' : pr.ok === 'crs' ? 'crs' : 'rioter';
    return { kind, id: pr.owner, x: pr.x - pr.vx * 0.1, z: pr.z - pr.vz * 0.1 };
  }

  isPlayer(t) { return this.players.get(t.id) === t; }

  explode(x, y, z, R, dmg, stun, src, k = 'boom') {
    this.bcastNear(x, z, { t: 'fx', k, x: r2(x), y: r2(Math.max(0.3, y)), z: r2(z) });
    const hurt = (t, isP) => {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d > R || !this.map.los(x, z, t.x, t.z)) return;
      this.damage(t, dmg * (1 - (d / R) * 0.6), src, isP, stun);
    };
    for (const n of this.npcs) if (n.st !== 'down') hurt(n, false);
    for (const p of this.players.values()) if (p.st === 'alive' && (this.pvp || p.id === src.id || src.kind !== 'player')) hurt(p, true);
    this.noise(x, z, 60, src.kind === 'player' ? this.players.get(src.id) : null);
    this.heat = Math.min(100, this.heat + 2);
  }

  impact(pr, hit) {
    const src = this.srcOf(pr);
    const isP = (t) => this.isPlayer(t);
    switch (pr.k) {
      case 'lbd': if (hit) this.damage(hit, this.armed ? 20 : 16, src, isP(hit), 0.6); break;
      case 'pave': if (hit) this.damage(hit, 9, src, isP(hit), 0.15); break;
      case 'pierre': if (hit) this.damage(hit, 12, src, isP(hit), 0.25); break;
      case 'mortier':
        if (hit) this.damage(hit, pr.w.dmg * 0.5, src, isP(hit), 0);
        this.explode(pr.x, pr.y, pr.z, pr.w.aoe, pr.w.dmg, pr.w.stun, src, 'firework');
        break;
      case 'fusee':
        if (hit) this.damage(hit, pr.w.dmg, src, isP(hit), pr.w.stun);
        this.explode(pr.x, pr.y, pr.z, pr.w.aoe, pr.w.dmg * 0.6, pr.w.stun, src, 'flare');
        break;
      case 'frag': this.explode(pr.x, pr.y, pr.z, 6, 95, 0.6, src); break;
      case 'flash':
      case 'desenc': {
        const R = pr.k === 'flash' ? 7 : 4.5;
        this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'flash', x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), r: R });
        for (const n of this.npcs) if (n.st !== 'down' && Math.hypot(n.x - pr.x, n.z - pr.z) < R && this.map.los(pr.x, pr.z, n.x, n.z)) {
          if (pr.k === 'flash' || n.kind !== NPC_CRS) this.damage(n, 4, src, false, 3);
        }
        for (const p of this.players.values()) if (p.st === 'alive' && Math.hypot(p.x - pr.x, p.z - pr.z) < R && this.map.los(pr.x, pr.z, p.x, p.z)) {
          this.damage(p, pr.k === 'desenc' ? 10 : 2, src, true, pr.k === 'desenc' ? 1.6 : 1.1);
        }
        this.noise(pr.x, pr.z, 40, pr.ok === 'p' ? this.players.get(pr.owner) : null);
        break;
      }
      case 'fumi': {
        const s = { x: pr.x, z: pr.z, r: 5.5, ttl: 15 };
        this.smokes.push(s);
        this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'smoke', x: r2(s.x), z: r2(s.z), r: s.r, ttl: s.ttl });
        break;
      }
      case 'molotov': {
        const f = { x: pr.x, z: pr.z, r: 3.2, ttl: 8, src };
        this.fireZones.push(f);
        this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'fire', x: r2(f.x), z: r2(f.z), r: f.r, ttl: f.ttl });
        break;
      }
      case 'gaz': {
        const g = { x: pr.x, z: pr.z, r: 4.5, ttl: 9 };
        this.gas.push(g);
        this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'gas', x: r2(g.x), z: r2(g.z), r: g.r, ttl: g.ttl });
        for (const n of this.npcs) if (n.kind === NPC_GJ && n.st !== 'down' && Math.hypot(n.x - g.x, n.z - g.z) < 9) {
          n.mode = 'scatter'; n.fx = g.x; n.fz = g.z; n.scatterU = this.time + 6; n.path = null;
        }
        break;
      }
    }
    if (hit && (pr.k === 'lbd' || pr.k === 'pave' || pr.k === 'pierre')) this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'hit', x: r2(pr.x), y: r2(pr.y), z: r2(pr.z) });
  }

  // ligne de vue en tenant compte des fumigènes
  los(x0, z0, x1, z1) {
    if (!this.map.los(x0, z0, x1, z1)) return false;
    for (const s of this.smokes) {
      const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1e-9;
      const u = Math.max(0, Math.min(1, ((s.x - x0) * dx + (s.z - z0) * dz) / l2));
      if (Math.hypot(x0 + dx * u - s.x, z0 + dz * u - s.z) < s.r * 0.85) return false;
    }
    return true;
  }

  damage(t, amount, src, isPlayer, stun = 0) {
    if (isPlayer) {
      if (t.st !== 'alive') return;
      const dmg = amount * (1 - t.armor.reduc);
      t.hp -= dmg;
      if (stun) t.stunU = Math.max(t.stunU, this.time + stun);
      t.send({ t: 'ev', e: 'hurt', d: Math.round(dmg), x: r2(src.x), z: r2(src.z) });
      if (src.kind === 'player' && src.id !== t.id) {
        const atk = this.players.get(src.id);
        if (atk) atk.send({ t: 'ev', e: 'hitc' });
      }
      if (t.hp <= 0) this.koPlayer(t, src.kind === 'gign' ? 'gign' : src.kind === 'crs' || src.kind === 'gas' ? 'arrest' : src.kind === 'player' && src.id !== t.id ? 'pvp' : 'ko', src);
      return;
    }
    const n = t;
    if (n.st === 'down') return;
    n.hp -= amount * (n.kind === NPC_CRS ? 0.75 : n.kind === NPC_GIGN ? 0.55 : 1);
    if (stun) n.stunU = Math.max(n.stunU, this.time + stun);
    if (src.kind === 'player') {
      const p = this.players.get(src.id);
      if (p) {
        if (isPolice(n)) {
          p.hitCrsT = this.time;
          this.heat = Math.min(100, this.heat + 3);
          this.alertSquad(n, p, true);
        } else if (n.kind === NPC_GJ) {
          const g = this.corteges.find((c) => c.id === n.grp);
          if (g) g.hostile.set(p.id, this.time + 60);
        } else if (n.mode !== 'flee') {
          n.mode = 'chase'; n.target = p.id; n.chaseU = this.time + 15;
        }
      }
    }
    if (n.hp <= 0) {
      n.st = 'down';
      n.downU = this.time + (n.kind === NPC_CRS ? 25 : 20);
      n.path = null;
      if (isPolice(n)) this.heat = Math.min(100, this.heat + 5);
      if (n.stolen.length) { this.dropBag(n.x, n.z, n.stolen); n.stolen = []; }
    }
  }

  koPlayer(p, reason, src) {
    p.st = 'ko';
    p.hp = 0;
    p.koT = this.time;
    const lost = p.inv;
    if (lost.length) this.dropBag(p.x, p.z, lost);
    p.inv = [];
    p.send({ t: 'ko', reason, lost, value: invValue(lost) });
    if (src && src.kind === 'player' && src.id !== p.id) {
      const k = this.players.get(src.id);
      if (k) k.send({ t: 'ev', e: 'kill', name: p.name });
    }
  }

  // ---------------------------------------------------------------- PNJ
  newNpc(kind, x, z) {
    const n = {
      id: this.nid++, kind, x, z, rot: this.rng() * 6.28, st: 'ok', mode: isPolice({ kind }) ? 'patrol' : kind === NPC_GJ ? 'march' : 'wander',
      hp: kind === NPC_CRS ? 150 : kind === NPC_GIGN ? 200 : kind === NPC_GJ ? 55 : 60, burst: 0, burstT: 0, flashU: 0, path: null, pi: 0, pathT: 0, target: null, cdU: 0, atkT: -9, stunU: 0,
      thinkT: this.rng(), stolen: [], moving: false, running: false, aggr: 0.3 + this.rng() * 0.7,
      idleU: 0, chaseU: 0, throwU: 0, cdThrow: this.time + this.rng() * 5, sleep: 0, near: 0, h: [],
      shootU: this.time + 1, gasU: this.time + 6 + this.rng() * 8, desU: 0, lx: 0, lz: 0, lostT: 0, vis: false,
    };
    this.npcs.push(n);
    return n;
  }

  spawnRioter() {
    let pt;
    for (let k = 0; k < 10; k++) {
      pt = this.map.streetPts[Math.floor(this.rng() * this.map.streetPts.length)];
      let ok = true;
      for (const p of this.players.values()) if (Math.hypot(p.x - pt.x, p.z - pt.z) < 25) ok = false;
      if (ok) break;
    }
    return this.newNpc(NPC_RIOTER, pt.x, pt.z);
  }

  spawnSquad(initial = false, kind = NPC_CRS) {
    const pts = this.map.edgePoints;
    let pt = pts[0];
    for (let k = 0; k < 12; k++) {
      pt = pts[Math.floor(this.rng() * pts.length)];
      let ok = true;
      for (const p of this.players.values()) if (Math.hypot(p.x - pt.x, p.z - pt.z) < (initial ? 35 : 45)) ok = false;
      if (ok) break;
    }
    const sq = { id: this.nid++, members: [], target: null, retarget: 0 };
    this.squads.set(sq.id, sq);
    sq.kind = kind;
    for (let i = 0; i < (kind === NPC_GIGN ? 4 : 3); i++) {
      let x = pt.x + (i - 1) * 1.4, z = pt.z + (this.rng() - 0.5);
      if (!this.map.walkable(x, z)) { x = pt.x; z = pt.z; }
      const n = this.newNpc(kind, x, z);
      n.sq = sq.id; n.slot = i;
      sq.members.push(n);
    }
    if (kind === NPC_GIGN) {
      // le GIGN se rend directement là où ça a tiré
      if (this.lastShot) sq.target = { x: this.lastShot.x, z: this.lastShot.z }, sq.retarget = this.time + 30;
      this.bcast({ t: 'ev', e: 'gignon' });
    } else if (!initial) this.bcast({ t: 'ev', e: 'sirene' });
  }

  // cortège de gilets jaunes
  spawnCortege(atRoundabout) {
    const start = atRoundabout ? this.map.roundabout : this.map.marchPoints[Math.floor(this.rng() * this.map.marchPoints.length)];
    const g = { id: this.nid++, members: [], target: start, restU: this.time + (atRoundabout ? 20 : 0), hostile: new Map(), stops: 0 };
    const count = 9 + Math.floor(this.rng() * 6);
    for (let i = 0; i < count; i++) {
      let x = start.x + (this.rng() - 0.5) * 6, z = start.z + (this.rng() - 0.5) * 6;
      if (!this.map.walkable(x, z)) { x = start.x; z = start.z; }
      const n = this.newNpc(NPC_GJ, x, z);
      n.grp = g.id; n.slot = i;
      g.members.push(n);
    }
    this.corteges.push(g);
  }

  respawnRioter(n) {
    const i = this.npcs.indexOf(n);
    if (i >= 0) this.npcs.splice(i, 1);
    this.spawnRioter();
  }

  requestPath(n, tx, tz) {
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    n.path = this.map.path(n.x, n.z, tx, tz);
    n.pi = 0;
    return true;
  }

  moveNpc(n, tx, tz, speed, dt) {
    const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const s = Math.min(d, speed * dt);
    [n.x, n.z] = this.map.move(n.x, n.z, (dx / d) * s, (dz / d) * s, NPC_RADIUS);
    const want = Math.atan2(dx, dz);
    n.rot += angDiff(want, n.rot) * Math.min(1, dt * 10);
    n.moving = true;
    n.running = speed > 3.5;
    return d < 0.5;
  }

  followPath(n, speed, dt) {
    if (!n.path || n.pi >= n.path.length) return true;
    const wp = n.path[n.pi];
    if (this.moveNpc(n, wp.x, wp.z, speed, dt)) n.pi++;
    return n.pi >= n.path.length;
  }

  navTo(n, tx, tz, speed, dt) {
    const d = Math.hypot(tx - n.x, tz - n.z);
    if (d < 25 && this.map.walkLine(n.x, n.z, tx, tz)) {
      n.path = null;
      return this.moveNpc(n, tx, tz, speed, dt);
    }
    if ((!n.path || this.time > n.pathT) && this.requestPath(n, tx, tz)) n.pathT = this.time + 1.0 + this.rng() * 0.5;
    if (n.path) return this.followPath(n, speed, dt);
    return this.moveNpc(n, tx, tz, speed, dt);
  }

  randomStreetNear(x, z, R) {
    const pts = this.map.streetPts;
    for (let k = 0; k < 15; k++) {
      const p = pts[Math.floor(this.rng() * pts.length)];
      if (Math.hypot(p.x - x, p.z - z) < R) return p;
    }
    return pts[Math.floor(this.rng() * pts.length)];
  }

  lobAt(n, kind, tx, tz, owner, ownerKind) {
    const dx = tx - n.x, dz = tz - n.z, d = Math.max(1, Math.hypot(dx, dz));
    const vh = 12;
    const tt = d / vh;
    const y0 = 1.7;
    const vy = (0.4 - y0 + 0.5 * GRAVITY[kind] * tt * tt) / tt;
    this.spawnProj(kind, n.x + (dx / d) * 0.5, y0, n.z + (dz / d) * 0.5, (dx / d) * vh, vy, (dz / d) * vh, owner, ownerKind);
  }

  stepRioter(n, dt) {
    if (n.st === 'down') { if (this.time > n.downU) this.respawnRioter(n); return; }
    if (this.time < n.stunU) return;
    n.thinkT -= dt;
    if (n.thinkT <= 0) { n.thinkT = 0.5 + this.rng() * 0.3; this.rioterThink(n); }
    switch (n.mode) {
      case 'wander':
        if (!n.path || n.pi >= n.path.length) {
          if (this.time > n.idleU) {
            const shops = this.map.shops;
            const t = this.rng() < 0.3 && shops.length ? shops[Math.floor(this.rng() * shops.length)].inside : this.randomStreetNear(n.x, n.z, 35);
            if (this.requestPath(n, t.x, t.z)) n.idleU = this.time + 1 + this.rng() * 5;
          }
        } else this.followPath(n, 1.9, dt);
        break;
      case 'chase': {
        const p = this.players.get(n.target);
        if (!p || p.st !== 'alive' || this.time > n.chaseU) { n.mode = 'wander'; n.path = null; break; }
        const d = Math.hypot(p.x - n.x, p.z - n.z);
        if (d > 22) { n.mode = 'wander'; n.path = null; break; }
        if (d < 1.25) {
          n.rot = Math.atan2(p.x - n.x, p.z - n.z);
          if (this.time > n.cdU) {
            n.cdU = this.time + 1.1; n.atkT = this.time;
            this.damage(p, 9, { kind: 'rioter', id: n.id, x: n.x, z: n.z }, true, 0.15);
            if (p.st === 'alive' && p.inv.length && this.rng() < 0.4) {
              let bi = 0;
              for (let i = 1; i < p.inv.length; i++) if (ITEMS[p.inv[i]].value > ITEMS[p.inv[bi]].value) bi = i;
              const item = p.inv.splice(bi, 1)[0];
              n.stolen.push(item);
              this.sendInv(p);
              p.send({ t: 'ev', e: 'stolen', item });
              n.mode = 'flee'; n.fleeFrom = p.id; n.fleePt = null; n.fleeU = this.time + 8; n.path = null;
            }
          }
        } else this.navTo(n, p.x, p.z, 4.5, dt);
        break;
      }
      case 'flee': {
        const p = n.fleeFrom != null ? this.players.get(n.fleeFrom) : null;
        const from = p || n.fleePt;
        if (!from || this.time > n.fleeU) { n.mode = 'wander'; n.path = null; break; }
        if (!n.path || n.pi >= n.path.length) {
          const dx = n.x - from.x, dz = n.z - from.z, d = Math.hypot(dx, dz) || 1;
          const t = this.randomStreetNear(n.x + (dx / d) * 25, n.z + (dz / d) * 25, 18);
          this.requestPath(n, t.x, t.z);
        }
        this.followPath(n, 5.2, dt);
        break;
      }
      case 'throw':
        if (this.time > n.throwU) n.mode = 'wander';
        break;
    }
  }

  rioterThink(n) {
    if (n.mode !== 'wander') return;
    for (const p of this.players.values()) {
      if (p.st !== 'alive' || p.crowd) continue;
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      const range = p.crouch ? 5 : 11;
      const aggr = n.aggr * 0.3 * (p.tenue === 'cagoule' ? 0.25 : 1);
      if (d < range && p.inv.length && this.rng() < aggr && this.los(n.x, n.z, p.x, p.z)) {
        n.mode = 'chase'; n.target = p.id; n.chaseU = this.time + 12; n.path = null;
        p.send({ t: 'ev', e: 'aggro' });
        return;
      }
    }
    if (this.time > n.cdThrow) {
      for (const c of this.npcs) {
        if (!isPolice(c) || c.st === 'down') continue;
        const d = Math.hypot(c.x - n.x, c.z - n.z);
        if (d > 6 && d < 20 && this.los(n.x, n.z, c.x, c.z)) {
          n.rot = Math.atan2(c.x - n.x, c.z - n.z);
          this.lobAt(n, this.rng() < 0.2 ? 'molotov' : 'pave', c.x, c.z, n.id, 'n');
          n.cdThrow = this.time + 3 + this.rng() * 5;
          n.mode = 'throw'; n.throwU = this.time + 0.7; n.atkT = this.time;
          return;
        }
      }
      n.cdThrow = this.time + 1.5;
    }
  }

  alertSquad(n, p, radio) {
    const sq = this.squads.get(n.sq);
    const set = (m) => {
      if (m.st === 'down') return;
      if (m.mode !== 'chase') m.path = null;
      m.mode = 'chase'; m.target = p.id; m.lx = p.x; m.lz = p.z; m.lostT = this.time;
    };
    if (sq) for (const m of sq.members) set(m);
    else set(n);
    if (radio) for (const m of this.npcs) if (isPolice(m) && m.mode !== 'chase' && Math.hypot(m.x - p.x, m.z - p.z) < 30) set(m);
  }

  // facteur de discrétion du joueur (cortège, tenue)
  stealth(p) {
    if (p.crowd === 2) return 0.15;
    if (p.crowd === 1) return 0.45;
    return 1;
  }

  crsThink(n) {
    if (n.mode === 'chase') {
      const p = this.players.get(n.target);
      const d = p ? Math.hypot(p.x - n.x, p.z - n.z) : 99;
      n.vis = !!p && p.st === 'alive' && d < 38 && this.los(n.x, n.z, p.x, p.z);
      // en gilet jaune au milieu du cortège, on se fond dans la masse
      if (n.vis && p.crowd === 2 && d > 6 && this.time - p.shootT > 3 && this.time - p.hitCrsT > 5) n.vis = false;
      if (n.vis) { n.lx = p.x; n.lz = p.z; n.lostT = this.time; }
      return;
    }
    let best = null, bd = 1e9;
    for (const p of this.players.values()) {
      if (p.st !== 'alive') continue;
      const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
      let range = 24 * this.stealth(p) * (this.armed ? 1.15 : 1);
      if (p.crouch) range *= 0.55;
      if (p.sprint) range *= 1.2;
      const armed = this.time - p.shootT < 20 || this.gunOut(p);
      const suspicious = p.inv.length > 0 || armed || this.time - p.hitCrsT < 40 || d < 5;
      if (!suspicious || d > Math.max(range, 3) || d > bd) continue;
      if (d > 5 && Math.abs(angDiff(Math.atan2(dx, dz), n.rot)) > 1.15) continue;
      if (!this.los(n.x, n.z, p.x, p.z)) continue;
      best = p; bd = d;
    }
    if (best) {
      this.alertSquad(n, best, false);
      best.send({ t: 'ev', e: 'spotted' });
      return;
    }
    // gaz sur les cortèges proches
    if (this.time > n.gasU && this.rng() < 0.15) {
      for (const g of this.corteges) {
        const L = g.members.find((m) => m.st !== 'down');
        if (!L) continue;
        const d = Math.hypot(L.x - n.x, L.z - n.z);
        if (d > 8 && d < 22 && this.los(n.x, n.z, L.x, L.z)) {
          n.gasU = this.time + 25 + this.rng() * 15;
          n.atkT = this.time;
          n.rot = Math.atan2(L.x - n.x, L.z - n.z);
          this.lobAt(n, 'gaz', L.x, L.z, n.id, 'crs');
          break;
        }
      }
    }
  }

  stepCrs(n, dt) {
    if (n.st === 'down') {
      if (this.time > n.downU) {
        this.npcs.splice(this.npcs.indexOf(n), 1);
        const sq = this.squads.get(n.sq);
        if (sq) { sq.members.splice(sq.members.indexOf(n), 1); if (!sq.members.length) this.squads.delete(sq.id); }
      }
      return;
    }
    if (this.time < n.stunU) return;
    n.thinkT -= dt;
    if (n.thinkT <= 0) { n.thinkT = 0.3 + this.rng() * 0.2; this.crsThink(n); }
    if (n.mode === 'chase') {
      const p = this.players.get(n.target);
      if (!p || p.st !== 'alive' || this.time - n.lostT > 9) {
        n.mode = 'patrol'; n.path = null;
        const sq = this.squads.get(n.sq);
        if (sq) { sq.target = { x: n.lx, z: n.lz }; sq.retarget = this.time + 12; }
        return;
      }
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (n.vis && d < 5 && this.time > n.desU) {
        // grenade de désencerclement
        n.desU = this.time + 18 + this.rng() * 8;
        n.atkT = this.time;
        this.lobAt(n, 'desenc', p.x, p.z, n.id, 'crs');
        return;
      }
      if (d < 1.6 && n.vis) {
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        if (this.time > n.cdU) {
          n.cdU = this.time + 1.0; n.atkT = this.time;
          this.damage(p, 13, { kind: 'crs', id: n.id, x: n.x, z: n.z }, true, 0.35);
        }
        return;
      }
      if (n.vis && d > 6 && d < 30 && this.time > n.shootU) {
        // face à des pilleurs armés, les CRS tirent plus souvent
        n.shootU = this.time + (this.armed ? 1.4 : 2.0) + this.rng() * 1.5;
        n.atkT = this.time;
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        const err = (this.rng() - 0.5) * (0.08 + d * 0.006) * (p.crouch ? 1.3 : 1) * (p.moving ? 1.6 : 1);
        const yaw = n.rot + err, v = 42;
        this.spawnProj('lbd', n.x + Math.sin(yaw) * 0.5, 1.45, n.z + Math.cos(yaw) * 0.5, Math.sin(yaw) * v, 0.6, Math.cos(yaw) * v, n.id, 'crs');
        return;
      }
      if (n.vis && d > 10 && d < 24 && this.time > n.gasU) {
        n.gasU = this.time + 14 + this.rng() * 10;
        n.atkT = this.time;
        this.lobAt(n, 'gaz', p.x + (this.rng() - 0.5) * 2, p.z + (this.rng() - 0.5) * 2, n.id, 'crs');
        return;
      }
      const speed = !n.vis || d < 14 ? 4.9 : 2.6;
      this.navTo(n, n.vis ? p.x : n.lx, n.vis ? p.z : n.lz, speed, dt);
      return;
    }
    const sq = this.squads.get(n.sq);
    if (!sq) return;
    if (!sq.target || this.time > sq.retarget) {
      const recent = this.hot.filter((h) => this.time - h.t < 70);
      sq.target = recent.length && this.rng() < 0.65 ? recent[Math.floor(this.rng() * recent.length)] : this.randomStreetNear(n.x, n.z, 60);
      sq.retarget = this.time + 25 + this.rng() * 10;
      for (const m of sq.members) m.path = null;
    }
    const off = (n.slot - 1) * 1.5;
    const tx = sq.target.x + off, tz = sq.target.z + (n.slot === 1 ? 1.2 : 0);
    if (Math.hypot(tx - n.x, tz - n.z) > 1.5) {
      this.navTo(n, tx, tz, 2.4, dt);
    } else {
      n.rot += dt * 0.6 * (n.slot - 1 || 0.5);
      if (sq.retarget - this.time > 6) sq.retarget = this.time + 4 + this.rng() * 3;
    }
  }

  // ---- GIGN : fusils d'assaut, tirs en rafale, grenades aveuglantes
  gignThink(n) {
    if (n.mode === 'chase') {
      const p = this.players.get(n.target);
      const d = p ? Math.hypot(p.x - n.x, p.z - n.z) : 99;
      n.vis = !!p && p.st === 'alive' && d < 45 && this.los(n.x, n.z, p.x, p.z);
      if (n.vis && p.crowd === 2 && d > 8 && this.time - p.shootT > 6 && !this.gunOut(p)) n.vis = false;
      if (n.vis) { n.lx = p.x; n.lz = p.z; n.lostT = this.time; }
      return;
    }
    let best = null, bd = 1e9;
    for (const p of this.players.values()) {
      if (p.st !== 'alive') continue;
      const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
      const hot = this.time - p.shootT < 10;
      const range = 40 * (hot ? 1 : this.stealth(p)) * (p.crouch && !hot ? 0.6 : 1);
      const suspicious = p.armed || hot || this.time - p.hitCrsT < 40 || (p.inv.length && d < 12);
      if (!suspicious || d > range || d > bd) continue;
      if (d > 5 && Math.abs(angDiff(Math.atan2(dx, dz), n.rot)) > 1.4) continue;
      if (!this.los(n.x, n.z, p.x, p.z)) continue;
      best = p; bd = d;
    }
    if (best) { this.alertSquad(n, best, true); best.send({ t: 'ev', e: 'spotted', g: 1 }); }
  }

  gignShot(n, p, d) {
    const acc = 0.72 - d * 0.011 - (p.moving ? 0.18 : 0) - (p.crouch ? 0.08 : 0) - (p.crowd ? 0.15 : 0);
    const hit = this.rng() < acc;
    const ox = n.x + Math.sin(n.rot) * 0.5, oz = n.z + Math.cos(n.rot) * 0.5, oy = 1.45;
    let tx = p.x, ty = 1.2, tz = p.z;
    if (!hit) { tx += (this.rng() - 0.5) * 2.5; ty += (this.rng() - 0.3) * 1.2; tz += (this.rng() - 0.5) * 2.5; }
    const dx = tx - ox, dy = ty - oy, dz = tz - oz, L = Math.hypot(dx, dy, dz) || 1;
    let t = hit ? L : this.map.ray3(ox, oy, oz, dx / L, dy / L, dz / L, 80);
    if (hit) t = Math.min(L, this.map.ray3(ox, oy, oz, dx / L, dy / L, dz / L, L + 0.01));
    const really = hit && t >= L - 0.05;
    if (really) this.damage(p, 13, { kind: 'gign', id: n.id, x: n.x, z: n.z }, true, 0.05);
    this.bcastNear(n.x, n.z, { t: 'shot', id: n.id, w: 'm4a1', o: [r2(ox), oy, r2(oz)], e: [[r2(ox + (dx / L) * t), r2(oy + (dy / L) * t), r2(oz + (dz / L) * t), really ? 1 : 0]] });
  }

  stepGign(n, dt) {
    if (n.st === 'down') {
      if (this.time > n.downU) {
        this.npcs.splice(this.npcs.indexOf(n), 1);
        const sq = this.squads.get(n.sq);
        if (sq) { sq.members.splice(sq.members.indexOf(n), 1); if (!sq.members.length) this.squads.delete(sq.id); }
      }
      return;
    }
    if (this.time < n.stunU) { n.burst = 0; return; }
    n.thinkT -= dt;
    if (n.thinkT <= 0) { n.thinkT = 0.25 + this.rng() * 0.15; this.gignThink(n); }
    const sq = this.squads.get(n.sq);
    if (n.mode === 'chase') {
      const p = this.players.get(n.target);
      if (!p || p.st !== 'alive' || this.time - n.lostT > 12) {
        n.mode = 'patrol'; n.path = null; n.burst = 0;
        if (sq) { sq.target = { x: n.lx, z: n.lz }; sq.retarget = this.time + 15; }
        return;
      }
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (n.burst > 0 && this.time >= n.burstT) {
        n.burst--; n.burstT = this.time + 0.11; n.atkT = this.time;
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        if (n.vis) this.gignShot(n, p, d); else n.burst = 0;
        return;
      }
      if (n.vis && d < 14 && this.time > n.flashU) {
        n.flashU = this.time + 22 + this.rng() * 10; n.atkT = this.time;
        this.lobAt(n, 'flash', p.x, p.z, n.id, 'crs');
        return;
      }
      if (n.vis && d < 34 && this.time > n.shootU) {
        n.burst = 3; n.burstT = this.time; n.shootU = this.time + 1.5 + this.rng() * 0.9;
        return;
      }
      if (n.vis && d < 22) {
        // tient la position en se décalant latéralement
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        const side = n.slot % 2 ? 1 : -1, a = n.rot + (Math.PI / 2) * side;
        this.moveNpc(n, n.x + Math.sin(a), n.z + Math.cos(a), 1.2, dt);
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        return;
      }
      this.navTo(n, n.vis ? p.x : n.lx, n.vis ? p.z : n.lz, 4.4, dt);
      return;
    }
    if (!sq) return;
    if (!sq.target || this.time > sq.retarget) {
      const ls = this.lastShot && this.time - this.lastShot.t < 60 ? this.lastShot : null;
      sq.target = ls || this.randomStreetNear(n.x, n.z, 70);
      sq.retarget = this.time + 20 + this.rng() * 10;
      for (const m of sq.members) m.path = null;
    }
    const tx = sq.target.x + (n.slot - 1.5) * 1.3, tz = sq.target.z;
    if (Math.hypot(tx - n.x, tz - n.z) > 1.5) this.navTo(n, tx, tz, 3.4, dt);
    else { n.rot += dt * 0.8 * (n.slot % 2 ? 1 : -1); if (sq.retarget - this.time > 5) sq.retarget = this.time + 3; }
  }

  stepCortege(g, dt) {
    g.members = g.members.filter((m) => this.npcs.includes(m));
    const alive = g.members.filter((m) => m.st !== 'down');
    if (!alive.length) return;
    const L = alive[0];
    // le meneur suit le parcours ; pause au rond-point
    if (L.mode === 'march' && this.time >= L.stunU) {
      if (this.time < g.restU) {
        L.rot += dt * 0.3;
      } else if (this.navTo(L, g.target.x, g.target.z, 1.25, dt)) {
        g.stops++;
        if (g.target === this.map.roundabout) g.restU = this.time + 25;
        const pts = this.map.marchPoints.filter((p) => Math.hypot(p.x - L.x, p.z - L.z) > 20 && Math.hypot(p.x - L.x, p.z - L.z) < 70);
        g.target = g.stops % 3 === 2 ? this.map.roundabout : pts[Math.floor(this.rng() * pts.length)] || this.map.roundabout;
        L.path = null;
      }
    }
    for (let i = 1; i < alive.length; i++) {
      const n = alive[i];
      if (n.mode !== 'march' || this.time < n.stunU) continue;
      const row = Math.floor((i - 1) / 4) + 1, col = ((i - 1) % 4) - 1.5;
      const fx = Math.sin(L.rot), fz = Math.cos(L.rot);
      let tx = L.x - fx * row * 1.3 - fz * col * 1.1, tz = L.z - fz * row * 1.3 + fx * col * 1.1;
      if (this.time < g.restU) { tx += Math.sin(n.id + this.time * 0.2) * 1.5; tz += Math.cos(n.id * 1.7 + this.time * 0.2) * 1.5; }
      const d = Math.hypot(tx - n.x, tz - n.z);
      if (d > 0.6) this.navTo(n, tx, tz, d > 4 ? 3 : 1.5, dt);
    }
  }

  stepGJ(n, dt, g) {
    if (n.st === 'down') {
      if (this.time > n.downU) {
        this.npcs.splice(this.npcs.indexOf(n), 1);
        if (g) g.members.splice(g.members.indexOf(n), 1);
      }
      return;
    }
    if (this.time < n.stunU) return;
    if (n.mode === 'scatter') {
      if (this.time > n.scatterU) { n.mode = 'march'; n.path = null; return; }
      const dx = n.x - n.fx, dz = n.z - n.fz, d = Math.hypot(dx, dz) || 1;
      this.moveNpc(n, n.x + (dx / d) * 3, n.z + (dz / d) * 3, 4.2, dt);
      return;
    }
    // un joueur a frappé le cortège : on le prend à partie
    if (g && g.hostile.size) {
      let tgt = null, bd = 16;
      for (const [pid, until] of g.hostile) {
        if (this.time > until) { g.hostile.delete(pid); continue; }
        const p = this.players.get(pid);
        if (!p || p.st !== 'alive') continue;
        const d = Math.hypot(p.x - n.x, p.z - n.z);
        if (d < bd) { bd = d; tgt = p; }
      }
      if (tgt) {
        n.mode = 'fight';
        if (bd < 1.3) {
          n.rot = Math.atan2(tgt.x - n.x, tgt.z - n.z);
          if (this.time > n.cdU) { n.cdU = this.time + 1.2; n.atkT = this.time; this.damage(tgt, 7, { kind: 'rioter', id: n.id, x: n.x, z: n.z }, true, 0.1); }
        } else this.navTo(n, tgt.x, tgt.z, 4, dt);
        return;
      }
      if (n.mode === 'fight') { n.mode = 'march'; n.path = null; }
    } else if (n.mode === 'fight') n.mode = 'march';
  }

  separate() {
    const A = this.npcs;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.st === 'down') continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        if (b.st === 'down') continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        if (d2 > 0.5 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (0.72 - d) * 0.5;
        [a.x, a.z] = this.map.move(a.x, a.z, (-dx / d) * push, (-dz / d) * push, NPC_RADIUS);
        [b.x, b.z] = this.map.move(b.x, b.z, (dx / d) * push, (dz / d) * push, NPC_RADIUS);
      }
    }
  }

  // ---------------------------------------------------------------- boucle
  step(dt = TICK_DT) {
    if (this.ended) return;
    this.time += dt;
    this.tick++;
    this.pathBudget = 5;
    this.heat = Math.min(100, this.heat + dt * 0.11);

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 14;
      const crs = this.npcs.filter((n) => n.kind === NPC_CRS).length;
      const target = Math.min(36, this.d.crsBase + Math.floor(this.heat / 10) * 2);
      if (crs < target) this.spawnSquad();
    }
    if (this.time >= this.gignAt) {
      this.gignAt = this.time + 40;
      const squads = [...this.squads.values()].filter((q) => q.kind === NPC_GIGN).length;
      if (squads < Math.min(3, 1 + Math.floor(this.gunShots / 60))) this.spawnSquad(false, NPC_GIGN);
    }
    this.gjT -= dt;
    if (this.gjT <= 0) {
      this.gjT = 30;
      // un cortège trop réduit se disperse ; un nouveau se forme ailleurs
      const small = this.corteges.filter((g) => g.members.filter((m) => m.st !== 'down').length < 3);
      for (const g of small) {
        const gone = new Set(g.members.filter((m) => m.st !== 'down' && m.near > 40));
        this.npcs = this.npcs.filter((n) => !gone.has(n));
        g.members = g.members.filter((m) => !gone.has(m));
      }
      this.corteges = this.corteges.filter((g) => g.members.length > 0);
      const live = this.corteges.filter((g) => g.members.filter((m) => m.st !== 'down').length >= 3).length;
      if (live < (this.d.gj || 1)) this.spawnCortege(false);
    }

    const players = [...this.players.values()].filter((p) => p.st === 'alive');
    for (const g of this.corteges) this.stepCortege(g, dt);
    for (let i = 0; i < this.npcs.length; i++) {
      const n = this.npcs[i];
      n.moving = false; n.running = false;
      if ((this.tick + n.id) % 10 === 0) {
        let dm = 1e9;
        for (const p of players) dm = Math.min(dm, Math.hypot(p.x - n.x, p.z - n.z));
        n.near = dm;
      }
      let ndt = dt;
      if (n.near > 110 && n.mode !== 'chase' && n.kind !== NPC_GJ) {
        n.sleep += dt;
        if ((this.tick + n.id) % 4) continue;
        ndt = n.sleep; n.sleep = 0;
      }
      if (n.kind === NPC_CRS) this.stepCrs(n, ndt);
      else if (n.kind === NPC_GIGN) this.stepGign(n, ndt);
      else if (n.kind === NPC_GJ) {
        const g = this.corteges.find((c) => c.id === n.grp);
        this.stepGJ(n, ndt, g);
      } else this.stepRioter(n, ndt);
      if (this.npcs[i] !== n) i--;
    }
    this.separate();
    this.stepProj(dt);

    // historique pour la compensation de latence
    for (const e of this.npcs) { e.h.push([this.time, e.x, e.z]); if (e.h.length > HIST) e.h.shift(); }
    for (const p of this.players.values()) { p.h.push([this.time, p.x, p.z]); if (p.h.length > HIST) p.h.shift(); }

    for (let i = this.gas.length - 1; i >= 0; i--) if ((this.gas[i].ttl -= dt) <= 0) this.gas.splice(i, 1);
    for (let i = this.smokes.length - 1; i >= 0; i--) if ((this.smokes[i].ttl -= dt) <= 0) this.smokes.splice(i, 1);
    for (let i = this.fireZones.length - 1; i >= 0; i--) {
      const f = this.fireZones[i];
      if ((f.ttl -= dt) <= 0) { this.fireZones.splice(i, 1); continue; }
      for (const n of this.npcs) if (n.st !== 'down' && Math.hypot(n.x - f.x, n.z - f.z) < f.r) this.damage(n, 14 * dt, f.src, false);
      for (const p of this.players.values()) if (p.st === 'alive' && Math.hypot(p.x - f.x, p.z - f.z) < f.r) this.damage(p, 14 * dt, { ...f.src, kind: f.src.kind === 'crs' ? 'crs' : 'rioter' }, true);
    }
    // mines claymore
    for (const m of this.mines.values()) {
      if (this.time < m.armU) continue;
      let trig = false;
      for (const n of this.npcs) if (n.st !== 'down' && Math.hypot(n.x - m.x, n.z - m.z) < 2.2) trig = true;
      if (this.pvp) for (const p of this.players.values()) if (p.st === 'alive' && p.id !== m.owner && Math.hypot(p.x - m.x, p.z - m.z) < 2.2) trig = true;
      if (!trig) continue;
      this.mines.delete(m.id);
      this.bcast({ t: 'minedel', id: m.id });
      this.explode(m.x, 0.4, m.z, 5, 85, 0.8, { kind: 'player', id: m.owner, x: m.x, z: m.z });
    }

    for (const p of this.players.values()) {
      if (p.st === 'ko' && this.time - p.koT > 12) p.st = 'gone';
      if (p.st !== 'alive') continue;
      if (this.time < p.healU) p.hp = Math.min(p.maxHp, p.hp + p.healRate * dt);
      if (p.reloading && this.time >= p.reloadU) {
        const w = WEAPONS[p.wp[p.reloading]];
        const need = w.mag - p.mag[p.reloading], take = Math.min(need, p.ammo[w.ammo]);
        p.mag[p.reloading] += take; p.ammo[w.ammo] -= take;
        p.reloading = null;
      }
      if ((this.tick + p.id) % 5 === 0) {
        let c = 0;
        for (const n of this.npcs) if (n.kind === NPC_GJ && n.st !== 'down' && Math.abs(n.x - p.x) < 3.5 && Math.abs(n.z - p.z) < 3.5) c++;
        p.crowd = c >= 3 ? (p.tenue === 'gilet_jaune' ? 2 : 1) : 0;
      }
      p.inGas = false;
      for (const g of this.gas) if (Math.hypot(g.x - p.x, g.z - p.z) < g.r) p.inGas = true;
      if (p.inGas && !p.gasImmune) {
        p.hp -= 6 * dt;
        if (p.hp <= 0) this.koPlayer(p, 'arrest');
        if (p.st !== 'alive') continue;
      }
      let inExit = false;
      for (const e of this.map.exits) {
        if (this.time >= e.activeFrom && Math.hypot(e.x - p.x, e.z - p.z) < PLAYER.extractRadius) inExit = true;
      }
      p.ex = inExit ? p.ex + dt : 0;
      if (p.ex >= PLAYER.extractTime) {
        p.st = 'out';
        const cons = { bandage: p.band, ...p.ammo, ...p.thr };
        cons.pierre = Math.max(0, p.thr.pierre - FREE_STONES);
        for (const s of ['primary', 'sidearm']) { const w = WEAPONS[p.wp[s]]; if (w) cons[w.ammo] += p.mag[s]; }
        p.send({ t: 'out', items: p.inv, value: invValue(p.inv), cons });
        this.bcast({ t: 'ev', e: 'pout', name: p.name });
      }
    }

    if (this.time >= this.duration) {
      for (const p of this.players.values()) if (p.st === 'alive') this.koPlayer(p, 'timeout');
      this.ended = true;
    }
    if (this.tick % this.snapEvery === 0) this.sendSnaps();
  }

  sendSnaps() {
    const R2 = INTEREST_RADIUS * INTEREST_RADIUS;
    const time = r2(this.time), heat = Math.round(this.heat);
    for (const p of this.players.values()) {
      if (p.st === 'out' || p.st === 'gone') continue;
      const pl = [], np = [];
      for (const o of this.players.values()) {
        if (o === p || o.st === 'out' || o.st === 'gone') continue;
        if ((o.x - p.x) ** 2 + (o.z - p.z) ** 2 > R2) continue;
        let f = (o.moving ? F.MOVE : 0) | (o.sprint ? F.RUN : 0) | (o.crouch ? F.CROUCH : 0) | (o.st === 'ko' ? F.DOWN : 0);
        if (this.time - o.atkT < 0.3) f |= F.ATTACK;
        if (this.time - o.shootT < 0.15) f |= F.SHOOT;
        if (this.time < o.stunU) f |= F.STUN;
        if (this.time < o.healU) f |= F.HEAL;
        pl.push([o.id, r2(o.x), r2(o.z), r2(o.rot), f, Math.round((o.hp / o.maxHp) * 100), o.lo.backpack, o.tenue, o.wp[o.cur] || '', r2(o.pitch)]);
      }
      for (const n of this.npcs) {
        if ((n.x - p.x) ** 2 + (n.z - p.z) ** 2 > R2) continue;
        let f = (n.moving ? F.MOVE : 0) | (n.running ? F.RUN : 0) | (n.st === 'down' ? F.DOWN : 0);
        if (this.time - n.atkT < 0.3) f |= n.mode === 'throw' ? F.THROW : F.ATTACK;
        if (this.time < n.stunU) f |= F.STUN;
        np.push([n.id, n.kind, r2(n.x), r2(n.z), r2(n.rot), f]);
      }
      const rl = p.reloading ? r2(Math.max(0, p.reloadU - this.time)) : 0;
      p.send({
        t: 'snap', tm: time, h: heat, p: pl, n: np,
        me: {
          hp: Math.round(p.hp), st: r2(Math.max(0, p.stunU - this.time)), g: p.inGas && !p.gasImmune ? 1 : 0,
          ex: r2(p.ex), am: p.ammo, th: p.thr, mg: p.mag, cur: p.cur, rl, b: p.band, x: r2(p.x), z: r2(p.z), cr: p.crowd,
        },
      });
    }
  }

  bcast(msg) { for (const p of this.players.values()) if (p.st !== 'out') p.send(msg); }
  bcastNear(x, z, msg, except) {
    const R2 = INTEREST_RADIUS * INTEREST_RADIUS;
    for (const p of this.players.values()) {
      if (p.st === 'out' || p.st === 'gone' || p.id === except) continue;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < R2) p.send(msg);
    }
  }
}

void CONSUMABLES;
