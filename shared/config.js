// Constantes partagées client / serveur.

export const TICK_RATE = 20;              // simulation serveur (Hz)
export const TICK_DT = 1 / TICK_RATE;
export const MAX_PLAYERS_PER_ROOM = 8;
export const INTEREST_RADIUS = 90;        // rayon de réplication réseau (m)

export const PLAYER = {
  radius: 0.38,
  hp: 100,
  walk: 4.2,
  sprintMult: 1.6,
  crouchMult: 0.55,
  stamina: 100,
  staminaDrain: 20,
  staminaRegen: 13,
  pickRange: 2.1,
  extractRadius: 3.5,
  extractTime: 6,
};

export const NPC_RADIUS = 0.36;

// Quartiers : chaque quartier débloqué donne accès à de nouveaux magasins / loot.
export const DISTRICTS = {
  cite: {
    id: 'cite', name: 'La Cité', seed: 1337, size: 3, tier: 1,
    shopChance: 0.5,
    shops: { superette: 4, tel: 2, sneakers: 2 },
    rioters: 16, crsBase: 3, raidTime: 480, unlockCost: 0,
    desc: 'Supérettes et petites boutiques. Peu de CRS. Idéal pour débuter.',
  },
  centre: {
    id: 'centre', name: 'Centre-ville', seed: 4242, size: 4, tier: 2,
    shopChance: 0.55,
    shops: { superette: 1, tel: 3, sneakers: 3, hifi: 3, bijou: 1 },
    rioters: 22, crsBase: 6, raidTime: 600, unlockCost: 6000,
    desc: 'Hi-Fi, téléphonie, sneakers. Les CRS quadrillent le secteur.',
  },
  luxe: {
    id: 'luxe', name: "Le Triangle d'Or", seed: 9001, size: 4, tier: 3,
    shopChance: 0.6,
    shops: { luxe: 4, bijou: 3, hifi: 1, tel: 1 },
    rioters: 16, crsBase: 10, raidTime: 600, unlockCost: 30000,
    desc: 'Joailliers et maisons de luxe. Gros butin, répression maximale.',
  },
};
export const DISTRICT_ORDER = ['cite', 'centre', 'luxe'];

export const SHOP_TYPES = {
  superette: { name: 'SUPÉRETTE', color: '#2f9e44', floor: 0xb9b2a4 },
  tel:       { name: 'TÉLÉPHONIE', color: '#1971c2', floor: 0xa9b4c2 },
  sneakers:  { name: 'SNEAKERS', color: '#e8590c', floor: 0x9a9a9a },
  hifi:      { name: 'HI-FI MULTIMÉDIA', color: '#c2255c', floor: 0x8f8f9f },
  bijou:     { name: 'BIJOUTERIE', color: '#d4a017', floor: 0xcfc4a8 },
  luxe:      { name: 'MAISON DE LUXE', color: '#212529', floor: 0xe4ddd0 },
};
