// Weapon stats. Damage is body damage; headshots use `head`, leg shots use LEG_MULT.
// fireRate = rounds per second. spread = base radians of inaccuracy (bloom adds more).
// slot: 'secondary' (sidearms) or 'primary' — you carry one of each.
// zoom: ADS field-of-view multiplier (right mouse). scope: full-screen scope overlay.

export const LEG_MULT = 0.85;

export const WEAPONS = [
  // sidearms
  { id: 'classic',  name: 'CLASSIC',  type: 'SIDEARM', cat: 'SIDEARMS', slot: 'secondary', price: 0,    dmg: 26,  head: 3.0, fireRate: 6.75, mag: 12, auto: false, spread: 0.010, recoil: 0.011, reload: 1.75, zoom: 0.9 },
  { id: 'shorty',   name: 'SHORTY',   type: 'SIDEARM', cat: 'SIDEARMS', slot: 'secondary', price: 300,  dmg: 12,  head: 2.0, fireRate: 3.3,  mag: 2,  auto: false, spread: 0.075, recoil: 0.03, pellets: 12, reload: 1.75, zoom: 1 },
  { id: 'sheriff',  name: 'SHERIFF',  type: 'SIDEARM', cat: 'SIDEARMS', slot: 'secondary', price: 800,  dmg: 55,  head: 2.9, fireRate: 4.0,  mag: 6,  auto: false, spread: 0.008, recoil: 0.028, reload: 2.25, zoom: 0.85 },
  // smg / shotgun
  { id: 'spectre',  name: 'SPECTRE',  type: 'SMG',     cat: 'SMGS',     slot: 'primary',   price: 1600, dmg: 26,  head: 2.5, fireRate: 13.3, mag: 30, auto: true,  spread: 0.016, recoil: 0.007, reload: 2.25, zoom: 0.87 },
  // rifles
  { id: 'bulldog',  name: 'BULLDOG',  type: 'RIFLE',   cat: 'RIFLES',   slot: 'primary',   price: 2050, dmg: 35,  head: 3.3, fireRate: 10.0, mag: 24, auto: true,  spread: 0.011, recoil: 0.010, reload: 2.5, zoom: 0.8 },
  { id: 'phantom',  name: 'PHANTOM',  type: 'RIFLE',   cat: 'RIFLES',   slot: 'primary',   price: 2900, dmg: 39,  head: 4.0, fireRate: 11.0, mag: 30, auto: true,  spread: 0.009, recoil: 0.009, reload: 2.5, zoom: 0.8 },
  { id: 'vandal',   name: 'VANDAL',   type: 'RIFLE',   cat: 'RIFLES',   slot: 'primary',   price: 2900, dmg: 40,  head: 4.0, fireRate: 9.75, mag: 25, auto: true,  spread: 0.010, recoil: 0.011, reload: 2.5, zoom: 0.8 },
  // sniper / heavy
  { id: 'operator', name: 'OPERATOR', type: 'SNIPER',  cat: 'SNIPERS',  slot: 'primary',   price: 4700, dmg: 150, head: 1.7, fireRate: 0.75, mag: 5,  auto: false, spread: 0.06, scopedSpread: 0.0005, recoil: 0.05, reload: 3.7, zoom: 0.4, scope: true },
  { id: 'odin',     name: 'ODIN',     type: 'HEAVY',   cat: 'HEAVIES',  slot: 'primary',   price: 3200, dmg: 32,  head: 2.4, fireRate: 15.6, mag: 100, auto: true, spread: 0.022, recoil: 0.006, reload: 5.0, zoom: 0.85 },
];

export const getWeapon = (id) => WEAPONS.find((w) => w.id === id);

// Armory column order (Valorant-style layout).
export const CATEGORIES = ['SIDEARMS', 'SMGS', 'RIFLES', 'SNIPERS', 'HEAVIES'];

// Shields absorb a share of incoming damage until depleted.
export const SHIELDS = [
  { id: 'light', name: 'LIGHT SHIELD', price: 400, amount: 25 },
  { id: 'heavy', name: 'HEAVY SHIELD', price: 1000, amount: 50 },
];

// Blade Storm pseudo-weapon for Jett's ult.
export const BLADE_STORM = {
  id: 'knives', name: 'BLADE STORM', type: 'ULT', slot: 'ult', dmg: 250, head: 1, fireRate: 3.5, mag: Infinity, auto: false, spread: 0.002, recoil: 0.004, zoom: 1,
};
