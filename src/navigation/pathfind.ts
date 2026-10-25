/**
 * A* pathfinding on the nav grid with a binary heap. Pure logic, testable.
 */

export interface GridLike {
  width: number;
  height: number;
  x0: number;
  z0: number;
  cellSize: number;
  isPassable(cx: number, cz: number): boolean;
  heightAt(cx: number, cz: number): number;
  maxStep: number;
}

export interface PathNode {
  x: number;   // world
  y: number;
  z: number;
  cx: number;  // grid
  cz: number;
}

/** Minimal binary min-heap keyed by f score. */
class MinHeap {
  private items: number[] = [];
  private keys: Float64Array;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
  }

  setKey(index: number, k: number): void { this.keys[index] = k; }

  get size(): number { return this.items.length; }

  push(index: number): void {
    const items = this.items;
    items.push(index);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[items[parent]] <= this.keys[items[i]]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let smallest = i;
        if (l < items.length && this.keys[items[l]] < this.keys[items[smallest]]) smallest = l;
        if (r < items.length && this.keys[items[r]] < this.keys[items[smallest]]) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

/**
 * A* over 8-connected grid. Returns world-space node list (start → goal) or null.
 * Diagonal moves require both orthogonal neighbours passable (no corner cutting)
 * and a height difference within grid.maxStep between adjacent cells.
 */
export function findPath(
  grid: GridLike,
  startCx: number, startCz: number,
  goalCx: number, goalCz: number,
  maxIterations = 20000,
): PathNode[] | null {
  const { width, height } = grid;
  if (!grid.isPassable(goalCx, goalCz)) return null;
  if (startCx === goalCx && startCz === goalCz) {
    return [cellToWorld(grid, startCx, startCz)];
  }
  const n = width * height;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(n);

  const idx = (cx: number, cz: number): number => cz * width + cx;
  const startIdx = idx(startCx, startCz);
  const goalIdx = idx(goalCx, goalCz);
  gScore[startIdx] = 0;
  heap.setKey(startIdx, heuristic(grid, startCx, startCz, goalCx, goalCz));
  heap.push(startIdx);

  let iterations = 0;
  while (heap.size > 0 && iterations++ < maxIterations) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) return reconstruct(grid, cameFrom, cur, width);

    const cx = cur % width;
    const cz = (cur - cx) / width;
    const curG = gScore[cur];
    const curH = grid.heightAt(cx, cz);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        if (!grid.isPassable(nx, nz)) continue;
        // no corner cutting
        if (dx !== 0 && dz !== 0) {
          if (!grid.isPassable(cx + dx, cz) || !grid.isPassable(cx, cz + dz)) continue;
        }
        // height (stairs) check
        const nh = grid.heightAt(nx, nz);
        if (Math.abs(nh - curH) > grid.maxStep) continue;

        const nIdx = idx(nx, nz);
        if (closed[nIdx]) continue;
        const step = (dx !== 0 && dz !== 0) ? SQRT2 : 1;
        const tentative = curG + step * grid.cellSize;
        if (tentative < gScore[nIdx]) {
          gScore[nIdx] = tentative;
          cameFrom[nIdx] = cur;
          heap.setKey(nIdx, tentative + heuristic(grid, nx, nz, goalCx, goalCz));
          heap.push(nIdx);
        }
      }
    }
  }
  return null; // no path
}

function heuristic(grid: GridLike, cx: number, cz: number, gx: number, gz: number): number {
  const dx = Math.abs(cx - gx), dz = Math.abs(cz - gz);
  return grid.cellSize * (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz));
}

function cellToWorld(grid: GridLike, cx: number, cz: number): PathNode {
  return {
    x: grid.x0 + (cx + 0.5) * grid.cellSize,
    y: grid.heightAt(cx, cz),
    z: grid.z0 + (cz + 0.5) * grid.cellSize,
    cx, cz,
  };
}

function reconstruct(grid: GridLike, cameFrom: Int32Array, endIdx: number, width: number): PathNode[] {
  const out: PathNode[] = [];
  let cur = endIdx;
  while (cur !== -1) {
    const cx = cur % width;
    const cz = (cur - cx) / width;
    out.push(cellToWorld(grid, cx, cz));
    cur = cameFrom[cur];
  }
  out.reverse();
  return out;
}

/**
 * String-pull smoothing: skip waypoints when a straight grid line is walkable.
 * `losClear(cx0,cz0,cx1,cz1)` must return true when the segment is passable.
 */
export function smoothPath(path: PathNode[], losClear: (a: PathNode, b: PathNode) => boolean): PathNode[] {
  if (path.length <= 2) return path;
  const out: PathNode[] = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let furthest = anchor + 1;
    for (let j = Math.min(path.length - 1, anchor + 16); j > anchor + 1; j--) {
      if (losClear(path[anchor], path[j])) { furthest = j; break; }
    }
    out.push(path[furthest]);
    anchor = furthest;
  }
  return out;
}
