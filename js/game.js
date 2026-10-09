// WebValo engine — Three.js first-person shooter.
// One file owns the match loop: world, player, weapons, abilities, HUD bridge.
// Enemy soldiers (model + AI) live in enemy.js, pathfinding in nav.js.

import * as THREE from 'three';
import { getWeapon, BLADE_STORM, LEG_MULT } from './weapons.js';
import { settings } from './settings.js';
import { Bot, SoldierRig } from './enemy.js';
import { NavGrid } from './nav.js';

const BOT_COUNT = 5;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 22;
const RESPAWN_DELAY = 3;
export const KILL_GOAL = 30;
export const MATCH_TIME = 600; // seconds
export const START_CREDITS = 2000;
const MAX_CREDITS = 9000;

// ---------------------------------------------------------------- audio
// Per-weapon-class gunshot timbre (lowpass cutoff, length, level, low-end body).
const SHOT_PROFILES = {
  SIDEARM: { freq: 2600, len: 0.08, gain: 0.20, body: 0 },
  SMG:     { freq: 2200, len: 0.06, gain: 0.16, body: 0 },
  RIFLE:   { freq: 2900, len: 0.10, gain: 0.22, body: 150 },
  SNIPER:  { freq: 1500, len: 0.24, gain: 0.30, body: 90 },
  HEAVY:   { freq: 2050, len: 0.075, gain: 0.20, body: 120 },
  ULT:     { freq: 3400, len: 0.05, gain: 0.10, body: 0 },
};

class Sfx {
  constructor() { this.ctx = null; this.master = null; this.listener = null; }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
  }
  // Positional variant: attenuate by distance and pan by direction relative to the listener's yaw.
  playAt(type, pos, arg = null) {
    const L = this.listener;
    if (!L) return this.play(type, arg);
    const dx = pos.x - L.pos.x, dz = pos.z - L.pos.z, d = Math.hypot(dx, dz);
    const vol = Math.max(0.12, 1 - d / 55);
    // listener right vector for yaw y (forward = -sin, -cos)
    const pan = d > 0.01 ? (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d : 0;
    this.play(type, arg, { vol, pan: Math.max(-0.85, Math.min(0.85, pan)) });
  }
  // Short procedural sounds — no audio assets needed.
  // `arg` carries the weapon (for 'shot') or the streak count (for 'streak').
  play(type, arg = null, { vol = 1, pan = 0 } = {}) {
    try {
      this.ensure();
      this.master.gain.value = settings.volume; // live master volume
      const ctx = this.ctx, t = ctx.currentTime;
      let out = this.master;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(this.master); out = p; }
      if (vol !== 1) { const v = ctx.createGain(); v.gain.value = vol; v.connect(out); out = v; }
      const gain = ctx.createGain();
      gain.connect(out);
      const noise = (len, curve) => {
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, curve);
        const src = ctx.createBufferSource(); src.buffer = buf; return src;
      };
      const tone = (wave, f0, f1, g0, len, at = t) => {
        const o = ctx.createOscillator(); o.type = wave;
        o.frequency.setValueAtTime(f0, at);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + len);
        const g = ctx.createGain(); g.connect(out);
        g.gain.setValueAtTime(g0, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
        o.connect(g); o.start(at); o.stop(at + len + 0.02);
      };
      if (type === 'shot' || type === 'botshot') {
        const prof = type === 'botshot' ? { freq: 1700, len: 0.1, gain: 0.13, body: 110 }
          : (SHOT_PROFILES[arg && arg.type] || { freq: 2400, len: 0.09, gain: 0.22, body: 0 });
        const jitter = 0.92 + Math.random() * 0.16; // subtle per-shot variation
        const len = prof.len, src = noise(len, 2.2);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = prof.freq * jitter;
        src.connect(f); f.connect(gain);
        gain.gain.setValueAtTime(prof.gain, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + len);
        src.start(t);
        if (prof.body) tone('sine', prof.body * jitter, prof.body * 0.5, prof.gain * 0.85, len * 1.4);
      } else if (type === 'streak') {
        const count = Math.min(arg || 2, 6);
        for (let i = 0; i < count; i++) tone('triangle', 520 * Math.pow(1.18, i), 520 * Math.pow(1.18, i), 0.12, 0.14, t + i * 0.07);
      } else if (type === 'hit') {
        tone('square', 880, 880, 0.05, 0.06);
      } else if (type === 'headshot') {
        // the satisfying "tink"
        tone('sine', 2400, 2300, 0.14, 0.16); tone('triangle', 3600, 3500, 0.06, 0.1);
      } else if (type === 'kill') {
        tone('square', 660, 660, 0.08, 0.07); tone('square', 990, 990, 0.08, 0.14, t + 0.07);
      } else if (type === 'deny') {
        tone('square', 180, 140, 0.08, 0.14);
      } else if (type === 'buy') {
        tone('triangle', 700, 700, 0.09, 0.06); tone('triangle', 1050, 1050, 0.09, 0.1, t + 0.06);
      } else if (type === 'hurt') {
        const src = noise(0.12, 3);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        src.connect(f); f.connect(gain); gain.gain.setValueAtTime(0.35, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12); src.start(t);
      } else if (type === 'whiz') {
        const src = noise(0.14, 1.2);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
        f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.14);
        src.connect(f); f.connect(gain); gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.07, t + 0.05); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14); src.start(t);
      } else if (type === 'boom') {
        const src = noise(0.5, 3);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
        src.connect(f); f.connect(gain);
        gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        src.start(t);
      } else if (type === 'ability') {
        tone('sine', 440, 1320, 0.08, 0.22);
      } else if (type === 'reload') {
        tone('triangle', 220, 220, 0.07, 0.12); tone('triangle', 330, 330, 0.05, 0.08, t + 0.18);
      } else if (type === 'equip') {
        tone('triangle', 300, 520, 0.05, 0.08);
      }
    } catch { /* audio is best-effort */ }
  }
}

