/**
 * Mission rewards and skill-effect aggregation. Pure functions.
 */
import { SKILL_BY_ID, type SkillEffects } from '../config/skills';
import { CLASSES, NEUTRAL_STATS, type StatMods } from '../config/classes';
import { DIFFICULTIES } from '../config/balance';
import type { ClassId, Difficulty } from '../core/types';

/** Multiplicative aggregate of all unlocked skill effects (neutral = 1 for mults, 0 for adds). */
export interface AggregatedSkills {
  damageDealtMult: number;
  damageTakenMult: number;
  recoilMult: number;
  spreadMult: number;
  reloadSpeedMult: number;
  weaponSwapMult: number;
  moveSpeedMult: number;
  noiseMult: number;
  visibilityMult: number;
  suspicionResistAdd: number;
  interactSpeedMult: number;
  hackSpeedMult: number;
  takedownSpeedMult: number;
  armorAdd: number;
  healthAdd: number;
  crewDamageMult: number;
  crewAccuracyMult: number;
  crewHealthMult: number;
  lootValueMult: number;
  bleedoutTimeMult: number;
  extraGadgetUsesAdd: number;
  unlocks: Set<string>;
}

export function aggregateSkills(skillIds: string[]): AggregatedSkills {
  const agg: AggregatedSkills = {
    damageDealtMult: 1, damageTakenMult: 1, recoilMult: 1, spreadMult: 1, reloadSpeedMult: 1,
    weaponSwapMult: 1, moveSpeedMult: 1, noiseMult: 1, visibilityMult: 1, suspicionResistAdd: 0,
    interactSpeedMult: 1, hackSpeedMult: 1, takedownSpeedMult: 1, armorAdd: 0, healthAdd: 0,
    crewDamageMult: 1, crewAccuracyMult: 1, crewHealthMult: 1, lootValueMult: 1, bleedoutTimeMult: 1,
    extraGadgetUsesAdd: 0, unlocks: new Set<string>(),
  };
  for (const id of skillIds) {
    const node = SKILL_BY_ID[id];
    if (!node) continue;
    const e: SkillEffects = node.effects;
    const mul = (k: keyof AggregatedSkills, v?: number) => { if (v !== undefined) (agg[k] as number) *= v; };
    const add = (k: keyof AggregatedSkills, v?: number) => { if (v !== undefined) (agg[k] as number) += v; };
    mul('damageDealtMult', e.damageDealtMult);
    mul('damageTakenMult', e.damageTakenMult);
    mul('recoilMult', e.recoilMult);
    mul('spreadMult', e.spreadMult);
    mul('reloadSpeedMult', e.reloadSpeedMult);
    mul('weaponSwapMult', e.weaponSwapMult);
    mul('moveSpeedMult', e.moveSpeedMult);
    mul('noiseMult', e.noiseMult);
    mul('visibilityMult', e.visibilityMult);
    add('suspicionResistAdd', e.suspicionResistAdd);
    mul('interactSpeedMult', e.interactSpeedMult);
    mul('hackSpeedMult', e.hackSpeedMult);
    mul('takedownSpeedMult', e.takedownSpeedMult);
    add('armorAdd', e.armorAdd);
    add('healthAdd', e.healthAdd);
    mul('crewDamageMult', e.crewDamageMult);
    mul('crewAccuracyMult', e.crewAccuracyMult);
    mul('crewHealthMult', e.crewHealthMult);
    mul('lootValueMult', e.lootValueMult);
    mul('bleedoutTimeMult', e.bleedoutTimeMult);
    add('extraGadgetUsesAdd', e.extraGadgetUsesAdd);
    for (const u of e.unlocks ?? []) agg.unlocks.add(u);
  }
  return agg;
}

/** Class stats multiplied by the difficulty/skill layer → the live stat block used by the player. */
export interface PlayerStatBlock {
  maxHealth: number;
  maxArmor: number;
  moveSpeedMult: number;
  sprintMult: number;
  noiseMult: number;
  damageTakenMult: number;
  damageDealtMult: number;
  weaponHandlingMult: number;   // multiplies recoil & spread
  reloadSpeedMult: number;
  interactSpeedMult: number;
  hackSpeedMult: number;
  suspicionResist: number;      // 0..0.9
  staminaMult: number;
  bleedoutSeconds: number;
  visibilityMult: number;
  unlocks: Set<string>;
  crewDamageMult: number;
  crewAccuracyMult: number;
  crewHealthMult: number;
  lootValueMult: number;
  takedownSpeedMult: number;
  weaponSwapMult: number;
  extraGadgetUses: number;
}

