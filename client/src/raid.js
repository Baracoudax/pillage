// Client d'un raid en vue FPS : prédiction du joueur local, tir, interpolation des entités distantes, HUD.
import * as THREE from 'three';
import { getMap } from '../../shared/map.js';
import { PLAYER, SHOP_TYPES } from '../../shared/config.js';
import { ITEMS, RARITY, GEAR_BY_ID, WEAPONS, THROWABLES, THROW_ORDER, CONSUMABLES, invValue, holdTime } from '../../shared/items.js';
import { F, NPC_CRS, NPC_GJ, NPC_GIGN, NPC_LOOTER } from '../../shared/world.js';
import { CityView } from './cityView.js';
import { CharacterRenderer, appearance } from './chars.js';
import { Fx } from './fx.js';
import { ViewModel } from './viewmodel.js';
import { loadModel, getModel, weaponPath } from './assets.js';

const $ = (id) => document.getElementById(id);
const SEND_DT = 0.05;
const FOV = 75;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const AMMO_NAMES = { a9: '9 mm', a762: 'fusil', a12: 'cal. 12', a308: '.308', af: 'fusées', am: 'bombes' };

class Interp {
  constructor() { this.buf = []; }
  push(t, s) { this.buf.push({ t, ...s }); if (this.buf.length > 5) this.buf.shift(); }
  sample(t) {
    const b = this.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        const a = b[i - 1], c = b[i];
        if (t >= c.t) return c;
        const k = (t - a.t) / (c.t - a.t);
        return { ...c, x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k, rot: a.rot + angDiff(c.rot, a.rot) * k };
      }
    }
    return b[b.length - 1];
  }
}

export class Raid {
  constructor(app, transport, welcome) {
    this.app = app;
    this.tr = transport;
    this.gfx = app.gfx;
    this.q = app.gfx.q;
    this.profile = app.profile;
    this.audio = app.audio;
    this.map = getMap(welcome.district);
    this.myId = welcome.id;
    this.duration = welcome.duration;
    this.time = welcome.time;
    this.timeBase = performance.now() / 1000 - welcome.time;
    this.exits = welcome.exits;
    this.lo = app.raidLoadout;
    this.speedMult = GEAR_BY_ID[this.lo.shoes].speed;
    this.wp = { melee: WEAPONS[this.lo.melee] ? this.lo.melee : null, primary: WEAPONS[this.lo.primary] ? this.lo.primary : null, sidearm: WEAPONS[this.lo.sidearm] ? this.lo.sidearm : null };

    const scene = (this.scene = new THREE.Scene());
    const fogC = 0x1b1820;
    scene.background = new THREE.Color(fogC);
    scene.fog = new THREE.Fog(fogC, 18, this.q.fogFar);
    const cam = this.gfx.camera;
    cam.far = this.q.fogFar + 10;
    cam.fov = FOV;
    cam.near = 0.05;
    cam.rotation.order = 'YXZ';
    cam.updateProjectionMatrix();
    scene.add(new THREE.HemisphereLight(0x9fb0d8, 0x6a4028, 2.4));
    const moon = (this.moon = new THREE.DirectionalLight(0xb4c2ff, 1.3));
    moon.position.set(40, 80, 20);
    scene.add(moon, moon.target);
    if (this.q.shadows) {
      moon.castShadow = true;
      moon.shadow.mapSize.set(1024, 1024);
      const c = moon.shadow.camera;
      c.left = c.bottom = -30; c.right = c.top = 30; c.near = 10; c.far = 160;
      moon.shadow.bias = -0.0015;
    }

    this.city = new CityView(scene, this.map, this.q);
    this.chars = new CharacterRenderer(scene, this.q.shadows);
    this.fx = new Fx(scene, this.q, this.map);
    this.vm = new ViewModel(this.gfx.renderer);
    for (const [id, item] of welcome.loot) this.city.setLoot(id, item);
    for (const [id, x, z] of welcome.bags) this.city.addBag(id, x, z);
    this.mines = new Map();
    for (const [id, x, z, rot] of welcome.mines || []) this.addMine(id, x, z, rot);

    this.me = {
      x: welcome.x, z: welcome.z, rot: 0, hp: PLAYER.hp, stamina: PLAYER.stamina, inv: [], w: 0, cap: welcome.cap,
      stun: 0, gas: 0, ex: 0, ammo: {}, thr: {}, mg: { primary: 0, sidearm: 0 }, cur: this.wp.primary ? 'primary' : this.wp.sidearm ? 'sidearm' : 'melee', rl: 0, cr: 0,
      band: this.lo.cons.bandage, phase: 0, moving: false, sprint: false, crouch: false,
    };
    this.local = { mg: null, lastShot: -9, fireU: 0, meleeU: 0, throwU: 0, reloadEnd: 0, reloadDur: 1 };
    this.throwSel = 'pierre';
    this.cam = { yaw: Math.PI / 4, pitch: 0, recoil: 0, bob: 0, eye: 1.6 };
    this.players = new Map();
    this.names = new Map(welcome.players);
    this.npcs = new Map();
    this.remoteGuns = new Map();
    this.sendT = 0;
    this.hold = { target: null, t: 0 };
    this.pending = new Set();
    this.heat = 0;
    this.ended = false;
    this.paused = false;
    this.labels = new Map();
    this.hudT = 0;
    this.lastHurt = 0;
    this.flashK = 0;
    this.adsK = 0;

    this.vm.setWeapon(this.wp[this.me.cur]);
    this.buildMinimap();
    this.setupHud();
    this.audio.startAmbience();
  }

  // précharge les modèles nécessaires (appelé avant d'afficher le raid)
  static preload(lo) {
    const list = [lo.melee, lo.primary, lo.sidearm].filter((w) => WEAPONS[w]).map((w) => weaponPath(WEAPONS[w].model));
    list.push('proc/pierre', 'melee/PoliceBaton', 'weapons/M4A1');
    for (const k of THROW_ORDER) if (lo.cons[k] > 0) list.push(weaponPath(THROWABLES[k].model));
    list.push('weapons/Claymore');
    return Promise.all(list.map(loadModel));
  }

