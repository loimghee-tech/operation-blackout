/**
 * NPC decision-making: perception → memory → alert state → behaviour.
 *
 * Alert states (spec §7): unaware, curious, suspicious, investigating, searching,
 * alerted, combat, returning. Transitions are driven by real observations:
 *   - sight (cone + range + LOS + player visibility)
 *   - hearing (noise events attenuated by distance and walls)
 *   - evidence (bodies, weapons drawn in public)
 *   - radio (guards share alerts; receivers investigate the reported position,
 *     they do NOT learn the player's exact position)
 */
import type { AlertState, Vec3 } from '../core/types';
import { Npc } from './npc';
import { BALANCE, type DifficultyConfig } from '../config/balance';
import { evaluateSight, effectiveViewRange, hears, noiseSuspicion, type NoiseEvent } from './perception';
import type { NavGrid } from '../navigation/navgrid';
import type { PhysicsWorld } from '../world/collision';
import type { Rng } from '../core/rng';
import { dist, distXZ } from '../core/math';

export interface PlayerSnapshot {
  alive: boolean;
  downed: boolean;
  feet: Vec3;
  eye: Vec3;
  moving: boolean;
  sprinting: boolean;
  stance: 'stand' | 'crouch' | 'prone';
  weaponDrawn: boolean;
  /** Game clock time of the player's last gunshot. */
  lastShotT: number;
  visibility: number;        // from playerVisibility()
  lightLevel: number;
  roomId: string;
  roomTags: string[];
  /** Disguise info */
  disguiseWorn: boolean;
  disguiseSuspicionMult: number;
  disguisePlausible: boolean;
  disguiseAccepted: Array<'guard' | 'civilian' | 'police'>;
  suspicionResist: number;
  hidden: boolean;
  vanish: boolean;
}

export interface NpcContext {
  time: number;
  dt: number;
  diff: DifficultyConfig;
  rng: Rng;
  player: PlayerSnapshot;
  physics: PhysicsWorld;
  nav: NavGrid;
  noises: NoiseEvent[];
  /** Named hiding spots available to civilians. */
  hidingSpots: Array<{ id: string; pos: Vec3; capacity: number; used: number }>;
  /** Positions of closed alarm devices etc. (used by civilians to report). */
  alarmDevices: Vec3[];
  bodies: Array<{ id: string; pos: Vec3 }>;
  actions: {
    emitNoise(e: NoiseEvent): void;
    raiseAlarm(level: number, reason: string): void;
    radio(from: Npc, level: number): void;
    fireAt(n: Npc, eye: Vec3): void;
    bark(n: Npc, line: string, kind?: 'speech' | 'radio' | 'shout'): void;
    stateChanged(n: Npc, from: AlertState, to: AlertState): void;
    witnessed(n: Npc, what: string): void;
    /** Crew shooting at an enemy (resolved by the manager). */
    crewFire?(n: Npc, target: Npc): void;
  };
  /** Other NPCs (for radio ranges). */
  npcs: Npc[];
}

const TMP: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Hearing pass. Runs for every NPC every frame (even when distant NPCs think less often),
 * so no sound is lost to the level-of-detail schedule.
 */
export function hearNoises(n: Npc, ctx: NpcContext): void {
  if (!n.alive || n.downed || ctx.noises.length === 0) return;
  const isGuardLike = n.isCombatant;
  for (const noise of ctx.noises) {
    const los = ctx.physics.hasLineOfSight(n.eye(TMP), noise.pos);
    const h = hears(n.pos, noise, los, ctx.diff.perceptionRangeMult);
    if (!h.heard) continue;
    const add = noiseSuspicion(noise.kind) * h.strength * ctx.diff.suspicionRateMult * (noise.kind === 'footstep' || noise.kind === 'door' ? 1 : 1.2);
    n.suspicion += add;
    if (isGuardLike && (noise.kind === 'gunshot' || noise.kind === 'scream' || noise.kind === 'alarm')) {
      if (n.state !== 'combat') {
        n.investigateAt = { ...noise.pos };
        if (n.state === 'unaware' || n.state === 'curious' || n.state === 'suspicious' || n.state === 'returning' || n.state === 'searching' || n.state === 'investigating') {
          setState(n, 'alerted', ctx);
        }
      }
    } else if (noise.kind === 'body' && h.strength > 0.2) {
      n.witnessed.add('body');
    }
    if (!isGuardLike && (noise.kind === 'gunshot' || noise.kind === 'scream') && h.strength > 0.15 && n.state !== 'combat' && n.state !== 'alerted') {
      n.lookAt = { ...noise.pos };
      setState(n, 'combat', ctx);   // civilians flee away from loud violence
      n.fleeGoal = null;
      ctx.actions.witnessed(n, 'gunfire');
    }
    if (n.state === 'unaware' && noise.kind !== 'footstep' && h.strength > 0.25) {
      n.investigateAt = { ...noise.pos };
    }
  }

}

