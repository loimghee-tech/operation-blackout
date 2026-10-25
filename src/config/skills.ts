/**
 * Six skill trees, six nodes each. Every node has concrete effects that feed
 * the PlayerStats aggregation (progression/skillEffects.ts) or unlock flags
 * checked by gameplay systems.
 */
import type { SkillTreeId } from '../core/types';

/** Numeric stat modifiers a skill can grant (multipliers unless suffixed Add). */
export interface SkillEffects {
  damageDealtMult?: number;
  damageTakenMult?: number;
  recoilMult?: number;
  spreadMult?: number;
  reloadSpeedMult?: number;
  adsSpeedMult?: number;
  weaponSwapMult?: number;
  moveSpeedMult?: number;
  sprintSpeedMult?: number;
  staminaMaxMult?: number;
  staminaDrainMult?: number;
  staminaRegenMult?: number;
  noiseMult?: number;
  visibilityMult?: number;
  suspicionResistAdd?: number;
  interactSpeedMult?: number;
  hackSpeedMult?: number;
  takedownSpeedMult?: number;
  armorAdd?: number;
  healthAdd?: number;
  crewDamageMult?: number;
  crewAccuracyMult?: number;
  crewHealthMult?: number;
  lootValueMult?: number;
  intelDiscountMult?: number;
  extraGadgetUsesAdd?: number;
  bleedoutTimeMult?: number;
  /** Non-numeric unlocks checked by systems. */
  unlocks?: string[];
}

export interface SkillNode {
  id: string;
  tree: SkillTreeId;
  tier: number;           // 0..5 — requires previous tier in same tree
  name: string;
  description: string;
  cost: number;           // skill points
  repRequired: number;    // reputation gate
  effects: SkillEffects;
}

export interface SkillTreeDef {
  id: SkillTreeId;
  name: string;
  color: string;
  description: string;
}

export const SKILL_TREES: SkillTreeDef[] = [
  { id: 'combat', name: 'COMBAT', color: '#ff5533', description: 'Gunplay, survivability and aggression.' },
  { id: 'stealth', name: 'STEALTH', color: '#7bd4ff', description: 'Silence, shadow and clean takedowns.' },
  { id: 'hacking', name: 'HACKING', color: '#4dffa6', description: 'Devices, networks and electronic warfare.' },
  { id: 'leadership', name: 'LEADERSHIP', color: '#ffc94d', description: 'Crew effectiveness and command.' },
  { id: 'engineering', name: 'ENGINEERING', color: '#c8ff4d', description: 'Drills, repairs and mechanical speed.' },
  { id: 'social', name: 'SOCIAL', color: '#ff7bdb', description: 'Disguises, bluffing and calm rooms.' },
];

const S = (
  tree: SkillTreeId, tier: number, id: string, name: string,
  description: string, cost: number, repRequired: number, effects: SkillEffects,
): SkillNode => ({ id, tree, tier, name, description, cost, repRequired, effects });

