/**
 * Campaign state: everything that persists between missions.
 * Pure data + pure functions so it can be unit tested without a browser.
 */
import { SAVE_VERSION } from '../save/save';
import type { ClassId, Difficulty, ApproachId } from '../core/types';
import { WEAPONS, ATTACHMENTS, type AttachmentDef } from '../config/weapons';
import { ARMORS, GADGETS, DISGUISES, type ArmorId, type GadgetId, type DisguiseId } from '../config/gadgets';
import { CREW_BY_ID, type CrewDef } from '../config/crew';
import { SKILL_BY_ID, SKILLS, XP_TABLE, MAX_LEVEL, SKILL_POINTS_PER_LEVEL, type SkillNode } from '../config/skills';
import { CLASSES } from '../config/classes';

export type AmmoType = 'standard' | 'hollow' | 'ap';

export const AMMO_TYPES: Record<AmmoType, { name: string; description: string; damageMult: number; penetrationAdd: number; headMult: number; price: number }> = {
  standard: { name: 'Standard', description: 'Reliable baseline ammunition.', damageMult: 1, penetrationAdd: 0, headMult: 1, price: 0 },
  hollow: { name: 'Hollow Point', description: '+25% damage to unarmoured targets; poor penetration.', damageMult: 1.25, penetrationAdd: -0.2, headMult: 1.1, price: 600 },
  ap: { name: 'Armour Piercing', description: 'Ignores more armour; −15% damage.', damageMult: 0.85, penetrationAdd: 0.3, headMult: 1, price: 900 },
};

export interface Loadout {
  name: string;
  primary: string;
  secondary: string;
  melee: string;
  armor: ArmorId;
  gadgets: [GadgetId | null, GadgetId | null];
  throwable: GadgetId | null;
  disguise: DisguiseId;
  attachments: Record<string, string[]>;   // weaponId -> attachment ids
  ammo: AmmoType;
}

export interface PlanChoices {
  entry: 'front' | 'staff' | 'service';
  escape: 'van_street' | 'alley_car' | 'service_tunnel';
  disguise: DisguiseId;
  crew: string[];          // crew ids (max = crewSlots)
  intel: string[];         // intel ids
  optionalLoot: boolean;
  approach: ApproachId | 'auto';
  startLocation: 'street' | 'alley';
  difficulty: Difficulty;
  support: 'none' | 'drone_scan' | 'insider_tip';
}

export interface MissionRecord {
  missionId: string;
  classId: ClassId;
  result: 'success' | 'failed';
  payout: number;
  xp: number;
  rep: number;
  date: string;
  approach: string;
  detection: number;
  difficulty: Difficulty;
}

export interface CampaignState {
  version: number;
  started: boolean;
  classId: ClassId | null;
  money: number;
  reputation: number;
  xp: number;
  level: number;
  skillPoints: number;
  skills: string[];
  ownedWeapons: string[];
  ownedAttachments: string[];
  ownedArmor: ArmorId[];
  ownedGadgets: GadgetId[];
  ownedDisguises: DisguiseId[];
  ownedAmmo: AmmoType[];
  crewHired: string[];
  crewTier: Record<string, number>;
  completedMissions: string[];
  history: MissionRecord[];
  loadout: Loadout;
  savedLoadouts: Loadout[];
  plan: PlanChoices;
  intelPurchased: string[];
  stats: { missionsRun: number; missionsWon: number; shotsFired: number; kills: number; civiliansHurt: number; hacks: number; totalLoot: number };
  /** Unlocked contract ids. */
  unlockedContracts: string[];
}

export function defaultLoadout(classId: ClassId | null): Loadout {
  const c = (classId && CLASSES[classId]) ? CLASSES[classId] : CLASSES.loud;
  return {
    name: 'Standard',
    primary: c.loadout.primary,
    secondary: c.loadout.secondary,
    melee: c.loadout.melee,
    armor: c.loadout.armor,
    gadgets: [c.loadout.gadgets[0] ?? null, c.loadout.gadgets[1] ?? null],
    throwable: c.loadout.throwables[0] ?? null,
    disguise: c.loadout.startingDisguise,
    attachments: {},
    ammo: 'standard',
  };
}

export function defaultPlan(): PlanChoices {
  return {
    entry: 'front', escape: 'van_street', disguise: 'none', crew: [], intel: [],
    optionalLoot: true, approach: 'auto', startLocation: 'street', difficulty: 'normal', support: 'none',
  };
}

