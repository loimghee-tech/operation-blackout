import { describe, it, expect } from 'vitest';
import { evaluateSight, playerVisibility, hears, noiseSuspicion } from '../src/ai/perception';
import { PhysicsWorld } from '../src/world/collision';

const base = { stance: 'stand' as const, moving: false, sprinting: false, visibilityMult: 1, lightLevel: 1, vanish: false };

describe('player visibility', () => {
  it('crouching is less visible than standing; sprinting more', () => {
    const stand = playerVisibility({ ...base, moving: true });
    const crouch = playerVisibility({ ...base, moving: true, stance: 'crouch' });
    const sprint = playerVisibility({ ...base, moving: true, sprinting: true });
    expect(crouch).toBeLessThan(stand);
    expect(sprint).toBeGreaterThan(stand);
  });

  it('darkness and the vanish ability reduce visibility', () => {
    const lit = playerVisibility(base);
    expect(playerVisibility({ ...base, lightLevel: 0.1 })).toBeLessThan(lit);
    expect(playerVisibility({ ...base, vanish: true })).toBeLessThan(lit * 0.5);
  });
});

describe('sight', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const fwd = { forwardX: 0, forwardZ: 1 };   // looking +z
  it('sees a target inside the cone and range with line of sight', () => {
    const r = evaluateSight({ eye, ...fwd, fovRad: 1.9, range: 20, target: { x: 0, y: 1.6, z: 8 }, hasLos: true });
    expect(r.seen).toBe(true);
    expect(r.exposure).toBeGreaterThan(0);
  });
  it('does not see targets behind the observer or out of range', () => {
    expect(evaluateSight({ eye, ...fwd, fovRad: 1.9, range: 20, target: { x: 0, y: 1.6, z: -8 }, hasLos: true }).seen).toBe(false);
    expect(evaluateSight({ eye, ...fwd, fovRad: 1.9, range: 5, target: { x: 0, y: 1.6, z: 8 }, hasLos: true }).seen).toBe(false);
  });
  it('blocked line of sight means not seen', () => {
    expect(evaluateSight({ eye, ...fwd, fovRad: 1.9, range: 20, target: { x: 0, y: 1.6, z: 8 }, hasLos: false }).seen).toBe(false);
  });
  it('a wall between observer and target blocks the physics line-of-sight', () => {
    const w = new PhysicsWorld();
    w.add({ min: { x: -5, y: 0, z: 4 }, max: { x: 5, y: 3, z: 4.5 } });
    expect(w.hasLineOfSight(eye, { x: 0, y: 1.6, z: 8 })).toBe(false);
    expect(w.hasLineOfSight(eye, { x: 0, y: 1.6, z: 3 })).toBe(true);
  });
});

describe('hearing', () => {
  it('hears nearby noise and attenuates through walls', () => {
    const noise = { pos: { x: 10, y: 0, z: 0 }, radius: 20, loudness: 1, kind: 'gunshot' as const };
    const open = hears({ x: 0, y: 0, z: 0 }, noise, true, 1);
    const walled = hears({ x: 0, y: 0, z: 0 }, noise, false, 1);
    expect(open.heard).toBe(true);
    expect(walled.heard).toBe(true);
    expect(walled.strength).toBeLessThan(open.strength + 1e-9 + 0.0001);
    expect(hears({ x: 0, y: 0, z: 0 }, { ...noise, pos: { x: 60, y: 0, z: 0 } }, true, 1).heard).toBe(false);
  });
  it('gunfire is much more suspicious than a footstep', () => {
    expect(noiseSuspicion('gunshot')).toBeGreaterThan(noiseSuspicion('footstep') * 5);
  });
});
