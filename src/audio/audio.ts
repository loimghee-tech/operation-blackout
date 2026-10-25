/**
 * Audio: procedurally synthesised with the Web Audio API, so the game needs no
 * sound files. Optional user-supplied files can be dropped in later via the
 * `loadSample` hook (not required). Every entry point is safe to call when audio
 * is unavailable: it simply does nothing.
 *
 * Buses: master → (music | sfx | dialogue | ambience), each driven by settings.
 * Positional sounds use a PannerNode relative to the listener (the camera).
 */
import type { Settings } from '../progression/settings';
import type { Vec3 } from '../core/types';

type Surface = string;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private busMusic!: GainNode;
  private busSfx!: GainNode;
  private busDialogue!: GainNode;
  private busAmbience!: GainNode;
  private noise: AudioBuffer | null = null;
  private alarmOsc: OscillatorNode | null = null;
  private alarmGain: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientGain: GainNode | null = null;
  private listener = { x: 0, y: 1.6, z: 0, yaw: 0 };
  private lastSfx = new Map<string, number>();
  private musicNodes: AudioNode[] = [];
  private muted = false;
  /** Whether audio is available (AudioContext could be created). */
  get available(): boolean { return this.ctx !== null; }

  constructor(private settings: Settings) {}

  /** Must be called from a user gesture (click/keypress) to unlock audio. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
        if (!Ctor) return;
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.busMusic = c.createGain();
      this.busSfx = c.createGain();
      this.busDialogue = c.createGain();
      this.busAmbience = c.createGain();
      this.busMusic.connect(this.master);
      this.busSfx.connect(this.master);
      this.busDialogue.connect(this.master);
      this.busAmbience.connect(this.master);
      this.master.connect(c.destination);
      this.noise = this.makeNoise(c, 1.5);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { /* ignore */ });
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : s.volumeMaster, t, 0.05);
    this.busMusic.gain.setTargetAtTime(s.volumeMusic * 0.5, t, 0.05);
    this.busSfx.gain.setTargetAtTime(s.volumeSfx, t, 0.05);
    this.busDialogue.gain.setTargetAtTime(s.volumeDialogue, t, 0.05);
    this.busAmbience.gain.setTargetAtTime(s.volumeAmbience * 0.6, t, 0.05);
  }

  setMuted(m: boolean): void { this.muted = m; this.applyVolumes(); }

  /** Listener follows the camera for positional audio. */
  setListener(p: Vec3, yaw: number): void {
    this.listener = { x: p.x, y: p.y, z: p.z, yaw };
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = -Math.sin(yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(yaw);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    }
  }

  private makeNoise(c: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private outputFor(bus: GainNode, pos?: Vec3): AudioNode {
    if (!this.ctx || !pos) return bus;
    const c = this.ctx;
    const panner = c.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = 90;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    panner.connect(bus);
    return panner;
  }

  /** Throttle identical sounds so bursts don't stack. */
  private throttled(name: string, minGap: number): boolean {
    const now = performance.now() / 1000;
    const last = this.lastSfx.get(name) ?? -1;
    if (now - last < minGap) return true;
    this.lastSfx.set(name, now);
    return false;
  }

  /** Generic burst: filtered noise with envelope. */
  private burst(opts: { bus?: GainNode; pos?: Vec3; dur: number; gain: number; freq: number; type?: BiquadFilterType; q?: number; attack?: number; sweepTo?: number }): void {
    if (!this.ctx || !this.noise) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 0.7;
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), c.currentTime + opts.dur);
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + (opts.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g);
    g.connect(this.outputFor(opts.bus ?? this.busSfx, opts.pos));
    src.start(t, Math.random() * 0.5);
    src.stop(t + opts.dur + 0.05);
  }

  /** Short synth tone (UI, alarms, hits). */
  private tone(opts: { bus?: GainNode; pos?: Vec3; freq: number; freq2?: number; dur: number; gain: number; type?: OscillatorType }): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = opts.type ?? 'sine';
    const t = c.currentTime;
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freq2) o.frequency.exponentialRampToValueAtTime(opts.freq2, t + opts.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g).connect(this.outputFor(opts.bus ?? this.busSfx, opts.pos));
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  gunshot(category: string, suppressed: boolean, pos?: Vec3): void {
    if (this.throttled('gunshot', 0.035)) return;
    if (suppressed) {
      this.burst({ pos, dur: 0.09, gain: 0.08, freq: 1400, q: 1.2 });
      return;
    }
    const heavy = category === 'shotgun' || category === 'precision' || category === 'lmg' || category === 'revolver';
    this.burst({ pos, dur: heavy ? 0.42 : 0.22, gain: heavy ? 0.9 : 0.55, freq: heavy ? 900 : 2200, sweepTo: 200 });
    this.tone({ pos, freq: heavy ? 90 : 160, freq2: 40, dur: heavy ? 0.35 : 0.15, gain: heavy ? 0.5 : 0.25, type: 'sine' });
  }

  footstep(surface: Surface, sprint: boolean, pos?: Vec3): void {
    if (this.throttled('step', 0.12)) return;
    const freq = surface === 'marble' ? 3600 : surface === 'metal' ? 2600 : surface === 'wood' ? 900 : surface === 'carpet' ? 500 : 1400;
    this.burst({ pos, dur: sprint ? 0.12 : 0.09, gain: sprint ? 0.22 : 0.12, freq, q: 0.9 });
  }

  impact(surface: Surface, pos?: Vec3): void {
    if (this.throttled('impact', 0.05)) return;
    const freq = surface === 'metal' ? 4200 : surface === 'glass' ? 6000 : 1800;
    this.burst({ pos, dur: 0.12, gain: 0.25, freq, type: 'highpass', q: 0.7 });
  }

  /** Named one-shot effects. */
  sfx(name: string, pos?: Vec3): void {
    if (!this.ctx) return;
    if (this.throttled(name, 0.04)) return;
    switch (name) {
      case 'hack': this.tone({ pos, freq: 880, freq2: 1760, dur: 0.25, gain: 0.12, type: 'square' }); break;
      case 'hack_ok': this.tone({ freq: 660, freq2: 1320, dur: 0.3, gain: 0.2, type: 'triangle' }); break;
      case 'hack_fail': this.tone({ freq: 220, freq2: 110, dur: 0.35, gain: 0.25, type: 'sawtooth' }); break;
      case 'loot': this.tone({ freq: 740, freq2: 1180, dur: 0.18, gain: 0.18, type: 'triangle' }); break;
      case 'container': this.burst({ pos, dur: 0.2, gain: 0.25, freq: 1200, type: 'bandpass', q: 2 }); break;
      case 'door': this.burst({ pos, dur: 0.35, gain: 0.3, freq: 300, type: 'lowpass', sweepTo: 120 }); break;
      case 'hurt': this.tone({ freq: 140, freq2: 70, dur: 0.25, gain: 0.25, type: 'sawtooth' }); break;
      case 'down': this.tone({ freq: 200, freq2: 60, dur: 0.6, gain: 0.3, type: 'triangle' }); break;
      case 'hit': this.tone({ pos, freq: 1500, freq2: 900, dur: 0.06, gain: 0.12, type: 'square' }); break;
      case 'radio': this.tone({ bus: this.busDialogue, freq: 2000, dur: 0.08, gain: 0.08, type: 'square' }); break;
      case 'voice': this.burst({ bus: this.busDialogue, pos, dur: 0.12, gain: 0.04, freq: 700, q: 3, type: 'bandpass' }); break;
      case 'alarm_hit': this.tone({ freq: 1000, freq2: 500, dur: 0.5, gain: 0.25, type: 'sawtooth' }); break;
      case 'reload': this.burst({ pos, dur: 0.08, gain: 0.25, freq: 3000, type: 'bandpass', q: 3 }); break;
      case 'empty': this.burst({ pos, dur: 0.04, gain: 0.2, freq: 4000, type: 'highpass' }); break;
      case 'swap': this.burst({ pos, dur: 0.07, gain: 0.12, freq: 2500, type: 'bandpass', q: 2 }); break;
      case 'throw': this.burst({ pos, dur: 0.2, gain: 0.08, freq: 800, type: 'bandpass' }); break;
      case 'explosion': this.burst({ pos, dur: 1.2, gain: 1.0, freq: 180, sweepTo: 40 }); break;
      case 'taser': this.burst({ pos, dur: 0.6, gain: 0.25, freq: 3000, type: 'bandpass', q: 4 }); break;
      case 'ability': this.tone({ freq: 300, freq2: 900, dur: 0.5, gain: 0.15, type: 'sine' }); break;
      case 'knife': this.burst({ pos, dur: 0.08, gain: 0.12, freq: 2400, type: 'highpass' }); break;
      case 'bat': this.burst({ pos, dur: 0.14, gain: 0.3, freq: 500, sweepTo: 200 }); break;
      case 'vault': this.burst({ pos, dur: 0.25, gain: 0.12, freq: 900, type: 'bandpass' }); break;
      case 'land': this.burst({ pos, dur: 0.12, gain: 0.25, freq: 300, sweepTo: 120 }); break;
      case 'drill': this.burst({ pos, dur: 0.4, gain: 0.25, freq: 2500, type: 'bandpass', q: 1 }); break;
      default: break;
    }
  }

  /** Siren on/off. */
  alarm(on: boolean): void {
    if (!this.ctx) return;
    if (on && !this.alarmOsc) {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 660;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.6;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(o.frequency);
      const g = c.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.05, c.currentTime + 0.5);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      o.connect(f).connect(g).connect(this.busAmbience);
      o.start();
      lfo.start();
      this.alarmOsc = o;
      this.alarmGain = g;
      this.alarmLfo = lfo;
    } else if (!on && this.alarmOsc) {
      const c = this.ctx!;
      this.alarmGain!.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
      const o = this.alarmOsc, l = this.alarmLfo;
      setTimeout(() => { try { o.stop(); l?.stop(); } catch { /* already stopped */ } }, 400);
      this.alarmOsc = null;
      this.alarmLfo = null;
      this.alarmGain = null;
    }
  }
  private alarmLfo: OscillatorNode | null = null;

  /** Ambience bed. level: -1 = off; 0..4 alarm pressure (adds tension). */
  setAmbient(level: number): void {
    if (!this.ctx) return;
    if (level < 0) {
      if (this.ambientGain) { this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); }
      return;
    }
    if (!this.ambientGain) {
      const c = this.ctx;
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.busAmbience);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = 52;
      o.connect(g);
      o.start();
      const n = c.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 420;
      f.Q.value = 0.4;
      const ng = c.createGain();
      ng.gain.value = 0.25;
      n.connect(f).connect(ng).connect(g);
      n.start();
      this.ambientNodes.push(o, n);
      this.ambientGain = g;
    }
    const target = 0.035 + level * 0.012;
    this.ambientGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6);
  }

  dispose(): void {
    this.alarm(false);
    for (const n of this.ambientNodes) { try { (n as AudioScheduledSourceNode).stop(); } catch { /* ignore */ } }
    this.ambientNodes = [];
    this.musicNodes = [];
    this.ambientGain = null;
  }
}
