/**
 * THE CENTRAL BANK — data definition.
 *
 * Plan (metres, +x east, +z south, y up). Single walkable level:
 *
 *   z=-12 ┌────────────┬─────────┬─────────┬────────────┐  service door (N)
 *         │  VAULT     │ ANTE-   │SECURITY │  STORAGE   │
 *         │ (gold)     │ CHAMBER │ ROOM    │ (cash cage)│
 *   z=-4  ├─────door───┴─────────┴──door───┴──door──────┤
 *         │  LOBBY (public: tellers, reception, seats) │ CORRIDOR (staff)     │  staff door (E)
 *   z=4   │                                             ├──door──┐ OFFICE (mgr safe)
 *   z=12  └──────── front door (S) ─────────────────────┴────────┴──────────┘
 *
 * Entries:  FRONT (public lobby, cameras + guards)
 *           STAFF (east corridor, needs staff/keycard or disguise, or hack)
 *           SERVICE (north, breachable/lockpick, or engineer route)
 */
import type { LevelData, DoorDef, CameraDeviceDef, DeviceDef, LootSpawnDef, LootContainerDef, WaypointDef, PatrolDef, HidingSpotDef, SpawnPointDef, LightDef, BoxDef, PropDef, RoomDef } from '../world/level';
import { block, ceilingSlab, floor, gap, room, wallX, wallZ } from '../world/levelHelpers';

const H = 3.6;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
const rooms: RoomDef[] = [
  room('lobby', 'Public Lobby', -18, 4, -4, 12, ['public', 'lobby'], 'public', { lightLevel: 0.9 }),
  room('antechamber', 'Vault Antechamber', -8, 4, -11.8, -4.2, ['secure', 'staff'], 'security', { lightLevel: 0.7 }),
  room('vault', 'Vault', -17.5, -9, -11.8, -4.2, ['vault'], 'vault', { lightLevel: 0.5 }),
  room('security', 'Security Room', 4.3, 11.5, -11.8, -4.2, ['security'], 'security', { lightLevel: 0.7 }),
  room('storage', 'Storage & Cash Cage', 11.8, 17.8, -11.8, -4.2, ['staff', 'service'], 'staff', { lightLevel: 0.6 }),
  room('corridor', 'Staff Corridor', 4, 18, -4, 4, ['staff', 'corridor'], 'staff', { lightLevel: 0.65 }),
  room('office', 'Manager Office', 4, 18, 4, 12, ['office', 'staff'], 'staff', { lightLevel: 0.75 }),
  room('street', 'Street & Alleys', -44, 44, -44, 44, ['street', 'outside'], 'public', { lightLevel: 1 }),
];

// ---------------------------------------------------------------------------
// Walls and structure
// ---------------------------------------------------------------------------
const boxes: BoxDef[] = [];
const push = (...b: BoxDef[]) => boxes.push(...b);

// Floors (per room, surface-specific) — walkable tops at y=0
push(floor(-18, 4, -4, 12, 'marble', 'marble', 'lobby'));
push(floor(-8, 4, -11.8, -4.2, 'marble', 'marbleDark', 'antechamber'));
push(floor(-17.5, -9, -11.8, -4.2, 'metal', 'metalDark', 'vault'));
push(floor(4.3, 11.5, -11.8, -4.2, 'carpet', 'carpet', 'security'));
push(floor(11.8, 17.8, -11.8, -4.2, 'concrete', 'concrete', 'storage'));
push(floor(4, 18, -4, 4, 'carpet', 'carpetRed', 'corridor'));
push(floor(4, 18, 4, 12, 'carpet', 'carpet', 'office'));
push(floor(-44, 44, -44, 44, 'concrete', 'sidewalk', 'street'));
// Road & sidewalk outside the front door
push({ min: { x: -44, y: -0.25, z: 12 }, max: { x: 44, y: -0.05, z: 14 }, kind: 'floor', surface: 'concrete', material: 'sidewalk', blocksNav: false, roomId: 'street' });
push({ min: { x: -44, y: -0.3, z: 14 }, max: { x: 44, y: -0.1, z: 44 }, kind: 'floor', surface: 'concrete', material: 'asphalt', blocksNav: false, roomId: 'street' });