/** Main per-NPC update (decision + intent). Movement execution is in NpcManager. */
export function thinkNpc(n: Npc, ctx: NpcContext): void {
  if (!n.alive) return;
  if (n.downed) {
    n.downT -= ctx.dt;
    if (!n.downedLethal && n.downT <= 0) {
      n.downed = false;
      n.visual?.setState('idle', 0, false);
      n.setState('returning');
      n.suspicion = 20;
    }
    return;
  }
  n.stateT += ctx.dt;
  n.barkCd -= ctx.dt;
  n.radioCd -= ctx.dt;
  n.fireCd -= ctx.dt;
  if (n.reloadT > 0) n.reloadT -= ctx.dt;
  n.hidden = n.hidden && n.state === 'combat' ? false : n.hidden;

  const p = ctx.player;
  const isGuardLike = n.isCombatant;
  const sightOK = p.alive && !p.downed;

  // ---- 1. Perception ------------------------------------------------------
  let seenThisFrame = false;
  let exposure = 0;
  if (sightOK) {
    const eye = n.eye(TMP);
    const range = effectiveViewRange(n.spec.viewDistance, p.lightLevel, ctx.diff.perceptionRangeMult, p.visibility);
    const fwdX = Math.sin(n.yaw), fwdZ = Math.cos(n.yaw);
    // cheap cone check first; raycast only when the target is plausibly visible
    const quick = evaluateSight({ eye, forwardX: fwdX, forwardZ: fwdZ, fovRad: (BALANCE.npc.fovDegrees * Math.PI) / 180, range, target: p.eye, hasLos: true });
    if (quick.inCone && quick.inRange) {
      const hasLos = ctx.physics.hasLineOfSight(eye, p.eye);
      const r = evaluateSight({ eye, forwardX: fwdX, forwardZ: fwdZ, fovRad: (BALANCE.npc.fovDegrees * Math.PI) / 180, range, target: p.eye, hasLos });
      seenThisFrame = r.seen;
      exposure = r.exposure;
    }
  }
  if (seenThisFrame) {
    n.lastSeen = { x: p.feet.x, y: p.feet.y, z: p.feet.z };
    n.lastSeenT = ctx.time;
    let mult = ctx.diff.suspicionRateMult * (1 - p.suspicionResist);
    if (p.disguiseWorn) mult *= p.disguiseSuspicionMult * (p.disguisePlausible ? 1 : 1.5);
    if (p.disguiseWorn && p.disguiseAccepted.includes(n.faction === 'guard' ? 'guard' : n.faction === 'police' ? 'police' : 'civilian')) mult *= 0.75;
    if (p.weaponDrawn && p.roomTags.includes('public')) mult *= 1.9;
    if (p.hidden) mult *= 0.2;
    const gain = 24 * exposure * mult * ctx.dt;
    n.suspicion += gain;
    // A gunshot in view is decisive for combatants.
    if (p.lastShotT > ctx.time - 1.2 && isGuardLike) n.suspicion = Math.max(n.suspicion, BALANCE.detection.combatAt);
    if (p.lastShotT > ctx.time - 1.2 && !isGuardLike) n.suspicion = Math.max(n.suspicion, BALANCE.detection.alertedAt);
    // Civilians are scared of visible weapons.
    if (!isGuardLike && p.weaponDrawn && exposure > 0.2) n.suspicion = Math.max(n.suspicion, BALANCE.detection.alertedAt);
  } else {
    // Decay: slower while engaged (they remember), faster when calm.
    const decay = BALANCE.npc.suspicionDecay * (n.state === 'combat' || n.state === 'alerted' ? 0.12 : 1);
    n.suspicion = Math.max(0, n.suspicion - decay * ctx.dt);
  }

  // ---- 3. Bodies / evidence in view ---------------------------------------
  if (isGuardLike) {
    for (const b of ctx.bodies) {
      if (distXZ(n.pos, b.pos) < 14 && ctx.physics.hasLineOfSight(n.eye(TMP), { x: b.pos.x, y: 1, z: b.pos.z })) {
        if (!n.witnessed.has(b.id)) {
          n.witnessed.add(b.id);
          n.suspicion = Math.max(n.suspicion, BALANCE.npc.bodyFindSuspicion);
          ctx.actions.bark(n, 'Man down! Check the corridor!', 'shout');
          ctx.actions.witnessed(n, 'body');
          ctx.actions.emitNoise({ pos: b.pos, radius: 12, loudness: 0.6, kind: 'body' });
        }
      }
    }
  }

  // ---- 4. Threshold transitions ------------------------------------------
  const T = BALANCE.detection;
  const s = n.suspicion;
  switch (n.state) {
    case 'unaware':
    case 'returning':
      if (s >= T.curiousAt) setState(n, 'curious', ctx);
      break;
    case 'curious':
      if (s >= T.suspiciousAt) setState(n, 'suspicious', ctx);
      else if (s < T.curiousAt * 0.5 && n.stateT > 2.5) setState(n, 'returning', ctx);
      break;
    case 'suspicious':
      if (!isGuardLike) {
        // Civilians never hunt the player: sustained suspicion makes them flee and report.
        if (s >= T.investigateAt) setState(n, 'alerted', ctx);
        else if (s < T.curiousAt && n.stateT > 4) setState(n, 'returning', ctx);
        break;
      }
      if (s >= T.investigateAt) setState(n, 'investigating', ctx);
      else if (s < T.curiousAt && n.stateT > 4) setState(n, 'returning', ctx);
      break;
    case 'investigating':
      if (s >= T.alertedAt && seenThisFrame) setState(n, 'alerted', ctx);
      break;
    case 'searching':
      if (s >= T.alertedAt && seenThisFrame) setState(n, 'alerted', ctx);
      break;
    case 'alerted':
      if (s >= T.combatAt && seenThisFrame && isGuardLike) setState(n, 'combat', ctx);
      break;
    case 'combat':
      break;
  }
  // Guards who have seen the player at full suspicion go straight to combat.
  if (isGuardLike && seenThisFrame && s >= T.combatAt && n.state !== 'combat') setState(n, 'combat', ctx);
  if (!isGuardLike && n.state === 'alerted' && seenThisFrame && s >= T.alertedAt) { /* stays alerted: witness report */ }

  // ---- 5. Behaviour per state ----------------------------------------------
  switch (n.state) {
    case 'unaware':
      behaveUnaware(n, ctx);
      break;
    case 'curious':
      n.locoState = 'idle';
      if (seenThisFrame) n.lookAt = { ...p.feet };
      else if (n.lastSeen) n.lookAt = n.lastSeen;
      break;
    case 'suspicious':
      if (n.lastSeen) approach(n, ctx, n.lastSeen, isGuardLike ? 3.2 : 2.5, 1.6);
      if (seenThisFrame) n.lookAt = { ...p.feet };
      break;
    case 'investigating': {
      const goal = n.investigateAt ?? n.lastSeen;
      if (!goal) { setState(n, 'searching', ctx); break; }
      const arrived = approach(n, ctx, goal, 1.8, 2.0);
      if (arrived) setState(n, 'searching', ctx);
      break;
    }
    case 'searching':
      behaveSearch(n, ctx);
      break;
    case 'alerted':
      behaveAlerted(n, ctx, seenThisFrame);
      break;
    case 'combat':
      if (isGuardLike) behaveCombat(n, ctx, seenThisFrame);
      else behaveFlee(n, ctx);
      break;
    case 'returning':
      behaveReturn(n, ctx);
      break;
  }
  // Civilians who witnessed violence report it if they can do so safely.
  if (!isGuardLike && (n.state === 'combat' || n.state === 'alerted') && !n.hidden) {
    if (n.reportT < 0) n.reportT = 3.5;
    n.reportT -= ctx.dt;
    if (n.reportT <= 0 && distXZ(n.pos, p.feet) > 6) {
      n.reportT = -1;
      ctx.actions.bark(n, 'Someone call the police!', 'shout');
      ctx.actions.raiseAlarm(1, 'Civilian witness');
      ctx.actions.emitNoise({ pos: n.pos, radius: 18, loudness: 0.5, kind: 'scream' });
      n.witnessed.add('report');
    }
  } else {
    n.reportT = -1;
  }
}

