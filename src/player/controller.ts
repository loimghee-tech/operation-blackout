/**
 * First-person player controller.
 *  - WASD movement with physics capsule collision, step-up, ground detection
 *  - walk / sprint (stamina when enabled) / crouch / aim modifiers
 *  - contextual vault over waist-high obstacles
 *  - footstep and landing noise emission (feeds NPC hearing)
 *  - health, armour, downed (bleed-out) and death
 *  - camera feel: mouse look, bob, sway, recoil recovery, shake
 */
import * as THREE from 'three';
import type { Vec3, SurfaceType } from '../core/types';
import { PhysicsWorld, type CapsuleAgent } from '../world/collision';
import { BALANCE, type DifficultyConfig } from '../config/balance';
import type { Input } from '../core/input';
import type { Settings } from '../progression/settings';
import { clamp, damp } from '../core/math';

export interface PlayerStatsIn {
  maxHealth: number;
  maxArmor: number;
  moveSpeedMult: number;
  noiseMult: number;
  damageTakenMult: number;
  staminaMult: number;
  bleedoutSeconds: number;
}

export type PlayerEvent =
  | { type: 'damaged'; amount: number; from: Vec3 | null }
  | { type: 'downed' }
  | { type: 'revived' }
  | { type: 'dead' }
  | { type: 'vault' }
  | { type: 'land'; impact: number }
  | { type: 'step'; surface: string; sprint: boolean; crouch: boolean };

