/**
 * Small math helpers for simulation code. Pure functions, allocation-light.
 */
import type { AABB, Vec3 } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const TAU = Math.PI * 2;

/** Shortest signed angular difference a->b in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function len2(a: Vec3): number { return a.x * a.x + a.y * a.y + a.z * a.z; }
export function len(a: Vec3): number { return Math.sqrt(len2(a)); }
export function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
export function dist(a: Vec3, b: Vec3): number { return Math.sqrt(dist2(a, b)); }
export function distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
export function distXZ2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}
export function normalizeXZ(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-9 ? { x: a.x / l, y: 0, z: a.z / l } : { x: 0, y: 0, z: 0 };
}
export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Horizontal angle (radians) from +Z axis, matching three.js object.rotation.y convention. */
export function yawFromTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function aabbContainsPoint(b: AABB, p: Vec3, pad = 0): boolean {
  return (
    p.x >= b.min.x - pad && p.x <= b.max.x + pad &&
    p.y >= b.min.y - pad && p.y <= b.max.y + pad &&
    p.z >= b.min.z - pad && p.z <= b.max.z + pad
  );
}

export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}

export function pointAabbClosest(b: AABB, p: Vec3): Vec3 {
  return {
    x: clamp(p.x, b.min.x, b.max.x),
    y: clamp(p.y, b.min.y, b.max.y),
    z: clamp(p.z, b.min.z, b.max.z),
  };
}

/** Slab-method ray vs AABB. Returns entry distance or null. */
export function rayAabb(origin: Vec3, dir: Vec3, box: AABB, maxDist: number): number | null {
  let tmin = 0;
  let tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (lo[i] - o[i]) * inv;
      let t2 = (hi[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** 2D segment vs 2D AABB (XZ plane) entry distance — used for line-of-sight on the navgrid. */
export function segAabb2D(p0x: number, p0z: number, p1x: number, p1z: number, minx: number, minz: number, maxx: number, maxz: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = p1x - p0x, dz = p1z - p0z;
  const p = [-dx, dx, -dz, dz];
  const q = [p0x - minx, maxx - p0x, p0z - minz, maxz - p0z];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { t0 = Math.max(t0, r); } else { t1 = Math.min(t1, r); }
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function deg2rad(d: number): number { return (d * Math.PI) / 180; }
export function rad2deg(r: number): number { return (r * 180) / Math.PI; }
