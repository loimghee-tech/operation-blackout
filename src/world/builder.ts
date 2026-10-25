/**
 * Builds the three.js scene + physics + navigation from LevelData.
 * Every level-owned object is registered in LevelRuntime so gameplay systems
 * can find and mutate it (doors, cameras, devices, loot, containers).
 */
import * as THREE from 'three';
import type { LevelData, DoorDef, CameraDeviceDef, DeviceDef, LootSpawnDef, LootContainerDef, HidingSpotDef, PropDef, SpawnPointDef } from './level';
import type { Vec3 } from '../core/types';
import { PhysicsWorld, type ColliderBox } from './collision';
import { getMaterial, type MaterialKey } from './materials';
import { NavGrid } from '../navigation/navgrid';

export class DoorRuntime {
  open = false;
  locked: boolean;
  /** Visual slide progress 0 (closed) .. 1 (open). */
  t = 0;
  collider: ColliderBox | null = null;
  navIndex: number;
  /** Slide axis for panel: 'x' or 'z'. */
  readonly slideAxis: 'x' | 'z';
  readonly panelWidth: number;
  /** Health for breach/forced entry (0 = intact). */
  damage = 0;
  constructor(readonly def: DoorDef, readonly panel: THREE.Mesh, navIndex: number) {
    this.locked = def.locked;
    this.navIndex = navIndex;
    this.slideAxis = def.x1 - def.x0 >= def.z1 - def.z0 ? 'x' : 'z';
    this.panelWidth = this.slideAxis === 'x' ? def.x1 - def.x0 : def.z1 - def.z0;
  }
}

export interface CameraRuntime {
  def: CameraDeviceDef;
  group: THREE.Group;
  cone: THREE.Mesh;
  lens: THREE.Mesh;
  yaw: number;           // current aim (radians around Y)
  disabledUntil: number; // seconds (game clock)
  alertLevel: number;    // 0..1 visual intensity
}

export interface DeviceRuntime {
  def: DeviceDef;
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  state: 'idle' | 'hacked' | 'disabled' | 'cut';
}

export interface ContainerRuntime {
  def: LootContainerDef;
  mesh: THREE.Mesh;
  open: boolean;
  looted: boolean;
}

export interface LootRuntime {
  def: LootSpawnDef;
  mesh: THREE.Mesh;
  collected: boolean;
}

export interface LevelRuntime {
  level: LevelData;
  root: THREE.Group;
  physics: PhysicsWorld;
  nav: NavGrid;
  doors: Map<string, DoorRuntime>;
  doorList: DoorRuntime[];
  cameras: CameraRuntime[];
  devices: Map<string, DeviceRuntime>;
  containers: Map<string, ContainerRuntime>;
  loot: Map<string, LootRuntime>;
  hiding: HidingSpotDef[];
  spawns: Map<string, SpawnPointDef>;
  lightMeshes: THREE.Object3D[];
  dispose(): void;
}

const KIND_MATERIAL: Partial<Record<string, MaterialKey>> = { brick: 'brick' };

function matFor(key: string | undefined, color?: number): THREE.Material {
  const k = (KIND_MATERIAL[key ?? ''] ?? (key as MaterialKey)) || 'concrete';
  try {
    return getMaterial(k as MaterialKey, color);
  } catch {
    return getMaterial('concrete', color);
  }
}

