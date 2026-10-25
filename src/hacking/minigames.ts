/**
 * Playable fictional hacking minigames (DOM overlay).
 *
 *  - sequence : memorise a symbol sequence, then re-enter it with the arrow keys
 *  - timing   : press SPACE when the sweeping marker is inside the target window (multiple rounds)
 *  - circuit  : rotate pipe tiles (click) until a connected path runs left → right
 *  - pattern  : find every target glyph in a grid before the timer runs out
 *
 * Difficulty (1..5) scales length, speed, window size and time. Each game reports success or failure;
 * the caller applies consequences (strikes, suspicion, alarm, device state).
 */

export type HackKind = 'sequence' | 'timing' | 'circuit' | 'pattern';

export interface HackRequest {
  kind: HackKind;
  level: number;          // 1..5
  label: string;
  timeLimit: number;      // seconds (already scaled by class/skills)
  strikesAllowed: number; // mistakes before failure
  onDone(success: boolean, detail: string): void;
}

interface Session {
  req: HackRequest;
  root: HTMLElement;
  timer: number;
  timerId: number;
  cleanup: Array<() => void>;
  finished: boolean;
}

let current: Session | null = null;
export const hackingActive = (): boolean => current !== null;

const ARROWS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'] as const;
const ARROW_GLYPH: Record<string, string> = { ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓', ArrowLeft: '←' };

/** Starts a hack overlay. Only one can be active. Returns false if one is already running. */
export function startHack(host: HTMLElement, req: HackRequest): boolean {
  if (current) return false;
  const root = document.createElement('div');
  root.className = 'hack-overlay';
  root.innerHTML = `
    <div class="hack-panel" role="dialog" aria-label="Hacking: ${escapeHtml(req.label)}">
      <header><span class="hack-title">${escapeHtml(req.label)}</span><span class="hack-kind">${req.kind.toUpperCase()} · LVL ${req.level}</span></header>
      <div class="hack-body"></div>
      <footer>
        <div class="hack-timer"><div class="hack-timer-fill"></div></div>
        <div class="hack-meta"><span class="hack-strikes"></span><span class="hack-hint"></span></div>
      </footer>
    </div>`;
  host.appendChild(root);
  const session: Session = { req, root, timer: req.timeLimit, timerId: 0, cleanup: [], finished: false };
  current = session;
  const body = root.querySelector('.hack-body') as HTMLElement;
  const fill = root.querySelector('.hack-timer-fill') as HTMLElement;
  const strikesEl = root.querySelector('.hack-strikes') as HTMLElement;
  const hint = root.querySelector('.hack-hint') as HTMLElement;
  let strikes = 0;
  const updateStrikes = () => {
    strikesEl.textContent = `Mistakes: ${strikes}/${req.strikesAllowed}`;
  };
  updateStrikes();

  const finish = (success: boolean, detail: string) => {
    if (session.finished) return;
    session.finished = true;
    clearInterval(session.timerId);
    for (const c of session.cleanup) c();
    root.classList.add(success ? 'hack-success' : 'hack-fail');
    hint.textContent = success ? 'ACCESS GRANTED' : 'ACCESS DENIED';
    setTimeout(() => {
      root.remove();
      if (current === session) current = null;
      req.onDone(success, detail);
    }, 650);
  };

  const mistake = (why: string) => {
    strikes++;
    updateStrikes();
    root.classList.add('hack-shake');
    setTimeout(() => root.classList.remove('hack-shake'), 260);
    hint.textContent = why;
    if (strikes > req.strikesAllowed) finish(false, `Too many mistakes (${why})`);
  };

  // global timer
  session.timerId = window.setInterval(() => {
    session.timer -= 0.1;
    fill.style.width = `${Math.max(0, (session.timer / req.timeLimit) * 100)}%`;
    if (session.timer <= 0) finish(false, 'Timed out');
  }, 100);

  const addKey = (fn: (e: KeyboardEvent) => void) => {
    const h = (e: KeyboardEvent) => {
      if (session.finished) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', h);
    session.cleanup.push(() => window.removeEventListener('keydown', h));
  };

  switch (req.kind) {
    case 'sequence': runSequence(body, hint, req, addKey, mistake, finish); break;
    case 'timing': runTiming(body, hint, req, addKey, mistake, finish, session); break;
    case 'circuit': runCircuit(body, hint, req, finish); break;
    case 'pattern': runPattern(body, hint, req, finish); break;
  }
  return true;
}

/** Cancels the current overlay (e.g. the player is killed). Reports failure. */
export function cancelHack(reason = 'Cancelled'): void {
  if (!current) return;
  const s = current;
  current = null;
  s.finished = true;
  clearInterval(s.timerId);
  for (const c of s.cleanup) c();
  s.root.remove();
  s.req.onDone(false, reason);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

// ---------------------------------------------------------------------------
function runSequence(body: HTMLElement, hint: HTMLElement, req: HackRequest, addKey: (fn: (e: KeyboardEvent) => void) => void, mistake: (why: string) => void, finish: (ok: boolean, d: string) => void): void {
  const len = 3 + Math.min(3, Math.floor((req.level - 1) / 1.5) + 1);  // 4..6
  const seq: string[] = [];
  for (let i = 0; i < len; i++) seq.push(ARROWS[Math.floor(Math.random() * 4)]);
  const show = document.createElement('div');
  show.className = 'hack-seq';
  body.appendChild(show);
  const input = document.createElement('div');
  input.className = 'hack-seq-input';
  body.appendChild(input);
  let shown = 0;
  let entered = 0;
  hint.textContent = 'Memorise the sequence…';
  const stepMs = Math.max(420, 780 - req.level * 60);
  const reveal = window.setInterval(() => {
    if (shown < seq.length) {
      show.textContent = ARROW_GLYPH[seq[shown]];
      shown++;
    } else {
      show.textContent = '';
      clearInterval(reveal);
      hint.textContent = 'Enter the sequence with the arrow keys';
      renderInput();
    }
  }, stepMs);
  const renderInput = () => {
    input.innerHTML = seq.map((_, i) => `<span class="${i < entered ? 'done' : ''}">■</span>`).join('');
  };
  addKey((e) => {
    if (shown < seq.length || !ARROWS.includes(e.code as typeof ARROWS[number])) return;
    if (e.code === seq[entered]) {
      entered++;
      renderInput();
      if (entered === seq.length) finish(true, 'Sequence matched');
    } else {
      entered = 0;
      renderInput();
      mistake('Wrong input — sequence reset');
    }
  });
  // Timer cancel
  req.onDone; // keep reference for lints
  void reveal;
}

function runTiming(body: HTMLElement, hint: HTMLElement, req: HackRequest, addKey: (fn: (e: KeyboardEvent) => void) => void, mistake: (why: string) => void, finish: (ok: boolean, d: string) => void, session: Session): void {
  const rounds = 2 + Math.floor(req.level / 2);     // 2..4
  const windowSize = Math.max(0.07, 0.22 - req.level * 0.025);  // fraction of bar
  const speed = 0.55 + req.level * 0.18;            // bar sweeps per second
  const bar = document.createElement('div');
  bar.className = 'hack-bar';
  bar.innerHTML = '<div class="hack-zone"></div><div class="hack-marker"></div>';
  body.appendChild(bar);
  const zone = bar.querySelector('.hack-zone') as HTMLElement;
  const marker = bar.querySelector('.hack-marker') as HTMLElement;
  const counter = document.createElement('div');
  counter.className = 'hack-rounds';
  body.appendChild(counter);
  let round = 0;
  let zoneStart = 0;
  let t = 0;
  let lastFrame = performance.now();
  const newZone = () => {
    zoneStart = 0.12 + Math.random() * (0.88 - windowSize);
    zone.style.left = `${zoneStart * 100}%`;
    zone.style.width = `${windowSize * 100}%`;
    counter.textContent = `Lock ${round + 1} / ${rounds}`;
  };
  newZone();
  hint.textContent = 'Press SPACE inside the green window';
  let raf = 0;
  const loop = (now: number) => {
    if (session.finished) return;
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    t += dt * speed;
    const pos = Math.abs(((t % 2) - 1)); // triangle wave 0..1..0
    marker.style.left = `${pos * 100}%`;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  session.cleanup.push(() => cancelAnimationFrame(raf));
  addKey((e) => {
    if (e.code !== 'Space') return;
    const pos = Math.abs(((t % 2) - 1));
    if (pos >= zoneStart && pos <= zoneStart + windowSize) {
      round++;
      if (round >= rounds) finish(true, 'All locks released');
      else { hint.textContent = 'Locked. Next tumbler…'; newZone(); setTimeout(() => { hint.textContent = 'Press SPACE inside the green window'; }, 400); }
    } else {
      mistake('Missed the window');
    }
  });
}

function runCircuit(body: HTMLElement, hint: HTMLElement, req: HackRequest, finish: (ok: boolean, d: string) => void): void {
  // 3x4 grid of tiles. Each tile: pipe connections N,E,S,W as bitmask. Types: straight, elbow, tee, empty.
  const W = 4, H = 3;
  type Kind = 'straight' | 'elbow' | 'tee' | 'empty';
  const kinds: Kind[][] = [];
  const rot: number[][] = [];
  // Solution: a path from left (x=0,y=mid) to right (x=W-1,y=mid) with random wandering
  const midY = Math.floor(H / 2);
  const solution: Array<Array<number>> = [];  // connection masks
  for (let y = 0; y < H; y++) { solution.push(new Array(W).fill(0)); kinds.push(new Array(W).fill('empty')); rot.push(new Array(W).fill(0)); }
  // Column-by-column path: each column is a contiguous vertical run, so consecutive cells are always adjacent.
  let y = midY;
  const path: Array<[number, number]> = [];
  for (let cx = 0; cx < W; cx++) {
    let yNext = y;
    if (cx < W - 1 && Math.random() < 0.6) yNext = Math.min(H - 1, Math.max(0, y + (Math.random() < 0.5 ? -1 : 1)));
    const step = yNext >= y ? 1 : -1;
    for (let cy = y; ; cy += step) {
      path.push([cx, cy]);
      if (cy === yNext) break;
    }
    y = yNext;
  }
  // build masks along path: N=1 E=2 S=4 W=8
  for (let i = 0; i < path.length; i++) {
    const [cx, cy] = path[i];
    let m = 0;
    if (i > 0) { const [px, py] = path[i - 1]; m |= dirBit(px - cx, py - cy); }
    if (i < path.length - 1) { const [nx, ny] = path[i + 1]; m |= dirBit(nx - cx, ny - cy); }
    if (i === 0) m |= 8;                 // left edge input
    if (i === path.length - 1) m |= 2;   // right edge output
    solution[cy][cx] = m;
  }
  // The solution path must start on the middle row for the left input.
  void midY;
  // fill other tiles with random extra pipes (decoys)
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    if (solution[yy][xx] === 0) {
      const r = Math.random();
      solution[yy][xx] = r < 0.35 ? 0 : r < 0.7 ? 5 : 3;
    }
  }
  // kinds from masks
  const kindOf = (m: number): Kind => {
    const bits = [m & 1, m & 2, m & 4, m & 8].filter(Boolean).length;
    if (bits === 0) return 'empty';
    if (bits === 2 && ((m & 5) === 5 || (m & 10) === 10)) return 'straight';
    if (bits === 2) return 'elbow';
    return 'tee';
  };
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    kinds[yy][xx] = kindOf(solution[yy][xx]);
    // scramble rotations (0..3 quarter turns)
    rot[yy][xx] = Math.floor(Math.random() * 4);
  }
  // rotated mask
  const rotMask = (m: number, r: number): number => {
    let out = m;
    for (let i = 0; i < r; i++) out = ((out << 1) | (out >> 3)) & 15;
    return out;
  };
  const grid = document.createElement('div');
  grid.className = 'hack-circuit';
  grid.style.gridTemplateColumns = `repeat(${W}, 56px)`;
  body.appendChild(grid);
  const tiles: HTMLElement[][] = [];
  const render = () => {
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const el = tiles[yy][xx];
      el.style.transform = `rotate(${rot[yy][xx] * 90}deg)`;
      el.dataset.kind = kinds[yy][xx];
    }
    if (connected()) setTimeout(() => finish(true, 'Circuit connected'), 200);
  };
  const connected = (): boolean => {
    // BFS from left input tile (0,midY) entering from W, to right exit (W-1,midY) leaving E
    const eff = (xx: number, yy: number) => rotMask(solution[yy][xx], rot[yy][xx]);
    const seen = new Set<string>();
    const q: Array<[number, number]> = [[0, midY]];
    seen.add(`0,${midY}`);
    while (q.length) {
      const [cx, cy] = q.shift()!;
      const m = eff(cx, cy);
      if (cx === W - 1 && (m & 2)) return true;
      const dirs: Array<[number, number, number, number]> = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]];
      for (const [dx, dy, bit, opp] of dirs) {
        if (!(m & bit)) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!(eff(nx, ny) & opp)) continue;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        q.push([nx, ny]);
      }
    }
    return false;
  };
  for (let yy = 0; yy < H; yy++) {
    tiles.push([]);
    for (let xx = 0; xx < W; xx++) {
      const el = document.createElement('button');
      el.className = 'hack-tile';
      el.type = 'button';
      el.setAttribute('aria-label', `Pipe ${xx + 1},${yy + 1}`);
      el.innerHTML = '<span class="pipe"></span>';
      el.addEventListener('click', () => {
        if (kinds[yy][xx] === 'empty') { hint.textContent = 'Nothing to rotate there'; return; }
        rot[yy][xx] = (rot[yy][xx] + 1) % 4;
        render();
        hint.textContent = 'Rotate pipes until power flows from left to right';
      });
      grid.appendChild(el);
      tiles[yy].push(el);
    }
  }
  hint.textContent = 'Rotate pipes until power flows from left to right';
  render();
}