// Exterior walls
push(...wallZ(12, -18, 18, { gaps: [gap(-2, 2)], height: 4.2, thickness: 0.4, material: 'brick' }));   // south (front door)
push(...wallZ(-12, -18, 18, { gaps: [gap(14.2, 15.8)], height: 4.2, thickness: 0.4, material: 'brick' }));  // north (service)
push(...wallX(-18, -12, 12, { height: 4.2, thickness: 0.4, material: 'brick' }));                           // west
push(...wallX(18, -12, 12, { gaps: [gap(-1.2, 0.8)], height: 4.2, thickness: 0.4, material: 'brick' }));   // east (staff)

// Interior walls
push(...wallZ(-4, -18, 18, { gaps: [gap(-2, -0.2), gap(7, 8.6), gap(14.2, 15.8)] }));                     // antechamber/security/storage from lobby/corridor
push(...wallX(4, -12, 12, { gaps: [gap(0, 1.6), gap(6, 7.6)] }));                                          // lobby <-> corridor / office; antechamber|security
push(...wallZ(4, 4, 18, { gaps: [gap(12, 13.6)] }));                                                       // corridor <-> office
push(...wallX(-8.5, -12, -4.2, { gaps: [gap(-8.8, -6.8)], thickness: 1.0, material: 'vaultSteel', height: H })); // vault wall (thick), gap = vault door
push(...wallX(11.65, -12, -4.2, { height: H }));                                                           // security | storage

// Ceiling slab (visual + shadow occluder, not physical)
push(ceilingSlab(-18, 18, -12, 12, H));

// Counters & furniture
push(block(-16, -6, 1.6, 2.2, 1.1, 'lobby', 'marble', 0xdedad0));        // teller counter
push(block(-6.8, -5.2, 7.6, 10.4, 1.0, 'lobby', 'wood', 0x5a4330));      // reception desk
push(block(-16, -13, 6.4, 7.0, 0.45, 'lobby', 'wood', 0x3d4650));        // bench 1
push(block(-16, -13, 8.2, 8.8, 0.45, 'lobby', 'wood', 0x3d4650));        // bench 2
push(block(-11, -8, 6.4, 7.0, 0.45, 'lobby', 'wood', 0x3d4650));
push(block(-11, -8, 8.2, 8.8, 0.45, 'lobby', 'wood', 0x3d4650));
push(block(-2, 2, -1.8, -1.2, 0.8, 'lobby', 'wood', 0x6b5a48));         // planter/low plinth
push(block(-14, -12, -3.2, -2.6, 0.9, 'lobby', 'wood', 0x6b5a48));
push(block(6, 9, 5, 5.9, 0.9, 'office', 'wood', 0x4c3a2a));              // manager desk
push(block(14, 16.5, 10, 11, 0.9, 'office', 'wood', 0x4c3a2a));          // office desk / safe bench
push(block(6, 8, -10, -9, 1.0, 'security', 'metalDark', 0x2a2e33));      // security console
push(block(-6.5, -4.6, -10.5, -9.2, 1.0, 'antechamber', 'metal', 0x6f7880)); // vault control pedestal
push(block(12.5, 14.5, -10.8, -9.6, 1.0, 'storage', 'metalDark', 0x555c63)); // crate stack
push(block(15.2, 17.2, -6.5, -5.2, 1.0, 'storage', 'metalDark', 0x555c63));
push(block(-15, -12, -10.5, -9, 1.0, 'vault', 'metalDark', 0x3c434b));  // gold shelving
push(block(-15, -12, -7.4, -5.9, 1.0, 'vault', 'metalDark', 0x3c434b));
push(block(8, 9.2, -6.5, -5.3, 0.9, 'security', 'metalDark', 0x555c63)); // locker bank
// Outside obstacles (cover)
push(block(-30, -26, 22, 25, 1.2, 'street', 'concrete', 0x6a6c70));     // van-side barrier
push(block(12, 16, 22, 24, 1.1, 'street', 'concrete', 0x6a6c70));        // planter block
push(block(26, 28, -2, 3, 1.8, 'street', 'metalDark', 0x4a5057));        // dumpster-ish
push(block(4.5, 11.5, 21.5, 26.5, 2.3, 'street', 'metalDark', 0x9aa3ad)); // getaway van body (solid)
push(block(25.5, 28.5, 9.5, 13.5, 1.4, 'street', 'metalDark', 0x3b5a7a)); // alley car body (solid)
push(block(-6, 1, -32, -29, 1.4, 'street', 'concrete', 0x6a6c70));      // north barricade

// ---------------------------------------------------------------------------
// Doors — footprints are the gap openings (closed doors are solid).
// ---------------------------------------------------------------------------
const door = (
  id: string, label: string, x0: number, x1: number, z0: number, z1: number,
  o: Partial<DoorDef> = {},
): DoorDef => ({
  id, label, x0, x1, z0, z1, y0: 0, y1: 2.5, swing: 'slide', locked: false, lock: 'none', access: 'public', startsOpen: false, ...o,
});

