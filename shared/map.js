// Génération procédurale déterministe du quartier + collisions, ligne de vue et pathfinding.
// Le même code tourne sur le client (rendu + prédiction) et le serveur (simulation).
import { DISTRICTS } from './config.js';
import { mulberry32, pickWeighted, shuffle } from './rng.js';

export const BLOCK = 34;
export const STREET = 12;
export const SIDEWALK = 2;
export const LOT = 15;
export const WALL_H = 4;
export const WALL_T = 0.35;
export const DOOR_W = 4;
const PERIOD = BLOCK + STREET;
const HASH = 8;        // taille des cellules du hash spatial des collisions (m)
const INFLATE = 0.3;   // gonflement des obstacles dans la grille de navigation

const BUILDING_COLORS = [0xd8c9b0, 0xc9b79c, 0xb7a58e, 0xe0d6c4, 0xa89f94, 0xc4b2a0, 0x9d9389, 0xd1c2a9];

const cache = {};
export function getMap(districtId) {
  if (!cache[districtId]) cache[districtId] = new CityMap(DISTRICTS[districtId]);
  return cache[districtId];
}

export class CityMap {
  constructor(d) {
    this.d = d;
    const rng = mulberry32(d.seed);
    const n = d.size;
    const size = (this.size = n * BLOCK + (n + 1) * STREET);
    this.solids = [];     // AABB de collision {x0,z0,x1,z1,h,kind}
    this.buildings = [];  // volumes visuels {x0,z0,x1,z1,y0,y1,c}
    this.shops = [];
    this.lootSpots = [];
    this.props = [];      // voitures, barricades...
    this.fires = [];
    this.lamps = [];
    this.signs = [];
    this.floors = [];
    this.shelves = [];

    for (let bi = 0; bi < n; bi++) {
      for (let bj = 0; bj < n; bj++) {
        const bx = STREET + bi * PERIOD;
        const bz = STREET + bj * PERIOD;
        for (let li = 0; li < 2; li++) {
          for (let lj = 0; lj < 2; lj++) {
            const x0 = bx + SIDEWALK + li * LOT, z0 = bz + SIDEWALK + lj * LOT;
            const h = 7.5 + Math.floor(rng() * 5) * 3;
            const c = BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];
            const roll = rng();
            const sides = [li === 0 ? 'W' : 'E', lj === 0 ? 'N' : 'S'];
            const side = sides[Math.floor(rng() * 2)];
            if (roll < d.shopChance) {
              this.makeShop(x0, z0, side, pickWeighted(d.shops, rng), h, c, rng);
            } else if (roll < d.shopChance + 0.07) {
              // terrain vague avec voiture brûlée
              this.addCar(x0 + LOT / 2, z0 + LOT / 2, rng() < 0.5, true);
            } else {
              this.addSolid(x0, z0, x0 + LOT, z0 + LOT, h, 'bld');
              this.buildings.push({ x0, z0, x1: x0 + LOT, z1: z0 + LOT, y0: 0, y1: h, c });
            }
          }
        }
      }
    }

    // Mobilier urbain le long des rues
    for (let i = 0; i <= n; i++) {
      const c = i * PERIOD + STREET / 2;
      for (let j = 0; j < n; j++) {
        const s0 = STREET + j * PERIOD, s1 = s0 + BLOCK;
        this.decorateStreet(c, s0, s1, true, rng);
        this.decorateStreet(c, s0, s1, false, rng);
      }
    }

    // Mobilier urbain sur les trottoirs (générateur séparé pour ne pas modifier le reste de la carte)
    this.decor = [];
    this.decorate(mulberry32(d.seed + 7));

