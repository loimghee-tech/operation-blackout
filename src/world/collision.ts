/**
 * PhysicsWorld: static + dynamic AABB collision with capsule agents.
 * Spatial hash for raycasts and overlap queries. Deliberately simple and
 * allocation-light — every collider is an AABB, movement resolves per-axis
 * with step-up support. This is the single source of truth for "can I be here".
 */
import type { AABB, Vec3 } from '../core/types';
import { rayAabb } from '../core/math';

export interface ColliderBox {
  box: AABB;
  /** Solid blocks movement; 'step' allows step-up when top within stepHeight. */
  solid: boolean;
  step: boolean;
  blocksSight: boolean;
  blocksNav: boolean;
  dynamicId?: string;   // doors/barricades — can be toggled
  enabled: boolean;
  surface: string;
  data?: unknown;
}

interface CellBucket {
  items: ColliderBox[];
}

const CELL = 4; // metres

function cellKey(cx: number, cz: number): number {
  return ((cx + 2048) << 12) | (cz + 2048);
}

export interface CapsuleAgent {
  pos: Vec3;      // feet position (base center)
  radius: number;
  height: number;
  stepHeight: number;
}

export interface MoveResult {
  grounded: boolean;
  groundY: number;
  groundSurface: string;
  bumped: boolean;      // horizontal movement was blocked
  headBump: boolean;
  steppedUp: boolean;
}

export class PhysicsWorld {
  private boxes: ColliderBox[] = [];
  private dynamic = new Map<string, ColliderBox>();
  private grid = new Map<number, CellBucket>();

  clear(): void {
    this.boxes.length = 0;
    this.dynamic.clear();
    this.grid.clear();
  }

  add(box: AABB, opts: Partial<Omit<ColliderBox, 'box'>> = {}): ColliderBox {
    const cb: ColliderBox = {
      box,
      solid: opts.solid ?? true,
      step: opts.step ?? false,
      blocksSight: opts.blocksSight ?? true,
      blocksNav: opts.blocksNav ?? true,
      dynamicId: opts.dynamicId,
      enabled: opts.enabled ?? true,
      surface: opts.surface ?? 'concrete',
      data: opts.data,
    };
    this.boxes.push(cb);
    if (cb.dynamicId) this.dynamic.set(cb.dynamicId, cb);
    this.indexBox(cb);
    return cb;
  }

