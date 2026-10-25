import { describe, it, expect } from 'vitest';
import { normalizeSettings, DEFAULT_SETTINGS } from '../src/progression/settings';

describe('settings normalisation', () => {
  it('returns defaults for missing or nonsense input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ fov: 'wide', shadows: 'ultra', mouseSensitivity: NaN })).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps numeric ranges to supported bounds', () => {
    const s = normalizeSettings({ fov: 500, renderScale: 9, volumeSfx: -2, viewDistance: 1 });
    expect(s.fov).toBe(100);
    expect(s.renderScale).toBe(1.5);
    expect(s.volumeSfx).toBe(0);
    expect(s.viewDistance).toBe(60);
  });
});
