/**
 * The six starting classes. Every field has a real gameplay effect:
 *  - statMods feed PlayerStats aggregation
 *  - loadout spawns into the mission inventory
 *  - ability is the signature active (key X)
 */
import type { ClassId } from '../core/types';
import type { ArmorId, DisguiseId, GadgetId } from './gadgets';

export interface StatMods {
  healthMult: number;
  armorMult: number;
  moveSpeedMult: number;
  noiseMult: number;            // global movement noise multiplier
  suspicionResist: number;      // 0..1 reduction of suspicion accrual in fitting contexts
  interactSpeedMult: number;    // lockpicks/hacking/drilling/etc
  hackSpeedMult: number;
  weaponHandlingMult: number;   // recoil + spread reduction (1 = none, 0.8 = 20% better)
  reloadSpeedMult: number;
  staminaMult: number;
  /** Which trees get discounted skill costs (0.8 = 20% cheaper). */
  treeAffinity: Partial<Record<string, number>>;
}

export const NEUTRAL_STATS: StatMods = {
  healthMult: 1, armorMult: 1, moveSpeedMult: 1, noiseMult: 1, suspicionResist: 0,
  interactSpeedMult: 1, hackSpeedMult: 1, weaponHandlingMult: 1, reloadSpeedMult: 1,
  staminaMult: 1, treeAffinity: {},
};

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  duration: number;   // seconds active (0 = instant)
  cooldown: number;   // seconds
}