export const SKILLS: SkillNode[] = [
  // ---- COMBAT ----
  S('combat', 0, 'c_steady', 'Steady Hands', 'Recoil climb reduced 12%.', 1, 0, { recoilMult: 0.88 }),
  S('combat', 1, 'c_mags', 'Speed Mags', 'Reloads 15% faster on every weapon.', 1, 1, { reloadSpeedMult: 0.85 }),
  S('combat', 2, 'c_plates', 'Plate Carrier Fit', '+15 maximum armour from any vest.', 2, 2, { armorAdd: 15 }),
  S('combat', 3, 'c_suppression', 'Suppressive Fire', 'Enemies you hit briefly lose accuracy. Spread reduced 10% while firing full-auto.', 2, 3, { spreadMult: 0.9, unlocks: ['suppression_fire'] }),
  S('combat', 4, 'c_secondwind', 'Second Wind', 'Incoming damage reduced 12%. Downed bleedout lasts 40% longer.', 2, 4, { damageTakenMult: 0.88, bleedoutTimeMult: 1.4 }),
  S('combat', 5, 'c_overmatch', 'Overmatch', '+10% damage with primaries. Weapon swaps 30% faster.', 3, 6, { damageDealtMult: 1.1, weaponSwapMult: 0.7 }),

  // ---- STEALTH ----
  S('stealth', 0, 's_softsoles', 'Soft Soles', 'Movement noise reduced 15%.', 1, 0, { noiseMult: 0.85 }),
  S('stealth', 1, 's_lowlights', 'Low Light Discipline', 'Visibility to NPCs reduced 12%.', 1, 1, { visibilityMult: 0.88 }),
  S('stealth', 2, 's_hands', 'Clean Hands', 'Takedowns 30% faster and 20% quieter.', 2, 2, { takedownSpeedMult: 0.7, noiseMult: 0.95 }),
  S('stealth', 3, 's_ecm', 'Pocket ECM', 'Carrying a scanner passively jams cameras within 3m of you.', 2, 3, { unlocks: ['pocket_ecm'] }),
  S('stealth', 4, 's_corpse_carry', 'Body Carrier', 'Dragging and hiding bodies is 40% faster; one extra hiding-spot capacity everywhere.', 2, 4, { interactSpeedMult: 0.9, unlocks: ['body_carrier'] }),
  S('stealth', 5, 's_ghostwalk', 'Ghostwalk', 'Crouch-walking is nearly silent and 15% faster. Crouch visibility reduced a further 15%.', 3, 6, { noiseMult: 0.8, moveSpeedMult: 1.0, visibilityMult: 0.85, unlocks: ['ghostwalk'] }),

  // ---- HACKING ----
  S('hacking', 0, 'h_scriptkiddie', 'Script Kit', 'Hack minigames run 12% faster.', 1, 0, { hackSpeedMult: 0.88 }),
  S('hacking', 1, 'h_retry', 'Rollback', '+1 retry on failed hacks before consequences.', 1, 1, { unlocks: ['hack_retry'] }),
  S('hacking', 2, 'h_camera_loop', 'Camera Loops', 'Hacked cameras stay disabled 60% longer.', 2, 2, { unlocks: ['camera_loop'] }),
  S('hacking', 3, 'h_electronic_locks', 'Electronic Bypass', 'Electronic locks can be hacked directly without a keypad trace.', 2, 3, { unlocks: ['advanced_hacks'] }),
  S('hacking', 4, 'h_backdoor', 'Backdoor', 'Successful hacks also reveal one extra intel marker (patrols or loot).', 2, 5, { unlocks: ['backdoor_intel'] }),
  S('hacking', 5, 'h_blackout', 'Blackout Protocol', 'Once per mission: disable every camera in the building for 15s from any hacked terminal.', 3, 7, { unlocks: ['blackout_protocol'] }),

  // ---- LEADERSHIP ----
  S('leadership', 0, 'l_drilled', 'Drilled Crew', 'Crew accuracy +10%.', 1, 0, { crewAccuracyMult: 1.1 }),
  S('leadership', 1, 'l_tough', 'Bonded Crew', 'Crew health +25%.', 1, 1, { crewHealthMult: 1.25 }),
  S('leadership', 2, 'l_orders', 'Clear Orders', 'Crew respond to commands 35% faster and hold positions longer.', 2, 2, { unlocks: ['fast_orders'] }),
  S('leadership', 3, 'l_field_medic', 'Field Doctrine', 'Your medic crew revives twice as fast; you bleed out 25% slower.', 2, 3, { bleedoutTimeMult: 1.25, unlocks: ['fast_revive'] }),
  S('leadership', 4, 'l_sharp', 'Sharp End', 'Crew damage +15%. Crew can suppress enemies.', 2, 5, { crewDamageMult: 1.15, unlocks: ['crew_suppression'] }),
  S('leadership', 5, 'l_professional', 'Professional Outfit', 'Recruit one extra crew member per job (slot +1).', 3, 7, { unlocks: ['extra_crew_slot'] }),

  // ---- ENGINEERING ----
  S('engineering', 0, 'e_drill', 'Diamond Bit', 'Drills and mechanical interactions 15% faster.', 1, 0, { interactSpeedMult: 0.85 }),
  S('engineering', 1, 'e_jams', 'Anti-Jam Grease', 'Machinery jam chance halved.', 1, 1, { unlocks: ['anti_jam'] }),
  S('engineering', 2, 'e_service', 'Service Knowledge', 'You can open maintenance hatches and service doors.', 2, 2, { unlocks: ['service_routes'] }),
  S('engineering', 3, 'e_breacher', 'Breacher', 'Breaching charges deal structural damage faster and arm 25% quicker.', 2, 3, { unlocks: ['fast_breach'] }),
  S('engineering', 4, 'e_turret', 'Sentry Theory', 'Deployed barricades gain 50% health and block gunfire for crew too.', 2, 5, { unlocks: ['strong_barricades'] }),
  S('engineering', 5, 'e_master', 'Master Tinker', 'All engineering interactions 25% faster. Repair kits gain one use.', 3, 7, { interactSpeedMult: 0.75, extraGadgetUsesAdd: 1 }),

  // ---- SOCIAL ----
  S('social', 0, 'so_blend', 'Blend In', 'Disguise suspicion accrual reduced 15%.', 1, 0, { suspicionResistAdd: 0.15 }),
  S('social', 1, 'so_smalltalk', 'Small Talk', 'Social interactions with civilians and staff unlock an extra dialogue option.', 1, 1, { unlocks: ['small_talk'] }),
  S('social', 2, 'so_cool', 'Cool Under Scrutiny', 'When spotted doing something mildly suspicious, suspicion starts 30% lower.', 2, 2, { suspicionResistAdd: 0.15, visibilityMult: 0.97 }),
  S('social', 3, 'so_uniform_eye', 'Uniform Eye', 'Disguises stay plausible in one extra zone tier (e.g. staff uniform accepted briefly in security areas).', 2, 4, { unlocks: ['uniform_eye'] }),
  S('social', 4, 'so_crowd', 'Crowd Comfort', 'Standing near civilians slowly reduces nearby guard suspicion.', 2, 5, { unlocks: ['crowd_comfort'] }),
  S('social', 5, 'so_face', 'The Face', 'Talk-down interactions work on suspicious (not just curious) NPCs and are 40% faster.', 3, 7, { unlocks: ['master_face'] }),
];

export const SKILL_BY_ID: Record<string, SkillNode> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

/** XP required to reach each reputation level (index = level). */
export const XP_TABLE = [0, 1000, 2400, 4200, 6500, 9400, 13000, 17500, 23000, 30000];
export const MAX_LEVEL = XP_TABLE.length - 1;

/** Skill points granted per level. */
export const SKILL_POINTS_PER_LEVEL = 2;