// ---------------------------------------------------------------------------
function setState(n: Npc, next: AlertState, ctx: NpcContext): void {
  const prev = n.setState(next);
  if (!prev) return;
  ctx.actions.stateChanged(n, prev, next);
  n.visual?.setState(n.locoState, 0, false);
  if (next === 'alerted' || next === 'combat') {
    n.investigateAt = n.investigateAt ?? n.lastSeen;
    if (n.isCombatant && n.radioCd <= 0) {
      n.radioCd = 6;
      ctx.actions.radio(n, next === 'combat' ? 2 : 1);
      ctx.actions.bark(n, next === 'combat' ? 'Contact! Eyes on the suspect!' : 'Possible intruder, moving to check.', 'radio');
    }
  }
  if (next === 'searching') {
    n.searchPts = [];
    n.searchIdx = 0;
    const c = n.investigateAt ?? n.lastSeen ?? n.pos;
    for (let i = 0; i < 4; i++) {
      const ang = (Math.PI * 2 * i) / 4 + ctx.rng.range(-0.4, 0.4);
      n.searchPts.push({ x: c.x + Math.cos(ang) * 4.5, y: 0, z: c.z + Math.sin(ang) * 4.5 });
    }
  }
  if (next === 'curious' && n.isCombatant && n.barkCd <= 0) {
    n.barkCd = 8;
    ctx.actions.bark(n, ctx.rng.pick(['Hey, who is that?', 'Who is there?', 'Hello? Anyone there?']), 'speech');
  }
  if (next === 'suspicious' && n.isCombatant && n.barkCd <= 0) {
    n.barkCd = 6;
    ctx.actions.bark(n, 'Something is not right here.', 'speech');
  }
}