function dirBit(dx: number, dy: number): number {
  if (dx === 0 && dy === -1) return 1;
  if (dx === 1 && dy === 0) return 2;
  if (dx === 0 && dy === 1) return 4;
  if (dx === -1 && dy === 0) return 8;
  return 0;
}

function runPattern(body: HTMLElement, hint: HTMLElement, req: HackRequest, finish: (ok: boolean, d: string) => void): void {
  const glyphs = ['◆', '◇', '●', '○', '▲', '△', '■', '□'];
  const targetCount = 2 + Math.min(3, req.level);
  const total = 16 + req.level * 2;
  const target = glyphs[Math.floor(Math.random() * glyphs.length)];
  const cells: string[] = [];
  for (let i = 0; i < total; i++) cells.push(i < targetCount ? target : glyphs[Math.floor(Math.random() * glyphs.length)]);
  cells.sort(() => Math.random() - 0.5);
  const info = document.createElement('div');
  info.className = 'hack-pattern-target';
  info.textContent = `Locate all ${targetCount} ${target}`;
  body.appendChild(info);
  const grid = document.createElement('div');
  grid.className = 'hack-pattern';
  body.appendChild(grid);
  let found = 0;
  let wrong = 0;
  cells.forEach((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hack-glyph';
    b.textContent = g;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      b.disabled = true;
      if (g === target) {
        found++;
        b.classList.add('hit');
        hint.textContent = `${found}/${targetCount} found`;
        if (found === targetCount) finish(true, 'Pattern located');
      } else {
        wrong++;
        b.classList.add('miss');
        hint.textContent = 'Decoy selected';
        if (wrong > Math.max(2, req.level)) finish(false, 'Too many decoys');
      }
    });
    grid.appendChild(b);
  });
  hint.textContent = `${targetCount} targets hidden in the grid`;
}
