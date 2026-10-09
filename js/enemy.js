// Enemy soldiers — procedurally built, procedurally animated, and honest.
//
// Every visible body part is its own mesh AND its own hitbox, so what you see
// is exactly what you can shoot: no invisible capsules drifting away from the
// model. Parts are tagged head / body / legs for damage multipliers.
//
// The rig is a plain Object3D hierarchy (hips → legs/knees, spine → head/arms)
// driven by code: a speed-matched walk cycle, two-bone IK that keeps both hands
// on the rifle, aim pitch, recoil, hit flinches and a gravity-eased death fall.

import * as THREE from 'three';

export const ENEMY_RED = 0xff4655;
const DOWN = new THREE.Vector3(0, -1, 0);

// ---------------------------------------------------------------- geometry
// Shared across all soldiers — only materials are per-instance.
let G = null;
function geo() {
  if (G) return G;
  // limb segments hang from their joint (top at the pivot, extending down -Y)
  const limb = (rt, rb, h, seg = 9) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, -h / 2, 0);
  const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  G = {
    thigh: limb(0.1, 0.08, 0.44),
    shin: limb(0.076, 0.06, 0.44),
    kneePad: box(0.115, 0.12, 0.05, 0, -0.02, 0.075),
    boot: box(0.135, 0.1, 0.27, 0, -0.05, 0.04),
    pelvis: box(0.36, 0.18, 0.23),
    belt: box(0.38, 0.05, 0.25),
    torso: box(0.41, 0.46, 0.25, 0, 0.23, 0),
    chest: box(0.44, 0.31, 0.08, 0, 0.3, 0.14),
    pouch: box(0.1, 0.09, 0.05),
    pack: box(0.32, 0.36, 0.13, 0, 0.27, -0.185),
    collar: box(0.24, 0.07, 0.2, 0, 0.47, 0),
    neck: limb(0.055, 0.06, 0.08).translate(0, 0.08, 0),
    head: new THREE.SphereGeometry(0.112, 14, 12),
    helmet: new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
    helmetRim: new THREE.CylinderGeometry(0.132, 0.136, 0.025, 14),
    visor: box(0.19, 0.045, 0.06),
    shoulderPad: box(0.16, 0.09, 0.19, 0, 0.0, 0),
    upperArm: limb(0.066, 0.056, 0.29),
    foreArm: limb(0.056, 0.046, 0.27),
    hand: box(0.07, 0.09, 0.075, 0, -0.04, 0),
    // rifle, modeled along +Z (muzzle forward)
    receiver: box(0.055, 0.09, 0.36, 0, 0, 0.05),
    barrel: new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8).rotateX(Math.PI / 2).translate(0, 0.015, 0.36),
    handguard: box(0.06, 0.06, 0.18, 0, 0.0, 0.28),
    mag: box(0.04, 0.13, 0.07, 0, -0.1, 0.1).rotateX(0.18),
    stock: box(0.045, 0.08, 0.16, 0, -0.02, -0.2),
    sight: box(0.03, 0.03, 0.08, 0, 0.06, 0.05),
    flash: new THREE.PlaneGeometry(0.34, 0.34),
  };
  return G;
}