function behaveUnaware(n: Npc, ctx: NpcContext): void {
  if (n.lookAt) {
    n.faceTo(n.lookAt.x, n.lookAt.z, 2, ctx.dt);
    n.lookAt = null;
  }
  if (n.kind === 'civilian') {
    if (n.hidden) { n.locoState = 'crouch'; return; }
    wander(n, ctx);
    return;
  }
  if (n.kind === 'staff' || n.kind === 'manager' && !n.spec.patrol?.length) {
    // Stationary staff: idle at the workstation with occasional glances.
    n.locoState = 'idle';
    return;
  }
  if (n.spec.post || !n.spec.patrol?.length) {
    // Sentry post: scan left and right
    n.scanT += ctx.dt;
    n.yaw += Math.sin(n.scanT * 0.6) * ctx.dt * 0.5;
    n.locoState = 'idle';
    return;
  }
  patrol(n, ctx);
}

function patrol(n: Npc, ctx: NpcContext): void {
  const pts = n.spec.patrol!;
  if (n.pauseT > 0) { n.pauseT -= ctx.dt; n.locoState = 'idle'; return; }
  if (!n.path) {
    const goal = pts[n.patrolIdx % pts.length];
    if (!n.requestPath(ctx.nav, goal)) {
      // Unreachable waypoint (e.g. locked door for this role): skip it.
      n.patrolIdx = (n.patrolIdx + 1) % pts.length;
      n.pauseT = 1;
      return;
    }
  }
  n.locoState = 'walk';
  const done = n.followPath(ctx.physics, BALANCE.npc.baseSpeedPatrol, ctx.dt);
  if (done) {
    const pause = n.spec.patrolPause?.[n.patrolIdx % pts.length] ?? 1.5;
    n.patrolIdx = (n.patrolIdx + 1) % pts.length;
    n.pauseT = pause;
    n.locoState = 'idle';
  }
}

