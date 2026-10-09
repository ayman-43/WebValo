// Model registry + loader.
// First-person weapon models stream at runtime from jsDelivr (CC0) so the repo
// keeps zero binary assets. Everything degrades gracefully: a failed load
// returns null and the engine falls back to its procedural gun.
//
// Source (CC0 / public domain): Quaternius "Modular Sci-Fi Guns"
// (via trebeljahr/quaternius-showcase). Enemy soldiers are procedural — see enemy.js.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GH = 'https://cdn.jsdelivr.net/gh';
const GUNS = `${GH}/trebeljahr/quaternius-showcase/public/glb/modular_sci_fi_guns_pack`;

// Per-weapon gun model. Each model is bbox-normalized at load (robust to the
// pack's unknown intrinsic scale) so `len` is the target longest-axis length in
// viewmodel-local units; bigger guns just get a bigger len. Orientation is a
// fixed pack rotation (barrel toward -Z) plus the mount offset below.
const PACK_ROT = [0, Math.PI / 2, 0]; // Quaternius guns model along X with the muzzle at +X → rotate muzzle to -Z
const MOUNT_POS = [0, -0.02, -0.02]; // grip offset inside the viewmodel
export const WEAPON_MODELS = {
  classic:  { file: 'Pistol_1.glb', len: 0.34 },
  shorty:   { file: 'Pistol_2.glb', len: 0.32 },
  sheriff:  { file: 'Pistol_3.glb', len: 0.36 },
  spectre:  { file: 'SMG_1.glb',    len: 0.46 },
  bulldog:  { file: 'AR_2.glb',     len: 0.56 },
  phantom:  { file: 'AR_5.glb',     len: 0.58 },
  vandal:   { file: 'AR_1.glb',     len: 0.58 },
  operator: { file: 'Sniper_1.glb', len: 0.66 },
  odin:     { file: 'AR_6.glb',     len: 0.62 },
};

// ---------------------------------------------------------------- loader
const loader = new GLTFLoader();
const cache = new Map(); // url -> Promise<gltf | null>

function load(url) {
  if (!cache.has(url)) {
    cache.set(url, loader.loadAsync(url).catch((e) => {
      console.warn('[models] failed to load', url, e?.message || e);
      return null; // graceful: callers fall back to procedural shapes
    }));
  }
  return cache.get(url);
}

// Preloads every model a match needs and hands back synchronous accessors.
export async function preloadMatch(onProgress) {
  const gunFiles = [...new Set(Object.values(WEAPON_MODELS).map((w) => w.file))];
  const jobs = gunFiles.map((f) => `${GUNS}/${f}`);

  let done = 0;
  await Promise.all(jobs.map((u) => load(u).then((r) => { onProgress?.(++done / jobs.length); return r; })));

  return {
    // Fresh oriented gun group for a weapon id (null → procedural fallback).
    async gun(weaponId) {
      const spec = WEAPON_MODELS[weaponId];
      if (!spec) return null;
      const gltf = await load(`${GUNS}/${spec.file}`);
      if (!gltf) return null;
      const model = gltf.scene.clone(true);
      model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });

      // Normalize: recenter to origin, scale longest axis to `len`.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;
      model.position.sub(center);

      const inner = new THREE.Group();   // applies normalized scale
      inner.add(model);
      inner.scale.setScalar((spec.len || 0.5) / longest);

      const mount = new THREE.Group();   // applies orientation + grip offset
      mount.add(inner);
      mount.rotation.fromArray(spec.rot || PACK_ROT);
      mount.position.fromArray(spec.pos || MOUNT_POS);
      return mount;
    },
  };
}
