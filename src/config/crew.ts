/**
 * Recruitable AI crew specialists. Each has real in-mission behaviour driven
 * by ai/crewBrain.ts, stats that feed combat/hacking, and an upgrade path.
 */
export type CrewRole = 'assault' | 'stealth' | 'hacker' | 'engineer' | 'medic' | 'driver';

export interface CrewUpgradeTier {
  cost: number;
  description: string;
}

export interface CrewDef {
  id: string;
  name: string;
  role: CrewRole;
  description: string;
  personality: string;
  hireCost: number;
  unlockRep: number;
  /** Per-mission hire fee (paid on deployment). */
  missionFee: number;
  stats: {
    accuracy: number;      // 0..1 base hit probability scaler
    health: number;
    damageMult: number;
    hackSpeedMult: number; // lower = faster
    interactSpeedMult: number;
    moveSpeedMult: number;
  };
  loadoutText: string;
  weaponId: string;
  secondaryWeaponId?: string;
  gadgetId?: string;
  /** Rocketbox model preference; falls back to procedural if missing. */
  modelKeys: string[];
  upgrades: CrewUpgradeTier[]; // tiers 1..3; tier 0 = base
  barks: {
    follow: string[];
    hold: string[];
    regroup: string[];
    combat: string[];
    downed: string[];
    revive: string[];
    hacking: string[];
    objective: string[];
  };
}