export function buildLevel(level: LevelData, scene: THREE.Scene): LevelRuntime {
  const root = new THREE.Group();
  root.name = `level:${level.id}`;
  scene.add(root);
  const physics = new PhysicsWorld();
  const lightMeshes: THREE.Object3D[] = [];

  // ---- Boxes (visual + physics) ----
  for (const b of level.boxes) {
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    if (w <= 0 || h <= 0 || d <= 0) continue;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = matFor(b.material ?? (b.kind === 'floor' ? 'concrete' : 'wall'), b.color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    mesh.castShadow = b.kind !== 'floor' && b.kind !== 'glass';
    mesh.receiveShadow = true;
    root.add(mesh);

    const solid = b.kind !== 'ceiling' && !b.visualOnly;
    if (solid) {
      physics.add({ min: b.min, max: b.max }, {
        solid: true,
        step: b.kind === 'step',
        blocksSight: b.blocksSight ?? (b.kind !== 'glass'),
        blocksNav: b.blocksNav ?? (b.kind !== 'floor' && b.kind !== 'ceiling'),
        surface: b.surface ?? 'concrete',
      });
    }
  }

  // Outer kill-plane walls so nothing can leave the map.
  const bd = level.bounds;
  const outer: Array<[Vec3, Vec3]> = [
    [{ x: bd.x0 - 2, y: -2, z: bd.z0 - 2 }, { x: bd.x1 + 2, y: 30, z: bd.z0 }],
    [{ x: bd.x0 - 2, y: -2, z: bd.z1 }, { x: bd.x1 + 2, y: 30, z: bd.z1 + 2 }],
    [{ x: bd.x0 - 2, y: -2, z: bd.z0 }, { x: bd.x0, y: 30, z: bd.z1 }],
    [{ x: bd.x1, y: -2, z: bd.z0 }, { x: bd.x1 + 2, y: 30, z: bd.z1 }],
  ];
  for (const [min, max] of outer) physics.add({ min, max }, { solid: true, blocksNav: true, blocksSight: true, surface: 'concrete' });

  // ---- Doors ----
  const doors = new Map<string, DoorRuntime>();
  const doorList: DoorRuntime[] = [];
  const doorMat = getMaterial('wood', 0x6b5238);
  level.doors.forEach((d, i) => {
    const w = d.x1 - d.x0, dd = d.z1 - d.z0, h = d.y1 - d.y0;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), d.lock === 'breachable' || d.id === 'd_vault' ? matFor('vaultSteel') : doorMat);
    panel.position.set((d.x0 + d.x1) / 2, d.y0 + h / 2, (d.z0 + d.z1) / 2);
    panel.castShadow = true;
    root.add(panel);
    const rt = new DoorRuntime(d, panel, i);
    rt.open = !!d.startsOpen;
    rt.collider = physics.add({ min: { x: d.x0, y: d.y0, z: d.z0 }, max: { x: d.x1, y: d.y1, z: d.z1 } }, {
      solid: true, dynamicId: d.id, enabled: !rt.open, blocksSight: !rt.open, blocksNav: false, surface: 'metal',
    });
    doors.set(d.id, rt);
    doorList.push(rt);
  });

  // ---- Navigation grid (depends on boxes, rooms, doors) ----
  const nav = new NavGrid(level, 0.5, 0.36);
  doorList.forEach((rt) => nav.setDoorOpen(rt.navIndex, rt.open));

  // ---- Lights ----
  for (const l of level.lights) {
    const pl = new THREE.PointLight(l.color, l.intensity, l.radius, 1.6);
    pl.position.set(l.position.x, l.position.y, l.position.z);
    pl.castShadow = false;
    root.add(pl);
    lightMeshes.push(pl);
    // fixture visual
    const fx = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: l.color }));
    fx.position.set(l.position.x, l.position.y + 0.1, l.position.z);
    root.add(fx);
  }

  // ---- Cameras ----
  const cameras: CameraRuntime[] = level.cameras.map((c) => {
    const group = new THREE.Group();
    group.position.set(c.position.x, c.position.y, c.position.z);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.3), getMaterial('plastic'));
    group.add(housing);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    lens.position.set(0, -0.02, 0.18);
    group.add(lens);
    // visual cone pointing along +z (local), length = range
    const coneGeo = new THREE.ConeGeometry(Math.tan(c.fov / 2) * c.range, c.range, 18, 1, true);
    coneGeo.rotateX(Math.PI / 2);
    coneGeo.translate(0, 0, c.range / 2);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.set(0, -0.02, 0.1);
    group.add(cone);
    root.add(group);
    return { def: c, group, cone, lens, yaw: c.yaw, disabledUntil: 0, alertLevel: 0 };
  });

  // ---- Devices ----
  const devices = new Map<string, DeviceRuntime>();
  const deviceColor: Record<string, number> = {
    terminal: 0x3aa0d8, alarm_panel: 0xff4040, camera_hub: 0x40d0ff, vault_control: 0xffaa33, drill_point: 0xffd080,
    server: 0x40ff90, elevator_panel: 0xaaaaaa, power_box: 0xffee55, safe: 0x40ff90,
  };
  for (const d of level.devices) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.12), getMaterial('metalDark'));
    body.position.set(d.position.x, d.position.y, d.position.z);
    root.add(body);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.02), new THREE.MeshBasicMaterial({ color: deviceColor[d.kind] ?? 0x88ccff }));
    glow.position.set(d.position.x, d.position.y, d.position.z + 0.07);
    root.add(glow);
    devices.set(d.id, { def: d, mesh: body, glow, state: 'idle' });
  }

  // ---- Containers & loot ----
  const containers = new Map<string, ContainerRuntime>();
  for (const c of level.lootContainers) {
    const h = c.kind === 'strongbox' ? 1.0 : c.kind === 'till' ? 0.9 : 1.8;
    const w = c.kind === 'strongbox' ? 2.2 : c.kind === 'till' ? 0.8 : 0.9;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7), getMaterial(c.kind === 'till' ? 'metal' : 'vaultSteel'));
    mesh.position.set(c.position.x, h / 2, c.position.z);
    mesh.castShadow = true;
    root.add(mesh);
    containers.set(c.id, { def: c, mesh, open: c.lock === 'none', looted: false });
  }
  const loot = new Map<string, LootRuntime>();
  const lootColor: Record<string, number> = { cash: 0x49b86b, valuables: 0xd8b4ff, gold: 0xf0c040, objective: 0xf7d060, ammo: 0x999999, evidence: 0xffffff, intel: 0x66ccff };
  for (const l of level.lootSpawns) {
    const isGold = l.kind === 'objective';
    const mesh = new THREE.Mesh(
      isGold ? new THREE.BoxGeometry(0.34, 0.12, 0.16) : new THREE.BoxGeometry(0.28, 0.12, 0.2),
      new THREE.MeshStandardMaterial({ color: lootColor[l.kind] ?? 0xffffff, emissive: lootColor[l.kind] ?? 0xffffff, emissiveIntensity: 0.25, metalness: isGold ? 0.9 : 0.1, roughness: 0.35 }),
    );
    mesh.position.set(l.position.x, l.position.y, l.position.z);
    mesh.visible = !l.insideContainer;   // revealed when container is opened
    root.add(mesh);
    loot.set(l.id, { def: l, mesh, collected: false });
  }

  // ---- Hiding spots ----
  const hiding = level.hidingSpots;
  for (const h of hiding) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(h.kind === 'closet' ? 0.9 : 0.8, 1.9, 0.7), getMaterial('metalDark'));
    m.position.set(h.position.x, 0.95, h.position.z);
    m.visible = true;
    root.add(m);
  }

  // ---- Props ----
  for (const p of level.props) root.add(buildProp(p));

  // ---- Spawn map ----
  const spawns = new Map<string, SpawnPointDef>();
  for (const s of level.spawnPoints) spawns.set(s.id, s);

  const rt: LevelRuntime = {
    level, root, physics, nav, doors, doorList, cameras, devices, containers, loot, hiding, spawns, lightMeshes,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      scene.remove(root);
      physics.clear();
    },
  };
  return rt;
}

