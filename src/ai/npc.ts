/**
 * NPC entity: data, navigation execution and combat stats.
 * Decision-making lives in npcBrain.ts (state machine).
 */
import type { AlertState, NpcRole, Vec3 } from '../core/types';
import type { HumanVisual, LocoState } from '../characters/human';
import type { PathNode } from '../navigation/pathfind';
import type { NavGrid, NavQuery } from '../navigation/navgrid';
import type { PhysicsWorld, CapsuleAgent } from '../world/collision';

export type NpcKind = 'guard' | 'police' | 'civilian' | 'staff' | 'manager' | 'crew';

export type CrewMode = 'follow' | 'hold' | 'regroup' | 'cover' | 'assist' | 'retreat';

export interface CrewState {
  crewId: string;
  mode: CrewMode;
  /** Point for hold/cover/assist commands. */
  target: Vec3 | null;
  /** Remaining seconds of an assist action before reverting to follow. */
  assistT: number;
  /** Mission-supplied flag: crew are ready to perform the assist at target. */
  assistKind: string | null;
  fireCd: number;
  /** Accuracy and damage come from the crew definition. */
  accuracy: number;
  damage: number;
  range: number;
  followOffset: number;
}

export interface NpcWeapon {
  name: string;
  magSize: number;
  mag: number;
  reserve: number;
  reloadTime: number;
  fireInterval: number;   // seconds between shots
  damage: number;         // per hit before armour (torso)
  range: number;          // effective range metres
  accuracy: number;       // 0..1 base hit chance at ~10m
  burst: number;          // shots per burst (1 = single)
  pellets?: number;
}

export interface NpcSpec {
  id: string;
  role: NpcRole;
  kind: NpcKind;
  faction: 'guard' | 'civilian' | 'police' | 'crew' | 'neutral';
  position: Vec3;
  yaw: number;
  access: string[];
  modelKey?: string;
  modelFallbacks?: string[];
  appearance?: import('../core/types').AppearanceSpec;
  patrol?: Vec3[];
  patrolPause?: number[];
  wander?: Vec3[];           // civilian wander points
  heldWeapon?: boolean;
  weapon?: NpcWeapon;
  skill: number;             // 1..3
  hp: number;
  armor: number;
  viewDistance: number;
  post?: boolean;            // stands at home position with scanning
  homeRoom?: string;
  label?: string;            // display name for debug / radio
}

export class Npc {
  readonly id: string;
  readonly role: NpcRole;
  readonly kind: NpcKind;
  readonly faction: NpcSpec['faction'];
  readonly access: Set<string>;
  readonly query: NavQuery;
  readonly skill: number;
  readonly spec: NpcSpec;
  readonly label: string;

  /** Feet position (shared object used directly by the physics capsule). */
  readonly pos: Vec3;
  readonly capsule: CapsuleAgent;
  yaw: number;
  visual: HumanVisual | null = null;

  state: AlertState = 'unaware';
  stateT = 0;
  /** Accumulated suspicion meter 0..100+. */
  suspicion = 0;
  /** Stats */
  hp: number;
  readonly maxHp: number;
  armor: number;
  alive = true;
  /** Non-lethal incapacitation (taser/bat) or lethal down. */
  downed = false;
  downedLethal = false;
  downT = 0;
  hitRecentT = -99;

  // Perception memory
  lastSeen: Vec3 | null = null;
  lastSeenT = -99;
  investigateAt: Vec3 | null = null;
  witnessed = new Set<string>();

  // Navigation
  path: PathNode[] | null = null;
  pathIdx = 0;
  goal: Vec3 | null = null;
  repathT = 0;
  stuckT = 0;
  pathFails = 0;
  /** Patrol/wander bookkeeping */
  patrolIdx = 0;
  pauseT = 0;
  scanT = 0;
  searchPts: Vec3[] = [];
  searchIdx = 0;
  coverPos: Vec3 | null = null;
  coverT = 0;
  fleeGoal: Vec3 | null = null;
  hidden = false;
  hideT = 0;

  // Combat
  weapon: NpcWeapon | null;
  fireCd = 0;
  reloadT = 0;
  burstLeft = 0;
  suppressedUntil = 0;

