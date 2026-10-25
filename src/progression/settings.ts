/**
 * User settings with defaults and normalisation (clamps bad/missing values).
 */
export interface Settings {
  mouseSensitivity: number;      // 0.1 .. 3
  invertY: boolean;
  fov: number;                   // 60 .. 100 (horizontal-ish vertical FOV degrees)
  adsSensitivityMult: number;    // 0.3 .. 1
  volumeMaster: number;          // 0..1
  volumeMusic: number;
  volumeSfx: number;
  volumeDialogue: number;
  volumeAmbience: number;
  subtitles: boolean;
  showFps: boolean;
  debugOverlay: boolean;
  renderScale: number;           // 0.5 .. 1.5
  shadows: 'off' | 'low' | 'high';
  effects: 'low' | 'high';
  viewDistance: number;          // metres for fog / NPC LOD (60..160)
  antialias: boolean;
  textScale: number;             // 0.8 .. 1.4
  highContrast: boolean;
  screenShake: number;           // 0..1
  toggleCrouch: boolean;
  toggleAim: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1.0,
  invertY: false,
  fov: 75,
  adsSensitivityMult: 0.75,
  volumeMaster: 0.8,
  volumeMusic: 0.5,
  volumeSfx: 0.9,
  volumeDialogue: 0.9,
  volumeAmbience: 0.6,
  subtitles: true,
  showFps: false,
  debugOverlay: false,
  renderScale: 1.0,
  shadows: 'high',
  effects: 'high',
  viewDistance: 110,
  antialias: true,
  textScale: 1.0,
  highContrast: false,
  screenShake: 0.5,
  toggleCrouch: false,
  toggleAim: false,
};

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

export function normalizeSettings(raw: Record<string, unknown> | null | undefined): Settings {
  const r = raw ?? {};
  const d = DEFAULT_SETTINGS;
  return {
    mouseSensitivity: clampNum(r.mouseSensitivity, 0.1, 3, d.mouseSensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    fov: clampNum(r.fov, 60, 100, d.fov),
    adsSensitivityMult: clampNum(r.adsSensitivityMult, 0.3, 1, d.adsSensitivityMult),
    volumeMaster: clampNum(r.volumeMaster, 0, 1, d.volumeMaster),
    volumeMusic: clampNum(r.volumeMusic, 0, 1, d.volumeMusic),
    volumeSfx: clampNum(r.volumeSfx, 0, 1, d.volumeSfx),
    volumeDialogue: clampNum(r.volumeDialogue, 0, 1, d.volumeDialogue),
    volumeAmbience: clampNum(r.volumeAmbience, 0, 1, d.volumeAmbience),
    subtitles: typeof r.subtitles === 'boolean' ? r.subtitles : d.subtitles,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : d.showFps,
    debugOverlay: typeof r.debugOverlay === 'boolean' ? r.debugOverlay : d.debugOverlay,
    renderScale: clampNum(r.renderScale, 0.5, 1.5, d.renderScale),
    shadows: r.shadows === 'off' || r.shadows === 'low' || r.shadows === 'high' ? r.shadows : d.shadows,
    effects: r.effects === 'low' || r.effects === 'high' ? r.effects : d.effects,
    viewDistance: clampNum(r.viewDistance, 60, 160, d.viewDistance),
    antialias: typeof r.antialias === 'boolean' ? r.antialias : d.antialias,
    textScale: clampNum(r.textScale, 0.8, 1.4, d.textScale),
    highContrast: typeof r.highContrast === 'boolean' ? r.highContrast : d.highContrast,
    screenShake: clampNum(r.screenShake, 0, 1, d.screenShake),
    toggleCrouch: typeof r.toggleCrouch === 'boolean' ? r.toggleCrouch : d.toggleCrouch,
    toggleAim: typeof r.toggleAim === 'boolean' ? r.toggleAim : d.toggleAim,
  };
}
