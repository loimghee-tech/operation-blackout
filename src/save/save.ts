/**
 * Versioned persistence layer on top of localStorage.
 *  - Writes are wrapped in try/catch (quota / private mode failures are reported, not fatal).
 *  - A backup copy is kept; corrupted primary data falls back to the backup.
 *  - Older save versions are migrated by ordered migration functions.
 */
export const SAVE_VERSION = 3;
const KEY = 'operation-blackout:save';
const BACKUP_KEY = 'operation-blackout:save.bak';
const SETTINGS_KEY = 'operation-blackout:settings';

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a version-n payload to version n+1. */
export const MIGRATIONS: Record<number, Migration> = {
  1: (d) => ({ ...d, loadouts: d.loadouts ?? {}, version: 2 }),
  2: (d) => ({ ...d, crewRoster: d.crewRoster ?? {}, settingsVersion: 1, version: 3 }),
};

export interface LoadResult<T> {
  data: T | null;
  status: 'ok' | 'missing' | 'recovered-backup' | 'corrupt' | 'migrated';
  message?: string;
}

export function migratePayload(raw: Record<string, unknown>): { payload: Record<string, unknown>; migrated: boolean } {
  let v = typeof raw.version === 'number' ? raw.version : 1;
  let payload = raw;
  let migrated = false;
  while (v < SAVE_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new Error(`No migration from save version ${v}`);
    payload = fn(payload);
    v = typeof payload.version === 'number' ? payload.version : v + 1;
    migrated = true;
  }
  if (v > SAVE_VERSION) throw new Error(`Save version ${v} is newer than this build (${SAVE_VERSION})`);
  return { payload, migrated };
}

function parseSafe(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export class SaveManager {
  /** Last write error, if any (surfaced in the settings / hub UI). */
  lastWriteError: string | null = null;

  constructor(private storage: Storage | null = safeLocalStorage()) {}

  get available(): boolean { return this.storage !== null; }

  loadCampaign(): LoadResult<Record<string, unknown>> {
    if (!this.storage) return { data: null, status: 'missing', message: 'Browser storage unavailable; progress will not persist.' };
    const primary = this.storage.getItem(KEY);
    const backup = this.storage.getItem(BACKUP_KEY);
    if (primary === null && backup === null) return { data: null, status: 'missing' };

    const tryPayload = (text: string | null): Record<string, unknown> | null => {
      const obj = parseSafe(text);
      if (!obj) return null;
      try {
        const { payload, migrated } = migratePayload(obj);
        (payload as Record<string, unknown>).__migrated = migrated;
        return payload;
      } catch {
        return null;
      }
    };

    const p = tryPayload(primary);
    if (p) return { data: p, status: (p as { __migrated?: boolean }).__migrated ? 'migrated' : 'ok' };
    const b = tryPayload(backup);
    if (b) return { data: b, status: 'recovered-backup', message: 'Primary save was unreadable; restored from backup.' };
    return { data: null, status: 'corrupt', message: 'Save data is corrupted and no backup could be read.' };
  }

  saveCampaign(data: Record<string, unknown>): boolean {
    if (!this.storage) { this.lastWriteError = 'Storage unavailable'; return false; }
    const payload = JSON.stringify({ ...data, version: SAVE_VERSION, savedAt: new Date().toISOString() });
    try {
      // rotate: keep previous good primary as backup
      const prev = this.storage.getItem(KEY);
      if (prev) {
        const prevObj = parseSafe(prev);
        if (prevObj) this.storage.setItem(BACKUP_KEY, prev);
      }
      this.storage.setItem(KEY, payload);
      this.lastWriteError = null;
      return true;
    } catch (err) {
      this.lastWriteError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  clearCampaign(): void {
    this.storage?.removeItem(KEY);
    this.storage?.removeItem(BACKUP_KEY);
  }

  loadSettings(): Record<string, unknown> | null {
    return parseSafe(this.storage?.getItem(SETTINGS_KEY) ?? null);
  }

  saveSettings(s: Record<string, unknown>): boolean {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
      return true;
    } catch (err) {
      this.lastWriteError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__ob_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
