/**
 * Difficulty presets and global balance knobs.
 * Higher difficulties change behaviour (accuracy, perception, response timing,
 * economy) — not just enemy health multipliers.
 */
import type { Difficulty } from '../core/types';

export interface DifficultyConfig {
  id: Difficulty;
  name: string;
  description: string;
  color: string;
  // --- enemy tuning ---
  enemyDamageMult: number;
  enemyAccuracyMult: number;     // scales base hit chance
  enemyReactionMult: number;     // seconds-to-react multiplier (lower = faster)
  enemyHealthMult: number;
  perceptionRangeMult: number;
  suspicionRateMult: number;
  guardAimConeMult: number;      // FOV multiplier for guards
  // --- response ---
  responseFirstDelay: number;    // seconds from full alarm to first wave
  responseInterval: number;      // seconds between waves
  responseWaveSize: number;
  responseMaxAlive: number;
  // --- player economy ---
  playerDamageTakenMult: number;
  ammoPickupMult: number;
  startingReserveMult: number;
  lootValueMult: number;
  xpMult: number;
  // --- systems ---
  staminaEnabled: boolean;
  bleedoutSeconds: number;
  crewHealthMult: number;
  alarmDecayMult: number;        // how fast heat drops after losing pursuers
  hackFailSuspicionMult: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  story: {
    id: 'story', name: 'STORY', color: '#7bd4ff',
    description: 'For the plot. Gentle enemies, generous resources, one free revive per job. Stealth and loud both forgiving.',
    enemyDamageMult: 0.55, enemyAccuracyMult: 0.55, enemyReactionMult: 1.8, enemyHealthMult: 0.85,
    perceptionRangeMult: 0.85, suspicionRateMult: 0.7, guardAimConeMult: 0.9,
    responseFirstDelay: 45, responseInterval: 40, responseWaveSize: 2, responseMaxAlive: 6,
    playerDamageTakenMult: 0.75, ammoPickupMult: 1.6, startingReserveMult: 1.4, lootValueMult: 0.9, xpMult: 0.9,
    staminaEnabled: false, bleedoutSeconds: 45, crewHealthMult: 1.3, alarmDecayMult: 1.5, hackFailSuspicionMult: 0.5,
  },
  normal: {
    id: 'normal', name: 'NORMAL', color: '#4dffa6',
    description: 'The intended heist. Preparation pays, mistakes cost, both stealth and assault are viable.',
    enemyDamageMult: 0.85, enemyAccuracyMult: 0.8, enemyReactionMult: 1.25, enemyHealthMult: 1.0,
    perceptionRangeMult: 1.0, suspicionRateMult: 1.0, guardAimConeMult: 1.0,
    responseFirstDelay: 30, responseInterval: 28, responseWaveSize: 3, responseMaxAlive: 9,
    playerDamageTakenMult: 1.0, ammoPickupMult: 1.0, startingReserveMult: 1.0, lootValueMult: 1.0, xpMult: 1.0,
    staminaEnabled: true, bleedoutSeconds: 30, crewHealthMult: 1.0, alarmDecayMult: 1.0, hackFailSuspicionMult: 1.0,
  },
  hard: {
    id: 'hard', name: 'HARD', color: '#ffc94d',
    description: 'Sharp-eyed guards, fast response, thin margins. Ammunition is a resource, cover is a lifestyle.',
    enemyDamageMult: 1.15, enemyAccuracyMult: 1.1, enemyReactionMult: 0.85, enemyHealthMult: 1.05,
    perceptionRangeMult: 1.15, suspicionRateMult: 1.25, guardAimConeMult: 1.1,
    responseFirstDelay: 22, responseInterval: 20, responseWaveSize: 4, responseMaxAlive: 12,
    playerDamageTakenMult: 1.25, ammoPickupMult: 0.7, startingReserveMult: 0.8, lootValueMult: 1.25, xpMult: 1.35,
    staminaEnabled: true, bleedoutSeconds: 22, crewHealthMult: 0.85, alarmDecayMult: 0.75, hackFailSuspicionMult: 1.3,
  },
  overkill: {
    id: 'overkill', name: 'OVERKILL', color: '#ff5533',
    description: 'The building expects you. Elite response, brutal economy, alarms that never quite cool. For crews that plan everything.',
    enemyDamageMult: 1.45, enemyAccuracyMult: 1.3, enemyReactionMult: 0.6, enemyHealthMult: 1.15,
    perceptionRangeMult: 1.3, suspicionRateMult: 1.5, guardAimConeMult: 1.2,
    responseFirstDelay: 15, responseInterval: 15, responseWaveSize: 5, responseMaxAlive: 16,
    playerDamageTakenMult: 1.6, ammoPickupMult: 0.5, startingReserveMult: 0.65, lootValueMult: 1.6, xpMult: 1.8,
    staminaEnabled: true, bleedoutSeconds: 16, crewHealthMult: 0.7, alarmDecayMult: 0.5, hackFailSuspicionMult: 1.6,
  },
};

