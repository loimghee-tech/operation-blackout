/**
 * Gadgets, armour, disguises and throwables.
 */
import type { ClassId } from '../core/types';

export type GadgetId =
  | 'medkit' | 'ammobox' | 'lockpick' | 'emp_charge' | 'scanner'
  | 'breach_charge' | 'noise_maker' | 'stun_grenade' | 'repair_kit'
  | 'disguise_kit' | 'keycard_cloner' | 'trip_mine' | 'deployable_cover';

export interface GadgetDef {
  id: GadgetId;
  name: string;
  description: string;
  /** 'equipment' = used with F, 'throwable' = thrown with G. */
  kind: 'equipment' | 'throwable';
  uses: number;          // uses per mission
  useTime: number;       // seconds (hold interaction)
  cooldown: number;
  price: number;
  unlockRep?: number;
  /** Classes that receive it free at campaign start. */
  classBonus?: ClassId[];
}

export const GADGETS: Record<GadgetId, GadgetDef> = {
  medkit: { id: 'medkit', name: 'Trauma Kit', kind: 'equipment', uses: 1, useTime: 3.0, cooldown: 1, price: 800,
    description: 'Restores 60 health over a short field dressing. One per mission unless upgraded.' },
  ammobox: { id: 'ammobox', name: 'Ammo Case', kind: 'equipment', uses: 1, useTime: 2.5, cooldown: 1, price: 600,
    description: 'Deploys a shared ammunition resupply point for you and your crew.' },
  lockpick: { id: 'lockpick', name: 'Lockpick Set', kind: 'equipment', uses: 3, useTime: 3.0, cooldown: 1, price: 700,
    description: 'Bypasses mechanical locks on doors and simple containers. Noisy — quiet hands help.' },
  emp_charge: { id: 'emp_charge', name: 'EMP Charge', kind: 'equipment', uses: 1, useTime: 2.0, cooldown: 1, price: 1500, unlockRep: 2,
    description: 'Fries nearby cameras and electronic locks for 45 seconds. One shot.' },
  scanner: { id: 'scanner', name: 'RF Scanner', kind: 'equipment', uses: 5, useTime: 1.5, cooldown: 2, price: 900,
    description: 'Pings nearby electronics: cameras, keypads, sensors and loot through walls for a few seconds.' },
  breach_charge: { id: 'breach_charge', name: 'Breaching Charge', kind: 'equipment', uses: 1, useTime: 3.5, cooldown: 1, price: 2400, unlockRep: 3,
    description: 'Forces open reinforced doors and weak walls. Extremely loud.' },
  noise_maker: { id: 'noise_maker', name: 'Distraction Puck', kind: 'throwable', uses: 2, useTime: 0, cooldown: 1, price: 400,
    description: 'Thrown emitter. After 2s plays loud noise, pulling nearby NPCs to investigate.' },
  stun_grenade: { id: 'stun_grenade', name: 'Flashbang', kind: 'throwable', uses: 2, useTime: 0, cooldown: 1, price: 700, unlockRep: 1,
    description: 'Blinds and staggers everyone looking at it — including you, if you are careless.' },
  repair_kit: { id: 'repair_kit', name: 'Repair Kit', kind: 'equipment', uses: 2, useTime: 3.0, cooldown: 1, price: 500,
    description: 'Fixes broken machinery, jammed drills and sabotaged systems.' },
  disguise_kit: { id: 'disguise_kit', name: 'Disguise Kit', kind: 'equipment', uses: 2, useTime: 4.0, cooldown: 1, price: 1800, unlockRep: 2,
    description: 'Swap into a compatible disguise found in the level (staff uniforms, guard gear).' },
  keycard_cloner: { id: 'keycard_cloner', name: 'Keycard Cloner', kind: 'equipment', uses: 2, useTime: 2.5, cooldown: 1, price: 2100, unlockRep: 3,
    description: 'Clone a keycard from a patrolling staffer at close range. Grants their access tier once.' },
  trip_mine: { id: 'trip_mine', name: 'Trip Flare Mine', kind: 'equipment', uses: 2, useTime: 2.0, cooldown: 1, price: 1200, unlockRep: 4,
    description: 'Defensive flare trap. Warns you and blinds pursuers in a corridor.' },
  deployable_cover: { id: 'deployable_cover', name: 'Folding Barricade', kind: 'equipment', uses: 1, useTime: 2.5, cooldown: 1, price: 1600, unlockRep: 4,
    description: 'Deploys ballistic cover in a doorway. Crew love it. So does your survival rate.' },
};

// ---------------------------------------------------------------------------
// Armour
// ---------------------------------------------------------------------------
export type ArmorId = 'none' | 'light' | 'medium' | 'heavy' | 'combat';

