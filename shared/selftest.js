// Test headless de la simulation : un bot joueur pille puis rejoint une sortie.
import { World } from './world.js';
import { DISTRICT_ORDER } from './config.js';
import { getMap } from './map.js';

for (const did of DISTRICT_ORDER) {
  const t0 = performance.now();
  const map = getMap(did);
  const tGen = performance.now() - t0;
  const w = new World(did, { seed: 7, snapEvery: 2 });
  const msgs = {};
  let snapBytes = 0, nSnaps = 0, result = null; const stats = {};
  const p = w.addPlayer(1, 'bot', { backpack: 'sac_sport', primary: 'ak47', sidearm: 'makarov', tenue: 'gilet_jaune', cons: { a762: 120, a9: 30, bandage: 2, frag: 2, fumi: 1 } }, (m) => {
    msgs[m.t] = (msgs[m.t] || 0) + 1;
    if (m.t === 'snap') { snapBytes += JSON.stringify(m).length; nSnaps++; }
    if (m.t === 'ko' || m.t === 'out') result = m;
  });
  // bot : marche vers le loot le plus proche, le prend, puis va à la sortie
  let path = null, pi = 0, goal = null;
  const t1 = performance.now();
  let steps = 0;
  while (!result && !w.ended && steps < 20 * 600) {
    steps++;
    if (!goal) {
      const free = w.loot.filter((l) => !l.taken);
      if (p.inv.length < 4 && free.length) {
        free.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        goal = { kind: 'loot', l: free[0], x: free[0].x, z: free[0].z };
      } else goal = { kind: 'exit', x: map.exits[0].x, z: map.exits[0].z };
      path = map.path(p.x, p.z, goal.x, goal.z); pi = 0;
      if (!path) { console.log('no path!', goal); break; }
    }
    if (goal.kind === 'loot' && Math.hypot(goal.x - p.x, goal.z - p.z) < 1.6) pi = path.length;
    if (pi < path.length) {
      const wp = path[pi], dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz);
      const s = Math.min(d, 5 * 0.05);
      const [nx, nz] = map.move(p.x, p.z, (dx / d) * s || 0, (dz / d) * s || 0, 0.38);
      w.onMessage(1, { t: 'state', x: nx, z: nz, r: Math.atan2(dx, dz), m: 1 });
      if (d < 0.4) pi++;
    } else if (goal.kind === 'loot') {
      w.onMessage(1, { t: 'act', a: 'pick', id: goal.l.id });
      goal = null;
    }
    // tire sur le PNJ le plus proche en vue, lance une grenade de temps en temps
    if (steps % 6 === 0) {
      const t = w.npcs.filter((n) => n.st !== 'down' && n.kind !== 2).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (t && Math.hypot(t.x - p.x, t.z - p.z) < 30 && w.los(p.x, p.z, t.x, t.z)) w.onMessage(1, { t: 'act', a: 'fire', yaw: Math.atan2(t.x - p.x, t.z - p.z), pitch: -0.02, ads: 1, rt: w.time });
    }
    if (steps % 400 === 0) w.onMessage(1, { t: 'act', a: 'throw', k: steps % 800 ? 'frag' : 'fumi', yaw: p.rot, pitch: 0.2 });
    if (steps === 50) stats.ammo0 = p.ammo.a762 + p.mag.primary;
    w.step();
  }
  const ms = performance.now() - t1;
  console.log(`${did}: map ${map.size}m gen ${tGen.toFixed(0)}ms, shops ${map.shops.length}, loot ${map.lootSpots.length}, solids ${map.solids.length}`);
  console.log(`  ${steps} ticks en ${ms.toFixed(0)}ms (${(ms / steps).toFixed(3)} ms/tick), npcs ${w.npcs.length}, heat ${w.heat.toFixed(0)}`);
  const kinds = [0, 1, 2, 3, 4].map((k) => w.npcs.filter((n) => n.kind === k).length);
  console.log(`  PNJ émeutiers/CRS/GJ/GIGN/rivaux: ${kinds.join('/')}, cortèges ${w.corteges.length}, munitions ${stats.ammo0} -> ${p.ammo.a762 + p.mag.primary}, PNJ à terre ${w.npcs.filter((n) => n.st === 'down').length}`);
  console.log(`  résultat: ${result ? result.t + ' ' + (result.reason || '') + ' ' + (result.value ?? '') + '€' : 'aucun'}, snap moyen ${(snapBytes / nSnaps).toFixed(0)} o`, JSON.stringify(msgs));
}

