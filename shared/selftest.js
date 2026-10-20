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
  const kinds = [0, 1, 2].map((k) => w.npcs.filter((n) => n.kind === k).length);
  console.log(`  PNJ émeutiers/CRS/GJ: ${kinds.join('/')}, cortèges ${w.corteges.length}, munitions ${stats.ammo0} -> ${p.ammo.a762 + p.mag.primary}, PNJ à terre ${w.npcs.filter((n) => n.st === 'down').length}`);
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
