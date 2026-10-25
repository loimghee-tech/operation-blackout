/**
 * App: top-level orchestration.
 *  - boot: settings, campaign load (with corruption recovery), Rocketbox probe
 *  - screens: menu router and UI event delegation
 *  - missions: deploy → play → pause → results, reward application and saving
 *  - main loop: renders menus (backdrop) or the active mission
 */
import * as THREE from 'three';
import { Input } from './core/input';
import { EventBus } from './core/events';
import type { GameEvents } from './core/gameEvents';
import { Rng } from './core/rng';
import { AudioManager } from './audio/audio';
import { SaveManager } from './save/save';
import { normalizeSettings, type Settings } from './progression/settings';
import {
  newCampaign, sanitizeCampaign, validateLoadout, repairLoadout, addXp, levelForXp, type CampaignState, type MissionRecord, defaultLoadout,
} from './progression/campaign';
import { computeRewards, type MissionOutcome } from './progression/economy';
import { CharacterLibrary } from './characters/human';
import { Hud, drawTacticalMap, drawLevelPreview, escapeHtml } from './ui/hud';
import { renderScreen, handleAction, handleChange, type ScreenName, type MenuApi, type ResultView } from './ui/menus';
import { ClassPreview } from './ui/preview';
import { MissionWorld, type MissionEndResult, type MissionDefinition } from './game/missionWorld';
import { BANK_DEFINITION, CONTRACTS } from './missions/bank';
import { BANK_LEVEL } from './missions/bankLevel';
import { buildLevel, type LevelRuntime } from './world/builder';
import { MODIFIER_POOL, type MissionModifier } from './config/balance';
import { CLASSES } from './config/classes';
import { CREW_BY_ID } from './config/crew';
import { GADGETS } from './config/gadgets';
import { WEAPONS } from './config/weapons';
import { ARMORS, DISGUISES } from './config/gadgets';

const MAX_DT = 0.05;

export class App {
  readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private ui = document.getElementById('ui') as HTMLElement;
  private overlay = document.getElementById('overlay') as HTMLElement;
  private hudHost = document.getElementById('hud-host') as HTMLElement;
  private hackHost = document.getElementById('hack-host') as HTMLElement;
  private boot = document.getElementById('boot') as HTMLElement;
  private bootStatus = document.getElementById('boot-status') as HTMLElement;
  readonly input: Input;
  readonly audio: AudioManager;
  readonly bus = new EventBus<GameEvents>();
  readonly lib = new CharacterLibrary();
  readonly save = new SaveManager();
  settings: Settings;
  campaign: CampaignState;
  private hud: Hud;
  private preview = new ClassPreview();
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private menuCam = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private backdrop: LevelRuntime | null = null;
  private sun = new THREE.DirectionalLight(0xffe6c0, 1.2);
  private hemi = new THREE.HemisphereLight(0x9fb8d8, 0x1a1f28, 0.9);
  private screen: ScreenName = 'main';
  private arg: string | undefined;
  mission: MissionWorld | null = null;
  private paused = false;
  private overlayMode: 'none' | 'pause' | 'settings' | 'map' | 'inventory' | 'objectives' | 'abort' = 'none';
  private deploying = false;
  private modifiers: MissionModifier[] = [];
  lastResult: ResultView | null = null;
  private saveNote = 'Campaign progress saves when a contract ends or you change your loadout.';
  private rocketboxNote = 'Character models: checking…';
  private hasSave = false;
  private menuApi: MenuApi;
  private lastT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private menuUpdateAcc = 0;
  private missionDef: MissionDefinition = BANK_DEFINITION;
  private orbitT = 0;
  private hasWebGL = true;
  private backdropDisposed = false;

