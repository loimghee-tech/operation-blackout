import { describe, it, expect } from 'vitest';
import { SaveManager, SAVE_VERSION, migratePayload } from '../src/save/save';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  failWrites = false;
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { if (this.failWrites) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); }
}

describe('save manager', () => {
  it('round-trips campaign data with a version stamp', () => {
    const st = new MemStorage();
    const sm = new SaveManager(st);
    expect(sm.saveCampaign({ money: 1234, started: true })).toBe(true);
    const r = sm.loadCampaign();
    expect(r.status).toBe('ok');
    expect(r.data?.money).toBe(1234);
    expect(r.data?.version).toBe(SAVE_VERSION);
  });

  it('reports missing saves without throwing', () => {
    expect(new SaveManager(new MemStorage()).loadCampaign().status).toBe('missing');
  });

  it('recovers from a corrupted primary using the backup', () => {
    const st = new MemStorage();
    const sm = new SaveManager(st);
    sm.saveCampaign({ money: 1 });
    sm.saveCampaign({ money: 2 });   // backup now holds money:1
    st.setItem('operation-blackout:save', '{broken');
    const r = sm.loadCampaign();
    expect(r.status).toBe('recovered-backup');
    expect(r.data?.money).toBe(1);
  });

  it('reports corruption when nothing is readable', () => {
    const st = new MemStorage();
    st.setItem('operation-blackout:save', 'nope');
    st.setItem('operation-blackout:save.bak', 'nope');
    expect(new SaveManager(st).loadCampaign().status).toBe('corrupt');
  });

  it('survives failed writes and reports them', () => {
    const st = new MemStorage();
    const sm = new SaveManager(st);
    st.failWrites = true;
    expect(sm.saveCampaign({ money: 5 })).toBe(false);
    expect(sm.lastWriteError).toContain('Quota');
  });

  it('migrates older save versions', () => {
    const { payload, migrated } = migratePayload({ version: 1, money: 10 });
    expect(migrated).toBe(true);
    expect(payload.version).toBe(SAVE_VERSION);
    expect(payload.loadouts).toEqual({});
  });

  it('refuses saves from a newer build', () => {
    expect(() => migratePayload({ version: SAVE_VERSION + 5 })).toThrow();
  });
});