const doors: DoorDef[] = [
  door('d_front', 'Front Entrance', -2, 2, 11.85, 12.15, { startsOpen: true, lock: 'none', access: 'public', double: true }),
  door('d_service', 'Service Door (North)', 14.2, 15.8, -12.15, -11.85, { locked: true, lock: 'breachable', access: 'service', hackLevel: 2 }),
  door('d_staff', 'Staff Entrance (East)', 17.85, 18.15, -1.2, 0.8, { locked: true, lock: 'keycard', access: 'staff', hackLevel: 2 }),
  door('d_corr_lobby', 'Lobby to Staff Corridor', 3.85, 4.15, 0, 1.6, { locked: true, lock: 'keypad', access: 'staff', hackLevel: 1 }),
  door('d_office_lobby', 'Manager Office Door', 3.85, 4.15, 6, 7.6, { locked: true, lock: 'electronic', access: 'staff', hackLevel: 1 }),
  door('d_office_corr', 'Office Access', 12, 13.6, 3.85, 4.15, { locked: true, lock: 'keycard', access: 'staff', hackLevel: 2 }),
  door('d_antechamber', 'Vault Antechamber', -2, -0.2, -4.15, -3.85, { locked: true, lock: 'keycard', access: 'staff' }),
  door('d_security', 'Security Room', 7, 8.6, -4.15, -3.85, { locked: true, lock: 'keypad', access: 'security', hackLevel: 3 }),
  door('d_storage', 'Cash Storage', 14.2, 15.8, -4.15, -3.85, { locked: true, lock: 'keycard', access: 'staff', hackLevel: 2 }),
  door('d_vault', 'Vault Door', -8.9, -8.1, -8.8, -6.8, { locked: true, lock: 'electronic', access: 'vault', hackLevel: 4, swing: 'hinge' }),
];

// ---------------------------------------------------------------------------
// Waypoints and patrols (ids referenced by NPC specs)
// ---------------------------------------------------------------------------
const wp = (id: string, x: number, z: number, roomId?: string): WaypointDef => ({ id, position: { x, y: 0, z }, roomId });
const waypoints: WaypointDef[] = [
  wp('L1', -14, 4.8, 'lobby'), wp('L2', -1, 9.5, 'lobby'), wp('L3', 2.2, 2.6, 'lobby'), wp('L4', -10, -2.4, 'lobby'),
  wp('L5', -12, 10.5, 'lobby'), wp('L6', -2, 4.6, 'lobby'), wp('L7', -7.5, 10.8, 'lobby'), wp('L8', 1.2, 10.4, 'lobby'),
  wp('C1', 6, -1.8, 'corridor'), wp('C2', 16.5, -2, 'corridor'), wp('C3', 16.5, 2.2, 'corridor'), wp('C4', 6, 2.2, 'corridor'),
  wp('A1', -4, -8, 'antechamber'), wp('A2', -6, -6, 'antechamber'), wp('A3', 1.5, -9.4, 'antechamber'),
  wp('S1', 8, -7.6, 'security'), wp('S2', 10.2, -9.5, 'security'),
  wp('T1', 14.8, -7.5, 'storage'), wp('T2', 16.4, -9.8, 'storage'), wp('T3', 13, -6, 'storage'),
  wp('O1', 9, 6.8, 'office'), wp('O2', 15, 8, 'office'), wp('O3', 14.5, 5.2, 'office'),
  wp('X1', -4.5, 15.5, 'street'), wp('X2', 6.5, 15.5, 'street'),
  wp('CV1', -13.2, 6.0), wp('CV2', -8.8, 7.6), wp('CV3', -13.5, 9.2), wp('CV4', -2.6, 6.2), wp('CV5', -1.4, 10.2), wp('CV6', -9.0, 10.9),
  wp('TEL1', -13.4, 0.6, 'lobby'), wp('TEL2', -10, 0.6, 'lobby'), wp('TEL3', -7, 0.6, 'lobby'),
  wp('REC', -3.8, 9.2, 'lobby'),
];

