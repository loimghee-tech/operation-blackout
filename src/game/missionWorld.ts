/**
 * MissionWorld: runs one mission from deployment to extraction/failure.
 * It wires together the level, player, weapons, NPC AI, alarm, cameras, devices,
 * loot, crew, gadgets, class abilities and the mission objectives.
 *
 * Gameplay rules are data + small handlers; mission-specific rules come from a
 * MissionDefinition (see missions/bank.ts) through its onEvent() hook.
 */
import * as THREE from 'three';
import type { Vec3, AlertState, Difficulty } from '../core/types';
import { BANK_LEVEL } from '../missions/bankLevel';
import { buildLevel, updateDoors, setDoorState, type LevelRuntime, type DoorRuntime, type ContainerRuntime, type DeviceRuntime, type CameraRuntime } from '../world/builder';
import type { LevelData, SpawnPointDef, DeviceDef, LootSpawnDef, LootContainerDef } from '../world/level';
import { Input } from '../core/input';
import { EventBus } from '../core/events';
import type { GameEvents } from '../core/gameEvents';
import { Rng } from '../core/rng';
import { PlayerController } from '../player/controller';
import { WeaponSystem, buildViewmodel, falloffMult, type FireShot } from '../weapons/weaponSystem';
import { EffectsPool } from '../effects/effects';
import { NpcManager, type HitZone, type NpcManagerEvents } from '../ai/npcManager';
import { Npc, type NpcSpec } from '../ai/npc';
import type { PlayerSnapshot } from '../ai/npcBrain';
import { AlarmSystem } from '../ai/alarm';
import { playerVisibility } from '../ai/perception';
import { InteractionSystem, type Interactable } from '../interaction/interactions';
import { startHack, cancelHack, type HackKind } from '../hacking/minigames';
import { CharacterLibrary, createHuman } from '../characters/human';
import { CLASSES, type ClassDef } from '../config/classes';
import { DIFFICULTIES, BALANCE, type DifficultyConfig, MODIFIER_POOL, type MissionModifier } from '../config/balance';
import { GADGETS, ARMORS, DISGUISES, type GadgetId, type DisguiseId } from '../config/gadgets';
import { WEAPONS, ATTACHMENTS } from '../config/weapons';
import { CREW_BY_ID, type CrewDef } from '../config/crew';
import { computePlayerStats, aggregateSkills, type PlayerStatBlock, type MissionOutcome } from '../progression/economy';
import { MissionRuntime, type ObjectiveDef } from '../missions/runtime';
import type { Loadout, PlanChoices } from '../progression/campaign';
import { AMMO_TYPES } from '../progression/campaign';
import type { Settings } from '../progression/settings';
import { distXZ, dist, clamp } from '../core/math';
import type { AudioManager } from '../audio/audio';
import type { HudApi } from '../ui/hud';
import type { CrewMode, CrewState } from '../ai/npc';

export type MissionEvent =
  | { type: 'room'; roomId: string; tags: string[] }
  | { type: 'door'; id: string; open: boolean; locked: boolean }
  | { type: 'loot'; id: string; kind: string; value: number; optional: boolean; label: string }
  | { type: 'device'; id: string; kind: string; result: 'hacked' | 'failed' | 'cut' | 'drilled' | 'breached' | 'override' }
  | { type: 'alarm'; level: number; label: string }
  | { type: 'npcDown'; id: string; lethal: boolean; faction: string }
  | { type: 'civilianHarmed'; id: string }
  | { type: 'extracted' }
  | { type: 'tick'; dt: number };

export interface MissionApi {
  rt: MissionRuntime;
  world: MissionWorld;
}

export interface MissionDefinition {
  id: string;
  name: string;
  subtitle: string;
  level: LevelData;
  briefing: string[];
  objectives: ObjectiveDef[];
  parTime: number;
  primaryLootValue: number;
  npcSpecs(ctx: { plan: PlanChoices; modifiers: MissionModifier[]; diff: DifficultyConfig; rng: Rng; civilianCount: number }): NpcSpec[];
  /** Called once after the world is built. */
  setup(api: MissionApi): void;
  /** Mission-specific reactions to gameplay events. */
  onEvent(ev: MissionEvent, api: MissionApi): void;
  /** Escape plans this mission supports. */
  escapeIds: string[];
  /** Entry plan ids this mission supports. */
  entryIds: string[];
  /** Which door id is the vault door. */
  vaultDoorId: string;
  /** Which door is the front door (never auto-closes). */
  frontDoorId: string;
  /** Which door ids get locked in lockdown (except front door). */
  alarmLockedDoors(level: LevelData): string[];
}

export interface WorldDeps {
  scene: THREE.Scene;
  settings: Settings;
  input: Input;
  audio: AudioManager;
  lib: CharacterLibrary;
  hud: HudApi;
  hackHost: HTMLElement;
  bus: EventBus<GameEvents>;
  def: MissionDefinition;
  plan: PlanChoices;
  loadout: Loadout;
  classId: keyof typeof CLASSES;
  skillIds: string[];
  crewIds: string[];
  crewTiers: Record<string, number>;
  ownedGadgetCounts: Partial<Record<GadgetId, number>>;
  ownedDisguises: DisguiseId[];
  intelIds: string[];
  rng: Rng;
  canvasSize: { width: number; height: number };
  onEnd(result: MissionEndResult): void;
  /** Used to pick a random mission modifier set (already sampled by the caller for determinism). */
  modifiers: MissionModifier[];
}

export interface MissionEndResult {
  def: MissionDefinition;
  success: boolean;
  outcome: MissionOutcome;
  reason: string;
  stats: MissionRuntime['stats'];
  objectivesDone: string[];
  classId: keyof typeof CLASSES;
  difficulty: Difficulty;
  approach: string;
}

interface Channel {
  kind: 'gadget' | 'door' | 'device' | 'container' | 'revive' | 'disguise' | 'cut';
  label: string;
  t: number;
  need: number;
  onDone: () => void;
  onCancel?: () => void;
  noiseEvery?: number;
  noiseT?: number;
  noiseKind?: 'drill' | 'impact';
}

export class MissionWorld {
  readonly level: LevelRuntime;
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly effects: EffectsPool;
  readonly npcs: NpcManager;
  readonly alarm: AlarmSystem;
  readonly interact = new InteractionSystem();
  readonly rt: MissionRuntime;
  readonly diff: DifficultyConfig;
  readonly stats: PlayerStatBlock;
  readonly classDef: ClassDef;
  readonly crew: Npc[] = [];
  readonly rng: Rng;
  time = 0;
  paused = false;
  ended = false;
  /** Pending world events for the mission definition. */
  private approach = 'auto';
  private uiBlocked = false;
  private viewmodel: THREE.Group;
  private vmKick = 0;
  private gadgetSel: 0 | 1 = 0;
  private gadgetUses = new Map<string, number>();
  private gadgetReady = 0;
  private channel: Channel | null = null;
  private abilityCd = 0;
  private abilityLeft = 0;
  private abilityActive = false;
  private pendingThrows: Array<{ id: GadgetId; t: number; pos: Vec3 }> = [];
  private traps: Array<{ pos: Vec3; armed: boolean; kind: string; blockId: string | null }> = [];
  private barricades: Array<{ x: number; z: number; t: number; id: string }> = [];
  private cameraDisabledUntil = 0;
  private empUntil = 0;
  private pulse = 0;
  private lockdownDone = false;
  private perimeterFailed = false;
  private extraction: { state: 'idle' | 'calling' | 'inbound' | 'done'; t: number; need: number; zone: SpawnPointDef | null; callT: number } = { state: 'idle', t: 0, need: 15, zone: null, callT: 0 };
  private escapeSpawn: SpawnPointDef | null = null;
  private loadedGold = 0;
  private carry = 0;
  private hackRetries = 0;
  private lootTotal = 0;
  private optionalLoot = 0;
  private primaryLoot = 0;
  private killCount = 0;
  private npcById = new Map<string, Npc>();
  private playerSpeedBase = 1;
  private hideSpot: { id: string; pos: Vec3 } | null = null;
  private lastRoomId = '';
  private startT = 0;
  private hitMarkerT = 0;
  private flashT = 0;
  private suppressionTimer = 0;
  private exitIntent = false;
  private dead = false;
  private interactCount = 0;
  private npcLoaded = false;
  private revivesLeft = 0;
  private hiddenOverlay = false;
  private readonly bus: EventBus<GameEvents>;
  private readonly deps: WorldDeps;
  private crewPanel = false;
  private aiUpdates = 0;
  private frameTimes: number[] = [];
  private cameraMarks: THREE.Object3D[] = [];
  private doorMeshes = new Map<string, THREE.Object3D>();

  constructor(deps: WorldDeps) {
    this.deps = deps;
    this.bus = deps.bus;
    this.rng = deps.rng;
    this.rt = new MissionRuntime(deps.def.objectives);
    this.classDef = CLASSES[deps.classId];
    this.disguiseId = deps.loadout.disguise;
    this.approach = deps.plan.approach === 'auto' ? 'auto' : deps.plan.approach;
    this.diff = { ...DIFFICULTIES[deps.plan.difficulty] };
    if (this.approach === 'quiet') this.diff.suspicionRateMult *= 0.9;
    if (this.approach === 'loud') { this.diff.responseFirstDelay *= 0.7; this.diff.responseInterval *= 0.85; }
    // modifiers
    for (const m of deps.modifiers) {
      const e = m.effects;
      if (e.responseDelayMult) this.diff.responseFirstDelay *= e.responseDelayMult;
      if (e.guardSkillAdd) this.diff.enemyAccuracyMult *= 1.08;
    }
    const aggr = aggregateSkills(deps.skillIds);
    this.stats = computePlayerStats({
      classId: deps.classId, skillIds: deps.skillIds, armorBase: ARMORS[deps.loadout.armor].armor,
      difficulty: deps.plan.difficulty,
      loadoutMoveMult: ARMORS[deps.loadout.armor].moveSpeedMult,
      loadoutNoiseMult: ARMORS[deps.loadout.armor].noiseMult,
    });
    void aggr;
    this.playerSpeedBase = this.stats.moveSpeedMult;

    // ---- level & physics -------------------------------------------------
    this.level = buildLevel(deps.def.level, deps.scene);
    const sp = this.spawnPointFor(deps.plan);
    const aspect = deps.canvasSize.width / Math.max(1, deps.canvasSize.height);
    this.player = new PlayerController(this.level.physics, sp.position, {
      maxHealth: this.stats.maxHealth, maxArmor: this.stats.maxArmor, moveSpeedMult: this.stats.moveSpeedMult,
      noiseMult: this.stats.noiseMult, damageTakenMult: this.stats.damageTakenMult, staminaMult: this.stats.staminaMult,
      bleedoutSeconds: this.stats.bleedoutSeconds,
    }, this.diff, aspect, deps.settings.fov);
    this.player.yaw = (sp.facing ?? 0) + 0;
    this.player.onNoise = (pos, radius, loud, kind) => this.emitNoise({ pos: { ...pos }, radius, loudness: loud, kind: kind === 'impact' ? 'impact' : 'footstep' });
    deps.scene.add(this.player.camera);
    this.player.camera.add(new THREE.Object3D());
    this.revivesLeft = 1 + (this.stats.unlocks.has('fast_revive') ? 1 : 0);

    // ---- weapons ---------------------------------------------------------
    this.weapons = new WeaponSystem(this.rng);
    this.weapons.onFire = (s) => this.onPlayerShot(s);
    this.equipWeapons();
    this.viewmodel = new THREE.Group();
    this.player.camera.add(this.viewmodel);
    this.refreshViewmodel();
    this.effects = new EffectsPool(deps.scene, deps.settings.effects);

    // ---- alarm -----------------------------------------------------------
    this.alarm = new AlarmSystem(this.diff, {
      onChange: (level, label, reason) => this.onAlarmChanged(level, label, reason),
      onLockdown: () => this.lockdown(),
      onSpawnResponse: (n) => this.spawnResponse(n),
      onPerimeterSealed: () => this.onPerimeterSealed(),
      onSiren: (on) => deps.audio.alarm(on),
    });

    // ---- npcs ------------------------------------------------------------
    this.npcs = new NpcManager(deps.scene, this.level, deps.lib, this.diff, this.rng);
    const npcEvents: Partial<NpcManagerEvents> = {
      onStateChanged: (n, from, to) => this.onNpcState(n, from, to),
      onBark: (n, line, kind) => this.onBark(n, line, kind),
      onDown: (n, lethal, byPlayer) => this.onNpcDown(n, lethal, byPlayer),
      onNpcHit: (n, zone, dmg, killed) => { this.hitMarkerT = 0.18; this.hudHit(killed, n); void zone; void dmg; },
      onPlayerHit: (dmg, from, zone) => this.onPlayerHitBy(dmg, from, zone),
      onCivilianHarmed: (n) => this.onCivilianHarmed(n),
      onRadio: (from, level) => this.onRadio(from, level),
      onWitness: (n, what) => { if (what === 'body') this.alarm.raise(1, 'Body found'); },
      onGunfire: (n, pos) => { void n; this.effects.muzzleFlash(pos, { x: 0, y: 0, z: 1 }, false); },
    };
    Object.assign(this.npcs.events, npcEvents);
    this.npcs.alarmDevices = this.level.level.devices.filter((d) => d.kind === 'alarm_panel').map((d) => d.position);
    this.npcs.hidingSpots = this.level.hiding.map((h) => ({ id: h.id, pos: h.position, capacity: h.capacity, used: 0 }));

    // NPC spawns from definition
    const specs = deps.def.npcSpecs({ plan: deps.plan, modifiers: deps.modifiers, diff: this.diff, rng: this.rng, civilianCount: 6 });
    for (const s of specs) {
      const n = this.npcs.spawn(s);
      this.npcById.set(n.id, n);
    }
    this.npcLoaded = true;

    // ---- cameras, devices, containers, loot --------------------------------
    this.buildCameraVisuals();
    this.registerInteractables();
    this.spawnCrew();

    // ---- class-specific starting bonuses --------------------------------
    this.applyPlanChoices();
    this.interact.speedMult = this.stats.interactSpeedMult > 0 ? 1 / this.stats.interactSpeedMult : 1;
    this.interact.onCancel = () => { /* hold cancelled */ };

    // mission definition setup
    deps.def.setup({ rt: this.rt, world: this });
    this.rt.setPhase('deployment');
    this.rt.onObjective = (o, kind) => {
      if (kind === 'added') deps.hud.toast(`Objective: ${o.text}`, 'objective');
      if (kind === 'done') deps.hud.toast(`Complete: ${o.text}`, 'success');
      if (kind === 'failed') deps.hud.toast(`Failed: ${o.text}`, 'warn');
    };
    this.bus.emit('mission:phase', { phase: 'deployment' });
    this.gadgetCountsInit();
  }

