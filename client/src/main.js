// Point d'entrée : menus (planque, marché noir, quartiers, multi) et boucle principale.
import { Gfx, QUALITY } from './gfx.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Profile } from './profile.js';
import { Raid } from './raid.js';
import { LocalTransport, NetTransport } from './net.js';
import { DISTRICTS, DISTRICT_ORDER, SHOP_TYPES } from '../../shared/config.js';
import { ITEMS, RARITY, GEAR, GEAR_SLOTS, GEAR_SLOT_NAMES, GEAR_BY_ID, CONSUMABLES, TIERS } from '../../shared/items.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('fr-FR') + ' €';

const profile = new Profile();
let gfx;
try {
  gfx = new Gfx($('game'), profile.d.settings.quality);
} catch (e) {
  window.__fatal?.("Impossible d'initialiser la 3D (WebGL) : " + e.message + "\nVérifie que l'accélération matérielle est activée dans ton navigateur.");
  throw e;
}
const input = new Input(gfx.canvas, $('touch'));
const audio = new Audio();
input.sens = profile.d.settings.sens;
audio.setVolume(profile.d.settings.volume);

let raid = null;
let district = profile.d.lastDistrict && profile.d.unlocked[profile.d.lastDistrict] ? profile.d.lastDistrict : 'cite';

const app = { gfx, input, audio, profile, endRaid };

// ---------------------------------------------------------------- menus
function setTab(name) {
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const s of document.querySelectorAll('main section')) s.classList.toggle('on', s.id === 'tab-' + name);
  if (name === 'raid') refreshRooms();
  render();
}
for (const b of document.querySelectorAll('nav button')) b.onclick = () => setTab(b.dataset.tab);

