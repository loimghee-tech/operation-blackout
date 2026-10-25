/**
 * Crew AI: follows the player and executes commands (follow, hold, regroup,
 * cover, assist, retreat). Crew fire on hostile guards/police in view.
 * The mission layer resolves "assist" completions (hacks, repairs, drilling).
 */
import type { Npc } from './npc';
import type { NpcContext } from './npcBrain';
import { distXZ } from '../core/math';

const ENEMY_RANGE = 34;

export function thinkCrew(n: Npc, ctx: NpcContext): void {
  const c = n.crew;
  if (!c || !n.alive || n.downed) return;
  c.fireCd -= ctx.dt;
  const p = ctx.player;

  // ---- combat: fire at the closest hostile we can see -------------------
  let enemy: Npc | null = null;
  let enemyD = Infinity;
  if (p.alive) {
    for (const e of ctx.npcs) {
      if (!e.alive || e.downed || e.faction === 'civilian' || e.faction === 'crew') continue;
      if (e.state !== 'combat' && e.state !== 'alerted') continue;
      const d = distXZ(e.pos, n.pos);
      if (d > ENEMY_RANGE || d >= enemyD) continue;
      if (!ctx.physics.hasLineOfSight(n.eye(), e.eye())) continue;
      enemy = e;
      enemyD = d;
    }
  }
  if (enemy && c.fireCd <= 0 && enemyD <= c.range) {
    ctx.actions.crewFire?.(n, enemy);
    c.fireCd = 0.6 + ctx.dt;
    n.locoState = 'idle';
    n.faceTo(enemy.pos.x, enemy.pos.z, 6, ctx.dt);
  }

  // ---- movement by mode --------------------------------------------------
  const hpRatio = n.hp / n.maxHp;
  if (hpRatio < 0.35 && enemy) c.mode = 'retreat';

  switch (c.mode) {
    case 'follow': {
      const ang = (Math.PI * 2 * (Number(n.id.length) % 7)) / 7;
      const goal = { x: p.feet.x + Math.cos(ang) * c.followOffset, y: 0, z: p.feet.z + Math.sin(ang) * c.followOffset };
      moveTo(n, ctx, goal, c.followOffset + 1.2, 3.0);
      break;
    }
    case 'regroup':
      moveTo(n, ctx, p.feet, 2.4, 3.4);
      if (distXZ(n.pos, p.feet) < 2.6) c.mode = 'follow';
      break;
    case 'hold':
      if (c.target) moveTo(n, ctx, c.target, 0.9, 2.5);
      else n.locoState = 'idle';
      break;
    case 'cover':
      if (c.target) {
        moveTo(n, ctx, c.target, 0.9, 3.0);
        n.locoState = distXZ(n.pos, c.target) < 1 ? 'idle' : 'run';
      }
      break;
    case 'assist':
      if (c.target) {
        const arrived = moveTo(n, ctx, c.target, 1.0, 2.8);
        if (arrived) {
          n.locoState = 'idle';
          c.assistT -= ctx.dt;
          if (c.assistT <= 0) c.mode = 'follow';
        }
      } else c.mode = 'follow';
      break;
    case 'retreat':
      if (enemy) {
        const dx = n.pos.x - enemy.pos.x, dz = n.pos.z - enemy.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        moveTo(n, ctx, { x: n.pos.x + (dx / l) * 6, y: 0, z: n.pos.z + (dz / l) * 6 }, 0.5, 3.6);
      } else {
        moveTo(n, ctx, p.feet, 3, 3.6);
        if (hpRatio > 0.6 || distXZ(n.pos, p.feet) < 3) c.mode = 'follow';
      }
      break;
  }
  if (!enemy && c.mode !== 'assist' && c.mode !== 'cover' && c.mode !== 'hold') {
    // in-transit crew use the run pose; idle when close to their spot
    if (n.locoState === 'walk' && n.speedNow > 2.5) n.locoState = 'run';
  }
}

/** Walks toward goal; returns true when within arrive distance. */
function moveTo(n: Npc, ctx: NpcContext, goal: { x: number; y: number; z: number }, arrive: number, speed: number): boolean {
  const d = distXZ(n.pos, goal);
  if (d <= arrive) {
    n.clearPath();
    n.locoState = 'idle';
    return true;
  }
  if (!n.path || !n.goal || distXZ(n.goal, goal) > 1.5) {
    if (!n.requestPath(ctx.nav, goal)) { n.locoState = 'idle'; return false; }
  }
  n.locoState = speed >= 3 ? 'run' : 'walk';
  n.followPath(ctx.physics, speed, ctx.dt);
  return false;
}