  constructor() {
    this.settings = normalizeSettings(this.save.loadSettings());
    this.campaign = newCampaign();
    this.input = new Input(this.canvas);
    this.audio = new AudioManager(this.settings);
    this.hud = new Hud(this.hudHost);
    this.menuApi = this.buildMenuApi();
    this.hud.show(false);

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.antialias, powerPreference: 'high-performance' });
    } catch (err) {
      this.hasWebGL = false;
      console.error('[app] WebGL unavailable', err);
    }
    this.applyRendererSettings();
    this.scene.background = new THREE.Color(0x0a0f17);
    this.scene.fog = new THREE.FogExp2(0x1a2232, 0.012);
    this.scene.add(this.hemi, this.sun);
    this.sun.position.set(-30, 60, 25);
    this.sun.visible = false;

    this.input.onEscape = () => this.onEscape();
    this.input.onPointerLockChange(() => this.onPointerLockChange());
    this.input.onAnyKey = (code) => this.onKey(code);
    this.canvas.addEventListener('mousedown', () => this.onCanvasClick());
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pauseMission('Tab hidden'); });
    this.ui.addEventListener('click', (e) => this.onUiClick(e));
    this.ui.addEventListener('change', (e) => this.onUiChange(e));
    this.ui.addEventListener('input', (e) => this.onUiInput(e));
    this.overlay.addEventListener('click', (e) => this.onUiClick(e));
    this.overlay.addEventListener('change', (e) => this.onUiChange(e));
    this.overlay.addEventListener('input', (e) => this.onUiInput(e));
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  async start(): Promise<void> {
    this.bootStatus.textContent = 'Loading campaign…';
    const loaded = this.save.loadCampaign();
    if (loaded.data) {
      this.campaign = sanitizeCampaign(loaded.data);
      this.hasSave = true;
      this.saveNote = loaded.status === 'recovered-backup' ? 'Primary save was unreadable — restored from backup.' : loaded.status === 'migrated' ? 'Save migrated to the current version.' : 'Campaign loaded.';
    } else if (loaded.status === 'corrupt') {
      this.hasSave = false;
      this.saveNote = `${loaded.message ?? 'Save corrupted.'} Starting fresh — your old data is kept until you save.`;
    } else {
      this.saveNote = loaded.message ?? 'No campaign yet. Start a New Campaign.';
    }
    if (!this.save.available) this.saveNote = 'Browser storage unavailable: progress will not persist.';
    this.bootStatus.textContent = 'Preparing audio & visuals…';
    if (this.hasWebGL) this.buildBackdrop();
    this.lib.init().then(() => {
      this.rocketboxNote = this.lib.message;
      this.renderMenu();
    }).catch(() => { this.rocketboxNote = 'Character models unavailable.'; });
    this.renderMenu();
    this.lastT = performance.now();
    requestAnimationFrame(this.frame);
    this.boot.classList.add('done');
    setTimeout(() => this.boot.remove(), 700);
  }

  private applyRendererSettings(): void {
    if (!this.renderer) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.settings.renderScale;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2.5, dpr)));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.settings.shadows !== 'off';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = this.settings.shadows !== 'off';
    const size = this.settings.shadows === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.camera.left = -50; this.sun.shadow.camera.right = 50;
    this.sun.shadow.camera.top = 50; this.sun.shadow.camera.bottom = -50;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.menuCam.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.menuCam.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = 2.6 / Math.max(40, this.settings.viewDistance);
    }
    document.documentElement.style.setProperty('--ts', String(this.settings.textScale));
    document.documentElement.toggleAttribute('data-hc', this.settings.highContrast);
    this.hud.setFps(this.settings.showFps ? '' : null);
  }

  private onResize(): void {
    this.applyRendererSettings();
    if (this.mission) {
      const cam = this.mission.camera;
      cam.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      cam.updateProjectionMatrix();
    }
  }

  /** Background orbit around the bank for the menus. */
  private buildBackdrop(): void {
    try {
      this.backdrop = buildLevel(BANK_LEVEL, this.scene);
      this.sun.visible = true;
      this.scene.fog = new THREE.FogExp2(BANK_LEVEL.environment.fogColor, 0.008);
      this.scene.background = new THREE.Color(BANK_LEVEL.environment.skyBottom);
    } catch (err) {
      console.warn('[app] backdrop unavailable', err);
      this.backdrop = null;
    }
  }

  private disposeBackdrop(): void {
    if (this.backdrop && !this.backdropDisposed) {
      this.backdrop.dispose();
      this.backdrop = null;
      this.backdropDisposed = true;
    }
  }

  // -------------------------------------------------------------------------
  // Menu API & routing
  // -------------------------------------------------------------------------
  private buildMenuApi(): MenuApi {
    return {
      get campaign() { return appRef!.campaign; },
      get settings() { return appRef!.settings; },
      get hasSave() { return appRef!.hasSave; },
      get saveNote() { return appRef!.saveNote; },
      get rocketboxNote() { return appRef!.rocketboxNote; },
      get lastResult() { return appRef!.lastResult; },
      go: (s, a) => this.go(s, a),
      save: () => this.saveCampaign(),
      newCampaign: () => this.newCampaign(),
      clearSave: () => this.clearSave(),
      continueCampaign: () => this.continueCampaign(),
      startContract: (id) => this.go('briefing', id),
      deploy: () => this.deploy(),
      applySettings: () => this.applySettings(),
      toast: (t, k) => this.hud.toast(t, k),
      currentModifiers: () => this.modifiers.map((m) => ({ label: m.label, description: m.description })),
      rerollModifiers: () => this.rollModifiers(),
    };
  }

  go(screen: ScreenName, arg?: string): void {
    this.screen = screen;
    this.arg = arg;
    if (screen === 'main' || screen === 'hub') this.disposeTransientPreview();
    this.renderMenu();
  }

  private disposeTransientPreview(): void { this.preview.unmount(); }

  renderMenu(): void {
    if (this.inGame) return;
    this.overlayMode = 'none';
    this.overlay.innerHTML = '';
    this.ui.classList.remove('in-game');
    const { html, preview, classId } = renderScreen(this.screen, this.menuApi, this.arg);
    this.ui.innerHTML = html;
    this.ui.scrollTop = 0;
    if (preview === 'class') {
      const box = document.getElementById('class-preview');
      const def = CLASSES[classId as keyof typeof CLASSES] ?? CLASSES.loud;
      if (box) this.preview.mount(box, def);
    } else {
      this.preview.unmount();
    }
    if (this.screen === 'planning') this.drawPlanMap();
    this.ui.classList.remove('hidden');
  }

  private drawPlanMap(): void {
    const c = document.getElementById('plan-map') as HTMLCanvasElement | null;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawLevelPreview(c, BANK_LEVEL, { entry: this.campaign.plan.entry, escape: this.campaign.plan.escape });
  }

  private rollModifiers(): void {
    const rng = new Rng((Date.now() ^ (this.campaign.stats.missionsRun * 7919)) >>> 0);
    const pool = rng.shuffled(MODIFIER_POOL);
    // Pick 2 modifiers; never stack two that conflict (e.g. loud + quiet_day is allowed; two response buffs are not).
    const picks: MissionModifier[] = [];
    for (const m of pool) {
      if (picks.length >= 2) break;
      if (picks.some((p) => (p.effects.responseDelayMult && m.effects.responseDelayMult) || (p.effects.skeletonCrewResponse && m.effects.skeletonCrewResponse))) continue;
      picks.push(m);
    }
    this.modifiers = picks;
  }

  private newCampaign(): void {
    this.campaign = newCampaign();
    this.campaign.started = false;
    this.hasSave = false;
    this.saveNote = 'New campaign started. Choose an operator to begin.';
    this.save.clearCampaign();
    this.go('class');
  }

  private continueCampaign(): void {
    if (!this.hasSave) { this.go('class'); return; }
    this.go(this.campaign.classId ? 'hub' : 'class');
  }

  private clearSave(): void {
    this.save.clearCampaign();
    this.campaign = newCampaign();
    this.hasSave = false;
    this.saveNote = 'Campaign erased.';
  }

  private saveCampaign(): void {
    const ok = this.save.saveCampaign({ ...this.campaign } as unknown as Record<string, unknown>);
    if (ok) {
      this.hasSave = true;
      this.saveNote = `Saved ${new Date().toLocaleTimeString('en-AU')}.`;
    } else {
      this.saveNote = `SAVE FAILED: ${this.save.lastWriteError ?? 'unknown error'} — progress is kept for this session only.`;
      this.hud.toast('Save failed. Progress only lives in this tab.', 'warn');
    }
  }

  private applySettings(): void {
    this.settings = normalizeSettings(this.settings as unknown as Record<string, unknown>);
    this.save.saveSettings(this.settings as unknown as Record<string, unknown>);
    this.audio.applyVolumes();
    this.applyRendererSettings();
    if (this.mission) this.mission.camera.fov = this.settings.fov;
  }

  // -------------------------------------------------------------------------
  // Deploy & mission lifecycle
  // -------------------------------------------------------------------------
  private deploy(): void {
    if (this.deploying || this.mission) return;
    const c = this.campaign;
    if (!c.classId) { this.go('class'); return; }
    const fixed = repairLoadout(c, c.loadout);
    const problems = validateLoadout(c, fixed);
    if (problems.length) { this.hud.toast(`Loadout invalid: ${problems[0]}`, 'warn'); this.go('loadout'); return; }
    const plan = c.plan;
    const def = this.missionDef;
    if (!def.entryIds.includes(plan.entry) || !def.escapeIds.includes(plan.escape)) { this.hud.toast('Plan incompatible with this contract.', 'warn'); return; }
    // Crew fees
    const crewIds = plan.crew.filter((id) => c.crewHired.includes(id));
    const fees = crewIds.reduce((sum, id) => sum + (CREW_BY_ID[id]?.missionFee ?? 0), 0);
    if (fees > c.money) { this.hud.toast(`Not enough money for crew fees (${fees}).`, 'warn'); return; }
    if (!this.modifiers.length) this.rollModifiers();
    c.money -= fees;
    c.loadout = fixed;
    if (!this.hasWebGL || !this.renderer) { this.hud.toast('WebGL is required to play.', 'warn'); c.money += fees; return; }

    this.deploying = true;
    this.audio.unlock();
    this.showGate('Deploying operators…', 'Loading the building and crew.');
    const rng = new Rng((Date.now() & 0xffffffff) ^ 0x5eed);
    const diff = plan.difficulty;
    const bus = this.bus;
    const modifiers = this.modifiers.slice();
    // cleanup backdrop before the mission level is built to free memory
    this.disposeBackdrop();
    this.scene.clear();
    this.scene.add(this.hemi, this.sun);
    this.sun.visible = true;
    this.scene.background = new THREE.Color(BANK_LEVEL.environment.skyBottom);
    this.scene.fog = new THREE.FogExp2(BANK_LEVEL.environment.fogColor, 2.6 / Math.max(40, this.settings.viewDistance));
    this.hemi.intensity = 0.55;
    this.sun.intensity = 0.55;
    this.sun.position.set(-40, 70, 30);
    this.sun.target.position.set(0, 0, 0);
    if (!this.scene.children.includes(this.sun.target)) this.scene.add(this.sun.target);
    this.applyRendererSettings();

    this.preview.dispose();
    const classId = c.classId;
    window.setTimeout(() => {
      try {
        const world = new MissionWorld({
          scene: this.scene, settings: this.settings, input: this.input, audio: this.audio, lib: this.lib, hud: this.hud,
          hackHost: this.hackHost, bus, def, plan, loadout: fixed, classId, skillIds: c.skills.slice(),
          crewIds, crewTiers: { ...c.crewTier }, ownedGadgetCounts: {}, ownedDisguises: c.ownedDisguises.slice(),
          intelIds: c.plan.intel.filter((i) => c.intelPurchased.includes(i)), rng, canvasSize: { width: window.innerWidth, height: window.innerHeight },
          modifiers, onEnd: (res) => this.onMissionEnd(res),
        });
        this.mission = world;
        this.mission.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        this.mission.camera.updateProjectionMatrix();
        this.paused = false;
        this.waitForVisuals(world).then(() => {
          this.deploying = false;
          this.hideGate();
          this.enterGame();
          world.start();
          this.input.requestLock();
        });
      } catch (err) {
        console.error('[app] mission failed to start', err);
        this.deploying = false;
        this.hideGate();
        this.hud.toast('Mission failed to start. See console.', 'warn');
        c.money += fees;
        this.mission = null;
        this.go('loadout');
      }
    }, 60);
    void diff;
  }

  private async waitForVisuals(world: MissionWorld): Promise<void> {
    const start = performance.now();
    while (world.npcVisualsPending > 0 && performance.now() - start < 4000) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  private enterGame(): void {
    this.inGame = true;
    this.ui.classList.add('hidden');
    this.hud.show(true);
    this.ui.innerHTML = '';
  }
  private inGame = false;

  private exitGame(): void {
    this.inGame = false;
    this.hud.show(false);
    this.overlay.innerHTML = '';
    this.overlayMode = 'none';
    this.ui.classList.remove('hidden');
  }

  private pauseMission(reason: string): void {
    if (!this.mission || this.mission.ended || this.paused) return;
    this.paused = true;
    this.mission.setPaused(true);
    this.input.exitLock();
    this.input.reset();
    this.showPause(reason);
  }

  private resumeMission(): void {
    if (!this.mission || this.mission.ended) return;
    this.paused = false;
    this.mission.setPaused(false);
    this.overlay.innerHTML = '';
    this.overlayMode = 'none';
    this.input.requestLock();
  }

  private showPause(reason = ''): void {
    this.overlayMode = 'pause';
    this.overlay.innerHTML = `<div class="pause"><div class="pause-card" role="dialog" aria-label="Paused">
      <h2>PAUSED</h2>
      ${reason ? `<p class="muted small" style="text-align:center">${escapeHtml(reason)}</p>` : ''}
      <button class="btn primary" data-ov="resume">Resume</button>
      <button class="btn" data-ov="map">Tactical map (M)</button>
      <button class="btn" data-ov="objectives">Objectives</button>
      <button class="btn" data-ov="inventory">Inventory (I)</button>
      <button class="btn" data-ov="settings">Settings</button>
      <button class="btn danger" data-ov="abort">Abort contract…</button>
    </div></div>`;
  }

  private showGate(title: string, text: string): void {
    this.overlay.innerHTML = `<div class="gate"><div class="gate-card"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(text)}</p></div></div>`;
  }
  private hideGate(): void {
    if (this.overlayMode === 'none') this.overlay.innerHTML = '';
  }

  private onMissionEnd(res: MissionEndResult): void {
    const c = this.campaign;
    const outcome: MissionOutcome = res.outcome;
    const rewards = computeRewards(outcome);
    const levelsBefore = levelForXp(c.xp);
    const gained = addXp(c, rewards.xp);
    c.money += rewards.money;
    c.reputation = Math.max(0, c.reputation + rewards.rep);
    c.stats.missionsRun += 1;
    if (res.success) c.stats.missionsWon += 1;
    c.stats.shotsFired += res.stats.shotsFired;
    c.stats.hacks += res.stats.hacksOk;
    c.stats.totalLoot += res.stats.lootValue;
    if (res.success) {
      if (!c.completedMissions.includes(res.def.id)) c.completedMissions.push(res.def.id);
    }
    const rec: MissionRecord = {
      missionId: res.def.name, classId: res.classId, result: res.success ? 'success' : 'failed', payout: rewards.money,
      xp: rewards.xp, rep: rewards.rep, date: new Date().toISOString(), approach: res.approach, detection: outcome.detectionPeak, difficulty: res.difficulty,
    };
    c.history.push(rec);
    if (c.history.length > 100) c.history.splice(0, c.history.length - 100);
    c.plan.crew = c.plan.crew.slice();
    this.lastResult = {
      success: res.success, reason: res.reason, money: rewards.money, xp: rewards.xp, rep: rewards.rep,
      breakdown: rewards.lines, stats: res.stats, objectivesDone: res.objectivesDone, approach: res.approach,
      classLabel: CLASSES[res.classId].name, levelUps: gained, levelBefore: levelsBefore,
    };
    this.saveCampaign();
    this.mission?.dispose();
    this.mission = null;
    this.paused = false;
    this.modifiers = [];
    this.input.exitLock();
    this.scene.clear();
    this.exitGame();
    this.scene.fog = new THREE.FogExp2(0x1a2232, 0.012);
    this.scene.background = new THREE.Color(0x0a0f17);
    this.sun.visible = false;
    this.hemi.intensity = 0.9;
    this.scene.add(this.hemi, this.sun);
    this.backdropDisposed = false;
    this.buildBackdrop();
    this.go('results');
  }

  private abortMission(): void {
    if (!this.mission) return;
    this.mission.abort('Contract aborted by the operator.');
  }

  private onEscape(): void {
    if (this.inGame && this.mission && !this.mission.ended) {
      if (this.paused) this.resumeMission();
      else this.pauseMission('');
    }
  }

  private onPointerLockChange(): void {
    if (!this.inGame || !this.mission || this.mission.ended) return;
    if (!this.input.locked && !this.paused && !this.deploying) {
      this.pauseMission('Mouse released — click the game to resume.');
    }
  }

  private onCanvasClick(): void {
    if (this.inGame && this.mission && !this.input.locked && !this.paused) this.input.requestLock();
    if (this.inGame && this.paused && this.overlayMode === 'pause') { /* keep paused */ }
  }

  private onKey(code: string): void {
    if (!this.inGame || !this.mission || this.mission.ended) return;
    if (this.paused) return;
    if (code === 'KeyM') this.toggleOverlay('map');
    if (code === 'KeyI') this.toggleOverlay('inventory');
    if (code === 'Tab') this.toggleOverlay('objectives');
  }

  private toggleOverlay(mode: 'map' | 'inventory' | 'objectives'): void {
    if (this.overlayMode === mode) {
      this.overlay.innerHTML = '';
      this.overlayMode = 'none';
      this.input.requestLock();
      return;
    }
    this.overlayMode = mode;
    this.input.exitLock();
    this.mission?.setUiBlocked(true);
    if (mode === 'inventory') this.renderInventory();
    if (mode === 'map') this.renderMap();
    if (mode === 'objectives') this.renderObjectives();
  }

  private renderMap(): void {
    if (!this.mission) return;
    const m = this.mission;
    this.overlay.innerHTML = `<div class="overlay-panel" role="dialog" aria-label="Tactical map">
      <div class="row"><h2>Tactical map</h2><span class="muted">M to close · reveals depend on your tools</span></div>
      <canvas id="map-canvas" class="map-canvas" width="900" height="600"></canvas>
      <p class="muted small">Doors: red locked · amber closed · green open. Cones show live camera coverage. Crew are green.</p></div>`;
    this.drawMapFrame();
  }

  private drawMapFrame(): void {
    const m = this.mission;
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement | null;
    if (!m || !cv || this.overlayMode !== 'map') return;
    drawTacticalMap(cv, {
      player: m.player.feet, playerYaw: m.player.yaw, npcs: m.npcs.npcs, extraction: m.escapeSpawnPos,
      revealNpcs: m.revealActive, revealDevices: m.revealActive, showCameras: true, level: BANK_LEVEL, runtime: m.level,
      loot: m.lootMarkers(),
    });
  }

  private renderInventory(): void {
    if (!this.mission) return;
    const m = this.mission;
    const l = this.campaign.loadout;
    const slots = m.weaponSlotInfo();
    const gadgets = l.gadgets.map((g) => (g ? `${GADGETS[g].name} ×${m.gadgetLeft(g)}` : 'Empty')).join(' · ');
    this.overlay.innerHTML = `<div class="overlay-panel" role="dialog" aria-label="Inventory">
      <div class="row"><h2>Inventory</h2><span class="muted">I to close</span></div>
      <div class="two-col">
        <section class="panel"><header class="panel-title">Weapons</header>${slots.map((s, i) => `<div class="kv"><span><kbd>${i + 1}</kbd> ${escapeHtml(s.label)}</span><b>${escapeHtml(s.value)}</b></div>`).join('')}</section>
        <section class="panel"><header class="panel-title">Equipment</header>
          <div class="kv"><span>Armour</span><b>${escapeHtml(ARMORS[l.armor].name)} · ${m.player.armor.toFixed(0)} / ${m.player.stats.maxArmor}</b></div>
          <div class="kv"><span>Gadgets</span><b>${escapeHtml(gadgets)}</b></div>
          <div class="kv"><span>Throwable</span><b>${l.throwable ? escapeHtml(GADGETS[l.throwable].name) : 'None'}</b></div>
          <div class="kv"><span>Disguise</span><b>${escapeHtml(DISGUISES[l.disguise].name)}</b></div>
          <div class="kv"><span>Ammunition</span><b>${escapeHtml(l.ammo)}</b></div>
          <div class="kv"><span>Loot carried</span><b class="money">$${m.lootTotalValue.toLocaleString()}</b></div>
          <p class="muted small">Weapon loadouts and gadgets are chosen before deployment (Loadout screen). Select weapons with 1–3 or the mouse wheel.</p>
        </section>
      </div></div>`;
  }

  private renderObjectives(): void {
    if (!this.mission) return;
    const list = this.mission.rt.visible();
    this.overlay.innerHTML = `<div class="overlay-panel" role="dialog" aria-label="Objectives">
      <div class="row"><h2>Objectives</h2><span class="muted">Tab/Esc to close</span></div>
      <ul class="objectives-list">${list.map((o) => `<li class="${o.state}">${escapeHtml(o.text)}${o.optional ? ' <em>optional</em>' : ''} <small>${o.state === 'done' ? 'COMPLETE' : o.progress ? escapeHtml(o.progress) : ''}</small></li>`).join('')}</ul>
      <p class="muted">Primary: ${this.mission.rt.primaryDone ? '<span class="good">complete</span>' : 'in progress'}. Optional: ${this.mission.rt.optionalDone}/${this.mission.rt.optionalTotal}.</p></div>`;
  }

  private onUiClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-ov]');
    if (!t) return;
    if (t.dataset.ov) return this.onOverlayAction(t.dataset.ov);
    const act = t.dataset.act!;
    const arg = t.dataset.arg ?? '';
    if (t.hasAttribute('disabled')) return;
    if (act === 'go' && arg.startsWith('briefing')) { /* normal */ }
    e.preventDefault();
    handleAction(this.menuApi, act, arg, t);
  }

  private onOverlayAction(act: string): void {
    switch (act) {
      case 'resume': this.resumeMission(); break;
      case 'map': this.toggleOverlay('map'); break;
      case 'inventory': this.toggleOverlay('inventory'); break;
      case 'objectives': this.toggleOverlay('objectives'); break;
      case 'settings': this.overlayMode = 'settings'; this.renderOverlaySettings(); break;
      case 'close': this.overlay.innerHTML = ''; this.overlayMode = 'pause'; this.showPause(); break;
      case 'abort':
        if (window.confirm('Abort this contract? You will leave without payout and lose reputation.')) {
          this.abortMission();
        }
        break;
      default: break;
    }
  }

  private renderOverlaySettings(): void {
    const s = this.settings;
    const row = (label: string, key: keyof Settings, min: number, max: number, step: number) =>
      `<label class="setting"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key] as number}" data-set="settings.${key}"></label>`;
    this.overlay.innerHTML = `<div class="overlay-panel" role="dialog" aria-label="Settings"><h2>Quick settings</h2>
      ${row('Mouse sensitivity', 'mouseSensitivity', 0.1, 3, 0.05)}
      ${row('Field of view', 'fov', 60, 100, 1)}
      ${row('Master volume', 'volumeMaster', 0, 1, 0.05)}
      ${row('Effects volume', 'volumeSfx', 0, 1, 0.05)}
      ${row('Dialogue volume', 'volumeDialogue', 0, 1, 0.05)}
      <label class="setting"><span>Invert Y</span><input type="checkbox" data-set="settings.invertY" ${s.invertY ? 'checked' : ''}></label>
      <label class="setting"><span>Subtitles</span><input type="checkbox" data-set="settings.subtitles" ${s.subtitles ? 'checked' : ''}></label>
      <label class="setting"><span>Debug overlay</span><input type="checkbox" data-set="settings.debugOverlay" ${s.debugOverlay ? 'checked' : ''}></label>
      <div class="row"><button class="btn" data-ov="close">Back</button></div>
      <p class="muted small">Full settings are on the Settings screen from the main menu.</p></div>`;
  }

  private onUiChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (!t.dataset) return;
    if (this.inGame && this.overlayMode !== 'settings') return;
    if (this.overlayMode === 'settings' && t.dataset.set?.startsWith('settings.')) this.onInGameSetting(t);
    if (!this.inGame) handleChange(this.menuApi, t);
  }

  private onUiInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.type === 'range' && t.dataset.set?.startsWith('settings.')) {
      if (this.inGame) this.onInGameSetting(t);
      else {
        const out = t.parentElement?.querySelector('output');
        if (out) out.textContent = Number(t.value) < 2 && Number(t.step) < 1 ? Number(t.value).toFixed(2) : String(Math.round(Number(t.value)));
        handleChange(this.menuApi, t);
      }
    }
  }

  private onInGameSetting(t: HTMLInputElement | HTMLSelectElement): void {
    const key = t.dataset.set!.slice(9) as keyof Settings;
    const val = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t instanceof HTMLInputElement && t.type === 'range' ? Number(t.value) : t.value;
    (this.settings as unknown as Record<string, unknown>)[key] = val;
    this.applySettings();
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;

    // FPS
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsFrames = 0;
      this.fpsAcc = 0;
      if (this.settings.showFps) this.hud.setFps(`FPS ${this.fps}`);
    }

    if (this.inGame && this.mission) {
      const m = this.mission;
      if (!this.paused && !m.ended) m.update(dt);
      else this.input.endFrame();
      if (!m.ended) {
        this.hud.tick(dt, m.player.yaw);
        this.audio.setListener(m.player.eyePos({ x: 0, y: 0, z: 0 }), m.player.yaw);
        if (this.settings.debugOverlay) this.hud.setDebug(JSON.stringify(m.debugInfo(), null, 1));
        else this.hud.setDebug(null);
        if (this.overlayMode === 'map') this.drawMapFrame();
        if (this.overlayMode === 'objectives') this.renderObjectives();
        this.renderer?.render(this.scene, m.camera);
      }
    } else {
      this.input.endFrame();
      if (this.backdrop && this.renderer) {
        this.orbitT += dt * 0.05;
        const r = 62;
        this.menuCam.position.set(Math.cos(this.orbitT) * r, 16 + Math.sin(this.orbitT * 0.7) * 2, Math.sin(this.orbitT) * r);
        this.menuCam.lookAt(0, 3, 0);
        this.renderer.render(this.scene, this.menuCam);
      } else if (this.renderer) {
        this.renderer.setClearColor(0x05080d, 1);
        this.renderer.clear();
      }
    }
    this.menuUpdateAcc += dt;
  };

  /** Used by the debug tooling and tests. */
  get state(): Record<string, unknown> {
    return {
      screen: this.screen,
      inGame: this.inGame,
      paused: this.paused,
      overlay: this.overlayMode,
      fps: this.fps,
      mission: this.mission?.debugInfo() ?? null,
      campaignClass: this.campaign.classId,
      loadoutProblems: validateLoadout(this.campaign, this.campaign.loadout),
      plan: this.campaign.plan,
      money: this.campaign.money,
      hasSave: this.hasSave,
    };
  }
}

let appRef: App | null = null;
export function registerApp(a: App): void { appRef = a; }

// Expose for tests / QA
export { BANK_DEFINITION, CONTRACTS, defaultLoadout, WEAPONS, ARMORS, CREW_BY_ID, GADGETS };
export type { ResultView };
