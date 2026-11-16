// EMBERLINE — shared configuration: palette, weapons, economy, timings.
// Every tunable lives here so the rest of the code stays free of magic numbers.

export const PALETTE = {
  sky: 0x241a16,        // dusk haze
  fog: 0x2e211a,
  ground: 0x35302a,      // worn asphalt
  concrete: 0x59524a,    // building sandstone-grey
  slate: 0x3d4a4c,       // second building tone
  metal: 0x4c4f52,
  crate: 0x6e5636,       // timber crates
  container: 0x74553a,   // rusted depot containers
  ember: 0xff7a26,       // Kindler orange (attack)
  warden: 0x35b8a6,      // Warden teal (defence)
  furnace: 0xff5a1a,
  ink: '#f2ede4',
  muted: '#a89f92',
  accent: '#ff7a26',
  money: '#ffd257',
  danger: '#ff4747',
};

export const TEAM = {
  atk: { id: 'atk', name: 'Kindlers', color: PALETTE.ember },
  def: { id: 'def', name: 'Wardens', color: PALETTE.warden },
};

// Weapon definitions. Damage is per bullet at point blank; headMult applies to head hits,
// falloff scales damage from 1 at `near` metres down to `minF` at `far` metres.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    dmg: 34, headMult: 4, rpm: 352, mag: 12, reserve: 96, reload: 1.5,
    spread: 0.012, moveSpread: 1.6, recoil: 0.011, auto: false,
    falloff: { near: 14, far: 42, minF: 0.55 }, kick: 0.5,
  },
  rook: {
    id: 'rook', name: 'Rook-9 SMG', slot: 'primary', price: 1100,
    dmg: 26, headMult: 4, rpm: 750, mag: 30, reserve: 120, reload: 2.2,
    spread: 0.021, moveSpread: 1.1, recoil: 0.008, auto: true,
    falloff: { near: 10, far: 30, minF: 0.45 }, kick: 0.35,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Longline', slot: 'primary', price: 2700,
    dmg: 40, headMult: 4, rpm: 600, mag: 30, reserve: 90, reload: 2.4,
    spread: 0.009, moveSpread: 2.2, recoil: 0.014, auto: true,
    falloff: { near: 22, far: 60, minF: 0.72 }, kick: 0.8,
  },
  farshot: {
    id: 'farshot', name: 'Farshot .50', slot: 'primary', price: 4200,
    dmg: 112, headMult: 2, rpm: 41, mag: 5, reserve: 30, reload: 3.1,
    spread: 0.0012, moveSpread: 9, recoil: 0.05, auto: false, bolt: 1.45, zoom: true,
    falloff: { near: 40, far: 110, minF: 0.9 }, kick: 1.6,
  },
};

export const NADE = { id: 'frag', name: 'Ember Frag', price: 300, dmg: 92, radius: 6.5, fuse: 1.5 };

// Buy menu rows, in display order. kind: weapon | armor | nade | tools.
export const BUY_ITEMS = [
  { key: '1', kind: 'weapon', id: 'rook', label: 'Rook-9 SMG', price: 1100 },
  { key: '2', kind: 'weapon', id: 'vk47', label: 'VK-47 Longline', price: 2700 },
  { key: '3', kind: 'weapon', id: 'farshot', label: 'Farshot .50', price: 4200 },
  { key: '4', kind: 'armor', id: 1, label: 'Kevlar Vest', price: 650 },
  { key: '5', kind: 'armor', id: 2, label: 'Vest + Helmet', price: 1000 },
  { key: '6', kind: 'nade', id: 'frag', label: 'Ember Frag', price: 300 },
  { key: '7', kind: 'tools', id: 'tools', label: 'Charge Tools (fast plant)', price: 400 },
];

export const ECO = {
  start: 800, win: 1400, loss: 900, kill: 300, plant: 300, defuse: 300, cap: 9000,
};

export const TIMING = {
  buy: 12,          // buy / freeze phase, seconds
  round: 100,       // live round clock
  bomb: 35,         // planted charge countdown
  plant: 3,         // channel to plant (1.6 with tools)
  plantTools: 1.6,
  defuse: 5,        // channel to defuse
  roundEnd: 4.5,    // banner pause between rounds
  firstTo: 7,       // round wins that take the match
  maxRounds: 12,
};

export const BOT_NAMES = {
  atk: ['Pax', 'Rin'],
  def: ['Hale', 'Voss', 'Mira'],
};
