/**
 * NpcManager: owns every NPC in the active level.
 *  - spawning (async visuals, procedural fallback)
 *  - level-of-detail: distant NPCs think less often and animate less
 *  - door handling for NPCs (open on approach when permitted, auto-close)
 *  - hit resolution for the player's bullets and NPC bullets
 *  - bodies and downed state
 */
import * as THREE from 'three';
import type { AlertState, Vec3 } from '../core/types';
import { Npc, type NpcSpec } from './npc';
import { thinkNpc, hearNoises, type NpcContext, type PlayerSnapshot } from './npcBrain';
import { thinkCrew } from './crewBrain';
import { CharacterLibrary, createHuman } from '../characters/human';
import type { LevelRuntime, DoorRuntime } from '../world/builder';
import { setDoorState } from '../world/builder';
import { type NoiseEvent } from './perception';
import { dist, distXZ } from '../core/math';
import { BALANCE, type DifficultyConfig } from '../config/balance';
import type { Rng } from '../core/rng';

export type HitZone = 'head' | 'torso' | 'limb';

export interface NpcHit {
  npc: Npc;
  zone: HitZone;
  dist: number;
}

export interface NpcManagerEvents {
  onStateChanged(n: Npc, from: AlertState, to: AlertState): void;
  onBark(n: Npc, line: string, kind: 'speech' | 'radio' | 'shout'): void;
  onDown(n: Npc, lethal: boolean, byPlayer: boolean): void;
  onNpcHit(n: Npc, zone: HitZone, dmg: number, killed: boolean): void;
  onPlayerHit(dmg: number, from: Npc, zone: HitZone): void;
  onCivilianHarmed(n: Npc): void;
  onRadio(from: Npc, level: number): void;
  onWitness(n: Npc, what: string): void;
  onGunfire(n: Npc, pos: Vec3): void;
}

export class NpcManager {
  readonly npcs: Npc[] = [];
  readonly byId = new Map<string, Npc>();
  readonly noises: NoiseEvent[] = [];
  readonly bodies: Array<{ id: string; pos: Vec3 }> = [];
  private pending: Array<Promise<void>> = [];
  private scene: THREE.Scene;
  private rng: Rng;
  private lib: CharacterLibrary;
  private level: LevelRuntime;
  private time = 0;
  playerSnap!: PlayerSnapshot;
  diff: DifficultyConfig;
  events: Partial<NpcManagerEvents> = {};
  /** Dynamic hiding spot usage shared with civilians. */
  hidingSpots: Array<{ id: string; pos: Vec3; capacity: number; used: number }> = [];
  alarmDevices: Vec3[] = [];
  private npcFallbackKeys: string[] = ['Business_Male_01', 'Security_Male_01'];
  private doorTimers = new Map<string, number>();
  private nextBodyId = 0;

  constructor(scene: THREE.Scene, level: LevelRuntime, lib: CharacterLibrary, diff: DifficultyConfig, rng: Rng) {
    this.scene = scene;
    this.level = level;
    this.lib = lib;
    this.diff = diff;
    this.rng = rng;
    this.hidingSpots = level.hiding.map((h) => ({ id: h.id, pos: h.position, capacity: h.capacity, used: 0 }));
  }

  get pendingVisuals(): number { return this.pending.length; }

  spawn(spec: NpcSpec): Npc {
    const n = new Npc(spec);
    this.npcs.push(n);
    this.byId.set(n.id, n);
    const p = createHuman(this.lib, spec.appearance ?? {}, this.npcFallbackKeys).then((vis) => {
      if (!this.byId.has(n.id)) { vis.dispose(); return; }
      n.visual = vis;
      if (spec.heldWeapon) n.visual.attachHeld(makeHeldPlaceholder());
      vis.root.position.set(n.pos.x, n.pos.y, n.pos.z);
      this.scene.add(vis.root);
    }).catch((err) => {
      console.warn('[npc] visual failed for', n.id, err);
    });
    this.pending.push(p);
    return n;
  }

  remove(id: string): void {
    const i = this.npcs.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [n] = this.npcs.splice(i, 1);
    this.byId.delete(id);
    if (n.visual) { this.scene.remove(n.visual.root); n.visual.dispose(); }
  }

  clear(): void {
    for (const n of this.npcs) if (n.visual) { this.scene.remove(n.visual.root); n.visual.dispose(); }
    this.npcs.length = 0;
    this.byId.clear();
    this.bodies.length = 0;
    this.noises.length = 0;
  }

