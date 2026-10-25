/**
 * Player weapon system: loadout slots, firing (hitscan with spread, recoil and
 * falloff), reloads with interruption rules, aim-down-sights, melee takedowns,
 * taser incapacitation and the first-person viewmodel.
 */
import * as THREE from 'three';
import { WEAPONS, effectiveWeaponStats, type WeaponDef } from '../config/weapons';
import { AMMO_TYPES, type AmmoType } from '../progression/campaign';
import type { Vec3 } from '../core/types';
import { clamp01 } from '../core/math';
import type { Rng } from '../core/rng';

export interface WeaponState {
  slot: 'primary' | 'secondary' | 'melee';
  id: string;
  def: WeaponDef;
  attachments: string[];
  stats: ReturnType<typeof effectiveWeaponStats>;
  mag: number;
  reserve: number;
  reloadT: number;          // >0 while reloading
  cooldown: number;         // seconds until next shot
  bloom: number;            // extra spread (deg)
  kickPitch: number;        // pending camera kick (deg), consumed by controller
  kickYaw: number;
  wasFiring: boolean;
  meleeT: number;
}

export interface FireShot {
  origin: Vec3;
  dir: Vec3;               // unit, after spread
  damage: number;
  penetration: number;
  pellet: boolean;
  weaponId: string;
  zoneBonusHead: number;   // head multiplier
  limbMult: number;
  range0: number;
  range1: number;
  minMult: number;
  taser: boolean;
  headMult: number;
  silent: boolean;
  noise: number;
}

export interface WeaponInput {
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  aimHeld: boolean;
  sprinting: boolean;
  moving: boolean;
  crouched: boolean;
  handlingMult: number;    // from class + skills (multiplies recoil/spread)
  reloadSpeedMult: number;
  swapMult: number;
  ammoType: AmmoType;
  ammoDamageMult?: number;
  ammoHeadMult?: number;
  ammoPenAdd?: number;
  fireRateMult?: number;
  abilityFireMult?: number;
}

export interface WeaponFrameResult {
  shots: FireShot[];
  melee: { range: number; lethal: boolean; silent: boolean; damage: number; dir: Vec3; origin: Vec3; weaponId: string } | null;
  emptyClick: boolean;
  reloadStarted: { id: string; duration: number } | null;
  reloadFinished: string | null;
  reloadInterrupted: boolean;
  adsT: number;
  swapped: string | null;
}

export class WeaponSystem {
  readonly slots: Array<WeaponState | null> = [null, null, null];
  active: 0 | 1 | 2 = 0;
  /** Aim-down-sights progress 0..1 */
  adsT = 0;
  /** Current aim flag (for crosshair & FOV). */
  aiming = false;
  private swapT = 0;
  private rng: Rng;
  onFire?: (s: FireShot) => void;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  /** Installs a weapon into a slot. reserveMult scales the starting reserve. */
  equip(slot: 0 | 1 | 2, weaponId: string, attachments: string[], reserveMult: number, magBonus = 0): void {
    const def = WEAPONS[weaponId];
    if (!def) { this.slots[slot] = null; return; }
    const stats = effectiveWeaponStats(def, attachments);
    const magSize = def.magazine > 0 ? stats.magazine + magBonus : 0;
    this.slots[slot] = {
      slot: slot === 0 ? 'primary' : slot === 1 ? 'secondary' : 'melee',
      id: weaponId,
      def,
      attachments: attachments.slice(),
      stats,
      mag: magSize,
      reserve: def.magazine > 0 ? Math.round(def.reserveMax * reserveMult) : 0,
      reloadT: 0,
      cooldown: 0,
      bloom: 0,
      kickPitch: 0,
      kickYaw: 0,
      wasFiring: false,
      meleeT: 0,
    };
  }

  get current(): WeaponState | null { return this.slots[this.active]; }

  /** Switch by slot index (0..2). Switching cancels reloads and ADS. */
  select(slot: 0 | 1 | 2, swapMult: number): string | null {
    const w = this.slots[slot];
    if (!w || slot === this.active) return null;
    this.active = slot;
    this.swapT = 0.35 * swapMult;
    if (this.current) this.current.reloadT = 0;
    return w.id;
  }