function wander(n: Npc, ctx: NpcContext): void {
  const pts = n.spec.wander ?? [];
  if (n.pauseT > 0) { n.pauseT -= ctx.dt; n.locoState = 'idle'; return; }
  if (!n.path) {
    if (pts.length === 0) { n.locoState = 'idle'; return; }
    const goal = ctx.rng.pick(pts);
    n.requestPath(ctx.nav, goal);
    n.pauseT = ctx.rng.range(2, 6);
    if (!n.path) return;
  }
  n.locoState = 'walk';
  const done = n.followPath(ctx.physics, BALANCE.npc.baseSpeedWalk, ctx.dt);
  if (done) { n.pauseT = ctx.rng.range(3, 9); n.locoState = 'idle'; }
}

/** Walks toward a point; returns true when within `arriveDist`. */
function approach(n: Npc, ctx: NpcContext, goal: Vec3, arriveDist: number, speed: number): boolean {
  const d = distXZ(n.pos, goal);
  if (d <= arriveDist) {
    n.faceTo(goal.x, goal.z, 3, ctx.dt);
    n.locoState = 'idle';
    return true;
  }
  if (!n.path || !n.goal || distXZ(n.goal, goal) > 1.5) {
    if (!n.requestPath(ctx.nav, goal)) {
      // unreachable: give up and mark arrival so the brain moves on
      n.locoState = 'idle';
      return n.pathFails > 3;
    }
  }
  n.locoState = speed >= 3 ? 'run' : 'walk';
  const done = n.followPath(ctx.physics, speed, ctx.dt);
  if (done && distXZ(n.pos, goal) > arriveDist + 1) n.requestPath(ctx.nav, goal, true);
  return distXZ(n.pos, goal) <= arriveDist + 0.5;
}

function behaveSearch(n: Npc, ctx: NpcContext): void {
  if (n.stateT > BALANCE.npc.searchTime) { setState(n, 'returning', ctx); return; }
  if (n.searchPts.length === 0) { n.locoState = 'idle'; return; }
  const goal = n.searchPts[n.searchIdx % n.searchPts.length];
  if (approach(n, ctx, goal, 0.8, BALANCE.npc.baseSpeedWalk + 0.3)) {
    n.searchIdx++;
    n.pauseT = 1.2;
  }
  if (n.pauseT > 0) { n.pauseT -= ctx.dt; n.locoState = 'idle'; n.yaw += ctx.dt * 1.2; }
}

function behaveAlerted(n: Npc, ctx: NpcContext, seen: boolean): void {
  if (!n.isCombatant) {
    behaveFlee(n, ctx);
    return;
  }
  if (seen) { n.lookAt = { ...ctx.player.feet }; }
  const goal = n.investigateAt ?? n.lastSeen;
  if (goal && !seen) {
    const arrived = approach(n, ctx, goal, 2.5, BALANCE.npc.baseSpeedRun * 0.8);
    if (arrived) setState(n, 'searching', ctx);
  } else if (!goal) {
    setState(n, 'searching', ctx);
  } else {
    n.locoState = 'idle';
  }
  if (n.stateT > 20 && !seen) setState(n, 'searching', ctx);
}