function render() {
  const d = profile.d;
  $('mName').textContent = d.name;
  $('mMoney').textContent = fmt(d.money);

  // quartiers
  $('districts').innerHTML = DISTRICT_ORDER.map((id) => {
    const q = DISTRICTS[id], un = d.unlocked[id];
    const tags = Object.keys(q.shops).map((s) => `<span style="background:${SHOP_TYPES[s].color}">${SHOP_TYPES[s].name}</span>`).join('');
    return `<div class="card ${id === district ? 'sel' : ''} ${un ? '' : 'locked'}" data-d="${id}">
      <h4>${un ? '' : '🔒 '}${q.name}</h4><div class="tags">${tags}</div><p>${q.desc}</p>
      <p>Raid ${Math.round(q.raidTime / 60)} min · Richesse ${'★'.repeat(q.tier)}${'☆'.repeat(3 - q.tier)} · Police ${'🚨'.repeat(q.tier)}</p>
      ${un ? '' : `<button class="primary" data-unlock="${id}" ${d.money < q.unlockCost ? 'disabled' : ''}>Débloquer · ${fmt(q.unlockCost)}</button>`}
    </div>`;
  }).join('');

  // loadout
  $('loadout').innerHTML = GEAR_SLOTS.map((s) => {
    const g = GEAR_BY_ID[d.equipped[s]];
    return `<div><small>${GEAR_SLOT_NAMES[s]}</small>${g.icon} ${g.name}</div>`;
  }).join('') + Object.keys(CONSUMABLES).filter((k) => d.cons[k] > 0).map((k) => `<div><small>${CONSUMABLES[k].name}</small>${CONSUMABLES[k].icon} x${d.cons[k]}</div>`).join('');

  // planque
  const counts = {};
  d.stash.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
  const ids = Object.keys(counts).sort((a, b) => ITEMS[b].value - ITEMS[a].value);
  const total = d.stash.reduce((s, id) => s + ITEMS[id].value, 0);
  $('stash').innerHTML = ids.length ? ids.map((id) => {
    const it = ITEMS[id];
    let keep = '';
    if (it.weapon) {
      const g = GEAR_BY_ID[it.weapon];
      keep = d.owned[g.id] ? ' <small>(déjà possédée)</small>' : g.tier > profile.tier() ? ` <small>🔒 ${TIERS[g.tier].name}</small>` : ` <button class="primary" data-keep="${id}">Garder</button>`;
    }
    return `<div class="row"><span style="color:${RARITY[it.r].color}">${it.icon} ${it.name}${it.weapon ? ' <small>(arme)</small>' : ''} <small>x${counts[id]}</small></span>
      <span>${fmt(it.value)}${keep} <button data-sell="${id}">Vendre</button></span></div>`;
  }).join('') + `<div class="row"><b>Total</b><b>${fmt(total)}</b></div>` : '<div class="empty">Ta planque est vide. Va piller !</div>';
  $('btnSellAll').disabled = !d.stash.length;
  const st = d.stats;
  $('stats').innerHTML = [
    ['Raids', st.raids], ['Extractions', st.extracts], ['Taux de survie', st.raids ? Math.round((st.extracts / st.raids) * 100) + ' %' : '—'],
    ['Meilleur butin', fmt(st.best)], ['Gains totaux', fmt(st.earned)], ['Interpellations', st.arrests],
  ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');

  // marché noir : contacts (paliers), puis équipement
  const lvl = profile.tier();
  const lockBtn = (t) => `<button disabled>🔒 Contact : ${TIERS[t].name}</button>`;
  const contacts = `<div class="tiers">${TIERS.map((t, i) => {
    const ok = i <= lvl;
    const pct = Math.min(100, (d.stats.earned / Math.max(1, t.earned)) * 100);
    const need = [t.earned ? `${fmt(Math.min(d.stats.earned, t.earned))} / ${fmt(t.earned)} revendus` : '', t.district && !d.unlocked[t.district] ? `quartier ${DISTRICTS[t.district].name} à débloquer` : ''].filter(Boolean).join(' · ');
    return `<div class="tier ${ok ? 'ok' : ''}"><b>${t.icon} ${t.name}</b><span>${t.desc}</span>
      ${ok ? '<em>Disponible</em>' : `<div class="prog"><div style="width:${pct}%"></div></div><small>${need}</small>`}</div>`;
  }).join('')}</div>`;
  $('shop').innerHTML = contacts + GEAR_SLOTS.map((s) => `<div class="slot"><h3>${GEAR_SLOT_NAMES[s]}</h3><div class="gear">${GEAR[s].map((g0) => {
    const g = GEAR_BY_ID[g0.id];
    const own = d.owned[g.id], eq = d.equipped[s] === g.id, locked = g.tier > lvl;
    const btn = locked ? lockBtn(g.tier) : eq ? '<button disabled>Équipé</button>' : own ? `<button data-equip="${g.id}">Équiper</button>`
      : `<button class="primary" data-buy="${g.id}" ${d.money < g.price ? 'disabled' : ''}>Acheter · ${fmt(g.price)}</button>`;
    return `<div class="${eq ? 'eq' : ''} ${locked ? 'lock' : ''}"><span class="n">${g.icon} ${g.name}${g.firearm ? ' <small class="fa">arme à feu</small>' : ''}</span><span class="d">${g.desc}</span>${btn}</div>`;
  }).join('')}</div></div>`).join('') +
    `<div class="slot"><h3>Munitions, grenades et soins (perdus si tu tombes)</h3><div class="gear">${Object.keys(CONSUMABLES).map((k) => {
      const c = CONSUMABLES[k];
      if (c.tier > lvl) return `<div class="lock"><span class="n">${c.icon} ${c.name}</span><span class="d">${c.desc}</span>${lockBtn(c.tier)}</div>`;
      return `<div><span class="n">${c.icon} ${c.name} <small>· ${d.cons[k]}/${c.max}</small></span><span class="d">${c.desc}</span>
        <button class="primary" data-cons="${k}" ${d.money < c.price || d.cons[k] + c.pack > c.max ? 'disabled' : ''}>Acheter · ${fmt(c.price)}</button></div>`;
    }).join('')}</div></div>`;

  // réglages
  $('setName').value = d.name;
  $('setQuality').value = d.settings.quality;
  $('setSens').value = d.settings.sens;
  $('setVol').value = d.settings.volume;
  $('gpuInfo').textContent = `Qualité active : ${QUALITY[gfx.qName].label}. La résolution s'adapte automatiquement pour garder un jeu fluide.`;
}

$('menu').addEventListener('click', (e) => {
  const t = e.target.closest('[data-d],[data-unlock],[data-sell],[data-keep],[data-buy],[data-equip],[data-cons]');
  if (!t) return;
  audio.init();
  if (t.dataset.unlock) { if (profile.unlock(t.dataset.unlock)) { district = t.dataset.unlock; audio.play('cash'); } }
  else if (t.dataset.d) { if (profile.d.unlocked[t.dataset.d]) district = t.dataset.d; }
  else if (t.dataset.keep) { if (profile.keepWeapon(profile.d.stash.indexOf(t.dataset.keep))) audio.play('pick'); }
  else if (t.dataset.sell) { profile.sell(profile.d.stash.indexOf(t.dataset.sell)); audio.play('cash'); }
  else if (t.dataset.buy) { if (profile.buyGear(t.dataset.buy)) audio.play('cash'); }
  else if (t.dataset.equip) profile.equip(t.dataset.equip);
  else if (t.dataset.cons) { if (profile.buyCons(t.dataset.cons)) audio.play('pick'); }
  render();
});
$('btnSellAll').onclick = () => { const v = profile.sellAll(); if (v) audio.play('cash'); render(); };
$('setName').onchange = (e) => { profile.d.name = e.target.value.trim().slice(0, 16) || profile.d.name; profile.save(); render(); };
$('setQuality').onchange = (e) => { profile.d.settings.quality = e.target.value; profile.save(); location.reload(); };
$('setSens').oninput = (e) => { profile.d.settings.sens = Number(e.target.value); input.sens = profile.d.settings.sens; profile.save(); };
$('setVol').oninput = (e) => { profile.d.settings.volume = Number(e.target.value); audio.setVolume(profile.d.settings.volume); profile.save(); };
$('btnReset').onclick = () => { if (confirm('Effacer toute ta progression ?')) { profile.reset(); render(); } };

// ---------------------------------------------------------------- lancement
function showLoading(v) { $('loading').classList.toggle('on', v); }

async function startRaid(transport, welcome, code) {
  try { await startRaid0(transport, welcome, code); } catch (e) {
    console.error(e);
    showLoading(false);
    raid = null;
    window.__fatal?.('Le raid n\'a pas pu démarrer : ' + (e && e.message ? e.message : e));
  }
}

async function startRaid0(transport, welcome, code) {
  showLoading(true);
  try { await Raid.preload(app.raidLoadout); } catch { /* modèles manquants : formes de secours */ }
  profile.raidStart();
  profile.d.lastDistrict = district;
  profile.save();
  $('menu').classList.remove('on');
  raid = new Raid(app, transport, welcome);
  // pré-compilation des shaders pendant l'écran de chargement (évite les saccades au début)
  raid.update(0);
  gfx.renderer.compile(raid.scene, gfx.camera);
  $('roomCode').textContent = code ? `Salon ${code} · ${welcome.players.length} joueur(s)` : '';
  input.setEnabled(true);
  if (!input.touch) gfx.canvas.requestPointerLock?.();
  if (input.touch) document.documentElement.requestFullscreen?.().catch(() => {});
  showLoading(false);
}

$('btnSolo').onclick = () => {
  audio.init();
  showLoading(true);
  // on laisse le navigateur afficher l'écran de chargement avant la génération
  app.raidLoadout = profile.loadout();
  setTimeout(() => {
    try {
      const tr = new LocalTransport(district, profile.d.name, app.raidLoadout);
      const i = tr.queue.findIndex((m) => m.t === 'welcome');
      const welcome = tr.queue.splice(i, 1)[0];
      startRaid(tr, welcome, null);
    } catch (e) {
      showLoading(false);
      window.__fatal?.('Le raid n\'a pas pu démarrer : ' + e.message);
    }
  }, 30);
};

async function startMulti(msg) {
  audio.init();
  showLoading(true);
  const net = new NetTransport();
  try {
    await net.open();
    app.raidLoadout = profile.loadout();
    net.send({ ...msg, name: profile.d.name, loadout: app.raidLoadout });
    const r = await net.waitFor(['room', 'error']);
    if (r.t === 'error') throw new Error(r.msg);
    const welcome = await net.waitFor(['welcome', 'error']);
    if (welcome.t === 'error') throw new Error(welcome.msg);
    district = welcome.district;
    await startRaid(net, welcome, r.code);
  } catch (e) {
    net.close();
    showLoading(false);
    alert('Multijoueur : ' + e.message + (location.port === '5173' ? '\n(lance aussi "npm run dev:server")' : ''));
  }
}
$('btnCreate').onclick = () => startMulti({ t: 'create', district, public: $('chkPublic').checked });
$('btnJoin').onclick = () => {
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length === 4) startMulti({ t: 'join', code });
};
$('roomList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-room]');
  if (b) startMulti({ t: 'join', code: b.dataset.room });
});
$('btnRefresh').onclick = refreshRooms;

