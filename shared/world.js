// Simulation autoritaire d'un raid. Tourne dans le navigateur en solo, et sur le serveur Node en multi.
// Communication uniquement par messages JSON-compatibles (send(msg) / onMessage(id, msg)).
import { DISTRICTS, PLAYER, NPC_RADIUS, TICK_DT, INTEREST_RADIUS } from './config.js';
import { getMap } from './map.js';
import { ITEMS, GEAR, GEAR_BY_ID, rollItem, sanitizeLoadout, invWeight, invValue, holdTime } from './items.js';
import { mulberry32 } from './rng.js';

const GRAVITY = { bille: 4, lbd: 2.5, fusee: 9, pave: 16, gaz: 14 };
export const NPC_RIOTER = 0, NPC_CRS = 1;
export const F = { MOVE: 1, RUN: 2, CROUCH: 4, DOWN: 8, ATTACK: 16, STUN: 32, THROW: 64, HEAL: 128 };

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
    this.bags = new Map();
    this.squads = new Map();
    this.hot = [];
    this.nid = 1000;
    this.heat = 0;
    this.spawnT = 8;
    this.pathBudget = 0;
    this.loot = this.map.lootSpots.map((s, i) => ({ id: i, x: s.x, y: s.y, z: s.z, item: rollItem(s.table, this.d.tier, this.rng), taken: false }));
    for (let i = 0; i < this.d.rioters; i++) this.spawnRioter();
    for (let i = 0; i < Math.ceil(this.d.crsBase / 3); i++) this.spawnSquad(true);
  }

  // ---------------------------------------------------------------- joueurs
  addPlayer(id, name, loadout, send) {
    const lo = sanitizeLoadout(loadout);
    const sp = this.pickPlayerSpawn();
    const armor = GEAR_BY_ID[lo.armor];
    const p = {
      id, name: String(name || 'Anonyme').slice(0, 16), send, lo,
      x: sp.x, z: sp.z, rot: 0, hp: PLAYER.hp, maxHp: PLAYER.hp, st: 'alive',
      inv: [], cap: GEAR_BY_ID[lo.backpack].cap, weapon: GEAR_BY_ID[lo.weapon], armor,
      speed: GEAR_BY_ID[lo.shoes].speed, gasImmune: GEAR_BY_ID[lo.face].gas,
      ammo: { bille: lo.cons.bille, fusee: lo.cons.fusee }, band: lo.cons.bandage,
      cdU: 0, atkT: -9, stunU: 0, healU: 0, healRate: 0, inGas: false, ex: 0,
      crouch: false, sprint: false, moving: false, lastState: this.time, hitCrsT: -99, koT: 0,
    };
    this.players.set(id, p);
    send({
      t: 'welcome', id, district: this.d.id, time: this.time, duration: this.duration,
      x: p.x, z: p.z, cap: p.cap,
      loot: this.loot.filter((l) => !l.taken).map((l) => [l.id, l.item]),
      bags: [...this.bags.values()].map((b) => [b.id, r2(b.x), r2(b.z)]),
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
    if (this.map.circleBlocked(nx, nz, PLAYER.radius * 0.7)) { corrected = true; }
    else { p.x = nx; p.z = nz; }
    if (corrected) p.send({ t: 'pos', x: p.x, z: p.z });
  }

  act(p, m) {
    switch (m.a) {
      case 'pick': return this.pick(p, m.id | 0);
      case 'bag': return this.pickBag(p, m.id | 0);
      case 'atk': return this.attack(p, Number(m.yaw) || 0, Number(m.pitch) || 0, !!m.alt);
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

  // ---------------------------------------------------------------- combat
  attack(p, yaw, pitch, alt) {
    if (this.time < p.cdU || this.time < p.stunU) return;
    const w = p.weapon;
    const ranged = w.type === 'ranged' && !alt && p.ammo[w.ammo] > 0;
    const use = ranged || w.type === 'melee' ? w : GEAR.weapon[0];
    p.cdU = this.time + use.cd;
    p.atkT = this.time;
    p.rot = yaw;
    if (ranged) {
      p.ammo[w.ammo]--;
      const pc = Math.max(-0.5, Math.min(0.6, pitch));
      const c = Math.cos(pc);
      const sx = Math.sin(yaw), sz = Math.cos(yaw);
      this.spawnProj(w.ammo, p.x + sx * 0.5, 1.45, p.z + sz * 0.5, sx * c * w.speed, Math.sin(pc) * w.speed + 1.5, sz * c * w.speed, p.id, 'p', w);
      return;
    }
    // mêlée : arc frontal
    let hits = 0;
    const tryHit = (t, isPlayer) => {
      const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
      if (d > use.range + 0.35 || d < 0.01) return;
      if (Math.abs(angDiff(Math.atan2(dx, dz), yaw)) > 1.0) return;
      if (hits >= 2) return;
      hits++;
      this.damage(t, use.dmg, { kind: 'player', id: p.id, x: p.x, z: p.z }, isPlayer, 0.25);
      this.bcastNear(t.x, t.z, { t: 'fx', k: 'hit', x: r2(t.x), y: 1.3, z: r2(t.z) });
    };
    for (const n of this.npcs) if (n.st !== 'down') tryHit(n, false);
    if (this.pvp) for (const o of this.players.values()) if (o !== p && o.st === 'alive') tryHit(o, true);
    if (hits) p.send({ t: 'ev', e: 'hitc' });
  }

  spawnProj(k, x, y, z, vx, vy, vz, owner, ownerKind, w) {
    const pr = { id: this.nid++, k, x, y, z, vx, vy, vz, owner, ok: ownerKind, ttl: 3, w };
    this.proj.push(pr);
    this.bcastNear(x, z, { t: 'proj', id: pr.id, k, x: r2(x), y: r2(y), z: r2(z), vx: r2(vx), vy: r2(vy), vz: r2(vz) });
  }

  stepProj(dt) {
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const pr = this.proj[i];
      const ox = pr.x, oz = pr.z;
      pr.vy -= GRAVITY[pr.k] * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      pr.ttl -= dt;
      let hit = null, end = pr.ttl <= 0 || pr.y <= 0.05 || !!this.map.solidAt(pr.x, pr.z, pr.y);
      if (!end) {
        const test = (t) => {
          if (pr.y > 1.95 || pr.y < 0) return false;
          // distance du segment au personnage
          const sx = pr.x - ox, sz = pr.z - oz, l2 = sx * sx + sz * sz || 1e-9;
          let u = ((t.x - ox) * sx + (t.z - oz) * sz) / l2;
          u = Math.max(0, Math.min(1, u));
          return Math.hypot(ox + sx * u - t.x, oz + sz * u - t.z) < 0.5;
        };
        for (const n of this.npcs) {
          if (n.st === 'down' || (pr.ok === 'n' && pr.owner === n.id)) continue;
          if (pr.ok === 'crs' && n.kind === NPC_CRS) continue;
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

  impact(pr, hit) {
    const src = pr.ok === 'p'
      ? { kind: 'player', id: pr.owner, x: pr.x - pr.vx * 0.1, z: pr.z - pr.vz * 0.1 }
      : { kind: pr.ok === 'crs' ? 'crs' : 'rioter', id: pr.owner, x: pr.x - pr.vx * 0.1, z: pr.z - pr.vz * 0.1 };
    const isP = (t) => this.players.has(t.id) && this.players.get(t.id) === t;
    switch (pr.k) {
      case 'bille': if (hit) this.damage(hit, pr.w.dmg, src, isP(hit), 0.2); break;
      case 'lbd': if (hit) this.damage(hit, 16, src, isP(hit), 0.6); break;
      case 'pave': if (hit) this.damage(hit, 9, src, isP(hit), 0.15); break;
      case 'fusee': {
        this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'boom', x: r2(pr.x), y: r2(Math.max(0.3, pr.y)), z: r2(pr.z) });
        const R = pr.w.aoe;
        for (const n of this.npcs) if (n.st !== 'down' && Math.hypot(n.x - pr.x, n.z - pr.z) < R) this.damage(n, pr.w.dmg, src, false, pr.w.stun);
        for (const p of this.players.values()) {
          if (p.st !== 'alive' || (!this.pvp && p.id !== pr.owner)) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) < R) this.damage(p, p.id === pr.owner ? 8 : pr.w.dmg, src, true, p.id === pr.owner ? 0.5 : pr.w.stun);
        }
        this.heat = Math.min(100, this.heat + 2);
        break;
      }
      case 'gaz': {
        const g = { x: pr.x, z: pr.z, r: 4.5, ttl: 9 };
        this.gas.push(g);
        this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'gas', x: r2(g.x), z: r2(g.z), r: g.r, ttl: g.ttl });
        break;
      }
    }
    if (hit && pr.k !== 'fusee') this.bcastNear(pr.x, pr.z, { t: 'fx', k: 'hit', x: r2(pr.x), y: r2(pr.y), z: r2(pr.z) });
  }

  damage(t, amount, src, isPlayer, stun = 0) {
    if (isPlayer) {
      if (t.st !== 'alive') return;
      const dmg = amount * (1 - t.armor.reduc);
      t.hp -= dmg;
      if (stun) t.stunU = Math.max(t.stunU, this.time + stun);
      t.send({ t: 'ev', e: 'hurt', d: Math.round(dmg), x: r2(src.x), z: r2(src.z) });
      if (src.kind === 'player') {
        const atk = this.players.get(src.id);
        if (atk) atk.send({ t: 'ev', e: 'hitc' });
      }
      if (t.hp <= 0) this.koPlayer(t, src.kind === 'crs' ? 'arrest' : src.kind === 'player' ? 'pvp' : src.kind === 'gas' ? 'arrest' : 'ko', src);
      return;
    }
    const n = t;
    if (n.st === 'down') return;
    const mult = n.kind === NPC_CRS ? 0.8 : 1;
    n.hp -= amount * mult;
    if (stun) n.stunU = Math.max(n.stunU, this.time + stun);
    if (src.kind === 'player') {
      const p = this.players.get(src.id);
      if (p) {
        if (n.kind === NPC_CRS) {
          p.hitCrsT = this.time;
          this.heat = Math.min(100, this.heat + 4);
          this.alertSquad(n, p, true);
        } else if (n.mode !== 'flee') {
          n.mode = 'chase'; n.target = p.id; n.chaseU = this.time + 15;
        }
      }
    }
    if (n.hp <= 0) {
      n.st = 'down';
      n.downU = this.time + (n.kind === NPC_CRS ? 25 : 18);
      n.path = null;
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
    if (src && src.kind === 'player') {
      const k = this.players.get(src.id);
      if (k) k.send({ t: 'ev', e: 'kill', name: p.name });
    }
  }

  // ---------------------------------------------------------------- PNJ
  newNpc(kind, x, z) {
    const n = {
      id: this.nid++, kind, x, z, rot: this.rng() * 6.28, st: 'ok', mode: kind === NPC_CRS ? 'patrol' : 'wander',
      hp: kind === NPC_CRS ? 140 : 60, path: null, pi: 0, pathT: 0, target: null, cdU: 0, atkT: -9, stunU: 0,
      thinkT: this.rng(), stolen: [], moving: false, running: false, aggr: 0.3 + this.rng() * 0.7,
      idleU: 0, chaseU: 0, throwU: 0, cdThrow: this.time + this.rng() * 5, sleep: 0, near: 0,
      shootU: this.time + 1, gasU: this.time + 6 + this.rng() * 8, lx: 0, lz: 0, lostT: 0, vis: false,
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

  spawnSquad(initial = false) {
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
    for (let i = 0; i < 3; i++) {
      let x = pt.x + (i - 1) * 1.4, z = pt.z + (this.rng() - 0.5);
      if (!this.map.walkable(x, z)) { x = pt.x; z = pt.z; }
      const n = this.newNpc(NPC_CRS, x, z);
      n.sq = sq.id; n.slot = i;
      sq.members.push(n);
    }
    this.bcast({ t: 'ev', e: 'sirene' });
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

  lobAt(n, kind, tx, tz, owner) {
    const dx = tx - n.x, dz = tz - n.z, d = Math.max(1, Math.hypot(dx, dz));
    const vh = kind === 'gaz' ? 13 : 12;
    const tt = d / vh;
    const y0 = 1.7;
    const vy = (0.4 - y0 + 0.5 * GRAVITY[kind] * tt * tt) / tt;
    this.spawnProj(kind, n.x + (dx / d) * 0.5, y0, n.z + (dz / d) * 0.5, (dx / d) * vh, vy, (dz / d) * vh, owner, kind === 'gaz' ? 'crs' : 'n');
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
              n.mode = 'flee'; n.fleeFrom = p.id; n.fleeU = this.time + 8; n.path = null;
            }
          }
        } else this.navTo(n, p.x, p.z, 4.5, dt);
        break;
      }
      case 'flee': {
        const p = this.players.get(n.fleeFrom);
        if (!p || this.time > n.fleeU) { n.mode = 'wander'; n.path = null; break; }
        if (!n.path || n.pi >= n.path.length) {
          const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 1;
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
      if (p.st !== 'alive') continue;
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      const range = p.crouch ? 5 : 11;
      if (d < range && p.inv.length && this.rng() < n.aggr * 0.3 && this.map.los(n.x, n.z, p.x, p.z)) {
        n.mode = 'chase'; n.target = p.id; n.chaseU = this.time + 12; n.path = null;
        p.send({ t: 'ev', e: 'aggro' });
        return;
      }
    }
    if (this.time > n.cdThrow) {
      for (const c of this.npcs) {
        if (c.kind !== NPC_CRS || c.st === 'down') continue;
        const d = Math.hypot(c.x - n.x, c.z - n.z);
        if (d > 6 && d < 20 && this.map.los(n.x, n.z, c.x, c.z)) {
          n.rot = Math.atan2(c.x - n.x, c.z - n.z);
          this.lobAt(n, 'pave', c.x, c.z, n.id);
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
    if (radio) for (const m of this.npcs) if (m.kind === NPC_CRS && m.mode !== 'chase' && Math.hypot(m.x - p.x, m.z - p.z) < 30) set(m);
  }

  crsThink(n) {
    if (n.mode === 'chase') {
      const p = this.players.get(n.target);
      n.vis = !!p && p.st === 'alive' && Math.hypot(p.x - n.x, p.z - n.z) < 38 && this.map.los(n.x, n.z, p.x, p.z);
      if (n.vis) { n.lx = p.x; n.lz = p.z; n.lostT = this.time; }
      return;
    }
    let best = null, bd = 1e9;
    for (const p of this.players.values()) {
      if (p.st !== 'alive') continue;
      const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
      let range = 24;
      if (p.crouch) range *= 0.55;
      if (p.sprint) range *= 1.2;
      const suspicious = p.inv.length > 0 || this.time - p.hitCrsT < 40 || d < 5;
      if (!suspicious || d > range || d > bd) continue;
      if (d > 5 && Math.abs(angDiff(Math.atan2(dx, dz), n.rot)) > 1.15) continue;
      if (!this.map.los(n.x, n.z, p.x, p.z)) continue;
      best = p; bd = d;
    }
    if (best) {
      this.alertSquad(n, best, false);
      best.send({ t: 'ev', e: 'spotted' });
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
      if (d < 1.6 && n.vis) {
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        if (this.time > n.cdU) {
          n.cdU = this.time + 1.0; n.atkT = this.time;
          this.damage(p, 13, { kind: 'crs', id: n.id, x: n.x, z: n.z }, true, 0.35);
        }
        return;
      }
      if (n.vis && d > 7 && d < 26 && this.time > n.shootU) {
        n.shootU = this.time + 2.3 + this.rng() * 1.6;
        n.atkT = this.time;
        n.rot = Math.atan2(p.x - n.x, p.z - n.z);
        // lead + dispersion
        const err = (this.rng() - 0.5) * (0.08 + d * 0.006) * (p.crouch ? 1.3 : 1) * (p.moving ? 1.6 : 1);
        const yaw = n.rot + err, v = 40;
        this.spawnProj('lbd', n.x + Math.sin(yaw) * 0.5, 1.45, n.z + Math.cos(yaw) * 0.5, Math.sin(yaw) * v, 0.6, Math.cos(yaw) * v, n.id, 'crs');
        return;
      }
      if (n.vis && d > 10 && d < 24 && this.time > n.gasU) {
        n.gasU = this.time + 14 + this.rng() * 10;
        n.atkT = this.time;
        this.lobAt(n, 'gaz', p.x + (this.rng() - 0.5) * 2, p.z + (this.rng() - 0.5) * 2, n.id);
        return;
      }
      const speed = !n.vis || d < 14 ? 4.9 : 2.6;
      this.navTo(n, n.vis ? p.x : n.lx, n.vis ? p.z : n.lz, speed, dt);
      return;
    }
    // patrouille en groupe
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
    this.pathBudget = 4;
    this.heat = Math.min(100, this.heat + dt * 0.11);

    // renforts CRS selon la tension
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 14;
      const crs = this.npcs.filter((n) => n.kind === NPC_CRS).length;
      const target = Math.min(36, this.d.crsBase + Math.floor(this.heat / 10) * 2);
      if (crs < target) this.spawnSquad();
    }

    const players = [...this.players.values()].filter((p) => p.st === 'alive');
    for (let i = 0; i < this.npcs.length; i++) {
      const n = this.npcs[i];
      n.moving = false; n.running = false;
      // PNJ loin de tous les joueurs : mis à jour 4x moins souvent
      if ((this.tick + n.id) % 10 === 0) {
        let dm = 1e9;
        for (const p of players) dm = Math.min(dm, Math.hypot(p.x - n.x, p.z - n.z));
        n.near = dm;
      }
      let ndt = dt;
      if (n.near > 110 && n.mode !== 'chase') {
        n.sleep += dt;
        if ((this.tick + n.id) % 4) continue;
        ndt = n.sleep; n.sleep = 0;
      }
      if (n.kind === NPC_CRS) this.stepCrs(n, ndt); else this.stepRioter(n, ndt);
      if (this.npcs[i] !== n) i--;
    }
    this.separate();
    this.stepProj(dt);

    // gaz
    for (let i = this.gas.length - 1; i >= 0; i--) {
      if ((this.gas[i].ttl -= dt) <= 0) this.gas.splice(i, 1);
    }
    for (const p of this.players.values()) {
      if (p.st === 'ko' && this.time - p.koT > 12) p.st = 'gone';
      if (p.st !== 'alive') continue;
      if (this.time < p.healU) p.hp = Math.min(p.maxHp, p.hp + p.healRate * dt);
      p.inGas = false;
      for (const g of this.gas) if (Math.hypot(g.x - p.x, g.z - p.z) < g.r) p.inGas = true;
      if (p.inGas && !p.gasImmune) {
        p.hp -= 6 * dt;
        if (p.hp <= 0) this.koPlayer(p, 'arrest');
        if (p.st !== 'alive') continue;
      }
      // extraction
      let inExit = false;
      for (const e of this.map.exits) {
        if (this.time >= e.activeFrom && Math.hypot(e.x - p.x, e.z - p.z) < PLAYER.extractRadius) inExit = true;
      }
      p.ex = inExit ? p.ex + dt : 0;
      if (p.ex >= PLAYER.extractTime) {
        p.st = 'out';
        p.send({ t: 'out', items: p.inv, value: invValue(p.inv), cons: { bandage: p.band, bille: p.ammo.bille, fusee: p.ammo.fusee } });
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
        if (this.time < o.stunU) f |= F.STUN;
        if (this.time < o.healU) f |= F.HEAL;
        pl.push([o.id, r2(o.x), r2(o.z), r2(o.rot), f, Math.round((o.hp / o.maxHp) * 100), o.lo.backpack]);
      }
      for (const n of this.npcs) {
        if ((n.x - p.x) ** 2 + (n.z - p.z) ** 2 > R2) continue;
        let f = (n.moving ? F.MOVE : 0) | (n.running ? F.RUN : 0) | (n.st === 'down' ? F.DOWN : 0);
        if (this.time - n.atkT < 0.3) f |= n.mode === 'throw' ? F.THROW : F.ATTACK;
        if (this.time < n.stunU) f |= F.STUN;
        np.push([n.id, n.kind, r2(n.x), r2(n.z), r2(n.rot), f]);
      }
      p.send({
        t: 'snap', tm: time, h: heat, p: pl, n: np,
        me: {
          hp: Math.round(p.hp), st: r2(Math.max(0, p.stunU - this.time)), g: p.inGas && !p.gasImmune ? 1 : 0,
          ex: r2(p.ex), am: p.ammo, b: p.band, x: r2(p.x), z: r2(p.z),
        },
      });
    }
  }

  bcast(msg) { for (const p of this.players.values()) if (p.st !== 'out') p.send(msg); }
  bcastNear(x, z, msg) {
    const R2 = INTEREST_RADIUS * INTEREST_RADIUS;
    for (const p of this.players.values()) {
      if (p.st === 'out' || p.st === 'gone') continue;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < R2) p.send(msg);
    }
  }
}

export { holdTime };
