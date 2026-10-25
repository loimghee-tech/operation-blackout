/**
 * Level data model. Levels are authored as plain data (rooms, boxes, doors,
 * devices...) and turned into three.js scenes + collision + navgrid by the
 * world builder. This keeps level content declarative and testable.
 */
import type { SurfaceType, Vec3 } from '../core/types';

export type AccessTier = 'public' | 'staff' | 'security' | 'vault' | 'service' | 'police' | 'executive';

export interface RoomDef {
  id: string;
  name: string;
  /** Room rectangle on XZ; floorY = walkable height; ceilingY for enclosure. */
  x0: number; x1: number; z0: number; z1: number;
  floorY: number;
  ceilingY: number;
  tags: string[];          // 'public' | 'staff' | 'office' | 'security' | 'vault' | 'street' | 'service' | 'lobby' ...
  access: AccessTier;
  /** Ambient light level 0..1 — feeds perception (dark rooms hide people). */
  lightLevel?: number;
}

export type BoxKind = 'floor' | 'wall' | 'ceiling' | 'obstacle' | 'step' | 'prop' | 'glass';

export interface BoxDef {
  min: Vec3;
  max: Vec3;
  kind: BoxKind;
  surface?: SurfaceType;
  material?: string;       // key into material library
  blocksSight?: boolean;   // default true except 'glass' (false)
  blocksNav?: boolean;     // default: kind !== 'floor' && kind !== 'ceiling'
  blocksMove?: boolean;    // default true; 'step' allows step-up
  roomId?: string;
  color?: number;          // override tint
  /** For instanced visual repetition (pillars, lights...). */
  visualOnly?: boolean;    // no collision
}

/** Stair region: walkable ramp of cells from floorY to floorY+rise. */
export interface StairDef {
  id: string;
  x0: number; x1: number; z0: number; z1: number;
  bottomY: number;
  topY: number;
  /** Direction of ascent: which axis goes from bottomY to topY. */
  riseAlong: '+x' | '-x' | '+z' | '-z';
  roomId?: string;
}

export type LockKind = 'none' | 'keypad' | 'keycard' | 'lockpick' | 'electronic' | 'breachable' | 'handle';

export interface DoorDef {
  id: string;
  label: string;
  /** Door footprint (thin box). Axis determines slide/swing direction. */
  x0: number; x1: number; z0: number; z1: number;
  y0: number; y1: number;
  swing: 'slide' | 'hinge';
  hingeSide?: 'left' | 'right';
  locked: boolean;
  lock: LockKind;
  /** Access tier needed to just walk through when unlocked. */
  access: AccessTier;
  /** Hack difficulty 1..5 for keypad/electronic locks (0 = not hackable). */
  hackLevel?: number;
  /** Auto-opens for NPCs with sufficient access. */
  npcUsable?: boolean;
  startsOpen?: boolean;
  double?: boolean; // double door visual
  material?: string;
  color?: number;
}

export interface WaypointDef {
  id: string;
  position: Vec3;
  roomId?: string;
}

export interface PatrolDef {
  id: string;
  waypoints: string[];    // waypoint ids
  pauseSeconds?: number[]; // dwell time per waypoint
  speedMult?: number;
}

export interface LightDef {
  position: Vec3;
  color: number;
  intensity: number;
  radius: number;
  kind: 'ceiling' | 'wall' | 'alarm' | 'exterior';
  castShadow?: boolean;
}

export interface CameraDeviceDef {
  id: string;
  label: string;
  position: Vec3;
  yaw: number;            // radians; base facing
  sweepArc: number;       // radians total sweep (0 = static)
  sweepSpeed: number;     // rad/s
  range: number;          // metres
  fov: number;            // radians
  hackLevel: number;      // 1..5
  roomId?: string;
}

export type DeviceKind =
  | 'alarm_panel' | 'vault_control' | 'terminal' | 'camera_hub'
  | 'server' | 'elevator_panel' | 'power_box' | 'safe' | 'drill_point';

export interface DeviceDef {
  id: string;
  kind: DeviceKind;
  label: string;
  position: Vec3;         // interaction point
  mountPosition?: Vec3;   // visual mount (wall)
  hackLevel: number;      // 1..5
  roomId?: string;
  /** Device-specific payload consumed by mission wiring. */
  params?: Record<string, unknown>;
}

export type LootKind = 'cash' | 'valuables' | 'gold' | 'objective' | 'ammo' | 'evidence' | 'intel';

export interface LootSpawnDef {
  id: string;
  kind: LootKind;
  label: string;
  position: Vec3;
  value: number;
  /** Container that must be opened first (id of loot container / safe). */
  insideContainer?: string;
  optional: boolean;
  /** Bag weight units (carry capacity limit). */
  weight?: number;
  visibleFromStart?: boolean;
}

export interface LootContainerDef {
  id: string;
  label: string;
  kind: 'till' | 'safe' | 'locker' | 'deposit_box' | 'cabinet' | 'atm' | 'strongbox';
  position: Vec3;
  lock: LockKind;
  hackLevel?: number;
  openTime: number;       // seconds base
  roomId?: string;
  contains?: string[];    // loot spawn ids
}

export interface HidingSpotDef {
  id: string;
  kind: 'locker' | 'under_desk' | 'closet' | 'dumpster';
  label: string;
  position: Vec3;
  capacity: number;       // bodies that fit (0 = player-only)
  roomId?: string;
}

export type SpawnKind = 'entry' | 'escape' | 'response';

export interface SpawnPointDef {
  id: string;
  label: string;
  kind: SpawnKind;
  position: Vec3;
  facing?: number;
  /** Planning option id that enables this spawn ('entry_alley', 'escape_van'...). */
  planKey?: string;
  tags?: string[];
}

export interface PropDef {
  kind: string;           // 'desk' | 'chair' | 'plant' | 'teller_booth' | ...
  position: Vec3;
  rotation?: number;
  scale?: number;
  color?: number;
  params?: Record<string, unknown>;
}

export interface LevelData {
  id: string;
  name: string;
  bounds: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  rooms: RoomDef[];
  boxes: BoxDef[];
  stairs: StairDef[];
  doors: DoorDef[];
  waypoints: WaypointDef[];
  patrols: PatrolDef[];
  lights: LightDef[];
  cameras: CameraDeviceDef[];
  devices: DeviceDef[];
  lootSpawns: LootSpawnDef[];
  lootContainers: LootContainerDef[];
  hidingSpots: HidingSpotDef[];
  spawnPoints: SpawnPointDef[];
  props: PropDef[];
  /** Exterior/ambience hints: sky color, fog, sun direction. */
  environment: {
    skyTop: number;
    skyBottom: number;
    fogColor: number;
    fogDensity: number;
    sunDirection: Vec3;
    sunIntensity: number;
    ambientIntensity: number;
    night?: boolean;
  };
}

export function findRoom(rooms: RoomDef[], p: Vec3): RoomDef | undefined {
  return rooms.find((r) =>
    p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1 &&
    Math.abs(p.y - r.floorY) < 2.5);
}

export function roomCenter(r: RoomDef): Vec3 {
  return { x: (r.x0 + r.x1) / 2, y: r.floorY, z: (r.z0 + r.z1) / 2 };
}
