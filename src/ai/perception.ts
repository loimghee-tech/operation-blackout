/**
 * Perception maths. Pure functions so the detection rules are unit-testable.
 *
 * Sight:   cone (FOV) + range + line of sight + the player's visibility
 *          (stance, movement, light, concealment, abilities).
 * Hearing: noise events within a radius; walls and distance attenuate.
 */
import type { Vec3 } from '../core/types';
import { BALANCE } from '../config/balance';

export interface VisibilityContext {
  stance: 'stand' | 'crouch' | 'prone';
  moving: boolean;
  sprinting: boolean;
  /** Multiplier from skills/abilities (1 = normal). */
  visibilityMult: number;
  /** Room light level 0..1. */
  lightLevel: number;
  /** Ghost "vanish" or similar: extra visibility reduction for unaware observers. */
  vanish: boolean;
}

/** How easily the player is noticed right now, 0..~1.5. */
export function playerVisibility(v: VisibilityContext): number {
  let m = 1;
  if (v.stance === 'crouch') m *= 0.55;
  if (v.stance === 'prone') m *= 0.35;
  if (v.sprinting) m *= 1.45;
  else if (v.moving) m *= 1.0;
  else m *= 0.8;               // standing still is less eye-catching than walking in view
  m *= 0.55 + 0.45 * clamp01(v.lightLevel);
  m *= v.visibilityMult;
  if (v.vanish) m *= 0.35;
  return m;
}

/** View range given light level and difficulty multipliers. */
export function effectiveViewRange(base: number, lightLevel: number, diffMult: number, visibility: number): number {
  const light = 0.6 + 0.4 * clamp01(lightLevel);
  return base * light * diffMult * Math.sqrt(Math.max(0.2, visibility));
}

export interface SightQuery {
  eye: Vec3;           // observer eye position
  forwardX: number;    // observer facing (unit XZ)
  forwardZ: number;
  fovRad: number;      // full FOV angle
  range: number;       // effective range (metres)
  target: Vec3;        // target eye position
  hasLos: boolean;     // result of physics line-of-sight
}

export interface SightResult {
  inCone: boolean;
  inRange: boolean;
  seen: boolean;
  dist: number;
  /** 0..1 — how strongly the target fills the observer's attention right now. */
  exposure: number;
}

export function evaluateSight(q: SightQuery): SightResult {
  const dx = q.target.x - q.eye.x, dy = q.target.y - q.eye.y, dz = q.target.z - q.eye.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return { inCone: true, inRange: true, seen: true, dist: 0, exposure: 1 };
  const hz = Math.hypot(dx, dz);
  // cone test on horizontal plane (vertical FOV is generous: 1.2x)
  const cos = hz > 1e-6 ? (dx * q.forwardX + dz * q.forwardZ) / hz : 1;
  const half = q.fovRad / 2;
  const inCone = cos >= Math.cos(half) || (dist < 2.5 && cos >= Math.cos(half * 1.6)); // peripheral at close range
  const inRange = dist <= q.range;
  const seen = inCone && inRange && q.hasLos;
  const exposure = seen ? clamp01(1 - dist / Math.max(0.01, q.range)) ** 0.7 : 0;
  return { inCone, inRange, seen, dist, exposure };
}

export interface NoiseEvent {
  pos: Vec3;
  radius: number;   // metres
  loudness: number; // 0..1, relative
  kind: 'footstep' | 'gunshot' | 'suppressed' | 'impact' | 'alarm' | 'door' | 'hack' | 'drill' | 'body' | 'scream' | 'distraction';
  sourceId?: string;
}

/** Whether a listener hears a noise. Walls (no LOS) halve the effective radius. */
export function hears(listener: Vec3, noise: NoiseEvent, hasLos: boolean, hearMult: number): { heard: boolean; strength: number } {
  const d = Math.hypot(listener.x - noise.pos.x, listener.z - noise.pos.z);
  const effRadius = noise.radius * (hasLos ? 1 : 0.5) * BALANCE.npc.hearMultiplier * hearMult;
  if (d > effRadius) return { heard: false, strength: 0 };
  return { heard: true, strength: clamp01(1 - d / Math.max(0.01, effRadius)) * noise.loudness };
}

/** Converts noise loudness types into the amount of suspicion they add (before difficulty). */
export function noiseSuspicion(kind: NoiseEvent['kind']): number {
  switch (kind) {
    case 'footstep': return 6;
    case 'door': return 14;
    case 'impact': return 22;
    case 'hack': return 18;
    case 'drill': return 28;
    case 'distraction': return 40;
    case 'suppressed': return 30;
    case 'gunshot': return 90;
    case 'alarm': return 100;
    case 'body': return 60;
    case 'scream': return 70;
    default: return 10;
  }
}

export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
