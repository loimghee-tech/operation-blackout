import { describe, it, expect } from 'vitest';
import { BANK_LEVEL } from '../src/missions/bankLevel';
import { NavGrid, type NavQuery } from '../src/navigation/navgrid';

const CIV: NavQuery = { access: new Set(['public']), keys: false };
const GUARD: NavQuery = { access: new Set(['public', 'staff', 'security', 'service']), keys: true };
const POLICE: NavQuery = { access: new Set(['public', 'staff', 'security', 'service', 'police']), keys: true };

describe('bank navigation grid', () => {
  const nav = new NavGrid(BANK_LEVEL, 0.5, 0.36);

  it('lets civilians walk from street to the lobby through the front door', () => {
    const p = nav.findWorldPath({ x: 0, y: 0, z: 20 }, { x: -12, y: 0, z: 6 }, CIV);
    expect(p).not.toBeNull();
  });

  it('blocks civilians from staff-only corridor and office', () => {
    const p = nav.findWorldPath({ x: -12, y: 0, z: 6 }, { x: 10, y: 0, z: 0 }, CIV);
    expect(p).toBeNull();
  });

  it('lets guards reach the staff corridor through the lobby door', () => {
    const p = nav.findWorldPath({ x: -12, y: 0, z: 6 }, { x: 10, y: 0, z: 0 }, GUARD);
    expect(p).not.toBeNull();
  });

  it('never routes guards into the locked vault', () => {
    const p = nav.findWorldPath({ x: -12, y: 0, z: 6 }, { x: -13, y: 0, z: -8 }, GUARD);
    expect(p).toBeNull();
  });

  it('police breach locked staff doors but still cannot enter the vault tier', () => {
    expect(nav.findWorldPath({ x: -12, y: 0, z: 6 }, { x: -4, y: 0, z: -8 }, POLICE)).not.toBeNull();
    expect(nav.findWorldPath({ x: -12, y: 0, z: 6 }, { x: -13, y: 0, z: -8 }, POLICE)).toBeNull();
  });

  it('civilians cannot pass locked doors even when access tiers would allow it', () => {
    const CIV_STAFF: NavQuery = { access: new Set(['public', 'staff']), keys: false };
    expect(nav.findWorldPath({ x: -12, y: 0, z: 6 }, { x: 10, y: 0, z: 0 }, CIV_STAFF)).toBeNull();
  });

  it('paths never cross solid walls: every smoothed waypoint lies on a passable cell', () => {
    const p = nav.findWorldPath({ x: 0, y: 0, z: 20 }, { x: -6, y: 0, z: 3 }, CIV);
    expect(p).not.toBeNull();
    for (const n of p!) expect(nav.isPassableIgnoringDoors(n.cx, n.cz)).toBe(true);
  });

  it('locked doors remain impassable for everyone unless the planner ignores locks', () => {
    nav.setDoorLocked(BANK_LEVEL.doors.findIndex((d) => d.id === 'd_front'), true);
    const p = nav.findWorldPath({ x: 0, y: 0, z: 20 }, { x: -12, y: 0, z: 6 }, CIV);
    expect(p).toBeNull();
    nav.setDoorLocked(BANK_LEVEL.doors.findIndex((d) => d.id === 'd_front'), false);
  });
});