  // Comms
  barkCd = 0;
  radioCd = 0;
  reportT = -1;
  lookAt: Vec3 | null = null;

  /** Crew-only state (null for enemies and civilians). */
  crew: CrewState | null = null;
  /** LOD accumulator: distant NPCs think at a reduced rate. */
  lodAcc = 0;
  /** Visual animation accumulator (animation LOD). */
  visAcc = 0;

  // Visual state
  locoState: LocoState = 'idle';
  speedNow = 0;
  /** LOD: 0 = full, 1 = reduced (distant) */
  lod = 0;

  constructor(spec: NpcSpec) {
    this.spec = spec;
    this.id = spec.id;
    this.role = spec.role;
    this.kind = spec.kind;
    this.faction = spec.faction;
    this.access = new Set(spec.access);
    this.query = { access: this.access, keys: spec.kind === 'guard' || spec.kind === 'police' || spec.kind === 'manager' || spec.kind === 'staff' };
    this.skill = spec.skill;
    this.label = spec.label ?? spec.id;
    this.pos = { x: spec.position.x, y: spec.position.y, z: spec.position.z };
    this.capsule = { pos: this.pos, radius: 0.34, height: 1.78, stepHeight: 0.42 };
    this.yaw = spec.yaw;
    this.hp = spec.hp;
    this.maxHp = spec.hp;
    this.armor = spec.armor;
    this.weapon = spec.weapon ? { ...spec.weapon, mag: spec.weapon.magSize } : null;
  }

  eye(out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    out.x = this.pos.x; out.y = this.pos.y + (this.hidden ? 1.0 : 1.58); out.z = this.pos.z;
    return out;
  }

  get isCombatant(): boolean {
    return this.kind === 'guard' || this.kind === 'police';
  }

  get isInert(): boolean {
    return !this.alive || this.downed;
  }

  setState(next: AlertState): AlertState | null {
    if (next === this.state) return null;
    const prev = this.state;
    this.state = next;
    this.stateT = 0;
    return prev;
  }

  /** Requests a path to a goal using access-aware navigation. Returns false when unreachable. */
  requestPath(nav: NavGrid, goal: Vec3, force = false): boolean {
    if (!force && this.goal && this.path && Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) < 1.2) return true;
    const path = nav.findWorldPath(this.pos, goal, this.query);
    this.goal = { x: goal.x, y: goal.y, z: goal.z };
    if (!path || path.length === 0) {
      this.path = null;
      this.pathFails++;
      return false;
    }
    this.path = path;
    this.pathIdx = path.length > 1 ? 1 : 0;
    this.pathFails = 0;
    this.stuckT = 0;
    return true;
  }

  clearPath(): void {
    this.path = null;
    this.goal = null;
    this.pathIdx = 0;
  }

  /**
   * Follows the current path for one step. Returns true when the goal is reached
   * (or there is no path). Uses physics capsule movement so walls are never crossed.
   */
  followPath(physics: PhysicsWorld, speed: number, dt: number): boolean {
    if (!this.path) return true;
    if (this.pathIdx >= this.path.length) { this.path = null; return true; }
    const target = this.path[this.pathIdx];
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) { this.path = null; return true; }
      return false;
    }
    const step = Math.min(d, speed * dt);
    const nx = dx / d, nz = dz / d;
    const startX = this.pos.x, startZ = this.pos.z;
    physics.moveCapsule(this.capsule, { x: nx * step, y: -2 * dt, z: nz * step });
    const moved = Math.hypot(this.pos.x - startX, this.pos.z - startZ);
    this.speedNow = moved / Math.max(dt, 1e-4);
    if (moved > 0.01) this.yaw = Math.atan2(nx, nz);
    if (moved < step * 0.25) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.4) {
      // stuck: drop path, let the brain re-plan (door may be closed, another NPC in the way)
      this.stuckT = 0;
      this.path = null;
      this.pathFails++;
    }
    return false;
  }

  faceTo(x: number, z: number, turnSpeed: number, dt: number): void {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = want - this.yaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const step = turnSpeed * dt;
    this.yaw += Math.max(-step, Math.min(step, d));
  }

  dieLethal(): void {
    this.alive = false;
    this.downed = true;
    this.downedLethal = true;
    this.path = null;
    this.hp = 0;
  }
}