  emitNoise(e: NoiseEvent): void { this.noises.push(e); }

  /** Dispatches the NPC simulation for one frame. */
  update(dt: number, time: number, playerSnap: PlayerSnapshot, rng: Rng, raiseAlarm: (l: number, r: string) => void): void {
    this.time = time;
    this.playerSnap = playerSnap;
    const ctx: NpcContext = {
      time, dt, diff: this.diff, rng, player: playerSnap, physics: this.level.physics, nav: this.level.nav,
      noises: this.noises, hidingSpots: this.hidingSpots, alarmDevices: this.alarmDevices, bodies: this.bodies,
      npcs: this.npcs,
      actions: {
        emitNoise: (e) => this.noises.push(e),
        raiseAlarm,
        radio: (from, level) => this.radio(from, level),
        fireAt: (n, eye) => this.npcFire(n, eye),
        bark: (n, line, kind = 'speech') => { if (kind !== 'speech' || n.barkCd <= 0) this.events.onBark?.(n, line, kind); },
        stateChanged: (n, from, to) => this.events.onStateChanged?.(n, from, to),
        witnessed: (n, what) => this.events.onWitness?.(n, what),
      },
    };

    for (const n of this.npcs) {
      if (!n.alive) continue;
      // Hearing every frame keeps sounds from being lost to the LOD think schedule.
      hearNoises(n, ctx);
      const dp = distXZ(n.pos, playerSnap.feet);
      // LOD: distant NPCs think at 4 Hz unless engaged; animation is skipped beyond 55 m.
      n.lod = dp > 45 && n.state !== 'combat' && n.state !== 'alerted' ? 1 : 0;
      if (n.lod === 1) {
        n.radioCd -= dt;
        n.lodAcc += dt;
        if (n.lodAcc < 0.25) {
          this.stepMovement(n, dt, ctx);
          continue;
        }
        const step = n.lodAcc;
        n.lodAcc = 0;
        ctx.dt = step;
        thinkNpc(n, ctx);
        ctx.dt = dt;
      } else {
        if (n.kind === 'crew') thinkCrew(n, ctx); else thinkNpc(n, ctx);
      }
      this.stepMovement(n, dt, ctx);
    }
    this.separate();
    this.updateDoors(dt);
    this.syncVisuals(dt);
    this.noises.length = 0;
  }

  /** Movement executes after decisions: keeps visual state consistent. */
  private stepMovement(n: Npc, dt: number, ctx: NpcContext): void {
    if (n.downed || !n.alive) {
      if (n.lod === 0) n.speedNow = 0;
      return;
    }
    if (n.kind === 'crew') return;
    // Non-moving NPCs still snap to the floor (gravity) so they never hover.
    if (!n.path) {
      this.level.physics.moveCapsule(n.capsule, { x: 0, y: -2 * dt, z: 0 });
      n.speedNow = 0;
    }
    void ctx;
  }