  // -------------------------------------------------------------------------
  // Setup helpers
  // -------------------------------------------------------------------------
  private spawnPointFor(plan: PlanChoices): SpawnPointDef {
    const pts = this.level.spawns;
    const start = plan.startLocation === 'alley' ? pts.get('spawn_alley') : pts.get('spawn_street');
    const entry = pts.get(`spawn_${plan.entry === 'front' ? 'front' : plan.entry === 'staff' ? 'staff' : 'service'}`);
    // Start location decides where you begin; if you plan an entry, you deploy at the entry spawn.
    return (plan.entry === 'front' ? start : entry) ?? start ?? [...pts.values()][0];
  }

  private equipWeapons(): void {
    const l = this.deps.loadout;
    const ammoMult = this.diff.startingReserveMult * (AMMO_TYPES[l.ammo].damageMult ? 1 : 1);
    this.weapons.equip(0, l.primary, l.attachments[l.primary] ?? [], ammoMult);
    this.weapons.equip(1, l.secondary, l.attachments[l.secondary] ?? [], ammoMult);
    this.weapons.equip(2, l.melee, [], 1);
    this.weapons.active = 0;
    this.deps.hud.setWeaponSlots(this.weapons.slots.map((s) => (s ? s.def.name : '—')));
  }

  private gadgetCountsInit(): void {
    const l = this.deps.loadout;
    const add = (id: GadgetId | null) => { if (!id) return; const def = GADGETS[id]; const extra = this.stats.extraGadgetUses; this.gadgetUses.set(id, (this.deps.ownedGadgetCounts[id] ?? def.uses) > 0 ? def.uses + extra : 0); };
    add(l.gadgets[0]); add(l.gadgets[1]); add(l.throwable);
    if (l.gadgets[0] && this.gadgetUses.get(l.gadgets[0]) === 0) this.gadgetUses.set(l.gadgets[0], GADGETS[l.gadgets[0]].uses);
  }

  private applyPlanChoices(): void {
    const plan = this.deps.plan;
    // Escape route: a service route must be unlocked (engineer / skill), otherwise fall back.
    let escape = plan.escape;
    if (escape === 'service_tunnel' && !(this.classDef.id === 'engineer' || this.stats.unlocks.has('service_routes'))) {
      this.deps.hud.toast('Service tunnel needs an Engineer or the Service Knowledge skill — using van extraction.', 'warn');
      escape = 'van_street';
    }
    const escapeMap: Record<string, string> = { van_street: 'ext_van_street', alley_car: 'ext_alley_car', service_tunnel: 'ext_service_tunnel' };
    this.escapeSpawn = this.level.spawns.get(escapeMap[escape]) ?? null;
    this.extraction.zone = this.escapeSpawn;
    // Intel reveals
    for (const id of this.deps.intelIds) {
      if (id === 'floor_plan') this.rt.reveal('opt_cams');
      if (id === 'guard_rota') this.rt.reveal('opt_alarm');
      if (id === 'insider') this.rt.reveal('opt_manager');
    }
    // Optional loot toggle: removing optional loot entries
    if (!plan.optionalLoot) {
      for (const [id, l] of this.level.loot) {
        if (l.def.optional) { l.mesh.visible = false; this.level.loot.delete(id); }
      }
      this.deps.hud.toast('Optional loot skipped by plan.', 'info');
    }
    // Social approach: disguise is needed to walk the staff areas
    if (this.deps.plan.approach === 'social' && plan.disguise === 'none') this.deps.hud.toast('No disguise worn: staff-only doors need a keycard or hack.', 'warn');
    // Apply disguise
    this.player.visibilityMult = this.stats.visibilityMult;
    this.player.noiseMult = 1;
    if (this.classDef.id === 'ghost') this.player.noiseMult = 0.92;
    // Spawn crew at deploy point
    this.escapeSpawn && void 0;
  }

  private disguiseId: DisguiseId;
  get disguise() { return DISGUISES[this.disguiseId]; }
  get accessTiers(): Set<string> {
    const set = new Set<string>(['public', ...(this.disguise.access ?? [])]);
    for (const t of this.extraAccess) set.add(t);
    return set;
  }
  private extraAccess: string[] = [];

  private buildCameraVisuals(): void {
    // cameras already built by builder; keep references for the sweep
    this.cameraMarks = [];
  }

  private registerInteractables(): void {
    const L = this.level;
    // Doors
    for (const d of L.doorList) {
      const id = `door:${d.def.id}`;
      const interactable: Interactable = {
        id, kind: 'door', label: d.def.label, pos: { x: (d.def.x0 + d.def.x1) / 2, y: 1, z: (d.def.z0 + d.def.z1) / 2 },
        range: 2.2, priority: 3,
        check: () => {
          const c = this.checkDoor(d);
          const verb = c.method === 'hack' ? 'Hack' : c.method === 'lockpick' ? 'Pick' : c.method === 'breach' ? 'Breach' : d.open ? 'Close' : 'Open';
          interactable.label = `${verb} ${d.def.label}`;
          return { ok: c.ok, reason: c.reason };
        },
        use: () => this.useDoor(d),
      };
      this.interact.add(interactable);
    }
    // Devices
    for (const dev of L.devices.values()) this.registerDevice(dev);
    // Containers
    for (const c of L.containers.values()) this.registerContainer(c);
    // Hiding spots
    for (const h of this.level.hiding) {
      this.interact.add({
        id: `hide:${h.id}`, kind: 'hide', label: `Hide in ${h.label}`, pos: { ...h.position, y: 1 }, priority: 1,
        check: () => (this.hideSpot ? { ok: false, reason: 'Already hiding' } : this.npcs.npcs.length > 0 ? { ok: true } : { ok: true }),
        use: () => this.enterHiding(h.id, h.position),
      });
    }
    this.interact.add({
      id: 'hide:exit', kind: 'hide', label: 'Leave hiding spot', pos: { x: 0, y: 1, z: 0 }, priority: 9, range: 99,
      check: () => (this.hideSpot ? { ok: true } : { ok: false }), use: () => this.exitHiding(),
    });
    // Extraction call
    this.interact.add({
      id: 'extract', kind: 'extract', label: 'Call in extraction', pos: { x: 0, y: 1, z: 0 }, holdTime: 6, priority: 6, range: 99, progressLabel: 'Calling extraction',
      check: () => this.checkExtraction(), use: () => this.startExtraction(),
    });
    // Loot pickups (instant)
    for (const l of L.loot.values()) this.registerLoot(l.def);
    // Crew/NPC interactions are attached per NPC on spawn (see spawnCrew / onNpcSpawned)
    for (const n of this.npcs.npcs) this.attachNpcInteractable(n);
  }

  private attachNpcInteractable(n: Npc): void {
    const id = `npc:${n.id}`;
    this.interact.add({
      id, kind: 'npc', label: '', pos: n.pos, range: 2.4, priority: 5,
      check: () => this.checkNpcInteract(n),
      use: () => this.useNpcInteract(n),
      holdTime: 0,
    });
    // Label + hold time are resolved dynamically in checkNpcInteract
  }

  private checkNpcInteract(n: Npc): { ok: boolean; reason?: string } {
    const it = this.interact.get(`npc:${n.id}`);
    if (!it) return { ok: false };
    if (n.alive && n.kind === 'manager') {
      if (n.state === 'combat' || n.state === 'alerted') return { ok: false, reason: 'Too alert to talk' };
      if (n.suspicion > 45) return { ok: false, reason: 'He is suspicious' };
      if (!(this.accessTiers.has('security') || this.accessTiers.has('staff') || this.classDef.id === 'conartist')) return { ok: false, reason: 'Needs a convincing disguise' };
      it.label = 'Ask for the vault override';
      it.holdTime = 2.0;
      return { ok: true };
    }
    if (n.alive && n.kind === 'guard' && this.gadgetCount('keycard_cloner') > 0 && n.state === 'unaware' && !n.downed) {
      it.label = 'Clone keycard (hold)';
      it.holdTime = 2.5;
      return { ok: true };
    }
    if (n.alive && n.kind === 'civilian' && this.classDef.id === 'conartist' && (n.state === 'suspicious' || n.state === 'alerted' || n.state === 'combat') && !n.downed) {
      it.label = 'Talk them down';
      it.holdTime = 1.5;
      return { ok: true };
    }
    if (n.crew === null && n.alive && n.downed && n.kind === 'crew') {
      it.label = `Revive ${n.label}`;
      it.holdTime = 2.8;
      return { ok: true };
    }
    if (n.crew && n.downed && n.alive) {
      it.label = `Revive ${n.label}`;
      it.holdTime = 2.8;
      return { ok: this.revivesLeft >= 0, reason: this.revivesLeft < 0 ? 'No revives left' : undefined };
    }
    return { ok: false };
  }

  private useNpcInteract(n: Npc): void {
    if (n.kind === 'manager' && n.alive) {
      const chance = (this.classDef.id === 'conartist' ? 0.85 : 0.5) + (this.approach === 'social' ? 0.2 : 0);
      this.deps.hud.subtitle(n.label, '…Strictly against procedure. But I suppose a manager can authorise one override.');
      if (this.rng.next() < chance) {
        this.level.doors.get(this.deps.def.vaultDoorId)!.locked = false;
        this.level.nav.setDoorLocked(this.level.doors.get(this.deps.def.vaultDoorId)!.navIndex, false);
        this.deps.hud.toast('Override accepted. The vault door is unlocked.', 'success');
        this.rt.complete('opt_manager');
        this.onEvent({ type: 'device', id: 'manager', kind: 'manager', result: 'override' });
      } else {
        n.suspicion = 70;
        n.setState('suspicious');
        this.deps.hud.subtitle(n.label, 'Hang on... who really are you? Security!');
        this.alarm.raise(1, 'Manager flagged you');
      }
      return;
    }
    if (n.kind === 'guard' && this.gadgetCount('keycard_cloner') > 0) {
      this.useGadget('keycard_cloner');
      this.extraAccess.push('staff', 'security');
      this.deps.hud.toast('Keycard cloned: staff and security tiers unlocked.', 'success');
      this.deps.audio.sfx('hack');
      return;
    }
    if (n.kind === 'civilian') {
      n.suspicion = 0;
      n.lastSeen = null;
      n.setState('unaware');
      n.reportT = -1;
      this.deps.hud.subtitle(n.label, 'Oh! Sorry, sorry — I\'m fine, really.');
      return;
    }
    if (n.crew && n.downed) {
      this.revivesLeft--;
      n.downed = false;
      n.hp = Math.max(n.hp, n.maxHp * 0.35);
      this.bus.emit('crew:status', { id: n.id, status: 'revived', health: n.hp });
      this.deps.hud.toast(`${n.label} is back up.`, 'success');
    }
  }

