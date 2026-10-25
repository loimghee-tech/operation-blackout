/**
 * OPERATION: BLACKOUT — mission 1: THE CENTRAL BANK.
 * Mission-specific data and rules. The framework (MissionWorld / MissionRuntime)
 * knows nothing about banks; everything bank-specific is in this file.
 */
import type { MissionDefinition, MissionEvent, MissionApi } from '../game/missionWorld';
import type { NpcSpec } from '../ai/npc';
import type { LevelData, WaypointDef } from '../world/level';
import type { PlanChoices } from '../progression/campaign';
import type { Rng } from '../core/rng';
import type { DifficultyConfig, MissionModifier } from '../config/balance';
import type { Vec3 } from '../core/types';
import { BANK_LEVEL } from './bankLevel';

const wpPos = (level: LevelData, id: string): Vec3 => {
  const w = level.waypoints.find((x: WaypointDef) => x.id === id);
  if (!w) throw new Error(`Missing waypoint ${id}`);
  return { ...w.position };
};

const pathPos = (level: LevelData, ids: string[]): Vec3[] => ids.map((i) => wpPos(level, i));

const SHIRTS = [0x3d4a5c, 0x5a3d3d, 0x2f5a46, 0x6a5a2a, 0x3a3a5c, 0x6a3a5a, 0x2a4a5a];
const PANTS = [0x2b2f36, 0x3a3328, 0x23272e, 0x2e2b3a];

function civilianSpec(id: string, pos: Vec3, wander: Vec3[], rng: Rng, model: string): NpcSpec {
  return {
    id, role: 'civilian', kind: 'civilian', faction: 'civilian', position: pos, yaw: rng.range(0, 6.28),
    access: ['public'], modelKey: model, modelFallbacks: ['Business_Female_02', 'Sports_Male_01'],
    appearance: { shirtColor: rng.pick(SHIRTS), pantsColor: rng.pick(PANTS), skinColor: rng.pick([0xc69c7b, 0x8d5e3c, 0xf0c8a8, 0xa87458]) },
    wander, skill: 1, hp: 60, armor: 0, viewDistance: 18, label: `Civilian ${id.slice(-2)}`,
  };
}

const GUARD_WEAPON = { name: 'Guard SMG', magSize: 30, mag: 30, reserve: 120, reloadTime: 2.4, fireInterval: 0.32, damage: 14, range: 36, accuracy: 0.42, burst: 2 };

