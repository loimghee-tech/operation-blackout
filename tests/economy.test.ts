import { describe, it, expect } from 'vitest';
import { computeRewards, aggregateSkills, computePlayerStats, type MissionOutcome } from '../src/progression/economy';

const base: MissionOutcome = {
  success: true, primaryComplete: true, optionalLootValue: 0, primaryLootValue: 240000, optionalObjectivesDone: 0,
  optionalObjectivesTotal: 5, detectionPeak: 10, civiliansHarmed: 0, crewDowned: 0, kills: 0, extracted: true,
  difficulty: 'normal', alarmTriggered: false, timeSeconds: 600, parTimeSeconds: 900, lootValueMult: 1,
};

describe('mission rewards', () => {
  it('pays nothing and costs reputation when the mission fails', () => {
    const r = computeRewards({ ...base, success: false, extracted: false });
    expect(r.money).toBe(0);
    expect(r.rep).toBe(-1);   // the app applies this and clamps reputation at zero
    expect(r.xp).toBeGreaterThan(0);
  });

  it('a clean ghost run pays more than a loud run with civilian damage', () => {
    const clean = computeRewards(base);
    const messy = computeRewards({ ...base, detectionPeak: 100, alarmTriggered: true, civiliansHarmed: 4, crewDowned: 2 });
    expect(clean.money).toBeGreaterThan(messy.money);
  });

  it('optional objectives add money and XP', () => {
    const none = computeRewards(base);
    const some = computeRewards({ ...base, optionalObjectivesDone: 3, optionalLootValue: 20000 });
    expect(some.money).toBeGreaterThan(none.money);
    expect(some.xp).toBeGreaterThan(none.xp);
  });

  it('harder difficulties increase payouts', () => {
    const normal = computeRewards(base);
    const overkill = computeRewards({ ...base, difficulty: 'overkill' });
    expect(overkill.money).toBeGreaterThan(normal.money);
  });

  it('lines add up to the total money', () => {
    const r = computeRewards({ ...base, optionalObjectivesDone: 2, optionalLootValue: 5000, civiliansHarmed: 1 });
    const lineSum = r.lines.filter((l) => l.kind === 'money' || l.kind === 'penalty').reduce((s, l) => s + l.value, 0);
    expect(Math.abs(lineSum - r.money)).toBeLessThanOrEqual(1);
  });
});

describe('skills and derived stats', () => {
  it('aggregates multiplicative skills', () => {
    const agg = aggregateSkills(['c_steady', 'c_overmatch']);
    expect(agg.recoilMult).toBeCloseTo(0.88, 5);
    expect(agg.damageDealtMult).toBeCloseTo(1.1, 5);
    expect(agg.weaponSwapMult).toBeCloseTo(0.7, 5);
  });

  it('class and armour feed the live stat block', () => {
    const loud = computePlayerStats({ classId: 'loud', skillIds: [], armorBase: 100, difficulty: 'normal' });
    const ghost = computePlayerStats({ classId: 'ghost', skillIds: [], armorBase: 40, difficulty: 'normal' });
    expect(loud.maxHealth).toBeGreaterThan(ghost.maxHealth);
    expect(ghost.noiseMult).toBeLessThan(loud.noiseMult);
    expect(ghost.suspicionResist).toBeGreaterThan(loud.suspicionResist);
  });

  it('story is more forgiving than overkill on damage taken', () => {
    const story = computePlayerStats({ classId: 'ghost', skillIds: [], armorBase: 40, difficulty: 'story' });
    const overkill = computePlayerStats({ classId: 'ghost', skillIds: [], armorBase: 40, difficulty: 'overkill' });
    expect(story.damageTakenMult).toBeLessThan(overkill.damageTakenMult);
  });
});