const patrols: PatrolDef[] = [
  { id: 'p_lobby', waypoints: ['L1', 'L2', 'L3', 'L4', 'L6'], pauseSeconds: [2, 1, 3, 1, 1] },
  { id: 'p_corridor', waypoints: ['C1', 'C2', 'C3', 'C4'], pauseSeconds: [2, 3, 2, 1] },
  { id: 'p_antechamber', waypoints: ['A1', 'A2', 'A3'], pauseSeconds: [3, 4, 2] },
  { id: 'p_storage', waypoints: ['T1', 'T2', 'T3'], pauseSeconds: [2, 2, 3] },
  { id: 'p_office', waypoints: ['O1', 'O2', 'O3'], pauseSeconds: [5, 3, 2] },
  { id: 'p_exterior', waypoints: ['X1', 'X2'], pauseSeconds: [4, 4] },
];

// ---------------------------------------------------------------------------
// Cameras (sweep arcs; hackable via camera hub)
// ---------------------------------------------------------------------------
const cam = (id: string, label: string, x: number, z: number, yaw: number, arc: number, speed: number, range: number, roomId: string): CameraDeviceDef => ({
  id, label, position: { x, y: 3.1, z }, yaw, sweepArc: arc, sweepSpeed: speed, range, fov: 0.95, hackLevel: 2, roomId,
});
const cameras: CameraDeviceDef[] = [
  cam('cam_lobby_w', 'Lobby West', -16.5, 10.8, 0.6, 1.6, 0.35, 18, 'lobby'),
  cam('cam_lobby_e', 'Lobby East', 2.9, 10.8, -2.2, 1.2, 0.3, 16, 'lobby'),
  cam('cam_teller', 'Teller Line', -4.4, -3.6, 0, 0.0, 0, 15, 'lobby'),
  cam('cam_corridor', 'Staff Corridor', 16.6, 3.6, -2.5, 0.8, 0.5, 14, 'corridor'),
  cam('cam_vault', 'Vault Antechamber', -7.2, -10.6, 0.8, 1.2, 0.4, 12, 'antechamber'),
  cam('cam_front', 'Front Steps', 5, 11.6, 3.2, 1.3, 0.4, 20, 'street'),
  cam('cam_office', 'Manager Office', 13, 11.6, 3.0, 1.0, 0.25, 12, 'office'),
];

// ---------------------------------------------------------------------------
// Devices (interactive mission systems)
// ---------------------------------------------------------------------------
const devices: DeviceDef[] = [
  { id: 'dev_reception', kind: 'terminal', label: 'Reception Terminal', position: { x: -4.5, y: 1.0, z: 8.8 }, hackLevel: 1, roomId: 'lobby',
    params: { unlockDoor: 'd_office_lobby', intel: 'Manager office door is on a staff network. Reception terminal has traced its lock.' } },
  { id: 'dev_alarm', kind: 'alarm_panel', label: 'Alarm Control Panel', position: { x: 10.2, y: 1.2, z: -7.4 }, hackLevel: 3, roomId: 'security' },
  { id: 'dev_camhub', kind: 'camera_hub', label: 'Camera Hub', position: { x: 9.6, y: 1.3, z: -9.3 }, hackLevel: 2, roomId: 'security' },
  { id: 'dev_vault', kind: 'vault_control', label: 'Vault Control Relay', position: { x: -6.6, y: 1.2, z: -7.6 }, hackLevel: 4, roomId: 'antechamber',
    params: { unlockDoor: 'd_vault' } },
  { id: 'dev_drill', kind: 'drill_point', label: 'Vault Wall Drill Point', position: { x: -8.4, y: 1.0, z: -10.6 }, hackLevel: 0, roomId: 'antechamber' },
];

// ---------------------------------------------------------------------------
// Containers, loot and hiding spots
// ---------------------------------------------------------------------------
const lootContainers: LootContainerDef[] = [
  { id: 'till_1', label: 'Teller Till 1', kind: 'till', position: { x: -13.4, y: 1.0, z: 0.9 }, lock: 'none', openTime: 1.5, roomId: 'lobby', contains: ['cash_till_1'] },
  { id: 'till_2', label: 'Teller Till 2', kind: 'till', position: { x: -10, y: 1.0, z: 0.9 }, lock: 'none', openTime: 1.5, roomId: 'lobby', contains: ['cash_till_2'] },
  { id: 'till_3', label: 'Teller Till 3', kind: 'till', position: { x: -7, y: 1.0, z: 0.9 }, lock: 'none', openTime: 1.5, roomId: 'lobby', contains: ['cash_till_3'] },
  { id: 'deposit', label: 'Deposit Box Wall', kind: 'deposit_box', position: { x: 1.2, y: 1.0, z: -11.4 }, lock: 'lockpick', hackLevel: 2, openTime: 6, roomId: 'antechamber', contains: ['deposit_jewels'] },
  { id: 'mgr_safe', label: 'Manager Safe', kind: 'safe', position: { x: 17.2, y: 1.0, z: 10.6 }, lock: 'electronic', hackLevel: 2, openTime: 7, roomId: 'office', contains: ['mgr_cash'] },
  { id: 'cash_cage', label: 'Cash Cage', kind: 'cabinet', position: { x: 17.2, y: 1.0, z: -9.6 }, lock: 'lockpick', hackLevel: 2, openTime: 6, roomId: 'storage', contains: ['cage_cash'] },
  { id: 'vault_stack', label: 'Vault Gold Shelving', kind: 'strongbox', position: { x: -13.5, y: 1.0, z: -9.6 }, lock: 'none', openTime: 0, roomId: 'vault', contains: ['gold_1', 'gold_2', 'gold_3', 'gold_4'] },
];

