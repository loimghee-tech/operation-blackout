/**
 * Core shared types. Pure data — no three.js imports so these modules stay
 * testable headlessly in Node (vitest) and free of per-frame allocation churn.
 */

/** Lightweight 3D vector used by all simulation logic. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const V3 = {
  zero(): Vec3 { return { x: 0, y: 0, z: 0 }; },
  of(x: number, y: number, z: number): Vec3 { return { x, y, z }; },
  clone(a: Vec3): Vec3 { return { x: a.x, y: a.y, z: a.z }; },
};

/** Axis-aligned bounding box. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

export type Faction = 'player' | 'crew' | 'guard' | 'police' | 'civilian' | 'neutral';

export type Stance = 'stand' | 'crouch' | 'prone';

/** Discrete NPC awareness states (spec section 7). */
export type AlertState =
  | 'unaware'
  | 'curious'
  | 'suspicious'
  | 'investigating'
  | 'searching'
  | 'alerted'
  | 'combat'
  | 'returning';

export type NpcRole =
  | 'guard'
  | 'civilian'
  | 'bank_employee'
  | 'receptionist'
  | 'manager'
  | 'technician'
  | 'police'
  | 'swat'
  | 'crew_assault'
  | 'crew_stealth'
  | 'crew_hacker'
  | 'crew_engineer'
  | 'crew_medic'
  | 'crew_driver'
  | 'informant'
  | 'hostage';

export type Difficulty = 'story' | 'normal' | 'hard' | 'overkill';

export type MissionPhase =
  | 'briefing'
  | 'planning'
  | 'deployment'
  | 'active'
  | 'objectives_complete'
  | 'extraction'
  | 'success'
  | 'failed';

export type ClassId = 'loud' | 'ghost' | 'hacker' | 'mastermind' | 'conartist' | 'engineer';

export type ApproachId = 'quiet' | 'social' | 'loud' | 'technical';

export type SkillTreeId = 'combat' | 'stealth' | 'hacking' | 'leadership' | 'engineering' | 'social';

export type DamageZone = 'head' | 'torso' | 'limb';

export type SurfaceType = 'concrete' | 'marble' | 'carpet' | 'metal' | 'wood' | 'glass' | 'dirt';

/** Overall game state driving UI + simulation. */
export type GameStateName =
  | 'boot'
  | 'main_menu'
  | 'class_select'
  | 'contracts'
  | 'briefing'
  | 'planning'
  | 'loadout'
  | 'skills'
  | 'crew'
  | 'shop'
  | 'settings'
  | 'credits'
  | 'deploying'
  | 'playing'
  | 'paused'
  | 'results';

/** Serializable identity of an NPC archetype appearance. */
export interface AppearanceSpec {
  /** Key into the character manifest (e.g. "Security_Male_01"). Fallback chain applies. */
  modelKey?: string;
  /** Procedural fallback colors / tint when no external model is installed. */
  shirtColor?: number;
  pantsColor?: number;
  skinColor?: number;
  vestColor?: number;
  helmet?: boolean;
  cap?: boolean;
  /** Prop weapon model held in hands. */
  heldWeapon?: string;
  scale?: number;
}

export interface NpcSpawnSpec {
  id: string;
  role: NpcRole;
  faction: Faction;
  position: Vec3;
  facing?: number; // radians
  appearance?: AppearanceSpec;
  patrol?: string[]; // waypoint ids
  /** Patrol waypoints given inline (used by response spawns). */
  patrolPoints?: Vec3[];
  homeRoom?: string;
  /** For civilians: casual wander anchors. */
  wanderRoom?: string;
  dialogueSet?: string;
  isHostage?: boolean;
  /** Restricts NPC to rooms with these access tags (guards may enter vault anteroom etc.). */
  accessTags?: string[];
  weapon?: string; // weapon def id
  skillLevel?: number; // 1..3 influences accuracy/aggression
}