export interface ArmorDef {
  id: ArmorId;
  name: string;
  description: string;
  armor: number;           // armour points
  damageMult: number;      // incoming damage multiplier while armour holds
  moveSpeedMult: number;
  noiseMult: number;       // footstep/movement noise multiplier
  /** Visible bulk: affects disguise plausibility in social areas. */
  bulk: 0 | 1 | 2;
  price: number;
  unlockRep?: number;
}

export const ARMORS: Record<ArmorId, ArmorDef> = {
  none:   { id: 'none', name: 'Street Clothes', description: 'Nothing under the jacket. Fast, silent, fragile.', armor: 0, damageMult: 1.15, moveSpeedMult: 1.04, noiseMult: 0.9, bulk: 0, price: 0 },
  light:  { id: 'light', name: 'Concealed Vest', description: 'Slim pistol-rated vest. Keeps a disguise believable.', armor: 40, damageMult: 1.0, moveSpeedMult: 1.0, noiseMult: 1.0, bulk: 0, price: 900 },
  medium: { id: 'medium', name: 'Ballistic Vest', description: 'Standard rifle-rated protection.', armor: 75, damageMult: 0.85, moveSpeedMult: 0.96, noiseMult: 1.05, bulk: 1, price: 2200, unlockRep: 1 },
  heavy:  { id: 'heavy', name: 'Heavy Plate', description: 'Full torso plating. Loud, slow, hard to kill.', armor: 120, damageMult: 0.72, moveSpeedMult: 0.9, noiseMult: 1.15, bulk: 2, price: 4800, unlockRep: 3 },
  combat: { id: 'combat', name: 'Assault Rig', description: 'Plate carrier with ammo pouches. Loud specialist favourite.', armor: 100, damageMult: 0.8, moveSpeedMult: 0.93, noiseMult: 1.12, bulk: 2, price: 3600, unlockRep: 2 },
};

// ---------------------------------------------------------------------------
// Disguises
// ---------------------------------------------------------------------------
export type DisguiseId = 'none' | 'civilian' | 'bank_staff' | 'security' | 'police' | 'maintenance';

export interface DisguiseDef {
  id: DisguiseId;
  name: string;
  description: string;
  /** Access tiers granted. Doors/zones require one of their accepted tiers. */
  access: string[];
  /** Multiplier on suspicion accrual from minor infractions while worn. */
  suspicionMult: number;
  /** Where this disguise is "plausible" (room tags). Outside them it can draw attention. */
  plausibleIn: string[];
  /** Whether NPCs of a faction accept the disguise at all. */
  acceptedBy: ('guard' | 'civilian' | 'police')[];
  price: number;
  unlockRep?: number;
}

export const DISGUISES: Record<DisguiseId, DisguiseDef> = {
  none:       { id: 'none', name: 'No Disguise', description: 'You look like an armed stranger. Because you are.', access: ['public'], suspicionMult: 1.0, plausibleIn: ['public', 'street'], acceptedBy: [], price: 0 },
  civilian:   { id: 'civilian', name: 'Civilian Clothing', description: 'Blend into customer areas. Restricted doors still stop you.', access: ['public'], suspicionMult: 0.85, plausibleIn: ['public', 'street'], acceptedBy: ['civilian'], price: 0 },
  bank_staff: { id: 'bank_staff', name: 'Bank Staff Uniform', description: 'Walk the employee corridors like you belong there.', access: ['public', 'staff'], suspicionMult: 0.7, plausibleIn: ['public', 'staff', 'office'], acceptedBy: ['civilian', 'guard'], price: 1200 },
  security:   { id: 'security', name: 'Security Uniform', description: 'Guards ignore you; staff areas and security rooms open up. The vault still needs a real plan.', access: ['public', 'staff', 'security'], suspicionMult: 0.55, plausibleIn: ['public', 'staff', 'office', 'security'], acceptedBy: ['civilian', 'guard'], price: 2600, unlockRep: 2 },
  police:     { id: 'police', name: 'Police Uniform', description: 'Responding units hesitate to shoot a "cop". Works until the real cops do a headcount.', access: ['public', 'staff', 'security', 'police'], suspicionMult: 0.6, plausibleIn: ['public', 'street', 'security'], acceptedBy: ['civilian', 'guard', 'police'], price: 3400, unlockRep: 4 },
  maintenance:{ id: 'maintenance', name: 'Maintenance Overalls', description: 'Nobody looks twice at the person with a toolbox. Service areas only.', access: ['public', 'staff', 'service'], suspicionMult: 0.75, plausibleIn: ['public', 'staff', 'service', 'office'], acceptedBy: ['civilian', 'guard'], price: 900 },
};
