import { describe, it, expect } from 'vitest';
import { AlarmSystem, PERIMETER_SECONDS } from '../src/ai/alarm';
import { DIFFICULTIES } from '../src/config/balance';

const make = (diff: keyof typeof DIFFICULTIES = 'normal') => {
  const log: string[] = [];
  const a = new AlarmSystem(DIFFICULTIES[diff], {
    onChange: (l, label) => log.push(`level:${l}:${label}`),
    onLockdown: () => log.push('lockdown'),
    onSpawnResponse: (n) => log.push(`response:${n}`),
    onPerimeterSealed: () => log.push('perimeter'),
    onSiren: (on) => log.push(`siren:${on}`),
  });
  return { a, log };
};

describe('alarm escalation', () => {
  it('never lowers the level through raise()', () => {
    const { a } = make();
    a.raise(2, 'x');
    a.raise(1, 'y');
    expect(a.level).toBe(2);
  });

  it('TRIGGERED starts the siren; LOCKDOWN starts response waves and the perimeter timer', () => {
    const { a, log } = make();
    a.raise(2, 'spotted');
    expect(log).toContain('siren:true');
    a.raise(3, 'escalated');
    expect(log).toContain('lockdown');
    expect(a.perimeterTimer).toBe(PERIMETER_SECONDS);
    a.update(DIFFICULTIES.normal.responseFirstDelay + 0.1, 1);
    expect(log.some((l) => l.startsWith('response:'))).toBe(true);
  });

  it('cutting the alarm panel caps escalation at TRIGGERED and blocks response', () => {
    const { a, log } = make();
    a.raise(1, 'x');
    a.disablePanel();
    a.raise(4, 'should be capped');
    expect(a.level).toBe(2);
    a.update(200, 0);
    expect(log.some((l) => l.startsWith('response:'))).toBe(false);
    expect(a.perimeterTimer).toBeNull();
  });

  it('an unresolved trigger escalates to lockdown', () => {
    const { a } = make();
    a.raise(2, 'x');
    a.update(40, 3);
    expect(a.level).toBe(3);
  });

  it('a perimeter timer that runs out fires the seal callback', () => {
    const { a, log } = make();
    a.raise(3, 'x');
    a.update(PERIMETER_SECONDS + 1, 5);
    expect(log).toContain('perimeter');
  });

  it('hard difficulty responds faster than story', () => {
    expect(DIFFICULTIES.hard.responseFirstDelay).toBeLessThan(DIFFICULTIES.story.responseFirstDelay);
  });
});