    // Bordures de carte : murs invisibles + rangée d'immeubles extérieurs
    const E = 2;
    this.addSolid(-E - 20, -E - 20, 0, size + E + 20, 40, 'edge');
    this.addSolid(size, -E - 20, size + E + 20, size + E + 20, 40, 'edge');
    this.addSolid(-E, -E - 20, size + E, 0, 40, 'edge');
    this.addSolid(-E, size, size + E, size + E + 20, 40, 'edge');
    for (let t = -14; t < size + 14; t += 14) {
      const h1 = 9 + Math.floor(rng() * 4) * 3, h2 = 9 + Math.floor(rng() * 4) * 3;
      const h3 = 9 + Math.floor(rng() * 4) * 3, h4 = 9 + Math.floor(rng() * 4) * 3;
      const col = () => BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];
      this.buildings.push({ x0: t, z0: -14, x1: t + 14, z1: 0, y0: 0, y1: h1, c: col() });
      this.buildings.push({ x0: t, z0: size, x1: t + 14, z1: size + 14, y0: 0, y1: h2, c: col() });
      this.buildings.push({ x0: -14, z0: t, x1: 0, z1: t + 14, y0: 0, y1: h3, c: col() });
      this.buildings.push({ x0: size, z0: t, x1: size + 14, z1: t + 14, y0: 0, y1: h4, c: col() });
    }

    // Points d'extraction sur les rues extérieures
    const cand = [];
    for (let j = 0; j < n; j++) {
      const m = STREET + j * PERIOD + BLOCK / 2;
      cand.push({ x: STREET / 2, z: m }, { x: size - STREET / 2, z: m }, { x: m, z: STREET / 2 }, { x: m, z: size - STREET / 2 });
    }
    shuffle(cand, rng);
    const exitDefs = [
      { name: 'Bouche de métro', activeFrom: 0 },
      { name: 'Fourgon du cousin', activeFrom: 0 },
      { name: 'Scooter planqué', activeFrom: 150 },
    ];
    this.exits = exitDefs.map((e, i) => ({ ...e, id: i, x: cand[i].x, z: cand[i].z }));
    for (const ex of this.exits) this.clearProps(ex.x, ex.z, 5);

    // Points d'apparition CRS : carrefours extérieurs
    this.edgePoints = [];
    for (let i = 0; i <= n; i++) {
      const c = i * PERIOD + STREET / 2;
      this.edgePoints.push({ x: c, z: STREET / 2 }, { x: c, z: size - STREET / 2 }, { x: STREET / 2, z: c }, { x: size - STREET / 2, z: c });
    }
    // Carrefours intérieurs pour l'apparition des joueurs
    this.spawnPoints = [];
    for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
      this.spawnPoints.push({ x: i * PERIOD + STREET / 2, z: j * PERIOD + STREET / 2 });
    }
    // milieux des rues intérieures
    for (let i = 1; i < n; i++) for (let j = 0; j < n; j++) {
      const c = i * PERIOD + STREET / 2, m = STREET + j * PERIOD + BLOCK / 2;
      this.spawnPoints.push({ x: c, z: m }, { x: m, z: c });
    }

    // rond-point occupé par les gilets jaunes : carrefour intérieur, feux de palettes aux angles
    const inner = this.spawnPoints.slice(0, Math.max(1, (n - 1) * (n - 1)));
    this.roundabout = inner[Math.floor(rng() * inner.length)];
    this.clearProps(this.roundabout.x, this.roundabout.z, 7);
    for (const [a, b] of [[-4.5, -4.5], [4.5, 4.5]]) this.fires.push({ x: this.roundabout.x + a, z: this.roundabout.z + b, s: 0.8 });
    // étapes des cortèges : tous les carrefours
    this.marchPoints = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) this.marchPoints.push({ x: i * PERIOD + STREET / 2, z: j * PERIOD + STREET / 2 });

    this.buildHash();
    this.buildGrid();
  }

  addSolid(x0, z0, x1, z1, h, kind) {
    const s = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h, kind };
    this.solids.push(s);
    return s;
  }

  makeShop(x0, z0, side, type, h, c, rng) {
    const L = LOT, T = WALL_T;
    // repère local : u le long de la vitrine, v vers le fond du magasin
    const P = (u, v) => {
      switch (side) {
        case 'N': return [x0 + u, z0 + v];
        case 'S': return [x0 + u, z0 + L - v];
        case 'W': return [x0 + v, z0 + u];
        default:  return [x0 + L - v, z0 + u];
      }
    };
    const R = (u0, v0, u1, v1) => {
      const [ax, az] = P(u0, v0), [bx, bz] = P(u1, v1);
      return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
    };
    const idx = this.shops.length;
    const walls = [];
    const wall = (u0, v0, u1, v1) => {
      const r = R(u0, v0, u1, v1);
      walls.push(this.addSolid(r[0], r[1], r[2], r[3], WALL_H, 'wall'));
    };
    const dl = L / 2 - DOOR_W / 2, dr = L / 2 + DOOR_W / 2;
    wall(0, 0, dl, T); wall(dr, 0, L, T);       // vitrine (avec ouverture)
    wall(0, L - T, L, L);                       // fond
    wall(0, 0, T, L); wall(L - T, 0, L, L);     // côtés

    const shelf = (u0, v0, u1, v1, hh, kind) => {
      const r = R(u0, v0, u1, v1);
      this.addSolid(r[0], r[1], r[2], r[3], hh, kind);
      this.shelves.push({ x0: r[0], z0: r[1], x1: r[2], z1: r[3], h: hh, kind });
    };
    shelf(0.4, 3, 1.4, 11.5, 1.7, 'shelf');
    shelf(L - 1.4, 3, L - 0.4, 11.5, 1.7, 'shelf');
    shelf(5, 5.5, 10, 6.4, 1.4, 'shelf');
    shelf(5, 9, 10, 9.9, 1.4, 'shelf');
    shelf(2.5, 12.4, 7, 13.2, 1.1, 'counter');

    const spots = [];
    for (const v of [4, 6, 8, 10]) {
      spots.push([0.9, v, 1.78]);
      spots.push([L - 0.9, v, 1.78]);
    }
    for (const u of [6, 9]) { spots.push([u, 5.95, 1.48]); spots.push([u, 9.45, 1.48]); }
    shuffle(spots, rng);
    const count = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i++) {
      const [u, v, y] = spots[i];
      const [x, z] = P(u, v);
      this.lootSpots.push({ x, z, y, table: type, shop: idx });
    }
    const [cx, cz] = P(4, 12.8);
    this.lootSpots.push({ x: cx, z: cz, y: 1.18, table: 'caisse', shop: idx });

    const r = R(0, 0, L, L);
    const [dx, dz] = P(L / 2, -0.6);
    const [ix, iz] = P(L / 2, 7.7);
    const signRot = { N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2 }[side];
    const [sx, sz] = P(L / 2, -0.08);
    this.signs.push({ x: sx, z: sz, y: 3.35, rot: signRot, type });
    this.floors.push({ x0: r[0], z0: r[1], x1: r[2], z1: r[3], type });
    this.buildings.push({ x0: r[0], z0: r[1], x1: r[2], z1: r[3], y0: WALL_H, y1: h, c });
    this.shops.push({ id: idx, type, x0: r[0], z0: r[1], x1: r[2], z1: r[3], side, door: { x: dx, z: dz }, inside: { x: ix, z: iz }, walls });
  }

  addCar(x, z, alongX, burning) {
    const hw = alongX ? 2.2 : 1.0, hd = alongX ? 1.0 : 2.2;
    const s = this.addSolid(x - hw, z - hd, x + hw, z + hd, 1.5, 'car');
    this.props.push({ type: 'car', x, z, alongX, burning, solid: s });
    if (burning) this.fires.push({ x, z, s: 1.4 });
  }

  decorateStreet(c, s0, s1, vertical, rng) {
    const at = (lat, lon) => (vertical ? [c + lat, lon] : [lon, c + lat]);
    // voitures garées / renversées
    for (let k = 0; k < 2; k++) {
      if (rng() < 0.55) {
        const lat = (rng() < 0.5 ? -1 : 1) * 3.6;
        const lon = s0 + 4 + rng() * (BLOCK - 8);
        const [x, z] = at(lat, lon);
        this.addCar(x, z, !vertical, rng() < 0.45);
      }
    }
    // barricade de poubelles
    if (rng() < 0.35) {
      const lat = (rng() < 0.5 ? -1 : 1) * 1.6;
      const lon = s0 + 6 + rng() * (BLOCK - 12);
      const [x, z] = at(lat, lon);
      const hw = vertical ? 1.6 : 0.5, hd = vertical ? 0.5 : 1.6;
      const s = this.addSolid(x - hw, z - hd, x + hw, z + hd, 1.2, 'barricade');
      const burning = rng() < 0.6;
      this.props.push({ type: 'barricade', x, z, alongX: vertical, burning, solid: s });
      if (burning) this.fires.push({ x, z, s: 1.1 });
    }
    // lampadaires des deux côtés
    for (let lon = s0 + 4; lon < s1; lon += 15) {
      for (const sgn of [-1, 1]) {
        const [x, z] = at(sgn * (STREET / 2 + 0.5), lon);
        this.lamps.push({ x, z, dir: vertical ? [-sgn, 0] : [0, -sgn] });
      }
    }
    // feux de poubelles sur le trottoir
    if (rng() < 0.3) {
      const [x, z] = at((rng() < 0.5 ? -1 : 1) * (STREET / 2 + 1), s0 + rng() * BLOCK);
      this.fires.push({ x, z, s: 0.7 });
    }
  }

  decorate(rng) {
    const n = this.d.size;
    const DECOR = [
      // type, poids, demi-largeur, demi-profondeur, hauteur de collision (0 = décor seul)
      ['bench', 3, 0.9, 0.35, 0.9], ['trash', 4, 0.3, 0.3, 1.3], ['mailbox', 2, 0.25, 0.25, 1.1], ['payphone', 1, 0.2, 0.2, 1.5],
      ['atm', 1, 0.33, 0.25, 1.5], ['ebox', 2, 0.4, 0.18, 1.6], ['busstop', 1, 2.6, 0.7, 2.5], ['cone', 2, 0, 0, 0],
      ['portaloo', 1, 0.7, 0.7, 2.6], ['dumpster', 2, 1.0, 0.6, 1.4],
    ];
    const total = DECOR.reduce((s, x) => s + x[1], 0);
    const pickType = () => { let r = rng() * total; for (const x of DECOR) { r -= x[1]; if (r <= 0) return x; } return DECOR[0]; };
    const doors = this.shops.map((s) => s.door);
    for (let bi = 0; bi < n; bi++) for (let bj = 0; bj < n; bj++) {
      const bx = STREET + bi * PERIOD, bz = STREET + bj * PERIOD;
      // 4 bords du bloc, l'objet est posé au milieu du trottoir, face à la rue
      const edges = [
        { x0: bx + 3, x1: bx + BLOCK - 3, z: bz + 1.05, rot: Math.PI, along: 'x' },
        { x0: bx + 3, x1: bx + BLOCK - 3, z: bz + BLOCK - 1.05, rot: 0, along: 'x' },
        { z0: bz + 3, z1: bz + BLOCK - 3, x: bx + 1.05, rot: -Math.PI / 2, along: 'z' },
        { z0: bz + 3, z1: bz + BLOCK - 3, x: bx + BLOCK - 1.05, rot: Math.PI / 2, along: 'z' },
      ];
      for (const e of edges) {
        const L = e.along === 'x' ? e.x1 - e.x0 : e.z1 - e.z0;
        for (let t = 2 + rng() * 4; t < L - 1; t += 5 + rng() * 6) {
          if (rng() < 0.35) continue;
          const x = e.along === 'x' ? e.x0 + t : e.x, z = e.along === 'x' ? e.z : e.z0 + t;
          if (doors.some((d) => Math.hypot(d.x - x, d.z - z) < 4.5)) continue;
          if (this.lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 1.6)) continue;
          if (this.decor.some((o) => Math.hypot(o.x - x, o.z - z) < 2.2)) continue;
          const [type, , hw, hd, h] = pickType();
          // le long d'un bord vertical, la largeur de l'objet suit l'axe Z
          const ax = e.along === 'x' ? hw : hd, az = e.along === 'x' ? hd : hw;
          const o = { type, x, z, rot: e.rot };
          if (h) o.solid = this.addSolid(x - ax, z - az, x + ax, z + az, h, 'decor');
          this.decor.push(o);
        }
      }
    }
    // barrières de béton aux carrefours extérieurs (zones de police)
    for (let i = 0; i <= n; i++) for (const [x, z] of [[i * PERIOD + STREET / 2, 1.2], [i * PERIOD + STREET / 2, this.size - 1.2], [1.2, i * PERIOD + STREET / 2], [this.size - 1.2, i * PERIOD + STREET / 2]]) {
      if (rng() < 0.5) continue;
      const alongX = z < 2 || z > this.size - 2;
      for (const k of [-1, 1]) {
        const ox = alongX ? x + k * 3.5 : x, oz = alongX ? z : z + k * 3.5;
        this.decor.push({ type: 'roadblock', x: ox, z: oz, rot: alongX ? 0 : Math.PI / 2, solid: this.addSolid(ox - (alongX ? 1 : 0.3), oz - (alongX ? 0.3 : 1), ox + (alongX ? 1 : 0.3), oz + (alongX ? 0.3 : 1), 1, 'decor') });
      }
    }
  }

  clearProps(x, z, r) {
    const hit = (s) => s.x1 > x - r && s.x0 < x + r && s.z1 > z - r && s.z0 < z + r;
    const removed = new Set(this.props.filter((p) => hit(p.solid)).map((p) => p.solid));
    this.props = this.props.filter((p) => !removed.has(p.solid));
    this.solids = this.solids.filter((s) => !removed.has(s));
    this.fires = this.fires.filter((f) => Math.hypot(f.x - x, f.z - z) > r + 1);
    if (this.decor) {
      const gone = new Set(this.decor.filter((o) => Math.hypot(o.x - x, o.z - z) < r + 1.5).map((o) => o.solid).filter(Boolean));
      this.decor = this.decor.filter((o) => Math.hypot(o.x - x, o.z - z) >= r + 1.5);
      this.solids = this.solids.filter((s) => !gone.has(s));
    }
  }

  // --- Hash spatial des AABB -------------------------------------------------
  buildHash() {
    this.hn = Math.ceil((this.size + 60) / HASH);
    this.hash = new Map();
    for (const s of this.solids) {
      const a0 = this.hcell(s.x0), a1 = this.hcell(s.x1), b0 = this.hcell(s.z0), b1 = this.hcell(s.z1);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
        const k = a + b * this.hn;
        let arr = this.hash.get(k);
        if (!arr) this.hash.set(k, (arr = []));
        arr.push(s);
      }
    }
    this._q = [];
    this._stamp = 1;
  }
  hcell(v) { return Math.max(0, Math.min(this.hn - 1, Math.floor((v + 30) / HASH))); }

  query(x0, z0, x1, z1) {
    const out = this._q;
    out.length = 0;
    const st = ++this._stamp;
    const a0 = this.hcell(x0), a1 = this.hcell(x1), b0 = this.hcell(z0), b1 = this.hcell(z1);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const arr = this.hash.get(a + b * this.hn);
      if (!arr) continue;
      for (const s of arr) if (s._st !== st) { s._st = st; out.push(s); }
    }
    return out;
  }

  // Déplace un cercle avec glissement le long des murs. Retourne [x, z].
  move(x, z, dx, dz, r) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (r * 0.8)));
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      x += sx; z += sz;
      for (let it = 0; it < 2; it++) {
        const list = this.query(x - r, z - r, x + r, z + r);
        for (const s of list) {
          const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x;
          const cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
          const ddx = x - cx, ddz = z - cz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            x += (ddx / d) * (r - d);
            z += (ddz / d) * (r - d);
          } else {
            // centre à l'intérieur : sortie par l'axe le plus court
            const px0 = x - s.x0 + r, px1 = s.x1 - x + r, pz0 = z - s.z0 + r, pz1 = s.z1 - z + r;
            const m = Math.min(px0, px1, pz0, pz1);
            if (m === px0) x -= px0; else if (m === px1) x += px1; else if (m === pz0) z -= pz0; else z += pz1;
          }
        }
      }
    }
    return [x, z];
  }

  circleBlocked(x, z, r) {
    for (const s of this.query(x - r, z - r, x + r, z + r)) {
      const cx = Math.max(s.x0, Math.min(x, s.x1)), cz = Math.max(s.z0, Math.min(z, s.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r * 0.8) return true;
    }
    return false;
  }

  solidAt(x, z, y) {
    for (const s of this.query(x, z, x, z)) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && y < s.h) return s;
    }
    return null;
  }

  // Lancer de rayon 2D contre les obstacles plus hauts que minH. Retourne la fraction [0..1].
  raycast(x0, z0, x1, z1, minH = 2) {
    const dx = x1 - x0, dz = z1 - z0;
    let best = 1;
    for (const s of this.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1))) {
      if (s.h < minH) continue;
      let tmin = 0, tmax = best;
      if (Math.abs(dx) < 1e-9) { if (x0 < s.x0 || x0 > s.x1) continue; }
      else {
        let t1 = (s.x0 - x0) / dx, t2 = (s.x1 - x0) / dx;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (z0 < s.z0 || z0 > s.z1) continue; }
      else {
        let t1 = (s.z0 - z0) / dz, t2 = (s.z1 - z0) / dz;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin < best) best = tmin;
    }
    return best;
  }

  // Rayon 3D contre les boîtes (sol compris). Retourne la distance du premier impact (<= maxT).
  ray3(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    if (dy < -1e-6) best = Math.min(best, -oy / dy);
    const ex = ox + dx * best, ez = oz + dz * best;
    for (const s of this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez))) {
      let t0 = 0, t1 = best;
      const ax = [[ox, dx, s.x0, s.x1], [oy, dy, 0, s.h], [oz, dz, s.z0, s.z1]];
      let hit = true;
      for (const [o, d, lo, hi] of ax) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { hit = false; break; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 < best) best = t0;
    }
    return best;
  }

  shopAt(x, z) {
    for (const s of this.shops) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return s;
    return null;
  }

  // --- Grille de navigation ----------------------------------------------------
  buildGrid() {
    const G = (this.G = Math.ceil(this.size));
    this.block = new Uint8Array(G * G);   // marchable ?
    this.opaque = new Uint8Array(G * G);  // bloque la vue ?
    for (const s of this.solids) {
      const i0 = Math.max(0, Math.floor(s.x0 - INFLATE)), i1 = Math.min(G - 1, Math.floor(s.x1 + INFLATE));
      const j0 = Math.max(0, Math.floor(s.z0 - INFLATE)), j1 = Math.min(G - 1, Math.floor(s.z1 + INFLATE));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const cx = i + 0.5, cz = j + 0.5;
        if (cx >= s.x0 - INFLATE && cx <= s.x1 + INFLATE && cz >= s.z0 - INFLATE && cz <= s.z1 + INFLATE) this.block[i + j * G] = 1;
        if (s.h > 1.6 && cx >= s.x0 && cx <= s.x1 && cz >= s.z0 && cz <= s.z1) this.opaque[i + j * G] = 1;
      }
    }
    for (let k = 0; k < G; k++) {
      this.block[k] = this.block[k + (G - 1) * G] = this.block[k * G] = this.block[G - 1 + k * G] = 1;
    }
    // points de rue pour l'errance des PNJ
    this.streetPts = [];
    for (let i = 1; i < G - 1; i += 2) for (let j = 1; j < G - 1; j += 2) {
      if (this.block[i + j * G]) continue;
      const pi = (i + 0.5) % PERIOD, pj = (j + 0.5) % PERIOD;
      const inStreet = pi < STREET + SIDEWALK || pi > STREET + BLOCK - SIDEWALK || pj < STREET + SIDEWALK || pj > STREET + BLOCK - SIDEWALK;
      if (inStreet) this.streetPts.push({ x: i + 0.5, z: j + 0.5 });
    }
    const N = G * G;
    this._g = new Float32Array(N);
    this._from = new Int32Array(N);
    this._seen = new Uint32Array(N);
    this._closed = new Uint32Array(N);
    this._gen = 0;
    this._heap = new Int32Array(N);
    this._f = new Float32Array(N);
  }

  walkable(x, z) {
    const i = Math.floor(x), j = Math.floor(z);
    if (i < 0 || j < 0 || i >= this.G || j >= this.G) return false;
    return !this.block[i + j * this.G];
  }

  los(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 0.5);
    const G = this.G;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const i = Math.floor(x0 + (x1 - x0) * t), j = Math.floor(z0 + (z1 - z0) * t);
      if (i < 0 || j < 0 || i >= G || j >= G) return false;
      if (this.opaque[i + j * G]) return false;
    }
    return true;
  }

  walkLine(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 0.4);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (!this.walkable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  nearestFree(i, j) {
    const G = this.G;
    if (i >= 0 && j >= 0 && i < G && j < G && !this.block[i + j * G]) return i + j * G;
    for (let r = 1; r <= 4; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const ii = i + a, jj = j + b;
      if (ii >= 0 && jj >= 0 && ii < G && jj < G && !this.block[ii + jj * G]) return ii + jj * G;
    }
    return -1;
  }

  // A* 8 directions sur grille 1 m, puis lissage par ligne droite.
  path(sx, sz, tx, tz, maxIter = 9000) {
    const G = this.G;
    const s = this.nearestFree(Math.floor(sx), Math.floor(sz));
    const t = this.nearestFree(Math.floor(tx), Math.floor(tz));
    if (s < 0 || t < 0) return null;
    if (s === t) return [{ x: tx, z: tz }];
    const gen = ++this._gen;
    const g = this._g, from = this._from, seen = this._seen, closed = this._closed, heap = this._heap, f = this._f;
    const ti = t % G, tj = (t / G) | 0;
    const h = (k) => {
      const dx = Math.abs((k % G) - ti), dz = Math.abs(((k / G) | 0) - tj);
      return dx + dz - 0.586 * Math.min(dx, dz);
    };
    let hs = 0;
    const push = (k) => {
      let i = hs++;
      heap[i] = k;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hs];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hs && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hs && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
      return top;
    };
    seen[s] = gen; g[s] = 0; f[s] = h(s); from[s] = -1;
    push(s);
    let found = false, iter = 0;
    const block = this.block;
    while (hs > 0 && iter++ < maxIter) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === t) { found = true; break; }
      const ci = cur % G, cj = (cur / G) | 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        const ni = ci + a, nj = cj + b;
        if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
        const nk = ni + nj * G;
        if (block[nk] || closed[nk] === gen) continue;
        if (a && b && (block[ci + a + cj * G] || block[ci + (cj + b) * G])) continue;
        const ng = g[cur] + (a && b ? 1.414 : 1);
        if (seen[nk] !== gen || ng < g[nk]) {
          seen[nk] = gen; g[nk] = ng; f[nk] = ng + h(nk); from[nk] = cur;
          push(nk);
        }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let k = t; k !== -1; k = from[k]) raw.push(k);
    raw.reverse();
    const pts = raw.map((k) => ({ x: (k % G) + 0.5, z: ((k / G) | 0) + 0.5 }));
    if (this.walkable(tx, tz)) pts[pts.length - 1] = { x: tx, z: tz };
    // lissage
    const out = [];
    let ax = sx, az = sz, i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 24);
      while (j > i + 1 && !this.walkLine(ax, az, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      ax = pts[j].x; az = pts[j].z; i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }
}