  get weapon() { return WEAPONS[this.wp[this.me.cur]]; }

  // ------------------------------------------------------------------ HUD
  setupHud() {
    $('hud').classList.add('on');
    $('invPanel').classList.remove('on');
    $('pause').classList.remove('on');
    this.toast(`Raid : ${this.map.d.name}. Pille, puis rejoins une sortie verte.`, 'info', 4500);
    if (this.wp.primary && WEAPONS[this.wp.primary].firearm || this.wp.sidearm && WEAPONS[this.wp.sidearm].firearm) {
      this.toast('Tu es armé : chaque coup de feu attire la police et fera intervenir le GIGN.', 'danger', 6000);
    } else this.toast('G : lancer une pierre · T : changer de projectile', 'info', 6000);
    $('invList').onclick = (e) => {
      const b = e.target.closest('[data-drop]');
      if (b) this.tr.send({ t: 'act', a: 'drop', i: Number(b.dataset.drop) });
    };
    $('btnResume').onclick = () => this.setPause(false);
    $('btnQuit').onclick = () => { this.setPause(false); this.finish({ t: 'ko', reason: 'quit', lost: this.me.inv, value: invValue(this.me.inv) }); };
  }

  toast(text, kind = 'info', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
    while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  }

  buildMinimap() {
    const S = this.map.size, k = 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S * k;
    const g = cv.getContext('2d');
    g.fillStyle = '#26272b'; g.fillRect(0, 0, S * k, S * k);
    for (const b of this.map.solids) {
      if (b.kind === 'bld') g.fillStyle = '#55575e';
      else if (b.kind === 'wall') g.fillStyle = '#c8c3b6';
      else if (b.kind === 'car' || b.kind === 'barricade') g.fillStyle = '#8a5a3a';
      else continue;
      g.fillRect(b.x0 * k, b.z0 * k, (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    }
    for (const f of this.map.floors) {
      g.fillStyle = SHOP_TYPES[f.type].color + 'aa';
      g.fillRect(f.x0 * k + 1, f.z0 * k + 1, (f.x1 - f.x0) * k - 2, (f.z1 - f.z0) * k - 2);
    }
    const r = this.map.roundabout;
    g.strokeStyle = '#d7f20f'; g.lineWidth = 3; g.beginPath(); g.arc(r.x * k, r.z * k, 7 * k, 0, 7); g.stroke();
    this.mini = { cv, k, ctx: $('minimap').getContext('2d') };
  }

  drawMinimap() {
    const { cv, k, ctx } = this.mini;
    const W = ctx.canvas.width, view = 70;
    ctx.save();
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, W);
    const s = W / view;
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-this.cam.yaw + Math.PI);
    ctx.scale(s, s);
    ctx.translate(-this.me.x, -this.me.z);
    ctx.drawImage(cv, 0, 0, cv.width / k, cv.height / k);
    for (const e of this.exits) {
      ctx.fillStyle = this.time >= e.activeFrom ? '#40ff80' : '#777';
      ctx.beginPath(); ctx.arc(e.x, e.z, 3.5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#ffd43b';
    for (let i = 0; i < this.city.lootItems.length; i++) {
      if (!this.city.lootItems[i]) continue;
      const l = this.map.lootSpots[i];
      if (Math.abs(l.x - this.me.x) < 36 && Math.abs(l.z - this.me.z) < 36) ctx.fillRect(l.x - 0.5, l.z - 0.5, 1, 1);
    }
    for (const n of this.npcs.values()) {
      const s0 = n.last;
      if (!s0 || s0.f & F.DOWN) continue;
      const d = Math.hypot(s0.x - this.me.x, s0.z - this.me.z);
      if (s0.kind === NPC_CRS) { if (d > 30) continue; ctx.fillStyle = '#ff3b3b'; }
      else if (s0.kind === NPC_GJ) { if (d > 45) continue; ctx.fillStyle = '#d7f20f'; }
      else if (s0.kind === NPC_LOOTER) { if (d > 35) continue; ctx.fillStyle = '#c77dff'; }
      else if (s0.kind === NPC_GIGN) { if (d > 40) continue; ctx.fillStyle = '#ff2050'; }
      else { if (d > 20) continue; ctx.fillStyle = '#ff9f43'; }
      ctx.fillRect(s0.x - 1, s0.z - 1, 2, 2);
    }
    for (const p of this.players.values()) {
      if (!p.last) continue;
      ctx.fillStyle = '#4dabf7';
      ctx.beginPath(); ctx.arc(p.last.x, p.last.z, 1.5, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 7); ctx.lineTo(W / 2 - 5, W / 2 + 5); ctx.lineTo(W / 2 + 5, W / 2 + 5); ctx.fill();
  }

  magShown() {
    const me = this.me;
    const l = this.local.mg;
    const s = me.mg[me.cur] ?? 0;
    return l != null && performance.now() / 1000 - this.local.lastShot < 0.6 ? Math.min(l, s) : s;
  }

  updateHud() {
    const me = this.me;
    $('hpFill').style.width = Math.max(0, me.hp) + '%';
    $('hpTxt').textContent = Math.max(0, Math.round(me.hp));
    $('stFill').style.width = me.stamina + '%';
    const left = Math.max(0, this.duration - this.time);
    $('timer').textContent = fmtTime(left);
    $('timer').classList.toggle('warn', left < 60);
    $('heatFill').style.width = this.heat + '%';
    $('wTxt').textContent = `${me.w.toFixed(1)} / ${me.cap} kg`;
    $('wFill').style.width = Math.min(100, (me.w / me.cap) * 100) + '%';
    $('vTxt').textContent = `${invValue(me.inv)} €`;
    const w = this.weapon;
    const ranged = w && !w.melee;
    $('weaponTxt').textContent = w ? w.name : 'Poings';
    $('magTxt').textContent = ranged ? this.magShown() : '';
    $('resTxt').textContent = ranged ? `/ ${me.ammo[w.ammo] ?? 0} ${AMMO_NAMES[w.ammo]}` : '';
    $('reloadTxt').classList.toggle('on', me.rl > 0);
    const th = THROWABLES[this.throwSel];
    $('throwTxt').textContent = `${th.icon} ${th.name} x${me.thr[this.throwSel] ?? 0}`;
    $('bandTxt').textContent = `🩹 ${me.band}`;
    $('crowd').className = me.cr ? 'on' + (me.cr === 2 ? ' best' : '') : '';
    $('crowd').textContent = me.cr === 2 ? '🦺 Fondu dans le cortège : invisible pour les CRS' : '🦺 Dans le cortège : discret';
    const ex = this.exits.map((e) => {
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      const a = angDiff(Math.atan2(e.x - me.x, e.z - me.z), this.cam.yaw);
      const active = this.time >= e.activeFrom;
      const arrow = ['⬆', '⬈', '➡', '⬊', '⬇', '⬋', '⬅', '⬉'][((Math.round((-a / (Math.PI * 2)) * 8) % 8) + 8) % 8];
      return `<div class="${active ? '' : 'off'}">${arrow} ${e.name} · ${Math.round(d)} m${active ? '' : ' · ' + fmtTime(e.activeFrom - this.time)}</div>`;
    }).join('');
    if (ex !== this._ex) { $('exits').innerHTML = ex; this._ex = ex; }
    $('extract').classList.toggle('on', me.ex > 0);
    if (me.ex > 0) $('extractFill').style.width = (me.ex / PLAYER.extractTime) * 100 + '%';
    this.drawMinimap();
    $('lockHint').classList.toggle('on', !this.app.input.touch && !this.app.input.locked && !this.paused && !$('invPanel').classList.contains('on'));
    $('fps').textContent = `${Math.round(this.gfx.fps)} FPS · x${this.gfx.pr.toFixed(2)}`;
  }

  renderInv() {
    const html = this.me.inv.map((id, i) => {
      const it = ITEMS[id];
      return `<div class="row"><span style="color:${RARITY[it.r].color}">${it.icon} ${it.name}</span><span>${it.value} € · ${it.w} kg <button data-drop="${i}">Jeter</button></span></div>`;
    }).join('') || '<div class="empty">Sac vide. Pille des magasins !</div>';
    $('invList').innerHTML = html;
    $('invSum').textContent = `${invValue(this.me.inv)} € · ${this.me.w.toFixed(1)}/${this.me.cap} kg`;
  }

  addMine(id, x, z, rot) {
    const m = getModel(weaponPath('Claymore'));
    const o = m ? m.scene.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.05), new THREE.MeshLambertMaterial({ color: 0x3d4a2a }));
    o.position.set(x, m ? -m.box.min.y : 0.08, z);
    o.rotation.y = rot + Math.PI;
    this.scene.add(o);
    this.mines.set(id, o);
  }

  // ------------------------------------------------------------------ réseau
  handle(m, now) {
    switch (m.t) {
      case 'snap': {
        this.time = m.tm;
        this.timeBase = now - m.tm;
        this.heat = m.h;
        const seenP = new Set(), seenN = new Set();
        for (const [id, x, z, rot, f, hp, pack, tenue, wid, pitch] of m.p) {
          let p = this.players.get(id);
          if (!p) { p = { id, it: new Interp(), phase: 0 }; this.players.set(id, p); }
          p.it.push(m.tm, { x, z, rot, f, hp, pack, tenue, wid, pitch });
          p.last = { x, z, f };
          if (f & F.SHOOT) p.shotT = now;
          seenP.add(id);
        }
        for (const [id, kind, x, z, rot, f, wid, loot] of m.n) {
          let n = this.npcs.get(id);
          if (!n) {
            const k = kind === NPC_CRS ? 'crs' : kind === NPC_GJ ? 'gj' : kind === NPC_GIGN ? 'gign' : kind === NPC_LOOTER ? 'looter' : 'rioter';
            n = { id, kind, it: new Interp(), phase: Math.random() * 6, look: appearance(k, id) };
            this.npcs.set(id, n);
          }
          n.it.push(m.tm, { x, z, rot, f, kind });
          if (wid !== undefined) { n.wid = wid; n.loot = loot; n.look.gun = !WEAPONS[wid]?.melee; }
          n.last = { x, z, f, kind };
          seenN.add(id);
        }
        for (const id of this.players.keys()) if (!seenP.has(id)) this.players.delete(id);
        for (const id of this.npcs.keys()) if (!seenN.has(id)) this.npcs.delete(id);
        const me = this.me, s = m.me;
        if (s.hp < me.hp - 0.5) this.lastHurt = now;
        me.hp = s.hp; me.stun = s.st; me.gas = s.g; me.ex = s.ex; me.ammo = s.am; me.thr = s.th; me.band = s.b;
        me.mg = s.mg; me.rl = s.rl; me.cr = s.cr;
        if (s.cur !== me.cur && now - (this._switchT || 0) > 0.6) { me.cur = s.cur; this.vm.setWeapon(this.wp[me.cur]); }
        if (Math.hypot(s.x - me.x, s.z - me.z) > 4) { me.x = s.x; me.z = s.z; }
        break;
      }
      case 'pos': this.me.x = m.x; this.me.z = m.z; break;
      case 'inv':
        this.me.inv = m.inv; this.me.w = m.w; this.me.cap = m.cap;
        this.renderInv();
        break;
      case 'loot': this.city.setLoot(m.id, null); this.pending.delete(m.id); break;
      case 'bag': this.city.addBag(m.id, m.x, m.z); break;
      case 'bagdel': this.city.removeBag(m.id); break;
      case 'mine': if (!this.mines.has(m.id)) this.addMine(m.id, m.x, m.z, m.rot); break;
      case 'minedel': { const o = this.mines.get(m.id); if (o) { this.scene.remove(o); this.mines.delete(m.id); } break; }
      case 'shot': {
        const d = Math.hypot(m.o[0] - this.me.x, m.o[2] - this.me.z);
        for (const e of m.e) { this.fx.tracer(m.o[0], m.o[1] - 0.1, m.o[2], e[0], e[1], e[2]); this.fx.impact(e[0], e[1], e[2], e[3]); }
        this.audio.play(WEAPONS[m.w]?.slot === 'sidearm' ? 'pistol' : m.w === 'shotgun' ? 'shotgun' : 'rifle', d);
        break;
      }
      case 'proj': {
        this.fx.addProj(m);
        const d = Math.hypot(m.x - this.me.x, m.z - this.me.z);
        if (m.k === 'lbd') this.audio.play('lbd', d);
        else if (m.k === 'fusee') this.audio.play('flare', d);
        else this.audio.play('swing', d);
        break;
      }
      case 'projend': this.fx.endProj(m); break;
      case 'fx': {
        const d = Math.hypot(m.x - this.me.x, m.z - this.me.z);
        if (m.k === 'hit') { this.fx.hit(m.x, m.y, m.z); this.audio.play('hit', d); }
        else if (m.k === 'boom' || m.k === 'flare' || m.k === 'firework') { this.fx.boom(m.x, m.y, m.z); this.audio.play('boom', d); this.shake = Math.max(this.shake || 0, Math.max(0, 0.5 - d / 40)); }
        else if (m.k === 'gas') { this.fx.addGas(m.x, m.z, m.r, m.ttl); this.audio.play('gas', d); }
        else if (m.k === 'smoke') { this.fx.addSmoke(m.x, m.z, m.r, m.ttl); this.audio.play('gas', d); }
        else if (m.k === 'fire') { this.fx.addFire(m.x, m.z, m.r, m.ttl); this.audio.play('glass', d); }
        else if (m.k === 'flash') {
          this.fx.bigFlash(m.x, m.y, m.z);
          this.audio.play('boom', d);
          // aveuglement si on regarde vers l'explosion
          if (d < m.r * 2.2 && this.map.los(this.me.x, this.me.z, m.x, m.z)) {
            const facing = Math.cos(angDiff(Math.atan2(m.x - this.me.x, m.z - this.me.z), this.cam.yaw));
            this.flashK = Math.max(this.flashK, Math.min(1, (1 - d / (m.r * 2.2)) * 1.6) * (0.35 + 0.65 * Math.max(0, facing)));
          }
        }
        break;
      }
      case 'ev': this.event(m, now); break;
      case 'pjoin': this.names.set(m.id, m.name); if (m.id !== this.myId) this.toast(`${m.name} a rejoint le raid`); break;
      case 'pleave': this.names.delete(m.id); this.players.delete(m.id); break;
      case 'ko': case 'out': this.finish(m); break;
      case 'disconnected': if (!this.ended) this.finish({ t: 'ko', reason: 'disconnect', lost: this.me.inv, value: invValue(this.me.inv) }); break;
    }
  }

  event(m, now) {
    switch (m.e) {
      case 'got': {
        const it = ITEMS[m.item];
        this.toast(`+ ${it.icon} ${it.name} (${it.value} €)`, 'loot');
        this.audio.play(m.item.startsWith('cash') ? 'cash' : 'pick');
        break;
      }
      case 'gotbag': {
        const extra = Object.entries(m.cons || {}).map(([k, v]) => `${v} ${(CONSUMABLES[k]?.name || k).toLowerCase()}`).join(', ');
        this.toast(`Sac fouillé : ${m.n} prise(s)${extra ? ' — ' + extra : ''}`, 'loot', 3500);
        this.audio.play('pick');
        break;
      }
      case 'rival': this.toast('Un pilleur rival veut ton butin !', 'warn'); break;
      case 'rivalko': this.toast(`Pilleur rival K.O. ! Fouille son sac (≈ ${m.v} €).`, 'loot', 3500); break;
      case 'rivalout': this.toast('Un pilleur rival s’est extrait avec son butin.'); break;
      case 'full': this.toast('Sac trop lourd !', 'warn'); this.audio.play('full'); break;
      case 'hurt': {
        this.lastHurt = now;
        this.audio.play('hurt');
        this.shake = Math.max(this.shake || 0, 0.15);
        const a = angDiff(Math.atan2(m.x - this.me.x, m.z - this.me.z), this.cam.yaw);
        const el = $('dmgDir');
        el.style.transform = `rotate(${-a}rad)`;
        el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
        break;
      }
      case 'hitc': {
        const c = $('hitmark');
        c.classList.remove('on', 'hs'); void c.offsetWidth; c.classList.add('on');
        if (m.hs) c.classList.add('hs');
        this.audio.play('hitmark');
        break;
      }
      case 'stolen': this.toast(`Un émeutier t'a volé : ${ITEMS[m.item].icon} ${ITEMS[m.item].name} ! Rattrape-le !`, 'warn', 3500); break;
      case 'aggro': this.toast('Un émeutier en veut à ton butin !', 'warn'); break;
      case 'spotted': if (now - (this._spot || 0) > 6) { this._spot = now; this.toast(m.g ? 'Repéré par le GIGN !' : 'Repéré par les CRS !', 'danger'); this.audio.play('spotted'); } break;
      case 'sirene': this.toast('Renforts de CRS en approche', 'danger'); this.audio.play('sirene'); break;
      case 'armed': this.toast('Pilleurs armés signalés : la police renforce ses effectifs et s’équipe.', 'danger', 5000); this.audio.play('sirene'); break;
      case 'gign': this.toast(`Coups de feu signalés ! Le GIGN est appelé (arrivée dans ~${m.eta} s).`, 'danger', 6000); this.audio.play('sirene'); break;
      case 'gignon': this.toast('Le GIGN est sur zone. Ils tirent à balles réelles.', 'danger', 5000); this.audio.play('spotted'); break;
      case 'heal': this.toast('Soin en cours…'); break;
      case 'kill': this.toast(`Tu as mis ${m.name} K.O.`, 'loot'); break;
      case 'pout': this.toast(`${m.name} s'est extrait`); break;
    }
  }

  finish(m) {
    if (this.ended) return;
    this.ended = true;
    this.audio.play(m.t === 'out' ? 'extract' : 'ko');
    this.app.input.setEnabled(false);
    setTimeout(() => this.app.endRaid(m), m.t === 'out' ? 600 : 1800);
  }

  setPause(v) {
    if (this.tr.multi && v) { $('pause').classList.add('on'); this.paused = true; return; }
    this.paused = v;
    this.tr.paused = v;
    $('pause').classList.toggle('on', v);
    if (!v && !this.app.input.touch) this.gfx.canvas.requestPointerLock?.();
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const now = performance.now() / 1000;
    for (const m of this.tr.poll(dt)) this.handle(m, now);
    if (!this.tr.multi && !this.paused) this.time = now - this.timeBase;
    const inp = this.app.input.read();
    const invOpen = $('invPanel').classList.contains('on');
    if (inp.pressed.has('unlocked') && invOpen) inp.pressed.delete('unlocked');
    if (inp.pressed.has('pause') && invOpen) { $('invPanel').classList.remove('on'); inp.pressed.delete('pause'); }
    if (inp.pressed.has('pause') || inp.pressed.has('unlocked')) { if (!this.ended) this.setPause(!this.paused || inp.pressed.has('unlocked')); }
    if (inp.pressed.has('inv')) {
      const on = $('invPanel').classList.toggle('on');
      if (on) { this.renderInv(); document.exitPointerLock?.(); }
    }
    const me = this.me;
    const active = !this.ended && !(this.paused && !this.tr.multi);
    if (active) this.control(inp, dt, now);

    this.sendT += dt;
    if (this.sendT >= SEND_DT && !this.ended) {
      this.sendT = 0;
      this.tr.send({ t: 'state', x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, r: Math.round(this.cam.yaw * 100) / 100, p: Math.round(this.cam.pitch * 100) / 100, c: inp.crouch ? 1 : 0, s: me.sprint ? 1 : 0, m: me.moving ? 1 : 0 });
    }

    this.drawWorld(dt, now, inp);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
    $('vignette').style.opacity = Math.max(0, 1 - (now - this.lastHurt) * 2) * 0.8 + (me.hp < 30 ? 0.35 : 0);
    $('gasOverlay').style.opacity = me.gas ? 0.55 : 0;
    this.flashK = Math.max(0, this.flashK - dt * 0.45);
    $('flashOverlay').style.opacity = Math.min(1, this.flashK * 1.3);
    const scoped = this.weapon?.zoom && this.adsK > 0.85;
    $('scope').classList.toggle('on', !!scoped);
    $('crosshair').classList.toggle('ads', this.adsK > 0.5);
  }

  control(inp, dt, now) {
    const me = this.me, w = this.weapon;
    const zoom = w?.zoom ? 1 + (w.zoom - 1) * this.adsK : 1 + 0.35 * this.adsK;
    const sens = 0.0022 / zoom;
    this.cam.yaw -= inp.lookX * sens;
    this.cam.pitch = Math.max(-1.45, Math.min(1.45, this.cam.pitch - inp.lookY * sens));
    // recul : la visée remonte puis redescend doucement
    const rec = this.cam.recoil * Math.min(1, dt * 9);
    this.cam.pitch = Math.min(1.45, this.cam.pitch + rec);
    this.cam.recoil -= rec;

    let mx = inp.mx, my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const fwdX = Math.sin(this.cam.yaw), fwdZ = Math.cos(this.cam.yaw);
    const rgtX = -fwdZ, rgtZ = fwdX;
    const dx = fwdX * my + rgtX * mx, dz = fwdZ * my + rgtZ * mx;
    const moving = ml > 0.1 && me.stun <= 0;
    const wantAds = inp.ads && !!w && !w.melee && me.rl <= 0;
    me.sprint = moving && inp.sprint && !inp.crouch && me.stamina > 1 && my > 0.3 && !wantAds;
    me.stamina = Math.max(0, Math.min(PLAYER.stamina, me.stamina + (me.sprint ? -PLAYER.staminaDrain : PLAYER.staminaRegen) * dt));
    if (moving) {
      let sp = PLAYER.walk * this.speedMult * (me.sprint ? PLAYER.sprintMult : inp.crouch ? PLAYER.crouchMult : 1);
      sp *= 1 - 0.3 * Math.min(1, me.w / me.cap);
      if (me.gas) sp *= 0.6;
      if (wantAds) sp *= 0.6;
      [me.x, me.z] = this.map.move(me.x, me.z, dx * sp * dt, dz * sp * dt, PLAYER.radius);
      me.phase += dt * sp * 2.2;
    }
    me.moving = moving;
    me.crouch = inp.crouch;
    me.rot = this.cam.yaw;
    this.adsK += ((wantAds ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.ads = wantAds;

    // changement d'arme
    let sw = null;
    if (inp.pressed.has('melee_slot')) sw = 'melee';
    if (inp.pressed.has('primary')) sw = 'primary';
    if (inp.pressed.has('sidearm')) sw = 'sidearm';
    if (inp.pressed.has('swap')) {
      const order = ['primary', 'sidearm', 'melee'].filter((s) => s === 'melee' || this.wp[s]);
      sw = order[(order.indexOf(me.cur) + 1) % order.length];
    }
    if (sw && sw !== me.cur && (sw === 'melee' || this.wp[sw])) {
      me.cur = sw;
      this._switchT = now;
      this.local.mg = null;
      this.local.fireU = now + 0.35;
      this.vm.setWeapon(this.wp[sw]);
      this.tr.send({ t: 'act', a: 'switch', s: sw });
    }
    if (inp.pressed.has('reload') && w && !w.melee && me.mg[me.cur] < w.mag && (me.ammo[w.ammo] ?? 0) > 0) {
      this.tr.send({ t: 'act', a: 'reload' });
      this.audio.play('reload');
    }

    // mêlée (arme en main) : on peut maintenir le clic
    if ((!w || w.melee) && inp.held.has('fire') && now >= this.local.meleeU && me.stun <= 0) {
      this.local.meleeU = now + (w ? w.cd : 0.45);
      this.vm.melee();
      this.audio.play('swing');
      this.tr.send({ t: 'act', a: 'fire', yaw: this.cam.yaw, pitch: this.cam.pitch });
    }
    // tir
    const trigger = w && !w.melee && (w.auto ? inp.held.has('fire') : inp.pressed.has('fire'));
    if (trigger && now >= this.local.fireU && me.stun <= 0 && me.rl <= 0 && !me.sprint) {
      // plusieurs tirs par image si l'appareil est lent (la cadence ne dépend pas des FPS)
      if (this.magShown() > 0) {
        let n = 0;
        while (n++ < 3 && now >= this.local.fireU && this.magShown() > 0) {
          const late = Math.min(0.1, now - this.local.fireU);
          this.shoot(w, now);
          if (this.local.fireU > now) this.local.fireU -= late;
          if (!w.auto) break;
        }
      } else if (inp.pressed.has('fire')) {
        this.audio.play('empty');
        if ((me.ammo[w.ammo] ?? 0) > 0) { this.tr.send({ t: 'act', a: 'reload' }); this.audio.play('reload'); }
        else this.toast('Plus de munitions !', 'warn');
      }
    }
    if (inp.pressed.has('melee') && now >= this.local.meleeU) {
      this.local.meleeU = now + (WEAPONS[this.wp.melee]?.cd || 0.6);
      this.vm.melee();
      this.audio.play('swing');
      this.tr.send({ t: 'act', a: 'melee', yaw: this.cam.yaw });
    }
    if (inp.pressed.has('nextThrow')) {
      const i = THROW_ORDER.indexOf(this.throwSel);
      for (let k = 1; k <= THROW_ORDER.length; k++) {
        const c = THROW_ORDER[(i + k) % THROW_ORDER.length];
        if ((me.thr[c] ?? 0) > 0 || k === THROW_ORDER.length) { this.throwSel = c; break; }
      }
    }
    if (inp.pressed.has('throw') && now >= this.local.throwU) {
      if ((me.thr[this.throwSel] ?? 0) > 0) {
        this.local.throwU = now + (this.throwSel === 'pierre' ? 0.55 : 0.9);
        this.vm.throwAnim(this.throwSel);
        this.audio.play('swing');
        this.tr.send({ t: 'act', a: 'throw', k: this.throwSel, yaw: this.cam.yaw, pitch: this.cam.pitch });
      } else this.toast(`Plus de ${THROWABLES[this.throwSel].name.toLowerCase()} (T pour changer)`, 'warn');
    }
    if (inp.pressed.has('heal')) this.tr.send({ t: 'act', a: 'heal' });

    this.interact(inp, dt, now);
  }

  shoot(w, now) {
    const me = this.me;
    this.local.fireU = now + 60 / w.rpm;
    this.local.mg = this.magShown() - 1;
    this.local.lastShot = now;
    let yaw = this.cam.yaw, pitch = this.cam.pitch;
    if (this.app.input.touch) [yaw, pitch] = this.aimAssist(yaw, pitch);
    const rt = now - this.timeBase - (this.tr.multi ? 0.12 : 0.06);
    this.tr.send({ t: 'act', a: 'fire', yaw: Math.round(yaw * 1000) / 1000, pitch: Math.round(pitch * 1000) / 1000, ads: this.ads ? 1 : 0, rt: Math.round(rt * 100) / 100 });
    this.vm.fire(w.pellets ? 2 : w.zoom ? 2.5 : 1);
    this.fx.flash(me.x + Math.sin(yaw) * 0.8, this.cam.eye, me.z + Math.cos(yaw) * 0.8, 0xffb060, 0.05);
    const kick = (w.pellets ? 0.06 : w.zoom ? 0.07 : w.slot === 'sidearm' ? 0.028 : 0.018) * (this.ads ? 0.6 : 1);
    this.cam.recoil += w.proj === 'mortier' ? 0.05 : kick;
    this.cam.yaw += (Math.random() - 0.5) * kick * 0.5;
    this.audio.play(w.slot === 'sidearm' && !w.proj ? 'pistol' : w.pellets ? 'shotgun' : w.proj ? 'flare' : w.zoom ? 'sniper' : 'rifle');
    if (w.proj) return;
    // traçante locale immédiate (l'impact réel est calculé par le serveur)
    const eye = this.cam.eye;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
    const t = this.map.ray3(me.x, eye, me.z, dx, dy, dz, w.range);
    const sx = me.x + Math.sin(yaw - 0.35) * 0.4, sz = me.z + Math.cos(yaw - 0.35) * 0.4;
    for (let i = 0; i < (w.pellets ? 3 : 1); i++) {
      const j = w.pellets ? 0.05 : 0;
      const ex = me.x + (dx + (Math.random() - 0.5) * j) * t, ey = eye + (dy + (Math.random() - 0.5) * j) * t, ez = me.z + (dz + (Math.random() - 0.5) * j) * t;
      this.fx.tracer(sx, eye - 0.15, sz, ex, ey, ez);
      if (t < w.range) this.fx.impact(ex, ey, ez, 0);
    }
  }

  aimAssist(yaw, pitch) {
    let best = null, bs = 0.14;
    const consider = (x, z) => {
      const d = Math.hypot(x - this.me.x, z - this.me.z);
      if (d > 45 || d < 0.5) return;
      const a = Math.atan2(x - this.me.x, z - this.me.z);
      const p = Math.atan2(1.25 - this.cam.eye, d);
      const sc = Math.abs(angDiff(a, yaw)) + Math.abs(p - pitch) * 0.5;
      if (sc < bs && this.map.los(this.me.x, this.me.z, x, z)) { bs = sc; best = [a, p]; }
    };
    for (const n of this.npcs.values()) if (n.last && !(n.last.f & F.DOWN) && n.kind !== NPC_GJ) consider(n.last.x, n.last.z);
    for (const p of this.players.values()) if (p.last && !(p.last.f & F.DOWN)) consider(p.last.x, p.last.z);
    return best ? [yaw + angDiff(best[0], yaw) * 0.7, pitch + (best[1] - pitch) * 0.7] : [yaw, pitch];
  }

  interact(inp, dt, now) {
    const me = this.me;
    const tgt = this.findTarget();
    const prompt = $('prompt');
    if (tgt) {
      // le pied-de-biche force les caisses plus vite
      const lootMult = holdTime(tgt.item || '') >= 2 ? (WEAPONS[this.wp.melee]?.loot || 1) : 1;
      const holdNeeded = tgt.bag ? 0.4 : holdTime(tgt.item) * lootMult;
      const heavy = !tgt.bag && me.w + ITEMS[tgt.item].w > me.cap + 1e-6;
      const key = this.app.input.touch ? '' : '[E] ';
      prompt.innerHTML = tgt.bag ? `${key}Fouiller le sac` :
        `${key}${heavy ? 'Trop lourd : ' : 'Prendre '}<b style="color:${RARITY[ITEMS[tgt.item].r].color}">${ITEMS[tgt.item].icon} ${ITEMS[tgt.item].name}</b> · ${ITEMS[tgt.item].value} € · ${ITEMS[tgt.item].w} kg`;
      prompt.classList.add('on');
      $('btnUse')?.classList.add('ready');
      const key2 = (tgt.bag ? 'b' : 'l') + tgt.id;
      if (inp.held.has('interact') && !heavy) {
        if (this.hold.target !== key2) { this.hold.target = key2; this.hold.t = 0; }
        this.hold.t += dt;
        $('holdFill').style.width = Math.min(100, (this.hold.t / holdNeeded) * 100) + '%';
        if (this.hold.t >= holdNeeded) {
          this.tr.send({ t: 'act', a: tgt.bag ? 'bag' : 'pick', id: tgt.id });
          if (!tgt.bag) this.pending.add(tgt.id);
          this.hold.t = -0.3;
        }
      } else if (inp.pressed.has('interact') && heavy) {
        this.toast('Sac trop lourd ! Jette des objets (Tab).', 'warn'); this.audio.play('full');
      } else if (!inp.held.has('interact')) { this.hold.target = null; $('holdFill').style.width = '0%'; }
      const s = tgt.bag ? this.city.bags.get(tgt.id) : this.map.lootSpots[tgt.id];
      this.city.marker.visible = true;
      this.city.marker.position.set(s.x, (s.y ?? 0.4) + 0.35 + Math.sin(now * 4) * 0.03, s.z);
    } else {
      prompt.classList.remove('on');
      $('btnUse')?.classList.remove('ready');
      this.city.marker.visible = false;
      this.hold.target = null;
      $('holdFill').style.width = '0%';
    }
  }

  // objet visé : le plus proche de l'axe du regard, à portée de main
  findTarget() {
    const me = this.me, R = PLAYER.pickRange + 0.3, eye = this.cam.eye;
    const cp = Math.cos(this.cam.pitch);
    const fx = Math.sin(this.cam.yaw) * cp, fy = Math.sin(this.cam.pitch), fz = Math.cos(this.cam.yaw) * cp;
    let best = null, bs = 1e9;
    const score = (x, y, z) => {
      const dx = x - me.x, dy = y - eye, dz = z - me.z;
      const dh = Math.hypot(dx, dz);
      if (dh > R) return 1e9;
      const d = Math.hypot(dx, dy, dz) || 1;
      const cos = (dx * fx + dy * fy + dz * fz) / d;
      if (cos < 0.8 && dh > 1.1) return 1e9;
      return (1 - cos) * 6 + dh * 0.3;
    };
    for (let i = 0; i < this.city.lootItems.length; i++) {
      const item = this.city.lootItems[i];
      if (!item || this.pending.has(i)) continue;
      const s = this.map.lootSpots[i];
      if (Math.abs(s.x - me.x) > R || Math.abs(s.z - me.z) > R) continue;
      const sc = score(s.x, s.y, s.z);
      if (sc < bs) { bs = sc; best = { id: i, item }; }
    }
    for (const b of this.city.bags.values()) {
      const sc = score(b.x, 0.3, b.z);
      if (sc < bs) { bs = sc; best = { id: b.id, bag: true }; }
    }
    return best;
  }

  remoteGun(id, wid, mat) {
    let g = this.remoteGuns.get(id);
    if (g && g.wid !== wid) { this.scene.remove(g.obj); g = null; this.remoteGuns.delete(id); }
    if (!g) {
      const w = WEAPONS[wid];
      const m = w && getModel(weaponPath(w.model));
      if (!m) { if (w) loadModel(weaponPath(w.model)); return; }
      let obj = m.scene.clone();
      if (w.melee) {
        // arme de mêlée verticale (+Y) -> réorientée comme une arme à feu (-Z)
        const wrap = new THREE.Group();
        obj.rotation.x = -Math.PI / 2; obj.position.z = 0.1;
        wrap.add(obj);
        obj = wrap;
      }
      obj.matrixAutoUpdate = false;
      this.scene.add(obj);
      g = { wid, obj };
      this.remoteGuns.set(id, g);
    }
    g.obj.visible = true;
    g.obj.matrix.copy(mat);
    g.obj.matrixWorldNeedsUpdate = true;
  }

  drawWorld(dt, now, inp) {
    const me = this.me;
    const rt = this.tr.multi ? now - this.timeBase - 0.12 : now - this.timeBase - 0.06;
    const drawD2 = this.q.drawDist * this.q.drawDist;
    this.chars.begin();
    for (const g of this.remoteGuns.values()) g.obj.visible = false;
    for (const p of this.players.values()) {
      const s = p.it.sample(rt);
      if (!s) continue;
      if ((s.x - me.x) ** 2 + (s.z - me.z) ** 2 > drawD2) continue;
      if (s.f & F.MOVE) p.phase += dt * (s.f & F.RUN ? 14 : 9);
      const key = s.pack + s.tenue;
      if (!p.look || p.lookKey !== key) { p.look = appearance('player', p.id, { pack: s.pack, tenue: s.tenue }); p.lookKey = key; }
      p.look.gun = !!s.wid && !WEAPONS[s.wid]?.melee;
      const hand = this.chars.draw({ x: s.x, z: s.z, rot: s.rot, phase: p.phase, moving: s.f & F.MOVE, run: s.f & F.RUN, crouch: s.f & F.CROUCH, down: s.f & F.DOWN, attack: s.f & F.ATTACK ? 0.6 : 0, stun: s.f & F.STUN, throw: 0, aim: -(s.pitch || 0) * 0.8 }, p.look);
      if (s.wid && !(s.f & F.DOWN)) this.remoteGun(p.id, s.wid, hand);
      if (p.shotT && now - p.shotT < 0.05) this.fx.flash(s.x + Math.sin(s.rot) * 0.8, 1.45, s.z + Math.cos(s.rot) * 0.8, 0xffc080, 0.06);
      this.label(p.id, s.x, s.z, s.f & F.DOWN);
    }
    for (const id of this.labels.keys()) if (!this.players.has(id)) { this.scene.remove(this.labels.get(id)); this.labels.delete(id); }
    for (const [id, g] of this.remoteGuns) if (typeof id === 'number' && !this.players.has(id)) { this.scene.remove(g.obj); this.remoteGuns.delete(id); }
    for (const n of this.npcs.values()) {
      const s = n.it.sample(rt);
      if (!s) continue;
      if ((s.x - me.x) ** 2 + (s.z - me.z) ** 2 > drawD2) continue;
      if (s.f & F.MOVE) n.phase += dt * (s.f & F.RUN ? 13 : 7);
      if (s.f & F.ATTACK) n.atk = 1; else n.atk = Math.max(0, (n.atk || 0) - dt * 4);
      if (s.f & F.THROW) n.thr = 1; else n.thr = Math.max(0, (n.thr || 0) - dt * 3);
      const hand = this.chars.draw({ x: s.x, z: s.z, rot: s.rot, phase: n.phase, moving: s.f & F.MOVE, run: s.f & F.RUN, crouch: false, down: s.f & F.DOWN, attack: n.kind === NPC_GIGN ? 0 : n.atk, stun: s.f & F.STUN, throw: n.thr }, n.look);
      if (n.kind === NPC_GIGN && !(s.f & F.DOWN)) this.remoteGun('n' + n.id, 'm4a1', hand);
      if (n.kind === NPC_LOOTER && n.wid && !(s.f & F.DOWN)) this.remoteGun('n' + n.id, n.wid, hand);
    }
    for (const [id, g] of this.remoteGuns) if (typeof id === 'string' && !this.npcs.has(Number(id.slice(1)))) { this.scene.remove(g.obj); this.remoteGuns.delete(id); }
    this.chars.end();

    // caméra à la première personne
    const cam = this.gfx.camera;
    const eyeT = me.crouch ? 1.15 : 1.6;
    this.cam.eye += (eyeT - this.cam.eye) * Math.min(1, dt * 10);
    const bob = me.moving ? Math.sin(me.phase * 2) * (me.sprint ? 0.045 : 0.025) * (1 - this.adsK * 0.8) : 0;
    let cx = me.x, cy = this.cam.eye + bob, cz = me.z;
    const sh = this.shake || 0;
    if (sh > 0) { cx += (Math.random() - 0.5) * sh * 0.3; cy += (Math.random() - 0.5) * sh * 0.3; this.shake = Math.max(0, sh - dt * 1.5); }
    cam.position.set(cx, cy, cz);
    cam.rotation.set(this.cam.pitch, this.cam.yaw + Math.PI, me.moving ? Math.sin(me.phase) * 0.004 : 0);
    const w = this.weapon;
    const fov = FOV / (w?.zoom ? 1 + (w.zoom - 1) * this.adsK : 1 + 0.3 * this.adsK);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (this.q.shadows) { this.moon.position.set(me.x + 30, 70, me.z + 15); this.moon.target.position.set(me.x, 0, me.z); }

    this.vm.update(dt, { ads: this.ads, moving: me.moving, sprint: me.sprint, lookX: inp.lookX, lookY: inp.lookY, reload: me.rl > 0 ? Math.max(0.01, 1 - me.rl / (w?.reload || 1)) : 0 });
    this.fx.setScale(this.gfx.renderer.domElement.height, cam.fov);
    this.fx.update(dt, cam.position, this.map.fires);
    this.city.update(now, this.time);
  }

  label(id, x, z, down) {
    let s = this.labels.get(id);
    if (!s) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 48;
      const g = cv.getContext('2d');
      g.font = 'bold 30px Arial'; g.textAlign = 'center';
      g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(this.names.get(id) || '?', 128, 34);
      g.fillStyle = '#7cc4ff'; g.fillText(this.names.get(id) || '?', 128, 34);
      const tex = new THREE.CanvasTexture(cv);
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.scale.set(1.6, 0.3, 1);
      this.scene.add(s);
      this.labels.set(id, s);
    }
    s.position.set(x, down ? 0.8 : 2.15, z);
  }

  dispose() {
    this.audio.stopAmbience();
    this.city.dispose();
    this.chars.dispose();
    this.fx.dispose();
    this.vm.dispose();
    for (const s of this.labels.values()) { this.scene.remove(s); s.material.map.dispose(); s.material.dispose(); }
    for (const o of this.mines.values()) this.scene.remove(o);
    for (const g of this.remoteGuns.values()) this.scene.remove(g.obj);
    this.tr.close();
    this.gfx.camera.fov = FOV;
    this.gfx.camera.updateProjectionMatrix();
    for (const id of ['hud', 'invPanel', 'pause', 'scope']) $(id).classList.remove('on');
    $('flashOverlay').style.opacity = 0;
  }

  render() {
    this.gfx.render(this.scene);
    this.vm.render(this.gfx.renderer);
  }
}
