/**
 * Reusable mission framework: objectives with prerequisites, phases, stats and
 * outcome. Mission-specific logic lives in definitions (see bank.ts) that call
 * complete()/fail() in response to real gameplay events.
 */
import type { MissionPhase } from '../core/types';

export type ObjectiveState = 'hidden' | 'active' | 'done' | 'failed';

export interface ObjectiveDef {
  id: string;
  text: string;
  optional?: boolean;
  /** Objective ids that must be done before this one becomes active. */
  prereq?: string[];
  /** Starts hidden until revealed (e.g. by intel). */
  hidden?: boolean;
}

export interface Objective extends ObjectiveDef {
  state: ObjectiveState;
  progress?: string;
}

export interface MissionStats {
  shotsFired: number;
  kills: number;
  civiliansHarmed: number;
  crewDowned: number;
  hacksOk: number;
  hacksFailed: number;
  lootValue: number;
  optionalLootValue: number;
  primaryLootValue: number;
  detectionPeak: number;
  alarmTriggers: number;
  timeSeconds: number;
  playerDowns: number;
}

export function emptyStats(): MissionStats {
  return {
    shotsFired: 0, kills: 0, civiliansHarmed: 0, crewDowned: 0, hacksOk: 0, hacksFailed: 0,
    lootValue: 0, optionalLootValue: 0, primaryLootValue: 0, detectionPeak: 0, alarmTriggers: 0, timeSeconds: 0, playerDowns: 0,
  };
}

export class MissionRuntime {
  phase: MissionPhase = 'briefing';
  readonly objectives = new Map<string, Objective>();
  readonly order: string[] = [];
  stats: MissionStats = emptyStats();
  outcomeReason = '';
  onObjective?: (o: Objective, kind: 'added' | 'updated' | 'done' | 'failed') => void;
  onPhase?: (p: MissionPhase) => void;

  constructor(defs: ObjectiveDef[]) {
    for (const d of defs) {
      this.order.push(d.id);
      this.objectives.set(d.id, { ...d, state: d.hidden ? 'hidden' : 'active' });
    }
    this.refreshActivation();
  }

  setPhase(p: MissionPhase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.onPhase?.(p);
  }

  get active(): boolean { return this.phase === 'active' || this.phase === 'objectives_complete' || this.phase === 'extraction'; }

  get(id: string): Objective | undefined { return this.objectives.get(id); }
  isDone(id: string): boolean { return this.objectives.get(id)?.state === 'done'; }

  /** Makes an objective visible (intel reveal). */
  reveal(id: string): void {
    const o = this.objectives.get(id);
    if (!o || o.state !== 'hidden') return;
    o.state = this.prereqsDone(o) ? 'active' : 'hidden';
    if (o.state === 'active') this.onObjective?.(o, 'added');
  }

  setProgress(id: string, text: string): void {
    const o = this.objectives.get(id);
    if (!o || o.state !== 'active') return;
    if (o.progress === text) return;
    o.progress = text;
    this.onObjective?.(o, 'updated');
  }

  complete(id: string): boolean {
    const o = this.objectives.get(id);
    // Optional objectives hidden behind intel can still be achieved directly.
    if (!o || (o.state !== 'active' && !(o.state === 'hidden' && o.hidden))) return false;
    o.state = 'done';
    this.onObjective?.(o, 'done');
    this.refreshActivation();
    return true;
  }

  fail(id: string, reason: string): void {
    const o = this.objectives.get(id);
    if (!o || o.state === 'done' || o.state === 'failed') return;
    o.state = 'failed';
    this.outcomeReason = reason;
    this.onObjective?.(o, 'failed');
  }

  /** Activates objectives whose prerequisites are complete. */
  private refreshActivation(): void {
    for (const id of this.order) {
      const o = this.objectives.get(id)!;
      if (o.state === 'hidden' && !o.hidden && this.prereqsDone(o)) {
        o.state = 'active';
        this.onObjective?.(o, 'added');
      }
      if (o.state === 'active' && !this.prereqsDone(o)) o.state = 'hidden';
    }
  }

  private prereqsDone(o: ObjectiveDef): boolean {
    return (o.prereq ?? []).every((p) => this.objectives.get(p)?.state === 'done');
  }

  /** All required (non-optional) objectives done. */
  get primaryDone(): boolean {
    return this.order.every((id) => {
      const o = this.objectives.get(id)!;
      return o.optional || o.state === 'done';
    });
  }

  get optionalTotal(): number { return this.order.filter((id) => this.objectives.get(id)!.optional).length; }
  get optionalDone(): number { return this.order.filter((id) => { const o = this.objectives.get(id)!; return o.optional && o.state === 'done'; }).length; }

  /** Visible list for the tracker: active first, then done, skipping hidden. */
  visible(): Objective[] {
    return this.order.map((id) => this.objectives.get(id)!).filter((o) => o.state === 'active' || o.state === 'done' || o.state === 'failed');
  }
}
