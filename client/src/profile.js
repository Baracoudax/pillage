// Profil persistant (argent, planque, équipement, quartiers débloqués). Sauvegarde locale.
import { GEAR, GEAR_SLOTS, CONSUMABLES, ITEMS, GEAR_BY_ID } from '../../shared/items.js';
import { DISTRICTS } from '../../shared/config.js';

const KEY = 'pillage.profile.v1';

function fresh() {
  const equipped = {}, owned = {};
  for (const s of GEAR_SLOTS) { equipped[s] = GEAR[s][0].id; owned[GEAR[s][0].id] = true; }
  return {
    name: 'Casseur' + Math.floor(Math.random() * 900 + 100),
    money: 300, stash: [], equipped, owned,
    cons: { bandage: 2, bille: 0, fusee: 0 },
    unlocked: { cite: true },
    stats: { raids: 0, extracts: 0, best: 0, earned: 0, arrests: 0 },
    settings: { quality: 'auto', sens: 1, volume: 0.7 },
  };
}

export class Profile {
  constructor() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch { /* stockage indisponible */ }
    this.d = Object.assign(fresh(), data || {});
    this.d.settings = Object.assign(fresh().settings, this.d.settings);
    this.d.stash = this.d.stash.filter((id) => ITEMS[id]);
    for (const s of GEAR_SLOTS) if (!GEAR_BY_ID[this.d.equipped[s]]) this.d.equipped[s] = GEAR[s][0].id;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ } }
  reset() { this.d = fresh(); this.save(); }

  loadout() { return { ...this.d.equipped, cons: { ...this.d.cons } }; }

  buyGear(id) {
    const g = GEAR_BY_ID[id];
    if (!g || this.d.owned[id] || this.d.money < g.price) return false;
    this.d.money -= g.price;
    this.d.owned[id] = true;
    this.d.equipped[g.slot] = id;
    this.save();
    return true;
  }
  equip(id) {
    const g = GEAR_BY_ID[id];
    if (!g || !this.d.owned[id]) return;
    this.d.equipped[g.slot] = id;
    this.save();
  }
  buyCons(k) {
    const c = CONSUMABLES[k];
    if (this.d.money < c.price || this.d.cons[k] + c.pack > c.max) return false;
    this.d.money -= c.price;
    this.d.cons[k] += c.pack;
    this.save();
    return true;
  }
  sell(index) {
    const id = this.d.stash[index];
    if (!id) return 0;
    this.d.stash.splice(index, 1);
    this.d.money += ITEMS[id].value;
    this.d.stats.earned += ITEMS[id].value;
    this.save();
    return ITEMS[id].value;
  }
  sellAll() {
    let sum = 0;
    for (const id of this.d.stash) sum += ITEMS[id].value;
    this.d.money += sum;
    this.d.stats.earned += sum;
    this.d.stash = [];
    this.save();
    return sum;
  }
  unlock(did) {
    const d = DISTRICTS[did];
    if (this.d.unlocked[did] || this.d.money < d.unlockCost) return false;
    this.d.money -= d.unlockCost;
    this.d.unlocked[did] = true;
    this.save();
    return true;
  }

  // Résultat d'un raid
  raidStart() {
    // les consommables partent avec le joueur : perdus s'il tombe
    this.d.stats.raids++;
    this.carried = { ...this.d.cons };
    this.d.cons = { bandage: 0, bille: 0, fusee: 0 };
    this.save();
  }
  raidExtract(items, cons) {
    this.d.stash.push(...items);
    for (const k in cons) this.d.cons[k] = Math.min(CONSUMABLES[k].max, (this.d.cons[k] || 0) + (cons[k] || 0));
    this.d.stats.extracts++;
    const v = items.reduce((s, id) => s + ITEMS[id].value, 0);
    this.d.stats.best = Math.max(this.d.stats.best, v);
    this.save();
  }
  raidFail(reason) {
    let fine = 0;
    if (reason === 'arrest') {
      fine = Math.min(this.d.money, Math.max(100, Math.round(this.d.money * 0.1)));
      this.d.money -= fine;
      this.d.stats.arrests++;
    }
    this.save();
    return fine;
  }
  // abandon (fermeture de page en raid) : consommables déjà retirés, rien d'autre à faire
}
