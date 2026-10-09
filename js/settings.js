// Player settings — persisted to localStorage, read live by the engine.
// The exported `settings` object is mutated in place so changes apply instantly
// (game.js holds the same reference).

const KEY = 'webvalo:settings';

export const DEFAULTS = {
  sens: 1,          // mouse sensitivity multiplier (×0.0021 base)
  fov: 74,          // vertical field of view
  volume: 1,        // master SFX volume 0..1
  reducedMotion: false, // disable screen shake + flash overlays
  showFps: false,   // show the FPS counter
  difficulty: 'normal', // bot difficulty: easy | normal | hard
  damageNumbers: true,  // floating damage numbers on hit
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage may be blocked */ }
}