let FLASH_TEX = null;
function flashTexture() {
  if (FLASH_TEX) return FLASH_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  x.fillStyle = g;
  x.beginPath();
  for (let i = 0; i < 10; i++) { // star-burst silhouette
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? 12 : 32;
    x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  x.fill();
  FLASH_TEX = new THREE.CanvasTexture(c);
  FLASH_TEX.colorSpace = THREE.SRGBColorSpace;
  return FLASH_TEX;
}

// ---------------------------------------------------------------- soldier rig
// Lengths used by both the rig and the IK solver.
const HIP_Y = 0.98, THIGH = 0.44, SHIN = 0.44, UPPER = 0.29, FORE = 0.27;
const SHOULDER_Y = 0.43, SHOULDER_X = 0.26, NECK_Y = 0.5;

export class SoldierRig {
  // palette: 'enemy' (red team) or 'ally' (blue — used for Yoru's decoy)
  constructor(variant = 0, palette = 'enemy') {
    const g = geo();
    // per-instance materials so hit-flashes / reveal / fading don't bleed across bots
    const hue = [0, 0.012, -0.015, 0.02, -0.008][variant % 5];
    const accent = palette === 'ally' ? 0x7d8cff : ENEMY_RED;
    this.mats = {
      fatigue: new THREE.MeshStandardMaterial({ color: new THREE.Color(0x48505c).offsetHSL(hue, 0, 0), roughness: 0.92 }),
      armor: new THREE.MeshStandardMaterial({ color: new THREE.Color(palette === 'ally' ? 0x2c44a8 : 0x9a2633).offsetHSL(hue, 0, 0), roughness: 0.5, metalness: 0.25 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x66707d, roughness: 0.55, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.7 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x1b1f25, roughness: 0.45, metalness: 0.6 }),
      accent: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9 }),
      visor: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2 }),
    };
    this.outlineColor = palette === 'ally' ? 0x3b4bd8 : 0xb3121f;
    this.outlineMat = new THREE.MeshBasicMaterial({ color: this.outlineColor, side: THREE.BackSide });
    for (const m of Object.values(this.mats)) m.userData.baseEmissive = m.emissive.clone(), m.userData.baseEI = m.emissiveIntensity;
    this.hitMeshes = [];
    this.allMeshes = [];

    this.root = new THREE.Group();      // world position + yaw
    this.body = new THREE.Group();      // death fall / bob pivot (at the feet)
    this.root.add(this.body);

    const M = this.mats;
    const part = (geometry, mat, parent, tag, { outline = true, x = 0, y = 0, z = 0 } = {}) => {
      const m = new THREE.Mesh(geometry, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      this.allMeshes.push(m);
      if (tag) { m.userData.part = tag; this.hitMeshes.push(m); }
      if (outline) this.addOutline(m);
      return m;
    };

    // --- hips + legs
    this.hips = new THREE.Group();
    this.hips.position.y = HIP_Y;
    this.body.add(this.hips);
    part(g.pelvis, M.fatigue, this.hips, 'body');
    part(g.belt, M.dark, this.hips, null, { outline: false, y: 0.06 });
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, -0.04, 0);
      this.hips.add(hip);
      part(g.thigh, M.fatigue, hip, 'legs');
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      part(g.kneePad, M.plate, knee, null, { outline: false });
      part(g.shin, M.fatigue, knee, 'legs');
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN;
      knee.add(ankle);
      part(g.boot, M.dark, ankle, 'legs');
      return { hip, knee, ankle };
    });

    // --- spine (torso, head, arms, rifle)
    this.spine = new THREE.Group();
    this.spine.position.y = 0.07;
    this.hips.add(this.spine);
    part(g.torso, M.fatigue, this.spine, 'body');
    part(g.chest, M.armor, this.spine, 'body');
    part(g.pack, M.plate, this.spine, 'body');
    part(g.collar, M.armor, this.spine, 'body', { outline: false });
    for (const px of [-0.12, 0, 0.12]) part(g.pouch, M.dark, this.spine, null, { outline: false, x: px, y: 0.2, z: 0.185 });
    // glowing team stripe across the chest plate
    part(new THREE.BoxGeometry(0.34, 0.025, 0.01), M.accent, this.spine, null, { outline: false, y: 0.4, z: 0.182 });

    this.neck = new THREE.Group();
    this.neck.position.y = NECK_Y;
    this.spine.add(this.neck);
    part(g.neck, M.dark, this.neck, 'head', { outline: false });
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.13;
    this.neck.add(this.headPivot);
    part(g.head, M.dark, this.headPivot, 'head', { y: 0.02 });
    part(g.helmet, M.plate, this.headPivot, 'head', { y: 0.04 });
    part(g.helmetRim, M.plate, this.headPivot, 'head', { outline: false, y: 0.045 });
    part(g.visor, M.visor, this.headPivot, 'head', { outline: false, y: 0.015, z: 0.095 });

    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      this.spine.add(shoulder);
      part(g.shoulderPad, M.armor, this.spine, 'body', { x: side * (SHOULDER_X + 0.01), y: SHOULDER_Y + 0.02 });
      part(g.upperArm, M.fatigue, shoulder, 'body');
      const elbow = new THREE.Group();
      elbow.position.y = -UPPER;
      shoulder.add(elbow);
      part(g.foreArm, M.fatigue, elbow, 'body');
      part(g.hand, M.dark, elbow, 'body', { outline: false, y: -FORE });
      return { side, shoulder, elbow };
    });

    // rifle (not a hitbox — shooting the gun shouldn't count)
    this.gun = new THREE.Group();
    this.spine.add(this.gun);
    for (const k of ['receiver', 'barrel', 'handguard', 'mag', 'stock', 'sight']) part(g[k], M.gun, this.gun, null, { outline: k === 'receiver' });
    part(new THREE.BoxGeometry(0.058, 0.012, 0.2), M.accent, this.gun, null, { outline: false, y: 0.047, z: 0.04 });
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.015, 0.5);
    this.gun.add(this.muzzle);
    this.flash = new THREE.Mesh(g.flash, new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.flash.visible = false;
    this.muzzle.add(this.flash);
    this.flash2 = this.flash.clone();
    this.flash2.rotation.y = Math.PI / 2;
    this.muzzle.add(this.flash2);

    // grip points in gun space
    this.gripR = new THREE.Vector3(0, -0.06, 0.0);
    this.gripL = new THREE.Vector3(0, -0.045, 0.27);

    // anim state
    this.phase = Math.random() * 10;
    this.aim = 0;        // 0 = low ready, 1 = shouldered
    this.recoil = 0;
    this.flinch = 0;
    this.flinchSide = 0;
    this.flashT = 0;
    this._t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._q = new THREE.Quaternion();
  }

  // Inverted-hull outline: a back-faced, slightly enlarged copy scaled about the
  // part's own bbox center → constant-thickness red enemy highlight.
  addOutline(mesh, t = 0.009) {
    const geom = mesh.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const bb = geom.boundingBox, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const o = new THREE.Mesh(geom, this.outlineMat);
    o.scale.set((size.x + 2 * t) / size.x, (size.y + 2 * t) / size.y, (size.z + 2 * t) / size.z);
    o.position.copy(c).multiply(new THREE.Vector3(1 - o.scale.x, 1 - o.scale.y, 1 - o.scale.z));
    o.raycast = () => {}; // never a hit target
    mesh.add(o);
    this.allMeshes.push(o);
  }

  // Two-bone IK: rotate shoulder + elbow so the hand lands on `target` (spine space).
  solveArm(arm, target) {
    const [d, p, E, tmp, T] = this._t;
    const S = arm.shoulder.position;
    d.subVectors(target, S);
    const dist = Math.min(Math.max(d.length(), 0.08), UPPER + FORE - 0.002);
    d.normalize();
    T.copy(S).addScaledVector(d, dist);
    const a = (UPPER * UPPER - FORE * FORE + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
    // elbow pole: down, out to the side, slightly back
    p.set(arm.side * 0.8, -1, -0.35);
    p.addScaledVector(d, -p.dot(d)).normalize();
    E.copy(S).addScaledVector(d, a).addScaledVector(p, h);
    tmp.subVectors(E, S).normalize();
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, tmp);
    tmp.subVectors(T, E).normalize().applyQuaternion(this._q.copy(arm.shoulder.quaternion).invert());
    arm.elbow.quaternion.setFromUnitVectors(DOWN, tmp);
  }

  // Per-frame animation. `fwd`/`side` = velocity in the soldier's local frame.
  animate(dt, { fwd = 0, side = 0, aimTarget = 0, pitch = 0 }) {
    const speed = Math.hypot(fwd, side);
    const amp = Math.min(speed / 4.5, 1);
    this.phase += dt * (2.2 + speed * 1.55);
    const ph = this.phase;
    const fwdK = speed > 0.05 ? fwd / speed : 0, sideK = speed > 0.05 ? side / speed : 0;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const p = ph + (i ? Math.PI : 0);
      const swing = Math.sin(p) * 0.62 * amp;
      L.hip.rotation.x = -swing * (Math.abs(fwdK) > 0.3 ? Math.sign(fwdK) : 0.5);
      L.hip.rotation.z = swing * 0.35 * sideK * (i ? -1 : 1) * 0.6;
      L.knee.rotation.x = amp * (0.15 + 0.85 * Math.max(0, Math.cos(p))) + (1 - amp) * 0.06;
      L.ankle.rotation.x = -L.knee.rotation.x * 0.45;
    }
    // vertical bob + a little idle breathing
    this.hips.position.y = HIP_Y - Math.abs(Math.sin(ph)) * 0.045 * amp - (1 - amp) * 0.02 + Math.sin(ph * 0.35) * 0.004;
    this.hips.rotation.y = Math.sin(ph) * 0.08 * amp;

    // aim blend + spine
    this.aim += (aimTarget - this.aim) * Math.min(1, dt * 7);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    this.spine.rotation.x = -pitch * this.aim * 0.75 + 0.06 * (1 - this.aim) - this.flinch * 0.32 + this.recoil * -0.05;
    this.spine.rotation.y = -this.hips.rotation.y + 0.12 * this.aim + this.flinchSide * this.flinch * 0.3;
    this.spine.rotation.z = this.flinchSide * this.flinch * 0.15;
    this.headPivot.rotation.x = -pitch * this.aim * 0.3 + 0.12 * (1 - this.aim) - this.flinch * 0.5;

    // rifle pose: low-ready → shouldered (cheek on stock)
    const a = this.aim, r = this.recoil;
    this.gun.position.set(-0.09 - 0.04 * (1 - a), 0.25 + 0.15 * a, 0.17 + 0.05 * (1 - a) - r * 0.06);
    this.gun.rotation.set(0.75 * (1 - a) - r * 0.25, 0.32 * (1 - a), -0.25 * (1 - a));
    this.gun.updateMatrix();
    const hand = this._t[4];
    this.solveArm(this.arms[0], hand.copy(this.gripR).applyMatrix4(this.gun.matrix).clone());
    this.solveArm(this.arms[1], hand.copy(this.gripL).applyMatrix4(this.gun.matrix).clone());

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      this.flash.visible = this.flash2.visible = on;
      if (on) this.flash.rotation.z = this.flash2.rotation.z = Math.random() * Math.PI;
    }
  }

  fire() {
    this.recoil = 1;
    this.flashT = 0.05;
  }

  hitReact(fromLeft) {
    this.flinch = 1;
    this.flinchSide = fromLeft ? 1 : -1;
    this.tint(0xffffff, 1.6);
    this._tintUntil = performance.now() + 70;
  }

  // Briefly override emissive on every material (hit flash / reveal glow).
  tint(color, intensity) {
    for (const m of Object.values(this.mats)) { m.emissive.set(color); m.emissiveIntensity = intensity; }
  }
  untint() {
    for (const m of Object.values(this.mats)) { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseEI; }
  }

  setXray(on) {
    for (const m of [...Object.values(this.mats), this.outlineMat]) { m.depthTest = !on; m.needsUpdate = true; }
    for (const o of this.allMeshes) o.renderOrder = on ? 999 : 0;
    this.outlineMat.color.set(on ? 0xff6b78 : this.outlineColor);
  }

  // Death pose — called every frame with elapsed time since death.
  animateDeath(el, dir, side, headshot) {
    const fall = Math.min(1, el / 0.62);
    const e = fall * fall; // gravity ease-in
    this.body.rotation.x = dir * e * (Math.PI / 2 - 0.12);
    this.body.rotation.z = side * e * 0.35;
    this.body.position.y = e * 0.1;
    const buckle = Math.min(1, el / 0.3);
    for (const L of this.legs) { L.knee.rotation.x = buckle * 0.9 * (1 - e * 0.6); L.hip.rotation.x = -buckle * 0.5 * (1 - e * 0.5); }
    this.spine.rotation.x = -0.25 * e * dir;
    this.headPivot.rotation.x = headshot ? -0.9 * Math.min(1, el / 0.12) : -0.2 * e;
    for (const A of this.arms) A.shoulder.rotation.x = 0;
    this.gun.position.y = 0.25 - e * 0.15;
    this.gun.rotation.x = 1.2 * e;
    this.flash.visible = this.flash2.visible = false;
  }

  resetPose() {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.root.position.y = 0;
    this.aim = 0; this.recoil = 0; this.flinch = 0;
    this.untint();
  }
}