export function newCampaign(): CampaignState {
  return {
    version: SAVE_VERSION,
    started: false,
    classId: null,
    money: 2500,
    reputation: 0,
    xp: 0,
    level: 1,
    skillPoints: 0,
    skills: [],
    ownedWeapons: ['pistol_m9', 'melee_knife'],
    ownedAttachments: [],
    ownedArmor: ['none', 'light'],
    ownedGadgets: ['medkit', 'ammobox', 'lockpick', 'noise_maker', 'stun_grenade', 'scanner', 'emp_charge', 'repair_kit', 'disguise_kit'],
    ownedDisguises: ['none', 'civilian', 'bank_staff', 'maintenance'],
    ownedAmmo: ['standard'],
    crewHired: [],
    crewTier: {},
    completedMissions: [],
    history: [],
    loadout: defaultLoadout(null),
    savedLoadouts: [],
    plan: defaultPlan(),
    intelPurchased: [],
    stats: { missionsRun: 0, missionsWon: 0, shotsFired: 0, kills: 0, civiliansHurt: 0, hacks: 0, totalLoot: 0 },
    unlockedContracts: ['bank_central'],
  };
}

/** Lightweight shape check so corrupted-but-parseable saves do not crash the UI. */
export function sanitizeCampaign(raw: Record<string, unknown>): CampaignState {
  const base = newCampaign();
  const classId = typeof raw.classId === 'string' && raw.classId in CLASSES ? (raw.classId as ClassId) : null;
  const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const s: CampaignState = {
    ...base,
    started: raw.started === true,
    classId,
    money: Math.max(0, Math.floor(num(raw.money, base.money))),
    reputation: Math.max(0, Math.floor(num(raw.reputation, 0))),
    xp: Math.max(0, Math.floor(num(raw.xp, 0))),
    level: Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(raw.level, 1)))),
    skillPoints: Math.max(0, Math.floor(num(raw.skillPoints, 0))),
    skills: arr<string>(raw.skills, []).filter((id) => id in SKILL_BY_ID),
    ownedWeapons: arr<string>(raw.ownedWeapons, base.ownedWeapons).filter((id) => id in WEAPONS),
    ownedAttachments: arr<string>(raw.ownedAttachments, []).filter((id) => id in ATTACHMENTS),
    ownedArmor: arr<ArmorId>(raw.ownedArmor, base.ownedArmor).filter((id) => id in ARMORS),
    ownedGadgets: arr<GadgetId>(raw.ownedGadgets, base.ownedGadgets).filter((id) => id in GADGETS),
    ownedDisguises: arr<DisguiseId>(raw.ownedDisguises, base.ownedDisguises).filter((id) => id in DISGUISES),
    ownedAmmo: arr<AmmoType>(raw.ownedAmmo, ['standard']).filter((id) => id in AMMO_TYPES),
    crewHired: arr<string>(raw.crewHired, []).filter((id) => id in CREW_BY_ID),
    crewTier: typeof raw.crewTier === 'object' && raw.crewTier ? (raw.crewTier as Record<string, number>) : {},
    completedMissions: arr<string>(raw.completedMissions, []),
    history: arr<MissionRecord>(raw.history, []).slice(-100),
    loadout: sanitizeLoadout(raw.loadout, classId),
    savedLoadouts: arr<Loadout>(raw.savedLoadouts, []).slice(0, 8).map((l) => sanitizeLoadout(l, classId)),
    plan: { ...defaultPlan(), ...(typeof raw.plan === 'object' && raw.plan ? (raw.plan as Partial<PlanChoices>) : {}) },
    intelPurchased: arr<string>(raw.intelPurchased, []),
    stats: { ...base.stats, ...(typeof raw.stats === 'object' && raw.stats ? (raw.stats as object) : {}) },
    unlockedContracts: arr<string>(raw.unlockedContracts, ['bank_central']),
    version: SAVE_VERSION,
  };
  // Ensure skills remain consistent with level-based points (never negative).
  s.level = levelForXp(s.xp);
  return s;
}

