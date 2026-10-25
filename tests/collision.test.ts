import { describe, it, expect } from 'vitest';
import { PhysicsWorld } from '../src/world/collision';

describe('PhysicsWorld capsule collision', () => {
  const make = () => {
    const w = new PhysicsWorld();
    // floor
    w.add({ min: { x: -20, y: -0.2, z: -20 }, max: { x: 20, y: 0, z: 20 } }, { surface: 'marble' });
    // wall at x=2..2.3 spanning z -20..20, height 3
    w.add({ min: { x: 2, y: 0, z: -20 }, max: { x: 2.3, y: 3, z: 20 } });
    return w;
  };

  it('stops an agent at a wall and never lets it pass through', () => {
    const w = make();
    const agent = { pos: { x: 0, y: 0, z: 0 }, radius: 0.34, height: 1.78, stepHeight: 0.42 };
    for (let i = 0; i < 200; i++) w.moveCapsule(agent, { x: 0.05, y: 0, z: 0 });
    expect(agent.pos.x).toBeLessThan(2.0);
    expect(agent.pos.x).toBeGreaterThan(1.5);
  });

  it('lands on the floor and reports grounded with the surface type', () => {
    const w = make();
    const agent = { pos: { x: 0, y: 2, z: 0 }, radius: 0.34, height: 1.78, stepHeight: 0.42 };
    let res = w.moveCapsule(agent, { x: 0, y: -0.5, z: 0 });
    for (let i = 0; i < 60 && !res.grounded; i++) res = w.moveCapsule(agent, { x: 0, y: -0.1, z: 0 });
    expect(res.grounded).toBe(true);
    expect(agent.pos.y).toBeCloseTo(0, 2);
    expect(res.groundSurface).toBe('marble');
  });

  it('steps up onto a low obstacle but not onto a tall one', () => {
    const w = new PhysicsWorld();
    w.add({ min: { x: -20, y: -0.2, z: -20 }, max: { x: 20, y: 0, z: 20 } });
    w.add({ min: { x: 1, y: 0, z: -2 }, max: { x: 1.5, y: 0.2, z: 2 } }, { step: true });
    const a = { pos: { x: 0.2, y: 0, z: 0 }, radius: 0.34, height: 1.78, stepHeight: 0.42 };
    for (let i = 0; i < 40; i++) w.moveCapsule(a, { x: 0.05, y: 0, z: 0 });
    expect(a.pos.x).toBeGreaterThan(1.0);

    const w2 = new PhysicsWorld();
    w2.add({ min: { x: -20, y: -0.2, z: -20 }, max: { x: 20, y: 0, z: 20 } });
    w2.add({ min: { x: 1, y: 0, z: -2 }, max: { x: 1.5, y: 1.2, z: 2 } });
    const b = { pos: { x: 0.2, y: 0, z: 0 }, radius: 0.34, height: 1.78, stepHeight: 0.42 };
    for (let i = 0; i < 40; i++) w2.moveCapsule(b, { x: 0.05, y: 0, z: 0 });
    expect(b.pos.x).toBeLessThan(1.0);
  });

  it('raycast hits the nearest solid box and respects sight-only filtering', () => {
    const w = new PhysicsWorld();
    w.add({ min: { x: 5, y: 0, z: -1 }, max: { x: 6, y: 2, z: 1 } });
    w.add({ min: { x: 8, y: 0, z: -1 }, max: { x: 9, y: 2, z: 1 } }, { blocksSight: false });
    const hit = w.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50);
    expect(hit).not.toBeNull();
    expect(hit!.dist).toBeCloseTo(5, 3);
    expect(w.hasLineOfSight({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 })).toBe(false);
    expect(w.hasLineOfSight({ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 })).toBe(true);
  });
});
