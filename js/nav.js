// Navigation grid — bots path around walls instead of walking through them.
// The arena is rasterized once into walkable/blocked cells (colliders inflated
// by the bot radius), then A* finds routes and string-pulling smooths them.

import * as THREE from 'three';

export class NavGrid {
  constructor(colliders, { half = 29, cell = 0.5, radius = 0.42 } = {}) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.blocked = new Uint8Array(this.n * this.n);
    for (let gz = 0; gz < this.n; gz++) {
      for (let gx = 0; gx < this.n; gx++) {
        const x = this.toWorld(gx), z = this.toWorld(gz);
        for (const c of colliders) {
          if (c.min.y > 1.4) continue; // overhead geometry doesn't block feet
          if (x > c.min.x - radius && x < c.max.x + radius && z > c.min.z - radius && z < c.max.z + radius) {
            this.blocked[gz * this.n + gx] = 1;
            break;
          }
        }
      }
    }
    this.open = [];
    for (let i = 0; i < this.blocked.length; i++) if (!this.blocked[i]) this.open.push(i);
  }

  toGrid(v) { return Math.max(0, Math.min(this.n - 1, Math.floor((v + this.half) / this.cell))); }
  toWorld(g) { return -this.half + (g + 0.5) * this.cell; }
  walkable(x, z) {
    if (Math.abs(x) >= this.half || Math.abs(z) >= this.half) return false;
    return !this.blocked[this.toGrid(z) * this.n + this.toGrid(x)];
  }

  randomPoint() {
    const i = this.open[Math.floor(Math.random() * this.open.length)];
    return new THREE.Vector3(this.toWorld(i % this.n), 0, this.toWorld(Math.floor(i / this.n)));
  }

  // Nearest walkable cell index to a world position (spiral search).
  nearestOpen(x, z) {
    const gx = this.toGrid(x), gz = this.toGrid(z);
    for (let r = 0; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= this.n || nz >= this.n) continue;
          if (!this.blocked[nz * this.n + nx]) return nz * this.n + nx;
        }
      }
    }
    return -1;
  }

  // Straight walk between two points stays on open cells?
  clearLine(ax, az, bx, bz) {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / (this.cell * 0.5));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      if (!this.walkable(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
    }
    return true;
  }

  // A* over 8-connected cells → smoothed list of world waypoints (excludes start).
  findPath(from, to) {
    const n = this.n;
    const start = this.nearestOpen(from.x, from.z);
    const goal = this.nearestOpen(to.x, to.z);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [new THREE.Vector3(this.toWorld(goal % n), 0, this.toWorld(Math.floor(goal / n)))];

    const g = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = new MinHeap();
    const gx1 = goal % n, gz1 = Math.floor(goal / n);
    const h = (i) => { const dx = Math.abs(i % n - gx1), dz = Math.abs(Math.floor(i / n) - gz1); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[start] = 0;
    heap.push(start, h(start));
    let found = false, iter = 0;
    while (heap.size && iter++ < 20000) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % n, cz = Math.floor(cur / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const ni = nz * n + nx;
          if (this.blocked[ni] || closed[ni]) continue;
          // no corner cutting through blocked diagonals
          if (dx && dz && (this.blocked[cz * n + nx] || this.blocked[nz * n + cx])) continue;
          const ng = g[cur] + (dx && dz ? 1.414 : 1);
          if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; heap.push(ni, ng + h(ni)); }
        }
      }
    }
    if (!found) return null;

    const cells = [];
    for (let c = goal; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => new THREE.Vector3(this.toWorld(c % n), 0, this.toWorld(Math.floor(c / n))));

    // string-pull: from each anchor, skip ahead to the farthest directly reachable point
    const out = [];
    let ax = from.x, az = from.z, i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clearLine(ax, az, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      ax = pts[j].x; az = pts[j].z; i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }
}

class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const a = this.items, k = this.keys;
    a.push(item); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items, k = this.keys;
    const top = a[0];
    const lastA = a.pop(), lastK = k.pop();
    if (a.length) {
      a[0] = lastA; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