async function refreshRooms() {
  const el = $('roomList');
  const net = new NetTransport();
  try {
    await net.open();
    net.send({ t: 'list' });
    const r = await net.waitFor(['list'], 3000);
    el.innerHTML = r.rooms.length ? r.rooms.map((x) => `<div class="room"><span><b>${x.code}</b> · ${DISTRICTS[x.district].name} · ${x.players} joueur(s) · ${Math.floor(x.left / 60)} min restantes</span>
      <button data-room="${x.code}" ${profile.d.unlocked[x.district] ? '' : 'disabled'}>Rejoindre</button></div>`).join('') : 'Aucune partie publique. Crée la tienne !';
  } catch {
    el.textContent = 'Serveur multijoueur indisponible (le solo fonctionne hors ligne).';
  } finally { net.close(); }
}

// ---------------------------------------------------------------- fin de raid
const REASONS = {
  arrest: ['🚔 Interpellé !', 'Les CRS t\'ont arrêté. Butin saisi'],
  rival: ['💥 K.O.', 'Un pilleur rival t\'a mis à terre et a fait les poches'],
  gign: ['🎯 Neutralisé par le GIGN', 'Le GIGN t\'a interpellé. Butin et armes saisis'],
  ko: ['💥 K.O.', 'Un émeutier t\'a mis à terre et a fait les poches'],
  pvp: ['💥 K.O.', 'Un autre pilleur t\'a eu'],
  timeout: ['⏱ Trop tard', 'Le quartier est bouclé : tu es coincé'],
  quit: ['🏳 Abandon', 'Tu as lâché ton butin'],
  disconnect: ['📡 Connexion perdue', 'Le butin est perdu'],
};

