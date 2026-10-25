/**
 * Authoring helpers for level data: wall runs with door gaps, floor slabs and
 * room definitions. Keeps the bank definition declarative and readable.
 */
import type { BoxDef, RoomDef } from './level';
import type { SurfaceType } from '../core/types';

export interface Gap { a: number; b: number }
export const gap = (a: number, b: number): Gap => ({ a, b });

/** Wall running along X at fixed z (horizontal in plan). Splits around gaps. */
export function wallZ(
  z: number, x0: number, x1: number, opts: { gaps?: Gap[]; height?: number; thickness?: number; material?: string; roomId?: string; blocksSight?: boolean; color?: number } = {},
): BoxDef[] {
  return runAlong('x', z, x0, x1, opts);
}

/** Wall running along Z at fixed x (vertical in plan). */
export function wallX(
  x: number, z0: number, z1: number, opts: { gaps?: Gap[]; height?: number; thickness?: number; material?: string; roomId?: string; blocksSight?: boolean; color?: number } = {},
): BoxDef[] {
  return runAlong('z', x, z0, z1, opts);
}

function runAlong(axis: 'x' | 'z', fixed: number, s0: number, s1: number, opts: { gaps?: Gap[]; height?: number; thickness?: number; material?: string; roomId?: string; blocksSight?: boolean; color?: number }): BoxDef[] {
  const out: BoxDef[] = [];
  const h = opts.height ?? 3.6;
  const t = opts.thickness ?? 0.3;
  const gaps = (opts.gaps ?? []).slice().sort((a, b) => a.a - b.a);
  let cursor = s0;
  const emit = (a: number, b: number) => {
    if (b - a < 0.02) return;
    const min = axis === 'x'
      ? { x: a, y: 0, z: fixed - t / 2 }
      : { x: fixed - t / 2, y: 0, z: a };
    const max = axis === 'x'
      ? { x: b, y: h, z: fixed + t / 2 }
      : { x: fixed + t / 2, y: h, z: b };
    out.push({ min, max, kind: 'wall', material: opts.material ?? 'wall', roomId: opts.roomId, blocksSight: opts.blocksSight ?? true, color: opts.color });
  };
  for (const g of gaps) {
    emit(cursor, g.a);
    cursor = g.b;
  }
  emit(cursor, s1);
  return out;
}

/** Thin floor slab covering a rectangle (walkable surface). */
export function floor(x0: number, x1: number, z0: number, z1: number, surface: SurfaceType, material: string, roomId?: string, y = 0): BoxDef {
  return { min: { x: x0, y: y - 0.2, z: z0 }, max: { x: x1, y, z: z1 }, kind: 'floor', surface, material, roomId, blocksNav: false };
}

export function ceilingSlab(x0: number, x1: number, z0: number, z1: number, y: number, roomId?: string): BoxDef {
  return { min: { x: x0, y: y - 0.2, z: z0 }, max: { x: x1, y, z: z1 }, kind: 'ceiling', material: 'ceiling', roomId, blocksNav: false, blocksSight: false };
}

/** Solid obstacle (desk, counter, bench...). Nav-blocking if taller than a step. */
export function block(x0: number, x1: number, z0: number, z1: number, h: number, roomId?: string, material = 'wood', color?: number): BoxDef {
  return { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: h, z: z1 }, kind: 'obstacle', material, roomId, color };
}

export function room(id: string, name: string, x0: number, x1: number, z0: number, z1: number, tags: string[], access: RoomDef['access'], opts: { floorY?: number; ceilingY?: number; lightLevel?: number } = {}): RoomDef {
  return { id, name, x0, x1, z0, z1, floorY: opts.floorY ?? 0, ceilingY: opts.ceilingY ?? 3.6, tags, access, lightLevel: opts.lightLevel ?? 0.8 };
}
