import { describe, it, expect } from 'vitest';
import { effectiveWeaponStats, WEAPONS } from '../src/config/weapons';
import { WeaponSystem, falloffMult, applySpread } from '../src/weapons/weaponSystem';
import { Rng } from '../src/core/rng';

describe('weapon statistics', () => {
  it('a suppressor cuts the noise and an extended magazine adds rounds', () => {
    const base = effectiveWeaponStats(WEAPONS.smg_kobra, []);
    const quiet = effectiveWeaponStats(WEAPONS.smg_kobra, ['suppressor_light']);
    const mag = effectiveWeaponStats(WEAPONS.smg_kobra, ['mag_extended']);
    expect(quiet.noiseLevel).toBeLessThan(base.noiseLevel * 0.5);
    expect(quiet.suppressed).toBe(true);
    expect(mag.magazine).toBeGreaterThan(base.magazine);
  });

  it('the precision scope tightens ADS spread only on the rifle', () => {
    const rifle = effectiveWeaponStats(WEAPONS.rifle_sentinel, ['optic_scope4x']);
    expect(rifle.spreadAds).toBeLessThan(WEAPONS.rifle_sentinel.spreadAds);
  });

  it('weapons differ in more than damage: shotguns pellet, SMGs fire fast, rifles reach far', () => {
    expect(WEAPONS.shotgun_breaker.pellets).toBeGreaterThan(1);
    expect(WEAPONS.smg_vector9.fireRate).toBeGreaterThan(WEAPONS.rifle_sentinel.fireRate);
    expect(WEAPONS.rifle_sentinel.range1).toBeGreaterThan(WEAPONS.smg_kobra.range1);
    expect(WEAPONS.smg_kobra.recoilVertical).not.toBe(WEAPONS.pistol_m9.recoilVertical);
  });

  it('damage falls off with distance between range0 and range1', () => {
    expect(falloffMult(5, 10, 40, 0.5)).toBe(1);
    expect(falloffMult(40, 10, 40, 0.5)).toBe(0.5);
    expect(falloffMult(25, 10, 40, 0.5)).toBeGreaterThan(0.5);
    expect(falloffMult(25, 10, 40, 0.5)).toBeLessThan(1);
  });

  it('zero spread keeps the exact direction', () => {
    const f = { x: 0, y: 0, z: 1 };
    expect(applySpread(f, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0, new Rng(3))).toEqual(f);
  });
});

describe('weapon firing', () => {
  const ws = () => {
    const w = new WeaponSystem(new Rng(7));
    w.equip(0, 'smg_kobra', [], 1);
    w.active = 0;
    return w;
  };
  const input = (over: Partial<Parameters<WeaponSystem['update']>[1]> = {}) => ({
    fireHeld: true, firePressed: true, reloadPressed: false, aimHeld: false, sprinting: false, moving: false, crouched: false,
    handlingMult: 1, reloadSpeedMult: 1, swapMult: 1, ammoType: 'standard' as const, ...over,
  });
  const v = { x: 0, y: 0, z: 0 };
  const fwd = { x: 0, y: 0, z: 1 };

  it('automatic fire releases the right number of rounds even in one long frame', () => {
    const w = ws();
    const res = w.update(0.2, input(), v, fwd, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    // 850 rpm = ~14.2 rounds/s → about 2-3 rounds in 0.2 s (cap of 8 per frame)
    expect(res.shots.length).toBeGreaterThanOrEqual(2);
    expect(res.shots.length).toBeLessThanOrEqual(4);
    expect(w.current!.mag).toBe(WEAPONS.smg_kobra.magazine - res.shots.length);
  });

  it('empty magazine clicks and starts an automatic reload', () => {
    const w = ws();
    w.current!.mag = 0;
    const res = w.update(0.05, input({ firePressed: true }), v, fwd, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(res.shots.length).toBe(0);
    expect(res.emptyClick || res.reloadStarted).toBeTruthy();
  });

  it('sprinting cancels a reload (interruption rule)', () => {
    const w = ws();
    w.current!.mag = 10;
    w.update(0.016, input({ reloadPressed: true, firePressed: false, fireHeld: false }), v, fwd, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(w.current!.reloadT).toBeGreaterThan(0);
    const res = w.update(0.016, input({ sprinting: true, firePressed: false, fireHeld: false }), v, fwd, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(res.reloadInterrupted).toBe(true);
  });

  it('a semi-automatic pistol fires once per press', () => {
    const w = new WeaponSystem(new Rng(1));
    w.equip(0, 'pistol_m9', [], 1);
    const res = w.update(0.5, input({ fireHeld: true, firePressed: true }), v, fwd, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(res.shots.length).toBe(1);
  });
});