const lootSpawns: LootSpawnDef[] = [
  { id: 'cash_till_1', kind: 'cash', label: 'Till cash', position: { x: -13.4, y: 1.1, z: 0.9 }, value: 3200, optional: true, weight: 1, insideContainer: 'till_1' },
  { id: 'cash_till_2', kind: 'cash', label: 'Till cash', position: { x: -10, y: 1.1, z: 0.9 }, value: 3200, optional: true, weight: 1, insideContainer: 'till_2' },
  { id: 'cash_till_3', kind: 'cash', label: 'Till cash', position: { x: -7, y: 1.1, z: 0.9 }, value: 3200, optional: true, weight: 1, insideContainer: 'till_3' },
  { id: 'deposit_jewels', kind: 'valuables', label: 'Deposit box jewels', position: { x: 1.2, y: 1.2, z: -11.3 }, value: 18000, optional: true, weight: 1, insideContainer: 'deposit' },
  { id: 'mgr_cash', kind: 'cash', label: 'Manager safe cash', position: { x: 17.2, y: 1.1, z: 10.4 }, value: 16000, optional: true, weight: 1, insideContainer: 'mgr_safe' },
  { id: 'cage_cash', kind: 'cash', label: 'Cash cage bundles', position: { x: 17.2, y: 1.1, z: -9.4 }, value: 24000, optional: true, weight: 2, insideContainer: 'cash_cage' },
  { id: 'gold_1', kind: 'objective', label: 'Gold bar', position: { x: -13.4, y: 1.1, z: -9.6 }, value: 60000, optional: false, weight: 2, insideContainer: 'vault_stack' },
  { id: 'gold_2', kind: 'objective', label: 'Gold bar', position: { x: -13.9, y: 1.1, z: -10.2 }, value: 60000, optional: false, weight: 2, insideContainer: 'vault_stack' },
  { id: 'gold_3', kind: 'objective', label: 'Gold bar', position: { x: -13.4, y: 1.1, z: -7.9 }, value: 60000, optional: false, weight: 2, insideContainer: 'vault_stack' },
  { id: 'gold_4', kind: 'objective', label: 'Gold bar', position: { x: -13.9, y: 1.1, z: -7.1 }, value: 60000, optional: false, weight: 2, insideContainer: 'vault_stack' },
];

const hidingSpots: HidingSpotDef[] = [
  { id: 'hide_office_locker', kind: 'locker', label: 'Staff Locker', position: { x: 5.2, y: 0, z: 10.8 }, capacity: 1, roomId: 'office' },
  { id: 'hide_storage_closet', kind: 'closet', label: 'Storage Closet', position: { x: 12.4, y: 0, z: -5.2 }, capacity: 1, roomId: 'storage' },
  { id: 'hide_lobby_desk', kind: 'under_desk', label: 'Under Reception Desk', position: { x: -4.5, y: 0, z: 10.1 }, capacity: 1, roomId: 'lobby' },
  { id: 'hide_corridor_bin', kind: 'dumpster', label: 'Corridor Supply Bin', position: { x: 9.4, y: 0, z: 2.6 }, capacity: 1, roomId: 'corridor' },
];