  /** Device outcomes keyed by device id (also used when a hacker crew member completes an assist). */
  private deviceSuccess = new Map<string, () => void>();

  private registerDevice(dev: DeviceRuntime): void {
    const d = dev.def;
    const base = (extra: Partial<Interactable>): Interactable => ({
      id: `dev:${d.id}${extra.id ?? ''}`, kind: 'device', label: d.label, pos: { ...d.position }, range: 2.3, priority: 4,
      check: () => ({ ok: true }), use: () => {}, ...extra,
    } as Interactable);
    this.deviceSuccess.set(d.id, () => {
      if (d.kind === 'terminal') this.onTerminalHacked(dev);
      else if (d.kind === 'alarm_panel') this.cutAlarm(dev, 'hacked');
      else if (d.kind === 'camera_hub') this.blackoutCameras(dev);
      else if (d.kind === 'vault_control') this.openVaultByDevice(dev);
    });
    if (d.kind === 'terminal') {
      this.interact.add(base({
        check: () => (dev.state === 'hacked' ? { ok: false, reason: 'Already accessed' } : { ok: true }),
        label: 'Access reception terminal',
        use: () => this.hack(dev, 'sequence', () => this.onTerminalHacked(dev)),
      }));
    } else if (d.kind === 'alarm_panel') {
      this.interact.add(base({
        id: ':hack', label: 'Hack alarm control panel',
        check: () => (dev.state === 'cut' ? { ok: false, reason: 'Panel already cut' } : { ok: true }),
        use: () => this.hack(dev, 'timing', () => this.cutAlarm(dev, 'hacked')),
      }));
      this.interact.add(base({
        id: ':cut', label: 'Cut alarm wiring (hold)', holdTime: 8.5, priority: 3,
        check: () => (dev.state === 'cut' ? { ok: false, reason: 'Already cut' } : { ok: true }),
        use: () => this.startChannel({ kind: 'cut', label: 'Cutting wiring', need: 8.5 * (this.classDef.id === 'engineer' ? 0.6 : 1), noiseEvery: 1.5, noiseKind: 'impact', onDone: () => this.cutAlarm(dev, 'cut') }),
      }));
    } else if (d.kind === 'camera_hub') {
      this.interact.add(base({
        label: 'Access camera hub',
        check: () => (this.cameraDisabledUntil > this.time ? { ok: false, reason: 'Cameras already offline' } : { ok: true }),
        use: () => this.hack(dev, 'pattern', () => this.blackoutCameras(dev)),
      }));
    } else if (d.kind === 'vault_control') {
      this.interact.add(base({
        label: 'Access vault control relay',
        check: () => (this.level.doors.get(this.deps.def.vaultDoorId)?.open ? { ok: false, reason: 'Vault already open' } : { ok: true }),
        use: () => this.hack(dev, 'circuit', () => this.openVaultByDevice(dev)),
      }));
    } else if (d.kind === 'drill_point') {
      this.interact.add(base({
        label: 'Drill vault wall', holdTime: 22, priority: 3,
        check: () => (this.level.doors.get(this.deps.def.vaultDoorId)?.open ? { ok: false, reason: 'Already through' } : this.hasGadget('repair_kit') || true ? { ok: true } : { ok: false }),
        use: () => this.startChannel({
          kind: 'device', label: 'Drilling vault wall', need: 22 * (this.classDef.id === 'engineer' ? 0.6 : 1) * (this.gadgetCount('repair_kit') > 0 ? 0.75 : 1) * (this.deps.def.level.id ? 1 : 1),
          noiseEvery: 2.2, noiseKind: 'drill', onDone: () => this.openVaultByDevice(dev, 'drilled'),
        }),
      }));
    }
  }

  private registerContainer(c: ContainerRuntime): void {
    const d = c.def;
    const lockedText = d.lock === 'lockpick' ? 'Pick lock' : d.lock === 'electronic' ? 'Hack lock' : 'Search';
    this.interact.add({
      id: `cont:${d.id}`, kind: 'loot', label: `${lockedText} ${d.label}`, pos: { x: d.position.x, y: 1, z: d.position.z }, range: 2.2, priority: 2,
      check: () => {
        if (c.looted) return { ok: false, reason: 'Empty' };
        if (c.open) return { ok: true };
        if (d.lock === 'lockpick') return this.gadgetCount('lockpick') > 0 || this.classDef.id === 'ghost' || this.classDef.id === 'engineer' ? { ok: true } : { ok: false, reason: 'Needs a lockpick' };
        if (d.lock === 'electronic') return { ok: true };
        return { ok: true };
      },
      use: () => {
        if (c.open) { this.openContainer(c); return; }
        if (d.lock === 'lockpick') {
          const time = (d.openTime || 3) * this.interactTime();
          if (this.classDef.id !== 'ghost' && this.classDef.id !== 'engineer') this.useGadget('lockpick');
          this.startChannel({ kind: 'container', label: `Picking ${d.label}`, need: time, onDone: () => { c.open = true; this.openContainer(c); } });
        } else if (d.lock === 'electronic') {
          this.hack({ def: { id: d.id, hackLevel: d.hackLevel ?? 2 } as DeviceDef, state: 'idle', mesh: c.mesh, glow: c.mesh, } as unknown as DeviceRuntime, 'sequence', () => { c.open = true; this.openContainer(c); });
        } else {
          this.startChannel({ kind: 'container', label: `Searching ${d.label}`, need: Math.max(0.6, d.openTime * this.interactTime()), onDone: () => { c.open = true; this.openContainer(c); } });
        }
      },
    });
  }

  private registerLoot(l: LootSpawnDef): void {
    const lootRt = this.level.loot.get(l.id);
    if (!lootRt) return;
    const id = `loot:${l.id}`;
    this.interact.add({
      id, kind: 'loot', label: `Take ${l.label}`, pos: { x: l.position.x, y: 1, z: l.position.z }, range: 2, priority: 2,
      check: () => {
        const cur = this.level.loot.get(l.id);
        if (!cur || cur.collected) return { ok: false, reason: 'Taken' };
        if (!cur.mesh.visible) return { ok: false, reason: 'Not visible' };
        return { ok: true };
      },
      use: () => this.collectLoot(l),
    });
  }

  private collectLoot(l: LootSpawnDef): void {
    const cur = this.level.loot.get(l.id);
    if (!cur || cur.collected) return;
    cur.collected = true;
    cur.mesh.visible = false;
    const value = Math.round(l.value * this.lootMult());
    this.lootTotal += value;
    if (l.optional) this.optionalLoot += value; else this.primaryLoot += value;
    this.carry += l.weight ?? 1;
    this.deps.audio.sfx('loot');
    this.deps.hud.toast(`+$${value.toLocaleString()} — ${l.label}`, 'success');
    this.effects.burst({ x: l.position.x, y: l.position.y + 0.2, z: l.position.z }, 0xf7d060, 10, 1.4, 0.5);
    this.bus.emit('loot:collected', { id: l.id, label: l.label, value, optional: l.optional });
    this.onEvent({ type: 'loot', id: l.id, kind: l.kind, value, optional: l.optional, label: l.label });
    this.updateCarryPenalty();
  }

  private updateCarryPenalty(): void {
    const cap = this.hasModifier('doubleBagLimit') ? 12 : 6;
    const over = Math.max(0, this.carry - cap);
    this.player.stats.moveSpeedMult = Math.max(0.7, this.stats.moveSpeedMult * (1 - 0.03 * over));
  }

  private hasModifier(key: keyof MissionModifier['effects']): boolean {
    return this.deps.modifiers.some((m) => !!m.effects[key]);
  }

  private lootMult(): number {
    let m = this.diff.lootValueMult * this.stats.lootValueMult;
    if (this.approach === 'loud') m *= 1.1;
    for (const mod of this.deps.modifiers) if (mod.effects.lootValueMult) m *= mod.effects.lootValueMult;
    return m;
  }