export interface ClassDef {
  id: ClassId;
  name: string;
  tagline: string;
  description: string;
  strengths: string[];
  tradeoffs: string[];
  stats: StatMods;
  loadout: {
    primary: string;         // weapon id
    secondary: string;
    melee: string;
    armor: ArmorId;
    gadgets: GadgetId[];     // up to two equipable + extras owned
    throwables: GadgetId[];
    startingDisguise: DisguiseId;
  };
  ability: AbilityDef;
  /** Passive bonuses shown on the class screen (descriptive, derived from stats). */
  passives: string[];
  accentColor: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  loud: {
    id: 'loud',
    name: 'ENFORCER',
    tagline: 'LOUD SPECIALIST',
    description: 'When subtlety expires, the Enforcer cashes out. Superior weapon handling, heavier armour tolerance and a combat stim that turns a bad hallway into your hallway.',
    strengths: ['Best-in-class recoil control and reload speed', 'Starts armoured with an automatic primary', 'Adrenaline ability shrugs off damage while it burns'],
    tradeoffs: ['Heavy kit moves slower and sounds louder', 'Social situations start from a deficit', 'No technical tools'],
    stats: { ...NEUTRAL_STATS, healthMult: 1.15, armorMult: 1.2, weaponHandlingMult: 0.78, reloadSpeedMult: 0.82, moveSpeedMult: 0.96, noiseMult: 1.15, staminaMult: 1.1, treeAffinity: { combat: 0.75 } },
    loadout: { primary: 'rifle_sentinel', secondary: 'pistol_m9', melee: 'melee_knife', armor: 'combat', gadgets: ['medkit', 'ammobox'], throwables: ['stun_grenade'], startingDisguise: 'none' },
    ability: { id: 'adrenaline', name: 'Adrenaline Surge', duration: 8, cooldown: 55,
      description: 'For 8 seconds: 60% damage resistance, 25% faster fire rate, instant reload start bonus. The world narrows; the gun gets steady.' },
    passives: ['Iron Nerves: 22% less weapon sway and bloom', 'Thick Skin: armour absorbs 20% more before failing', 'Heavy Lungs: +10% stamina and slower sprint decay'],
    accentColor: '#ff5533',
  },
  ghost: {
    id: 'ghost',
    name: 'GHOST',
    tagline: 'STEALTH SPECIALIST',
    description: 'You were never here. The Ghost moves quieter, is harder to spot in dim light, works locks faster and can all but vanish from casual observers for a few precious seconds.',
    strengths: ['Near-silent movement when crouched and walking', 'Faster lockpicks, takedowns and body-hiding', 'Vanish ability defuses a about-to-blow cover situation'],
    tradeoffs: ['Light armour — a fair fight is a losing fight', 'Weak starting firepower', 'Loud plans suffer without purchased upgrades'],
    stats: { ...NEUTRAL_STATS, healthMult: 0.9, armorMult: 0.75, noiseMult: 0.6, suspicionResist: 0.25, interactSpeedMult: 0.75, moveSpeedMult: 1.02, staminaMult: 1.15, treeAffinity: { stealth: 0.7 } },
    loadout: { primary: 'smg_kobra', secondary: 'pistol_whisper', melee: 'melee_knife', armor: 'light', gadgets: ['lockpick', 'noise_maker'], throwables: ['noise_maker'], startingDisguise: 'civilian' },
    ability: { id: 'vanish', name: 'Vanish', duration: 6, cooldown: 45,
      description: 'For 6 seconds your visibility to unaware and merely-curious NPCs drops by 65% and your footsteps fall silent. Does not fool NPCs already in combat with you.' },
    passives: ['Soft Steps: 40% less movement noise, 70% less while crouch-walking', 'Shadowcraft: NPCs need 25% closer range or better light to spot you', 'Quick Hands: locks, pockets and takedowns 25% faster'],
    accentColor: '#7bd4ff',
  },
  hacker: {
    id: 'hacker',
    name: 'SPECTRE',
    tagline: 'HACKER',
    description: 'Cameras are eyes you can close. Locks are suggestions. The Spectre lives in the building\'s wiring — faster hacks, deeper device access, and an EMP-flavoured ace for when the network needs a hard reset.',
    strengths: ['Fastest hacking with fewer minigame hazards', 'Can access advanced devices others cannot touch', 'System Surge reveals and disables electronics in a pulse'],
    tradeoffs: ['Weakest combat stats and armour', 'Many hacks need proximity and uninterrupted time', 'Social bluffing is not your language'],
    stats: { ...NEUTRAL_STATS, healthMult: 0.9, armorMult: 0.8, hackSpeedMult: 0.6, interactSpeedMult: 0.85, weaponHandlingMult: 1.05, treeAffinity: { hacking: 0.65, engineering: 0.85 } },
    loadout: { primary: 'smg_vector9', secondary: 'pistol_compact45', melee: 'melee_knife', armor: 'light', gadgets: ['scanner', 'emp_charge'], throwables: ['noise_maker'], startingDisguise: 'civilian' },
    ability: { id: 'surge', name: 'System Surge', duration: 0, cooldown: 60,
      description: 'Instantly: disables all cameras within 18m for 20s, reveals every electronic device on your tactical map, and adds a burst of progress to any active hack.' },
    passives: ['Backdoor: hacking minigames run 40% faster with one free retry', 'Deep Scan: electronics within 12m are passively highlighted', 'Cold Boot: failed hacks raise 30% less suspicion'],
    accentColor: '#4dffa6',
  },
  mastermind: {
    id: 'mastermind',
    name: 'ARCHITECT',
    tagline: 'MASTERMIND',
    description: 'The job was won before the van parked. The Architect sees more of the building during planning, gets cheaper intel, issues more crew commands — and can pull the whole tactical picture into focus mid-job.',
    strengths: ['Planning reveals extra entry points and objectives', 'Crew fight harder, hack faster and follow orders better', 'Tactical Scan outlines every NPC through walls'],
    tradeoffs: ['Mediocre personal combat stats', 'Relies on preparation and crew to shine', 'No technical or stealth shortcuts of their own'],
    stats: { ...NEUTRAL_STATS, healthMult: 1.0, armorMult: 1.0, interactSpeedMult: 0.95, weaponHandlingMult: 0.95, treeAffinity: { leadership: 0.6, social: 0.85 } },
    loadout: { primary: 'rifle_sentinel', secondary: 'pistol_m9', melee: 'melee_knife', armor: 'medium', gadgets: ['scanner', 'medkit'], throwables: ['stun_grenade'], startingDisguise: 'bank_staff' },
    ability: { id: 'tacscan', name: 'Tactical Scan', duration: 10, cooldown: 50,
      description: 'For 10 seconds every NPC is outlined through walls with their alert state and facing, loot glows, and your crew deal 15% more damage.' },
    passives: ['Contingencies: one extra planning option slot and 25% cheaper intel', 'Authority: crew accuracy and hack speed +15%, crew take 10% less damage', 'Reading the Room: +1 contextual crew command per mission'],
    accentColor: '#ffc94d',
  },
  conartist: {
    id: 'conartist',
    name: 'FACE',
    tagline: 'CON ARTIST',
    description: 'The best lock is a smile. The Face wears disguises better, talks down suspicion, and can reroute a whole room\'s attention with a well-placed lie — but only where the lie fits.',
    strengths: ['Disguises hold up longer and in more places', 'Social interactions unlock routes others never see', 'Silver Tongue resets simmering suspicion around you'],
    tradeoffs: ['A drawn weapon in public ruins everything fast', 'Weakest armour and weapon stats', 'Restricted vaults still need keys, codes or crowbars'],
    stats: { ...NEUTRAL_STATS, healthMult: 0.95, armorMult: 0.85, suspicionResist: 0.45, interactSpeedMult: 0.9, weaponHandlingMult: 1.08, treeAffinity: { social: 0.6, stealth: 0.9 } },
    loadout: { primary: 'shotgun_short', secondary: 'pistol_compact45', melee: 'melee_knife', armor: 'light', gadgets: ['disguise_kit', 'keycard_cloner'], throwables: ['noise_maker'], startingDisguise: 'bank_staff' },
    ability: { id: 'silvertongue', name: 'Silver Tongue', duration: 10, cooldown: 50,
      description: 'For 10 seconds: nearby curious/suspicious NPCs relax back to unaware, disguise checks pass one tier higher, and you can run one "talk down" interaction even mid-suspicion.' },
    passives: ['Believable: disguise suspicion accrual halved; visible-weapon penalty delayed by 2s', 'Fast Talker: extra social dialogue options with staff and guards', 'Wardrobe: start each job with one free compatible disguise'],
    accentColor: '#ff7bdb',
  },
  engineer: {
    id: 'engineer',
    name: 'TINKER',
    tagline: 'ENGINEER',
    description: 'Every building is a machine, and machines have service hatches. The Tinker repairs, rewires, drills faster and opens routes that do not appear on any floor plan.',
    strengths: ['Fastest drilling, repairs and mechanical interactions', 'Can power alternate routes (elevators, service doors, vents)', 'Overclock ability makes every timed interaction frantic-cheap'],
    tradeoffs: ['No stealth or social grace built in', 'Average gun handling', 'Some routes still need muscle or codes'],
    stats: { ...NEUTRAL_STATS, healthMult: 1.05, armorMult: 1.0, interactSpeedMult: 0.6, hackSpeedMult: 0.85, noiseMult: 1.05, treeAffinity: { engineering: 0.6, hacking: 0.9 } },
    loadout: { primary: 'shotgun_breaker', secondary: 'pistol_m9', melee: 'melee_bat', armor: 'medium', gadgets: ['repair_kit', 'lockpick'], throwables: ['stun_grenade'], startingDisguise: 'maintenance' },
    ability: { id: 'overclock', name: 'Overclock', duration: 8, cooldown: 50,
      description: 'For 8 seconds all interactions, drilling and repairs run 2.5x faster, and your deployed equipment (barricades, ammo cases) refreshes one use.' },
    passives: ['Grease Monkey: drills and repairs 40% faster, machines jam half as often', 'Service Routes: can open maintenance paths others cannot', 'Steady Grip: recoil climb reduced 15% on shotguns and LMGs'],
    accentColor: '#c8ff4d',
  },
};

export const CLASS_LIST: ClassDef[] = [
  CLASSES.loud, CLASSES.ghost, CLASSES.hacker,
  CLASSES.mastermind, CLASSES.conartist, CLASSES.engineer,
];

export const ABILITY_DEFS: Record<string, AbilityDef> = Object.fromEntries(
  Object.values(CLASSES).map((c) => [c.ability.id, c.ability]),
);