function behaveCombat(n: Npc, ctx: NpcContext, seen: boolean): void {
  const p = ctx.player;
  const eye = n.eye(TMP);
  const d = dist(eye, p.eye);
  const w = n.weapon;
  if (!p.alive || p.downed) { setState(n, 'returning', ctx); return; }

  // Stop chasing once the player has been unseen for a long time.
  if (!seen && ctx.time - n.lastSeenT > 7) {
    setState(n, 'searching', ctx);
    return;
  }
  const aimPoint = p.feet;
  if (seen) n.lookAt = { ...aimPoint };
  if (n.lookAt) n.faceTo(n.lookAt.x, n.lookAt.z, 5.5, ctx.dt);

  // Cover logic: use cover when hit recently, low on ammo or reloading out of sight.
  const needsCover = (ctx.time - n.hitRecentT < 2.5) || (w && w.mag <= 2 && w.reserve > 0 && n.reloadT <= 0) || (n.hp < n.maxHp * 0.4);
  if (needsCover && (!n.coverPos || n.coverT > 6 || distXZ(n.pos, n.coverPos) < 0.8)) {
    n.coverPos = findCover(n, ctx);
    n.coverT = 0;
  }
  n.coverT += ctx.dt;

  if (n.coverPos && needsCover && distXZ(n.pos, n.coverPos) > 0.8) {
    n.locoState = 'run';
    if (!n.path || !n.goal || distXZ(n.goal, n.coverPos) > 1) n.requestPath(ctx.nav, n.coverPos);
    n.followPath(ctx.physics, BALANCE.npc.baseSpeedCombat, ctx.dt);
  } else if (!seen && n.lastSeen) {
    // Lost sight: push toward last known position, carefully
    approach(n, ctx, n.lastSeen, 6, BALANCE.npc.baseSpeedCombat * 0.7);
  } else {
    // Keep a fighting distance: close in when far, back off when too close
    const preferred = 11 + n.skill * 2;
    if (d > preferred + 4) {
      if (!n.path || !n.goal || distXZ(n.goal, p.feet) > 3) {
        const dirX = p.feet.x - n.pos.x, dirZ = p.feet.z - n.pos.z;
        const l = Math.hypot(dirX, dirZ) || 1;
        n.requestPath(ctx.nav, { x: p.feet.x - (dirX / l) * preferred, y: 0, z: p.feet.z - (dirZ / l) * preferred });
      }
      n.locoState = 'run';
      n.followPath(ctx.physics, BALANCE.npc.baseSpeedCombat, ctx.dt);
    } else {
      n.clearPath();
      n.locoState = 'idle';
    }
  }

  if (w) {
    if (n.reloadT > 0) {
      n.locoState = n.locoState === 'run' ? 'run' : 'idle';
    } else if (w.mag <= 0) {
      n.reloadT = w.reloadTime;
      w.mag = Math.min(w.magSize, w.reserve);
      w.reserve -= w.mag;
      n.visual?.setState('idle', 0, true);
      ctx.actions.bark(n, 'Reloading!', 'speech');
    } else if (seen && n.fireCd <= 0 && d <= w.range * 1.35 && ctx.physics.hasLineOfSight(eye, p.eye)) {
      // visible & in range: shoot (bursts for automatic weapons)
      const burst = Math.max(1, w.burst);
      for (let i = 0; i < burst && w.mag > 0; i++) {
        w.mag--;
        ctx.actions.fireAt(n, p.eye);
      }
      ctx.actions.emitNoise({ pos: n.pos, radius: n.isCombatant ? 26 : 16, loudness: 1, kind: 'gunshot', sourceId: n.id });
      n.fireCd = w.fireInterval * (0.85 + ctx.rng.next() * 0.3);
    }
  }
}

function findCover(n: Npc, ctx: NpcContext): Vec3 | null {
  const p = ctx.player;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 14; i++) {
    const ang = (Math.PI * 2 * i) / 14 + ctx.rng.range(-0.2, 0.2);
    const r = ctx.rng.range(2.5, 7);
    const cand = { x: n.pos.x + Math.cos(ang) * r, y: 0, z: n.pos.z + Math.sin(ang) * r };
    const cell = ctx.nav.nearestPassableCell(cand, 1.5);
    if (!cell) continue;
    const cp = ctx.nav.cellToWorld(cell.cx, cell.cz);
    const hidden = !ctx.physics.hasLineOfSight({ x: cp.x, y: 1.5, z: cp.z }, p.eye);
    if (!hidden) continue;
    const dd = distXZ(cp, n.pos);
    if (dd < bestD) { bestD = dd; best = cp; }
  }
  return best;
}