// ---------------------------------------------------------------------------
// Spawn points (entries, escapes, response)
// ---------------------------------------------------------------------------
const spawnPoints: SpawnPointDef[] = [
  { id: 'spawn_street', label: 'Street start', kind: 'entry', position: { x: 0, y: 0, z: 34 }, facing: 0, planKey: 'start:street' },
  { id: 'spawn_alley', label: 'East alley start', kind: 'entry', position: { x: 24, y: 0, z: -2 }, facing: Math.PI / 2, planKey: 'start:alley' },
  { id: 'spawn_front', label: 'Front entrance', kind: 'entry', position: { x: 0, y: 0, z: 14.4 }, facing: 0, planKey: 'entry:front' },
  { id: 'spawn_staff', label: 'Staff entrance', kind: 'entry', position: { x: 20.6, y: 0, z: 0 }, facing: Math.PI / 2, planKey: 'entry:staff' },
  { id: 'spawn_service', label: 'Service entrance', kind: 'entry', position: { x: 15, y: 0, z: -14 }, facing: Math.PI, planKey: 'entry:service' },
  { id: 'ext_van_street', label: 'Street van', kind: 'escape', position: { x: 8, y: 0, z: 18.6 }, planKey: 'escape:van_street', tags: ['van'] },
  { id: 'ext_alley_car', label: 'Alley car', kind: 'escape', position: { x: 23.4, y: 0, z: 7 }, planKey: 'escape:alley_car', tags: ['car'] },
  { id: 'ext_service_tunnel', label: 'North service route', kind: 'escape', position: { x: 12, y: 0, z: -24 }, planKey: 'escape:service_tunnel', tags: ['engineer'] },
  { id: 'resp_street', label: 'Police (street)', kind: 'response', position: { x: -6, y: 0, z: 30 } },
  { id: 'resp_alley', label: 'Police (alley)', kind: 'response', position: { x: 32, y: 0, z: -6 } },
  { id: 'resp_north', label: 'Police (north)', kind: 'response', position: { x: -8, y: 0, z: -30 } },
];

// ---------------------------------------------------------------------------
// Lights & props
// ---------------------------------------------------------------------------
const lights: LightDef[] = [
  { position: { x: -12, y: 3.3, z: 4 }, color: 0xfff1d6, intensity: 9, radius: 14, kind: 'ceiling' },
  { position: { x: 0, y: 3.3, z: 8 }, color: 0xfff1d6, intensity: 9, radius: 14, kind: 'ceiling' },
  { position: { x: -4, y: 3.3, z: -8 }, color: 0xd6e4ff, intensity: 6, radius: 10, kind: 'ceiling' },
  { position: { x: 8, y: 3.3, z: -8 }, color: 0xd6e4ff, intensity: 5, radius: 9, kind: 'ceiling' },
  { position: { x: 15, y: 3.3, z: -8 }, color: 0xfff1d6, intensity: 6, radius: 9, kind: 'ceiling' },
  { position: { x: 11, y: 3.3, z: 2 }, color: 0xfff1d6, intensity: 7, radius: 10, kind: 'ceiling' },
  { position: { x: 13, y: 3.3, z: 8 }, color: 0xfff1d6, intensity: 6, radius: 10, kind: 'ceiling' },
  { position: { x: -12, y: 3.2, z: -8 }, color: 0xcfe0ff, intensity: 4, radius: 8, kind: 'ceiling' },
];

const props: PropDef[] = [
  { kind: 'plant', position: { x: -17, y: 0, z: -2 } },
  { kind: 'plant', position: { x: 3, y: 0, z: 11 } },
  { kind: 'atm', position: { x: -17.2, y: 0, z: 9 } },
  { kind: 'vault_door_frame', position: { x: -8.5, y: 0, z: -7.8 } },
  
  { kind: 'lamp_post', position: { x: 4, y: 0, z: 17 } },
  { kind: 'lamp_post', position: { x: -6, y: 0, z: 17 } },
  { kind: 'lamp_post', position: { x: 21, y: 0, z: 14 } },
  { kind: 'lamp_post', position: { x: 24, y: 0, z: -8 } },
];

export const BANK_LEVEL: LevelData = {
  id: 'central_bank',
  name: 'The Central Bank',
  bounds: { x0: -44, x1: 44, y0: -1, y1: 6, z0: -44, z1: 44 },
  rooms,
  boxes,
  stairs: [],
  doors,
  waypoints,
  patrols,
  lights,
  cameras,
  devices,
  lootSpawns,
  lootContainers,
  hidingSpots,
  spawnPoints,
  props,
  environment: {
    skyTop: 0x0a1020,
    skyBottom: 0x2a3446,
    fogColor: 0x1a2232,
    fogDensity: 0.012,
    sunDirection: { x: -0.4, y: 0.7, z: 0.5 },
    sunIntensity: 1.1,
    ambientIntensity: 0.45,
    night: true,
  },
};
