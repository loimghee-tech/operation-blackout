import { describe, it, expect } from 'vitest';
import { BANK_LEVEL } from '../src/missions/bankLevel';
import { BANK_DEFINITION, CONTRACTS } from '../src/missions/bank';
import { findRoom } from '../src/world/level';
import { planningOptions } from '../src/ui/menus';
import { newCampaign } from '../src/progression/campaign';

const L = BANK_LEVEL;
const wpIds = new Set(L.waypoints.map((w) => w.id));
const doorIds = new Set(L.doors.map((d) => d.id));

describe('bank level integrity', () => {
  it('has unique ids for doors, devices, containers, loot, spawns and waypoints', () => {
    for (const ids of [L.doors.map((d) => d.id), L.devices.map((d) => d.id), L.lootContainers.map((c) => c.id), L.lootSpawns.map((l) => l.id), L.spawnPoints.map((s) => s.id), L.waypoints.map((w) => w.id)]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every patrol references existing waypoints', () => {
    for (const p of L.patrols) for (const w of p.waypoints) expect(wpIds.has(w)).toBe(true);
  });

  it('every loot container content exists as a loot spawn', () => {
    const lootIds = new Set(L.lootSpawns.map((l) => l.id));
    for (const c of L.lootContainers) for (const id of c.contains ?? []) expect(lootIds.has(id)).toBe(true);
  });

  it('every loot spawn inside a container refers to an existing container', () => {
    const cIds = new Set(L.lootContainers.map((c) => c.id));
    for (const l of L.lootSpawns) if (l.insideContainer) expect(cIds.has(l.insideContainer)).toBe(true);
  });

  it('the vault objective door and its relay device exist', () => {
    expect(doorIds.has('d_vault')).toBe(true);
    expect(L.devices.find((d) => d.id === 'dev_vault')?.params?.unlockDoor).toBe('d_vault');
  });

  it('every planning entry and escape spawn exists for the mission definition', () => {
    const planKeys = new Set(L.spawnPoints.map((s) => s.planKey));
    for (const e of BANK_DEFINITION.entryIds) expect(planKeys.has(`entry:${e}`)).toBe(true);
    for (const e of BANK_DEFINITION.escapeIds) expect(planKeys.has(`escape:${e}`)).toBe(true);
  });

  it('cameras, devices, loot and spawns are placed inside a room', () => {
    const inRoom = (p: { x: number; z: number }) => L.rooms.some((r) => p.x >= r.x0 - 0.5 && p.x <= r.x1 + 0.5 && p.z >= r.z0 - 0.5 && p.z <= r.z1 + 0.5);
    for (const d of L.devices) expect(inRoom(d.position)).toBe(true);
    for (const c of L.cameras) expect(inRoom(c.position)).toBe(true);
    for (const s of L.spawnPoints.filter((x) => x.kind === 'entry')) expect(inRoom(s.position)).toBe(true);
  });

  it('the vault is reachable only through its door (room lookup)', () => {
    expect(findRoom(L.rooms, { x: -13, y: 0, z: -8 })?.id).toBe('vault');
    expect(findRoom(L.rooms, { x: 0, y: 0, z: 6 })?.id).toBe('lobby');
  });

  it('every interactive door has a sensible access tier and lock', () => {
    const tiers = new Set(['public', 'staff', 'security', 'vault', 'service', 'police', 'executive']);
    for (const d of L.doors) {
      expect(tiers.has(d.access)).toBe(true);
      if (d.locked) expect(d.lock).not.toBe('none');
    }
  });
});

describe('contracts and planning', () => {
  it('the bank is the only playable contract; others are clearly locked', () => {
    expect(CONTRACTS.filter((c) => c.status === 'available').map((c) => c.id)).toEqual(['bank_central']);
    expect(CONTRACTS.filter((c) => c.status === 'locked').every((c) => !!c.unlockNote)).toBe(true);
  });

  it('planning offers all three entries and three escape routes', () => {
    const o = planningOptions(newCampaign());
    expect(o.entries.map((e) => e[0])).toEqual(['front', 'staff', 'service']);
    expect(o.escapes.map((e) => e[0])).toEqual(['van_street', 'alley_car', 'service_tunnel']);
  });

  it('the mission has a briefing, objectives and a par time', () => {
    expect(BANK_DEFINITION.briefing.length).toBeGreaterThanOrEqual(4);
    expect(BANK_DEFINITION.objectives.length).toBeGreaterThanOrEqual(5);
    expect(BANK_DEFINITION.parTime).toBeGreaterThan(0);
  });
});
