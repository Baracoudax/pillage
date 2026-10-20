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
  let snapBytes = 0, nSnaps = 0, result = null;
  const p = w.addPlayer(1, 'bot', { backpack: 'sac_sport', weapon: 'mortier', cons: { fusee: 6, bandage: 2 } }, (m) => {
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
    if (steps % 30 === 0) w.onMessage(1, { t: 'act', a: 'atk', yaw: p.rot, pitch: 0.1 });
    w.step();
  }
  const ms = performance.now() - t1;
  console.log(`${did}: map ${map.size}m gen ${tGen.toFixed(0)}ms, shops ${map.shops.length}, loot ${map.lootSpots.length}, solids ${map.solids.length}`);
  console.log(`  ${steps} ticks en ${ms.toFixed(0)}ms (${(ms / steps).toFixed(3)} ms/tick), npcs ${w.npcs.length}, heat ${w.heat.toFixed(0)}`);
  console.log(`  résultat: ${result ? result.t + ' ' + (result.reason || '') + ' ' + (result.value ?? '') + '€' : 'aucun'}, snap moyen ${(snapBytes / nSnaps).toFixed(0)} o`, JSON.stringify(msgs));
}
