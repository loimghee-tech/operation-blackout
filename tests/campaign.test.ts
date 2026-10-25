import { describe, it, expect } from 'vitest';
import {
  newCampaign, grantClassStarter, validateLoadout, repairLoadout, defaultLoadout, addXp, levelForXp,
  unlockSkill, purchase, hireCrew, upgradeCrew, sanitizeCampaign, type ShopItem,
} from '../src/progression/campaign';
import { CLASS_LIST, CLASSES } from '../src/config/classes';
import { CREW_BY_ID } from '../src/config/crew';

describe('class starting equipment', () => {
  for (const cl of CLASS_LIST) {
    it(`${cl.name} starts with a valid, owned loadout`, () => {
      const c = newCampaign();
      c.classId = cl.id;
      grantClassStarter(c, cl.id);
      c.loadout = defaultLoadout(cl.id);
      expect(validateLoadout(c, c.loadout)).toEqual([]);
      expect(c.ownedWeapons).toContain(cl.loadout.primary);
      expect(c.ownedWeapons).toContain(cl.loadout.secondary);
      expect(c.ownedArmor).toContain(cl.loadout.armor);
      for (const g of cl.loadout.gadgets) expect(c.ownedGadgets).toContain(g);
    });
  }

  it('every class has six-part identity: stats, ability, passives, loadout', () => {
    expect(CLASS_LIST.length).toBe(6);
    for (const cl of CLASS_LIST) {
      expect(cl.passives.length).toBeGreaterThanOrEqual(2);
      expect(cl.ability.cooldown).toBeGreaterThan(0);
      expect(cl.strengths.length).toBeGreaterThan(0);
      expect(cl.tradeoffs.length).toBeGreaterThan(0);
    }
  });

  it('classes differ in gameplay stats (not cosmetic)', () => {
    const ghost = CLASSES.ghost.stats;
    const loud = CLASSES.loud.stats;
    expect(ghost.noiseMult).toBeLessThan(loud.noiseMult);
    expect(ghost.armorMult).toBeLessThan(loud.armorMult);
    expect(CLASSES.hacker.stats.hackSpeedMult).toBeLessThan(CLASSES.conartist.stats.hackSpeedMult);
  });
});

describe('loadout validation', () => {
  it('rejects unowned weapons and attachments that do not fit', () => {
    const c = newCampaign();
    const l = { ...defaultLoadout(null), primary: 'rifle_kovacs' };
    expect(validateLoadout(c, l).some((p) => p.includes('not owned'))).toBe(true);
  });

  it('rejects a pistol as primary and a rifle as sidearm', () => {
    const c = newCampaign();
    c.ownedWeapons.push('rifle_sentinel');
    const bad = { ...defaultLoadout(null), primary: 'pistol_m9', secondary: 'rifle_sentinel' };
    const problems = validateLoadout(c, bad);
    expect(problems.some((p) => p.startsWith('Primary must be a long weapon'))).toBe(true);
    expect(problems.some((p) => p.startsWith('Secondary must be a sidearm'))).toBe(true);
  });

  it('repairLoadout fixes an invalid loadout into a valid one', () => {
    const c = newCampaign();
    c.ownedWeapons.push('smg_kobra');
    const l = { ...defaultLoadout(null), primary: 'rifle_kovacs', armor: 'heavy' as const, gadgets: ['breach_charge', 'breach_charge'] as unknown as [null, null] };
    const fixed = repairLoadout(c, l as never);
    expect(validateLoadout(c, fixed)).toEqual([]);
  });

  it('attachments must match slot and weapon', () => {
    const c = newCampaign();
    c.ownedAttachments.push('optic_scope4x');
    c.loadout = { ...defaultLoadout(null), attachments: { pistol_m9: ['optic_scope4x'] } };
    expect(validateLoadout(c, c.loadout).some((p) => p.includes('does not fit'))).toBe(true);
  });
});

describe('progression', () => {
  it('levels follow the XP table and grant skill points', () => {
    const c = newCampaign();
    expect(levelForXp(0)).toBe(1);
    const gained = addXp(c, 1000);
    expect(gained).toBe(1);
    expect(c.level).toBe(2);
    expect(c.skillPoints).toBeGreaterThanOrEqual(2);
  });

  it('skills require points, reputation and the earlier tier of the same tree', () => {
    const c = newCampaign();
    expect(unlockSkill(c, 'c_mags').ok).toBe(false);      // tier 1 needs tier 0 first
    c.skillPoints = 10;
    expect(unlockSkill(c, 'c_steady').ok).toBe(true);
    c.reputation = 1;
    expect(unlockSkill(c, 'c_mags').ok).toBe(true);
    expect(unlockSkill(c, 'c_overmatch').ok).toBe(false); // needs reputation 6
    expect(unlockSkill(c, 'c_steady').ok).toBe(false);    // already owned
  });

  it('purchases deduct money and respect reputation gates', () => {
    const c = newCampaign();
    const item: ShopItem = { kind: 'weapon', id: 'smg_vector9', name: 'VX-9', price: 3400, requiresRep: 3, owned: false, description: '' };
    expect(purchase(c, item).ok).toBe(false);
    c.reputation = 5;
    c.money = 10000;
    expect(purchase(c, item).ok).toBe(true);
    expect(c.money).toBe(6600);
    expect(c.ownedWeapons).toContain('smg_vector9');
  });

  it('crew are hired and upgraded with money', () => {
    const c = newCampaign();
    c.money = 100000;
    c.reputation = 3;
    const vex = CREW_BY_ID.crew_vex;
    expect(hireCrew(c, vex).ok).toBe(true);
    expect(hireCrew(c, vex).ok).toBe(false);
    expect(upgradeCrew(c, vex).ok).toBe(true);
    expect(c.crewTier[vex.id]).toBe(1);
  });
});

describe('save sanitising', () => {
  it('drops unknown ids and clamps numbers from a tampered save', () => {
    const s = sanitizeCampaign({ classId: 'nonsense', money: -50, skills: ['c_steady', 'fake_skill'], ownedWeapons: ['pistol_m9', 'laser_gun'] });
    expect(s.classId).toBeNull();
    expect(s.money).toBe(0);
    expect(s.skills).toEqual(['c_steady']);
    expect(s.ownedWeapons).toEqual(['pistol_m9']);
  });
});