// ---------------------------------------------------------------------------
// Global knobs
// ---------------------------------------------------------------------------
export const BALANCE = {
  player: {
    baseHealth: 100,
    baseMoveSpeed: 4.3,          // m/s walk
    sprintMult: 1.62,
    crouchMult: 0.55,
    adsMoveMult: 0.55,
    jumpVelocity: 4.6,
    gravity: 16.5,
    staminaMax: 100,
    staminaDrainSprint: 16,      // per second
    staminaRegen: 12,            // per second after delay
    staminaRegenDelay: 1.6,
    vaultMaxHeight: 1.15,
    vaultMinHeight: 0.35,
    eyeHeightStand: 1.62,
    eyeHeightCrouch: 1.0,
    radius: 0.34,
    heightStand: 1.78,
    heightCrouch: 1.1,
    stepHeight: 0.42,
    footstepIntervalWalk: 0.62,
    footstepIntervalSprint: 0.42,
    footstepIntervalCrouch: 0.85,
    noiseWalk: 7,                // audible metres
    noiseSprint: 16,
    noiseCrouchWalk: 3.2,
    noiseLandBase: 8,
  },
  npc: {
    baseSpeedWalk: 1.5,
    baseSpeedPatrol: 1.15,
    baseSpeedRun: 3.6,
    baseSpeedCombat: 3.2,
    fovDegrees: 110,
    viewDistance: 22,
    viewDistanceDark: 12,
    hearMultiplier: 1.0,
    suspicionDecay: 4.5,         // per second when losing sight
    curiosityDecay: 8,
    investigateTime: 9,
    searchTime: 16,
    radioRange: 34,
    bodyFindSuspicion: 55,
    corpseMemorySeconds: 40,
  },
  alarm: {
    // alarm level thresholds 0..4: calm, uneasy, triggered, full lockdown, response
    responseTriggerLevel: 3,
    decayPerSecond: 0.02,
  },
  economy: {
    xpPerContractBase: 400,
    repPerContract: 1,
  },
  interaction: {
    defaultRange: 2.4,
    promptRange: 3.2,
  },
  hack: {
    baseTime: 6,
    suspicionPerSecond: 2.2,     // while hacking in view of NPCs
    failSuspicion: 18,
    strikeAlarmThreshold: 3,     // fails before local alarm
  },
  detection: {
    // suspicion thresholds for state transitions
    curiousAt: 18,
    suspiciousAt: 42,
    investigateAt: 62,
    alertedAt: 85,
    combatAt: 100,
  },
};

/** Randomized mission modifiers — applied on top of difficulty. All keep the job solvable. */
export interface MissionModifier {
  id: string;
  label: string;
  description: string;
  /** Data consumed by mission runtime. */
  effects: {
    extraPatrols?: number;
    cameraSweepSpeedMult?: number;
    responseDelayMult?: number;
    lootValueMult?: number;
    fewerCivilians?: boolean;
    extraCivilians?: number;
    alarmHardwired?: boolean;       // remote alarm cut impossible; panels still work
    guardSkillAdd?: number;
    vaultTimeMult?: number;         // drill time multiplier
    doubleBagLimit?: boolean;       // loot capacity doubled
    skeletonCrewResponse?: boolean; // response waves smaller
  };
}

export const MODIFIER_POOL: MissionModifier[] = [
  { id: 'extra_patrol', label: 'Extra Patrols', description: 'Two additional guards walk the floors.', effects: { extraPatrols: 2 } },
  { id: 'firmware', label: 'Camera Firmware Update', description: 'Cameras sweep 40% faster.', effects: { cameraSweepSpeedMult: 1.4 } },
  { id: 'cash_shipment', label: 'Cash Shipment', description: 'A delivery arrived — optional loot worth 40% more.', effects: { lootValueMult: 1.4 } },
  { id: 'shift_change', label: 'Shift Change', description: 'Police response is 30% slower to arrive.', effects: { responseDelayMult: 1.3 } },
  { id: 'vip_day', label: 'VIP Client Day', description: 'Extra civilians in the lobby — collateral penalties bite harder.', effects: { extraCivilians: 3 } },
  { id: 'hardwired', label: 'Hardwired Alarm', description: 'The alarm panel cannot be cut remotely. Physical panels still work.', effects: { alarmHardwired: true } },
  { id: 'veterans', label: 'Veteran Guards', description: 'Guards are one skill level sharper.', effects: { guardSkillAdd: 1 } },
  { id: 'hardened_vault', label: 'Hardened Vault Door', description: 'Drilling takes 30% longer.', effects: { vaultTimeMult: 1.3 } },
  { id: 'duffel_upgrade', label: 'Big Bags', description: 'Carry twice the loot before it slows you down.', effects: { doubleBagLimit: true } },
  { id: 'budget_cuts', label: 'City Budget Cuts', description: 'Response waves are smaller but come just as fast.', effects: { skeletonCrewResponse: true } },
  { id: 'quiet_day', label: 'Quiet Day', description: 'Fewer civilians on site.', effects: { fewerCivilians: true } },
];
