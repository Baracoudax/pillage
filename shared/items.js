// Objets à piller, équipement achetable et consommables.

export const RARITY = [
  { name: 'Commun', color: '#b8b8b8', weight: 60 },
  { name: 'Peu commun', color: '#51cf66', weight: 26 },
  { name: 'Rare', color: '#4dabf7', weight: 10 },
  { name: 'Épique', color: '#cc5de8', weight: 3.5 },
  { name: 'Légendaire', color: '#fcc419', weight: 0.8 },
];

// value = prix de revente chez le receleur (€), w = poids (kg), r = rareté, hold = temps de pillage (s)
export const ITEMS = {
  // Supérette
  biere:        { name: 'Pack de bières', icon: '🍺', value: 15, w: 3, r: 0, shops: ['superette'] },
  chips:        { name: 'Paquet de chips', icon: '🍟', value: 4, w: 0.3, r: 0, shops: ['superette'] },
  tartiner:     { name: 'Pâte à tartiner', icon: '🍫', value: 7, w: 0.8, r: 0, shops: ['superette'] },
  energy:       { name: 'Boissons énergisantes', icon: '⚡', value: 14, w: 2, r: 0, shops: ['superette'] },
  clopes:       { name: 'Cartouche de cigarettes', icon: '🚬', value: 90, w: 0.6, r: 1, shops: ['superette'] },
  whisky:       { name: 'Bouteille de whisky', icon: '🥃', value: 40, w: 1.2, r: 1, shops: ['superette'] },
  champagne:    { name: 'Champagne', icon: '🍾', value: 75, w: 1.5, r: 2, shops: ['superette', 'luxe'] },
  grattage:     { name: 'Tickets à gratter', icon: '🎟️', value: 130, w: 0.1, r: 2, shops: ['superette'] },
  // Téléphonie
  coque:        { name: 'Coque de téléphone', icon: '📦', value: 10, w: 0.1, r: 0, shops: ['tel'] },
  chargeur:     { name: 'Chargeur rapide', icon: '🔌', value: 18, w: 0.2, r: 0, shops: ['tel', 'hifi'] },
  ecouteurs:    { name: 'Écouteurs sans fil', icon: '🎧', value: 120, w: 0.2, r: 1, shops: ['tel', 'hifi'] },
  smartphone:   { name: 'Smartphone', icon: '📱', value: 380, w: 0.3, r: 2, shops: ['tel'] },
  tablette:     { name: 'Tablette', icon: '📲', value: 520, w: 0.6, r: 2, shops: ['tel', 'hifi'] },
  smartphone_pro: { name: 'Smartphone Pro Max', icon: '📱', value: 1100, w: 0.3, r: 3, shops: ['tel'] },
  // Sneakers / textile
  casquette:    { name: 'Casquette', icon: '🧢', value: 25, w: 0.2, r: 0, shops: ['sneakers'] },
  chaussettes:  { name: 'Chaussettes de sport', icon: '🧦', value: 8, w: 0.1, r: 0, shops: ['sneakers'] },
  jogging:      { name: 'Survêtement', icon: '👖', value: 70, w: 0.8, r: 1, shops: ['sneakers'] },
  baskets:      { name: 'Baskets', icon: '👟', value: 130, w: 1.2, r: 1, shops: ['sneakers'] },
  doudoune:     { name: 'Doudoune', icon: '🧥', value: 240, w: 1.6, r: 2, shops: ['sneakers', 'luxe'] },
  baskets_ltd:  { name: 'Baskets édition limitée', icon: '👟', value: 480, w: 1.2, r: 3, shops: ['sneakers'] },
  // Hi-Fi
  manette:      { name: 'Manette', icon: '🎮', value: 60, w: 0.4, r: 0, shops: ['hifi'] },
  enceinte:     { name: 'Enceinte Bluetooth', icon: '🔊', value: 90, w: 0.9, r: 0, shops: ['hifi'] },
  casque_audio: { name: 'Casque audio', icon: '🎧', value: 220, w: 0.5, r: 1, shops: ['hifi'] },
  console:      { name: 'Console de jeu', icon: '🕹️', value: 450, w: 3.5, r: 2, shops: ['hifi'] },
  laptop:       { name: 'Ordinateur portable', icon: '💻', value: 900, w: 2.5, r: 2, shops: ['hifi'] },
  tv:           { name: 'TV 65 pouces', icon: '📺', value: 750, w: 18, r: 2, shops: ['hifi'], hold: 2 },
  drone:        { name: 'Drone 4K', icon: '🚁', value: 1300, w: 1.5, r: 3, shops: ['hifi'] },
  // Bijouterie
  montre:       { name: 'Montre', icon: '⌚', value: 250, w: 0.1, r: 0, shops: ['bijou'] },
  bague:        { name: 'Bague en or', icon: '💍', value: 320, w: 0.05, r: 1, shops: ['bijou'] },
  collier:      { name: 'Collier', icon: '📿', value: 650, w: 0.1, r: 2, shops: ['bijou'] },
  rolex:        { name: 'Montre de luxe', icon: '⌚', value: 4500, w: 0.15, r: 3, shops: ['bijou', 'luxe'] },
  lingot:       { name: "Lingot d'or", icon: '🟨', value: 9000, w: 1, r: 4, shops: ['bijou'], hold: 1.5 },
  // Luxe
  parfum:       { name: 'Parfum', icon: '🧴', value: 130, w: 0.4, r: 0, shops: ['luxe'] },
  lunettes:     { name: 'Lunettes de marque', icon: '🕶️', value: 320, w: 0.2, r: 1, shops: ['luxe'] },
  foulard:      { name: 'Foulard en soie', icon: '🧣', value: 420, w: 0.1, r: 1, shops: ['luxe'] },
  sneakers_luxe:{ name: 'Sneakers de luxe', icon: '👟', value: 950, w: 1.4, r: 2, shops: ['luxe'] },
  sac_luxe:     { name: 'Sac de créateur', icon: '👜', value: 2200, w: 1, r: 3, shops: ['luxe'] },
  diamants:     { name: 'Parure de diamants', icon: '💎', value: 7000, w: 0.1, r: 4, shops: ['luxe'] },
  // Caisses enregistreuses (tout magasin)
  cash_s:       { name: 'Fond de caisse', icon: '💶', value: 90, w: 0.2, r: 0, shops: ['caisse'], hold: 2.5 },
  cash_m:       { name: 'Liasse de billets', icon: '💶', value: 260, w: 0.2, r: 1, shops: ['caisse'], hold: 2.5 },
  cash_l:       { name: 'Coffre à billets', icon: '💰', value: 800, w: 0.5, r: 2, shops: ['caisse'], hold: 3 },
};

