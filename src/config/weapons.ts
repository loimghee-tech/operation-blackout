/**
 * Weapon + attachment configuration tables.
 * All weapons are fictional. Stats drive the ballistics/damage pipeline.
 */

export type WeaponCategory =
  | 'pistol' | 'revolver' | 'smg' | 'rifle' | 'shotgun'
  | 'precision' | 'lmg' | 'melee' | 'nonlethal';

export type AmmoType = 'light' | 'heavy' | 'shell' | 'dart' | 'none';

export type AttachmentSlot = 'optic' | 'barrel' | 'magazine' | 'stock' | 'grip';

export interface AttachmentDef {
  id: string;
  name: string;
  slot: AttachmentSlot;
  description: string;
  price: number;
  /** Multiplicative/additive stat modifiers applied to WeaponStats. */
  modifiers: Partial<WeaponStatModifiers>;
  /** Weapons this attachment fits ('*' = all compatible by slot). */
  fits: string[] | '*';
  unlockRep?: number;
}

export interface WeaponStatModifiers {
  damageMult: number;
  spreadMult: number;       // hip + ads
  recoilMult: number;
  reloadMult: number;
  magAdd: number;
  adsTimeMult: number;
  moveSpeedMult: number;
  noiseMult: number;
  rangeMult: number;
  fireRateMult: number;
  penetrationAdd: number;
}

export const IDENTITY_MODS: WeaponStatModifiers = {
  damageMult: 1, spreadMult: 1, recoilMult: 1, reloadMult: 1, magAdd: 0,
  adsTimeMult: 1, moveSpeedMult: 1, noiseMult: 1, rangeMult: 1, fireRateMult: 1, penetrationAdd: 0,
};

export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
  description: string;
  damage: number;             // base damage per bullet (torso)
  headMult: number;
  limbMult: number;
  /** Damage falloff: full until range0, decays to minMult by range1 (metres). */
  range0: number;
  range1: number;
  minDamageMult: number;
  fireRate: number;           // rounds per minute
  automatic: boolean;
  magazine: number;
  reserveMax: number;
  reloadTime: number;         // seconds
  /** Recoil: vertical kick (deg) and horizontal jitter (deg) per shot; recovery deg/s. */
  recoilVertical: number;
  recoilHorizontal: number;
  recoilRecovery: number;
  /** Spread (deg) hip / ads, plus bloom per shot and decay. */
  spreadHip: number;
  spreadAds: number;
  spreadBloom: number;
  spreadDecay: number;
  adsTime: number;            // seconds to aim down sights
  adsFov: number;             // target FOV when aiming
  moveSpeedMult: number;      // wielder movement multiplier
  noiseLevel: number;         // metres audible (unsuppressed); suppressed = *0.22
  suppressable: boolean;
  penetration: number;        // 0..1 armour piercing factor
  pellets?: number;           // shotgun
  ammoType: AmmoType;
  melee?: { range: number; cooldown: number; silent: boolean; lethal: boolean };
  taser?: { incapacitateSeconds: number; shots: number };
  price: number;
  unlockRep?: number;         // reputation required in shop
  slots: AttachmentSlot[];    // available attachment slots
  /** Visual archetype for the procedural viewmodel / world model. */
  visual: 'pistol' | 'revolver' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'lmg' | 'knife' | 'bat' | 'taser';
  size: 'compact' | 'medium' | 'large'; // large can't be concealed under clothing
}

export const WEAPONS: Record<string, WeaponDef> = {};
const def = (w: WeaponDef): void => { WEAPONS[w.id] = w; };