  cycle(dir: 1 | -1, swapMult: number): string | null {
    for (let i = 1; i <= 3; i++) {
      const next = ((this.active + dir * i + 3) % 3) as 0 | 1 | 2;
      if (this.slots[next]) return this.select(next, swapMult);
    }
    return null;
  }

  /** Adds reserve ammo (pickups). Returns amount actually added. */
  addAmmo(amount: number): number {
    let added = 0;
    for (const s of this.slots) {
      if (!s || s.def.magazine <= 0) continue;
      const cap = Math.round(s.def.reserveMax * 1.5);
      const room = Math.max(0, cap - s.reserve);
      const take = Math.min(room, amount - added);
      s.reserve += take;
      added += take;
      if (added >= amount) break;
    }
    return added;
  }

  /** Per-frame update. Produces shots/melee for the game to resolve. */
  update(dt: number, input: WeaponInput, origin: Vec3, forward: Vec3, right: Vec3, up: Vec3): WeaponFrameResult {
    const res: WeaponFrameResult = { shots: [], melee: null, emptyClick: false, reloadStarted: null, reloadFinished: null, reloadInterrupted: false, adsT: this.adsT, swapped: null };
    const w = this.current;
    this.swapT = Math.max(0, this.swapT - dt);

    // ADS blend
    const adsTarget = input.aimHeld && w && w.def.magazine >= 0 && !input.sprinting && w.def.melee === undefined ? 1 : 0;
    const adsTime = w ? Math.max(0.05, w.stats.adsTime) : 0.25;
    this.adsT += Math.sign(adsTarget - this.adsT) * Math.min(Math.abs(adsTarget - this.adsT), dt / adsTime);
    this.aiming = this.adsT > 0.5;
    res.adsT = this.adsT;

    // Global recovery of bloom; cooldowns of non-active weapons tick down here.
    for (const s of this.slots) {
      if (!s) continue;
      s.bloom = Math.max(0, s.bloom - s.def.spreadDecay * dt);
      if (s !== w) s.cooldown = Math.max(0, s.cooldown - dt);
      s.meleeT = Math.max(0, s.meleeT - dt);
      // recoil recovery is applied by the controller using kickPitch/kickYaw
    }
    if (!w) return res;

    // Reload progression
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        w.reloadT = 0;
        const need = w.stats.magazine - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        res.reloadFinished = w.id;
      }
    }
    // Sprinting cancels reload (interruption rule: no reloading while sprinting)
    if (w.reloadT > 0 && (input.sprinting || w.def.melee)) {
      w.reloadT = 0;
      res.reloadInterrupted = true;
    }

    // Melee weapons
    if (w.def.melee) {
      if (input.firePressed && w.meleeT <= 0 && !input.sprinting) {
        w.meleeT = w.def.melee.cooldown;
        res.melee = {
          range: w.def.melee.range,
          lethal: w.def.melee.lethal,
          silent: w.def.melee.silent,
          damage: w.def.damage * (input.ammoDamageMult ?? 1),
          dir: { ...forward },
          origin: { ...origin },
          weaponId: w.id,
        };
      }
      return res;
    }

    // Start reload
    if (input.reloadPressed && w.reloadT <= 0 && w.mag < w.stats.magazine && w.reserve > 0 && !input.sprinting) {
      w.reloadT = Math.max(0.3, w.stats.reloadTime * input.reloadSpeedMult);
      res.reloadStarted = { id: w.id, duration: w.reloadT };
    }

    // Trigger: a cooldown accumulator lets automatic weapons fire the correct number of rounds
    // even when a frame is long (e.g. low frame rate); semi-automatic weapons fire once per press.
    const wantFire = w.def.automatic ? input.fireHeld : input.firePressed;
    const fireRate = w.stats.fireRate * (input.fireRateMult ?? 1) * (input.abilityFireMult ?? 1);
    const interval = 60 / Math.max(1, fireRate);
    // w.cooldown is the time (s) until the next shot may leave the barrel.
    // Frame time is spent progressively, so an automatic weapon releases exactly the rounds its
    // fire rate allows within this frame (capped at 8 to avoid spiralling after a long stall).
    let remaining = dt;
    let cd = w.cooldown;
    if (!wantFire) {
      w.wasFiring = false;
      w.cooldown = Math.max(0, cd - dt);
    } else if (this.swapT <= 0) {
      const maxShots = w.def.automatic ? 8 : 1;
      let fired = 0;
      if (cd <= 0 && w.mag <= 0) {
        res.emptyClick = true;
        cd = 0.25;
      }
      while (fired < maxShots && w.mag > 0) {
        if (cd > remaining) { cd -= remaining; remaining = 0; break; }
        remaining -= Math.max(0, cd);
        cd = 0;
        if (w.reloadT > 0) {
          // Reload interruption: firing cancels a reload only for shotguns (pump between shells)
          if (w.def.category === 'shotgun') { w.reloadT = 0; res.reloadInterrupted = true; } else { cd = Math.max(0, cd); break; }
        }
        w.mag--;
        cd = interval;
        fired++;
        w.wasFiring = true;
        this.emitShot(w, input, origin, forward, right, up, res);
      }
      if (fired === 0 && w.mag > 0 && w.reloadT <= 0) { /* waiting for the next round */ }
      w.cooldown = Math.max(0, cd - Math.max(0, remaining));
      if (fired > 0 && w.cooldown < 0) w.cooldown = 0;
    } else {
      w.cooldown = Math.max(0, cd - dt);
    }

    // Auto-reload when empty and not firing
    if (w.mag <= 0 && w.reloadT <= 0 && w.reserve > 0 && !input.sprinting && !wantFire) {
      w.reloadT = Math.max(0.3, w.stats.reloadTime * input.reloadSpeedMult);
      res.reloadStarted = { id: w.id, duration: w.reloadT };
    }
    return res;
  }

  /** Builds the projectile(s) for one trigger pull and applies bloom/recoil. */
  private emitShot(w: WeaponState, input: WeaponInput, origin: Vec3, forward: Vec3, right: Vec3, up: Vec3, res: WeaponFrameResult): void {
    const adsFactor = 1 - 0.55 * this.adsT;
    const moveBloom = input.moving ? (input.sprinting ? 1.9 : 1.25) : 1;
    const crouchBloom = input.crouched ? 0.8 : 1;
    const baseSpread = this.adsT > 0.5 ? w.stats.spreadAds : w.stats.spreadHip;
    const spreadDeg = (baseSpread * adsFactor * moveBloom * crouchBloom + w.bloom) * input.handlingMult;
    const pellets = w.def.pellets ?? 1;
    const ammo = AMMO_TYPES[input.ammoType];
    const dmgMul = input.ammoDamageMult ?? ammo.damageMult;
    const pen = Math.min(0.95, Math.max(0, w.stats.penetration + (input.ammoPenAdd ?? ammo.penetrationAdd)));
    for (let i = 0; i < pellets; i++) {
      const dir = applySpread(forward, right, up, spreadDeg, this.rng);
      const shot: FireShot = {
        origin: { ...origin },
        dir,
        damage: w.stats.damage * dmgMul,
        penetration: pen,
        pellet: pellets > 1,
        weaponId: w.id,
        zoneBonusHead: w.def.headMult * (input.ammoHeadMult ?? 1),
        limbMult: w.def.limbMult,
        range0: w.stats.range0,
        range1: w.stats.range1,
        minMult: w.def.minDamageMult,
        taser: !!w.def.taser,
        headMult: w.def.headMult,
        silent: w.stats.suppressed,
        noise: w.stats.noiseLevel,
      };
      res.shots.push(shot);
    }
    // bloom & recoil
    const handling = input.handlingMult;
    w.bloom = Math.min(w.def.spreadBloom * 12, w.bloom + w.def.spreadBloom * (w.def.automatic ? 1 : 2) * handling);
    w.kickPitch += w.stats.recoilVertical * handling * (this.adsT > 0.5 ? 0.8 : 1);
    w.kickYaw += (this.rng.next() - 0.5) * w.stats.recoilHorizontal * handling * 1.4;
    for (const sh of res.shots.slice(-pellets)) this.onFire?.(sh);
  }

  /** Returns the cancelled reload info if the player is sprinting. */
  cancelReload(): void {
    if (this.current) this.current.reloadT = 0;
  }

  /** Viewmodel helpers */
  get reloadProgress(): number {
    const w = this.current;
    if (!w || w.reloadT <= 0) return 0;
    return clamp01(1 - w.reloadT / Math.max(0.01, w.stats.reloadTime));
  }

  get swapping(): number { return this.swapT; }
}