export const DEFAULT_HOLD = 0.5;
export function holdTime(itemId) { return ITEMS[itemId]?.hold ?? DEFAULT_HOLD; }

const tableCache = {};
function tableFor(shop) {
  if (!tableCache[shop]) tableCache[shop] = Object.keys(ITEMS).filter((id) => ITEMS[id].shops.includes(shop));
  return tableCache[shop];
}

// Tire un objet pour un rayon de magasin. Plus le quartier est riche, plus les objets rares sortent.
export function rollItem(shop, tier, rng) {
  const ids = tableFor(shop);
  let total = 0;
  const w = ids.map((id) => {
    const r = ITEMS[id].r;
    const x = RARITY[r].weight * (1 + (tier - 1) * 0.7 * r);
    total += x;
    return x;
  });
  let roll = rng() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= w[i];
    if (roll <= 0) return ids[i];
  }
  return ids[0];
}

// ---------------------------------------------------------------------------
// Équipement (achat permanent à la planque)
export const GEAR = {
  backpack: [
    { id: 'sac_plastique', name: 'Sac plastique', icon: '🛍️', cap: 8, price: 0, desc: '8 kg de capacité.' },
    { id: 'sac_dos', name: 'Sac à dos', icon: '🎒', cap: 16, price: 450, desc: '16 kg de capacité.' },
    { id: 'sac_sport', name: 'Sac de sport', icon: '👝', cap: 26, price: 1800, desc: '26 kg de capacité.' },
    { id: 'sac_rando', name: 'Sac de randonnée 60L', icon: '🏕️', cap: 42, price: 7500, desc: '42 kg : de quoi emporter une TV.' },
  ],
  weapon: [
    { id: 'poings', name: 'Poings', icon: '✊', type: 'melee', dmg: 10, range: 1.7, cd: 0.45, price: 0, desc: 'Gratuit, mais léger.' },
    { id: 'barre', name: 'Barre de fer', icon: '🔧', type: 'melee', dmg: 24, range: 2.1, cd: 0.7, price: 350, desc: 'Mêlée, 24 dégâts.' },
    { id: 'batte', name: 'Batte de baseball', icon: '🏏', type: 'melee', dmg: 34, range: 2.3, cd: 0.8, price: 1400, desc: 'Mêlée, 34 dégâts, bonne allonge.' },
    { id: 'lancepierre', name: 'Lance-pierre', icon: '🪃', type: 'ranged', ammo: 'bille', dmg: 22, speed: 36, cd: 0.55, price: 1200, desc: 'Distance. Consomme des billes.' },
    { id: 'mortier', name: "Mortier d'artifice", icon: '🎆', type: 'ranged', ammo: 'fusee', dmg: 28, aoe: 3.2, stun: 2.2, speed: 21, cd: 1.1, price: 5200, desc: 'Explosion qui étourdit. Consomme des fusées.' },
  ],
  armor: [
    { id: 'capuche', name: 'Capuche', icon: '🧥', reduc: 0, price: 0, desc: 'Aucune protection.' },
    { id: 'casque', name: 'Casque de moto', icon: '⛑️', reduc: 0.2, price: 900, desc: '-20 % de dégâts.' },
    { id: 'gilet', name: 'Gilet rembourré + casque', icon: '🦺', reduc: 0.38, price: 3800, desc: '-38 % de dégâts.' },
  ],
  shoes: [
    { id: 'claquettes', name: 'Claquettes', icon: '🩴', speed: 1.0, price: 0, desc: 'Vitesse normale.' },
    { id: 'baskets', name: 'Baskets de running', icon: '👟', speed: 1.08, price: 500, desc: '+8 % de vitesse.' },
    { id: 'pro', name: 'Chaussures de trail pro', icon: '🥾', speed: 1.16, price: 2900, desc: '+16 % de vitesse.' },
  ],
  face: [
    { id: 'aucun', name: 'Rien', icon: '😶', gas: false, price: 0, desc: 'Sensible aux lacrymos.' },
    { id: 'masque', name: 'Masque à gaz', icon: '😷', gas: true, price: 1600, desc: 'Immunité aux gaz lacrymogènes.' },
  ],
};
export const GEAR_SLOTS = ['backpack', 'weapon', 'armor', 'shoes', 'face'];
export const GEAR_SLOT_NAMES = { backpack: 'Sac', weapon: 'Arme', armor: 'Protection', shoes: 'Chaussures', face: 'Visage' };