def({
  id: 'pistol_m9', name: 'SR-9 Sidearm', category: 'pistol', visual: 'pistol', size: 'compact',
  description: 'Reliable polymer semi-auto. The standard criminal starting pistol.',
  damage: 26, headMult: 2.4, limbMult: 0.75, range0: 22, range1: 55, minDamageMult: 0.55,
  fireRate: 420, automatic: false, magazine: 15, reserveMax: 120, reloadTime: 1.7,
  recoilVertical: 0.9, recoilHorizontal: 0.45, recoilRecovery: 6,
  spreadHip: 1.9, spreadAds: 0.35, spreadBloom: 0.5, spreadDecay: 4.5,
  adsTime: 0.22, adsFov: 55, moveSpeedMult: 0.99, noiseLevel: 42, suppressable: true,
  penetration: 0.1, ammoType: 'light', price: 0,
  slots: ['optic', 'barrel', 'magazine', 'grip'],
});

def({
  id: 'pistol_whisper', name: 'Whisper 9', category: 'pistol', visual: 'pistol', size: 'compact',
  description: 'Integrally suppressed 9mm. Quiet, but underpowered against armour.',
  damage: 24, headMult: 2.6, limbMult: 0.7, range0: 18, range1: 42, minDamageMult: 0.5,
  fireRate: 380, automatic: false, magazine: 18, reserveMax: 108, reloadTime: 1.9,
  recoilVertical: 0.55, recoilHorizontal: 0.3, recoilRecovery: 6,
  spreadHip: 2.1, spreadAds: 0.4, spreadBloom: 0.45, spreadDecay: 4.5,
  adsTime: 0.24, adsFov: 55, moveSpeedMult: 0.99, noiseLevel: 9, suppressable: false,
  penetration: 0.05, ammoType: 'light', price: 1800, unlockRep: 1,
  slots: ['optic', 'magazine', 'grip'],
});

def({
  id: 'pistol_compact45', name: 'CP-45 Pocket', category: 'pistol', visual: 'pistol', size: 'compact',
  description: 'Small, concealable, hard-hitting .45. Favourite of social infiltrators.',
  damage: 34, headMult: 2.3, limbMult: 0.8, range0: 14, range1: 34, minDamageMult: 0.5,
  fireRate: 330, automatic: false, magazine: 8, reserveMax: 72, reloadTime: 1.8,
  recoilVertical: 1.5, recoilHorizontal: 0.7, recoilRecovery: 5,
  spreadHip: 2.3, spreadAds: 0.5, spreadBloom: 0.6, spreadDecay: 4,
  adsTime: 0.2, adsFov: 55, moveSpeedMult: 1.0, noiseLevel: 44, suppressable: true,
  penetration: 0.12, ammoType: 'light', price: 900,
  slots: ['barrel', 'magazine'],
});

def({
  id: 'revolver_357', name: 'Judge .357', category: 'revolver', visual: 'revolver', size: 'compact',
  description: 'Six-shot hand cannon. Massive damage, punishing recoil, slow reload.',
  damage: 62, headMult: 2.2, limbMult: 0.9, range0: 30, range1: 70, minDamageMult: 0.6,
  fireRate: 150, automatic: false, magazine: 6, reserveMax: 48, reloadTime: 3.1,
  recoilVertical: 3.4, recoilHorizontal: 1.3, recoilRecovery: 3.5,
  spreadHip: 2.4, spreadAds: 0.25, spreadBloom: 1.4, spreadDecay: 3,
  adsTime: 0.28, adsFov: 52, moveSpeedMult: 0.98, noiseLevel: 52, suppressable: false,
  penetration: 0.45, ammoType: 'heavy', price: 2200, unlockRep: 2,
  slots: ['optic', 'grip'],
});

def({
  id: 'smg_kobra', name: 'Kobra SMG', category: 'smg', visual: 'smg', size: 'medium',
  description: 'Controllable 9mm SMG. Shreds up close, drifts at range.',
  damage: 19, headMult: 2.0, limbMult: 0.7, range0: 14, range1: 38, minDamageMult: 0.4,
  fireRate: 850, automatic: true, magazine: 30, reserveMax: 240, reloadTime: 2.0,
  recoilVertical: 0.62, recoilHorizontal: 0.5, recoilRecovery: 7,
  spreadHip: 2.8, spreadAds: 0.7, spreadBloom: 0.32, spreadDecay: 5,
  adsTime: 0.24, adsFov: 58, moveSpeedMult: 0.96, noiseLevel: 46, suppressable: true,
  penetration: 0.08, ammoType: 'light', price: 2600,
  slots: ['optic', 'barrel', 'magazine', 'stock', 'grip'],
});