function sanitizeLoadout(raw: unknown, classId: ClassId | null): Loadout {
  const fallback = defaultLoadout(classId);
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<Loadout>;
  const pick = <T extends string>(v: unknown, table: Record<string, unknown>, fb: T): T =>
    typeof v === 'string' && v in table ? (v as T) : fb;
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 24) : fallback.name,
    primary: pick(r.primary, WEAPONS, fallback.primary),
    secondary: pick(r.secondary, WEAPONS, fallback.secondary),
    melee: pick(r.melee, WEAPONS, fallback.melee),
    armor: pick<ArmorId>(r.armor, ARMORS, fallback.armor),
    gadgets: Array.isArray(r.gadgets)
      ? [pick<GadgetId>(r.gadgets[0] ?? null, GADGETS, '' as GadgetId) || null, pick<GadgetId>(r.gadgets[1] ?? null, GADGETS, '' as GadgetId) || null]
      : fallback.gadgets,
    throwable: r.throwable ? pick<GadgetId>(r.throwable, GADGETS, '' as GadgetId) || null : null,
    disguise: pick<DisguiseId>(r.disguise, DISGUISES, 'none'),
    attachments: typeof r.attachments === 'object' && r.attachments ? (r.attachments as Record<string, string[]>) : {},
    ammo: pick<AmmoType>(r.ammo, AMMO_TYPES, 'standard'),
  };
}

// ---------------------------------------------------------------------------
// XP / levels
// ---------------------------------------------------------------------------
export function levelForXp(xp: number): number {
  let lvl = 1;
  for (let i = 1; i < XP_TABLE.length; i++) if (xp >= XP_TABLE[i]) lvl = i + 1;
  return Math.min(MAX_LEVEL + 1, lvl);
}

/** Adds XP and skill points on level-up. Returns levels gained. */
export function addXp(state: CampaignState, amount: number): number {
  const before = levelForXp(state.xp);
  state.xp += Math.max(0, Math.round(amount));
  const after = Math.min(MAX_LEVEL + 1, levelForXp(state.xp));
  state.level = after;
  const gained = Math.max(0, after - before);
  state.skillPoints += gained * SKILL_POINTS_PER_LEVEL;
  return gained;
}

