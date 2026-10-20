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
// Armes : modèles du pack CC0 « Guns & Explosives » de 3dmodelscc0 (optimisés dans client/public/models/weapons).
// rpm = cadence, spread = dispersion (rad), range = portée (m), pellets = plombs (fusil à pompe)
export const WEAPONS = {
  makarov:   { name: 'Pistolet Makarov', icon: '🔫', slot: 'sidearm', model: 'Makarov', auto: false, dmg: 24, rpm: 320, mag: 8, reload: 1.4, ammo: 'a9', spread: 0.014, range: 60, noise: 45, price: 0, desc: 'Pistolet semi-auto, 8 coups.' },
  luger:     { name: 'Luger P08', icon: '🔫', slot: 'sidearm', model: 'Luger', auto: false, dmg: 30, rpm: 330, mag: 8, reload: 1.5, ammo: 'a9', spread: 0.01, range: 70, noise: 45, price: 900, desc: 'Plus précis et plus puissant.' },
  flaregun:  { name: 'Pistolet lance-fusées', icon: '🧨', slot: 'sidearm', model: 'FlareGun', auto: false, proj: 'fusee', dmg: 30, rpm: 60, mag: 1, reload: 2, ammo: 'af', speed: 34, aoe: 3, stun: 2.2, spread: 0.01, noise: 30, price: 700, desc: 'Fusée incendiaire qui étourdit en zone.' },
  greasegun: { name: 'Grease Gun M3', icon: '🔫', slot: 'primary', model: 'Grease_Gun', auto: true, dmg: 20, rpm: 450, mag: 30, reload: 2.2, ammo: 'a9', spread: 0.035, range: 60, noise: 55, price: 2400, desc: 'Pistolet-mitrailleur, 30 coups.' },
  suomi:     { name: 'Suomi KP/-31', icon: '🔫', slot: 'primary', model: 'Suomi_KP', auto: true, dmg: 18, rpm: 800, mag: 50, reload: 2.8, ammo: 'a9', spread: 0.04, range: 60, noise: 55, price: 4200, desc: 'Chargeur camembert de 50 coups.' },
  shotgun:   { name: 'Fusil à pompe', icon: '🔫', slot: 'primary', model: 'Shotgun', auto: false, dmg: 13, pellets: 8, rpm: 70, mag: 6, reload: 2.8, ammo: 'a12', spread: 0.075, range: 35, noise: 65, price: 3200, desc: 'Dévastateur à courte portée.' },
  ak47:      { name: 'AK-47', icon: '🔫', slot: 'primary', model: 'AK47', auto: true, dmg: 33, rpm: 600, mag: 30, reload: 2.4, ammo: 'a762', spread: 0.03, range: 120, noise: 75, price: 7000, desc: 'Fusil d’assaut puissant.' },
  m4a1:      { name: 'M4A1', icon: '🔫', slot: 'primary', model: 'M4A1', auto: true, dmg: 29, rpm: 750, mag: 30, reload: 2.2, ammo: 'a762', spread: 0.022, range: 130, noise: 75, price: 9500, desc: 'Fusil d’assaut précis.' },
  sniper:    { name: 'Fusil de précision', icon: '🎯', slot: 'primary', model: 'Sniper', auto: false, dmg: 100, rpm: 45, mag: 5, reload: 3, ammo: 'a308', spread: 0.002, range: 200, noise: 95, zoom: 4, price: 12500, desc: 'Lunette x4. Un tir, un CRS à terre.' },
};
export const MELEE = { name: 'Coup de crosse', dmg: 14, range: 1.8, cd: 0.6 };