function buildProp(p: PropDef): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(p.position.x, p.position.y, p.position.z);
  if (p.rotation) g.rotation.y = p.rotation;
  switch (p.kind) {
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.8, 10), getMaterial('plastic', 0x6a4a34));
      pot.position.y = 0.4;
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), getMaterial('hedge'));
      leaves.position.y = 1.5;
      g.add(pot, leaves);
      break;
    }
    case 'atm': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.7), getMaterial('metal', 0x2a5a8a));
      m.position.y = 0.8;
      g.add(m);
      break;
    }
    case 'lamp_post': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.5, 8), getMaterial('metalDark'));
      pole.position.y = 2.25;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
      head.position.set(0.3, 4.5, 0);
      g.add(pole, head);
      break;
    }
    case 'vault_door_frame': {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.8, 2.6), getMaterial('metalDark'));
      f.position.y = 1.4;
      g.add(f);
      break;
    }
    default:
      break;
  }
  return g;
}

/** Helper for the open/close animation & nav state of a door. */
export function setDoorState(rt: LevelRuntime, doorId: string, open: boolean): void {
  const d = rt.doors.get(doorId);
  if (!d) return;
  d.open = open;
  if (d.collider) {
    d.collider.enabled = !open;
    d.collider.blocksSight = !open;   // a closed door blocks sight as well as movement
  }
  rt.nav.setDoorOpen(d.navIndex, open);
}

/** Smoothly animates door panels (slide open/closed). */
export function updateDoors(rt: LevelRuntime, dt: number): void {
  for (const d of rt.doorList) {
    const target = d.open ? 1 : 0;
    if (d.t === target) continue;
    d.t += Math.sign(target - d.t) * Math.min(Math.abs(target - d.t), 2.6 * dt);
    const off = d.t * d.panelWidth * 0.95;
    const cx = (d.def.x0 + d.def.x1) / 2, cz = (d.def.z0 + d.def.z1) / 2;
    if (d.slideAxis === 'x') d.panel.position.x = cx + off;
    else d.panel.position.z = cz + off;
    d.panel.visible = d.t < 0.98;
  }
}

export function nearestDoor(rt: LevelRuntime, p: Vec3, radius: number): DoorRuntime | null {
  let best: DoorRuntime | null = null;
  let bestD = radius * radius;
  for (const d of rt.doorList) {
    const cx = (d.def.x0 + d.def.x1) / 2, cz = (d.def.z0 + d.def.z1) / 2;
    const dd = (cx - p.x) ** 2 + (cz - p.z) ** 2;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}