export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;
  readonly agent: CapsuleAgent;
  yaw = 0;
  pitch = 0;
  velY = 0;
  grounded = true;
  surface: string = 'concrete';
  stance: 'stand' | 'crouch' = 'stand';
  wantCrouch = false;
  sprinting = false;
  moving = false;
  moveSpeed = 0;
  stamina = 100;
  staminaCooldown = 0;
  health: number;
  armor: number;
  stats: PlayerStatsIn;
  downed = false;
  dead = false;
  private downT = 0;
  private hurtT = 0;
  private lastDamageT = -99;
  private bobPhase = 0;
  private stepDist = 0;
  private landed = false;
  private vaulting: { from: Vec3; to: Vec3; t: number; dur: number } | null = null;
  private recoilPitch = 0;   // current camera kick (deg)
  private recoilYaw = 0;
  private shake = 0;
  private eyeCur = 1.62;
  private safe: Vec3;
  private lastSafeT = 0;
  swayX = 0;
  swayY = 0;
  adsBlend = 0;
  /** Mouse delta accumulated for weapon sway. */
  swayVelX = 0;
  swayVelY = 0;
  events: Array<PlayerEvent> = [];
  /** Noise callback set by the mission world (footsteps, landings). */
  onNoise?: (pos: Vec3, radius: number, loudness: number, kind: 'footstep' | 'impact') => void;
  /** Stances modifiers from skills/abilities. */
  noiseMult = 1;
  visibilityMult = 1;
  /** Vanish ability (Ghost). */
  vanish = false;
  invulnerable = false;

  constructor(private physics: PhysicsWorld, spawn: Vec3, stats: PlayerStatsIn, private diff: DifficultyConfig, aspect: number, fov: number) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 260);
    this.agent = { pos: { x: spawn.x, y: spawn.y, z: spawn.z }, radius: BALANCE.player.radius, height: BALANCE.player.heightStand, stepHeight: BALANCE.player.stepHeight };
    this.stats = stats;
    this.health = stats.maxHealth;
    this.armor = stats.maxArmor;
    this.safe = { ...spawn };
    this.stamina = BALANCE.player.staminaMax * stats.staminaMult;
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
  }

  get feet(): Vec3 { return this.agent.pos; }

  eyePos(out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    out.x = this.agent.pos.x; out.y = this.agent.pos.y + this.eyeCur; out.z = this.agent.pos.z;
    return out;
  }

  /** Forward direction (3D, from pitch+yaw). */
  forward(out: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 {
    const cp = Math.cos(this.pitch + this.recoilPitch * Math.PI / 180);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch + this.recoilPitch * Math.PI / 180);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  /** Horizontal forward (for movement). */
  flatForward(): { x: number; z: number } { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
  flatRight(): { x: number; z: number } { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }

  setPosition(p: Vec3): void {
    this.agent.pos.x = p.x; this.agent.pos.y = p.y; this.agent.pos.z = p.z;
    this.safe = { ...p };
    this.velY = 0;
  }

  /** Applies look input (mouse deltas already scaled by the caller). */
  look(dx: number, dy: number, settings: Settings, aiming: boolean, aimSensMult: number): void {
    if (this.downed) return;
    const base = settings.mouseSensitivity * 0.0022 * (aiming ? settings.adsSensitivityMult : 1) * aimSensMult;
    this.yaw -= dx * base;
    this.pitch -= (settings.invertY ? -dy : dy) * base;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.swayVelX += dx * 0.00005;
    this.swayVelY += dy * 0.00005;
  }

  /** Adds weapon recoil to camera (degrees). */
  kick(pitchDeg: number, yawDeg: number): void {
    this.recoilPitch += pitchDeg;
    this.recoilYaw += yawDeg;
    this.shake = Math.min(1, this.shake + pitchDeg * 0.03);
  }

  addShake(amount: number): void { this.shake = Math.min(1, this.shake + amount); }

  /** Main per-frame update. */
  update(dt: number, input: Input, settings: Settings, opts: { canMove: boolean; aiming: boolean; sprintAllowed: boolean; lockScale: number; elapsed: number }): void {
    this.events.length = 0;
    const p = BALANCE.player;
    // ---- stance ---------------------------------------------------------
    const crouchKey = input.isDown('ControlLeft') || input.isDown('ControlRight');
    if (settings.toggleCrouch) {
      if (input.wasPressed('ControlLeft') || input.wasPressed('ControlRight')) this.wantCrouch = !this.wantCrouch;
    } else this.wantCrouch = crouchKey;
    const wantStand = !this.wantCrouch;
    if (this.vaulting) this.updateVault(dt);
    else if (this.downed) this.updateDowned(dt);
    if (this.dead) return;

    if (!this.downed && !this.vaulting) {
      const crouched = this.stance === 'crouch';
      if (wantStand && crouched) {
        // only stand if there is headroom
        if (!this.physics.isPointBlocked(this.agent.pos, this.agent.radius * 0.9)) this.setStance('stand');
      } else if (!wantStand && !crouched) this.setStance('crouch');

      // ---- movement intent ---------------------------------------------
      let mx = 0, mz = 0;
      if (opts.canMove) {
        if (input.isDown('KeyW')) mz += 1;
        if (input.isDown('KeyS')) mz -= 1;
        if (input.isDown('KeyD')) mx += 1;
        if (input.isDown('KeyA')) mx -= 1;
      }
      const hasInput = mx !== 0 || mz !== 0;
      const f = this.flatForward(), r = this.flatRight();
      let dirX = f.x * mz + r.x * mx;
      let dirZ = f.z * mz + r.z * mx;
      const dl = Math.hypot(dirX, dirZ);
      if (dl > 0) { dirX /= dl; dirZ /= dl; }

      // sprint: shift, not while crouched/aiming, needs stamina when enabled
      const wantSprint = opts.canMove && hasInput && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && this.stance === 'stand' && !opts.aiming;
      const staminaOk = !this.diff.staminaEnabled || this.stamina > 2;
      this.sprinting = wantSprint && staminaOk && opts.sprintAllowed;
      if (this.diff.staminaEnabled) {
        if (this.sprinting) {
          this.stamina = Math.max(0, this.stamina - p.staminaDrainSprint * dt / Math.max(0.5, this.stats.staminaMult));
          this.staminaCooldown = p.staminaRegenDelay;
        } else {
          this.staminaCooldown -= dt;
          if (this.staminaCooldown <= 0) this.stamina = Math.min(p.staminaMax * this.stats.staminaMult, this.stamina + p.staminaRegen * dt);
        }
      } else this.stamina = p.staminaMax;

      let speed = p.baseMoveSpeed * this.stats.moveSpeedMult;
      if (this.sprinting) speed *= p.sprintMult;
      if (this.stance === 'crouch') speed *= p.crouchMult;
      if (opts.aiming) speed *= p.adsMoveMult;
      speed *= opts.lockScale;
      this.moveSpeed = hasInput && opts.canMove ? speed : 0;
      this.moving = hasInput && opts.canMove;

      const step = this.moveSpeed * dt;
      // ---- vertical -----------------------------------------------------
      if (this.grounded && opts.canMove && input.wasPressed('Space') && !this.vaulting) {
        if (!this.tryVault()) { this.velY = p.jumpVelocity * 0.85; this.grounded = false; }
      }
      this.velY -= p.gravity * dt;
      const res = this.physics.moveCapsule(this.agent, { x: dirX * step, y: this.velY * dt, z: dirZ * step });
      if (res.grounded) {
        if (!this.grounded && this.velY < -3) {
          this.events.push({ type: 'land', impact: -this.velY });
          this.onNoise?.(this.agent.pos, p.noiseLandBase * this.stats.noiseMult * this.noiseMult, 0.6, 'impact');
        }
        this.grounded = true;
        this.velY = 0;
        this.surface = res.groundSurface;
      } else {
        this.grounded = false;
      }
      if (res.headBump) this.velY = Math.min(this.velY, 0);

      // footsteps
      const travelled = this.moving && this.grounded ? step : 0;
      this.stepDist += travelled;
      const interval = this.sprinting ? p.footstepIntervalSprint : this.stance === 'crouch' ? p.footstepIntervalCrouch : p.footstepIntervalWalk;
      const stride = interval * (this.sprinting ? 2.4 : 1.8);
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        const radius = this.noiseRadius();
        this.events.push({ type: 'step', surface: this.surface, sprint: this.sprinting, crouch: this.stance === 'crouch' });
        this.onNoise?.(this.agent.pos, radius, this.sprinting ? 0.9 : this.stance === 'crouch' ? 0.25 : 0.55, 'footstep');
      }
      this.bobPhase += this.moving && this.grounded ? dt * (this.sprinting ? 13 : 8.5) : 0;
    }

    // ---- camera feel ----------------------------------------------------
    this.eyeCur = damp(this.eyeCur, this.stance === 'crouch' ? BALANCE.player.eyeHeightCrouch : BALANCE.player.eyeHeightStand, 12, dt);
    this.adsBlend = damp(this.adsBlend, opts.aiming ? 1 : 0, 14, dt);
    // recoil recovery
    const rec = 7 * dt;
    this.recoilPitch = Math.max(0, this.recoilPitch - Math.min(this.recoilPitch, rec * 4));
    this.recoilYaw *= Math.max(0, 1 - 6 * dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    // sway from mouse movement (spring back)
    this.swayX = damp(this.swayX, clamp(this.swayVelX * 80, -0.04, 0.04), 10, dt);
    this.swayY = damp(this.swayY, clamp(this.swayVelY * 80, -0.04, 0.04), 10, dt);
    this.swayVelX = damp(this.swayVelX, 0, 12, dt);
    this.swayVelY = damp(this.swayVelY, 0, 12, dt);
    this.applyCamera(settings, opts.elapsed);

    // safe-point tracking for emergency respawn
    if (this.grounded && this.agent.pos.y > -0.1 && this.lastSafeT <= 0 && !this.vaulting) {
      this.safe = { ...this.agent.pos };
      this.lastSafeT = 1;
    }
    this.lastSafeT -= dt;
    if (this.agent.pos.y < -3) {
      this.setPosition(this.safe);
    }
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.health < this.stats.maxHealth * 0.4 && !this.downed && performance.now() / 1000 - this.lastDamageT > 9) {
      this.health = Math.min(this.stats.maxHealth * 0.4, this.health + 3 * dt);
    }
  }

  private noiseRadius(): number {
    const p = BALANCE.player;
    let r = this.sprinting ? p.noiseSprint : this.stance === 'crouch' ? p.noiseCrouchWalk : p.noiseWalk;
    if (!this.moving) r *= 0.25;
    if (this.vanish) r *= 0.35;
    return r * this.stats.noiseMult * this.noiseMult;
  }

  setStance(s: 'stand' | 'crouch'): void {
    if (this.stance === s) return;
    this.stance = s;
    const h = s === 'crouch' ? BALANCE.player.heightCrouch : BALANCE.player.heightStand;
    this.agent.height = h;
  }

  private applyCamera(settings: Settings, elapsed: number): void {
    const cam = this.camera;
    const bob = this.moving && this.grounded ? Math.sin(this.bobPhase) * (this.sprinting ? 0.05 : 0.025) * (1 - this.adsBlend * 0.8) : 0;
    const bobX = this.moving && this.grounded ? Math.cos(this.bobPhase * 0.5) * (this.sprinting ? 0.03 : 0.015) * (1 - this.adsBlend) : 0;
    const shake = this.shake * settings.screenShake * 0.03;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    cam.position.set(this.agent.pos.x + bobX * Math.cos(this.yaw), this.agent.pos.y + this.eyeCur + bob + (this.vaulting ? 0 : 0) + sy, this.agent.pos.z - bobX * Math.sin(this.yaw));
    cam.rotation.set(this.pitch + this.recoilPitch * Math.PI / 180 + sx * 0.5, this.yaw + this.recoilYaw * Math.PI / 180, 0);
    // dead/down camera: fall to the ground
    if (this.downed) cam.position.y = this.agent.pos.y + 0.4;
    void elapsed;
    const fov = settings.fov * (1 - 0.13 * this.adsBlend);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  // ---- vault ---------------------------------------------------------------
  private tryVault(): boolean {
    const p = BALANCE.player;
    const f = this.flatForward();
    const origin = { x: this.agent.pos.x, y: this.agent.pos.y + p.vaultMinHeight + 0.05, z: this.agent.pos.z };
    const dir = { x: f.x, y: 0, z: f.z };
    const hit = this.physics.raycast(origin, dir, 0.9);
    if (!hit || hit.box.box.max.y - this.agent.pos.y > p.vaultMaxHeight || hit.box.box.max.y - this.agent.pos.y < p.vaultMinHeight) return false;
    if (hit.box.surface === 'metal' && hit.box.dynamicId) return false; // doors are not vaultable
    if (hit.box.dynamicId) return false;
    const top = hit.box.box.max.y;
    const landDist = 1.1;
    const to = { x: this.agent.pos.x + f.x * (hit.dist + landDist), y: top + 0.02, z: this.agent.pos.z + f.z * (hit.dist + landDist) };
    if (this.physics.isPointBlocked(to, this.agent.radius)) return false;
    // ensure something solid is under the landing spot (no vaulting into the void)
    if (!this.physics.groundBelow({ pos: { x: to.x, y: top + 0.05, z: to.z }, radius: this.agent.radius, height: 1.8, stepHeight: 0.4 })) {
      // a box top at landing is not required when the landing is on the same floor
      const probe = this.physics.raycast({ x: to.x, y: top + 1, z: to.z }, { x: 0, y: -1, z: 0 }, 3);
      if (!probe) return false;
    }
    this.vaulting = { from: { ...this.agent.pos }, to, t: 0, dur: 0.55 };
    this.events.push({ type: 'vault' });
    this.onNoise?.(this.agent.pos, 6, 0.5, 'impact');
    return true;
  }

  private updateVault(dt: number): void {
    const v = this.vaulting!;
    v.t += dt;
    const k = Math.min(1, v.t / v.dur);
    const e = k * k * (3 - 2 * k);
    this.agent.pos.x = v.from.x + (v.to.x - v.from.x) * e;
    this.agent.pos.z = v.from.z + (v.to.z - v.from.z) * e;
    this.agent.pos.y = v.from.y + (v.to.y - v.from.y) * e + Math.sin(k * Math.PI) * 0.45;
    if (k >= 1) {
      this.vaulting = null;
      this.velY = 0;
      this.grounded = false;
      this.safe = { ...this.agent.pos };
    }
  }

  // ---- health --------------------------------------------------------------
  /** Applies incoming damage with armour absorption and difficulty multipliers. */
  damage(raw: number, from: Vec3 | null): void {
    if (this.dead || this.downed || this.invulnerable) return;
    let dmg = raw * this.stats.damageTakenMult;
    if (this.armor > 0) {
      const absorb = Math.min(this.armor, dmg * 0.65);
      this.armor -= absorb;
      dmg -= absorb;
    }
    this.health -= dmg;
    this.lastDamageT = performance.now() / 1000;
    this.hurtT = 0.4;
    this.shake = Math.min(1, this.shake + 0.35);
    this.events.push({ type: 'damaged', amount: dmg, from });
    if (this.health <= 0) {
      this.health = 0;
      this.downed = true;
      this.downT = this.stats.bleedoutSeconds;
      this.events.push({ type: 'downed' });
    }
  }

  private updateDowned(dt: number): void {
    this.downT -= dt;
    this.moveSpeed = 0;
    this.moving = false;
    if (this.downT <= 0) {
      this.downed = false;
      this.dead = true;
      this.events.push({ type: 'dead' });
    }
  }

  revive(hp = 35): void {
    if (!this.downed) return;
    this.downed = false;
    this.downT = 0;
    this.health = Math.max(this.health, hp);
    this.events.push({ type: 'revived' });
  }

  get bleedoutLeft(): number { return Math.max(0, this.downT); }

  get surfaceType(): SurfaceType { return (this.surface as SurfaceType) ?? 'concrete'; }

  /** Used by the HUD: 0..1 of health and armour. */
  get healthRatio(): number { return this.health / this.stats.maxHealth; }
  get armorRatio(): number { return this.stats.maxArmor > 0 ? this.armor / this.stats.maxArmor : 0; }
  get hurtFlash(): number { return this.hurtT / 0.4; }
}
