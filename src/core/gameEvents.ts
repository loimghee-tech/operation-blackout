/**
 * Central typed event map shared by every subsystem.
 * Emitted/consumed via core/events.ts EventBus.
 */
import type { AlertState, DamageZone, Difficulty, MissionPhase, Vec3 } from '../core/types';

export interface GameEvents {
  // ---- game flow ----
  'game:state-changed': { state: string; prev: string };
  'game:paused': { paused: boolean };

  // ---- player ----
  'player:health': { health: number; max: number };
  'player:armor': { armor: number; max: number };
  'player:downed': Record<string, never>;
  'player:revived': Record<string, never>;
  'player:dead': Record<string, never>;
  'player:stance': { stance: string };
  'player:stamina': { value: number; max: number };
  'player:moved': { position: Vec3; speed: number };
  'player:disguise': { disguise: string | null; blown: boolean };
  'player:ability': { id: string; active: boolean; cooldownLeft: number };
  'player:vault': Record<string, never>;

  // ---- weapons / combat ----
  'weapon:switched': { weaponId: string | null };
  'weapon:ammo': { weaponId: string; mag: number; reserve: number; magSize: number };
  'weapon:fired': { weaponId: string; position: Vec3; suppressed: boolean; noise: number };
  'weapon:reload-start': { weaponId: string; duration: number };
  'weapon:reload-end': { weaponId: string };
  'weapon:empty-click': { weaponId: string };
  'combat:hit': { zone: DamageZone; damage: number; killed: boolean; targetId: string; position: Vec3 };
  'combat:player-hit': { damage: number; fromId: string; direction: Vec3 };
  'combat:melee-takedown': { targetId: string; lethal: boolean };

  // ---- noise / perception ----
  'noise:emitted': { position: Vec3; radius: number; loudness: number; kind: string };
  'npc:spawned': { id: string };
  'npc:removed': { id: string };
  'npc:down': { id: string; byPlayer: boolean; faction: string };
  'npc:state-changed': { id: string; from: AlertState; to: AlertState };
  'npc:bark': { id: string; line: string; kind: 'speech' | 'radio' | 'shout'; position: Vec3 };
  'npc:radio-alert': { position: Vec3; level: number; faction: string };
  'npc:body-found': { id: string; byId: string; position: Vec3 };
  'npc:tied': { id: string };

  // ---- security / alarm ----
  'alarm:changed': { level: number; label: string };
  'camera:spotted': { cameraId: string; position: Vec3 };
  'camera:disabled': { cameraId: string; duration: number };
  'door:state': { doorId: string; open: boolean; locked: boolean };
  'security:device-state': { deviceId: string; kind: string; state: string };

  // ---- interaction / hacking ----
  'interaction:focus': { label: string | null; hold: number; key: string | null; usable: boolean };
  'interaction:progress': { label: string; progress: number };
  'interaction:done': { id: string; success: boolean };
  'hack:start': { deviceId: string; kind: string };
  'hack:success': { deviceId: string; kind: string };
  'hack:fail': { deviceId: string; kind: string; strikes: number };
  'hiding:entered': { spotId: string };
  'hiding:exited': { spotId: string };

  // ---- mission ----
  'mission:phase': { phase: MissionPhase };
  'mission:objective-added': { id: string; text: string; optional: boolean };
  'mission:objective-updated': { id: string; text: string; progress?: number };
  'mission:objective-completed': { id: string; text: string; optional: boolean };
  'mission:objective-failed': { id: string; text: string };
  'mission:timer': { secondsLeft: number };
  'mission:modifier': { text: string };
  'mission:success': Record<string, never>;
  'mission:failed': { reason: string };
  'loot:collected': { id: string; label: string; value: number; optional: boolean };
  'extraction:progress': { progress: number; label: string };
  'extraction:done': { location: string };
  'intel:revealed': { kind: string };

  // ---- crew ----
  'crew:command': { command: string; crewIds: string[] };
  'crew:status': { id: string; status: string; health: number };
  'crew:down': { id: string };
  'crew:revive-progress': { progress: number };

  // ---- UI ----
  'ui:toast': { text: string; kind?: 'info' | 'warn' | 'success' | 'objective'; duration?: number };
  'ui:subtitle': { speaker: string; text: string; duration?: number };
  'ui:suspicion': { value: number; label: string };
  'ui:detection-flash': { intensity: number };

  // ---- audio (positional requests routed through AudioManager) ----
  'audio:sfx': { name: string; position?: Vec3; volume?: number; surface?: string };
}

export type GameEventBus = import('./events').EventBus<GameEvents>;