export function xpForNextLevel(state: CampaignState): { current: number; next: number | null } {
  const lvl = levelForXp(state.xp);
  if (lvl > MAX_LEVEL) return { current: state.xp, next: null };
  return { current: XP_TABLE[lvl - 1], next: XP_TABLE[lvl] };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
export function skillStatus(state: CampaignState, skill: SkillNode): { ok: boolean; reason?: string } {
  if (state.skills.includes(skill.id)) return { ok: false, reason: 'Already unlocked' };
  if (state.reputation < skill.repRequired) return { ok: false, reason: `Requires reputation ${skill.repRequired}` };
  const prereqs = SKILLS.filter((s) => s.tree === skill.tree && s.tier < skill.tier);
  const prevTier = prereqs.length ? Math.max(...prereqs.map((s) => s.tier)) : -1;
  const hasPrev = skill.tier === 0 || SKILLS.some((s) => s.tree === skill.tree && s.tier === skill.tier - 1 && state.skills.includes(s.id));
  if (skill.tier > 0 && !hasPrev) return { ok: false, reason: `Requires tier ${skill.tier - 1} in this tree (${prevTier >= 0 ? 'unlock earlier nodes first' : ''})` };
  if (state.skillPoints < skill.cost) return { ok: false, reason: `Needs ${skill.cost} skill point(s)` };
  return { ok: true };
}

export function unlockSkill(state: CampaignState, skillId: string): { ok: boolean; reason?: string } {
  const skill = SKILL_BY_ID[skillId];
  if (!skill) return { ok: false, reason: 'Unknown skill' };
  const st = skillStatus(state, skill);
  if (!st.ok) return st;
  state.skillPoints -= skill.cost;
  state.skills.push(skill.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------
export interface ShopItem {
  kind: 'weapon' | 'attachment' | 'armor' | 'gadget' | 'disguise' | 'ammo' | 'crew' | 'crew_upgrade' | 'intel';
  id: string;
  name: string;
  price: number;
  requiresRep: number;
  owned: boolean;
  description: string;
}

export function purchase(state: CampaignState, item: ShopItem): { ok: boolean; reason?: string } {
  if (item.owned) return { ok: false, reason: 'Already owned' };
  if (state.reputation < item.requiresRep) return { ok: false, reason: `Requires reputation ${item.requiresRep}` };
  if (state.money < item.price) return { ok: false, reason: 'Not enough money' };
  state.money -= item.price;
  switch (item.kind) {
    case 'weapon': state.ownedWeapons.push(item.id); break;
    case 'attachment': state.ownedAttachments.push(item.id); break;
    case 'armor': state.ownedArmor.push(item.id as ArmorId); break;
    case 'gadget': state.ownedGadgets.push(item.id as GadgetId); break;
    case 'disguise': state.ownedDisguises.push(item.id as DisguiseId); break;
    case 'ammo': state.ownedAmmo.push(item.id as AmmoType); break;
    case 'intel': state.intelPurchased.push(item.id); break;
    default: break;
  }
  return { ok: true };
}

export function crewHireCost(crew: CrewDef): number { return crew.hireCost; }

export function hireCrew(state: CampaignState, crew: CrewDef): { ok: boolean; reason?: string } {
  if (state.crewHired.includes(crew.id)) return { ok: false, reason: 'Already on your crew' };
  if (state.reputation < crew.unlockRep) return { ok: false, reason: `Requires reputation ${crew.unlockRep}` };
  if (state.money < crew.hireCost) return { ok: false, reason: 'Not enough money' };
  state.money -= crew.hireCost;
  state.crewHired.push(crew.id);
  state.crewTier[crew.id] = 0;
  return { ok: true };
}

export function upgradeCrew(state: CampaignState, crew: CrewDef): { ok: boolean; reason?: string } {
  if (!state.crewHired.includes(crew.id)) return { ok: false, reason: 'Not hired' };
  const tier = state.crewTier[crew.id] ?? 0;
  if (tier >= crew.upgrades.length) return { ok: false, reason: 'Fully upgraded' };
  const cost = crew.upgrades[tier].cost;
  if (state.money < cost) return { ok: false, reason: 'Not enough money' };
  state.money -= cost;
  state.crewTier[crew.id] = tier + 1;
  return { ok: true };
}

export function crewSlots(state: CampaignState): number {
  return 2 + (state.skills.includes('l_professional') ? 1 : 0);
}

/** Attachment list valid for a weapon. */
export function attachmentsFor(weaponId: string): AttachmentDef[] {
  const w = WEAPONS[weaponId];
  if (!w) return [];
  return Object.values(ATTACHMENTS).filter((a) => w.slots.includes(a.slot) && (a.fits === '*' || a.fits.includes(weaponId)));
}

/** Validates a loadout against owned inventory and slot rules. Returns problems (empty = valid). */
export function validateLoadout(state: CampaignState, l: Loadout): string[] {
  const problems: string[] = [];
  const weapon = (id: string, kind: string): void => {
    if (!WEAPONS[id]) problems.push(`${kind} weapon missing`);
    else if (!state.ownedWeapons.includes(id)) problems.push(`${WEAPONS[id].name} is not owned`);
  };
  weapon(l.primary, 'Primary');
  weapon(l.secondary, 'Secondary');
  weapon(l.melee, 'Melee');
  if (WEAPONS[l.primary] && (WEAPONS[l.primary].category === 'melee' || WEAPONS[l.primary].size === 'compact')) {
    problems.push('Primary must be a long weapon (pistols and melee go in their own slots)');
  }
  if (WEAPONS[l.secondary] && WEAPONS[l.secondary].category !== 'melee' && WEAPONS[l.secondary].size === 'large') {
    problems.push('Secondary must be a sidearm');
  }
  if (WEAPONS[l.melee] && WEAPONS[l.melee].category !== 'melee') problems.push('Melee slot needs a melee weapon');
  if (!state.ownedArmor.includes(l.armor)) problems.push('Armour not owned');
  const gadgetCount = l.gadgets.filter(Boolean).length;
  if (gadgetCount > 2) problems.push('Only two gadget slots');
  for (const g of l.gadgets) if (g && !state.ownedGadgets.includes(g)) problems.push(`${GADGETS[g].name} not owned`);
  if (l.gadgets[0] && l.gadgets[0] === l.gadgets[1]) problems.push('Duplicate gadgets');
  if (l.throwable && !state.ownedGadgets.includes(l.throwable)) problems.push('Throwable not owned');
  if (l.throwable && GADGETS[l.throwable].kind !== 'throwable') problems.push('Throwable slot needs a throwable');
  if (!state.ownedDisguises.includes(l.disguise)) problems.push('Disguise not owned');
  if (!state.ownedAmmo.includes(l.ammo)) problems.push('Ammo type not owned');
  for (const [wid, atts] of Object.entries(l.attachments)) {
    const valid = attachmentsFor(wid).map((a) => a.id);
    const slots = new Set<string>();
    for (const a of atts) {
      if (!state.ownedAttachments.includes(a)) problems.push(`${ATTACHMENTS[a]?.name ?? a} not owned`);
      else if (!valid.includes(a)) problems.push(`${ATTACHMENTS[a]?.name ?? a} does not fit ${WEAPONS[wid]?.name ?? wid}`);
      const slot = ATTACHMENTS[a]?.slot;
      if (slot) {
        if (slots.has(slot)) problems.push(`Two ${slot} attachments on one weapon`);
        slots.add(slot);
      }
    }
  }
  return problems;
}

/** Ensures a loadout is valid by repairing it to owned defaults. Used before deployment. */
export function repairLoadout(state: CampaignState, l: Loadout): Loadout {
  const fixed: Loadout = { ...l, gadgets: [...l.gadgets] as [GadgetId | null, GadgetId | null], attachments: { ...l.attachments } };
  const isLong = (w: string) => !!WEAPONS[w] && WEAPONS[w].size !== 'compact' && WEAPONS[w].category !== 'melee';
  const isSidearm = (w: string) => !!WEAPONS[w] && WEAPONS[w].size === 'compact' && WEAPONS[w].category !== 'melee';
  const isMelee = (w: string) => !!WEAPONS[w] && WEAPONS[w].category === 'melee';
  if (!state.ownedWeapons.includes(fixed.primary) || !isLong(fixed.primary)) fixed.primary = state.ownedWeapons.find(isLong) ?? fixed.primary;
  if (!state.ownedWeapons.includes(fixed.secondary) || !isSidearm(fixed.secondary)) fixed.secondary = state.ownedWeapons.find(isSidearm) ?? fixed.secondary;
  if (!state.ownedWeapons.includes(fixed.melee) || !isMelee(fixed.melee)) fixed.melee = state.ownedWeapons.find(isMelee) ?? fixed.melee;
  if (!state.ownedArmor.includes(fixed.armor)) fixed.armor = 'none';
  fixed.gadgets = fixed.gadgets.map((g) => (g && state.ownedGadgets.includes(g) ? g : null)) as [GadgetId | null, GadgetId | null];
  if (fixed.gadgets[0] && fixed.gadgets[0] === fixed.gadgets[1]) fixed.gadgets[1] = null;
  if (fixed.throwable && !state.ownedGadgets.includes(fixed.throwable)) fixed.throwable = null;
  if (!state.ownedDisguises.includes(fixed.disguise)) fixed.disguise = 'none';
  if (!state.ownedAmmo.includes(fixed.ammo)) fixed.ammo = 'standard';
  const cleanAtts: Record<string, string[]> = {};
  for (const [wid, atts] of Object.entries(fixed.attachments)) {
    if (!state.ownedWeapons.includes(wid)) continue;
    const valid = attachmentsFor(wid).map((a) => a.id);
    const usedSlots = new Set<string>();
    const keep: string[] = [];
    for (const a of atts) {
      const slot = ATTACHMENTS[a]?.slot;
      if (!state.ownedAttachments.includes(a) || !valid.includes(a) || !slot || usedSlots.has(slot)) continue;
      usedSlots.add(slot);
      keep.push(a);
    }
    cleanAtts[wid] = keep;
  }
  fixed.attachments = cleanAtts;
  return fixed;
}

/** Grants a class's starting equipment into the campaign inventory (idempotent). */
export function grantClassStarter(state: CampaignState, classId: ClassId): void {
  const l = CLASSES[classId].loadout;
  const addOnce = <T>(list: T[], v: T) => { if (!list.includes(v)) list.push(v); };
  for (const w of [l.primary, l.secondary, l.melee]) addOnce(state.ownedWeapons, w);
  addOnce(state.ownedArmor, l.armor);
  for (const g of [...l.gadgets, ...l.throwables]) addOnce(state.ownedGadgets, g);
  addOnce(state.ownedDisguises, l.startingDisguise);
}