export const GEAR_BY_ID = {};
for (const slot of GEAR_SLOTS) for (const g of GEAR[slot]) GEAR_BY_ID[g.id] = { ...g, slot };

export const CONSUMABLES = {
  bandage: { name: 'Bandage', icon: '🩹', price: 40, pack: 1, max: 10, desc: 'Soigne 35 PV en 3 s.' },
  bille:   { name: "Billes d'acier", icon: '⚪', price: 60, pack: 15, max: 90, desc: 'Munitions du lance-pierre (x15).' },
  fusee:   { name: "Fusées d'artifice", icon: '🎇', price: 300, pack: 3, max: 15, desc: 'Munitions du mortier (x3).' },
};

// Valide le loadout envoyé par un client (le serveur ne fait pas confiance aux ids).
export function sanitizeLoadout(lo = {}) {
  const out = {};
  for (const slot of GEAR_SLOTS) {
    const g = GEAR_BY_ID[lo[slot]];
    out[slot] = g && g.slot === slot ? g.id : GEAR[slot][0].id;
  }
  const cons = lo.cons || {};
  out.cons = {};
  for (const k in CONSUMABLES) {
    const n = Math.floor(Number(cons[k]) || 0);
    out.cons[k] = Math.max(0, Math.min(CONSUMABLES[k].max, n));
  }
  return out;
}

export function invWeight(inv) {
  let w = 0;
  for (const id of inv) w += ITEMS[id]?.w || 0;
  return w;
}
export function invValue(inv) {
  let v = 0;
  for (const id of inv) v += ITEMS[id]?.value || 0;
  return v;
}