/** Random direction inside a cone of `deg` half-angle around `fwd`. */
export function applySpread(fwd: Vec3, right: Vec3, up: Vec3, deg: number, rng: Rng): Vec3 {
  if (deg <= 0) return { ...fwd };
  const r = Math.tan((deg * Math.PI) / 180) * Math.sqrt(rng.next());
  const a = rng.next() * Math.PI * 2;
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const x = fwd.x + right.x * ox + up.x * oy;
  const y = fwd.y + right.y * ox + up.y * oy;
  const z = fwd.z + right.z * ox + up.z * oy;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

/** Damage falloff between range0 and range1. */
export function falloffMult(dist: number, range0: number, range1: number, minMult: number): number {
  if (dist <= range0) return 1;
  if (dist >= range1) return minMult;
  return 1 - (1 - minMult) * ((dist - range0) / (range1 - range0));
}

// ---------------------------------------------------------------------------
// First-person viewmodel (procedural): built from boxes per archetype.
// ---------------------------------------------------------------------------
export function buildViewmodel(def: WeaponDef | null): THREE.Group {
  const g = new THREE.Group();
  if (!def) return g;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.7 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x5a6670, roughness: 0.4, metalness: 0.6 });
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    g.add(mesh);
    return mesh;
  };
  switch (def.visual) {
    case 'pistol':
      add(0.05, 0.12, 0.2, 0, 0, 0, polymer);
      add(0.045, 0.06, 0.2, 0, 0.09, -0.02, metal);
      add(0.04, 0.12, 0.05, 0, -0.1, 0.06, polymer);
      break;
    case 'revolver':
      add(0.05, 0.12, 0.2, 0, 0, 0, polymer);
      add(0.05, 0.07, 0.22, 0, 0.08, -0.03, metal);
      add(0.05, 0.05, 0.05, 0, 0.02, 0.07, accent);
      break;
    case 'smg':
      add(0.06, 0.14, 0.34, 0, 0, 0, polymer);
      add(0.05, 0.06, 0.28, 0, 0.1, -0.06, metal);
      add(0.04, 0.22, 0.06, 0, -0.16, -0.04, polymer);
      add(0.04, 0.08, 0.1, 0, -0.04, 0.2, accent);
      break;
    case 'rifle':
      add(0.07, 0.14, 0.5, 0, 0, 0, polymer);
      add(0.05, 0.05, 0.4, 0, 0.1, -0.2, metal);
      add(0.04, 0.22, 0.06, 0, -0.18, -0.06, polymer);
      add(0.05, 0.12, 0.26, 0, -0.01, 0.34, polymer);
      break;
    case 'shotgun':
      add(0.08, 0.14, 0.6, 0, 0, 0, polymer);
      add(0.06, 0.06, 0.5, 0, 0.09, -0.2, metal);
      add(0.07, 0.07, 0.2, 0, -0.02, -0.4, accent);
      add(0.05, 0.16, 0.12, 0, -0.14, 0.12, polymer);
      break;
    case 'sniper':
      add(0.07, 0.14, 0.7, 0, 0, 0, polymer);
      add(0.04, 0.04, 0.6, 0, 0.1, -0.25, metal);
      add(0.1, 0.1, 0.22, 0, 0.16, 0.05, accent);
      break;
    case 'lmg':
      add(0.12, 0.16, 0.6, 0, 0, 0, polymer);
      add(0.05, 0.05, 0.4, 0, 0.09, -0.2, metal);
      add(0.1, 0.22, 0.12, 0, -0.18, 0.1, polymer);
      break;
    case 'knife':
      add(0.02, 0.02, 0.2, 0, 0.02, -0.12, accent);
      add(0.03, 0.05, 0.1, 0, -0.02, 0.06, polymer);
      break;
    case 'bat':
      add(0.06, 0.06, 0.55, 0, 0.1, -0.12, new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.7 }));
      add(0.04, 0.2, 0.04, 0, -0.04, 0.2, polymer);
      break;
    case 'taser':
      add(0.07, 0.1, 0.2, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 }));
      add(0.03, 0.03, 0.14, 0, 0.06, -0.1, metal);
      break;
    default:
      add(0.06, 0.1, 0.25, 0, 0, 0, polymer);
  }
  return g;
}