export const BANK_DEFINITION: MissionDefinition = {
  id: 'central_bank',
  name: 'The Central Bank',
  subtitle: 'Downtown financial hub · 4 entry points · vault level 4',
  level: BANK_LEVEL,
  briefing: [
    'Target: the Central Bank vault on the ground floor. Inside: four gold bars on the vault shelving (the primary contract).',
    'Security: seven guards on rotation, staff with keycards, cameras covering the lobby, corridor and vault antechamber, a silent alarm that becomes a siren when someone is noticed.',
    'Entries: FRONT (public lobby — cameras and guards), STAFF (east corridor — needs staff access or a hack), SERVICE (north storage — lockpick, breaching charge or an engineer route).',
    'Vault: open it by hacking the vault relay (hard), asking the manager for an override (needs convincing credentials), drilling the wall (loud), or breaching the door (very loud).',
    'Extraction: the van on the street, the alley car, or the north service route. Gold first, then call extraction and hold the zone until it arrives.',
    'Optional: three teller tills, the manager safe, the cash cage, the alarm panel, the camera hub, and the manager override.',
  ],
  objectives: [
    { id: 'enter', text: 'Get inside the Central Bank' },
    { id: 'vault', text: 'Open the vault', prereq: ['enter'] },
    { id: 'gold', text: 'Secure the vault gold (0/4)', prereq: ['vault'] },
    { id: 'extract', text: 'Call extraction and hold the zone', prereq: ['gold'] },
    { id: 'opt_cash', text: 'Empty the teller tills (0/3)', optional: true },
    { id: 'opt_cage', text: 'Raid the cash cage', optional: true },
    { id: 'opt_alarm', text: 'Disable the alarm panel', optional: true, hidden: true },
    { id: 'opt_cams', text: 'Blackout the camera network', optional: true, hidden: true },
    { id: 'opt_manager', text: 'Get the vault override from the manager', optional: true, hidden: true },
  ],
  parTime: 900,
  primaryLootValue: 240000,
  escapeIds: ['van_street', 'alley_car', 'service_tunnel'],
  entryIds: ['front', 'staff', 'service'],
  vaultDoorId: 'd_vault',
  frontDoorId: 'd_front',
  alarmLockedDoors: () => ['d_corr_lobby', 'd_office_lobby', 'd_office_corr', 'd_antechamber', 'd_security', 'd_storage', 'd_staff', 'd_service', 'd_vault'],

  npcSpecs(ctx: { plan: PlanChoices; modifiers: MissionModifier[]; diff: DifficultyConfig; rng: Rng; civilianCount: number }): NpcSpec[] {
    const L = BANK_LEVEL;
    const rng = ctx.rng;
    const mods = new Set(ctx.modifiers.map((m) => m.id));
    const guardSkill = mods.has('veterans') ? 3 : 2;
    const specs: NpcSpec[] = [];
    const guardAccess = ['public', 'staff', 'security', 'service'];
    const guard = (id: string, label: string, patrol: Vec3[] | undefined, pause: number[] | undefined, pos: Vec3, yaw: number, post = false): NpcSpec => ({
      id, role: 'guard', kind: 'guard', faction: 'guard', position: pos, yaw, access: guardAccess,
      modelKey: id.includes('f') ? 'Security_Female_01' : 'Security_Male_01', modelFallbacks: ['Security_Male_01', 'Police_Male_01'],
      appearance: { shirtColor: 0x1b2433, pantsColor: 0x1d2330, vestColor: 0x25304a, cap: true },
      patrol, patrolPause: pause, post, weapon: GUARD_WEAPON, skill: guardSkill, hp: 110 * ctx.diff.enemyHealthMult, armor: 35, viewDistance: 24, label,
    });
    const lobbyPts = pathPos(L, ['L1', 'L2', 'L3', 'L4', 'L6']);
    specs.push(guard('guard_lobby_1', 'Guard Reyes', lobbyPts, [2, 1, 3, 1, 1], lobbyPts[0], 0));
    specs.push(guard('guard_lobby_2', 'Guard Hale', [...lobbyPts].reverse(), [1, 2, 1, 3, 1], lobbyPts[4], Math.PI));
    specs.push(guard('guard_corridor', 'Guard Ostrow', pathPos(L, ['C1', 'C2', 'C3', 'C4']), [2, 3, 2, 1], wpPos(L, 'C1'), 0));
    specs.push(guard('guard_antechamber', 'Guard Lim', pathPos(L, ['A1', 'A2', 'A3']), [3, 4, 2], wpPos(L, 'A1'), 0));
    specs.push(guard('guard_storage', 'Guard Dunn', pathPos(L, ['T1', 'T2', 'T3']), [2, 2, 3], wpPos(L, 'T1'), 0));
    specs.push(guard('guard_security_post', 'Guard Ruiz', undefined, undefined, wpPos(L, 'S1'), Math.PI, true));
    specs.push(guard('guard_office', 'Guard Kaur', pathPos(L, ['O1', 'O2', 'O3']), [5, 3, 2], wpPos(L, 'O1'), 0));
    specs.push({ ...guard('guard_exterior_f', 'Guard Fenn', pathPos(L, ['X1', 'X2']), [4, 4], wpPos(L, 'X1'), 0), access: ['public'], viewDistance: 16 });
    if (mods.has('extra_patrol')) {
      specs.push(guard('guard_extra_1', 'Guard Ibarra', [...lobbyPts].slice(1, 4), [1, 1, 1], lobbyPts[1], 0));
      specs.push(guard('guard_extra_2', 'Guard Quill', pathPos(L, ['C4', 'C3', 'C2', 'C1']), [1, 1, 1, 1], wpPos(L, 'C4'), 0));
    }

    // Staff
    const staff = (id: string, label: string, pos: Vec3, yaw: number, model: string): NpcSpec => ({
      id, role: 'bank_employee', kind: 'staff', faction: 'civilian', position: pos, yaw, access: ['public', 'staff'], modelKey: model,
      modelFallbacks: ['Business_Female_02'], appearance: { shirtColor: 0x7a2a2a, pantsColor: 0x2a2c33, skinColor: 0xc69c7b },
      post: true, skill: 1, hp: 60, armor: 0, viewDistance: 16, label,
    });
    specs.push(staff('teller_1', 'Teller Ng', wpPos(L, 'TEL1'), 0, 'Business_Female_02'));
    specs.push(staff('teller_2', 'Teller Osei', wpPos(L, 'TEL2'), 0, 'Business_Male_01'));
    specs.push(staff('teller_3', 'Teller Pryce', wpPos(L, 'TEL3'), 0, 'Business_Female_02'));
    specs.push(staff('receptionist', 'Receptionist Vale', wpPos(L, 'REC'), Math.PI, 'Business_Female_02'));
    specs.push({
      id: 'manager', role: 'manager', kind: 'manager', faction: 'civilian', position: wpPos(L, 'O2'), yaw: 0,
      access: ['public', 'staff', 'office', 'security'], modelKey: 'Business_Male_01', modelFallbacks: ['Business_Female_02'],
      appearance: { shirtColor: 0x2a3340, pantsColor: 0x1d2128, skinColor: 0xc69c7b },
      patrol: pathPos(L, ['O2', 'O3', 'O1']), patrolPause: [4, 3, 2], skill: 1, hp: 70, armor: 0, viewDistance: 16, label: 'Manager Halloran',
    });

    // Civilians
    const wander = ['CV1', 'CV2', 'CV3', 'CV4', 'CV5', 'CV6', 'L2', 'L3', 'L5', 'L7', 'L8'].map((i) => wpPos(L, i));
    const models = ['Business_Female_02', 'Sports_Male_01', 'Business_Male_01', 'Medical_Male_01'];
    let count = ctx.civilianCount;
    if (mods.has('quiet_day')) count = 3;
    if (mods.has('vip_day')) count += 3;
    const spawnIds = ['CV1', 'CV2', 'CV3', 'CV4', 'CV5', 'CV6', 'L8', 'L7', 'L5'];
    for (let i = 0; i < count; i++) {
      const pid = spawnIds[i % spawnIds.length];
      const base = wpPos(L, pid);
      const pos = { x: base.x + rng.range(-0.5, 0.5), y: 0, z: base.z + rng.range(-0.5, 0.5) };
      specs.push(civilianSpec(`civ_${i + 1}`, pos, wander, rng, models[i % models.length]));
    }
    return specs;
  },

  setup(api: MissionApi): void {
    void api;
  },

  onEvent(ev: MissionEvent, api: MissionApi): void {
    const rt = api.rt;
    const world = api.world;
    switch (ev.type) {
      case 'room': {
        if (!ev.tags.includes('outside') && !ev.tags.includes('street') && rt.isDone('enter') === false) {
          rt.complete('enter');
          world.toast('You are inside the Central Bank. Stay low, stay quiet, or stop being quiet.');
        }
        break;
      }
      case 'door': {
        if (ev.id === 'd_vault' && ev.open) rt.complete('vault');
        break;
      }
      case 'loot': {
        if (ev.kind === 'objective') {
          const n = world.collectedCount(['gold_1', 'gold_2', 'gold_3', 'gold_4']);
          rt.setProgress('gold', `Secure the vault gold (${n}/4)`);
          rt.objectives.get('gold')!.text = `Secure the vault gold (${n}/4)`;
          if (n >= 4) rt.complete('gold');
        }
        if (ev.id.startsWith('cash_till')) {
          const n = world.collectedCount(['cash_till_1', 'cash_till_2', 'cash_till_3']);
          rt.objectives.get('opt_cash')!.text = `Empty the teller tills (${n}/3)`;
          rt.setProgress('opt_cash', `${n}/3 tills`);
          if (n >= 3) rt.complete('opt_cash');
        }
        if (ev.id === 'cage_cash') rt.complete('opt_cage');
        break;
      }
      case 'extracted':
        rt.complete('extract');
        break;
      case 'device': {
        if (ev.kind === 'vault_control' && (ev.result === 'hacked' || ev.result === 'drilled')) rt.complete('vault');
        break;
      }
      default:
        break;
    }
  },
};

/** Contract catalogue entry (also used by the contract board). */
export interface ContractInfo {
  id: string;
  name: string;
  blurb: string;
  status: 'available' | 'locked';
  definition?: MissionDefinition;
  unlockNote?: string;
}

export const CONTRACTS: ContractInfo[] = [
  { id: 'bank_central', name: 'The Central Bank', blurb: 'The downtown bank with a vault that remembers every mistake. Four entries, one contract.', status: 'available', definition: BANK_DEFINITION },
  { id: 'jewel_store', name: 'Jewellery Quarter Store', blurb: 'Smash-and-grab with a mall full of witnesses.', status: 'locked', unlockNote: 'Future mission — not in this build' },
  { id: 'corporate_office', name: 'Corporate Office Tower', blurb: 'Multi-floor data theft. Needs floor-plan support.', status: 'locked', unlockNote: 'Future mission — not in this build' },
  { id: 'armoured_transport', name: 'Armoured Transport', blurb: 'A moving target on a timed schedule.', status: 'locked', unlockNote: 'Future mission — not in this build' },
];
