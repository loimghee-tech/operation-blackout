/**
 * Contextual interaction system.
 *  - Candidates must be in range, roughly in front of the player, and (optionally) in line of sight.
 *  - A priority score picks one focus; hysteresis stops the prompt flickering between overlapping objects.
 *  - Hold-to-use interactions track progress and can be cancelled by releasing E or moving away.
 */
import type { Vec3 } from '../core/types';
import type { PhysicsWorld } from '../world/collision';
import { dist } from '../core/math';

export interface UseCheck {
  ok: boolean;
  reason?: string;
}

export interface Interactable {
  id: string;
  label: string;
  pos: Vec3;
  range?: number;          // default 2.2 m
  priority?: number;       // higher wins on ties (0..10)
  holdTime?: number;       // seconds to hold E (0 = instant press)
  needsSight?: boolean;    // require line of sight from eye
  /** Returns whether the interaction can start right now (with reason if not). */
  check(): UseCheck;
  /** Called when the hold completes (or instantly for holdTime 0). */
  use(): void;
  /** Optional progress label shown while holding (e.g. "Drilling"). */
  progressLabel?: string;
  /** Optional cool-down in seconds after use. */
  cooldown?: number;
  /** Set true after one-time interactions are complete (removed from focus). */
  done?: boolean;
  /** Priority category for prompt text ('door', 'device', 'loot', 'npc', 'extract', 'hide', 'crew'). */
  kind: string;
}

export interface FocusInfo {
  target: Interactable | null;
  label: string;
  usable: boolean;
  reason?: string;
  hold: number;
  progress: number; // 0..1 while holding
}

export class InteractionSystem {
  private items = new Map<string, Interactable>();
  private focus: Interactable | null = null;
  private focusHold = 0;
  private holding: Interactable | null = null;
  private holdT = 0;
  private cooldowns = new Map<string, number>();
  /** Progress speed multiplier (class/skill/overclock). */
  speedMult = 1;
  info: FocusInfo = { target: null, label: '', usable: false, hold: 0, progress: 0 };
  onComplete?: (it: Interactable) => void;
  onCancel?: (it: Interactable) => void;

  add(it: Interactable): void { this.items.set(it.id, it); }
  remove(id: string): void { this.items.delete(id); if (this.focus?.id === id) this.focus = null; }
  get(id: string): Interactable | undefined { return this.items.get(id); }
  clear(): void { this.items.clear(); this.focus = null; this.holding = null; this.cooldowns.clear(); }
  all(): Interactable[] { return Array.from(this.items.values()); }

  /** Frame update: chooses focus and advances any hold. `holdKey` = E currently held. */
  update(dt: number, eye: Vec3, forward: Vec3, holdKey: boolean, pressKey: boolean, physics: PhysicsWorld, blocked: boolean): void {
    for (const [id, t] of this.cooldowns) {
      const nt = t - dt;
      if (nt <= 0) this.cooldowns.delete(id); else this.cooldowns.set(id, nt);
    }
    if (blocked) {
      this.holding = null;
      this.info = { target: null, label: '', usable: false, hold: 0, progress: 0 };
      return;
    }

    // Holding in progress
    if (this.holding) {
      const h = this.holding;
      const chk = h.check();
      const sameFocus = this.focus?.id === h.id;
      if (!holdKey || !chk.ok || !sameFocus) {
        this.onCancel?.(h);
        this.holding = null;
        this.holdT = 0;
      } else {
        this.holdT += dt * this.speedMult;
        const need = h.holdTime ?? 0;
        if (this.holdT >= need) {
          this.holding = null;
          this.holdT = 0;
          h.use();
          if (h.cooldown) this.cooldowns.set(h.id, h.cooldown);
          this.onComplete?.(h);
        }
      }
    }

    // Focus selection
    const best = this.pickFocus(eye, forward, physics);
    if (best !== this.focus) {
      // hysteresis: keep the old focus briefly if it is still valid
      if (this.focus && this.focusHold > 0 && this.isCandidate(this.focus, eye, forward, physics)) {
        this.focusHold -= dt;
      } else {
        this.focus = best;
        this.focusHold = 0.18;
      }
    } else {
      this.focusHold = Math.max(0, this.focusHold - dt);
    }

    const f = this.focus;
    if (!f) {
      this.info = { target: null, label: '', usable: false, hold: 0, progress: 0 };
      return;
    }
    const chk = f.check();
    const onCd = this.cooldowns.has(f.id);
    this.info = {
      target: f,
      label: f.label,
      usable: chk.ok && !onCd,
      reason: onCd ? 'Recharging' : chk.reason,
      hold: f.holdTime ?? 0,
      progress: this.holding && this.holding.id === f.id && f.holdTime ? Math.min(1, this.holdT / f.holdTime) : 0,
    };

    if (pressKey && !this.holding && this.info.usable) {
      if ((f.holdTime ?? 0) <= 0) {
        f.use();
        if (f.cooldown) this.cooldowns.set(f.id, f.cooldown);
        this.onComplete?.(f);
      } else {
        this.holding = f;
        this.holdT = 0;
      }
    }
    if (!holdKey && this.holding) {
      this.onCancel?.(this.holding);
      this.holding = null;
      this.holdT = 0;
    }
  }

  get holdingItem(): Interactable | null { return this.holding; }

  private isCandidate(it: Interactable, eye: Vec3, forward: Vec3, physics: PhysicsWorld): boolean {
    if (it.done) return false;
    const range = it.range ?? 2.2;
    const d = dist(eye, it.pos);
    if (d > range + 0.6) return false;
    const dx = it.pos.x - eye.x, dy = it.pos.y - eye.y, dz = it.pos.z - eye.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const facing = (dx * forward.x + dy * forward.y + dz * forward.z) / l;
    if (facing < 0.55 && d > 1.0) return false;
    if (it.needsSight && !physics.hasLineOfSight(eye, { x: it.pos.x, y: it.pos.y, z: it.pos.z })) return false;
    return true;
  }

  private pickFocus(eye: Vec3, forward: Vec3, physics: PhysicsWorld): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const it of this.items.values()) {
      if (!this.isCandidate(it, eye, forward, physics)) continue;
      const d = dist(eye, it.pos);
      const dx = it.pos.x - eye.x, dy = it.pos.y - eye.y, dz = it.pos.z - eye.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const facing = (dx * forward.x + dy * forward.y + dz * forward.z) / l;
      // Prefer usable items; then priority; then centred & close.
      const usable = it.check().ok ? 1 : 0;
      const score = usable * 4 + (it.priority ?? 0) * 0.6 + facing * 3 - d * 0.6;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }
}