  /** Simple personal-space separation so NPCs do not stack or block doorways. */
  private separate(): void {
    const list = this.npcs;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.36 * 0.36 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (0.36 - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        a.pos.x += nx * push; a.pos.z += nz * push;
        b.pos.x -= nx * push; b.pos.z -= nz * push;
      }
    }
  }

  private syncVisuals(dt: number): void {
    const pl = this.playerSnap.feet;
    for (const n of this.npcs) {
      const v = n.visual;
      if (!v) continue;
      v.root.position.set(n.pos.x, n.pos.y, n.pos.z);
      v.root.rotation.y = n.yaw;
      if (!n.alive || n.downed) {
        v.setState('dead', 0, false);
      } else if (n.hidden) {
        v.setState('crouch', 0, false);
      } else if (n.kind === 'crew') {
        v.setState(n.locoState, n.speedNow, false);
      } else {
        v.setState(n.locoState, n.speedNow, n.state === 'combat' && !!n.weapon);
      }
      // Animation LOD: full rate within 22 m, 15 Hz to 55 m, frozen beyond that.
      const d = distXZ(n.pos, pl);
      n.visAcc += dt;
      if (d < 22) {
        v.update(n.visAcc, true);
        n.visAcc = 0;
      } else if (d < 55) {
        if (n.visAcc >= 1 / 15) { v.update(n.visAcc, true); n.visAcc = 0; }
      } else {
        n.visAcc = 0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Doors (NPC-driven: open when permitted and close when nobody is near)
  // -------------------------------------------------------------------------
  private updateDoors(dt: number): void {
    const doorTimers = this.doorTimers;
    for (const d of this.level.doorList) {
      const cx = (d.def.x0 + d.def.x1) / 2, cz = (d.def.z0 + d.def.z1) / 2;
      let occupied = distXZ({ x: cx, y: 0, z: cz }, this.playerSnap.feet) < 1.6;
      if (!occupied) {
        for (const n of this.npcs) {
          if (n.alive && distXZ({ x: cx, y: 0, z: cz }, n.pos) < 1.6) { occupied = true; break; }
        }
      }
      if (!d.open) {
        // NPCs holding the door's access tier open it when they approach.
        for (const n of this.npcs) {
          if (!n.alive || n.downed) continue;
          if (distXZ({ x: cx, y: 0, z: cz }, n.pos) > 1.5) continue;
          if (!n.access.has(d.def.access)) continue;
          if (d.locked && !n.query.keys) continue;
          setDoorState(this.level, d.def.id, true);
          doorTimers.set(d.def.id, 0);
          break;
        }
      } else {
        const t = (doorTimers.get(d.def.id) ?? 0) + (occupied ? 0 : dt);
        doorTimers.set(d.def.id, occupied ? 0 : t);
        const permanent = d.def.id === 'd_front';
        if (!permanent && !occupied && t > 3 && !this.isPanelBlocked(d)) {
          setDoorState(this.level, d.def.id, false);
        }
      }
    }
  }

  private isPanelBlocked(d: DoorRuntime): boolean {
    // Don't close onto someone standing right in the panel.
    const cx = (d.def.x0 + d.def.x1) / 2, cz = (d.def.z0 + d.def.z1) / 2;
    if (distXZ(this.playerSnap.feet, { x: cx, y: 0, z: cz }) < 1.0) return true;
    return this.npcs.some((n) => n.alive && distXZ(n.pos, { x: cx, y: 0, z: cz }) < 1.0);
  }

  // -------------------------------------------------------------------------
  // Radio, fire, damage
  // -------------------------------------------------------------------------
  radio(from: Npc, level: number): void {
    for (const n of this.npcs) {
      if (n === from || !n.alive || n.downed || !n.isCombatant) continue;
      if (distXZ(n.pos, from.pos) > BALANCE.npc.radioRange) continue;
      if (n.state === 'combat' || n.state === 'alerted') continue;
      n.investigateAt = { ...(from.lastSeen ?? from.pos) };
      n.suspicion = Math.max(n.suspicion, 45);
      if (n.state === 'unaware' || n.state === 'returning' || n.state === 'curious' || n.state === 'suspicious' || n.state === 'searching') {
        n.setState('investigating');
        n.stateT = 0;
        this.events.onStateChanged?.(n, 'unaware', 'investigating');
      }
    }
    this.events.onRadio?.(from, level);
  }

  private npcFire(n: Npc, targetEye: Vec3): void {
    const w = n.weapon;
    if (!w) return;
    const eye = n.eye({ x: 0, y: 0, z: 0 });
    const d = dist(eye, targetEye);
    const p = this.playerSnap;
    let acc = w.accuracy * this.diff.enemyAccuracyMult * (0.8 + 0.1 * n.skill);
    if (p.stance === 'crouch') acc *= 0.85;
    if (p.moving) acc *= 0.8;
    if (p.hidden) acc *= 0.5;
    const falloff = Math.max(0, (d - w.range * 0.5) / Math.max(1, w.range));
    acc *= Math.max(0.15, 1 - falloff);
    // Shots at point-blank always get some chance; keeps combat readable.
    acc = Math.min(0.95, acc);
    this.events.onGunfire?.(n, eye);
    if (this.rng.next() < acc) {
      const r = this.rng.next();
      const zone: HitZone = r < 0.12 ? 'head' : r < 0.8 ? 'torso' : 'limb';
      const base = w.damage * this.diff.enemyDamageMult;
      const mult = zone === 'head' ? 2.2 : zone === 'limb' ? 0.55 : 1;
      this.events.onPlayerHit?.(base * mult, n, zone);
    }
  }

  /** Hitscan against NPC cylinders. Returns nearest hit within maxDist (walls are checked by caller). */
  raycastNpcs(origin: Vec3, dir: Vec3, maxDist: number, ignore?: Npc): NpcHit | null {
    let best: NpcHit | null = null;
    for (const n of this.npcs) {
      if (!n.alive || n === ignore) continue;
      const hit = rayCylinderY(origin, dir, n.pos.x, n.pos.z, 0.32, n.pos.y, n.pos.y + 1.84);
      if (hit === null || hit > maxDist) continue;
      if (best && hit >= best.dist) continue;
      const hy = origin.y + dir.y * hit;
      const rel = hy - n.pos.y;
      const zone: HitZone = rel > 1.42 ? 'head' : rel > 0.85 ? 'torso' : 'limb';
      best = { npc: n, zone, dist: hit };
    }
    return best;
  }

  /** Applies damage to an NPC (armour absorbs first). Returns true if this hit killed/downed them. */
  damageNpc(n: Npc, raw: number, zone: HitZone, byPlayer: boolean, lethal: boolean): boolean {
    if (!n.alive || n.downed) return false;
    const zoneMult = zone === 'head' ? 2.2 : zone === 'limb' ? 0.6 : 1;
    let dmg = raw * zoneMult;
    if (n.armor > 0 && zone !== 'limb') {
      const absorbed = Math.min(n.armor, dmg * 0.6);
      n.armor -= absorbed;
      dmg -= absorbed;
    }
    n.hp -= dmg;
    n.hitRecentT = this.time;
    const killed = n.hp <= 0;
    this.events.onNpcHit?.(n, zone, dmg, killed);
    if (byPlayer && n.kind === 'civilian') this.events.onCivilianHarmed?.(n);
    if (killed || (!lethal && n.hp <= 0)) {
      if (lethal) {
        n.dieLethal();
        this.bodies.push({ id: `body_${this.nextBodyId++}`, pos: { ...n.pos } });
        this.events.onDown?.(n, true, byPlayer);
        this.emitNoise({ pos: n.pos, radius: 10, loudness: 0.4, kind: 'body' });
      } else {
        n.downed = true;
        n.downedLethal = false;
        n.downT = this.diff.bleedoutSeconds * 0.6 + 12;
        n.path = null;
        this.events.onDown?.(n, false, byPlayer);
      }
      return true;
    }
    // Being shot makes NPCs alert
    if (byPlayer && n.isCombatant) {
      n.suspicion = Math.max(n.suspicion, BALANCE.detection.combatAt);
      if (n.state !== 'combat') n.setState('combat');
      n.lastSeen = { ...this.playerSnap.feet };
      n.lastSeenT = this.time;
    }
    if (byPlayer && n.kind === 'civilian') { n.suspicion = 100; n.setState('combat'); }
    return false;
  }

  /** Non-lethal takedown (taser, bat, knockout). */
  incapacitate(n: Npc, seconds: number): void {
    if (!n.alive || n.downed) return;
    n.downed = true;
    n.downedLethal = false;
    n.downT = seconds;
    n.path = null;
    n.hp = Math.max(1, n.hp);
    this.events.onDown?.(n, false, true);
  }

  nearestNpc(p: Vec3, radius: number, pred?: (n: Npc) => boolean): Npc | null {
    let best: Npc | null = null;
    let bestD = radius * radius;
    for (const n of this.npcs) {
      if (!n.alive) continue;
      if (pred && !pred(n)) continue;
      const d = (n.pos.x - p.x) ** 2 + (n.pos.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

}

/** Ray vs vertical cylinder (axis = Y). Returns entry distance or null. */
export function rayCylinderY(o: Vec3, d: Vec3, cx: number, cz: number, r: number, y0: number, y1: number): number | null {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  let t: number | null = null;
  if (a < 1e-9) {
    if (c > 0) return null;
    // ray vertical: only y-range test
    if (d.y === 0) return null;
    const t0 = (y0 - o.y) / d.y, t1 = (y1 - o.y) / d.y;
    const tt = Math.min(t0, t1);
    return tt >= 0 ? tt : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  for (const tc of [t1, t2]) {
    if (tc < 0) continue;
    const y = o.y + d.y * tc;
    if (y >= y0 && y <= y1) { t = tc; break; }
  }
  return t;
}

function makeHeldPlaceholder(): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.42), new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.5, metalness: 0.4 }));
  m.position.set(0, 0, 0.2);
  g.add(m);
  g.position.set(0.02, -0.02, 0.06);
  return g;
}