// ---------------------------------------------------------------- bot brain
const DIFFICULTY = {
  easy:   { react: 0.75, acc: 0.30, dmg: 10, headChance: 0.08, burst: [2, 3], pause: [0.7, 1.2], speed: 3.4 },
  normal: { react: 0.48, acc: 0.42, dmg: 13, headChance: 0.13, burst: [3, 4], pause: [0.45, 0.85], speed: 3.9 },
  hard:   { react: 0.3,  acc: 0.55, dmg: 15, headChance: 0.2,  burst: [3, 5], pause: [0.3, 0.6], speed: 4.3 },
};
const rand = (a, b) => a + Math.random() * (b - a);

export class Bot {
  constructor(scene, spawn, name, variant) {
    this.name = name;
    this.rig = new SoldierRig(variant);
    this.group = this.rig.root; // world transform (kept as `group` for engine code)
    this.hitMeshes = this.rig.hitMeshes;
    for (const m of this.hitMeshes) m.userData.bot = this;
    scene.add(this.group);
    this.kills = 0; this.deaths = 0;
    this.respawn(spawn);
  }

  get diff() { return DIFFICULTY[this._difficulty] || DIFFICULTY.normal; }

  respawn(spawn, difficulty) {
    if (difficulty) this._difficulty = difficulty;
    this.hp = 100;
    this.alive = true;
    this.group.visible = true;
    this.group.position.copy(spawn).setY(0);
    this.yaw = Math.atan2(-spawn.x, -spawn.z); // face map center
    this.group.rotation.y = this.yaw;
    this.rig.resetPose();
    this.state = 'patrol';
    this.path = null; this.pathGoal = null; this.repathAt = 0;
    this.reactAt = 0; this.nextShot = 0; this.burstLeft = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = 0; this.standUntil = 0;
    this.lastSeen = null; this.lastSeenT = -99;
    this.flashUntil = 0;
    this.spawnGrace = performance.now() / 1000 + 1.0;
    this.prev = this.group.position.clone();
    this.velLocal = { fwd: 0, side: 0 };
    this.setRevealed(false);
  }

