// Client d'un raid : prédiction du joueur local, interpolation des entités distantes, caméra, HUD.
import * as THREE from 'three';
import { getMap } from '../../shared/map.js';
import { PLAYER, SHOP_TYPES } from '../../shared/config.js';
import { ITEMS, RARITY, GEAR_BY_ID, invValue, holdTime } from '../../shared/items.js';
import { F, NPC_CRS } from '../../shared/world.js';
import { CityView } from './cityView.js';
import { CharacterRenderer, appearance } from './chars.js';
import { Fx } from './fx.js';

const $ = (id) => document.getElementById(id);
const SEND_DT = 0.05;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

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
        return { x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k, rot: a.rot + angDiff(c.rot, a.rot) * k, f: c.f, hp: c.hp, kind: c.kind, pack: c.pack };
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
    this.lo = this.profile.loadout();
    this.weapon = GEAR_BY_ID[this.lo.weapon];
    this.speedMult = GEAR_BY_ID[this.lo.shoes].speed;

    const scene = (this.scene = new THREE.Scene());
    const fogC = 0x1b1820;
    scene.background = new THREE.Color(fogC);
    scene.fog = new THREE.Fog(fogC, 18, this.q.fogFar);
    this.gfx.camera.far = this.q.fogFar + 10;
    this.gfx.camera.updateProjectionMatrix();
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
    for (const [id, item] of welcome.loot) this.city.setLoot(id, item);
    for (const [id, x, z] of welcome.bags) this.city.addBag(id, x, z);

    this.me = {
      x: welcome.x, z: welcome.z, rot: 0, hp: PLAYER.hp, stamina: PLAYER.stamina, inv: [], w: 0, cap: welcome.cap,
      stun: 0, gas: 0, ex: 0, ammo: { ...this.lo.cons }, band: this.lo.cons.bandage, phase: 0, atkT: -9, cdU: 0, moving: false, sprint: false, alive: true,
    };
    this.cam = { yaw: Math.PI / 4, pitch: 0.32 };
    this.players = new Map();
    this.names = new Map(welcome.players);
    this.npcs = new Map();
    this.sendT = 0;
    this.hold = { target: null, t: 0 };
    this.pending = new Set();
    this.heat = 0;
    this.ended = false;
    this.paused = false;
    this.labels = new Map();
    this.hudT = 0;
    this.lastHurt = 0;

    this.buildMinimap();
    this.setupHud();
    this.audio.startAmbience();
  }

  // ------------------------------------------------------------------ HUD
  setupHud() {
    $('hud').classList.add('on');
    $('invPanel').classList.remove('on');
    $('pause').classList.remove('on');
    $('weaponTxt').textContent = `${this.weapon.icon} ${this.weapon.name}`;
    this.toast(`Raid : ${this.map.d.name}. Pille, puis rejoins une sortie verte.`, 'info', 4500);
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
    // sorties
    for (const e of this.exits) {
      ctx.fillStyle = this.time >= e.activeFrom ? '#40ff80' : '#777';
      ctx.beginPath(); ctx.arc(e.x, e.z, 3.5, 0, 7); ctx.fill();
    }
    // loot restant visible à proximité
    ctx.fillStyle = '#ffd43b';
    for (let i = 0; i < this.city.lootItems.length; i++) {
      if (!this.city.lootItems[i]) continue;
      const l = this.map.lootSpots[i];
      if (Math.abs(l.x - this.me.x) < 36 && Math.abs(l.z - this.me.z) < 36) ctx.fillRect(l.x - 0.5, l.z - 0.5, 1, 1);
    }
    // PNJ (CRS visibles seulement à moins de 30 m : on les entend)
    for (const n of this.npcs.values()) {
      const s0 = n.last;
      if (!s0 || s0.f & F.DOWN) continue;
      const d = Math.hypot(s0.x - this.me.x, s0.z - this.me.z);
      if (s0.kind === NPC_CRS) { if (d > 30) continue; ctx.fillStyle = '#ff3b3b'; }
      else { if (d > 20) continue; ctx.fillStyle = '#ff9f43'; }
      ctx.fillRect(s0.x - 1, s0.z - 1, 2, 2);
    }
    for (const p of this.players.values()) {
      if (!p.last) continue;
      ctx.fillStyle = '#4dabf7';
      ctx.beginPath(); ctx.arc(p.last.x, p.last.z, 1.5, 0, 7); ctx.fill();
    }
    ctx.restore();
    // joueur au centre (flèche vers le haut = direction de la caméra)
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 7); ctx.lineTo(W / 2 - 5, W / 2 + 5); ctx.lineTo(W / 2 + 5, W / 2 + 5); ctx.fill();
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
    const am = this.weapon.ammo;
    $('ammoTxt').textContent = am ? `${me.ammo[am] ?? 0} ${am === 'bille' ? 'billes' : 'fusées'}` : '';
    $('bandTxt').textContent = `🩹 ${me.band}`;
    // boussole des sorties
    const ex = this.exits.map((e) => {
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      const a = angDiff(Math.atan2(e.x - me.x, e.z - me.z), this.cam.yaw);
      const active = this.time >= e.activeFrom;
      const arrow = ['⬆', '⬈', '➡', '⬊', '⬇', '⬋', '⬅', '⬉'][((Math.round((-a / (Math.PI * 2)) * 8) % 8) + 8) % 8];
      return `<div class="${active ? '' : 'off'}">${arrow} ${e.name} · ${Math.round(d)} m${active ? '' : ' · ' + fmtTime(e.activeFrom - this.time)}</div>`;
    }).join('');
    if (ex !== this._ex) { $('exits').innerHTML = ex; this._ex = ex; }
    // extraction
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

  // ------------------------------------------------------------------ réseau
  handle(m, now) {
    switch (m.t) {
      case 'snap': {
        this.time = m.tm;
        this.timeBase = now - m.tm;
        this.heat = m.h;
        const seenP = new Set(), seenN = new Set();
        for (const [id, x, z, rot, f, hp, pack] of m.p) {
          let p = this.players.get(id);
          if (!p) { p = { id, it: new Interp(), phase: 0 }; this.players.set(id, p); }
          p.it.push(m.tm, { x, z, rot, f, hp, pack });
          p.last = { x, z, f };
          seenP.add(id);
        }
        for (const [id, kind, x, z, rot, f] of m.n) {
          let n = this.npcs.get(id);
          if (!n) { n = { id, kind, it: new Interp(), phase: Math.random() * 6, look: appearance(kind === NPC_CRS ? 'crs' : 'rioter', id) }; this.npcs.set(id, n); }
          n.it.push(m.tm, { x, z, rot, f, kind });
          n.last = { x, z, f, kind };
          seenN.add(id);
        }
        for (const id of this.players.keys()) if (!seenP.has(id)) this.players.delete(id);
        for (const id of this.npcs.keys()) if (!seenN.has(id)) this.npcs.delete(id);
        const me = this.me, s = m.me;
        if (s.hp < me.hp - 0.5) this.lastHurt = now;
        me.hp = s.hp; me.stun = s.st; me.gas = s.g; me.ex = s.ex; me.ammo = s.am; me.band = s.b;
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
      case 'proj': {
        this.fx.addProj(m);
        const d = Math.hypot(m.x - this.me.x, m.z - this.me.z);
        this.audio.play(m.k === 'lbd' ? 'lbd' : m.k === 'bille' || m.k === 'fusee' ? 'shoot' : 'swing', d);
        break;
      }
      case 'projend': this.fx.endProj(m); break;
      case 'fx': {
        const d = Math.hypot(m.x - this.me.x, m.z - this.me.z);
        if (m.k === 'hit') { this.fx.hit(m.x, m.y, m.z); this.audio.play('hit', d); }
        else if (m.k === 'boom') { this.fx.boom(m.x, m.y, m.z); this.audio.play('boom', d); this.shake = Math.max(this.shake || 0, Math.max(0, 0.5 - d / 40)); }
        else if (m.k === 'gas') { this.fx.addGas(m.x, m.z, m.r, m.ttl); this.audio.play('gas', d); }
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
      case 'gotbag': this.toast(`+ ${m.n} objet(s) récupéré(s)`, 'loot'); this.audio.play('pick'); break;
      case 'full': this.toast('Sac trop lourd !', 'warn'); this.audio.play('full'); break;
      case 'hurt': {
        this.lastHurt = now;
        this.audio.play('hurt');
        this.shake = Math.max(this.shake || 0, 0.25);
        const a = angDiff(Math.atan2(m.x - this.me.x, m.z - this.me.z), this.cam.yaw);
        const el = $('dmgDir');
        el.style.transform = `rotate(${-a}rad)`;
        el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
        break;
      }
      case 'hitc': $('crosshair').classList.remove('hit'); void $('crosshair').offsetWidth; $('crosshair').classList.add('hit'); break;
      case 'stolen': this.toast(`Un émeutier t'a volé : ${ITEMS[m.item].icon} ${ITEMS[m.item].name} ! Rattrape-le !`, 'warn', 3500); break;
      case 'aggro': this.toast('Un émeutier en veut à ton butin !', 'warn'); break;
      case 'spotted': if (now - (this._spot || 0) > 6) { this._spot = now; this.toast('Repéré par les CRS !', 'danger'); this.audio.play('spotted'); } break;
      case 'sirene': this.toast('Renforts de CRS en approche', 'danger'); this.audio.play('sirene'); break;
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

    // envoi de l'état local à 20 Hz
    this.sendT += dt;
    if (this.sendT >= SEND_DT && !this.ended) {
      this.sendT = 0;
      this.tr.send({ t: 'state', x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, r: Math.round(me.rot * 100) / 100, c: inp.crouch ? 1 : 0, s: me.sprint ? 1 : 0, m: me.moving ? 1 : 0 });
    }

    this.drawWorld(dt, now, inp);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
    $('vignette').style.opacity = Math.max(0, 1 - (now - this.lastHurt) * 2) * 0.8 + (me.hp < 30 ? 0.35 : 0);
    $('gasOverlay').style.opacity = me.gas ? 0.55 : 0;
  }

  control(inp, dt, now) {
    const me = this.me;
    this.cam.yaw -= inp.lookX * 0.0026;
    this.cam.pitch = Math.max(-0.25, Math.min(1.1, this.cam.pitch + inp.lookY * 0.002));
    let mx = inp.mx, my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const fwdX = Math.sin(this.cam.yaw), fwdZ = Math.cos(this.cam.yaw);
    const rgtX = -fwdZ, rgtZ = fwdX;
    let dx = fwdX * my + rgtX * mx, dz = fwdZ * my + rgtZ * mx;
    const moving = ml > 0.1 && me.stun <= 0;
    me.sprint = moving && inp.sprint && !inp.crouch && me.stamina > 1 && my > -0.2;
    me.stamina = Math.max(0, Math.min(PLAYER.stamina, me.stamina + (me.sprint ? -PLAYER.staminaDrain : PLAYER.staminaRegen) * dt));
    if (moving) {
      let sp = PLAYER.walk * this.speedMult * (me.sprint ? PLAYER.sprintMult : inp.crouch ? PLAYER.crouchMult : 1);
      sp *= 1 - 0.3 * Math.min(1, me.w / me.cap);
      if (me.gas) sp *= 0.6;
      const k = Math.min(1, ml);
      [me.x, me.z] = this.map.move(me.x, me.z, dx * sp * dt, dz * sp * dt, PLAYER.radius);
      const want = Math.atan2(dx, dz);
      me.rot += angDiff(want, me.rot) * Math.min(1, dt * 12);
      me.phase += dt * sp * 2.2 * k;
    }
    me.moving = moving;
    me.crouch = inp.crouch;

    // attaque
    const wantAtk = inp.pressed.has('attack') || (inp.held.has('attack') && this.weapon.type === 'melee');
    const alt = inp.pressed.has('alt');
    if ((wantAtk || alt) && now > me.cdU && me.stun <= 0) {
      let yaw = this.cam.yaw;
      if (this.app.input.touch) yaw = this.autoAim(yaw);
      const ranged = this.weapon.type === 'ranged' && !alt && (me.ammo[this.weapon.ammo] ?? 0) > 0;
      const w = ranged || this.weapon.type === 'melee' ? this.weapon : GEAR_BY_ID.poings;
      me.cdU = now + w.cd;
      me.atkT = now;
      me.rot = yaw;
      if (!ranged) this.audio.play('swing');
      this.tr.send({ t: 'act', a: 'atk', yaw, pitch: Math.round((-(this.cam.pitch - 0.3) * 0.9 + 0.04) * 100) / 100, alt: alt ? 1 : 0 });
    }
    if (inp.pressed.has('heal')) this.tr.send({ t: 'act', a: 'heal' });

    // interaction (loot / sac au sol)
    const tgt = this.findTarget();
    const prompt = $('prompt');
    if (tgt) {
      const holdNeeded = tgt.bag ? 0.4 : holdTime(tgt.item);
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
      } else { this.hold.target = null; $('holdFill').style.width = '0%'; }
      const s = tgt.bag ? this.city.bags.get(tgt.id) : this.map.lootSpots[tgt.id];
      this.city.marker.visible = true;
      this.city.marker.position.set(s.x, (s.y ?? 0.4) + 0.55 + Math.sin(now * 4) * 0.05, s.z);
    } else {
      prompt.classList.remove('on');
      $('btnUse')?.classList.remove('ready');
      this.city.marker.visible = false;
      this.hold.target = null;
      $('holdFill').style.width = '0%';
    }
  }

  autoAim(yaw) {
    let best = null, bestScore = 1e9;
    const consider = (x, z) => {
      const d = Math.hypot(x - this.me.x, z - this.me.z);
      if (d > (this.weapon.type === 'ranged' ? 26 : 3.5)) return;
      const a = Math.atan2(x - this.me.x, z - this.me.z);
      const da = Math.abs(angDiff(a, yaw));
      if (da > 0.6) return;
      const sc = da * 10 + d;
      if (sc < bestScore && this.map.los(this.me.x, this.me.z, x, z)) { bestScore = sc; best = a; }
    };
    for (const n of this.npcs.values()) if (n.last && !(n.last.f & F.DOWN)) consider(n.last.x, n.last.z);
    for (const p of this.players.values()) if (p.last && !(p.last.f & F.DOWN)) consider(p.last.x, p.last.z);
    return best ?? yaw;
  }

  findTarget() {
    const me = this.me, R = PLAYER.pickRange;
    let best = null, bd = R;
    const fx = Math.sin(this.cam.yaw), fz = Math.cos(this.cam.yaw);
    for (let i = 0; i < this.city.lootItems.length; i++) {
      const item = this.city.lootItems[i];
      if (!item || this.pending.has(i)) continue;
      const s = this.map.lootSpots[i];
      const dx = s.x - me.x, dz = s.z - me.z;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      // préfère ce qui est devant la caméra
      const d = Math.hypot(dx, dz) - ((dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1)) * 0.4;
      if (d < bd) { bd = d; best = { id: i, item }; }
    }
    for (const b of this.city.bags.values()) {
      const d = Math.hypot(b.x - me.x, b.z - me.z);
      if (d < bd) { bd = d; best = { id: b.id, bag: true }; }
    }
    return best;
  }

  drawWorld(dt, now, inp) {
    const me = this.me;
    const rt = this.tr.multi ? now - this.timeBase - 0.12 : now - this.timeBase - 0.06;
    const drawD2 = this.q.drawDist * this.q.drawDist;
    this.chars.begin();
    // joueur local
    const myLook = this._myLook || (this._myLook = appearance('player', this.myId, { pack: this.lo.backpack, stick: this.weapon.type === 'melee' && this.weapon.id !== 'poings', helmet: this.lo.armor !== 'capuche', color: 0xff7a18 }));
    const atk = Math.max(0, 1 - (now - me.atkT) / 0.3);
    this.chars.draw({ x: me.x, z: me.z, rot: me.rot, phase: me.phase, moving: me.moving, run: me.sprint, crouch: me.crouch, down: this.ended && me.hp <= 0, attack: atk, stun: me.stun > 0, throw: 0 }, myLook);
    // autres joueurs
    for (const p of this.players.values()) {
      const s = p.it.sample(rt);
      if (!s) continue;
      if ((s.x - me.x) ** 2 + (s.z - me.z) ** 2 > drawD2) continue;
      if (s.f & F.MOVE) p.phase += dt * (s.f & F.RUN ? 14 : 9);
      if (!p.look || p.look.packId !== s.pack) { p.look = appearance('player', p.id, { pack: s.pack }); p.look.packId = s.pack; }
      this.chars.draw({ x: s.x, z: s.z, rot: s.rot, phase: p.phase, moving: s.f & F.MOVE, run: s.f & F.RUN, crouch: s.f & F.CROUCH, down: s.f & F.DOWN, attack: s.f & F.ATTACK ? 0.6 : 0, stun: s.f & F.STUN, throw: 0 }, p.look);
      this.label(p.id, s.x, s.z, s.f & F.DOWN);
    }
    for (const id of this.labels.keys()) if (!this.players.has(id)) { this.scene.remove(this.labels.get(id)); this.labels.delete(id); }
    // PNJ
    for (const n of this.npcs.values()) {
      const s = n.it.sample(rt);
      if (!s) continue;
      if ((s.x - me.x) ** 2 + (s.z - me.z) ** 2 > drawD2) continue;
      if (s.f & F.MOVE) n.phase += dt * (s.f & F.RUN ? 13 : 7);
      if (s.f & F.ATTACK) n.atk = 1; else n.atk = Math.max(0, (n.atk || 0) - dt * 4);
      if (s.f & F.THROW) n.thr = 1; else n.thr = Math.max(0, (n.thr || 0) - dt * 3);
      this.chars.draw({ x: s.x, z: s.z, rot: s.rot, phase: n.phase, moving: s.f & F.MOVE, run: s.f & F.RUN, crouch: false, down: s.f & F.DOWN, attack: n.atk, stun: s.f & F.STUN, throw: n.thr }, n.look);
    }
    this.chars.end();

    // caméra 3e personne avec collision
    const cam = this.gfx.camera;
    const yaw = this.cam.yaw, pitch = this.cam.pitch;
    const indoor = this.map.shopAt(me.x, me.z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    const dist = indoor ? 3.2 : 4.4;
    const tx = me.x + rx * 0.55, tz = me.z + rz * 0.55, ty = me.crouch ? 1.2 : 1.6;
    let cx = tx - fx * dist * Math.cos(pitch), cz = tz - fz * dist * Math.cos(pitch);
    const t = this.map.raycast(me.x, me.z, cx, cz, 1.8);
    if (t < 1) { const k = Math.max(0.05, t - 0.08); cx = me.x + (cx - me.x) * k; cz = me.z + (cz - me.z) * k; }
    let cy = ty + Math.sin(pitch) * dist * (indoor ? 0.6 : 1);
    if (indoor) cy = Math.min(cy, 3.6);
    const sh = this.shake || 0;
    if (sh > 0) { cx += (Math.random() - 0.5) * sh; cy += (Math.random() - 0.5) * sh; this.shake = Math.max(0, sh - dt * 1.5); }
    cam.position.set(cx, Math.max(0.4, cy), cz);
    const lp = pitch * 0.85;
    cam.lookAt(cx + fx * Math.cos(lp) * 10, cy - Math.sin(lp) * 10 + 0.6, cz + fz * Math.cos(lp) * 10);
    if (this.q.shadows) { this.moon.position.set(me.x + 30, 70, me.z + 15); this.moon.target.position.set(me.x, 0, me.z); }

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
    for (const s of this.labels.values()) { this.scene.remove(s); s.material.map.dispose(); s.material.dispose(); }
    this.tr.close();
    $('hud').classList.remove('on');
    $('invPanel').classList.remove('on');
    $('pause').classList.remove('on');
  }

  render() { this.gfx.render(this.scene); }
}