  private openContainer(c: ContainerRuntime): void {
    c.open = true;
    c.looted = true;
    c.mesh.material = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7 });
    this.deps.audio.sfx('container');
    const spawns = c.def.contains ?? [];
    for (const lid of spawns) {
      const l = this.level.loot.get(lid);
      if (l) { l.mesh.visible = true; this.registerLoot(l.def); }
    }
    // Vault strongbox: gold is visible & takeable
    this.onEvent({ type: 'device', id: c.def.id, kind: 'container', result: 'hacked' });
  }

  private interactTime(): number {
    return this.stats.interactSpeedMult * (this.classDef.id === 'engineer' && this.abilityActive ? 0.4 : 1);
  }

  // -------------------------------------------------------------------------
  // Door logic
  // -------------------------------------------------------------------------
  /** What the player can do with a door right now (method tells the prompt how to proceed). */
  checkDoor(d: DoorRuntime): { ok: boolean; reason?: string; method: 'open' | 'hack' | 'lockpick' | 'breach' | 'none' } {
    const def = d.def;
    if (!d.locked) return { ok: true, method: 'open' };
    if (this.accessTiers.has(def.access)) return { ok: true, method: 'open' };       // disguise / cloned keycard
    if (def.lock === 'lockpick') {
      const ok = this.gadgetCount('lockpick') > 0 || this.classDef.id === 'ghost' || this.classDef.id === 'engineer';
      return { ok, method: 'lockpick', reason: ok ? 'Pick lock' : 'Needs a lockpick' };
    }
    if (def.lock === 'breachable' || (def.lock === 'electronic' && def.id === this.deps.def.vaultDoorId)) {
      const ok = this.gadgetCount('breach_charge') > 0 || this.classDef.id === 'engineer';
      const isVault = def.id === this.deps.def.vaultDoorId;
      return {
        ok, method: 'breach',
        reason: ok ? 'Breach' : isVault ? 'Vault: hack the relay, get the manager override, drill the wall, or breach it' : 'Needs a breaching charge or an engineer',
      };
    }
    if (def.lock === 'keycard' || def.lock === 'keypad' || def.lock === 'electronic') {
      return { ok: (def.hackLevel ?? 0) > 0, method: 'hack', reason: `Locked (${def.lock}) — hack required` };
    }
    return { ok: false, method: 'none', reason: 'Locked' };
  }

  private useDoor(d: DoorRuntime): void {
    const def = d.def;
    if (d.locked && !this.accessTiers.has(def.access)) {
      if (def.lock === 'lockpick') {
        if (this.classDef.id !== 'ghost' && this.classDef.id !== 'engineer') this.useGadget('lockpick');
        this.startChannel({ kind: 'door', label: `Picking ${def.label}`, need: 3 * this.interactTime(), noiseEvery: 1.0, noiseKind: 'impact', onDone: () => this.unlockDoor(d, true) });
        return;
      }
      if (def.lock === 'breachable' || (def.lock === 'electronic' && def.id === this.deps.def.vaultDoorId)) {
        if (this.gadgetCount('breach_charge') > 0) {
          this.useGadget('breach_charge');
          this.startChannel({ kind: 'door', label: `Placing charge on ${def.label}`, need: 3.5, onDone: () => this.breachDoor(d) });
          return;
        }
        if (this.classDef.id === 'engineer') {
          this.startChannel({ kind: 'door', label: `Forcing ${def.label}`, need: 5, noiseEvery: 1.2, noiseKind: 'impact', onDone: () => this.breachDoor(d) });
          return;
        }
        return;
      }
      if (def.hackLevel) {
        const sourceId = `dev:door:${def.id}`;
        void sourceId;
        this.hack({ def: { id: def.id, hackLevel: def.hackLevel, kind: 'terminal' } as unknown as DeviceDef, state: 'idle', mesh: d.panel, glow: d.panel } as unknown as DeviceRuntime, def.lock === 'keycard' ? 'pattern' : 'sequence', () => this.unlockDoor(d, false));
        return;
      }
      return;
    }
    // unlocked: toggle open/close
    const open = !d.open;
    setDoorState(this.level, def.id, open);
    this.deps.audio.sfx('door', { x: (def.x0 + def.x1) / 2, y: 1, z: (def.z0 + def.z1) / 2 });
    this.emitNoise({ pos: { x: (def.x0 + def.x1) / 2, y: 1, z: (def.z0 + def.z1) / 2 }, radius: 10, loudness: 0.35, kind: 'door' });
    this.onEvent({ type: 'door', id: def.id, open, locked: d.locked });
  }

  unlockDoor(d: DoorRuntime, forced: boolean): void {
    d.locked = false;
    this.level.nav.setDoorLocked(d.navIndex, false);
    setDoorState(this.level, d.def.id, true);
    this.deps.audio.sfx('door', { x: (d.def.x0 + d.def.x1) / 2, y: 1, z: (d.def.z0 + d.def.z1) / 2 });
    if (forced) this.emitNoise({ pos: { x: (d.def.x0 + d.def.x1) / 2, y: 1, z: (d.def.z0 + d.def.z1) / 2 }, radius: 16, loudness: 0.6, kind: 'impact' });
    this.onEvent({ type: 'door', id: d.def.id, open: true, locked: false });
  }

  private breachDoor(d: DoorRuntime): void {
    this.emitNoise({ pos: { x: (d.def.x0 + d.def.x1) / 2, y: 1, z: (d.def.z0 + d.def.z1) / 2 }, radius: 40, loudness: 1, kind: 'gunshot' });
    this.effects.burst({ x: (d.def.x0 + d.def.x1) / 2, y: 1.2, z: (d.def.z0 + d.def.z1) / 2 }, 0xffb060, 26, 3.2, 0.7);
    this.deps.audio.sfx('explosion');
    this.player.addShake(0.8);
    this.unlockDoor(d, true);
    this.deps.hud.toast(`${d.def.label} breached.`, 'warn');
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------
  private hack(dev: DeviceRuntime, kind: HackKind, onSuccess: () => void): void {
    if (this.channel) return;
    if (this.hackRetryUsed === undefined) this.hackRetryUsed = false;
    let level = dev.def.hackLevel ?? 2;
    if (this.approach === 'technical') level = Math.max(1, level - 1);
    if (this.classDef.id !== 'hacker' && this.classDef.id !== 'engineer') level += 1;
    const timeBase = 6 + level * 1.5;
    const time = timeBase * this.stats.hackSpeedMult * (this.classDef.id === 'hacker' ? 0.8 : 1);
    const strikes = (this.classDef.id === 'hacker' ? 2 : 1) + (this.stats.unlocks.has('hack_retry') ? 1 : 0);
    this.deps.audio.sfx('hack');
    this.bus.emit('hack:start', { deviceId: dev.def.id, kind });
    this.emitNoise({ pos: dev.def.position, radius: 6, loudness: 0.15, kind: 'hack' });
    const started = startHack(this.deps.hackHost, {
      kind, level: Math.min(5, level), label: dev.def.label ?? 'Device', timeLimit: time, strikesAllowed: strikes,
      onDone: (ok, detail) => {
        this.player.setStance(this.player.stance);
        if (ok) {
          this.stats_hacksOk++;
          this.deps.audio.sfx('hack_ok');
          this.bus.emit('hack:success', { deviceId: dev.def.id, kind });
          onSuccess();
          this.onEvent({ type: 'device', id: dev.def.id, kind: dev.def.kind, result: 'hacked' });
        } else {
          this.stats_hacksFailed++;
          this.deps.audio.sfx('hack_fail');
          this.bus.emit('hack:fail', { deviceId: dev.def.id, kind, strikes: 1 });
          this.deps.hud.toast(`Hack failed: ${detail}`, 'warn');
          this.alarm.raise(1, 'Failed hack');
          if (this.stats_hacksFailed >= BALANCE.hack.strikeAlarmThreshold) this.alarm.raise(2, 'Repeated intrusion attempts');
          this.emitNoise({ pos: dev.def.position, radius: 14, loudness: 0.5, kind: 'alarm' });
          this.onEvent({ type: 'device', id: dev.def.id, kind: dev.def.kind, result: 'failed' });
        }
      },
    });
    if (!started) this.deps.hud.toast('Already hacking.', 'info');
  }
  private stats_hacksOk = 0;
  private stats_hacksFailed = 0;
  private hackRetryUsed?: boolean;

  private onTerminalHacked(dev: DeviceRuntime): void {
    dev.state = 'hacked';
    const unlock = dev.def.params?.unlockDoor as string | undefined;
    if (unlock) {
      const d = this.level.doors.get(unlock);
      if (d) { d.locked = false; this.level.nav.setDoorLocked(d.navIndex, false); }
      this.deps.hud.toast('Terminal accessed: staff office door released.', 'success');
    }
    const intel = dev.def.params?.intel as string | undefined;
    if (intel) this.deps.hud.subtitle('TERMINAL', intel);
    this.bus.emit('intel:revealed', { kind: 'terminal' });
  }

  private cutAlarm(dev: DeviceRuntime, how: 'hacked' | 'cut'): void {
    dev.state = how === 'hacked' ? 'hacked' : 'cut';
    this.alarm.disablePanel();
    this.deps.hud.toast('Alarm panel disabled: no response waves will deploy.', 'success');
    this.rt.complete('opt_alarm');
    this.onEvent({ type: 'device', id: dev.def.id, kind: 'alarm_panel', result: how === 'hacked' ? 'hacked' : 'cut' });
  }

  private blackoutCameras(dev: DeviceRuntime): void {
    const dur = 45 + (this.stats.unlocks.has('camera_loop') ? 30 : 0);
    this.cameraDisabledUntil = this.time + dur;
    for (const c of this.level.cameras) c.disabledUntil = this.cameraDisabledUntil;
    dev.state = 'hacked';
    this.deps.hud.toast(`Cameras offline for ${dur}s.`, 'success');
    this.rt.complete('opt_cams');
    this.onEvent({ type: 'device', id: dev.def.id, kind: 'camera_hub', result: 'hacked' });
  }

  private openVaultByDevice(dev: DeviceRuntime, how: 'hacked' | 'drilled' = 'hacked'): void {
    const d = this.level.doors.get(this.deps.def.vaultDoorId);
    if (!d) return;
    if (how === 'drilled') this.emitNoise({ pos: dev.def.position, radius: 30, loudness: 0.8, kind: 'drill' });
    dev.state = 'hacked';
    this.unlockDoor(d, how === 'drilled');
    this.deps.hud.toast(how === 'drilled' ? 'Vault wall breached.' : 'Vault control relay accepted your command.', 'success');
    this.onEvent({ type: 'device', id: dev.def.id, kind: 'vault_control', result: how === 'drilled' ? 'drilled' : 'hacked' });
  }

  // -------------------------------------------------------------------------
  // Hiding
  // -------------------------------------------------------------------------
  private enterHiding(id: string, pos: Vec3): void {
    this.hideSpot = { id, pos: { ...pos } };
    this.player.setPosition({ x: pos.x, y: 0, z: pos.z });
    this.player.setStance('crouch');
    this.hiddenOverlay = true;
    this.bus.emit('hiding:entered', { spotId: id });
    this.deps.hud.toast('Hidden. Stay still.', 'info');
  }

  private exitHiding(): void {
    if (!this.hideSpot) return;
    const p = this.hideSpot.pos;
    this.player.setPosition({ x: p.x + 0.9, y: 0, z: p.z });
    this.hideSpot = null;
    this.hiddenOverlay = false;
    this.bus.emit('hiding:exited', { spotId: '' });
  }

  // -------------------------------------------------------------------------
  // Crew
  // -------------------------------------------------------------------------
  private spawnCrew(): void {
    const ids = this.deps.crewIds.slice(0, 2 + (this.deps.skillIds.includes('l_professional') ? 1 : 0));
    const spawn = this.player.feet;
    ids.forEach((cid, i) => {
      const def: CrewDef | undefined = CREW_BY_ID[cid];
      if (!def) return;
      const tier = this.deps.crewTiers[cid] ?? 0;
      const weapon = WEAPONS[def.weaponId];
      const ang = (Math.PI * 2 * i) / Math.max(1, ids.length) + 0.6;
      const pos = { x: spawn.x + Math.cos(ang) * 1.6, y: 0, z: spawn.z + Math.sin(ang) * 1.6 };
      const npcSpec: NpcSpec = {
        id: `crew_${cid}`, role: 'crew_assault', kind: 'crew', faction: 'crew', position: pos, yaw: 0,
        access: ['public', 'staff', 'security', 'service', 'office', 'corridor', 'police'].filter((x) => x !== 'police'),
        modelKey: def.modelKeys[0], modelFallbacks: def.modelKeys.slice(1),
        appearance: { shirtColor: 0x2b3340, pantsColor: 0x1d2128, skinColor: 0xc69c7b, vestColor: 0x26303c, helmet: false },
        skill: 2, hp: def.stats.health * (1 + tier * 0.1) * this.diff.crewHealthMult * this.stats.crewHealthMult,
        armor: tier >= 1 ? 35 : 15, viewDistance: 26, heldWeapon: true, label: def.name.split(' ')[0],
        weapon: weapon ? {
          name: def.weaponId, magSize: weapon.magazine, mag: weapon.magazine, reserve: 0, reloadTime: weapon.reloadTime,
          fireInterval: 60 / weapon.fireRate, damage: weapon.damage, range: weapon.range1, accuracy: 0.5 * def.stats.accuracy, burst: weapon.automatic ? 3 : 1,
        } : undefined,
      };
      const n = this.npcs.spawn(npcSpec);
      n.crew = {
        crewId: cid, mode: 'follow', target: null, assistT: 0, assistKind: null, fireCd: 0,
        accuracy: def.stats.accuracy * this.stats.crewAccuracyMult,
        damage: (weapon?.damage ?? 20) * def.stats.damageMult * this.stats.crewDamageMult,
        range: weapon?.range1 ?? 30, followOffset: 2.2,
      };
      this.crew.push(n);
      this.npcById.set(n.id, n);
      this.attachNpcInteractable(n);
    });
    this.updateCrewHud();
  }

  issueCrewCommand(cmd: CrewMode | 'cover' | 'assist'): void {
    if (this.crew.length === 0) { this.deps.hud.toast('No crew with you.', 'info'); return; }
    const alive = this.crew.filter((c) => c.alive && !c.downed);
    if (alive.length === 0) { this.deps.hud.toast('Your crew are down.', 'warn'); return; }
    if (cmd === 'assist') {
      // closest unfinished device/door objective
      let best: Vec3 | null = null;
      let bestD = Infinity;
      for (const dev of this.level.devices.values()) {
        if (dev.state !== 'idle') continue;
        const dd = dist(this.player.feet, dev.def.position);
        if (dd < bestD && dd < 40) { bestD = dd; best = dev.def.position; }
      }
      if (!best) { this.deps.hud.toast('Nothing for the crew to assist with right now.', 'info'); return; }
      for (const c of alive) {
        c.crew!.mode = 'assist';
        c.crew!.target = { ...best };
        c.crew!.assistT = 6;
        c.crew!.assistKind = null;
      }
      this.deps.hud.toast('Crew moving to assist with the nearest system.', 'info');
    } else if (cmd === 'cover') {
      const f = this.player.flatForward();
      for (const c of alive) { c.crew!.mode = 'cover'; c.crew!.target = { x: this.player.feet.x + f.x * 4, y: 0, z: this.player.feet.z + f.z * 4 }; }
      this.deps.hud.toast('Crew covering this location.', 'info');
    } else if (cmd === 'hold') {
      for (const c of alive) { c.crew!.mode = 'hold'; c.crew!.target = { ...c.pos }; }
      this.deps.hud.toast('Crew holding position.', 'info');
    } else if (cmd === 'regroup') {
      for (const c of alive) c.crew!.mode = 'regroup';
      this.deps.hud.toast('Crew regrouping.', 'info');
    } else {
      for (const c of alive) c.crew!.mode = 'follow';
      this.deps.hud.toast('Crew following.', 'info');
    }
    this.bus.emit('crew:command', { command: cmd, crewIds: alive.map((c) => c.id) });
  }

  private updateCrewHud(): void {
    this.deps.hud.setCrew(this.crew.map((c) => ({
      id: c.id, name: c.label, hp: c.hp / c.maxHp, status: c.downed ? 'DOWN' : c.crew?.mode.toUpperCase() ?? 'READY',
    })));
  }

  // -------------------------------------------------------------------------
  // Gadgets, throwables and abilities
  // -------------------------------------------------------------------------
  private gadgetCount(id: GadgetId): number {
    return this.gadgetUses.get(id) ?? 0;
  }
  private hasGadget(id: GadgetId): boolean {
    return this.gadgetCount(id) > 0;
  }
  private useGadget(id: GadgetId): boolean {
    const n = this.gadgetUses.get(id) ?? 0;
    if (n <= 0) return false;
    this.gadgetUses.set(id, n - 1);
    return true;
  }

  private startGadgetUse(): void {
    const id = this.deps.loadout.gadgets[this.gadgetSel];
    if (!id) { this.deps.hud.toast('No gadget in that slot.', 'info'); return; }
    if (this.gadgetCount(id) <= 0) { this.deps.hud.toast(`${GADGETS[id].name} is out of uses.`, 'warn'); return; }
    if (this.time < this.gadgetReady) return;
    const def = GADGETS[id];
    this.startChannel({ kind: 'gadget', label: def.name, need: Math.max(0.5, def.useTime), onDone: () => this.applyGadget(id) });
  }

  private applyGadget(id: GadgetId): void {
    if (!this.useGadget(id)) return;
    this.gadgetReady = this.time + (GADGETS[id].cooldown ?? 1);
    switch (id) {
      case 'medkit':
        this.player.health = Math.min(this.stats.maxHealth, this.player.health + 60);
        this.deps.hud.toast('Trauma kit applied: +60 health.', 'success');
        break;
      case 'ammobox': {
        const added = this.weapons.addAmmo(60);
        this.deps.hud.toast(`Ammo resupplied (+${added}).`, 'success');
        break;
      }
      case 'emp_charge': {
        this.empUntil = this.time + 45;
        this.cameraDisabledUntil = Math.max(this.cameraDisabledUntil, this.time + 45);
        for (const d of this.level.doorList) {
          if (distXZ({ x: (d.def.x0 + d.def.x1) / 2, y: 0, z: (d.def.z0 + d.def.z1) / 2 }, this.player.feet) < 6 && d.def.lock !== 'lockpick' && d.def.lock !== 'breachable' && d.def.hackLevel) {
            d.locked = false; this.level.nav.setDoorLocked(d.navIndex, false);
          }
        }
        this.effects.pulse(this.player.feet, 0x66ccff, 6, 0.4);
        this.deps.hud.toast('EMP discharged: nearby electronics offline for 45s.', 'success');
        this.alarm.raise(1, 'Electrical fault');
        break;
      }
      case 'scanner':
        this.scanUntil = this.time + 8;
        this.deps.hud.toast('RF scan: electronics and loot revealed.', 'info');
        break;
      case 'lockpick':
      case 'keycard_cloner':
      case 'breach_charge':
        break;
      case 'repair_kit':
        this.deps.hud.toast('Repair kit used: machinery stabilised.', 'success');
        break;
      case 'disguise_kit': {
        // Quick change into the next owned uniform that differs from the current one (staff, security, service...).
        const order: DisguiseId[] = ['bank_staff', 'security', 'maintenance', 'civilian', 'police'];
        const owned = order.filter((d) => this.deps.ownedDisguises.includes(d) && d !== this.disguiseId);
        if (owned.length === 0) { this.deps.hud.toast('No other uniform in the kit.', 'warn'); break; }
        this.disguiseId = owned[0];
        this.deps.hud.toast(`Changed into ${DISGUISES[this.disguiseId].name}.`, 'success');
        break;
      }
      case 'deployable_cover': {
        const f = this.player.flatForward();
        const bx = this.player.feet.x + f.x * 1.6, bz = this.player.feet.z + f.z * 1.6;
        this.placeBarricade(bx, bz);
        break;
      }
      case 'trip_mine':
        this.traps.push({ pos: { ...this.player.feet }, armed: true, kind: 'trip', blockId: null });
        break;
      case 'stun_grenade':
      case 'noise_maker':
        break;
    }
  }

  private scanUntil = 0;

  private placeBarricade(x: number, z: number): void {
    const id = `barricade_${this.barricades.length}`;
    const box = this.level.physics.add({ min: { x: x - 0.9, y: 0, z: z - 0.2 }, max: { x: x + 0.9, y: 1.3, z: z + 0.2 } }, { solid: true, blocksSight: false, blocksNav: true, dynamicId: id, surface: 'metal' });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 0.4), new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6, metalness: 0.4 }));
    m.position.set(x, 0.65, z);
    m.castShadow = true;
    this.level.root.add(m);
    this.level.nav.addTempBlock(x, z, 0.9);
    this.barricades.push({ x, z, t: 25, id });
    void box;
  }

  private throwGadget(id: GadgetId): void {
    if (!this.useGadget(id)) { this.deps.hud.toast('Out of throwables.', 'warn'); return; }
    const fwd = this.player.forward();
    const origin = this.player.eyePos();
    const hit = this.level.physics.raycast(origin, fwd, 14);
    const dist2 = hit ? Math.max(1.2, hit.dist - 0.3) : 12;
    const pos = { x: origin.x + fwd.x * dist2, y: Math.max(0.2, origin.y + fwd.y * dist2), z: origin.z + fwd.z * dist2 };
    this.pendingThrows.push({ id, t: id === 'noise_maker' ? 2.0 : 1.2, pos });
    this.deps.audio.sfx('throw');
  }

  private resolveThrow(th: { id: GadgetId; pos: Vec3 }): void {
    if (th.id === 'noise_maker') {
      for (let i = 0; i < 4; i++) {
        this.scheduleNoise(i * 0.5, { pos: th.pos, radius: 26, loudness: 0.9, kind: 'distraction' });
      }
      this.deps.hud.toast('Distraction puck: guards are drawn to the noise.', 'info');
    } else if (th.id === 'stun_grenade') {
      this.effects.pulse(th.pos, 0xffffff, 20, 0.25);
      this.effects.burst(th.pos, 0xfff2b0, 22, 2.4, 0.5);
      this.deps.audio.sfx('explosion');
      let stunned = 0;
      for (const n of this.npcs.npcs) {
        if (!n.alive || n.kind === 'crew') continue;
        if (distXZ(n.pos, th.pos) < 8) {
          this.npcs.incapacitate(n, 4);
          stunned++;
        }
      }
      if (dist(this.player.feet, th.pos) < 6) { this.player.addShake(0.8); this.flashT = 0.8; }
      this.deps.hud.toast(`Flashbang: ${stunned} stunned.`, 'info');
      this.emitNoise({ pos: th.pos, radius: 16, loudness: 0.6, kind: 'impact' });
    }
  }

  private scheduleNoise(delay: number, e: { pos: Vec3; radius: number; loudness: number; kind: 'distraction' }): void {
    this.noiseQueue.push({ at: this.time + delay, ev: e });
  }
  private noiseQueue: Array<{ at: number; ev: { pos: Vec3; radius: number; loudness: number; kind: 'distraction' } }> = [];

  private useAbility(): void {
    if (this.abilityCd > 0 || this.abilityActive) return;
    const ab = this.classDef.ability;
    if (ab.id === 'surge') {
      this.cameraDisabledUntil = this.time + 20;
      this.scanUntil = this.time + 20;
      this.deps.hud.toast('System Surge: cameras disabled 20s, electronics revealed.', 'success');
      this.abilityCd = ab.cooldown;
    } else {
      this.abilityActive = true;
      this.abilityLeft = ab.duration;
      this.abilityCd = ab.cooldown;
      if (ab.id === 'vanish') this.player.vanish = true;
      this.deps.hud.toast(`${ab.name} active.`, 'success');
    }
    this.deps.audio.sfx('ability');
    this.bus.emit('player:ability', { id: ab.id, active: true, cooldownLeft: this.abilityCd });
  }

  private endAbility(): void {
    const ab = this.classDef.ability;
    this.abilityActive = false;
    if (ab.id === 'vanish') this.player.vanish = false;
    this.bus.emit('player:ability', { id: ab.id, active: false, cooldownLeft: this.abilityCd });
  }

  get abilityState(): { name: string; cd: number; active: boolean; left: number } {
    return { name: this.classDef.ability.name, cd: this.abilityCd, active: this.abilityActive, left: this.abilityLeft };
  }

  // -------------------------------------------------------------------------
  // Channels (hold actions)
  // -------------------------------------------------------------------------
  private startChannel(c: Omit<Channel, 't'> & { t?: number }): void {
    if (this.channel) return;
    this.channel = { ...c, t: 0 };
    this.deps.hud.setChannel(c.label, 0);
  }

  private tickChannel(dt: number, holding: boolean): void {
    const c = this.channel;
    if (!c) return;
    const moved = this.player.moving || this.player.sprinting;
    if (!holding || moved) {
      this.channel = null;
      this.deps.hud.setChannel('', 0);
      c.onCancel?.();
      this.deps.hud.toast('Cancelled', 'info');
      return;
    }
    c.t += dt * (c.kind === 'device' || c.kind === 'cut' ? 1 : 1);
    if (c.noiseEvery) {
      c.noiseT = (c.noiseT ?? 0) + dt;
      if (c.noiseT >= c.noiseEvery) {
        c.noiseT = 0;
        this.emitNoise({ pos: { ...this.player.feet }, radius: c.noiseKind === 'drill' ? 28 : 16, loudness: 0.8, kind: c.noiseKind === 'drill' ? 'drill' : 'impact' });
      }
    }
    this.deps.hud.setChannel(c.label, Math.min(1, c.t / c.need));
    if (c.t >= c.need) {
      this.channel = null;
      this.deps.hud.setChannel('', 0);
      c.onDone();
    }
  }

  // -------------------------------------------------------------------------
  // Shooting & damage
  // -------------------------------------------------------------------------
  private onPlayerShot(s: FireShot): void {
    this.stats_shots++;
    this.lastShotT = this.time;
    // resolve on the spot (hitscan)
    const origin = s.origin;
    const dir = s.dir;
    const wall = this.level.physics.raycast(origin, dir, 220);
    const maxDist = wall ? wall.dist : 220;
    const hit = this.npcs.raycastNpcs(origin, dir, maxDist);
    const muzzle = { x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6 };
    this.effects.muzzleFlash(muzzle, dir, s.silent);
    if (hit) {
      const endPoint = { x: origin.x + dir.x * hit.dist, y: origin.y + dir.y * hit.dist, z: origin.z + dir.z * hit.dist };
      this.effects.tracer(muzzle, endPoint);
      this.effects.burst(endPoint, 0x9a2020, 3, 1.2, 0.3);
      const zoneMult = hit.zone === 'head' ? s.headMult : hit.zone === 'limb' ? s.limbMult : 1;
      const fall = falloffMult(hit.dist, s.range0, s.range1, s.minMult);
      let dmg = s.damage * fall * zoneMult * (this.abilityActive && this.classDef.id === 'loud' ? 1.25 : 1) * this.stats.damageDealtMult;
      if (hit.npc.armor > 0) dmg *= 1 + s.penetration * 0.5;
      if (hit.npc.kind === 'crew') return;
      if (s.taser) {
        if (hit.npc.kind !== 'civilian' || true) this.npcs.incapacitate(hit.npc, BALANCE.npc.baseSpeedRun * 0 + 25);
        this.deps.hud.hitMarker(false);
        this.deps.audio.sfx('taser');
        return;
      }
      const lethal = !(WEAPONS[s.weaponId]?.melee && !WEAPONS[s.weaponId]?.melee?.lethal);
      const wasAlive = hit.npc.alive;
      this.npcs.damageNpc(hit.npc, dmg, hit.zone, true, lethal);
      this.deps.audio.sfx('hit', hit.npc.pos);
      void wasAlive;
    } else {
      const endPoint = wall ? wall.point : { x: origin.x + dir.x * 220, y: origin.y + dir.y * 220, z: origin.z + dir.z * 220 };
      this.effects.tracer(muzzle, endPoint);
      if (wall) {
        this.effects.impact(wall.point, wall.normal, wall.box.surface);
        this.deps.audio.impact(wall.box.surface, wall.point);
      }
    }
    const kind = s.silent ? 'suppressed' : 'gunshot';
    this.emitNoise({ pos: { ...this.player.feet }, radius: s.noise * (s.silent ? 0.22 : 1), loudness: 1, kind });
    this.deps.audio.gunshot(WEAPONS[s.weaponId]?.category ?? 'pistol', !!s.silent, this.player.feet);
    this.player.kick(s.silent ? 0.2 : 0.4, 0);
    if (!s.silent) this.player.addShake(0.12);
  }
  private stats_shots = 0;
  private lastShotT = -99;

  private onPlayerHitBy(dmg: number, from: Npc, zone: HitZone): void {
    void zone;
    const before = this.player.health;
    this.player.damage(dmg, from.pos);
    this.deps.hud.damageFrom(from.pos, this.player.feet);
    this.deps.audio.sfx('hurt');
    void before;
  }

  private onCivilianHarmed(n: Npc): void {
    this.rt.stats.civiliansHarmed++;
    this.deps.hud.toast('Civilian harmed — the police will hear about this.', 'warn');
    this.alarm.raise(1, 'Civilian harmed');
    this.onEvent({ type: 'civilianHarmed', id: n.id });
  }

  private onNpcDown(n: Npc, lethal: boolean, byPlayer: boolean): void {
    if (lethal) {
      this.killCount++;
      this.rt.stats.kills++;
      this.bus.emit('npc:down', { id: n.id, byPlayer, faction: n.faction });
      this.deps.hud.toast(`${n.label} down`, 'info');
      this.deps.audio.sfx('down');
      if (n.kind === 'civilian' || n.kind === 'staff' || n.kind === 'manager') {
        this.rt.stats.civiliansHarmed += n.kind === 'civilian' ? 1 : 0;
      }
    }
    if (n.kind === 'crew') { this.rt.stats.crewDowned++; this.updateCrewHud(); }
    this.onEvent({ type: 'npcDown', id: n.id, lethal, faction: n.faction });
    if (n.kind === 'crew') this.bus.emit('crew:down', { id: n.id });
    this.hudHit(true, n);
  }

  private hudHit(kill: boolean, n: Npc): void {
    this.deps.hud.hitMarker(kill);
    void n;
  }

  // -------------------------------------------------------------------------
  // NPC callbacks
  // -------------------------------------------------------------------------
  private onNpcState(n: Npc, from: AlertState, to: AlertState): void {
    if (to === 'combat' || to === 'alerted') {
      if (n.isCombatant) this.alarm.raise(to === 'combat' ? 2 : 1, `${n.label} ${to}`);
    }
    if (to === 'combat' && n.kind === 'civilian') this.alarm.raise(1, 'Civilians fleeing');
    this.bus.emit('npc:state-changed', { id: n.id, from, to });
    if (n.isCombatant && to === 'combat' && this.rt.stats.detectionPeak < 100) this.rt.stats.detectionPeak = Math.max(this.rt.stats.detectionPeak, 90);
  }

  private onBark(n: Npc, line: string, kind: 'speech' | 'radio' | 'shout'): void {
    n.barkCd = 5;
    if (kind === 'radio') this.deps.hud.subtitle(`${n.label} (radio)`, line);
    else if (this.deps.settings.subtitles && dist(n.pos, this.player.feet) < 22) this.deps.hud.subtitle(n.label, line);
    this.deps.audio.sfx(kind === 'radio' ? 'radio' : 'voice', n.pos);
  }

  private onRadio(from: Npc, level: number): void {
    this.deps.audio.sfx('radio');
    this.bus.emit('npc:radio-alert', { position: { ...from.pos }, level, faction: from.faction });
    if (level >= 2) this.alarm.raise(2, 'Guard reports contact');
  }

  private emitNoise(e: { pos: Vec3; radius: number; loudness: number; kind: any; sourceId?: string }): void {
    this.npcs.emitNoise({ pos: { ...e.pos }, radius: e.radius, loudness: e.loudness, kind: e.kind, sourceId: e.sourceId });
    this.bus.emit('noise:emitted', { position: { ...e.pos }, radius: e.radius, loudness: e.loudness, kind: e.kind });
  }

  // -------------------------------------------------------------------------
  // Alarm, lockdown, response
  // -------------------------------------------------------------------------
  private onAlarmChanged(level: number, label: string, reason: string): void {
    this.rt.stats.alarmTriggers++;
    this.bus.emit('alarm:changed', { level, label });
    this.deps.hud.setAlarm(level, label);
    this.deps.hud.toast(`ALARM ${label}: ${reason}`, level >= 2 ? 'warn' : 'info');
    this.onEvent({ type: 'alarm', level, label });
    if (level >= 2) this.deps.audio.sfx('alarm_hit');
  }

  private lockdown(): void {
    if (this.lockdownDone) return;
    this.lockdownDone = true;
    for (const id of this.deps.def.alarmLockedDoors(this.deps.def.level)) {
      const d = this.level.doors.get(id);
      if (!d) continue;
      d.locked = true;
      this.level.nav.setDoorLocked(d.navIndex, true);
      if (d.open) setDoorState(this.level, id, false);
    }
    this.deps.hud.toast('LOCKDOWN: staff and vault doors sealed.', 'warn');
  }

  private spawnResponse(count: number): void {
    const pts = ['resp_street', 'resp_alley', 'resp_north'].map((id) => this.level.spawns.get(id)!).filter(Boolean);
    const target = this.level.spawns.get('ext_van_street')?.position ?? this.player.feet;
    for (let i = 0; i < count; i++) {
      const sp = pts[i % pts.length];
      const spec: NpcSpec = {
        id: `police_${this.stats_resp++}`, role: 'police', kind: 'police', faction: 'police',
        position: { x: sp.position.x + this.rng.range(-1.2, 1.2), y: 0, z: sp.position.z + this.rng.range(-1.2, 1.2) }, yaw: 0,
        access: ['public', 'staff', 'security', 'service', 'police'],
        modelKey: ['Police_Male_01', 'Police_Female_01', 'Military_Male_01'][i % 3],
        appearance: { shirtColor: 0x1b2433, pantsColor: 0x161b24, vestColor: 0x222a36, helmet: true },
        skill: this.diff.enemyAccuracyMult > 1.1 ? 3 : 2, hp: 110 * this.diff.enemyHealthMult, armor: 60,
        viewDistance: 30, heldWeapon: true, label: `Officer ${i + 1}`,
        weapon: { name: 'Police carbine', magSize: 30, mag: 30, reserve: 90, reloadTime: 2.4, fireInterval: 0.22, damage: 16, range: 55, accuracy: 0.45, burst: 3 },
      };
      const n = this.npcs.spawn(spec);
      this.npcById.set(n.id, n);
      n.investigateAt = { ...target };
      n.setState('investigating');
      this.attachNpcInteractable(n);
    }
    this.deps.hud.toast(`Police response inbound: ${count} units.`, 'warn');
    this.bus.emit('npc:radio-alert', { position: { ...target }, level: 3, faction: 'police' });
  }
  private stats_resp = 0;

  private onPerimeterSealed(): void {
    if (this.extraction.state === 'inbound' || this.extraction.state === 'done') return;
    this.perimeterFailed = true;
    this.endMission(false, 'Perimeter sealed — no extraction possible.');
  }

  // -------------------------------------------------------------------------
  // Extraction
  // -------------------------------------------------------------------------
  private checkExtraction(): { ok: boolean; reason?: string } {
    if (this.extraction.state !== 'idle') return { ok: false, reason: 'Extraction already called' };
    if (!this.escapeSpawn) return { ok: false, reason: 'No escape route' };
    if (!this.rt.isDone('gold')) return { ok: false, reason: 'Secure the gold first' };
    const d = dist(this.player.feet, this.escapeSpawn.position);
    if (d > 4.5) return { ok: false, reason: 'Move to the extraction point' };
    return { ok: true };
  }

  private startExtraction(): void {
    this.extraction.state = 'inbound';
    this.extraction.t = 0;
    const driver = this.crew.some((c) => c.crew?.crewId === 'crew_rook' && !c.downed);
    this.extraction.need = 15 * (driver ? 0.7 : 1) * (this.stats.unlocks.has('fast_orders') ? 0.9 : 1);
    this.deps.hud.toast(`Extraction inbound — hold the zone (${Math.round(this.extraction.need)}s).`, 'success');
    this.alarm.raise(2, 'Extraction called');
    this.rt.setPhase('extraction');
    this.bus.emit('mission:phase', { phase: 'extraction' });
    this.deps.audio.sfx('radio');
  }

  private updateExtraction(dt: number): void {
    if (this.extraction.state !== 'inbound') return;
    const zone = this.escapeSpawn!.position;
    const inside = dist(this.player.feet, zone) <= 4.5;
    if (!inside) {
      this.deps.hud.setExtraction(this.extraction.t / this.extraction.need, 'Return to the extraction point');
      return;
    }
    this.extraction.t += dt;
    const p = Math.min(1, this.extraction.t / this.extraction.need);
    this.deps.hud.setExtraction(p, `Extraction ${Math.round(p * 100)}%`);
    if (this.extraction.t >= this.extraction.need) {
      this.extraction.state = 'done';
      this.bus.emit('extraction:done', { location: this.escapeSpawn!.id });
      this.onEvent({ type: 'extracted' });
      this.endMission(true, 'Extracted successfully.');
    }
  }

  // -------------------------------------------------------------------------
  // Mission-definition plumbing
  // -------------------------------------------------------------------------
  onEvent(ev: MissionEvent): void {
    this.deps.def.onEvent(ev, { rt: this.rt, world: this });
  }

  /** Completes objectives that depend on alarm/room state etc. Called each frame. */
  private checkRoom(): void {
    const room = this.level.level.rooms.find((r) => this.player.feet.x >= r.x0 && this.player.feet.x <= r.x1 && this.player.feet.z >= r.z0 && this.player.feet.z <= r.z1);
    const id = room?.id ?? 'outside';
    if (id !== this.lastRoomId) {
      this.lastRoomId = id;
      this.onEvent({ type: 'room', roomId: id, tags: room?.tags ?? ['outside'] });
    }
  }

  get roomId(): string { return this.lastRoomId; }

  private endMission(success: boolean, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.rt.setPhase(success ? 'success' : 'failed');
    this.rt.outcomeReason = reason;
    this.bus.emit(success ? 'mission:success' : 'mission:failed', success ? {} as never : { reason });
    this.deps.audio.alarm(false);
    const outcome: MissionOutcome = {
      success,
      primaryComplete: this.rt.primaryDone,
      optionalLootValue: this.optionalLoot,
      primaryLootValue: this.primaryLoot,
      optionalObjectivesDone: this.rt.optionalDone,
      optionalObjectivesTotal: this.rt.optionalTotal,
      detectionPeak: Math.round(this.rt.stats.detectionPeak),
      civiliansHarmed: this.rt.stats.civiliansHarmed,
      crewDowned: this.rt.stats.crewDowned,
      kills: this.killCount,
      extracted: this.extraction.state === 'done',
      difficulty: this.deps.plan.difficulty,
      alarmTriggered: this.alarm.triggerCount > 0,
      timeSeconds: this.time,
      parTimeSeconds: this.deps.def.parTime,
      lootValueMult: 1,
    };
    this.rt.stats.lootValue = this.lootTotal;
    this.rt.stats.optionalLootValue = this.optionalLoot;
    this.rt.stats.primaryLootValue = this.primaryLoot;
    this.rt.stats.timeSeconds = this.time;
    this.rt.stats.shotsFired = this.stats_shots;
    this.rt.stats.hacksOk = this.stats_hacksOk;
    this.rt.stats.hacksFailed = this.stats_hacksFailed;
    this.deps.onEnd({
      def: this.deps.def,
      success: success && this.extraction.state === 'done',
      outcome,
      reason,
      stats: { ...this.rt.stats },
      objectivesDone: this.rt.order.filter((id) => this.rt.isDone(id)),
      classId: this.deps.classId,
      difficulty: this.deps.plan.difficulty,
      approach: this.approach,
    });
  }

  /** Forces failure from outside (menu quit). */
  abort(reason: string): void {
    this.endMission(false, reason);
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  update(dt: number): void {
    if (this.ended || this.paused) return;
    const t0 = performance.now();
    this.time += dt;
    this.rt.stats.timeSeconds = this.time;
    const input = this.deps.input;
    const hacking = this.deps.hackHost.querySelector('.hack-overlay') !== null;
    const blocked = this.uiBlocked || hacking;
    this.rt.setPhase(this.rt.phase === 'deployment' && this.time > 1.5 ? 'active' : this.rt.phase);
    if (this.rt.phase === 'active') this.rt.setPhase('active');

    // ---- player movement (blocked while UI/hack overlays active) --------
    const lockScale = this.channel ? 0.2 : 1;
    const aiming = this.weapons.aiming && !this.player.sprinting;
    const canMove = !blocked && !this.hideSpot;
    if (this.player.downed) {
      // downed: no movement or fire
    }
    this.player.update(dt, input, this.deps.settings, {
      canMove: canMove && !this.player.downed,
      aiming,
      sprintAllowed: !this.channel,
      lockScale: lockScale * this.carryScale(),
      elapsed: this.time,
    });
    if (!blocked && input.locked && !this.player.downed) {
      this.player.look(input.mouseDX, input.mouseDY, this.deps.settings, aiming, 1);
    }
    for (const ev of this.player.events) {
      if (ev.type === 'step') this.deps.audio.footstep(ev.surface, ev.sprint, this.player.feet);
      if (ev.type === 'vault') this.deps.audio.sfx('vault');
      if (ev.type === 'land') this.deps.audio.sfx('land');
      if (ev.type === 'damaged') { /* feedback */ }
      if (ev.type === 'downed') { this.onPlayerDowned(); }
      if (ev.type === 'dead') { this.onPlayerDead(); return; }
    }
    if (this.player.dead) return;

    // ---- abilities ---------------------------------------------------
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    if (this.abilityActive) {
      this.abilityLeft -= dt;
      this.applyAbilityTick(dt);
      if (this.abilityLeft <= 0) this.endAbility();
    }

    // ---- hide & channels --------------------------------------------
    if (this.hideSpot) {
      this.player.setStance('crouch');
      if (input.wasPressed('KeyE')) this.exitHiding();
    }
    if (this.channel) this.tickChannel(dt, input.isDown('KeyE') || input.isDown('KeyF') || input.isDown('KeyR') && false || this.channel.kind === 'gadget' ? input.isDown('KeyF') || input.isDown('KeyE') : input.isDown('KeyE'));

    // ---- weapons -----------------------------------------------------
    if (!blocked && !this.player.downed && !this.channel && !this.hideSpot) {
      const f = this.player.forward();
      const r = this.player.flatRight();
      const up = { x: 0, y: 1, z: 0 };
      const right = { x: r.x, y: 0, z: r.z };
      const eye = this.player.eyePos();
      if (this.deps.settings.toggleAim && input.mouseClicked(2)) this.aimToggled = !this.aimToggled;
      const adsKey = this.deps.settings.toggleAim ? this.aimToggled : input.mouseHeld(2);
      const res = this.weapons.update(dt, {
        fireHeld: input.mouseHeld(0) && !this.crewPanel,
        firePressed: input.mouseClicked(0) && !this.crewPanel,
        reloadPressed: input.wasPressed('KeyR'),
        aimHeld: adsKey,
        sprinting: this.player.sprinting,
        moving: this.player.moving,
        crouched: this.player.stance === 'crouch',
        handlingMult: this.stats.weaponHandlingMult * (this.classDef.id === 'loud' && this.abilityActive ? 0.7 : 1),
        reloadSpeedMult: this.stats.reloadSpeedMult,
        swapMult: this.stats.weaponSwapMult,
        ammoType: this.deps.loadout.ammo,
        fireRateMult: this.abilityActive && this.classDef.id === 'loud' ? 1.25 : 1,
      }, eye, f, right, up);
      if (res.melee) this.resolveMelee(res.melee);
      if (res.emptyClick) this.deps.audio.sfx('empty');
      if (res.reloadStarted) { this.deps.audio.sfx('reload'); this.deps.hud.setReload(res.reloadStarted.duration); }
      if (res.reloadFinished) this.deps.hud.setReload(0);
      if (res.reloadInterrupted) this.deps.hud.setReload(0);
      // weapon switching
      if (input.wasPressed('Digit1')) this.switchSlot(0);
      if (input.wasPressed('Digit2')) this.switchSlot(1);
      if (input.wasPressed('Digit3')) this.switchSlot(2);
      if (input.wheel !== 0 && !this.crewPanel) {
        const id = this.weapons.cycle(input.wheel > 0 ? 1 : -1, this.stats.weaponSwapMult);
        if (id) this.afterSwitch();
      }
      // gadgets & throwables
      if (input.wasPressed('KeyZ')) { this.gadgetSel = this.gadgetSel === 0 ? 1 : 0; this.deps.hud.toast(`Equipment slot ${this.gadgetSel + 1}: ${this.gadgetName(this.gadgetSel)}`, 'info'); }
      if (input.wasPressed('KeyF')) this.startGadgetUse();
      if (input.wasPressed('KeyG') && this.deps.loadout.throwable) this.throwGadget(this.deps.loadout.throwable);
      if (input.wasPressed('KeyX')) this.useAbility();
    }
    if (this.weapons.current) this.refreshAmmoHud();

    // crew panel (C toggles; 1-5 issues)
    if (input.wasPressed('KeyC')) { this.crewPanel = !this.crewPanel; this.deps.hud.setCrewPanel(this.crewPanel); }
    if (this.crewPanel && !blocked) {
      const cmds: Array<'follow' | 'hold' | 'regroup' | 'cover' | 'assist'> = ['follow', 'hold', 'regroup', 'cover', 'assist'];
      cmds.forEach((c, i) => { if (input.wasPressed(`Digit${i + 1}`)) this.issueCrewCommand(c); });
    }
    if (this.crewPanel && this.deps.hud.overlayOpen) { /* ok */ }

    // ---- interaction ---------------------------------------------------
    const forward = this.player.forward();
    const eyeNow = this.player.eyePos();
    this.interact.update(dt, eyeNow, forward, input.isDown('KeyE') && !blocked, input.wasPressed('KeyE') && !blocked, this.level.physics, blocked || !!this.channel || this.player.downed);
    this.deps.hud.setInteract(this.interact.info.label, this.interact.info.usable, this.interact.info.reason, this.interact.info.progress, this.interact.info.hold > 0);

    // ---- timers: throws, noise queue, barricades, traps ---------------
    for (let i = this.pendingThrows.length - 1; i >= 0; i--) {
      const th = this.pendingThrows[i];
      th.t -= dt;
      if (th.t <= 0) { this.resolveThrow(th); this.pendingThrows.splice(i, 1); }
    }
    for (let i = this.noiseQueue.length - 1; i >= 0; i--) {
      if (this.noiseQueue[i].at <= this.time) { this.emitNoise(this.noiseQueue[i].ev as never); this.noiseQueue.splice(i, 1); }
    }
    for (let i = this.barricades.length - 1; i >= 0; i--) {
      const b = this.barricades[i];
      b.t -= dt;
      if (b.t <= 0) {
        this.level.physics.setDynamicEnabled(b.id, false);
        this.level.nav.removeTempBlock(b.x, b.z, 0.9);
        this.barricades.splice(i, 1);
      }
    }
    for (const tr of this.traps) {
      if (!tr.armed) continue;
      for (const n of this.npcs.npcs) {
        if (n.alive && !n.downed && n.kind !== 'crew' && dist(n.pos, tr.pos) < 1.2) {
          tr.armed = false;
          this.npcs.incapacitate(n, 6);
          this.effects.burst(tr.pos, 0xff6030, 14, 2.5, 0.5);
          this.emitNoise({ pos: tr.pos, radius: 14, loudness: 0.6, kind: 'impact' });
          break;
        }
      }
    }

    // ---- world systems ----------------------------------------------------
    updateDoors(this.level, dt);
    if (this.time < this.cameraDisabledUntil) { /* cameras offline */ }
    this.updateCameras(dt);
    if (this.time > this.scanUntil && this.scanUntil > 0) { this.scanUntil = 0; }

    // NPC simulation
    const playerSnap = this.buildSnapshot();
    this.npcs.update(dt, this.time, playerSnap, this.rng, (l, r) => this.alarm.raise(l, r));
    for (const n of this.npcs.npcs) {
      if (n.alive && n.crew === null && n.kind === 'crew') n.crew = null;
    }
    // Civilian escape & crew damage handled in events; death & alarm updates:
    const hostile = this.npcs.npcs.filter((n) => n.alive && !n.downed && (n.state === 'combat' || n.state === 'alerted') && n.faction !== 'civilian').length;
    this.alarm.update(dt, hostile);
    if (this.alarm.perimeterTimer !== null) this.deps.hud.setTimer(this.alarm.perimeterTimer, 'PERIMETER SEALS IN');
    else this.deps.hud.setTimer(null, '');

    // hostile proximity / suspicion meter
    this.updateSuspicionHud();

    // crew logic & revive
    this.updateCrew(dt);

    // extraction
    this.updateExtraction(dt);

    // mission-specific per-frame
    this.onEvent({ type: 'tick', dt });
    this.checkRoom();

    // HUD
    this.deps.hud.setHealth(this.player.health / this.stats.maxHealth, this.player.armorRatio, this.player.downed, this.player.bleedoutLeft);
    this.deps.hud.setHurt(this.player.hurtFlash);
    this.deps.hud.setObjectives(this.rt.visible().map((o) => ({ id: o.id, text: o.text, state: o.state, optional: !!o.optional, progress: o.progress })));
    this.deps.hud.setLoot(this.lootTotal, this.carry);
    this.deps.hud.setAbility(this.abilityState.name, this.abilityState.cd, this.abilityState.active);
    this.deps.hud.setGadgets(this.deps.loadout.gadgets.map((g, i) => (g ? { name: GADGETS[g].name, uses: this.gadgetCount(g), slot: i } : null)), this.gadgetSel, this.deps.loadout.throwable ? { name: GADGETS[this.deps.loadout.throwable].name, uses: this.gadgetCount(this.deps.loadout.throwable) } : null);
    this.deps.hud.setCrosshair(this.crosshairMode(), this.interact.info.usable);
    this.deps.hud.setCameraCount(this.level.cameras.filter((c) => this.time > c.disabledUntil).length, this.time < this.cameraDisabledUntil);

    // effects & viewmodel
    this.effects.update(dt);
    this.updateViewmodel(dt, aiming);
    this.flashT = Math.max(0, this.flashT - dt);
    this.deps.hud.setFlash(this.flashT / 0.8);
    this.hitMarkerT = Math.max(0, this.hitMarkerT - dt);

    // stats
    this.rt.stats.detectionPeak = Math.min(100, Math.max(this.rt.stats.detectionPeak, this.peakSuspicion));
    // "Escape before the timer" handled by alarm perimeter. Dead check:
    if (this.player.dead) this.onPlayerDead();
    this.deps.audio.setAmbient(this.alarm.level);

    // perf metric
    this.frameTimes.push(performance.now() - t0);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    input.endFrame();
  }

  private peakSuspicion = 0;
  private aimToggled = false;

  private updateSuspicionHud(): void {
    let max = 0;
    for (const n of this.npcs.npcs) {
      if (!n.alive || n.downed || n.kind === 'crew') continue;
      if (n.isCombatant || n.kind === 'civilian' || n.kind === 'staff' || n.kind === 'manager') max = Math.max(max, n.suspicion);
    }
    this.peakSuspicion = Math.max(this.peakSuspicion, Math.min(100, max));
    const label = max >= 85 ? 'DETECTED' : max >= 62 ? 'INVESTIGATED' : max >= 42 ? 'SUSPICIOUS' : max >= 18 ? 'CURIOUS' : 'HIDDEN';
    this.deps.hud.setSuspicion(max / 100, label);
  }

  private updateCrew(dt: number): void {
    // Assist: a hacker in 'assist' mode works the nearest device once in position (75% success).
    for (const c of this.crew) {
      const cs = c.crew;
      if (!cs || cs.mode !== 'assist' || c.downed || !cs.target) continue;
      if (distXZ(c.pos, cs.target) > 1.6 || cs.assistKind === 'done') continue;
      if (cs.crewId !== 'crew_pixel') continue;
      const dev = Array.from(this.level.devices.values()).find((d) => d.state === 'idle' && dist(d.def.position, cs.target!) < 1.5);
      if (!dev) continue;
      cs.assistKind = 'done';
      const ok = this.rng.next() < 0.75;
      if (ok) {
        this.deps.hud.toast(`${c.label} cracked the ${dev.def.label}.`, 'success');
        this.deviceSuccess.get(dev.def.id)?.();
      } else {
        this.deps.hud.toast(`${c.label} could not crack the ${dev.def.label} — try again manually.`, 'warn');
        this.alarm.raise(1, 'Crew hack failed');
      }
      cs.mode = 'follow';
    }
    // Revive dynamics handled below.
    // Auto revive for the player by an adjacent medic or any crew within 2.5m after bleedout starts
    if (this.player.downed) {
      const near = this.crew.find((c) => c.alive && !c.downed && dist(c.pos, this.player.feet) < 2.5);
      if (near) {
        this.player.revive(35);
        this.deps.hud.toast(`${near.label} pulled you up.`, 'success');
      }
    }
    // crew tiers: bonus revive/healing on tier-3 medic etc. (simple)
    for (const c of this.crew) {
      if (c.downed) continue;
      c.hp = Math.min(c.maxHp, c.hp + (c.crew?.crewId === 'crew_stitch' ? 2 * dt : 0));
    }
    this.updateCrewHud();
  }

  private crosshairMode(): 'default' | 'enemy' | 'interact' | 'ads' | 'reload' {
    if (this.interact.info.usable) return 'interact';
    if (this.weapons.current && this.weapons.current.reloadT > 0) return 'reload';
    if (this.weapons.aiming) return 'ads';
    return 'default';
  }

  private carryScale(): number {
    return 1;
  }

  private gadgetName(i: 0 | 1): string {
    const g = this.deps.loadout.gadgets[i];
    return g ? GADGETS[g].name : 'empty';
  }

  private afterSwitch(): void {
    this.refreshViewmodel();
    this.deps.hud.setWeaponActive(this.weapons.active);
    const w = this.weapons.current;
    this.deps.audio.sfx('swap');
    if (w) this.deps.hud.toast(`${w.def.name}`, 'info');
  }

  private switchSlot(slot: 0 | 1 | 2): void {
    const id = this.weapons.select(slot, this.stats.weaponSwapMult);
    if (id) this.afterSwitch();
  }

  private resolveMelee(m: { range: number; lethal: boolean; silent: boolean; damage: number; dir: Vec3; origin: Vec3; weaponId: string }): void {
    // find an NPC within reach in front (cone)
    let best: Npc | null = null;
    let bestD = Infinity;
    for (const n of this.npcs.npcs) {
      if (!n.alive || n.kind === 'crew') continue;
      const dx = n.pos.x - m.origin.x, dz = n.pos.z - m.origin.z;
      const d = Math.hypot(dx, dz);
      if (d > m.range) continue;
      const facing = (dx * m.dir.x + dz * m.dir.z) / (d || 1);
      if (facing < 0.5) continue;
      if (d < bestD) { bestD = d; best = n; }
    }
    this.deps.audio.sfx(m.silent ? 'knife' : 'bat');
    if (!best) return;
    const behind = best.state === 'unaware' && (best.yaw - Math.atan2(m.dir.x, m.dir.z) + Math.PI * 3) % (Math.PI * 2) > Math.PI * 0.6;
    if (m.lethal && (behind || best.state === 'unaware' || best.downed)) {
      this.npcs.damageNpc(best, 999, 'torso', true, true);
      this.bus.emit('combat:melee-takedown', { targetId: best.id, lethal: true });
    } else if (!m.lethal) {
      this.npcs.incapacitate(best, 28);
      this.bus.emit('combat:melee-takedown', { targetId: best.id, lethal: false });
    } else {
      this.npcs.damageNpc(best, m.damage, 'torso', true, true);
    }
  }

  private onPlayerDowned(): void {
    this.rt.stats.playerDowns++;
    this.deps.hud.toast('You are down! Crew can pull you up.', 'warn');
    this.deps.audio.sfx('down');
    this.bus.emit('player:downed', {});
  }

  private onPlayerDead(): void {
    if (this.ended) return;
    this.bus.emit('player:dead', {});
    this.endMission(false, 'Operator lost — the crew is pulling out without the contract.');
  }

  private applyAbilityTick(dt: number): void {
    const id = this.classDef.ability.id;
    if (id === 'silvertongue') {
      for (const n of this.npcs.npcs) {
        if (n.alive && !n.downed && n.kind !== 'crew' && dist(n.pos, this.player.feet) < 12) n.suspicion = Math.max(0, n.suspicion - 25 * dt);
      }
    }
    if (id === 'adrenaline') this.player.stats.damageTakenMult = this.stats.damageTakenMult * 0.4;
    else this.player.stats.damageTakenMult = this.stats.damageTakenMult;
    if (id === 'overclock') this.interact.speedMult = 2.5 / Math.max(0.1, this.stats.interactSpeedMult);
    else this.interact.speedMult = 1 / Math.max(0.1, this.stats.interactSpeedMult);
    if (id === 'tacscan') {
      // Mastermind: crew hit harder while the scan is up
    }
  }

  private buildSnapshot(): PlayerSnapshot {
    const roomTags = this.currentRoomTags();
    const lightLevel = this.currentLight();
    const vis = playerVisibility({
      stance: this.player.stance, moving: this.player.moving, sprinting: this.player.sprinting,
      visibilityMult: this.stats.visibilityMult * (this.abilityActive && this.classDef.id === 'ghost' ? 0.9 : 1),
      lightLevel, vanish: this.player.vanish,
    });
    const d = this.disguise;
    return {
      alive: !this.player.dead,
      downed: this.player.downed,
      feet: this.player.feet,
      eye: this.player.eyePos({ x: 0, y: 0, z: 0 }),
      moving: this.player.moving,
      sprinting: this.player.sprinting,
      stance: this.player.stance,
      weaponDrawn: true,
      lastShotT: this.lastShotT,
      visibility: vis,
      lightLevel,
      roomId: this.lastRoomId,
      roomTags,
      disguiseWorn: d.id !== 'none',
      disguiseSuspicionMult: d.suspicionMult,
      disguisePlausible: d.plausibleIn.some((t) => roomTags.includes(t)),
      disguiseAccepted: d.acceptedBy as Array<'guard' | 'civilian' | 'police'>,
      suspicionResist: this.stats.suspicionResist,
      hidden: !!this.hideSpot,
      vanish: this.player.vanish,
    };
  }

  private currentRoomTags(): string[] {
    const p = this.player.feet;
    const room = this.level.level.rooms.find((r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1);
    return room?.tags ?? ['outside'];
  }
  private currentLight(): number {
    const p = this.player.feet;
    const room = this.level.level.rooms.find((r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1);
    return room?.lightLevel ?? 0.6;
  }

  private updateCameras(dt: number): void {
    const disabled = this.time < this.cameraDisabledUntil || this.time < this.empUntil;
    const p = this.player.eyePos({ x: 0, y: 0, z: 0 });
    for (const c of this.level.cameras) {
      const sweep = c.def.sweepArc > 0 ? Math.sin(this.time * c.def.sweepSpeed) * c.def.sweepArc / 2 : 0;
      c.yaw = c.def.yaw + sweep;
      c.group.rotation.y = c.yaw;
      const mat = c.cone.material as THREE.MeshBasicMaterial;
      if (disabled) { mat.color.setHex(0x40a0ff); mat.opacity = 0.03; (c.lens.material as THREE.MeshBasicMaterial).color.setHex(0x335577); continue; }
      mat.color.setHex(0xff4040);
      (c.lens.material as THREE.MeshBasicMaterial).color.setHex(0xff3030);
      // detection by camera: range + cone + LOS, only when the player is actually in view
      const cx = c.def.position.x, cy = c.def.position.y, cz = c.def.position.z;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d = Math.hypot(dx, dy, dz);
      if (d > c.def.range) { mat.opacity = 0.07; c.alertLevel = Math.max(0, c.alertLevel - dt); continue; }
      const fwdX = Math.sin(c.yaw), fwdZ = Math.cos(c.yaw);
      const cos = (dx * fwdX + dz * fwdZ) / Math.max(1e-4, Math.hypot(dx, dz));
      const inCone = cos > Math.cos(c.def.fov / 2);
      if (!inCone) { mat.opacity = 0.07; c.alertLevel = Math.max(0, c.alertLevel - dt); continue; }
      const los = this.level.physics.hasLineOfSight({ x: cx, y: cy, z: cz }, p);
      if (!los) { mat.opacity = 0.07; c.alertLevel = Math.max(0, c.alertLevel - dt); continue; }
      const vis = playerVisibility({ stance: this.player.stance, moving: this.player.moving, sprinting: this.player.sprinting, visibilityMult: this.stats.visibilityMult, lightLevel: this.currentLight(), vanish: this.player.vanish });
      const gain = (1.1 / Math.max(0.3, vis)) * dt * (1 - d / c.def.range * 0.5);
      c.alertLevel = Math.min(1.5, c.alertLevel + gain);
      mat.opacity = 0.07 + Math.min(0.3, c.alertLevel * 0.25);
      if (c.alertLevel >= 1) {
        // camera spotted the player: raise suspicion (and eventually the alarm)
        this.bus.emit('camera:spotted', { cameraId: c.def.id, position: { x: cx, y: cy, z: cz } });
        this.rt.stats.detectionPeak = Math.max(this.rt.stats.detectionPeak, 60);
        this.alarm.raise(1, `${c.def.label} spotted you`);
        c.alertLevel = 0.2;
      }
    }
  }

  private updateViewmodel(dt: number, aiming: boolean): void {
    // ADS position + bob + sway + recoil
    const ads = this.weapons.adsT;
    const bobT = this.time * (this.player.sprinting ? 10 : 7);
    const bob = this.player.moving && this.player.grounded ? 1 : 0;
    const baseX = 0.2 + (0.2 * -1 + 0.2) * ads * 0 - 0.13 * ads;
    const baseY = -0.2 + 0.07 * ads;
    const baseZ = -0.42 + 0.05 * ads;
    const reload = this.weapons.reloadProgress;
    const reloadDip = reload > 0 ? Math.sin(reload * Math.PI) * 0.12 : 0;
    const swap = this.weapons.swapping > 0 ? this.weapons.swapping * 0.5 : 0;
    this.viewmodel.position.set(
      baseX + Math.cos(bobT * 0.5) * 0.012 * bob + this.player.swayX * 0.6,
      baseY + Math.abs(Math.sin(bobT)) * -0.012 * bob - reloadDip - swap + this.player.swayY * 0.6,
      baseZ,
    );
    const w = this.weapons.current;
    this.vmKick = Math.max(0, this.vmKick - dt * 8);
    if (w && w.kickPitch > 0) { this.vmKick = Math.min(1, this.vmKick + 0.4); w.kickPitch = Math.max(0, w.kickPitch - 60 * dt); }
    this.viewmodel.rotation.set(-this.vmKick * 0.12 + (reload > 0 ? -0.2 * Math.sin(reload * Math.PI) : 0), 0, 0);
    void aiming;
  }

  private refreshViewmodel(): void {
    for (let i = this.viewmodel.children.length - 1; i >= 0; i--) this.viewmodel.remove(this.viewmodel.children[i]);
    const w = this.weapons.current;
    const vm = buildViewmodel(w?.def ?? null);
    this.viewmodel.add(vm);
  }

  private refreshAmmoHud(): void {
    const w = this.weapons.current;
    if (!w) return;
    this.deps.hud.setAmmo(w.def.name, w.mag, w.reserve, w.def.magazine <= 0);
  }

  /** Called by the app before starting the mission. */
  start(): void {
    this.startT = this.time;
    this.refreshAmmoHud();
    this.deps.hud.setWeaponActive(this.weapons.active);
    this.deps.hud.toast('Infiltration begins. Stay sharp.', 'info');
    this.deps.audio.setAmbient(0);
    this.rt.setPhase('active');
    this.bus.emit('mission:phase', { phase: 'active' });
  }

  /** Keeps the NPC level state fresh after spawning visuals. */
  get npcVisualsPending(): number { return this.npcs.pendingVisuals; }

  get avgFrameMs(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  get interactLabel(): string { return this.interact.info.label; }

  setUiBlocked(v: boolean): void { this.uiBlocked = v; }

  /** Gives the app the active camera and modifiers for rendering. */
  get camera(): THREE.PerspectiveCamera { return this.player.camera; }

  /** Pause: freezes simulation. */
  setPaused(p: boolean): void { this.paused = p; if (p) this.deps.audio.setAmbient(-1); }

  /** Shows a HUD toast (used by mission definitions). */
  toast(text: string, kind: 'info' | 'warn' | 'success' | 'objective' = 'info'): void {
    this.deps.hud.toast(text, kind);
  }

  /** How many of the given loot ids have been collected. */
  collectedCount(ids: string[]): number {
    return ids.filter((id) => this.level.loot.get(id)?.collected).length;
  }

  /** Map helper: loot markers (visible & not yet taken). */
  lootMarkers(): Array<{ pos: Vec3; collected: boolean; visible: boolean; optional: boolean }> {
    return Array.from(this.level.loot.values()).map((l) => ({ pos: l.def.position, collected: l.collected, visible: l.mesh.visible, optional: l.def.optional }));
  }

  /** Map helper: true when the player's tools reveal NPCs and devices. */
  get revealActive(): boolean {
    return this.time < this.scanUntil || (this.abilityActive && this.classDef.ability.id === 'tacscan');
  }

  get escapeSpawnPos(): Vec3 | null {
    return this.escapeSpawn ? this.escapeSpawn.position : null;
  }

  weaponSlotInfo(): Array<{ label: string; value: string }> {
    return this.weapons.slots.map((s, i) => ({
      label: ['Primary', 'Sidearm', 'Melee'][i],
      value: s ? `${s.def.name} — ${s.def.magazine > 0 ? `${s.mag} / ${s.reserve}` : 'melee'}` : 'None',
    }));
  }

  gadgetLeft(id: GadgetId): number {
    return this.gadgetCount(id);
  }

  get lootTotalValue(): number { return this.lootTotal; }

  /** Debug/QA snapshot consumed by the debug overlay and tests. */
  debugInfo(): Record<string, unknown> {
    return {
      time: +this.time.toFixed(1),
      phase: this.rt.phase,
      alarm: this.alarm.level,
      npcs: this.npcs.npcs.length,
      alive: this.npcs.npcs.filter((n) => n.alive).length,
      states: this.npcs.npcs.reduce<Record<string, number>>((acc, n) => { acc[n.state] = (acc[n.state] ?? 0) + 1; return acc; }, {}),
      room: this.lastRoomId,
      extraction: this.extraction.state,
      frameMs: +this.avgFrameMs.toFixed(2),
      pendingVisuals: this.npcVisualsPending,
    };
  }

  /** Dispose everything created for this mission. */
  dispose(): void {
    this.interact.clear();
    this.npcs.clear();
    this.effects.dispose();
    this.level.dispose();
    this.deps.scene.remove(this.player.camera);
    this.deps.audio.alarm(false);
    this.deps.audio.setAmbient(-1);
    cancelHack('Mission closed');
  }
}

export type { MissionModifier, CrewState };