def({
  id: 'smg_vector9', name: 'VX-9 Rapid', category: 'smg', visual: 'smg', size: 'medium',
  description: 'Absurd cyclic rate, low per-bullet damage. Melts armour up close.',
  damage: 14, headMult: 1.9, limbMult: 0.65, range0: 10, range1: 30, minDamageMult: 0.35,
  fireRate: 1150, automatic: true, magazine: 33, reserveMax: 264, reloadTime: 2.2,
  recoilVertical: 0.5, recoilHorizontal: 0.42, recoilRecovery: 8,
  spreadHip: 3.3, spreadAds: 0.9, spreadBloom: 0.26, spreadDecay: 5.5,
  adsTime: 0.26, adsFov: 58, moveSpeedMult: 0.95, noiseLevel: 48, suppressable: true,
  penetration: 0.05, ammoType: 'light', price: 3400, unlockRep: 3,
  slots: ['optic', 'barrel', 'magazine', 'stock', 'grip'],
});

def({
  id: 'rifle_sentinel', name: 'Sentinel Carbine', category: 'rifle', visual: 'rifle', size: 'large',
  description: 'Balanced 5.56 carbine. Accurate, modular, professional.',
  damage: 30, headMult: 2.3, limbMult: 0.75, range0: 40, range1: 95, minDamageMult: 0.6,
  fireRate: 700, automatic: true, magazine: 30, reserveMax: 210, reloadTime: 2.3,
  recoilVertical: 0.85, recoilHorizontal: 0.55, recoilRecovery: 6,
  spreadHip: 3.4, spreadAds: 0.3, spreadBloom: 0.34, spreadDecay: 5,
  adsTime: 0.3, adsFov: 50, moveSpeedMult: 0.92, noiseLevel: 58, suppressable: true,
  penetration: 0.35, ammoType: 'heavy', price: 5200, unlockRep: 2,
  slots: ['optic', 'barrel', 'magazine', 'stock', 'grip'],
});

def({
  id: 'rifle_kovacs', name: 'Kovacs AK', category: 'rifle', visual: 'rifle', size: 'large',
  description: '7.62 punch and armour penetration. Kicks like a mule.',
  damage: 38, headMult: 2.2, limbMult: 0.8, range0: 45, range1: 100, minDamageMult: 0.62,
  fireRate: 600, automatic: true, magazine: 30, reserveMax: 180, reloadTime: 2.6,
  recoilVertical: 1.35, recoilHorizontal: 0.95, recoilRecovery: 4.5,
  spreadHip: 4.0, spreadAds: 0.45, spreadBloom: 0.42, spreadDecay: 4,
  adsTime: 0.34, adsFov: 50, moveSpeedMult: 0.9, noiseLevel: 62, suppressable: true,
  penetration: 0.55, ammoType: 'heavy', price: 6100, unlockRep: 3,
  slots: ['optic', 'barrel', 'magazine', 'stock', 'grip'],
});

def({
  id: 'shotgun_breaker', name: 'Breaker 12', category: 'shotgun', visual: 'shotgun', size: 'large',
  description: 'Pump-action 12 gauge. Devastating indoors, loud as hell.',
  damage: 13, headMult: 1.6, limbMult: 0.8, range0: 8, range1: 22, minDamageMult: 0.25,
  fireRate: 75, automatic: false, magazine: 6, reserveMax: 42, reloadTime: 3.4,
  pellets: 9,
  recoilVertical: 3.8, recoilHorizontal: 1.2, recoilRecovery: 3.2,
  spreadHip: 5.2, spreadAds: 3.4, spreadBloom: 1.6, spreadDecay: 3,
  adsTime: 0.36, adsFov: 55, moveSpeedMult: 0.88, noiseLevel: 66, suppressable: false,
  penetration: 0.1, ammoType: 'shell', price: 4300, unlockRep: 1,
  slots: ['stock', 'grip', 'magazine'],
});