// --- Discrétion dans le cortège : en gilet jaune au milieu des GJ, un CRS ne nous repère pas
{
  const w = new World('cite', { seed: 3 });
  const p = w.addPlayer(1, 'gj', { tenue: 'gilet_jaune' }, () => {});
  p.inv.push('smartphone'); // butin visible : normalement suspect
  for (let i = 0; i < 200; i++) w.step(); // le cortège se met en marche
  const g = w.corteges[0], L = g.members[3];
  const crs = w.npcs.find((n) => n.kind === 1);
  const place = () => {
    p.x = L.x; p.z = L.z;
    crs.x = L.x + 9; crs.z = L.z; crs.rot = -Math.PI / 2; crs.mode = 'patrol';
  };
  place();
  for (let i = 0; i < 6; i++) { w.step(); p.x = L.x; p.z = L.z; }
  const crowd = p.crowd;
  crs.mode = 'patrol'; crs.x = L.x + 9; crs.z = L.z; crs.rot = -Math.PI / 2;
  w.crsThink(crs);
  const spottedInCrowd = crs.mode === 'chase';
  // même scène, sans le cortège autour
  w.npcs = w.npcs.filter((n) => n.kind !== 2); w.corteges = [];
  p.crowd = 0; crs.mode = 'patrol';
  w.crsThink(crs);
  const spottedAlone = crs.mode === 'chase' || !w.los(crs.x, crs.z, p.x, p.z);
  console.log(`cortège : crowd=${crowd} repéré dans la foule=${spottedInCrowd} repéré seul=${spottedAlone}`);
  if (crowd !== 2 || spottedInCrowd || !spottedAlone) { console.error('ÉCHEC test cortège'); process.exitCode = 1; }
}

// --- Escalade : sans arme à feu, pas de GIGN ; avec, le GIGN arrive après les premiers tirs
for (const armed of [false, true]) {
  const w = new World('cite', { seed: 5 });
  const p = w.addPlayer(1, 'x', armed ? { primary: 'ak47', cons: { a762: 90 } } : { primary: 'mortier', cons: { am: 12 } }, () => {});
  p.hp = p.maxHp = 1e9;
  for (let i = 0; i < 20 * 60; i++) {
    if (i % 20 === 0) { w.onMessage(1, { t: 'act', a: 'fire', yaw: 0, pitch: 0.3 }); if (i % 200 === 0) w.onMessage(1, { t: 'act', a: 'reload' }); }
    w.step();
  }
  const gign = w.npcs.filter((n) => n.kind === 3).length;
  console.log(`${armed ? 'avec' : 'sans'} arme à feu : GIGN sur zone = ${gign}, tirs ${w.gunShots}`);
  if (armed ? gign < 4 : gign > 0) { console.error('ÉCHEC test escalade'); process.exitCode = 1; }
}

// --- Pilleurs rivaux : ils pillent, et une fois K.O. leur sac contient butin, arme et munitions
{
  const w = new World('centre', { seed: 11 });
  const p = w.addPlayer(1, 'x', {}, () => {});
  p.hp = p.maxHp = 1e9;
  const rivals = () => w.npcs.filter((n) => n.kind === 4);
  const r0 = rivals().length;
  for (let i = 0; i < 20 * 50; i++) w.step();
  const looted = rivals().reduce((s, n) => s + n.inv.length, 0);
  const n = rivals().find((x) => x.st !== 'down');
  const before = w.bags.size;
  w.damage(n, 1e4, { kind: 'player', id: 1, x: n.x, z: n.z }, false);
  const bag = [...w.bags.values()].pop();
  p.x = bag.x; p.z = bag.z;
  w.pickBag(p, bag.id);
  const gotWeapon = p.inv.some((id) => id.startsWith('w_'));
  console.log(`rivaux : ${r0} au départ, ${looted} objets pillés en 50 s, sac lâché=${w.bags.size >= before}, arme récupérée=${gotWeapon} (${p.inv.join(', ')})`);
  if (!r0 || !gotWeapon) { console.error('ÉCHEC test rivaux'); process.exitCode = 1; }
}

// --- Alarme : piller un magasin déclenche l'alarme et une escouade de CRS est envoyée sur place
{
  const w = new World('cite', { seed: 21 });
  const evs = [];
  const p = w.addPlayer(1, 'x', {}, (m) => { if (m.t === 'ev') evs.push(m.e); });
  p.hp = p.maxHp = 1e9;
  const l = w.loot.find((x) => w.map.lootSpots[x.id].table !== 'caisse');
  p.x = l.x; p.z = l.z;
  w.pick(p, l.id);
  const sq = [...w.squads.values()].find((s) => s.urgent);
  const shop = w.map.shops[w.map.lootSpots[l.id].shop];
  const d0 = sq ? Math.hypot(sq.members[0].x - shop.door.x, sq.members[0].z - shop.door.z) : -1;
  for (let i = 0; i < 20 * 15; i++) w.step();
  const d1 = sq ? Math.min(...sq.members.map((m) => Math.hypot(m.x - shop.door.x, m.z - shop.door.z))) : -1;
  // cohésion : écart moyen au chef pendant la marche
  const L = sq?.members[0];
  const spread = sq ? sq.members.reduce((s, m) => s + Math.hypot(m.x - L.x, m.z - L.z), 0) / sq.members.length : -1;
  console.log(`alarme : évènements ${[...new Set(evs)].join(',')} ; escouade envoyée à ${Math.round(d0)} m -> ${Math.round(d1)} m en 15 s ; écart moyen au chef ${spread.toFixed(1)} m`);
  if (!evs.includes('alarm') || !sq || d1 >= d0) { console.error('ÉCHEC test alarme'); process.exitCode = 1; }
}