  private indexBox(cb: ColliderBox): void {
    const { min, max } = cb.box;
    const cx0 = Math.floor(min.x / CELL), cx1 = Math.floor(max.x / CELL);
    const cz0 = Math.floor(min.z / CELL), cz1 = Math.floor(max.z / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const key = cellKey(cx, cz);
        let bucket = this.grid.get(key);
        if (!bucket) { bucket = { items: [] }; this.grid.set(key, bucket); }
        bucket.items.push(cb);
      }
    }
  }

  setDynamicEnabled(dynamicId: string, enabled: boolean): void {
    const cb = this.dynamic.get(dynamicId);
    if (cb) cb.enabled = enabled;
  }

  getDynamic(dynamicId: string): ColliderBox | undefined {
    return this.dynamic.get(dynamicId);
  }

  /** Boxes overlapping an AABB region (enabled + solid only by default). */
  queryRegion(region: AABB, includeNonSolid = false): ColliderBox[] {
    const out: ColliderBox[] = [];
    const seen = new Set<ColliderBox>();
    const cx0 = Math.floor(region.min.x / CELL), cx1 = Math.floor(region.max.x / CELL);
    const cz0 = Math.floor(region.min.z / CELL), cz1 = Math.floor(region.max.z / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const bucket = this.grid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const cb of bucket.items) {
          if (seen.has(cb) || !cb.enabled) continue;
          if (!includeNonSolid && !cb.solid) continue;
          const b = cb.box;
          if (b.min.x <= region.max.x && b.max.x >= region.min.x &&
              b.min.y <= region.max.y && b.max.y >= region.min.y &&
              b.min.z <= region.max.z && b.max.z >= region.min.z) {
            seen.add(cb);
            out.push(cb);
          }
        }
      }
    }
    return out;
  }

  /** All enabled boxes near a point within radius (XZ) and vertical span. */
  queryNear(p: Vec3, radius: number, yMin: number, yMax: number): ColliderBox[] {
    return this.queryRegion({
      min: { x: p.x - radius, y: yMin, z: p.z - radius },
      max: { x: p.x + radius, y: yMax, z: p.z + radius },
    });
  }

  /**
   * Raycast against solid boxes. Returns nearest hit {dist, box, point, normal} or null.
   * maxDist limits travel. Optionally ignore non-sight-blocking boxes (for LOS).
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, sightOnly = false): { dist: number; box: ColliderBox; point: Vec3; normal: Vec3 } | null {
    // DDA over grid cells along the ray (XZ); check candidate boxes per cell.
    let best: { dist: number; box: ColliderBox; point: Vec3; normal: Vec3 } | null = null;
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    let cx = Math.floor(origin.x / CELL);
    let cz = Math.floor(origin.z / CELL);
    const invDx = dir.x !== 0 ? 1 / Math.abs(dir.x) : Infinity;
    const invDz = dir.z !== 0 ? 1 / Math.abs(dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? (((dir.x > 0 ? (cx + 1) * CELL : cx * CELL) - origin.x) * invDx * Math.abs(dir.x) / dir.x) : Infinity;
    let tMaxZ = dir.z !== 0 ? (((dir.z > 0 ? (cz + 1) * CELL : cz * CELL) - origin.z) * invDz * Math.abs(dir.z) / dir.z) : Infinity;
    // simplify: distance along ray to next cell boundary
    tMaxX = dir.x !== 0 ? Math.abs((dir.x > 0 ? (cx + 1) * CELL - origin.x : cx * CELL - origin.x) / dir.x) : Infinity;
    tMaxZ = dir.z !== 0 ? Math.abs((dir.z > 0 ? (cz + 1) * CELL - origin.z : cz * CELL - origin.z) / dir.z) : Infinity;
    const tDeltaX = CELL * invDx;
    const tDeltaZ = CELL * invDz;

    const seen = new Set<ColliderBox>();
    let t = 0;
    let guard = 0;
    while (t <= maxDist && guard++ < 512) {
      const bucket = this.grid.get(cellKey(cx, cz));
      if (bucket) {
        for (const cb of bucket.items) {
          if (!cb.enabled) continue;
          if (sightOnly && !cb.blocksSight) continue;
          if (!sightOnly && !cb.solid) continue;
          if (seen.has(cb)) continue;
          seen.add(cb);
          const hit = rayAabb(origin, dir, cb.box, maxDist);
          if (hit !== null && (!best || hit < best.dist)) {
            best = {
              dist: hit,
              box: cb,
              point: { x: origin.x + dir.x * hit, y: origin.y + dir.y * hit, z: origin.z + dir.z * hit },
              normal: computeNormal(origin, dir, cb.box, hit),
            };
          }
        }
      }
      if (best && best.dist <= t) break; // cannot improve beyond current cell entry distance
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
    }
    return best;
  }

  /** Line of sight between two points (ignores glass: blocksSight=false boxes). */
  hasLineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return true;
    const hit = this.raycast(a, { x: dx / d, y: dy / d, z: dz / d }, d, true);
    return hit === null || hit.dist >= d - 0.05;
  }

  /**
   * Move a capsule agent by delta with collision resolution.
   * Mutates agent.pos. Returns movement result flags.
   */
  moveCapsule(agent: CapsuleAgent, delta: Vec3): MoveResult {
    const result: MoveResult = {
      grounded: false, groundY: -Infinity, groundSurface: 'concrete',
      bumped: false, headBump: false, steppedUp: false,
    };

    // --- horizontal: X then Z, each with step-up attempt ---
    if (delta.x !== 0) {
      const before = agent.pos.x;
      agent.pos.x += delta.x;
      if (this.resolveHorizontalAxis(agent, 'x', delta.x)) {
        // blocked — try step up
        if (this.tryStepUp(agent, () => {
          agent.pos.x = before + delta.x;
          return this.resolveHorizontalAxis(agent, 'x', delta.x);
        })) {
          result.steppedUp = true;
        } else {
          result.bumped = true;
        }
      }
    }
    if (delta.z !== 0) {
      const before = agent.pos.z;
      agent.pos.z += delta.z;
      if (this.resolveHorizontalAxis(agent, 'z', delta.z)) {
        if (this.tryStepUp(agent, () => {
          agent.pos.z = before + delta.z;
          return this.resolveHorizontalAxis(agent, 'z', delta.z);
        })) {
          result.steppedUp = true;
        } else {
          result.bumped = true;
        }
      }
    }

    // --- vertical ---
    const feetBefore = agent.pos.y;
    agent.pos.y += delta.y;

    // ground check: find highest box top we are standing on / landing on
    const nearby = this.queryNear(agent.pos, agent.radius + 0.05, agent.pos.y - 0.6, agent.pos.y + agent.height);
    let groundY = -Infinity;
    let groundSurface = 'concrete';
    let ceilingY = Infinity;
    const feetCircleMinY = agent.pos.y;
    const headY = agent.pos.y + agent.height;
    for (const cb of nearby) {
      if (!cb.enabled || !cb.solid) continue;
      const b = cb.box;
      // horizontal overlap (circle vs rect, approximate with expanded rect)
      if (agent.pos.x + agent.radius < b.min.x || agent.pos.x - agent.radius > b.max.x) continue;
      if (agent.pos.z + agent.radius < b.min.z || agent.pos.z - agent.radius > b.max.z) continue;
      // landing on top
      if (delta.y <= 0 && b.max.y <= feetBefore + 0.28 && b.max.y >= agent.pos.y - 0.001) {
        if (b.max.y > groundY) { groundY = b.max.y; groundSurface = cb.surface; }
      } else if (b.max.y <= agent.pos.y + 0.02 && b.min.y >= agent.pos.y - 0.55) {
        // resting contact (flat ground under feet)
        if (b.max.y > groundY) { groundY = b.max.y; groundSurface = cb.surface; }
      }
      // head bump
      if (delta.y > 0 && b.min.y >= headY - 0.35 && b.min.y <= feetBefore + agent.height + Math.abs(delta.y)) {
        if (b.min.y < ceilingY) ceilingY = b.min.y;
      }
    }
    void feetCircleMinY;

    if (delta.y <= 0 && agent.pos.y <= groundY + 0.001 && groundY > -Infinity) {
      agent.pos.y = groundY;
      result.grounded = true;
      result.groundY = groundY;
      result.groundSurface = groundSurface;
    } else {
      // still check resting ground (zero delta.y)
      const rest = this.groundBelow(agent);
      if (rest !== null && Math.abs(agent.pos.y - rest.y) < 0.02 && delta.y <= 0) {
        agent.pos.y = rest.y;
        result.grounded = true;
        result.groundY = rest.y;
        result.groundSurface = rest.surface;
      } else {
        result.groundY = groundY;
      }
    }
    if (delta.y > 0 && agent.pos.y + agent.height > ceilingY && ceilingY < Infinity) {
      agent.pos.y = Math.max(feetBefore, ceilingY - agent.height - 0.01);
      result.headBump = true;
    }

    // safety net: never fall below world floor (bounds handled by caller too)
    return result;
  }

  /** Highest walkable surface directly under the agent within 0.6m. */
  groundBelow(agent: CapsuleAgent): { y: number; surface: string } | null {
    const nearby = this.queryNear(agent.pos, agent.radius + 0.02, agent.pos.y - 0.62, agent.pos.y + 0.1);
    let best: { y: number; surface: string } | null = null;
    for (const cb of nearby) {
      if (!cb.enabled || !cb.solid) continue;
      const b = cb.box;
      if (agent.pos.x + agent.radius * 0.7 < b.min.x || agent.pos.x - agent.radius * 0.7 > b.max.x) continue;
      if (agent.pos.z + agent.radius * 0.7 < b.min.z || agent.pos.z - agent.radius * 0.7 > b.max.z) continue;
      const dy = agent.pos.y - b.max.y;
      if (dy >= -0.02 && dy <= 0.6 && (!best || b.max.y > best.y)) {
        best = { y: b.max.y, surface: cb.surface };
      }
    }
    return best;
  }

  /** Returns true when horizontal movement was blocked (position clamped). */
  private resolveHorizontalAxis(agent: CapsuleAgent, axis: 'x' | 'z', dirSign: number): boolean {
    let blocked = false;
    const region: AABB = {
      min: { x: agent.pos.x - agent.radius - 0.02, y: agent.pos.y + 0.02, z: agent.pos.z - agent.radius - 0.02 },
      max: { x: agent.pos.x + agent.radius + 0.02, y: agent.pos.y + agent.height - 0.02, z: agent.pos.z + agent.radius + 0.02 },
    };
    const hits = this.queryRegion(region);
    for (const cb of hits) {
      const b = cb.box;
      // vertical overlap?
      if (b.max.y <= agent.pos.y + 0.02 || b.min.y >= agent.pos.y + agent.height - 0.02) continue;
      if (axis === 'x') {
        if (agent.pos.x + agent.radius > b.min.x && agent.pos.x - agent.radius < b.max.x) {
          if (dirSign > 0) agent.pos.x = b.min.x - agent.radius - 0.001;
          else agent.pos.x = b.max.x + agent.radius + 0.001;
          blocked = true;
        }
      } else {
        if (agent.pos.z + agent.radius > b.min.z && agent.pos.z - agent.radius < b.max.z) {
          if (dirSign > 0) agent.pos.z = b.min.z - agent.radius - 0.001;
          else agent.pos.z = b.max.z + agent.radius + 0.001;
          blocked = true;
        }
      }
    }
    return blocked;
  }

  /** Attempt to raise agent onto a step obstacle then retry the move. */
  private tryStepUp(agent: CapsuleAgent, retry: () => boolean): boolean {
    const region: AABB = {
      min: { x: agent.pos.x - agent.radius - 0.05, y: agent.pos.y, z: agent.pos.z - agent.radius - 0.05 },
      max: { x: agent.pos.x + agent.radius + 0.05, y: agent.pos.y + agent.stepHeight + 0.05, z: agent.pos.z + agent.radius + 0.05 },
    };
    let candidateY = -Infinity;
    for (const cb of this.queryRegion(region)) {
      if (!cb.enabled || (!cb.step && !cb.solid)) continue;
      const b = cb.box;
      const top = b.max.y;
      if (top > agent.pos.y + 0.02 && top <= agent.pos.y + agent.stepHeight && top > candidateY) {
        // require headroom above candidate
        candidateY = top;
      }
    }
    if (candidateY === -Infinity) return false;
    const origY = agent.pos.y;
    agent.pos.y = candidateY + 0.02;
    // check headroom at new height
    const headRegion: AABB = {
      min: { x: agent.pos.x - agent.radius, y: agent.pos.y, z: agent.pos.z - agent.radius },
      max: { x: agent.pos.x + agent.radius, y: agent.pos.y + agent.height, z: agent.pos.z + agent.radius },
    };
    for (const cb of this.queryRegion(headRegion)) {
      if (cb.enabled && cb.solid) {
        const b = cb.box;
        if (b.max.y > agent.pos.y + 0.05 && b.min.y < agent.pos.y + agent.height - 0.02) {
          // blocked at raised height
          agent.pos.y = origY;
          return false;
        }
      }
    }
    if (retry()) {
      // still blocked even after step up
      agent.pos.y = origY;
      return false;
    }
    return true;
  }

  /** Is a point inside any solid box? (spawn validation) */
  isPointBlocked(p: Vec3, radius = 0.1): boolean {
    const region: AABB = {
      min: { x: p.x - radius, y: p.y + 0.05, z: p.z - radius },
      max: { x: p.x + radius, y: p.y + 1.6, z: p.z + radius },
    };
    for (const cb of this.queryRegion(region)) {
      if (!cb.enabled || !cb.solid) continue;
      const b = cb.box;
      if (b.max.y > p.y + 0.15 && b.min.y < p.y + 1.5) return true;
    }
    return false;
  }
}

function computeNormal(origin: Vec3, dir: Vec3, box: AABB, t: number): Vec3 {
  const p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
  const eps = 0.002;
  if (Math.abs(p.x - box.min.x) < eps) return { x: -1, y: 0, z: 0 };
  if (Math.abs(p.x - box.max.x) < eps) return { x: 1, y: 0, z: 0 };
  if (Math.abs(p.y - box.min.y) < eps) return { x: 0, y: -1, z: 0 };
  if (Math.abs(p.y - box.max.y) < eps) return { x: 0, y: 1, z: 0 };
  if (Math.abs(p.z - box.min.z) < eps) return { x: 0, y: 0, z: -1 };
  return { x: 0, y: 0, z: 1 };
}