function behaveFlee(n: Npc, ctx: NpcContext): void {
  // Civilians: run away from the threat, toward exits; hide if a spot is close.
  const threat = n.lookAt ?? ctx.player.feet;
  if (!n.hidden) {
    const spot = ctx.hidingSpots.find((h) => h.used < h.capacity && distXZ(h.pos, n.pos) < 5 && distXZ(h.pos, threat) > 4);
    if (spot && n.stateT > 0.8) {
      if (distXZ(spot.pos, n.pos) < 0.8) {
        n.hidden = true;
        spot.used++;
        n.hideT = 25;
        n.locoState = 'crouch';
        ctx.actions.bark(n, 'Get down! Stay down!', 'shout');
        return;
      }
      if (!n.path || !n.goal || distXZ(n.goal, spot.pos) > 0.6) n.requestPath(ctx.nav, spot.pos);
      n.locoState = 'run';
      n.followPath(ctx.physics, BALANCE.npc.baseSpeedRun, ctx.dt);
      return;
    }
  } else {
    n.hideT -= ctx.dt;
    n.locoState = 'crouch';
    if (n.hideT <= 0 && ctx.time - n.lastSeenT > 6) {
      n.hidden = false;
      n.lookAt = null;
      setState(n, 'returning', ctx);
    }
    return;
  }
  if (!n.fleeGoal || !n.path || distXZ(n.pos, n.fleeGoal) < 1.5) {
    n.fleeGoal = pickFleePoint(n, ctx, threat);
    if (n.fleeGoal) n.requestPath(ctx.nav, n.fleeGoal, true);
  }
  n.locoState = 'run';
  const done = n.followPath(ctx.physics, BALANCE.npc.baseSpeedRun, ctx.dt);
  if (done) n.fleeGoal = null;
  if (n.stateT > 14) {
    setState(n, 'returning', ctx);
    n.fleeGoal = null;
  }
}

function pickFleePoint(n: Npc, ctx: NpcContext, threat: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI * 2 * i) / 10 + ctx.rng.range(-0.3, 0.3);
    const r = ctx.rng.range(10, 18);
    const cand = { x: n.pos.x + Math.cos(ang) * r, y: 0, z: n.pos.z + Math.sin(ang) * r };
    const cell = ctx.nav.nearestPassableCell(cand, 2);
    if (!cell) continue;
    const cp = ctx.nav.cellToWorld(cell.cx, cell.cz);
    const score = distXZ(cp, threat) - 0.5 * distXZ(cp, n.pos);
    if (score > bestScore) { bestScore = score; best = cp; }
  }
  return best;
}

function behaveReturn(n: Npc, ctx: NpcContext): void {
  if (n.kind === 'civilian') {
    n.lookAt = null;
    setState(n, 'unaware', ctx);
    n.suspicion = Math.min(n.suspicion, 10);
    return;
  }
  const pts = n.spec.patrol;
  if (!pts || pts.length === 0) {
    if (n.spec.post || n.kind === 'staff' || n.kind === 'manager') {
      const home = n.spec.position;
      if (distXZ(n.pos, home) > 1.2) {
        approach(n, ctx, home, 1.0, BALANCE.npc.baseSpeedWalk);
      } else {
        n.locoState = 'idle';
        setState(n, 'unaware', ctx);
      }
      return;
    }
    setState(n, 'unaware', ctx);
    return;
  }
  // Return to the nearest patrol waypoint, then resume the route.
  let best = 0, bestD = Infinity;
  pts.forEach((p, i) => { const d = distXZ(p, n.pos); if (d < bestD) { bestD = d; best = i; } });
  n.patrolIdx = best;
  n.lookAt = null;
  if (approach(n, ctx, pts[best], 1.2, BALANCE.npc.baseSpeedPatrol)) {
    setState(n, 'unaware', ctx);
    n.path = null;
  }
}
