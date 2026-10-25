/**
 * NavGrid — a height-aware walkable grid built from LevelData (rooms, stairs,
 * nav-blocking boxes) with dynamic door gating. Implements GridLike for A*.
 *
 * The grid is the NPC pathfinding authority: no NPC walks straight at the
 * player; they follow smoothed A* paths along walkable floor cells.
 */
import type { LevelData, RoomDef, StairDef } from '../world/level';
import type { Vec3 } from '../core/types';
import { findPath, smoothPath, type GridLike, type PathNode } from './pathfind';

const BLOCKED = -1e9;

/** Who is asking for a path: determines which doors they may use. */
export interface NavQuery {
  /** Access tiers this agent may enter (see DoorDef.access). */
  access: Set<string>;
  /** Agent holds keycards / breaching kit: permitted doors are passable even when locked. */
  keys: boolean;
}

export class NavGrid implements GridLike {
  readonly cellSize: number;
  readonly x0: number;
  readonly z0: number;
  readonly width: number;
  readonly height: number;
  readonly maxStep = 0.46;

  /** Floor height per cell, BLOCKED when not walkable. */
  private cells: Float32Array;
  /** Door gates per cell: 0 = none, else doorId index. */
  private doorGate: Int16Array;
  /** Doors registered by index → open flag. */
  private doorOpen: boolean[] = [];
  private doorAccess: string[] = [];
  private doorLocked: boolean[] = [];
  /** Active per-query access context (set only during findWorldPath). */
  private query: NavQuery | null = null;
  /** Temp blockers (deployed barricades, vehicles) — bitmask style counter. */
  private tempBlock: Uint8Array;