def({
  id: 'shotgun_short', name: 'Short Breaker', category: 'shotgun', visual: 'shotgun', size: 'medium',
  description: 'Sawn-off double barrel. Two huge booms, then a long reload.',
  damage: 15, headMult: 1.5, limbMult: 0.8, range0: 5, range1: 14, minDamageMult: 0.2,
  fireRate: 170, automatic: false, magazine: 2, reserveMax: 24, reloadTime: 2.6,
  pellets: 10,
  recoilVertical: 4.6, recoilHorizontal: 1.8, recoilRecovery: 2.6,
  spreadHip: 7.0, spreadAds: 5.0, spreadBloom: 2.0, spreadDecay: 2.5,
  adsTime: 0.3, adsFov: 58, moveSpeedMult: 0.94, noiseLevel: 68, suppressable: false,
  penetration: 0.08, ammoType: 'shell', price: 2100,
  slots: ['grip'],
});

def({
  id: 'precision_longshadow', name: 'Longshadow DMR', category: 'precision', visual: 'sniper', size: 'large',
  description: 'Semi-auto marksman rifle. One shot, one very loud problem.',
  damage: 85, headMult: 2.5, limbMult: 1.0, range0: 90, range1: 220, minDamageMult: 0.8,
  fireRate: 240, automatic: false, magazine: 10, reserveMax: 60, reloadTime: 2.9,
  recoilVertical: 3.0, recoilHorizontal: 0.9, recoilRecovery: 2.8,
  spreadHip: 6.0, spreadAds: 0.06, spreadBloom: 2.4, spreadDecay: 2.2,
  adsTime: 0.45, adsFov: 32, moveSpeedMult: 0.85, noiseLevel: 72, suppressable: true,
  penetration: 0.75, ammoType: 'heavy', price: 8800, unlockRep: 5,
  slots: ['optic', 'barrel', 'magazine', 'stock', 'grip'],
});

def({
  id: 'lmg_bruiser', name: 'Bruiser LMG', category: 'lmg', visual: 'lmg', size: 'large',
  description: 'Belt-fed suppression platform. Heavy, slow, relentless.',
  damage: 28, headMult: 2.0, limbMult: 0.75, range0: 50, range1: 110, minDamageMult: 0.6,
  fireRate: 620, automatic: true, magazine: 75, reserveMax: 225, reloadTime: 4.6,
  recoilVertical: 1.0, recoilHorizontal: 0.9, recoilRecovery: 3.5,
  spreadHip: 5.0, spreadAds: 0.9, spreadBloom: 0.3, spreadDecay: 3.2,
  adsTime: 0.5, adsFov: 52, moveSpeedMult: 0.8, noiseLevel: 66, suppressable: false,
  penetration: 0.5, ammoType: 'heavy', price: 11200, unlockRep: 6,
  slots: ['optic', 'barrel', 'grip'],
});

def({
  id: 'melee_knife', name: 'Combat Knife', category: 'melee', visual: 'knife', size: 'compact',
  description: 'Silent lethal takedowns from behind. Fast in a panic.',
  damage: 55, headMult: 2.0, limbMult: 1.0, range0: 3, range1: 6, minDamageMult: 1,
  fireRate: 140, automatic: false, magazine: 0, reserveMax: 0, reloadTime: 0,
  recoilVertical: 0, recoilHorizontal: 0, recoilRecovery: 1,
  spreadHip: 0, spreadAds: 0, spreadBloom: 0, spreadDecay: 1,
  adsTime: 0.2, adsFov: 65, moveSpeedMult: 1.02, noiseLevel: 2, suppressable: false,
  penetration: 0, ammoType: 'none', price: 0,
  melee: { range: 2.2, cooldown: 0.8, silent: true, lethal: true },
  slots: [],
});