function endRaid(m) {
  if (!raid) return;
  raid.dispose();
  raid = null;
  input.setEnabled(false);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  let title, sub, items;
  if (m.t === 'out') {
    profile.raidExtract(m.items, m.cons);
    title = '✅ Extraction réussie';
    sub = `Butin rapporté à la planque : <b>${fmt(m.value)}</b>`;
    items = m.items;
  } else {
    const fine = profile.raidFail(m.reason);
    const [t, s] = REASONS[m.reason] || REASONS.ko;
    title = t;
    sub = `${s}${m.value ? ` (${fmt(m.value)} perdus)` : ''}.${fine ? ` Amende : <b>${fmt(fine)}</b>.` : ''}`;
    items = m.lost || [];
  }
  $('resTitle').innerHTML = title;
  $('resSub').innerHTML = sub;
  $('resList').innerHTML = items.map((id) => `<div class="row"><span style="color:${RARITY[ITEMS[id].r].color}">${ITEMS[id].icon} ${ITEMS[id].name}</span><span>${fmt(ITEMS[id].value)}</span></div>`).join('');
  $('result').classList.add('on');
}
$('btnBack').onclick = () => {
  $('result').classList.remove('on');
  $('menu').classList.add('on');
  setTab(profile.d.stash.length ? 'stash' : 'raid');
};

// ---------------------------------------------------------------- boucle
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (raid) {
    raid.update(dt);
    if (raid) { raid.render(); gfx.adapt(dt); }
  }
}
requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => { if (raid) profile.save(); });
render();
refreshRooms();
window.__pillageReady = true;
window.addEventListener('unhandledrejection', (e) => console.error('promesse rejetée', e.reason));

// accès debug depuis la console
window.__pillage = { profile, get raid() { return raid; } };