  constructor(level: LevelData, cellSize = 0.5, agentRadius = 0.34) {
    this.cellSize = cellSize;
    const b = level.bounds;
    this.x0 = Math.floor(b.x0 / cellSize) * cellSize - cellSize;
    this.z0 = Math.floor(b.z0 / cellSize) * cellSize - cellSize;
    this.width = Math.ceil((b.x1 - this.x0) / cellSize) + 2;
    this.height = Math.ceil((b.z1 - this.z0) / cellSize) + 2;
    const n = this.width * this.height;
    this.cells = new Float32Array(n).fill(BLOCKED);
    this.doorGate = new Int16Array(n).fill(0);
    this.tempBlock = new Uint8Array(n);

    // 1. Rooms: paint walkable floor rectangles.
    for (const room of level.rooms) this.paintRoom(room, agentRadius);

    // 2. Stairs: paint ramp heights.
    for (const s of level.stairs) this.paintStairs(s, agentRadius);

    // 3. Boxes: carve out walls/obstacles/props (expand by agent radius).
    for (const box of level.boxes) {
      const blocksNav = box.blocksNav ?? (box.kind !== 'floor' && box.kind !== 'ceiling');
      if (!blocksNav) continue;
      const step = box.kind === 'step';
      this.carveBox(box.min.x, box.max.x, box.min.z, box.max.z, box.max.y, agentRadius, step);
    }

    // 4. Doors: register gates (closed doors block until opened).
    for (const door of level.doors) {
      const doorIdx = this.doorOpen.length;
      this.doorOpen.push(!!door.startsOpen);
      this.doorAccess.push(door.access);
      this.doorLocked.push(door.locked);
      const cx0 = this.cxOf(door.x0 - agentRadius * 0.4), cx1 = this.cxOf(door.x1 + agentRadius * 0.4);
      const cz0 = this.czOf(door.z0 - agentRadius * 0.4), cz1 = this.czOf(door.z1 + agentRadius * 0.4);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (!this.inBounds(cx, cz)) continue;
          const i = cz * this.width + cx;
          // Door cells are walkable floor (keep existing height; if none, take nearby)
          if (this.cells[i] === BLOCKED) {
            const h = this.nearestFloorHeight(cx, cz);
            if (h === null) continue;
            this.cells[i] = h;
          }
          this.doorGate[i] = doorIdx + 1;
        }
      }
    }
  }

  private paintRoom(room: RoomDef, _agentRadius: number): void {
    const cx0 = this.cxOf(room.x0), cx1 = this.cxOf(room.x1);
    const cz0 = this.czOf(room.z0), cz1 = this.czOf(room.z1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        const i = cz * this.width + cx;
        if (this.cells[i] === BLOCKED) this.cells[i] = room.floorY;
      }
    }
  }

  private paintStairs(s: StairDef, _agentRadius: number): void {
    const cx0 = this.cxOf(s.x0), cx1 = this.cxOf(s.x1);
    const cz0 = this.czOf(s.z0), cz1 = this.czOf(s.z1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        const wx = this.xOf(cx), wz = this.zOf(cz);
        let t = 0;
        if (s.riseAlong === '+x') t = (wx - s.x0) / Math.max(0.001, s.x1 - s.x0);
        else if (s.riseAlong === '-x') t = (s.x1 - wx) / Math.max(0.001, s.x1 - s.x0);
        else if (s.riseAlong === '+z') t = (wz - s.z0) / Math.max(0.001, s.z1 - s.z0);
        else t = (s.z1 - wz) / Math.max(0.001, s.z1 - s.z0);
        t = Math.min(1, Math.max(0, t));
        const i = cz * this.width + cx;
        this.cells[i] = s.bottomY + (s.topY - s.bottomY) * t;
      }
    }
  }

  private carveBox(x0: number, x1: number, z0: number, z1: number, topY: number, agentRadius: number, step: boolean): void {
    // Only carve boxes that stand above the floor meaningfully (walls, desks),
    // but allow low 'step' boxes to remain walkable with their top as height.
    const cx0 = this.cxOf(x0 - agentRadius), cx1 = this.cxOf(x1 + agentRadius);
    const cz0 = this.czOf(z0 - agentRadius), cz1 = this.czOf(z1 + agentRadius);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        const i = cz * this.width + cx;
        if (this.cells[i] === BLOCKED) continue;
        if (step) {
          // step boxes: raise cell to box top if within step height
          if (topY - this.cells[i] > 0 && topY - this.cells[i] <= this.maxStep + 0.12) {
            this.cells[i] = topY;
          } else if (topY - this.cells[i] > this.maxStep + 0.12) {
            this.cells[i] = BLOCKED;
          }
        } else if (topY - this.cells[i] > 0.28) {
          this.cells[i] = BLOCKED;
        }
      }
    }
  }

  private nearestFloorHeight(cx: number, cz: number): number | null {
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const v = this.cells[nz * this.width + nx];
          if (v !== BLOCKED && this.doorGate[nz * this.width + nx] === 0) return v;
        }
      }
    }
    return null;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.width && cz < this.height;
  }

  cxOf(wx: number): number { return Math.floor((wx - this.x0) / this.cellSize); }
  czOf(wz: number): number { return Math.floor((wz - this.z0) / this.cellSize); }
  xOf(cx: number): number { return this.x0 + (cx + 0.5) * this.cellSize; }
  zOf(cz: number): number { return this.z0 + (cz + 0.5) * this.cellSize; }

  isPassable(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) return false;
    const i = cz * this.width + cx;
    if (this.cells[i] === BLOCKED) return false;
    if (this.tempBlock[i] > 0) return false;
    const gate = this.doorGate[i];
    if (gate !== 0) {
      const di = gate - 1;
      const q = this.query;
      if (q) {
        // Access-aware planning: a door is passable when the agent's access tiers include the
        // door's tier and either the door is unlocked or the agent holds keys (staff keycards,
        // breaching kit). Permitted doors are passable even while closed: NPCs open them on arrival.
        if (!q.access.has(this.doorAccess[di])) return false;
        if (this.doorLocked[di] && !q.keys) return false;
        return true;
      }
      if (!this.doorOpen[di]) return false;
    }
    return true;
  }

  setDoorLocked(doorIndex: number, locked: boolean): void {
    if (doorIndex >= 0 && doorIndex < this.doorLocked.length) this.doorLocked[doorIndex] = locked;
  }

  doorAccessOf(doorIndex: number): string { return this.doorAccess[doorIndex] ?? 'public'; }

  /** Passable ignoring door state (used to check "reachable once opened"). */
  isPassableIgnoringDoors(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) return false;
    const i = cz * this.width + cx;
    return this.cells[i] !== BLOCKED && this.tempBlock[i] === 0;
  }

  heightAt(cx: number, cz: number): number {
    if (!this.inBounds(cx, cz)) return 0;
    const v = this.cells[cz * this.width + cx];
    return v === BLOCKED ? 0 : v;
  }

  setDoorOpen(doorIndex: number, open: boolean): void {
    if (doorIndex >= 0 && doorIndex < this.doorOpen.length) this.doorOpen[doorIndex] = open;
  }

  setDoorOpenById(doorIds: string[], doorId: string, open: boolean): void {
    const idx = doorIds.indexOf(doorId);
    if (idx >= 0) this.setDoorOpen(idx, open);
  }

  /** Temp blocker (barricade deployed / vehicle parked / crowd). */
  addTempBlock(wx: number, wz: number, radius: number): void {
    const cx0 = this.cxOf(wx - radius), cx1 = this.cxOf(wx + radius);
    const cz0 = this.czOf(wz - radius), cz1 = this.czOf(wz + radius);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.inBounds(cx, cz)) this.tempBlock[cz * this.width + cx]++;
      }
    }
  }

  removeTempBlock(wx: number, wz: number, radius: number): void {
    const cx0 = this.cxOf(wx - radius), cx1 = this.cxOf(wx + radius);
    const cz0 = this.czOf(wz - radius), cz1 = this.czOf(wz + radius);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.inBounds(cx, cz)) {
          const i = cz * this.width + cx;
          if (this.tempBlock[i] > 0) this.tempBlock[i]--;
        }
      }
    }
  }

  worldToCell(p: Vec3): { cx: number; cz: number } {
    return { cx: this.cxOf(p.x), cz: this.czOf(p.z) };
  }

  cellToWorld(cx: number, cz: number): Vec3 {
    return { x: this.xOf(cx), y: this.heightAt(cx, cz), z: this.zOf(cz) };
  }

  /** Nearest passable cell to a world point (spiral search). */
  nearestPassableCell(p: Vec3, maxRadius = 8): { cx: number; cz: number } | null {
    const c0 = this.worldToCell(p);
    if (this.isPassable(c0.cx, c0.cz)) return c0;
    const maxR = Math.ceil(maxRadius / this.cellSize);
    for (let r = 1; r <= maxR; r++) {
      let best: { cx: number; cz: number; d: number } | null = null;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = c0.cx + dx, cz = c0.cz + dz;
          if (!this.isPassable(cx, cz)) continue;
          // also require similar height (avoid teleporting floors)
          if (Math.abs(this.heightAt(cx, cz) - p.y) > 1.2) continue;
          const wx = this.xOf(cx), wz = this.zOf(cz);
          const d = (wx - p.x) ** 2 + (wz - p.z) ** 2;
          if (!best || d < best.d) best = { cx, cz, d };
        }
      }
      if (best) return { cx: best.cx, cz: best.cz };
    }
    return null;
  }

  /** Grid line-of-sight walkability between two cells (for string pulling). */
  segmentClear(a: PathNode, b: PathNode): boolean {
    // Bresenham over cells; allow height differences up to maxStep per cell step.
    let cx = a.cx, cz = a.cz;
    const dx = Math.abs(b.cx - a.cx), dz = Math.abs(b.cz - a.cz);
    const sx = a.cx < b.cx ? 1 : -1, sz = a.cz < b.cz ? 1 : -1;
    let err = dx - dz;
    let guard = 0;
    let lastH = this.heightAt(cx, cz);
    while (guard++ < 4096) {
      if (!this.isPassable(cx, cz)) return false;
      const h = this.heightAt(cx, cz);
      if (Math.abs(h - lastH) > this.maxStep) return false;
      lastH = h;
      if (cx === b.cx && cz === b.cz) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; cx += sx; }
      if (e2 < dx) { err += dx; cz += sz; }
    }
    return false;
  }

  /** Full path query with smoothing. Returns null when unreachable. */
  findWorldPath(from: Vec3, to: Vec3, query: NavQuery | null = null, maxIterations = 20000): PathNode[] | null {
    this.query = query;
    try {
      return this.findWorldPathInner(from, to, maxIterations);
    } finally {
      this.query = null;
    }
  }

  private findWorldPathInner(from: Vec3, to: Vec3, maxIterations: number): PathNode[] | null {
    const startCell = this.nearestPassableCell(from, 2.5);
    const goalCell = this.nearestPassableCell(to, 2.5);
    if (!startCell || !goalCell) return null;
    const raw = findPath(this, startCell.cx, startCell.cz, goalCell.cx, goalCell.cz, maxIterations);
    if (!raw) return null;
    const smoothed = smoothPath(raw, (a, b) => this.segmentClear(a, b));
    // Ensure exact goal point is the last node.
    if (smoothed.length > 0) {
      const last = smoothed[smoothed.length - 1];
      smoothed[smoothed.length - 1] = { ...last, x: to.x, z: to.z, y: this.heightAt(last.cx, last.cz) || to.y };
    }
    return smoothed;
  }

  /** Debug: render walkable cells (used by debug overlay). */
  snapshotPassability(): { width: number; height: number; x0: number; z0: number; cellSize: number; cells: Float32Array } {
    return { width: this.width, height: this.height, x0: this.x0, z0: this.z0, cellSize: this.cellSize, cells: this.cells };
  }
}
