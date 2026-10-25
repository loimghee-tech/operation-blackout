import { describe, it, expect } from 'vitest';
import { MissionRuntime } from '../src/missions/runtime';

describe('mission objectives', () => {
  const rt = () => new MissionRuntime([
    { id: 'enter', text: 'Get inside' },
    { id: 'vault', text: 'Open vault', prereq: ['enter'] },
    { id: 'gold', text: 'Gold', prereq: ['vault'] },
    { id: 'extract', text: 'Extract', prereq: ['gold'] },
    { id: 'opt', text: 'Optional', optional: true },
    { id: 'secret', text: 'Secret', optional: true, hidden: true },
  ]);

  it('objectives unlock in prerequisite order', () => {
    const m = rt();
    expect(m.get('vault')!.state).toBe('hidden');
    m.complete('enter');
    expect(m.get('vault')!.state).toBe('active');
    expect(m.get('gold')!.state).toBe('hidden');
  });

  it('primary completion ignores optional objectives', () => {
    const m = rt();
    m.complete('enter'); m.complete('vault'); m.complete('gold'); m.complete('extract');
    expect(m.primaryDone).toBe(true);
    expect(m.optionalDone).toBe(0);
    expect(m.optionalTotal).toBe(2);
  });

  it('hidden intel objectives can be revealed and then completed', () => {
    const m = rt();
    expect(m.get('secret')!.state).toBe('hidden');
    m.reveal('secret');
    expect(m.get('secret')!.state).toBe('active');
    expect(m.complete('secret')).toBe(true);
    expect(m.optionalDone).toBe(1);
  });

  it('cannot complete an objective that is not active', () => {
    const m = rt();
    expect(m.complete('gold')).toBe(false);
  });

  it('failed objectives are recorded with a reason', () => {
    const m = rt();
    m.fail('enter', 'Trapped');
    expect(m.get('enter')!.state).toBe('failed');
    expect(m.outcomeReason).toBe('Trapped');
  });
});