export const CREW: CrewDef[] = [
  {
    id: 'crew_vex', name: 'Vex Kadar', role: 'assault',
    description: 'Ex-military door-kicker. Walks into gunfire the way you walk into a room.',
    personality: 'Blunt, fearless, weirdly polite between shots.',
    hireCost: 4500, unlockRep: 1, missionFee: 600,
    stats: { accuracy: 0.62, health: 130, damageMult: 1.15, hackSpeedMult: 1.3, interactSpeedMult: 1.2, moveSpeedMult: 1.0 },
    loadoutText: 'Sentinel Carbine · SR-9 Sidearm · Heavy Plate · Flashbang',
    weaponId: 'rifle_sentinel', secondaryWeaponId: 'pistol_m9', gadgetId: 'stun_grenade',
    modelKeys: ['Military_Male_01', 'Sports_Male_01'],
    upgrades: [
      { cost: 3000, description: 'Tier 1: +20 health, armour-piercing magazines.' },
      { cost: 6500, description: 'Tier 2: +10% accuracy, suppresses enemies under fire.' },
      { cost: 12000, description: 'Tier 3: Adrenaline protocol — revives himself once per job at 30% health.' },
    ],
    barks: {
      follow: ['On your six.', 'Moving with you.'],
      hold: ['Holding here.', 'I got this angle.'],
      regroup: ['Regrouping, moving out.', 'Coming to you.'],
      combat: ['Contact! Engaging!', 'They are lit up, push!', 'Reloading — cover me!'],
      downed: ['I am hit! Need a hand!', 'Down! DOWN!'],
      revive: ['Up and angry. Thanks.', 'Good hands. Let us finish this.'],
      hacking: ['I do not do computers. Find a nerd.'],
      objective: ['Objective area clear-ish. Move.'],
    },
  },
  {
    id: 'crew_wren', name: 'Wren Okafor', role: 'stealth',
    description: 'Burglar, ghost, professional bystander. Has never triggered an alarm she did not plan.',
    personality: 'Dry humour, whispers everything, collects keycards as souvenirs.',
    hireCost: 5200, unlockRep: 2, missionFee: 700,
    stats: { accuracy: 0.5, health: 95, damageMult: 1.0, hackSpeedMult: 1.0, interactSpeedMult: 0.65, moveSpeedMult: 1.08 },
    loadoutText: 'Whisper 9 · Kobra SMG (suppressed) · Concealed Vest · Lockpicks',
    weaponId: 'smg_kobra', secondaryWeaponId: 'pistol_whisper', gadgetId: 'lockpick',
    modelKeys: ['Security_Female_01', 'Business_Female_02'],
    upgrades: [
      { cost: 3200, description: 'Tier 1: Silent takedowns on alerted targets from behind.' },
      { cost: 7000, description: 'Tier 2: +25% lockpick and body-stash speed; picks electronic locks.' },
      { cost: 13000, description: 'Tier 3: Can wear a guard disguise without suspicion from other guards.' },
    ],
    barks: {
      follow: ['Slipstream.', 'Behind you, quiet as anything.'],
      hold: ['Holding in the dark.', 'Static, watching.'],
      regroup: ['Melting back to you.'],
      combat: ['We are loud now. Making it count.', 'Two down, keep moving.'],
      downed: ['Ah — I am down. Bit of a mess here.'],
      revive: ['Owe you one. Quietly.'],
      hacking: ['Lock is mine. Give me four seconds.'],
      objective: ['Path to the objective is clean. For now.'],
    },
  },
  {
    id: 'crew_pixel', name: 'Pixel Marwan', role: 'hacker',
    description: 'Wrote her first rootkit at fourteen. Treats bank security like a rude personal insult.',
    personality: 'Fast-talking, caffeinated, narrates her hacks.',
    hireCost: 6000, unlockRep: 2, missionFee: 800,
    stats: { accuracy: 0.42, health: 85, damageMult: 0.9, hackSpeedMult: 0.5, interactSpeedMult: 0.7, moveSpeedMult: 1.0 },
    loadoutText: 'VX-9 Rapid · CP-45 Pocket · Light Vest · EMP Charge · RF Scanner',
    weaponId: 'smg_vector9', secondaryWeaponId: 'pistol_compact45', gadgetId: 'emp_charge',
    modelKeys: ['Business_Female_02', 'Sports_Male_01'],
    upgrades: [
      { cost: 3500, description: 'Tier 1: Camera loops last twice as long.' },
      { cost: 7500, description: 'Tier 2: Can hack the vault control relay — skips one vault objective step.' },
      { cost: 14000, description: 'Tier 3: Remote blackout — kills all cameras once per job from anywhere.' },
    ],
    barks: {
      follow: ['Trailing you, eyes on screens.'],
      hold: ['Camping this terminal.'],
      regroup: ['Logging off, moving.'],
      combat: ['I was NOT built for this part!', 'Suppressing! Sort of!'],
      downed: ['Systems... failing. Someone—'],
      revive: ['Rebooted. Ugh, my ribs.'],
      hacking: ['Handshake... got it. Cameras are ours.', 'Encryption is cute. Give me ten seconds.'],
      objective: ['Terminal access logged. You are clear.'],
    },
  },
  {
    id: 'crew_doz', name: 'Doz Ferreira', role: 'engineer',
    description: 'Can start a vault drill with a paperclip and a grudge. Fixes everything, trusts nothing with an engine.',
    personality: 'Grumbly, methodical, deeply attached to his tools.',
    hireCost: 5000, unlockRep: 2, missionFee: 650,
    stats: { accuracy: 0.45, health: 115, damageMult: 1.0, hackSpeedMult: 0.9, interactSpeedMult: 0.5, moveSpeedMult: 0.95 },
    loadoutText: 'Breaker 12 · SR-9 Sidearm · Ballistic Vest · Repair Kit · Breaching Charge',
    weaponId: 'shotgun_breaker', secondaryWeaponId: 'pistol_m9', gadgetId: 'repair_kit',
    modelKeys: ['Construction_Male_01', 'Business_Male_01'],
    upgrades: [
      { cost: 3000, description: 'Tier 1: Drills never jam; drills 25% faster.' },
      { cost: 6500, description: 'Tier 2: Can open service routes and elevator overrides.' },
      { cost: 12500, description: 'Tier 3: Deploys a folding barricade at the start of every job.' },
    ],
    barks: {
      follow: ['Tools are up, let us walk.'],
      hold: ['Holding. If it breaks near me, I fix it.'],
      regroup: ['Packin up, comin over.'],
      combat: ['Shotgun answers most questions!', 'Machine talk over. Bang bang.'],
      downed: ['Legs are gone. Not the tools though.'],
      revive: ['Back upright. Structural integrity: mostly fine.'],
      hacking: ['Drill is spinning sweet. Do not touch it.'],
      objective: ['Wall is open. You are welcome.'],
    },
  },
  {
    id: 'crew_stitch', name: 'Stitch Amara', role: 'medic',
    description: 'Combat medic who left the army for worse hours and better company. Keeps crews breathing.',
    personality: 'Calm, wry, unfazed by blood or bad plans.',
    hireCost: 5600, unlockRep: 3, missionFee: 750,
    stats: { accuracy: 0.5, health: 105, damageMult: 0.95, hackSpeedMult: 1.1, interactSpeedMult: 0.9, moveSpeedMult: 1.02 },
    loadoutText: 'Kobra SMG · SR-9 Sidearm · Ballistic Vest · Trauma Kits ×3',
    weaponId: 'smg_kobra', secondaryWeaponId: 'pistol_m9', gadgetId: 'medkit',
    modelKeys: ['Medical_Male_01', 'Business_Female_02'],
    upgrades: [
      { cost: 3200, description: 'Tier 1: Revives 40% faster; carries extra trauma kits.' },
      { cost: 6800, description: 'Tier 2: Field-heals nearby crew slowly during combat.' },
      { cost: 13000, description: 'Tier 3: Once per job, auto-revives you the moment you go down.' },
    ],
    barks: {
      follow: ['With you. Try not to need me.'],
      hold: ['Holding here with the kit.'],
      regroup: ['Moving to the group.'],
      combat: ['Cover down! I am working!', 'They are bleeding, keep them bleeding!'],
      downed: ['I need... help. Ironic, I know.'],
      revive: ['Patched. Move smarter this time.'],
      hacking: ['Medic, not magic. Get Pixel.'],
      objective: ['You are clear to work. I have the wounded.'],
    },
  },
  {
    id: 'crew_rook', name: 'Rook Delaney', role: 'driver',
    description: 'Best wheels in the city and a talent for making extraction points exist where they did not before.',
    personality: 'Laid-back, permanently chewing gum, calls the van "the office".',
    hireCost: 4000, unlockRep: 1, missionFee: 500,
    stats: { accuracy: 0.48, health: 100, damageMult: 1.0, hackSpeedMult: 1.15, interactSpeedMult: 1.0, moveSpeedMult: 1.05 },
    loadoutText: 'Short Breaker · CP-45 Pocket · Light Vest · Getaway Van (unlocks extra escape route)',
    weaponId: 'shotgun_short', secondaryWeaponId: 'pistol_compact45', gadgetId: 'ammobox',
    modelKeys: ['Sports_Male_01', 'Business_Male_01'],
    upgrades: [
      { cost: 2800, description: 'Tier 1: Extraction timer at the van is 30% shorter.' },
      { cost: 6000, description: 'Tier 2: Second escape route pre-positioned on every job.' },
      { cost: 11000, description: 'Tier 3: "Engine running" — extraction completes 50% faster, van absorbs one alarm wave.' },
    ],
    barks: {
      follow: ['Walking with you, engine is warm.'],
      hold: ['Holding at the vehicle.'],
      regroup: ['Bringing myself to you.'],
      combat: ['I drive, remember — but I can shoot a bit!', 'Paint for me and they are scrap!'],
      downed: ['Bad place for a nap, friend!'],
      revive: ['Wheels turning again.'],
      hacking: ['I hot-wire, I do not hack. Different religion.'],
      objective: ['Van is positioned. Finish up and ride.'],
    },
  },
];

export const CREW_BY_ID: Record<string, CrewDef> = Object.fromEntries(CREW.map((c) => [c.id, c]));
