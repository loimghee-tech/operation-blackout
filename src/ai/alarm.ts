/**
 * Facility alarm state machine.
 *
 *  0 CALM       — normal operations
 *  1 UNEASY     — guards searching / radio chatter; no siren
 *  2 TRIGGERED  — siren; cameras and guards escalate; lockdown after a delay
 *  3 LOCKDOWN   — doors locked to civilians/staff; police waves spawn; perimeter timer runs
 *  4 FULL       — maximum response (adds a second wave cadence)
 *
 * Escalation sources and decay are data-driven here. The mission layer decides
 * what to do with callbacks (spawn response units, lock doors, fail the mission).
 */
import type { DifficultyConfig } from '../config/balance';

export const ALARM_LABELS = ['CALM', 'UNEASY', 'TRIGGERED', 'LOCKDOWN', 'FULL RESPONSE'] as const;

export interface AlarmCallbacks {
  onChange(level: number, label: string, reason: string): void;
  onLockdown(): void;
  onSpawnResponse(count: number): void;
  onPerimeterSealed(): void;
  onSiren(on: boolean): void;
}

export const PERIMETER_SECONDS = 150;

export class AlarmSystem {
  level = 0;
  private quietTime = 0;
  private levelTime = 0;
  /** Set when the alarm panel is disabled: caps escalation at TRIGGERED. */
  panelDisabled = false;
  /** Seconds until the next response wave (null = none scheduled). */
  private waveTimer: number | null = null;
  private waves = 0;
  /** Seconds until perimeter seals (null = not running). */
  perimeterTimer: number | null = null;
  lockedDown = false;
  sirenOn = false;
  /** Count of alarm-raising events (for stats). */
  triggerCount = 0;

  constructor(private diff: DifficultyConfig, private cb: AlarmCallbacks) {}

  get label(): string { return ALARM_LABELS[this.level]; }

  /** Raise (never lower) the alarm to at least `level`. */
  raise(level: number, reason: string): void {
    const cap = this.panelDisabled ? 2 : 4;
    const target = Math.min(cap, Math.max(0, Math.floor(level)));
    this.quietTime = 0;
    if (target <= this.level) return;
    this.setLevel(target, reason);
  }

  /** Cut / hack the alarm panel: prevents lockdown and response waves. */
  disablePanel(): void {
    this.panelDisabled = true;
    if (this.level > 2) this.setLevel(2, 'Alarm panel cut: response disabled');
    this.waveTimer = null;
    this.perimeterTimer = null;
  }

  private setLevel(level: number, reason: string): void {
    const prev = this.level;
    this.level = level;
    this.levelTime = 0;
    this.triggerCount++;
    if (level >= 2 && !this.sirenOn) { this.sirenOn = true; this.cb.onSiren(true); }
    this.cb.onChange(level, ALARM_LABELS[level], reason);
    if (level >= 3 && prev < 3) {
      this.lockedDown = true;
      this.cb.onLockdown();
      this.waveTimer = this.diff.responseFirstDelay;
      this.waves = 0;
      if (this.perimeterTimer === null) this.perimeterTimer = PERIMETER_SECONDS;
    }
  }

  update(dt: number, activeHostiles: number): void {
    if (this.level === 0) return;
    this.levelTime += dt;
    // Quiet decay: only when no hostile is actively engaged.
    if (activeHostiles === 0) this.quietTime += dt;
    else this.quietTime = 0;

    // Level 2 escalates to lockdown if it lingers without being resolved.
    if (this.level === 2 && !this.panelDisabled && this.levelTime > 28) this.setLevel(3, 'Trigger not resolved');

    // Decay (only below TRIGGERED: a siren stays on until the panel is cut or the scene is clear for long).
    const decayMult = this.diff.alarmDecayMult;
    if (this.level === 1 && this.quietTime > 45 / decayMult) { this.setLevel(0, 'Scene quiet'); }
    if (this.level === 2 && this.panelDisabled && this.quietTime > 60 / decayMult) { this.setLevel(1, 'Siren silenced'); this.sirenOn = false; this.cb.onSiren(false); }

    // Response waves
    if (this.lockedDown && !this.panelDisabled && this.waveTimer !== null) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waves++;
        const size = this.diff.responseWaveSize + (this.level >= 4 ? 2 : 0);
        this.cb.onSpawnResponse(size);
        this.waveTimer = this.diff.responseInterval * (this.level >= 4 ? 0.7 : 1);
      }
    }

    // Perimeter seal countdown
    if (this.perimeterTimer !== null && this.level >= 3 && !this.panelDisabled) {
      this.perimeterTimer -= dt;
      if (this.perimeterTimer <= 0) {
        this.perimeterTimer = null;
        this.cb.onPerimeterSealed();
      }
    }
  }

  /** Stops the perimeter countdown (e.g. player has already extracted). */
  stopPerimeter(): void {
    this.perimeterTimer = null;
  }

  get wavesSent(): number { return this.waves; }
}