// ---------------------------------------------------------------- textures
// Procedural canvas textures — still zero image assets in the repo.
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function speckle(x, s, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    x.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    x.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function makeTextures() {
  const floor = canvasTex(512, (x, s) => {
    x.fillStyle = '#4a5562'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { // soft stains
      const cx = Math.random() * s, cy = Math.random() * s;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 40 + Math.random() * 90);
      g.addColorStop(0, `rgba(20,28,36,${0.05 + Math.random() * 0.08})`); g.addColorStop(1, 'rgba(20,28,36,0)');
      x.fillStyle = g; x.fillRect(0, 0, s, s);
    }
    speckle(x, s, 9000, 0.09);
    x.strokeStyle = 'rgba(15,22,30,.55)'; x.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * s / 2, 0); x.lineTo(i * s / 2, s); x.stroke(); x.beginPath(); x.moveTo(0, i * s / 2); x.lineTo(s, i * s / 2); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1;
    for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * s / 2 + 2, 0); x.lineTo(i * s / 2 + 2, s); x.stroke(); }
  });
  const wall = canvasTex(512, (x, s) => {
    x.fillStyle = '#6a7b8e'; x.fillRect(0, 0, s, s);
    const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(0,0,0,.22)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    speckle(x, s, 5000, 0.07);
    x.fillStyle = 'rgba(20,28,38,.55)';
    for (let i = 0; i < 4; i++) x.fillRect(i * s / 4, 0, 3, s); // panel seams
    x.fillRect(0, s * 0.62, s, 5);
    x.fillStyle = 'rgba(30,40,52,.35)'; x.fillRect(0, s * 0.64, s, s * 0.36); // darker lower band
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 4; i++) for (const yy of [0.08, 0.56, 0.7, 0.94]) { x.beginPath(); x.arc(i * s / 4 + 14, yy * s, 3, 0, 7); x.fill(); x.beginPath(); x.arc(i * s / 4 + s / 4 - 14, yy * s, 3, 0, 7); x.fill(); }
  });
  const crate = canvasTex(256, (x, s) => {
    x.fillStyle = '#8a7556'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(0,0,0,${0.04 + (i % 2) * 0.05})`; x.fillRect(0, i * s / 6, s, s / 6 - 2); }
    speckle(x, s, 2500, 0.1);
    x.strokeStyle = '#3f3426'; x.lineWidth = 18; x.strokeRect(9, 9, s - 18, s - 18);
    x.lineWidth = 14; x.beginPath(); x.moveTo(16, 16); x.lineTo(s - 16, s - 16); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 2; x.strokeRect(19, 19, s - 38, s - 38);
  }, false);
  const metal = canvasTex(256, (x, s) => {
    x.fillStyle = '#4b5866'; x.fillRect(0, 0, s, s);
    speckle(x, s, 3000, 0.08);
    x.fillStyle = 'rgba(0,0,0,.25)';
    for (let i = 0; i < s; i += 32) x.fillRect(0, i, s, 2);
    // hazard stripe band at the top edge
    for (let i = -s; i < s * 2; i += 36) {
      x.fillStyle = '#d9a43b'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 18, 0); x.lineTo(i + 18 - 24, 24); x.lineTo(i - 24, 24); x.fill();
    }
    x.fillStyle = '#1b2129'; x.fillRect(0, 24, s, 4);
  });
  const sky = canvasTex(512, (x, s) => {
    const g = x.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#0b1420'); g.addColorStop(0.45, '#1d2c3d'); g.addColorStop(0.62, '#4a3a48'); g.addColorStop(0.75, '#c2695a'); g.addColorStop(1, '#1b222c');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; x.fillRect(Math.random() * s, Math.random() * s * 0.4, 1, 1); }
  }, false);
  const letter = (ch, color) => canvasTex(256, (x, s) => {
    x.clearRect(0, 0, s, s);
    x.font = 'bold 200px Anton, Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = color; x.globalAlpha = 0.85; x.fillText(ch, s / 2, s / 2 + 10);
  }, false);
  return { floor, wall, crate, metal, sky, letterA: letter('A', '#ff4655'), letterB: letter('B', '#53d9d1') };
}

// Scale a BoxGeometry's UVs to world size so tiling textures don't stretch.
function worldUV(geom, w, h, d, tile) {
  const uv = geom.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z — 4 verts each
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------- map
// FORGE — industrial district. Two sites, a mid corridor, crates and pillars.
function buildMap(scene) {
  const colliders = []; // AABB boxes for player + bullet collision
  const shootables = []; // meshes raycast for bullets
  const T = makeTextures();

  const matFloor = new THREE.MeshStandardMaterial({ map: T.floor, roughness: 0.92 });
  const matWall = new THREE.MeshStandardMaterial({ map: T.wall, roughness: 0.85 });
  const matCrate = new THREE.MeshStandardMaterial({ map: T.crate, roughness: 0.8 });
  const matMetal = new THREE.MeshStandardMaterial({ map: T.metal, roughness: 0.6, metalness: 0.3 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xff4655, emissive: 0xff4655, emissiveIntensity: 0.8 });
  const matTeal = new THREE.MeshStandardMaterial({ color: 0x53d9d1, emissive: 0x53d9d1, emissiveIntensity: 0.7 });
  const matBarrel = new THREE.MeshStandardMaterial({ color: 0x8c3a2e, roughness: 0.55, metalness: 0.4 });

  function box(w, h, d, x, y, z, mat = matCrate, solid = true, tile = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile) worldUV(g, w, h, d, tile);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(m));
      shootables.push(m);
    }
    return m;
  }

  // floor
  const floorGeo = new THREE.PlaneGeometry(120, 120);
  floorGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 30; });
  const floor = new THREE.Mesh(floorGeo, matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  shootables.push(floor);

  // perimeter walls (60 x 60 play area)
  const W = 30, H = 7;
  box(2 * W + 2, H, 1, 0, H / 2, -W, matWall, true, 4);
  box(2 * W + 2, H, 1, 0, H / 2, W, matWall, true, 4);
  box(1, H, 2 * W + 2, -W, H / 2, 0, matWall, true, 4);
  box(1, H, 2 * W + 2, W, H / 2, 0, matWall, true, 4);

  // mid corridor walls
  box(1, 3.4, 18, -6, 1.7, 0, matWall, true, 4);
  box(1, 3.4, 18, 6, 1.7, 0, matWall, true, 4);
  box(10, 3.4, 1, 0, 1.7, -14, matWall, true, 4);
  box(10, 3.4, 1, 0, 1.7, 14, matWall, true, 4);

  // A site (north-west)
  box(8, 2.6, 8, -18, 1.3, -18, matMetal, true, 2.6);  // raised platform block
  box(2.2, 2.2, 2.2, -12, 1.1, -20, matCrate);
  box(2.2, 2.2, 2.2, -22, 1.1, -12, matCrate);
  box(2.2, 1.1, 2.2, -12, 0.55, -12, matCrate);
  box(6, 0.06, 6, -18, 2.63, -18, matAccent, false); // glowing site pad on top

  // B site (south-east)
  box(8, 2.6, 8, 18, 1.3, 18, matMetal, true, 2.6);
  box(2.2, 2.2, 2.2, 12, 1.1, 20, matCrate);
  box(2.2, 2.2, 2.2, 22, 1.1, 12, matCrate);
  box(2.2, 1.1, 2.2, 12, 0.55, 12, matCrate);
  box(6, 0.06, 6, 18, 2.63, 18, matTeal, false);

  // painted site letters on the floor beside each site
  for (const [tex, x, z] of [[T.letterA, -11.5, -16], [T.letterB, 11.5, 16]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.02, z);
    scene.add(p);
  }

  // scattered cover (spawn lanes kept clear)
  const coverSpots = [
    [-14, 6], [14, -6], [-20, 8], [20, -8], [3, -21], [-3, 21],
    [-8, -8], [8, 8], [-24, -2], [24, 2], [10, -18], [-10, 18],
  ];
  for (const [x, z] of coverSpots) box(2, 1.6, 2, x, 0.8, z, matCrate);

  // barrels
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.25, 16);
  for (const [x, z] of [[-13.2, 7.6], [15.4, -4.6], [-25.5, 9], [25.5, -9], [7.2, 19.5], [-7.2, -19.5], [-2.5, 9], [2.5, -9]]) {
    const b = new THREE.Mesh(barrelGeo, matBarrel);
    b.position.set(x, 0.625, z);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.45, 0, z - 0.45), new THREE.Vector3(x + 0.45, 1.25, z + 0.45)));
    shootables.push(b);
  }

  // tall pillars
  box(1.6, 5, 1.6, -15, 2.5, 2, matWall, true, 2);
  box(1.6, 5, 1.6, 15, 2.5, -2, matWall, true, 2);

  // accent strips on perimeter + mid
  for (let i = -2; i <= 2; i++) {
    box(6, 0.18, 0.12, i * 12, 4.4, -W + 0.6, i % 2 ? matAccent : matTeal, false);
    box(6, 0.18, 0.12, i * 12, 4.4, W - 0.6, i % 2 ? matTeal : matAccent, false);
    box(0.12, 0.18, 6, -W + 0.6, 4.4, i * 12, i % 2 ? matAccent : matTeal, false);
    box(0.12, 0.18, 6, W - 0.6, 4.4, i * 12, i % 2 ? matTeal : matAccent, false);
  }
  box(0.12, 0.12, 16, -5.45, 3.2, 0, matTeal, false);
  box(0.12, 0.12, 16, 5.45, 3.2, 0, matAccent, false);

  // lighting
  scene.background = T.sky;
  scene.fog = new THREE.FogExp2(0x1d2733, 0.0125);
  scene.add(new THREE.HemisphereLight(0xc4d8ec, 0x4a4440, 1.5));
  const sun = new THREE.DirectionalLight(0xffdcc0, 3.0);
  sun.position.set(22, 34, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const redGlow = new THREE.PointLight(0xff4655, 10, 20);
  redGlow.position.set(-18, 4.5, -18);
  scene.add(redGlow);
  const tealGlow = new THREE.PointLight(0x53d9d1, 10, 20);
  tealGlow.position.set(18, 4.5, 18);
  scene.add(tealGlow);

  // player spawn points — open floor, away from cover
  const spawnPoints = [
    [-18, -8], [18, 8], [-22, 15], [22, -15], [-1, -25], [1, 25],
    [-12, 25], [12, -25], [-26, -24], [26, 24], [-26, 22], [26, -22],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  return { colliders, shootables, spawnPoints };
}

// ---------------------------------------------------------------- engine
const BOT_NAMES = ['REYNA-BOT', 'PHX-UNIT', 'OMEN-77', 'CYPHER.EXE', 'KAYO-MK2', 'VIPER-X', 'SAGE-9000'];

export class Game {
  constructor(canvas, agent, callbacks, models = null) {
    this.canvas = canvas;
    this.agent = agent;
    this.cb = callbacks;
    this.models = models; // preloaded glTF gun store (null → procedural fallback)
    this.sfx = new Sfx();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.baseFov = settings.fov;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 300);
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    const { colliders, shootables, spawnPoints } = buildMap(this.scene);
    this.colliders = colliders;
    this.shootables = shootables;
    this.spawnPoints = spawnPoints;
    // LOS is blocked by walls/crates but not the floor plane — precompute once.
    this.wallBlockers = shootables.filter((s) => s.geometry.type !== 'PlaneGeometry');
    this.nav = new NavGrid(colliders);

    // pooling — reuse one raycaster, scratch vectors, and mesh pools to avoid
    // per-shot/per-frame allocation (and the GC stutter it causes).
    this.raycaster = new THREE.Raycaster();
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._collBox = new THREE.Box3();
    this._rayTargets = []; this._losTargets = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.85 });
    this.enemyTracerMat = new THREE.LineBasicMaterial({ color: 0xff7a5c, transparent: true, opacity: 0.9 });
    this.tracerPool = [];
    this.impactGeo = new THREE.SphereGeometry(0.045, 6, 6);
    this.impactMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
    this.impactPool = [];
    this.sparkGeo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
    this.sparkPool = [];
    this.sparks = [];

    // player state
    this.pos = new THREE.Vector3(0, PLAYER_HEIGHT, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; // yaw 0 faces -z
    this.onGround = true;
    this.hp = 100; this.armor = 0;
    this.money = START_CREDITS;
    this.dead = false; this.deadUntil = 0;
    this.kills = 0; this.deaths = 0;
    this.stats = { shots: 0, hits: 0, heads: 0, damage: 0 };
    this.killStreak = 0; this.lastKillTime = -99;
    this.ultPoints = 0;
    this.fireRateMult = 1; // stim beacon
    this.invisible = false; // yoru ult
    this.matchTime = MATCH_TIME;
    this.ended = false;

    // weapons — one primary + one secondary, each keeps its own magazine
    this.slots = { primary: null, secondary: { weapon: getWeapon('classic'), mag: getWeapon('classic').mag } };
    this.activeSlot = 'secondary';
    this.weapon = this.slots.secondary.weapon;
    this.preUlt = null;
    this.mag = this.weapon.mag;
    this.reloading = false; this.reloadEnd = 0;
    this.drawUntil = 0;
    this.lastShot = 0;
    this.recoilKick = 0;
    this.bloom = 0;
    this.aiming = false; this.adsT = 0;
    this.shake = { until: 0, power: 0, dur: 0.001 };

    // abilities — each slot tracks charges that recharge independently in
    // parallel (e.g. Raze's 2 Blast Packs). `cooldowns` mirrors the soonest
    // pending recharge time, kept only for the HUD countdown.
    this.abilityState = {};
    this.cooldowns = { C: 0, Q: 0, E: 0 };
    for (const slot of ['C', 'Q', 'E']) {
      const ab = agent.abilities[slot];
      const max = (ab && ab.charges) || 1;
      this.abilityState[slot] = { count: max, max, cd: (ab && ab.cd) || 0, pending: [] };
    }
    this.effects = []; // transient world objects { mesh, until, update? }
    this.projectiles = [];
    this.zones = [];
    this.gateMarker = null; // yoru E
    this.ultActiveUntil = 0;
    this.reveal = { until: 0 };
    this.dmgNums = [];
    this.dmgNumEl = document.getElementById('dmg-numbers');
    this.dmgArrowEl = document.getElementById('dmg-arrows');

    this.keys = {};
    this.mouseDown = false;
    this.paused = false;   // pause menu
    this.buyOpen = false;  // armory
    this.needsLock = false; // pointer lock lost → "click to resume"
    this.running = false;
    this.clock = new THREE.Clock();

    this.bots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      const bot = new Bot(this.scene, this.nav.randomPoint(), BOT_NAMES[i % BOT_NAMES.length], i);
      bot._difficulty = settings.difficulty;
      this.bots.push(bot);
    }
    this.placePlayer();
    for (const b of this.bots) this.respawnBot(b);

    this.buildViewmodel();
    this.bindEvents();
    this.resize();
  }

  // ---------------- viewmodel
  buildViewmodel() {
    this.viewmodel = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x2c3845, roughness: 0.5, metalness: 0.4, emissive: 0x131b26, emissiveIntensity: 1 });
    const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.agent.color), emissive: new THREE.Color(this.agent.color), emissiveIntensity: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.5), gunMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), gunMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -0.38);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.02, 0.3), accent);
    stripe.position.set(0, 0.045, -0.05);
    // Procedural gun lives in its own group so it can hide when a glTF model loads.
    this.procGun = new THREE.Group();
    this.procGun.add(body, barrel, stripe);
    this.gunMount = new THREE.Group();
    this.muzzle = new THREE.PointLight(0xffd9a0, 0, 4);
    this.muzzle.position.set(0, 0.03, -0.55);
    // muzzle flash billboard (first person)
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const fx = fc.getContext('2d'); const fg = fx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fg.addColorStop(0, 'rgba(255,250,225,1)'); fg.addColorStop(0.3, 'rgba(255,190,90,.85)'); fg.addColorStop(1, 'rgba(255,120,40,0)');
    fx.fillStyle = fg; fx.fillRect(0, 0, 64, 64);
    this.vmFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(fc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.vmFlash.position.set(0, 0.03, -0.62);
    this.vmFlash.visible = false;
    this.viewmodel.add(this.procGun, this.gunMount, this.muzzle, this.vmFlash);
    this.viewmodel.scale.setScalar(0.62);
    this.viewmodel.traverse((o) => { o.frustumCulled = false; });
    // Dedicated overlay pass: own scene + camera, rendered after the world with a depth clear.
    this.vmZ = -0.45;
    this.vmScene = new THREE.Scene();
    this.vmScene.add(this.viewmodel);
    this.vmScene.add(new THREE.HemisphereLight(0xbdd4e8, 0x46525e, 2.2));
    const vmKey = new THREE.DirectionalLight(0xfff0dc, 2.4);
    vmKey.position.set(0.6, 0.8, 0.4);
    this.vmScene.add(vmKey);
    this.vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.setGunModel(this.weapon.id);
  }

  // Swap the first-person weapon to its glTF model; falls back to the procedural gun.
  async setGunModel(weaponId) {
    this._gunReq = weaponId;
    if (!this.models) return;
    let mount = null;
    try { mount = await this.models.gun(weaponId); } catch { mount = null; }
    if (!this.gunMount || this._gunReq !== weaponId) return; // destroyed or switched mid-load
    this.gunMount.clear();
    if (mount) {
      this.gunMount.add(mount);
      this.gunMount.traverse((o) => { o.frustumCulled = false; });
      this.procGun.visible = false;
    } else {
      this.procGun.visible = true;
    }
  }

  // ---------------- input
  bindEvents() {
    this._onKeyDown = (e) => this.onKey(e, true);
    this._onKeyUp = (e) => this.onKey(e, false);
    this._onMouseMove = (e) => {
      if (!this.locked() || this.simPaused() || this.dead) return;
      const zoomSens = this.aiming ? (this.weapon.scope ? 0.45 : 0.85) : 1;
      const s = 0.0021 * settings.sens * zoomSens;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    this._onMouseDown = (e) => {
      if (!this.running || this.ended) return;
      // Any click on the game while unlocked re-acquires the pointer (a click is a valid gesture).
      if (!this.locked() && !this.buyOpen && !this.paused) { this.lock(); return; }
      if (e.button === 0) { this.mouseDown = true; this.tryShoot(); }
      if (e.button === 2) this.aiming = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aiming = false;
    };
    this._onWheel = (e) => { if (this.locked() && !this.simPaused()) this.switchSlot(this.activeSlot === 'primary' ? 'secondary' : 'primary'); };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      if (this.locked()) {
        this.needsLock = false;
        this.cb.onLockPrompt?.(false);
        return;
      }
      this.mouseDown = false; this.aiming = false;
      // Esc (browser unlock) → pause menu; other losses → lightweight click-to-resume
      if (this.running && !this.ended && !this.buyOpen && !this.paused) this.setPaused(true);
    };
    this._onLockError = () => {
      if (this.running && !this.ended && !this.buyOpen && !this.paused) { this.needsLock = true; this.cb.onLockPrompt?.(true); }
    };
    this._onResize = () => this.resize();
    this._onBlur = () => { this.keys = {}; this.mouseDown = false; };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('blur', this._onBlur);
  }

  destroy() {
    this.running = false;
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onBlur);
    if (this.locked()) document.exitPointerLock();
    for (const d of this.dmgNums) d.el.remove();
    if (this.dmgArrowEl) this.dmgArrowEl.innerHTML = '';
    this.renderer.dispose();
  }

  locked() { return document.pointerLockElement === this.canvas; }

  // Pointer lock can be rejected (no user gesture, cooldown after Esc). Never throw;
  // if it doesn't take, fall back to a "click to resume" prompt so input is never stuck.
  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this._onLockError());
    } catch { this._onLockError(); }
    clearTimeout(this._lockCheck);
    this._lockCheck = setTimeout(() => { if (!this.locked()) this._onLockError(); }, 400);
  }

  simPaused() { return this.paused || this.buyOpen || this.needsLock || this.ended; }

  onKey(e, down) {
    if (!this.running) return;
    if (e.code === 'Tab') { e.preventDefault(); if (!this.ended) this.cb.onScoreboard?.(down, this.scoreRows()); return; }
    this.keys[e.code] = down;
    if (!down || e.repeat) return;
    if (this.ended) return;
    if (e.code === 'KeyB') { this.toggleBuy(); return; }
    if (this.buyOpen) {
      if (e.code === 'Escape') { this.toggleBuy(false); return; }
      if (/^Digit[1-9]$/.test(e.code) || e.code === 'KeyL' || e.code === 'KeyH') this.cb.onQuickBuy(e.code);
      return;
    }
    if (this.simPaused() || this.dead) return;
    if (e.code === 'KeyR') this.startReload();
    if (e.code === 'Digit1') this.switchSlot('primary');
    if (e.code === 'Digit2') this.switchSlot('secondary');
    if (e.code === 'KeyC') this.useAbility('C');
    if (e.code === 'KeyQ') this.useAbility('Q');
    if (e.code === 'KeyE') this.useAbility('E');
    if (e.code === 'KeyX') this.useAbility('X');
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause-menu').classList.toggle('hidden', !p);
    if (!p) this.lock();
  }

  toggleBuy(force) {
    const open = force === undefined ? !this.buyOpen : force;
    if (open === this.buyOpen) return;
    this.buyOpen = open;
    this.cb.onBuyMenu?.(open);
    this.mouseDown = false; this.aiming = false;
    if (open) {
      if (this.locked()) document.exitPointerLock();
      this.needsLock = false; this.cb.onLockPrompt?.(false);
    } else {
      this.lock();
    }
  }

  start() {
    this.running = true;
    this.lock();
    this.clock.start();
    this.applySettings();
    this.loop();
    this.announce(`FIRST TO ${KILL_GOAL}`, false);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.vmCamera) {
      this.vmCamera.aspect = w / h;
      this.vmCamera.updateProjectionMatrix();
    }
  }

  // Re-read live settings (called when the settings menu changes a value).
  applySettings() {
    this.baseFov = settings.fov;
    const fpsEl = document.getElementById('fps-meter');
    if (fpsEl) fpsEl.classList.toggle('hidden', !settings.showFps);
    for (const b of this.bots) b._difficulty = settings.difficulty;
  }

  // ---------------- spawning
  // Pick the spawn whose nearest living bot is farthest away, and face open space.
  placePlayer() {
    let best = this.spawnPoints[0], bestScore = -1;
    for (const s of this.spawnPoints) {
      let nearest = 99;
      for (const b of this.bots) if (b.alive) nearest = Math.min(nearest, b.group.position.distanceTo(s));
      const score = nearest + Math.random() * 4;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    this.pos.set(best.x, PLAYER_HEIGHT, best.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(best.x, best.z); // forward (-sin, -cos) → toward map center
    this.pitch = 0;
  }

  // Bots respawn somewhere you can't currently see, not too close.
  respawnBot(bot) {
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const p = this.nav.randomPoint();
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      let score = Math.min(d, 30);
      if (d < 14) score -= 50;
      if (!this.segmentBlocked(this._v1.set(p.x, 1.6, p.z), this.pos)) score -= 25;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    bot.respawn(best, settings.difficulty);
  }

  // ---------------- weapons
  currentSlot() { return this.slots[this.activeSlot]; }

  switchSlot(slot) {
    if (this.weapon === BLADE_STORM) return;
    if (!this.slots[slot] || slot === this.activeSlot) return;
    this.currentSlot().mag = this.mag; // stash ammo
    this.activeSlot = slot;
    this.weapon = this.slots[slot].weapon;
    this.mag = this.slots[slot].mag;
    this.reloading = false;
    this.drawUntil = this.now() + 0.38;
    this.vmDrop = 1;
    this.setGunModel(this.weapon.id);
    this.sfx.play('equip');
    this.updateHud();
  }

  // Buy a weapon (or shield) if affordable. Returns 'ok' | 'owned' | 'poor'.
  tryBuy(weapon) {
    if (!weapon) return 'poor';
    const slot = weapon.slot;
    if (this.slots[slot] && this.slots[slot].weapon.id === weapon.id) return 'owned';
    if (this.money < weapon.price) { this.sfx.play('deny'); return 'poor'; }
    this.money -= weapon.price;
    if (this.weapon === BLADE_STORM) this.endBladeStorm();
    this.currentSlot().mag = this.mag; // stash the magazine of the gun in hand
    // refund-on-swap: replacing a gun you bought this life sells it back
    const old = this.slots[slot];
    if (old && old.weapon.price && old.boughtThisLife) this.money += old.weapon.price;
    this.slots[slot] = { weapon, mag: weapon.mag, boughtThisLife: true };
    this.activeSlot = slot;
    this.weapon = weapon;
    this.mag = weapon.mag;
    this.reloading = false;
    this.vmDrop = 1;
    this.drawUntil = this.now() + 0.3;
    this.setGunModel(weapon.id);
    this.sfx.play('buy');
    this.updateHud();
    return 'ok';
  }

  // Sell back a weapon bought this life (right-click in the armory).
  trySell(weapon) {
    const s = this.slots[weapon.slot];
    if (!s || s.weapon.id !== weapon.id || !s.boughtThisLife || !weapon.price) return false;
    this.money += weapon.price;
    if (weapon.slot === 'primary') {
      this.slots.primary = null;
      if (this.activeSlot === 'primary') { this.activeSlot = 'secondary'; this.weapon = this.slots.secondary.weapon; this.mag = this.slots.secondary.mag; this.setGunModel(this.weapon.id); }
    } else {
      this.slots.secondary = { weapon: getWeapon('classic'), mag: getWeapon('classic').mag };
      if (this.activeSlot === 'secondary') { this.weapon = this.slots.secondary.weapon; this.mag = this.weapon.mag; this.setGunModel(this.weapon.id); }
    }
    this.sfx.play('equip');
    this.updateHud();
    return true;
  }

  tryBuyShield(shield) {
    if (this.armor >= shield.amount) return 'owned';
    if (this.money < shield.price) { this.sfx.play('deny'); return 'poor'; }
    this.money -= shield.price;
    this.armor = shield.amount;
    this.sfx.play('buy');
    this.updateHud();
    return 'ok';
  }

  startReload() {
    if (this.reloading || this.mag === this.weapon.mag || this.weapon === BLADE_STORM) return;
    this.reloading = true;
    this.reloadEnd = this.now() + (this.weapon.reload || 2);
    this.reloadStart = this.now();
    this.sfx.play('reload');
  }

  now() { return performance.now() / 1000; }

  tryShoot() {
    if (!this.running || this.simPaused() || this.dead || !this.locked()) return;
    const t = this.now();
    const interval = 1 / (this.weapon.fireRate * this.fireRateMult);
    if (t - this.lastShot < interval || t < this.drawUntil) return;
    if (this.reloading) return;
    if (this.mag <= 0) { this.startReload(); return; }
    this.lastShot = t;
    if (this.weapon !== BLADE_STORM) this.mag--;

    // bot hit meshes animate every frame — refresh their world matrices before raycasting
    for (const b of this.bots) if (b.alive) b.group.updateMatrixWorld(true);
    const pellets = this.weapon.pellets || 1;
    this.stats.shots++;
    let anyHit = false, anyHead = false;
    for (let i = 0; i < pellets; i++) {
      const r = this.fireRay();
      if (r) { anyHit = true; anyHead = anyHead || r === 'head'; }
    }
    if (anyHit) this.stats.hits++;
    if (anyHead) this.stats.heads++;

    this.recoilKick = Math.min(this.recoilKick + this.weapon.recoil, 0.09);
    this.bloom = Math.min(this.bloom + 1, 8);
    this.muzzle.intensity = 14;
    this.vmFlash.visible = !(this.aiming && this.weapon.scope);
    this.vmFlash.rotation.z = Math.random() * Math.PI;
    this._flashOff = t + 0.04;
    this.vmZ = -0.38;
    this.sfx.play('shot', this.weapon);
    if (this.weapon.scope && this.aiming) this.aiming = false; // operator un-scopes after a shot
    // gunfire draws attention from bots in earshot
    for (const b of this.bots) {
      if (b.alive && b.state === 'patrol' && b.group.position.distanceTo(this.pos) < 26) {
        b.state = 'hunt'; b.lastSeen = this.pos.clone().setY(0); b.lastSeenT = t; b.path = null;
      }
    }
    this.updateHud();
  }

  currentSpread() {
    const w = this.weapon;
    const moving = Math.hypot(this.vel.x, this.vel.z) > 2.2;
    const airborne = !this.onGround;
    let s = (this.aiming && w.scopedSpread !== undefined) ? w.scopedSpread : w.spread;
    if (this.aiming && !w.scope) s *= 0.65;
    if (moving) s = s * 2.4 + 0.01;
    if (airborne) s = s * 3 + 0.04;
    return s + this.bloom * w.recoil * 0.25;
  }

  // Returns 'head' | 'body' | 'legs' if a bot was hit, else null.
  fireRay() {
    const spread = this.currentSpread();
    const dir = this._v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const jit = this._v2.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, 0).applyQuaternion(this.camera.quaternion);
    dir.add(jit).normalize();

    this.raycaster.set(this.camera.getWorldPosition(this._v3), dir);
    this.raycaster.near = 0; this.raycaster.far = 200;
    const targets = this._rayTargets; targets.length = 0;
    for (let i = 0; i < this.shootables.length; i++) targets.push(this.shootables[i]);
    for (const b of this.bots) if (b.alive) for (const m of b.hitMeshes) targets.push(m);
    const hits = this.raycaster.intersectObjects(targets, false);
    const hit = hits[0];

    const end = hit ? hit.point : this.raycaster.ray.at(120, this._v2);
    this.spawnTracer(this.muzzleWorld(), end);

    if (hit && hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const mult = part === 'head' ? this.weapon.head : part === 'legs' ? LEG_MULT : 1;
      const dmg = Math.round(this.weapon.dmg * mult);
      const dealt = Math.min(dmg, Math.max(0, bot.hp));
      const killed = bot.damage(dmg, this.pos, part);
      this.stats.damage += dealt;
      this.spawnSparks(hit.point, part === 'head' ? 10 : 6);
      this.spawnDamageNumber(hit.point, dmg, part === 'head', killed);
      this.showHitmarker(killed, part === 'head');
      this.sfx.play(killed ? 'kill' : part === 'head' ? 'headshot' : 'hit');
      if (killed) this.onKill(bot, part === 'head');
      return part;
    }
    if (hit) this.spawnImpact(hit.point);
    return null;
  }

  // Tracer origin: approximate on-screen muzzle position in world space.
  muzzleWorld() {
    const p = this.camera.getWorldPosition(new THREE.Vector3());
    const off = this.aiming ? new THREE.Vector3(0, -0.05, -0.3) : new THREE.Vector3(0.16, -0.12, -0.45);
    return p.add(off.applyQuaternion(this.camera.quaternion));
  }

  onKill(bot, headshot) {
    this.kills++;
    this.ultPoints = Math.min(this.ultPoints + 1, this.agent.abilities.X.pts);
    const reward = 200 + (headshot ? 100 : 0);
    this.money = Math.min(this.money + reward, MAX_CREDITS);
    this.cb.onReward?.(reward, headshot);
    this.addShake(headshot ? 0.05 : 0.035, 0.16);
    const now = this.now();
    this.killStreak = (now - this.lastKillTime < 4.5) ? this.killStreak + 1 : 1;
    this.lastKillTime = now;
    if (this.killStreak >= 2) {
      this.sfx.play('streak', this.killStreak);
      this.cb.onStreak?.(this.killStreak);
    }
    this.cb.onKillFeed('YOU', bot.name, headshot, false, this.weapon.name);
    this.cb.onScore(this.kills, this.deaths);
    this.updateHud();
    if (this.kills >= KILL_GOAL) this.endMatch(true);
  }

  spawnTracer(from, to, enemy = false) {
    let line = this.tracerPool.pop();
    if (!line) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(geo, this.tracerMat);
      line.frustumCulled = false;
      this.scene.add(line);
    }
    line.material = enemy ? this.enemyTracerMat : this.tracerMat;
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    line.visible = true;
    this.effects.push({ mesh: line, until: this.now() + (enemy ? 0.07 : 0.05), pool: this.tracerPool });
  }

  spawnImpact(point) {
    let m = this.impactPool.pop();
    if (!m) { m = new THREE.Mesh(this.impactGeo, this.impactMat); this.scene.add(m); }
    m.position.copy(point);
    m.visible = true;
    this.effects.push({ mesh: m, until: this.now() + 0.18, pool: this.impactPool });
  }

  // Little burst of red sparks where a bullet hits a soldier.
  spawnSparks(point, n) {
    for (let i = 0; i < n; i++) {
      let m = this.sparkPool.pop();
      if (!m) { m = new THREE.Mesh(this.sparkGeo, this.sparkMat); this.scene.add(m); }
      m.position.copy(point);
      m.visible = true;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3);
      this.sparks.push({ mesh: m, vel: v, until: this.now() + 0.25 + Math.random() * 0.2 });
    }
  }

  spawnDamageNumber(point, dmg, head, killed) {
    if (!settings.damageNumbers || !this.dmgNumEl) return;
    const el = document.createElement('div');
    el.className = `dmg-num${head ? ' head' : ''}${killed ? ' kill' : ''}`;
    el.textContent = dmg;
    this.dmgNumEl.appendChild(el);
    this.dmgNums.push({ el, pos: point.clone(), born: this.now(), dx: (Math.random() - 0.5) * 30 });
    if (this.dmgNums.length > 24) this.dmgNums.shift().el.remove();
  }

  updateDamageNumbers(t) {
    const w = innerWidth, h = innerHeight;
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      const age = t - d.born;
      if (age > 0.75) { d.el.remove(); this.dmgNums.splice(i, 1); continue; }
      const v = this._v1.copy(d.pos).project(this.camera);
      if (v.z > 1) { d.el.style.opacity = 0; continue; }
      const x = (v.x * 0.5 + 0.5) * w + d.dx * age, y = (-v.y * 0.5 + 0.5) * h - age * 70;
      d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${age < 0.08 ? 1.35 : 1})`;
      d.el.style.opacity = age > 0.5 ? (0.75 - age) / 0.25 : 1;
    }
  }

  showHitmarker(kill, head) {
    const hm = document.getElementById('hitmarker');
    hm.classList.remove('show', 'kill', 'head');
    void hm.offsetWidth; // restart animation
    hm.classList.add('show');
    if (kill) hm.classList.add('kill');
    else if (head) hm.classList.add('head');
  }

  // ---------------- abilities
  useAbility(slot) {
    const ab = this.agent.abilities[slot];
    if (!ab) return;
    const t = this.now();
    if (slot === 'X') {
      if (this.ultPoints < ab.pts) return;
      this.ultPoints = 0;
      this.castUlt();
      this.sfx.play('ability');
      this.updateHud();
      return;
    }
    const st = this.abilityState[slot];
    if (st.count <= 0) return;
    const used = this.castBasic(slot);
    if (used === false) return; // e.g. placing Yoru's tether is free
    st.count--;
    st.pending.push(t + ab.cd);
    st.pending.sort((a, b) => a - b);
    this.cooldowns[slot] = st.pending[0];
    this.sfx.play('ability');
    this.updateHud();
  }

  updateAbilityCharges(t) {
    for (const slot of ['C', 'Q', 'E']) {
      const st = this.abilityState[slot];
      if (!st) continue;
      while (st.pending.length && st.pending[0] <= t) { st.pending.shift(); st.count = Math.min(st.count + 1, st.max); }
      this.cooldowns[slot] = st.pending.length ? st.pending[0] : 0;
    }
  }

  aimDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); }

  aimPoint(maxDist = 60) {
    this.raycaster.set(this.camera.getWorldPosition(this._v3), this.aimDir());
    this.raycaster.near = 0; this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObjects(this.shootables, false);
    return hits[0] ? hits[0].point.clone() : this.raycaster.ray.at(maxDist, new THREE.Vector3());
  }

  castBasic(slot) {
    const id = this.agent.id;
    if (id === 'jett') {
      if (slot === 'C') this.spawnSmoke(this.aimPoint(24), 3.2, 5, 0x9ad7e8);
      if (slot === 'Q') { this.vel.y = 11; this.onGround = false; }
      if (slot === 'E') {
        const move = this.moveInputDir();
        const dir = move.lengthSq() > 0 ? move : this.flatAimDir();
        this.vel.x = dir.x * 26; this.vel.z = dir.z * 26;
        this.dashUntil = this.now() + 0.16;
      }
    } else if (id === 'raze') {
      if (slot === 'C') {
        const d = this.flatAimDir();
        this.vel.x += d.x * 14; this.vel.z += d.z * 14; this.vel.y = 9;
        this.onGround = false;
        this.sfx.play('boom');
        this.spawnExplosionVfx(this.pos.clone().setY(0.3), 1.6, 0xf5a04b);
      }
      if (slot === 'Q') this.throwProjectile({ speed: 22, arc: 6, radius: 4.5, dmg: 80, color: 0xf5a04b });
      if (slot === 'E') this.deployBoomBot();
    } else if (id === 'yoru') {
      if (slot === 'C') this.deployDecoy();
      if (slot === 'Q') this.throwFlash();
      if (slot === 'E') {
        if (this.gateMarker) {
          this.pos.copy(this.gateMarker.position).setY(PLAYER_HEIGHT);
          this.scene.remove(this.gateMarker);
          this.gateMarker = null;
          this.spawnExplosionVfx(this.pos.clone().setY(0.3), 1.4, 0x7d8cff);
        } else {
          const marker = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 24), new THREE.MeshBasicMaterial({ color: 0x7d8cff }));
          marker.position.copy(this.pos).setY(0.4);
          marker.rotation.x = Math.PI / 2;
          this.scene.add(marker);
          this.gateMarker = marker;
          this.cb.onAnnounce('TETHER PLACED — PRESS E TO TELEPORT', false);
          return false;
        }
      }
    } else if (id === 'brimstone') {
      if (slot === 'C') this.zones.push({ pos: this.pos.clone().setY(0), r: 4, buff: 'stim', until: this.now() + 8, mesh: this.spawnZoneVfx(this.pos.clone().setY(0.05), 4, 0xf5b945) });
      if (slot === 'Q') this.throwProjectile({ speed: 18, arc: 7, radius: 3.4, dmg: 0, molly: true, color: 0xe8744b });
      if (slot === 'E') this.spawnSmoke(this.aimPoint(80).setY(1.6), 3.6, 7, 0xe8744b);
    } else if (id === 'sova') {
      if (slot === 'C') this.deployDrone();
      if (slot === 'Q') this.throwProjectile({ speed: 30, arc: 2.5, radius: 3.4, dmg: 60, color: 0x6fd0f0 });
      if (slot === 'E') {
        this.reveal.until = this.now() + 6;
        for (const b of this.bots) if (b.alive) b.setRevealed(true);
        this.spawnExplosionVfx(this.aimPoint(80), 2, 0x6fd0f0);
        this.cb.onAnnounce('ENEMIES REVEALED', false);
      }
    }
  }

  castUlt() {
    const id = this.agent.id;
    if (id === 'jett') {
      this.currentSlot().mag = this.mag;
      this.preUlt = this.activeSlot;
      this.weapon = BLADE_STORM;
      this.mag = Infinity;
      this.reloading = false;
      this.ultActiveUntil = this.now() + 12;
      this.cb.onAnnounce('BLADE STORM', true);
    } else if (id === 'raze') {
      this.throwProjectile({ speed: 34, arc: 0.5, radius: 8, dmg: 250, color: 0xff4655, big: true });
      this.cb.onAnnounce('FIRE IN THE HOLE', true);
    } else if (id === 'yoru') {
      this.invisible = true;
      this.ultActiveUntil = this.now() + 8;
      document.getElementById('ult-overlay').classList.add('yoru');
      this.cb.onAnnounce('DIMENSIONAL DRIFT', true);
    } else if (id === 'brimstone') {
      const target = this.aimPoint(100).setY(0);
      this.zones.push({ pos: target, r: 7, dps: 80, until: this.now() + 4, hostileToBots: true, mesh: this.spawnZoneVfx(target.clone().setY(0.06), 7, 0xff4655) });
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(7, 7, 60, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff4655, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
      );
      beam.position.copy(target).setY(30);
      this.scene.add(beam);
      this.effects.push({ mesh: beam, until: this.now() + 4 });
      this.sfx.play('boom');
      this.cb.onAnnounce('ORBITAL STRIKE', true);
    } else if (id === 'sova') {
      this.cb.onAnnounce("HUNTER'S FURY", true);
      let shots = 0;
      const fire = () => {
        if (shots++ >= 3 || !this.running) return;
        const origin = this.camera.getWorldPosition(new THREE.Vector3());
        const dir = this.aimDir();
        for (const b of this.bots) {
          if (!b.alive) continue;
          const toBot = b.group.position.clone().setY(origin.y).sub(origin);
          const along = toBot.dot(dir);
          if (along < 0) continue;
          const perp = toBot.sub(dir.clone().multiplyScalar(along)).length();
          if (perp < 2.2 && b.damage(130, this.pos)) this.onKill(b, false);
        }
        const beamEnd = origin.clone().add(dir.clone().multiplyScalar(90));
        const geo = new THREE.BufferGeometry().setFromPoints([origin.clone().add(new THREE.Vector3(0, -0.1, 0)), beamEnd]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6fd0f0 }));
        this.scene.add(line);
        this.effects.push({ mesh: line, until: this.now() + 0.4 });
        this.sfx.play('boom');
        if (shots < 3) setTimeout(fire, 700);
      };
      fire();
    }
  }

  endBladeStorm() {
    if (this.weapon !== BLADE_STORM) return;
    this.activeSlot = this.slots[this.preUlt] ? this.preUlt : 'secondary';
    this.weapon = this.currentSlot().weapon;
    this.mag = this.currentSlot().mag;
    this.ultActiveUntil = 0;
    this.setGunModel(this.weapon.id);
  }

  moveInputDir() {
    const f = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    const s = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    if (!f && !s) return new THREE.Vector3();
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    return new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s).normalize();
  }

  flatAimDir() {
    const d = this.aimDir(); d.y = 0;
    return d.lengthSq() > 0 ? d.normalize() : new THREE.Vector3(0, 0, -1);
  }

  spawnSmoke(point, radius, duration, color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 20),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.82, roughness: 1, depthWrite: false })
    );
    m.position.copy(point).setY(Math.max(point.y, radius * 0.55));
    this.scene.add(m);
    this.effects.push({ mesh: m, until: this.now() + duration, smoke: true });
  }

  spawnZoneVfx(point, radius, color) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.5, 28, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    m.position.copy(point).setY(0.25);
    this.scene.add(m);
    return m;
  }

  spawnExplosionVfx(point, radius, color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 14, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 })
    );
    m.position.copy(point);
    this.scene.add(m);
    this.effects.push({ mesh: m, until: this.now() + 0.35, grow: true });
  }

  throwProjectile({ speed, arc, radius, dmg, color, molly = false, big = false }) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(big ? 0.3 : 0.16, 10, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 })
    );
    m.position.copy(this.camera.getWorldPosition(new THREE.Vector3())).add(this.aimDir().multiplyScalar(0.6));
    this.scene.add(m);
    const vel = this.aimDir().multiplyScalar(speed);
    vel.y += arc;
    this.projectiles.push({ mesh: m, vel, radius, dmg, molly, color });
  }

  deployBoomBot() {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xf5a04b, emissive: 0xf5a04b, emissiveIntensity: 1 })
    );
    m.position.copy(this.pos).setY(0.32).add(this.flatAimDir().multiplyScalar(1));
    this.scene.add(m);
    this.projectiles.push({ mesh: m, vel: this.flatAimDir().multiplyScalar(7), radius: 4, dmg: 110, ground: true, color: 0xf5a04b, fuse: this.now() + 6 });
  }

  // Fakeout: a blue friendly soldier that jogs forward and draws enemy fire.
  deployDecoy() {
    const rig = new SoldierRig(0, 'ally');
    const dir = this.flatAimDir();
    const base = this.pos.clone().add(dir.clone().multiplyScalar(1.2));
    rig.root.position.set(base.x, 0, base.z);
    rig.root.rotation.y = Math.atan2(dir.x, dir.z);
    this.scene.add(rig.root);
    this.effects.push({ mesh: rig.root, rig, until: this.now() + 6, decoy: true, vel: dir.multiplyScalar(3.2) });
  }

  deployDrone() {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshStandardMaterial({ color: 0x6fd0f0, emissive: 0x6fd0f0, emissiveIntensity: 1.2 })
    );
    m.position.copy(this.pos).setY(2.2);
    this.scene.add(m);
    this.effects.push({ mesh: m, until: this.now() + 5, drone: true, vel: this.flatAimDir().multiplyScalar(6) });
  }

  throwFlash() {
    const point = this.aimPoint(20);
    this.spawnExplosionVfx(point, 1, 0xffffff);
    for (const b of this.bots) {
      if (b.alive && b.group.position.distanceTo(point) < 14) b.flashUntil = this.now() + 3.2;
    }
    this.cb.onAnnounce('ENEMIES BLINDED', false);
  }

  // ---------------- perception helpers (used by bots)
  segmentBlocked(from, to, withSmokes = true) {
    const dir = this._v2.copy(to).sub(from);
    const dist = dir.length();
    if (dist < 0.01) return false;
    dir.divideScalar(dist);
    this.raycaster.set(from, dir);
    this.raycaster.near = 0; this.raycaster.far = dist;
    const targets = this._losTargets; targets.length = 0;
    for (let i = 0; i < this.wallBlockers.length; i++) targets.push(this.wallBlockers[i]);
    if (withSmokes) for (const e of this.effects) if (e.smoke) targets.push(e.mesh);
    return this.raycaster.intersectObjects(targets, false).length > 0;
  }

  botCanSee(bot) {
    const eye = this._v3.copy(bot.group.position); eye.y = 1.6;
    return !this.segmentBlocked(eye, this.pos);
  }

  visibleDecoy(bot) {
    for (const e of this.effects) {
      if (!e.decoy) continue;
      const p = e.mesh.position;
      if (p.distanceTo(bot.group.position) > 35) continue;
      const eye = this._v3.copy(bot.group.position); eye.y = 1.6;
      const target = new THREE.Vector3(p.x, 1.3, p.z);
      if (!this.segmentBlocked(eye, target)) { this._decoyAim = target; return target; }
    }
    return null;
  }
  decoyAimPoint() { return this._decoyAim || this.pos; }

  // ---------------- damage to player
  hurt(amount, source = null, headshot = false) {
    if (this.dead || this.invisible || this.ended) return;
    // shields absorb 2/3 of each hit until depleted
    const absorbed = Math.min(this.armor, Math.round(amount * 0.66));
    this.armor -= absorbed;
    this.hp -= (amount - absorbed);
    const v = document.getElementById('damage-vignette');
    v.style.opacity = 1;
    clearTimeout(this._vt);
    this._vt = setTimeout(() => (v.style.opacity = 0), 280);
    this.addShake(Math.min(0.03 + amount * 0.003, 0.1), 0.25);
    this.sfx.play('hurt');
    if (source) this.showDamageArrow(source.group.position);
    if (this.hp <= 0) this.die(source, headshot);
    this.updateHud();
  }

  showDamageArrow(from) {
    if (!this.dmgArrowEl) return;
    const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
    // angle relative to view: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const fwd = -Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz;
    const right = Math.cos(this.yaw) * dx - Math.sin(this.yaw) * dz;
    const ang = Math.atan2(right, fwd) * 180 / Math.PI;
    const el = document.createElement('div');
    el.className = 'dmg-arrow';
    el.style.transform = `rotate(${ang}deg)`;
    this.dmgArrowEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  die(killer, headshot) {
    this.dead = true;
    this.deaths++;
    this.killStreak = 0;
    this.deadUntil = this.now() + RESPAWN_DELAY;
    this.mouseDown = false; this.aiming = false;
    // pointer lock stays — respawning needs no click
    if (killer) killer.kills++;
    const name = killer ? killer.name : 'THE VOID';
    this.cb.onDeath?.(name, headshot, RESPAWN_DELAY);
    this.cb.onKillFeed(name, 'YOU', headshot, true, 'VANDAL');
    this.cb.onScore(this.kills, this.deaths);
    if (this.deaths >= KILL_GOAL) this.endMatch(false);
  }

  respawnPlayer() {
    this.dead = false;
    this.hp = 100; this.armor = 0;
    this.placePlayer();
    // weapons are kept between lives; ammo refilled
    if (this.weapon === BLADE_STORM) this.endBladeStorm();
    for (const s of Object.values(this.slots)) if (s) { s.mag = s.weapon.mag; s.boughtThisLife = false; }
    this.mag = this.weapon.mag;
    this.reloading = false;
    this.cb.onRespawn?.();
    this.updateHud();
  }

  endMatch(won) {
    if (this.ended) return;
    this.ended = true;
    this.mouseDown = false;
    if (this.locked()) document.exitPointerLock();
    this.cb.onMatchEnd?.({
      won, kills: this.kills, deaths: this.deaths,
      acc: this.stats.shots ? Math.round(this.stats.hits / this.stats.shots * 100) : 0,
      hs: this.stats.hits ? Math.round(this.stats.heads / this.stats.hits * 100) : 0,
      damage: this.stats.damage,
      time: MATCH_TIME - this.matchTime,
    });
  }

  scoreRows() {
    const rows = [{ name: 'YOU', agent: this.agent.name, k: this.kills, d: this.deaths, you: true }];
    for (const b of this.bots) rows.push({ name: b.name, agent: 'BOT', k: b.kills, d: b.deaths });
    return rows;
  }

  // ---------------- per-frame
  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.now();

    if (!this.simPaused()) {
      this.matchTime -= dt;
      if (this.matchTime <= 0) { this.matchTime = 0; this.endMatch(this.kills > this.deaths); }
      if (this.dead) {
        if (t >= this.deadUntil) this.respawnPlayer();
      } else {
        this.updatePlayer(dt, t);
      }
      this.sfx.listener = { pos: this.pos, yaw: this.yaw };
      for (const b of this.bots) b.update(dt, t, this);
      this.updateProjectiles(dt, t);
      this.updateEffects(dt, t);
      this.updateSparks(dt, t);
      this.updateZones(dt, t);
      this.updateUltState(t);
      this.updateAbilityCharges(t);
      if (this.mouseDown && this.weapon.auto) this.tryShoot();
      if (this.reloading && t >= this.reloadEnd) {
        this.reloading = false; this.mag = this.weapon.mag; this.updateHud();
      }
      if (t - this.lastShot > 0.25) this.bloom = Math.max(0, this.bloom - dt * 18);
      this.cb.onClock?.(this.matchTime);
    }

    // camera
    this.camera.position.copy(this.pos);
    if (this.dead) this.camera.position.y = 0.6 + Math.max(0, this.deadUntil - t - (RESPAWN_DELAY - 0.4)) * 2.75; // slump to the floor
    this._euler.set(this.pitch + this.recoilKick, this.yaw, this.dead ? 0.35 : 0);
    this.camera.quaternion.setFromEuler(this._euler);
    if (!settings.reducedMotion && t < this.shake.until) {
      const k = this.shake.power * (this.shake.until - t) / this.shake.dur;
      this.camera.translateX((Math.random() - 0.5) * k);
      this.camera.translateY((Math.random() - 0.5) * k);
    }
    // ADS: zoom FOV + center the gun
    const wantAds = this.aiming && !this.dead && !this.reloading && !this.simPaused() ? 1 : 0;
    this.adsT += (wantAds - this.adsT) * Math.min(1, dt * 14);
    const fovMul = 1 + ((this.weapon.zoom || 1) - 1) * this.adsT;
    const fov = this.baseFov * fovMul;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const scoped = !!this.weapon.scope && this.adsT > 0.85;
    this.cb.onScope?.(scoped);
    document.getElementById('crosshair').classList.toggle('hidden', scoped || this.dead);

    this.recoilKick = Math.max(0, this.recoilKick - dt * 0.35);
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 160);
    if (this._flashOff && t > this._flashOff) { this.vmFlash.visible = false; this._flashOff = 0; }
    this.vmZ += (-0.45 - this.vmZ) * dt * 14;
    this.vmDrop = Math.max(0, (this.vmDrop || 0) - dt * 3.2);
    const speed2d = Math.hypot(this.vel.x, this.vel.z);
    this._bob = (this._bob || 0) + dt * speed2d * 1.6;
    const bobY = Math.sin(this._bob) * 0.006 * Math.min(speed2d, 6) * (1 - this.adsT * 0.8);
    const reloadDip = this.reloading ? Math.sin(Math.min(1, (t - this.reloadStart) / (this.weapon.reload || 2)) * Math.PI) : 0;
    const ax = 0.26 * (1 - this.adsT), ay = -0.22 + 0.075 * this.adsT;
    this.viewmodel.position.set(ax, ay + bobY - this.vmDrop * 0.25 - reloadDip * 0.12, this.vmZ);
    this.viewmodel.rotation.set(reloadDip * 0.6 - this.vmDrop * 0.5, 0, reloadDip * 0.35);
    this.viewmodel.visible = !this.dead && !scoped;

    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.autoClear = false;
    this.renderer.render(this.vmScene, this.vmCamera);
    this.renderer.autoClear = true;

    this.updateDamageNumbers(t);
    if (settings.showFps) this.tickFps(dt);
  }

  addShake(power, dur = 0.32) {
    if (settings.reducedMotion) return;
    const t = this.now();
    if (t < this.shake.until && this.shake.power > power) return;
    this.shake = { until: t + dur, power, dur };
  }

  tickFps(dt) {
    this._fpsAcc = (this._fpsAcc || 0) + dt;
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    if (this._fpsAcc >= 0.5) {
      const el = document.getElementById('fps-meter');
      if (el) el.textContent = `${Math.round(this._fpsFrames / this._fpsAcc)} FPS`;
      this._fpsAcc = 0; this._fpsFrames = 0;
    }
  }

  updatePlayer(dt, t) {
    const walk = this.keys.ShiftLeft || this.keys.ShiftRight;
    let speed = walk ? 3.1 : 6.2;
    if (this.adsT > 0.5) speed *= this.weapon.scope ? 0.55 : 0.78;
    const move = this.moveInputDir();
    const dashing = this.dashUntil && t < this.dashUntil;

    if (!dashing) {
      const k = this.onGround ? Math.min(1, dt * 12) : Math.min(1, dt * 1.6);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
      if (this.onGround && move.lengthSq() === 0) { this.vel.x *= Math.pow(0.0001, dt); this.vel.z *= Math.pow(0.0001, dt); }
    }

    if (this.keys.Space && this.onGround) { this.vel.y = 7.4; this.onGround = false; }
    this.vel.y -= GRAVITY * dt;

    // integrate + collide per axis
    const next = this._v3.copy(this.pos);
    next.x += this.vel.x * dt;
    if (this.collides(next)) { next.x = this.pos.x; this.vel.x = 0; }
    next.z += this.vel.z * dt;
    if (this.collides(next)) { next.z = this.pos.z; this.vel.z = 0; }
    next.y += this.vel.y * dt;
    if (next.y < PLAYER_HEIGHT) { next.y = PLAYER_HEIGHT; this.vel.y = 0; this.onGround = true; }
    else if (this.collides(next)) {
      if (this.vel.y < 0) this.onGround = true;
      next.y = this.pos.y; this.vel.y = 0;
    } else {
      this.onGround = next.y <= PLAYER_HEIGHT + 0.001;
    }
    this.pos.copy(next);

    this.pos.x = Math.max(-28.6, Math.min(28.6, this.pos.x));
    this.pos.z = Math.max(-28.6, Math.min(28.6, this.pos.z));
  }

  collides(p) {
    const me = this._collBox;
    me.min.set(p.x - PLAYER_RADIUS, p.y - PLAYER_HEIGHT, p.z - PLAYER_RADIUS);
    me.max.set(p.x + PLAYER_RADIUS, p.y + 0.1, p.z + PLAYER_RADIUS);
    return this.colliders.some((c) => c.intersectsBox(me));
  }

  updateProjectiles(dt, t) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.ground) {
        p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
        p.mesh.rotation.x += dt * 8;
        const prey = this.bots.find((b) => b.alive && b.group.position.distanceTo(p.mesh.position) < 6);
        if (prey) {
          const d = prey.group.position.clone().sub(p.mesh.position).setY(0).normalize();
          p.vel.lerp(d.multiplyScalar(7), 0.12);
        }
        const boom = (prey && prey.group.position.distanceTo(p.mesh.position) < 1.2) || t > p.fuse
          || !this.nav.walkable(p.mesh.position.x, p.mesh.position.z);
        if (boom) { this.explode(p); this.projectiles.splice(i, 1); }
        continue;
      }
      p.vel.y -= GRAVITY * 0.55 * dt;
      p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
      if (p.mesh.position.y <= 0.15 || this.pointInWall(p.mesh.position)) {
        this.explode(p);
        this.projectiles.splice(i, 1);
      }
    }
  }

  pointInWall(point) {
    return this.colliders.some((c) => c.containsPoint(point));
  }

  explode(p) {
    this.sfx.playAt('boom', p.mesh.position);
    this.spawnExplosionVfx(p.mesh.position.clone(), p.radius * 0.6, p.color);
    const pd = this.pos.distanceTo(p.mesh.position);
    if (pd < 18) this.addShake(Math.min(0.22, (1 - pd / 18) * 0.26), 0.45);
    this.scene.remove(p.mesh);
    if (p.molly) {
      this.zones.push({ pos: p.mesh.position.clone().setY(0), r: p.radius, dps: 30, until: this.now() + 5, hostileToBots: true, mesh: this.spawnZoneVfx(p.mesh.position.clone().setY(0.06), p.radius, 0xe8744b) });
      return;
    }
    for (const b of this.bots) {
      if (!b.alive) continue;
      const d = b.group.position.distanceTo(p.mesh.position);
      if (d < p.radius) {
        const dmg = Math.round(p.dmg * (1 - d / p.radius * 0.6));
        if (b.damage(dmg, this.pos)) this.onKill(b, false);
      }
    }
  }

  updateEffects(dt, t) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.grow) e.mesh.scale.addScalar(dt * 4);
      if (e.grow && e.mesh.material && e.mesh.material.transparent) e.mesh.material.opacity = Math.max(0, e.mesh.material.opacity - dt * 2);
      if (e.decoy && e.vel) {
        const p = e.mesh.position;
        const nx = p.x + e.vel.x * dt, nz = p.z + e.vel.z * dt;
        const moving = this.nav.walkable(nx, nz);
        if (moving) { p.x = nx; p.z = nz; }
        e.rig.animate(dt, { fwd: moving ? 3.2 : 0, side: 0, aimTarget: 0.6, pitch: 0 });
      }
      if (e.drone && e.vel) {
        e.mesh.position.add(e.vel.clone().multiplyScalar(dt));
        e.mesh.rotation.y += dt * 6;
        for (const b of this.bots) {
          if (b.alive && b.group.position.distanceTo(e.mesh.position) < 8) b.setRevealed(true);
        }
      }
      if (t >= e.until) {
        if (e.drone) for (const b of this.bots) { if (this.reveal.until < t) b.setRevealed(false); }
        if (e.pool) { e.mesh.visible = false; e.pool.push(e.mesh); }
        else this.scene.remove(e.mesh);
        this.effects.splice(i, 1);
      }
    }
    if (this.reveal.until && this.reveal.until < t && !this.effects.some((e) => e.drone)) {
      for (const b of this.bots) b.setRevealed(false);
      this.reveal.until = 0;
    }
  }

  updateSparks(dt, t) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (t >= s.until || s.mesh.position.y < 0) {
        s.mesh.visible = false; this.sparkPool.push(s.mesh); this.sparks.splice(i, 1);
      }
    }
  }

  updateZones(dt, t) {
    this.fireRateMult = 1;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (t >= z.until) {
        if (z.mesh) this.scene.remove(z.mesh);
        this.zones.splice(i, 1);
        continue;
      }
      if (z.buff === 'stim' && this._v1.copy(this.pos).setY(0).distanceTo(z.pos) < z.r) this.fireRateMult = 1.8;
      if (z.dps && z.hostileToBots) {
        for (const b of this.bots) {
          if (b.alive && this._v1.copy(b.group.position).setY(0).distanceTo(z.pos) < z.r) {
            if (b.damage(z.dps * dt)) this.onKill(b, false);
          }
        }
      }
    }
  }

  updateUltState(t) {
    if (this.ultActiveUntil && t >= this.ultActiveUntil) {
      this.ultActiveUntil = 0;
      if (this.weapon === BLADE_STORM) this.endBladeStorm();
      if (this.invisible) {
        this.invisible = false;
        document.getElementById('ult-overlay').classList.remove('yoru');
      }
      this.updateHud();
    }
  }

  // ---------------- HUD
  announce(text, red) { this.cb.onAnnounce(text, red); }

  updateHud() {
    document.getElementById('hp-num').textContent = Math.max(0, Math.ceil(this.hp));
    const fill = document.getElementById('hp-fill');
    fill.style.width = `${Math.max(0, this.hp)}%`;
    fill.classList.toggle('low', this.hp <= 35);
    document.getElementById('armor-fill').style.width = `${Math.max(0, this.armor) * 2}%`;
    document.getElementById('armor-num').textContent = this.armor > 0 ? Math.ceil(this.armor) : '';
    document.getElementById('weapon-name').textContent = this.weapon.name;
    document.getElementById('ammo-mag').textContent = this.weapon === BLADE_STORM ? '∞' : this.mag;
    document.getElementById('ammo-mag').classList.toggle('low', this.weapon !== BLADE_STORM && this.mag <= Math.ceil(this.weapon.mag * 0.25));
    this.cb.onAbilityHud(this.abilityState, this.ultPoints, this.now());
    this.cb.onMoney?.(this.money, this.slots, this.armor);
    this.cb.onSlots?.(this.slots, this.activeSlot, this.weapon === BLADE_STORM);
  }
}