export const GEAR = {
  primary: [
    { id: 'aucune', name: 'Aucune', icon: '✋', price: 0, desc: 'Pas d’arme principale.' },
    ...['greasegun', 'suomi', 'shotgun', 'ak47', 'm4a1', 'sniper'].map((id) => ({ id, ...WEAPONS[id] })),
  ],
  sidearm: ['makarov', 'luger', 'flaregun'].map((id) => ({ id, ...WEAPONS[id] })),
  backpack: [
    { id: 'sac_plastique', name: 'Sac plastique', icon: '🛍️', cap: 8, price: 0, desc: '8 kg de capacité.' },
    { id: 'sac_dos', name: 'Sac à dos', icon: '🎒', cap: 16, price: 450, desc: '16 kg de capacité.' },
    { id: 'sac_sport', name: 'Sac de sport', icon: '👝', cap: 26, price: 1800, desc: '26 kg de capacité.' },
    { id: 'sac_rando', name: 'Sac de randonnée 60L', icon: '🏕️', cap: 42, price: 7500, desc: '42 kg : de quoi emporter une TV.' },
  ],
  tenue: [
    { id: 'survet', name: 'Survêtement', icon: '👕', price: 0, desc: 'Tenue de base.' },
    { id: 'cagoule', name: 'Cagoule + capuche', icon: '🥷', price: 150, desc: 'Les émeutiers te prennent pour l’un des leurs : ils t’agressent beaucoup moins.' },
    { id: 'gilet_jaune', name: 'Gilet jaune', icon: '🦺', price: 120, desc: 'Au milieu d’un cortège de gilets jaunes, les CRS ne te repèrent presque plus.' },
  ],
  armor: [
    { id: 'aucune_prot', name: 'Aucune', icon: '🧥', reduc: 0, price: 0, desc: 'Aucune protection.' },
    { id: 'casque', name: 'Casque de moto', icon: '⛑️', reduc: 0.2, price: 900, desc: '-20 % de dégâts.' },
    { id: 'gilet', name: 'Gilet pare-balles', icon: '🦺', reduc: 0.38, price: 4200, desc: '-38 % de dégâts.' },
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
export const GEAR_SLOTS = ['primary', 'sidearm', 'tenue', 'backpack', 'armor', 'shoes', 'face'];
export const GEAR_SLOT_NAMES = { primary: 'Arme principale', sidearm: 'Arme de poing', tenue: 'Tenue', backpack: 'Sac', armor: 'Protection', shoes: 'Chaussures', face: 'Visage' };

export const GEAR_BY_ID = {};
for (const slot of GEAR_SLOTS) for (const g of GEAR[slot]) GEAR_BY_ID[g.id] = { ...g, slot };

// Lancer (G) : grenades et pièges du même pack
export const THROWABLES = {
  fumi:     { name: 'Fumigène', icon: '💨', model: 'Smoke_Grenade', desc: 'Nuage qui bloque la vue des CRS (15 s).' },
  flash:    { name: 'Grenade aveuglante', icon: '⚡', model: 'Flashbang', desc: 'Étourdit tout le monde autour (7 m).' },
  frag:     { name: 'Grenade', icon: '💣', model: 'FragGrenadeModel', desc: 'Explose après 2,5 s. 6 m de rayon.' },
  molotov:  { name: 'Cocktail Molotov', icon: '🍾', model: 'Molotov_Cocktail', desc: 'Zone de feu pendant 8 s.' },
  claymore: { name: 'Mine Claymore', icon: '🧱', model: 'Claymore', desc: 'Piège posé au sol : explose au passage.' },
};
export const THROW_ORDER = ['fumi', 'flash', 'frag', 'molotov', 'claymore'];

export const CONSUMABLES = {
  bandage:  { name: 'Bandage', icon: '🩹', price: 40, pack: 1, max: 10, desc: 'Soigne 35 PV en 3 s.' },
  a9:       { name: 'Munitions 9 mm', icon: '🟡', price: 40, pack: 30, max: 300, desc: 'Pistolets et pistolets-mitrailleurs (x30).' },
  a762:     { name: 'Munitions de fusil', icon: '🟠', price: 120, pack: 30, max: 240, desc: 'AK-47 et M4A1 (x30).' },
  a12:      { name: 'Cartouches cal. 12', icon: '🔴', price: 80, pack: 12, max: 72, desc: 'Fusil à pompe (x12).' },
  a308:     { name: 'Balles .308', icon: '🟤', price: 150, pack: 10, max: 50, desc: 'Fusil de précision (x10).' },
  af:       { name: 'Fusées', icon: '🎇', price: 90, pack: 3, max: 15, desc: 'Pistolet lance-fusées (x3).' },
  fumi:     { name: 'Fumigène', icon: '💨', price: 120, pack: 1, max: 5, desc: THROWABLES.fumi.desc },
  flash:    { name: 'Grenade aveuglante', icon: '⚡', price: 180, pack: 1, max: 5, desc: THROWABLES.flash.desc },
  frag:     { name: 'Grenade', icon: '💣', price: 350, pack: 1, max: 5, desc: THROWABLES.frag.desc },
  molotov:  { name: 'Cocktail Molotov', icon: '🍾', price: 90, pack: 1, max: 5, desc: THROWABLES.molotov.desc },
  claymore: { name: 'Mine Claymore', icon: '🧱', price: 400, pack: 1, max: 3, desc: THROWABLES.claymore.desc },
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