export function computePlayerStats(args: {
  classId: ClassId;
  skillIds: string[];
  armorMult?: number;
  armorBase: number;
  difficulty: Difficulty;
  loadoutMoveMult?: number;
  loadoutNoiseMult?: number;
}): PlayerStatBlock {
  const cls = CLASSES[args.classId];
  const cs: StatMods = cls?.stats ?? NEUTRAL_STATS;
  const sk = aggregateSkills(args.skillIds);
  const diff = DIFFICULTIES[args.difficulty];

  // Skill-tree affinity: discount applied to skill costs in progression UI elsewhere; here it
  // boosts the matching skill effects slightly (affinity 0.6 -> +? stronger). Kept simple: none.
  const maxArmor = Math.round((args.armorBase + sk.armorAdd) * cs.armorMult);
  const maxHealth = Math.round((100 + sk.healthAdd) * cs.healthMult);
  return {
    maxHealth,
    maxArmor,
    moveSpeedMult: cs.moveSpeedMult * sk.moveSpeedMult * (args.loadoutMoveMult ?? 1),
    sprintMult: 1.62,
    noiseMult: cs.noiseMult * sk.noiseMult * (args.loadoutNoiseMult ?? 1),
    damageTakenMult: sk.damageTakenMult * diff.playerDamageTakenMult,
    damageDealtMult: sk.damageDealtMult,
    weaponHandlingMult: cs.weaponHandlingMult * sk.recoilMult,
    reloadSpeedMult: cs.reloadSpeedMult * sk.reloadSpeedMult,
    interactSpeedMult: cs.interactSpeedMult * sk.interactSpeedMult,
    hackSpeedMult: cs.hackSpeedMult * sk.hackSpeedMult,
    suspicionResist: Math.min(0.9, cs.suspicionResist + sk.suspicionResistAdd),
    staminaMult: cs.staminaMult * (diff.staminaEnabled ? 1 : 1),
    bleedoutSeconds: diff.bleedoutSeconds * sk.bleedoutTimeMult,
    visibilityMult: sk.visibilityMult,
    unlocks: sk.unlocks,
    crewDamageMult: sk.crewDamageMult,
    crewAccuracyMult: sk.crewAccuracyMult,
    crewHealthMult: sk.crewHealthMult,
    lootValueMult: sk.lootValueMult,
    takedownSpeedMult: sk.takedownSpeedMult,
    weaponSwapMult: sk.weaponSwapMult,
    extraGadgetUses: sk.extraGadgetUsesAdd,
  };
}

export interface MissionOutcome {
  success: boolean;
  primaryComplete: boolean;
  optionalLootValue: number;
  primaryLootValue: number;
  optionalObjectivesDone: number;
  optionalObjectivesTotal: number;
  detectionPeak: number;        // 0..100 max suspicion/alarm equivalent
  civiliansHarmed: number;
  crewDowned: number;
  kills: number;
  extracted: boolean;
  difficulty: Difficulty;
  alarmTriggered: boolean;
  timeSeconds: number;
  parTimeSeconds: number;
  lootValueMult: number;
}

export interface RewardBreakdown {
  money: number;
  xp: number;
  rep: number;
  lines: Array<{ label: string; value: number; kind: 'money' | 'xp' | 'rep' | 'penalty' }>;
}

/** Deterministic reward calculation. Failure pays nothing and costs reputation. */
export function computeRewards(o: MissionOutcome): RewardBreakdown {
  const lines: RewardBreakdown['lines'] = [];
  const diff = DIFFICULTIES[o.difficulty];
  if (!o.success || !o.extracted) {
    lines.push({ label: 'Mission failed — no payout', value: 0, kind: 'penalty' });
    lines.push({ label: 'Reputation lost (burned contact)', value: -1, kind: 'rep' });
    return { money: 0, xp: Math.round(120 * diff.xpMult), rep: -1, lines };
  }
  const base = Math.round(40000 * diff.lootValueMult);
  lines.push({ label: 'Contract payout (primary objective)', value: base, kind: 'money' });
  const loot = Math.round((o.primaryLootValue + o.optionalLootValue) * diff.lootValueMult * o.lootValueMult);
  lines.push({ label: 'Loot sold on the black market', value: loot, kind: 'money' });
  const optBonus = o.optionalObjectivesDone * Math.round(5000 * diff.lootValueMult);
  if (optBonus > 0) lines.push({ label: `Optional objectives (${o.optionalObjectivesDone}/${o.optionalObjectivesTotal})`, value: optBonus, kind: 'money' });
  let money = base + loot + optBonus;

  // Detection & civilians impact the bonus
  const stealthBonus = o.detectionPeak < 25 && !o.alarmTriggered ? Math.round(9000 * diff.lootValueMult) : o.detectionPeak < 60 ? Math.round(3000 * diff.lootValueMult) : 0;
  if (stealthBonus > 0) { lines.push({ label: 'Ghost bonus (low detection)', value: stealthBonus, kind: 'money' }); money += stealthBonus; }
  const civPenalty = Math.min(base * 0.6, o.civiliansHarmed * 3500);
  if (civPenalty > 0) { lines.push({ label: `Civilian damage penalty (${o.civiliansHarmed})`, value: -Math.round(civPenalty), kind: 'penalty' }); money -= Math.round(civPenalty); }
  const crewBonus = o.crewDowned === 0 ? 2000 : 0;
  if (crewBonus) { lines.push({ label: 'Crew came home intact', value: crewBonus, kind: 'money' }); money += crewBonus; }
  // Par-time bonus
  if (o.timeSeconds <= o.parTimeSeconds) { lines.push({ label: 'Under par time', value: 3000, kind: 'money' }); money += 3000; }

  money = Math.max(0, Math.round(money));
  const xp = Math.round((700 + o.optionalObjectivesDone * 180 + (o.detectionPeak < 25 ? 250 : 0) + (o.kills ? 0 : 150)) * diff.xpMult);
  const rep = 2 + (o.optionalObjectivesDone > 0 ? 1 : 0) + (o.difficulty === 'hard' || o.difficulty === 'overkill' ? 1 : 0) + (o.alarmTriggered ? 0 : 1) - (o.civiliansHarmed > 2 ? 1 : 0);
  lines.push({ label: 'Experience', value: xp, kind: 'xp' });
  lines.push({ label: 'Reputation', value: rep, kind: 'rep' });
  return { money, xp, rep: Math.max(0, rep), lines };
}