  setRevealed(on) {
    if (this._revealed === on) return;
    this._revealed = on;
    this.rig.setXray(on);
  }

  // Returns true if this hit killed.
  damage(amount, fromPos = null, part = 'body') {
    if (!this.alive) return false;
    this.hp -= amount;
    if (fromPos) {
      const toShooter = fromPos.clone().sub(this.group.position);
      const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      this.rig.hitReact(toShooter.dot(right) > 0);
      // getting shot alerts the bot — it turns to fight back, faster than a cold spot
      this.alertedAt = performance.now() / 1000;
      if (this.state !== 'engage') {
        this.state = 'hunt';
        this.lastSeen = fromPos.clone().setY(0);
        this.lastSeenT = performance.now() / 1000;
        this.path = null;
      }
    }
    if (this.hp <= 0) { this.die(fromPos, part === 'head'); return true; }
    return false;
  }

  die(fromPos, headshot = false) {
    this.alive = false;
    this.deaths++;
    this.diedAt = performance.now() / 1000;
    this.respawnAt = this.diedAt + 3.2 + Math.random() * 1.5;
    // fall away from the shooter
    let dir = -1;
    if (fromPos) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir = fromPos.clone().sub(this.group.position).dot(fwd) > 0 ? -1 : 1;
    }
    this.deathDir = dir;
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
    this.deathHead = headshot;
    this.rig.untint();
  }

  // ---------------------------------------------------------- AI tick
  update(dt, t, G) {
    const rig = this.rig;
    if (rig._tintUntil && performance.now() > rig._tintUntil) { rig._tintUntil = 0; if (!this._revealed) rig.untint(); }
    if (!this.alive) {
      const el = t - this.diedAt;
      rig.animateDeath(el, this.deathDir, this.deathSide, this.deathHead);
      if (el > 2.4) this.group.position.y = -(el - 2.4) * 0.5; // sink into the floor
      if (el > 3.2) this.group.visible = false;
      if (t >= this.respawnAt) G.respawnBot(this);
      return;
    }
    const D = this.diff;
    const pos = this.group.position;
    const player = G.pos;
    const dx = player.x - pos.x, dz = player.z - pos.z;
    const dist = Math.hypot(dx, dz);

    // ---- perception
    let sees = false;
    if (!G.dead && !G.invisible && this.flashUntil <= t && dist < 48) {
      const fwdDot = (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / (dist || 1);
      const inCone = this.state === 'engage' || fwdDot > -0.15 || dist < 5;
      sees = inCone && G.botCanSee(this);
    }
    let target = null;
    if (sees) {
      if (this.state !== 'engage') {
        this.state = 'engage';
        // first sight: human-ish reaction delay before the first round
        // (already alerted by gunfire/damage → snappier)
        const alerted = t - (this.alertedAt || -99) < 3;
        this.reactAt = Math.max(this.reactAt, t + D.react * (alerted ? rand(0.45, 0.7) : rand(0.8, 1.35)), this.spawnGrace);
        this.burstLeft = Math.round(rand(D.burst[0], D.burst[1]));
      }
      this.lastSeen = this.lastSeen || new THREE.Vector3();
      this.lastSeen.set(player.x, 0, player.z);
      this.lastSeenT = t;
      target = player;
    } else if (this.state === 'engage') {
      const decoy = G.visibleDecoy(this);
      if (decoy) target = decoy;
      else if (t - this.lastSeenT > 0.7) { this.state = 'hunt'; this.path = null; }
    } else if (!sees && this.state === 'patrol') {
      const decoy = G.visibleDecoy(this);
      if (decoy) { this.state = 'engage'; target = decoy; this.reactAt = t + D.react; this.lastSeenT = t; }
    }

    // ---- movement intent
    let mx = 0, mz = 0, speed = D.speed;
    let faceX = null, faceZ = null;
    let aimTarget = 0.15, pitch = 0;
    if (this.state === 'engage' && target) {
      const tx = target.x - pos.x, tz = target.z - pos.z, td = Math.hypot(tx, tz) || 1;
      faceX = tx; faceZ = tz;
      aimTarget = 1;
      pitch = Math.atan2((target.y ?? 1.2) - 1.45, td);
      const nx = tx / td, nz = tz / td;
      if (t > this.strafeUntil) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = t + rand(0.5, 1.4);
        if (Math.random() < 0.4) this.standUntil = t + rand(0.35, 0.8); // plant feet to shoot
      }
      if (t < this.standUntil) speed = 0;
      else {
        // strafe perpendicular, close distance if far, back off if hugging
        const approach = td > 22 ? 0.8 : td < 6 ? -0.7 : 0;
        mx = -nz * this.strafeDir + nx * approach;
        mz = nx * this.strafeDir + nz * approach;
        speed = D.speed * 0.62;
      }
      // ---- shooting
      if (t >= this.reactAt && t >= this.nextShot && t > this.spawnGrace) {
        this.shoot(t, G, target === player, td, speed > 0);
      }
    } else if (this.state === 'engage') {
      // just lost sight: hold the angle for a beat before pushing (→ hunt above)
      aimTarget = 1;
      if (this.lastSeen) { faceX = this.lastSeen.x - pos.x; faceZ = this.lastSeen.z - pos.z; }
    } else if (this.state === 'hunt' && this.lastSeen) {
      aimTarget = 0.7;
      speed = D.speed;
      if (this.followPath(this.lastSeen, t, G)) {
        const w = this.path[0];
        mx = w.x - pos.x; mz = w.z - pos.z;
      } else { this.state = 'patrol'; this.path = null; }
      // check corners: occasionally look toward the last known position
      if (this.lastSeen) { faceX = this.lastSeen.x - pos.x; faceZ = this.lastSeen.z - pos.z; }
      if (this.path && this.path.length > 1 && Math.hypot(faceX, faceZ) > 8) { faceX = mx; faceZ = mz; }
      if (t - this.lastSeenT > 9) { this.state = 'patrol'; this.path = null; }
    } else {
      this.state = 'patrol';
      speed = D.speed * 0.55;
      if (!this.pathGoal || !this.path || !this.path.length || t > this.patrolGiveUp) {
        // deathmatch bots "sense" the fight: most patrols head for your rough area
        this.pathGoal = G.nav.randomPoint();
        if (Math.random() < 0.65) {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 9;
          const gx = player.x + Math.cos(a) * r, gz = player.z + Math.sin(a) * r;
          if (G.nav.walkable(gx, gz)) this.pathGoal.set(gx, 0, gz);
        }
        this.path = G.nav.findPath(pos, this.pathGoal);
        this.patrolGiveUp = t + 14;
      }
      if (this.path && this.path.length) {
        const w = this.path[0];
        mx = w.x - pos.x; mz = w.z - pos.z;
        if (Math.hypot(mx, mz) < 0.45) this.path.shift();
      }
    }

    // ---- integrate with nav-grid sliding + bot separation
    const ml = Math.hypot(mx, mz);
    if (ml > 0.001 && speed > 0) {
      const step = Math.min(speed * dt, ml);
      const sx = (mx / ml) * step, sz = (mz / ml) * step;
      if (G.nav.walkable(pos.x + sx, pos.z)) pos.x += sx;
      else if (this.state === 'engage') this.strafeDir *= -1;
      if (G.nav.walkable(pos.x, pos.z + sz)) pos.z += sz;
      else if (this.state === 'engage') this.strafeDir *= -1;
    }
    for (const o of G.bots) {
      if (o === this || !o.alive) continue;
      const ox = pos.x - o.group.position.x, oz = pos.z - o.group.position.z, od = Math.hypot(ox, oz);
      if (od > 0.001 && od < 0.85) {
        const push = (0.85 - od) * 0.5;
        if (G.nav.walkable(pos.x + (ox / od) * push, pos.z + (oz / od) * push)) { pos.x += (ox / od) * push; pos.z += (oz / od) * push; }
      }
    }

    // ---- facing (smooth yaw)
    if (faceX === null && ml > 0.01) { faceX = mx; faceZ = mz; }
    if (faceX !== null) {
      const want = Math.atan2(faceX, faceZ);
      let dYaw = want - this.yaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      this.yaw += dYaw * Math.min(1, dt * (this.state === 'engage' ? 9 : 5));
    }
    this.group.rotation.y = this.yaw;

    // ---- animate from actual displacement
    const vx = (pos.x - this.prev.x) / Math.max(dt, 1e-4), vz = (pos.z - this.prev.z) / Math.max(dt, 1e-4);
    this.prev.copy(pos);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const k = Math.min(1, dt * 10);
    this.velLocal.fwd += (vx * s + vz * c - this.velLocal.fwd) * k;
    this.velLocal.side += (vx * c - vz * s - this.velLocal.side) * k;
    rig.animate(dt, { fwd: this.velLocal.fwd, side: this.velLocal.side, aimTarget, pitch });
  }

  // Follow (and periodically refresh) an A* path toward `goal`. False if unreachable.
  followPath(goal, t, G) {
    const pos = this.group.position;
    if (!this.path || t > this.repathAt || (this.pathGoal && this.pathGoal.distanceToSquared(goal) > 4)) {
      this.path = G.nav.findPath(pos, goal);
      this.pathGoal = goal.clone();
      this.repathAt = t + 1.2;
    }
    if (!this.path) return false;
    while (this.path.length && Math.hypot(this.path[0].x - pos.x, this.path[0].z - pos.z) < 0.45) this.path.shift();
    return this.path.length > 0;
  }

  shoot(t, G, atPlayer, dist, moving) {
    const D = this.diff;
    this.rig.fire();
    G.sfx.playAt('botshot', this.group.position);
    this.burstLeft--;
    if (this.burstLeft <= 0) {
      this.nextShot = t + rand(D.pause[0], D.pause[1]);
      this.burstLeft = Math.round(rand(D.burst[0], D.burst[1]));
      this.burstIdx = 0;
    } else {
      this.nextShot = t + 0.11;
      this.burstIdx = (this.burstIdx || 0) + 1;
    }
    const from = this.rig.muzzle.getWorldPosition(new THREE.Vector3());
    if (!atPlayer) { G.spawnTracer(from, G.decoyAimPoint(), true); return; }
    // accuracy model: distance, your movement, their movement, burst bloom
    const pSpeed = Math.hypot(G.vel.x, G.vel.z);
    const chance = Math.max(0.05, D.acc - dist * 0.008 - pSpeed * 0.028 - (moving ? 0.12 : 0) - (this.burstIdx || 0) * 0.04 + (dist < 8 ? 0.15 : 0));
    const hit = Math.random() < chance;
    const end = G.pos.clone();
    if (hit) end.y -= 0.35;
    else end.add(new THREE.Vector3(rand(-1, 1), rand(-0.8, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(0.5, 1.3)));
    G.spawnTracer(from, end, true);
    if (hit) {
      const head = Math.random() < D.headChance;
      G.hurt(Math.round(D.dmg * (head ? 2.6 : 1) * rand(0.9, 1.1)), this, head);
    } else if (dist < 25) G.sfx.play('whiz');
  }
}