def({
  id: 'melee_bat', name: 'Sluggers Bat', category: 'melee', visual: 'bat', size: 'medium',
  description: 'Loud blunt trauma. Non-lethal knocks people out instead of killing.',
  damage: 45, headMult: 1.8, limbMult: 1.0, range0: 3, range1: 6, minDamageMult: 1,
  fireRate: 90, automatic: false, magazine: 0, reserveMax: 0, reloadTime: 0,
  recoilVertical: 0, recoilHorizontal: 0, recoilRecovery: 1,
  spreadHip: 0, spreadAds: 0, spreadBloom: 0, spreadDecay: 1,
  adsTime: 0.2, adsFov: 65, moveSpeedMult: 1.0, noiseLevel: 14, suppressable: false,
  penetration: 0, ammoType: 'none', price: 250,
  melee: { range: 2.6, cooldown: 1.1, silent: false, lethal: false },
  slots: [],
});

def({
  id: 'nonlethal_taser', name: 'Volt-2 Taser', category: 'nonlethal', visual: 'taser', size: 'compact',
  description: 'Two dart charges. Incapacitates targets without lethal force — keeps civilian penalties off.',
  damage: 4, headMult: 1, limbMult: 1, range0: 12, range1: 20, minDamageMult: 1,
  fireRate: 60, automatic: false, magazine: 2, reserveMax: 8, reloadTime: 2.4,
  recoilVertical: 0.2, recoilHorizontal: 0.1, recoilRecovery: 5,
  spreadHip: 0.6, spreadAds: 0.2, spreadBloom: 0.2, spreadDecay: 5,
  adsTime: 0.2, adsFov: 60, moveSpeedMult: 1.0, noiseLevel: 8, suppressable: false,
  penetration: 0, ammoType: 'dart', price: 1400, unlockRep: 1,
  taser: { incapacitateSeconds: 25, shots: 2 },
  slots: [],
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export const ATTACHMENTS: Record<string, AttachmentDef> = {};
const att = (a: AttachmentDef): void => { ATTACHMENTS[a.id] = a; };

const m = (over: Partial<WeaponStatModifiers>): WeaponStatModifiers => ({ ...IDENTITY_MODS, ...over });

att({ id: 'suppressor_light', name: 'Threaded Suppressor', slot: 'barrel', price: 1500,
  description: 'Cuts report to a mechanical click. Slight velocity loss.',
  modifiers: m({ noiseMult: 0.2, damageMult: 0.94, rangeMult: 0.9 }), fits: '*' });
att({ id: 'barrel_long', name: 'Extended Barrel', slot: 'barrel', price: 900,
  description: 'Better range and accuracy, louder report, slower handling.',
  modifiers: m({ rangeMult: 1.2, damageMult: 1.05, spreadMult: 0.85, adsTimeMult: 1.15, moveSpeedMult: 0.98, noiseMult: 1.1 }), fits: '*' });
att({ id: 'optic_reddot', name: 'Red Dot Sight', slot: 'optic', price: 700,
  description: 'Faster target acquisition when aiming.',
  modifiers: m({ adsTimeMult: 0.85, spreadMult: 0.95 }), fits: '*' });
att({ id: 'optic_scope4x', name: '4x Scope', slot: 'optic', price: 1600,
  description: 'Magnified optic for precision work. Slow handling up close.',
  modifiers: m({ adsTimeMult: 1.25, spreadMult: 0.6 }), fits: ['precision_longshadow', 'rifle_sentinel', 'rifle_kovacs', 'lmg_bruiser'] });
att({ id: 'mag_extended', name: 'Extended Magazine', slot: 'magazine', price: 1100,
  description: '+50% magazine capacity, slightly slower reloads.',
  modifiers: m({ magAdd: 0.5, reloadMult: 1.12 }), fits: '*' });
att({ id: 'mag_fast', name: 'Fast Magazine', slot: 'magazine', price: 800,
  description: 'Polished feed lips and pull spring: much faster reloads.',
  modifiers: m({ reloadMult: 0.78 }), fits: '*' });
att({ id: 'stock_tactical', name: 'Tactical Stock', slot: 'stock', price: 850,
  description: 'Recoil damping at the cost of handling speed.',
  modifiers: m({ recoilMult: 0.72, adsTimeMult: 1.08 }), fits: '*' });
att({ id: 'stock_skeleton', name: 'Skeleton Stock', slot: 'stock', price: 650,
  description: 'Lighter weapon, faster aims, more felt recoil.',
  modifiers: m({ recoilMult: 1.18, adsTimeMult: 0.82, moveSpeedMult: 1.03 }), fits: '*' });
att({ id: 'grip_vert', name: 'Vertical Grip', slot: 'grip', price: 500,
  description: 'Tames horizontal muzzle climb during sustained fire.',
  modifiers: m({ recoilMult: 0.85, spreadMult: 0.95 }), fits: '*' });
att({ id: 'finish_gold', name: 'Gold Finish', slot: 'grip', price: 4000, unlockRep: 6,
  description: 'Cosmetic. Worthless tactically. Priceless psychologically.',
  modifiers: m({}), fits: '*' });

export const SUPPRESSED_NOISE_MULT = 0.22; // used when weapon def is natively suppressed

export function getWeapon(id: string): WeaponDef | undefined {
  return WEAPONS[id];
}

/** Effective stats of a weapon with a given attachment loadout. */
export function effectiveWeaponStats(def: WeaponDef, attachmentIds: string[]): {
  damage: number; spreadHip: number; spreadAds: number; recoilVertical: number; recoilHorizontal: number;
  reloadTime: number; magazine: number; adsTime: number; moveSpeedMult: number; noiseLevel: number;
  range0: number; range1: number; fireRate: number; penetration: number; suppressed: boolean;
} {
  let damageMult = 1, spreadMult = 1, recoilMult = 1, reloadMult = 1, magAdd = 0;
  let adsTimeMult = 1, moveSpeedMult = 1, noiseMult = 1, rangeMult = 1, fireRateMult = 1, penetrationAdd = 0;
  let suppressed = def.noiseLevel <= 12; // natively quiet
  for (const id of attachmentIds) {
    const a = ATTACHMENTS[id];
    if (!a) continue;
    if (a.id === 'suppressor_light') suppressed = true;
    const mm = a.modifiers;
    damageMult *= mm.damageMult ?? 1; spreadMult *= mm.spreadMult ?? 1; recoilMult *= mm.recoilMult ?? 1;
    reloadMult *= mm.reloadMult ?? 1; magAdd += def.magazine > 0 ? (mm.magAdd ?? 0) * def.magazine : 0;
    adsTimeMult *= mm.adsTimeMult ?? 1; moveSpeedMult *= mm.moveSpeedMult ?? 1; noiseMult *= mm.noiseMult ?? 1;
    rangeMult *= mm.rangeMult ?? 1; fireRateMult *= mm.fireRateMult ?? 1; penetrationAdd += mm.penetrationAdd ?? 0;
  }
  return {
    damage: def.damage * damageMult,
    spreadHip: def.spreadHip * spreadMult,
    spreadAds: def.spreadAds * spreadMult,
    recoilVertical: def.recoilVertical * recoilMult,
    recoilHorizontal: def.recoilHorizontal * recoilMult,
    reloadTime: def.reloadTime * reloadMult,
    magazine: Math.max(0, Math.round(def.magazine + magAdd)),
    adsTime: def.adsTime * adsTimeMult,
    moveSpeedMult: def.moveSpeedMult * moveSpeedMult,
    // Suppressor attachment carries noiseMult 0.2; natively quiet weapons (Whisper 9)
    // already have a low base noiseLevel in their def.
    noiseLevel: def.noiseLevel * noiseMult,
    range0: def.range0 * rangeMult,
    range1: def.range1 * rangeMult,
    fireRate: def.fireRate * fireRateMult,
    penetration: Math.min(0.95, def.penetration + penetrationAdd),
    suppressed,
  };
}
