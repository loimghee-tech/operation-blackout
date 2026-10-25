/**
 * In-mission HUD (DOM overlay) and the tactical map (canvas).
 * The HUD is a thin, data-driven view: MissionWorld pushes state each frame,
 * and only changed text/attributes are written to the DOM.
 */
import type { Vec3 } from '../core/types';
import type { LevelData } from '../world/level';
import type { DoorRuntime, LevelRuntime } from '../world/builder';
import type { Npc } from '../ai/npc';

export interface HudApi {
  setWeaponSlots(names: string[]): void;
  setWeaponActive(slot: number): void;
  setAmmo(name: string, mag: number, reserve: number, melee: boolean): void;
  setReload(duration: number): void;
  setHealth(hp: number, armor: number, downed: boolean, bleedout: number): void;
  setHurt(v: number): void;
  setLoot(total: number, carry: number): void;
  setAbility(name: string, cd: number, active: boolean): void;
  setGadgets(gadgets: Array<{ name: string; uses: number; slot: number } | null>, sel: number, throwable: { name: string; uses: number } | null): void;
  setCrosshair(mode: 'default' | 'enemy' | 'interact' | 'ads' | 'reload', usable: boolean): void;
  setInteract(label: string, usable: boolean, reason: string | undefined, progress: number, holding: boolean): void;
  setObjectives(list: Array<{ id: string; text: string; state: string; optional: boolean; progress?: string }>): void;
  setAlarm(level: number, label: string): void;
  setSuspicion(v: number, label: string): void;
  setCrew(list: Array<{ id: string; name: string; hp: number; status: string }>): void;
  setCrewPanel(open: boolean): void;
  setTimer(seconds: number | null, label: string): void;
  setExtraction(progress: number, label: string): void;
  setChannel(label: string, progress: number): void;
  setCameraCount(active: number, offline: boolean): void;
  setFlash(v: number): void;
  toast(text: string, kind?: 'info' | 'warn' | 'success' | 'objective'): void;
  subtitle(speaker: string, text: string): void;
  hitMarker(kill: boolean): void;
  damageFrom(from: Vec3, me: Vec3): void;
  readonly overlayOpen: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`HUD element missing: ${sel}`);
  return el;
};

export const HUD_MARKUP = `
<div id="hud" class="hud hidden" aria-live="polite">
  <div id="crosshair" class="crosshair"><span></span><span></span><span></span><span></span><i></i></div>
  <div id="hit-marker" class="hit-marker"></div>
  <div id="hurt" class="hurt"></div>
  <div id="flash" class="flash"></div>
  <div id="damage-dir" class="damage-dir"></div>

  <div class="hud-tl panel">
    <div class="alarm-row"><span class="label">ALARM</span><span id="alarm-label" class="value">CALM</span></div>
    <div class="alarm-bar"><div id="alarm-fill"></div></div>
    <div class="suspicion-row"><span class="label">SUSPICION</span><span id="sus-label" class="value">HIDDEN</span></div>
    <div class="sus-bar"><div id="sus-fill"></div></div>
    <div id="timer-row" class="timer-row hidden"><span id="timer-label"></span><strong id="timer-value"></strong></div>
    <div id="cams" class="cams-row"></div>
  </div>

  <div class="hud-tr panel objectives">
    <div class="panel-title">OBJECTIVES <kbd>TAB</kbd></div>
    <ul id="objectives"></ul>
  </div>

  <div class="hud-bl">
    <div class="vitals panel">
      <div class="bar health"><div id="hp-fill"></div><span id="hp-text">100</span></div>
      <div class="bar armor"><div id="armor-fill"></div><span id="armor-text">ARMOUR</span></div>
      <div id="downed" class="downed hidden">DOWN — bleeding out <strong id="bleed"></strong>s · crew can revive you</div>
    </div>
    <div class="gadgets panel">
      <div id="gadget-list"></div>
      <div id="ability" class="ability"></div>
    </div>
  </div>

  <div class="hud-br panel ammo">
    <div class="weapon-name" id="weapon-name">—</div>
    <div class="ammo-count"><span id="mag">0</span><small>/<span id="reserve">0</span></small></div>
    <div class="weapon-slots" id="weapon-slots"></div>
    <div id="reload-bar" class="reload-bar hidden"><div></div></div>
    <div id="loot" class="loot"></div>
  </div>

  <div class="hud-ml">
    <div id="crew" class="panel crew"><div class="panel-title">CREW <kbd>C</kbd></div><div id="crew-list"></div>
      <div id="crew-cmd" class="crew-cmd hidden"><div>1 Follow · 2 Hold · 3 Regroup · 4 Cover · 5 Assist</div></div>
    </div>
  </div>

  <div id="interact" class="interact hidden">
    <div class="prompt"><kbd>E</kbd><span id="interact-label"></span></div>
    <div class="interact-reason" id="interact-reason"></div>
    <div class="hold-bar hidden" id="hold-bar"><div></div></div>
  </div>

  <div id="channel" class="channel hidden"><span id="channel-label"></span><div class="channel-bar"><div></div></div></div>

  <div id="extraction" class="extraction hidden"><span id="extract-label"></span><div class="extract-bar"><div></div></div></div>

  <div id="toasts" class="toasts"></div>
  <div id="subtitles" class="subtitles"></div>
  <div id="debug" class="debug hidden"></div>
  <div id="fps" class="fps hidden"></div>
  <div id="crosshair-hint" class="hidden"></div>
</div>`;

interface ToastEntry { el: HTMLElement; t: number }

export class Hud implements HudApi {
  private root: HTMLElement;
  private toastsEl: HTMLElement;
  private subsEl: HTMLElement;
  private lastText = new Map<string, string>();
  private toasts: ToastEntry[] = [];
  private subsT = 0;
  private hitT = 0;
  private hurtFlashVal = 0;
  overlayOpen = false;
  private lastHp = -1;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', HUD_MARKUP);
    this.root = $('#hud', host);
    this.toastsEl = $('#toasts', host);
    this.subsEl = $('#subtitles', host);
  }

  show(on: boolean): void { this.root.classList.toggle('hidden', !on); }

  private set(id: string, text: string): void {
    if (this.lastText.get(id) === text) return;
    this.lastText.set(id, text);
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  private setW(id: string, pct: number): void {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  private toggle(id: string, on: boolean): void {
    document.getElementById(id)?.classList.toggle('hidden', !on);
  }

  setWeaponSlots(names: string[]): void {
    const el = document.getElementById('weapon-slots');
    if (!el) return;
    el.innerHTML = names.map((n, i) => `<span data-slot="${i}"><kbd>${i + 1}</kbd>${escapeHtml(n)}</span>`).join('');
  }

  setWeaponActive(slot: number): void {
    document.querySelectorAll<HTMLElement>('#weapon-slots span').forEach((s) => s.classList.toggle('active', Number(s.dataset.slot) === slot));
  }

  setAmmo(name: string, mag: number, reserve: number, melee: boolean): void {
    this.set('weapon-name', name);
    this.set('mag', melee ? '—' : String(mag));
    this.set('reserve', melee ? '—' : String(reserve));
  }

  setReload(duration: number): void {
    const el = document.getElementById('reload-bar');
    if (!el) return;
    el.classList.toggle('hidden', duration <= 0);
    if (duration > 0) {
      el.dataset.dur = String(duration);
      el.dataset.start = String(performance.now());
      el.querySelector('div')!.style.animation = `reload ${duration}s linear forwards`;
    }
  }

  setHealth(hp: number, armor: number, downed: boolean, bleedout: number): void {
    const hpPct = hp * 100;
    this.setW('hp-fill', hpPct);
    this.set('hp-text', String(Math.round(hp * 100)));
    this.setW('armor-fill', armor * 100);
    this.set('armor-text', armor > 0 ? `ARMOUR ${Math.round(armor * 100)}%` : 'NO ARMOUR');
    this.toggle('downed', downed);
    if (downed) this.set('bleed', bleedout.toFixed(0));
    if (this.lastHp !== hp) { this.lastHp = hp; }
  }

  setHurt(v: number): void {
    this.hurtFlashVal = v;
    const el = document.getElementById('hurt');
    if (el) el.style.opacity = String(Math.min(0.5, v));
  }

  setLoot(total: number, carry: number): void {
    this.set('loot', `LOOT $${total.toLocaleString()} · BAG ${carry}`);
  }

  setAbility(name: string, cd: number, active: boolean): void {
    this.set('ability', `[X] ${name}${active ? ' — ACTIVE' : cd > 0 ? ` — ${Math.ceil(cd)}s` : ' — READY'}`);
    document.getElementById('ability')?.classList.toggle('ready', !active && cd <= 0);
  }

  setGadgets(gadgets: Array<{ name: string; uses: number; slot: number } | null>, sel: number, throwable: { name: string; uses: number } | null): void {
    const html = gadgets.map((g, i) => g
      ? `<div class="gadget ${i === sel ? 'sel' : ''}"><kbd>${i === 0 ? 'Z·F' : 'Z·F'}</kbd>${escapeHtml(g.name)} <span>×${g.uses}</span></div>`
      : `<div class="gadget empty"><kbd>—</kbd>empty</div>`).join('');
    const thr = throwable ? `<div class="gadget throw"><kbd>G</kbd>${escapeHtml(throwable.name)} <span>×${throwable.uses}</span></div>` : '';
    const key = html + thr;
    if (this.lastText.get('gadgets') !== key) {
      this.lastText.set('gadgets', key);
      const el = document.getElementById('gadget-list');
      if (el) el.innerHTML = key;
    }
  }

  setCrosshair(mode: 'default' | 'enemy' | 'interact' | 'ads' | 'reload', usable: boolean): void {
    const el = document.getElementById('crosshair');
    if (!el) return;
    el.dataset.mode = mode;
    el.classList.toggle('usable', usable);
  }

  setInteract(label: string, usable: boolean, reason: string | undefined, progress: number, holding: boolean): void {
    const el = document.getElementById('interact');
    if (!el) return;
    el.classList.toggle('hidden', !label);
    el.classList.toggle('blocked', !usable && !!label);
    this.set('interact-label', label ? label : '');
    this.set('interact-reason', label && !usable && reason ? reason : '');
    const hb = document.getElementById('hold-bar');
    if (hb) {
      hb.classList.toggle('hidden', !holding);
      hb.querySelector('div')!.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  setObjectives(list: Array<{ id: string; text: string; state: string; optional: boolean; progress?: string }>): void {
    const key = JSON.stringify(list);
    if (this.lastText.get('objectives') === key) return;
    this.lastText.set('objectives', key);
    const ul = document.getElementById('objectives');
    if (!ul) return;
    ul.innerHTML = list.map((o) => `<li class="${o.state}${o.optional ? ' optional' : ''}">
      <span class="box">${o.state === 'done' ? '✓' : o.state === 'failed' ? '✕' : ''}</span>
      <span class="text">${escapeHtml(o.text)}${o.optional ? ' <em>optional</em>' : ''}${o.progress ? `<small>${escapeHtml(o.progress)}</small>` : ''}</span></li>`).join('');
  }

  setAlarm(level: number, label: string): void {
    this.set('alarm-label', label);
    this.setW('alarm-fill', (level / 4) * 100);
    document.querySelector('.hud-tl')?.setAttribute('data-alarm', String(level));
  }

  setSuspicion(v: number, label: string): void {
    this.set('sus-label', label);
    this.setW('sus-fill', v * 100);
    document.querySelector('.hud-tl')?.setAttribute('data-sus', label);
  }

  setCrew(list: Array<{ id: string; name: string; hp: number; status: string }>): void {
    const key = JSON.stringify(list.map((c) => [c.id, Math.round(c.hp * 10), c.status]));
    if (this.lastText.get('crew') === key) return;
    this.lastText.set('crew', key);
    const el = document.getElementById('crew-list');
    if (!el) return;
    el.innerHTML = list.length === 0 ? '<div class="muted">No crew with you</div>' : list.map((c) =>
      `<div class="crew-row ${c.status === 'DOWN' ? 'down' : ''}"><span>${escapeHtml(c.name)}</span><span class="crew-status">${escapeHtml(c.status)}</span><div class="crew-hp"><div style="width:${Math.round(Math.max(0, c.hp) * 100)}%"></div></div></div>`).join('');
  }

  setCrewPanel(open: boolean): void {
    this.overlayOpen = open;
    this.toggle('crew-cmd', open);
  }

  setTimer(seconds: number | null, label: string): void {
    this.toggle('timer-row', seconds !== null);
    if (seconds !== null) {
      this.set('timer-label', label);
      const s = Math.max(0, Math.ceil(seconds));
      this.set('timer-value', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }
  }

  setExtraction(progress: number, label: string): void {
    this.toggle('extraction', true);
    this.set('extract-label', label);
    const bar = document.querySelector<HTMLElement>('#extraction .extract-bar div');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  }

  setChannel(label: string, progress: number): void {
    const el = document.getElementById('channel');
    if (!el) return;
    el.classList.toggle('hidden', !label);
    this.set('channel-label', label);
    const bar = el.querySelector<HTMLElement>('.channel-bar div');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  }

  setCameraCount(active: number, offline: boolean): void {
    this.set('cams', offline ? 'CAMERAS OFFLINE' : `CAMERAS ${active} LIVE`);
    const el = document.getElementById('cams');
    if (el) el.classList.toggle('offline', offline);
  }

  setFlash(v: number): void {
    const el = document.getElementById('flash');
    if (el) el.style.opacity = String(Math.max(0, Math.min(1, v)));
  }

  toast(text: string, kind: 'info' | 'warn' | 'success' | 'objective' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastsEl.prepend(el);
    this.toasts.push({ el, t: 4.2 });
    while (this.toasts.length > 5) {
      const old = this.toasts.shift()!;
      old.el.remove();
    }
  }

  subtitle(speaker: string, text: string): void {
    this.subsEl.innerHTML = `<span class="speaker">${escapeHtml(speaker)}</span> ${escapeHtml(text)}`;
    this.subsT = 3.6 + text.length * 0.03;
    this.subsEl.classList.add('on');
  }

  hitMarker(kill: boolean): void {
    const el = document.getElementById('hit-marker');
    if (!el) return;
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
    this.hitT = 0.25;
  }

  damageFrom(from: Vec3, me: Vec3): void {
    const el = document.getElementById('damage-dir');
    if (!el) return;
    const ang = Math.atan2(from.x - me.x, from.z - me.z);
    el.style.setProperty('--ang', `${ang}rad`);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** Per-frame timers (fade out toasts/subtitles, hit marker). */
  tick(dt: number, yaw: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.t -= dt;
      if (t.t <= 0.6) t.el.style.opacity = String(Math.max(0, t.t / 0.6));
      if (t.t <= 0) { t.el.remove(); this.toasts.splice(i, 1); }
    }
    if (this.subsT > 0) {
      this.subsT -= dt;
      if (this.subsT <= 0) this.subsEl.classList.remove('on');
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) document.getElementById('hit-marker')?.classList.remove('show', 'kill');
    }
    const dd = document.getElementById('damage-dir');
    if (dd) dd.style.setProperty('--yaw', `${yaw}rad`);
  }

  setDebug(text: string | null): void {
    const el = document.getElementById('debug');
    if (!el) return;
    el.classList.toggle('hidden', text === null);
    if (text !== null) el.textContent = text;
  }

  setFps(text: string | null): void {
    const el = document.getElementById('fps');
    if (!el) return;
    el.classList.toggle('hidden', text === null);
    if (text !== null) el.textContent = text;
  }

  dispose(): void { this.root.remove(); }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

// ---------------------------------------------------------------------------
// Tactical map (canvas) — draws the level, doors, cameras, NPCs and objectives.
// ---------------------------------------------------------------------------
export interface MapData {
  player: Vec3;
  playerYaw: number;
  npcs: Npc[];
  extraction: Vec3 | null;
  revealNpcs: boolean;
  revealDevices: boolean;
  showCameras: boolean;
  level: LevelData;
  runtime: LevelRuntime;
  loot: Array<{ pos: Vec3; collected: boolean; visible: boolean; optional: boolean }>;
}

export function drawTacticalMap(canvas: HTMLCanvasElement, data: MapData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const b = data.level.bounds;
  const pad = 20;
  const sx = (W - pad * 2) / (Math.min(44, b.x1) - Math.max(-44, b.x0));
  const sz = (H - pad * 2) / (Math.min(44, b.z1) - Math.max(-44, b.z0));
  const s = Math.min(sx, sz);
  const ox = W / 2, oz = H / 2;
  const tx = (x: number) => ox + x * s;
  const tz = (z: number) => oz + z * s;
  ctx.fillStyle = '#0b1118';
  ctx.fillRect(0, 0, W, H);
  // grid
  ctx.strokeStyle = 'rgba(120,160,190,0.06)';
  ctx.lineWidth = 1;
  for (let x = -40; x <= 40; x += 5) { ctx.beginPath(); ctx.moveTo(tx(x), 0); ctx.lineTo(tx(x), H); ctx.stroke(); }
  for (let z = -40; z <= 40; z += 5) { ctx.beginPath(); ctx.moveTo(0, tz(z)); ctx.lineTo(W, tz(z)); ctx.stroke(); }
  // rooms
  for (const r of data.level.rooms) {
    if (r.id === 'street') continue;
    ctx.fillStyle = r.tags.includes('vault') ? 'rgba(255,190,80,0.14)' : r.tags.includes('staff') || r.tags.includes('security') ? 'rgba(120,150,190,0.12)' : 'rgba(120,200,160,0.10)';
    ctx.fillRect(tx(r.x0), tz(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
    ctx.fillStyle = 'rgba(200,215,230,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(r.name.toUpperCase(), tx(r.x0) + 4, tz(r.z0) + 13);
  }
  // walls (solid obstacles)
  ctx.fillStyle = 'rgba(190,205,220,0.55)';
  for (const bx of data.level.boxes) {
    if (bx.kind !== 'wall') continue;
    const w = Math.max(1.5, (bx.max.x - bx.min.x) * s), h = Math.max(1.5, (bx.max.z - bx.min.z) * s);
    ctx.fillRect(tx(bx.min.x), tz(bx.min.z), w, h);
  }
  // doors
  for (const d of data.runtime.doorList) {
    const open = d.open;
    ctx.fillStyle = d.locked ? '#ff5a4a' : open ? '#4dffa6' : '#ffc94d';
    const cx = (d.def.x0 + d.def.x1) / 2, cz = (d.def.z0 + d.def.z1) / 2;
    ctx.beginPath(); ctx.arc(tx(cx), tz(cz), 3.2, 0, Math.PI * 2); ctx.fill();
  }
  // loot
  for (const l of data.loot) {
    if (l.collected || !l.visible) continue;
    ctx.fillStyle = l.optional ? '#7ddcff' : '#ffd24a';
    ctx.fillRect(tx(l.pos.x) - 2.5, tz(l.pos.z) - 2.5, 5, 5);
  }
  // cameras (cones)
  if (data.showCameras) {
    for (const c of data.runtime.cameras) {
      const cx = tx(c.def.position.x), cz = tz(c.def.position.z);
      ctx.fillStyle = 'rgba(255,80,80,0.12)';
      ctx.beginPath();
      ctx.moveTo(cx, cz);
      const a0 = c.yaw - c.def.fov / 2, a1 = c.yaw + c.def.fov / 2;
      ctx.arc(cx, cz, c.def.range * s, a0 + Math.PI / 2 * 0, a1 + 0, false);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff6a6a';
      ctx.fillRect(cx - 2, cz - 2, 4, 4);
    }
  }
  // devices
  if (data.revealDevices) {
    for (const d of data.runtime.devices.values()) {
      ctx.strokeStyle = '#66d9ff';
      ctx.strokeRect(tx(d.def.position.x) - 4, tz(d.def.position.z) - 4, 8, 8);
    }
  }
  // NPCs
  for (const n of data.npcs) {
    if (!n.alive) continue;
    const visible = data.revealNpcs || n.kind === 'crew' || n.state === 'combat' || n.state === 'alerted';
    if (!visible) continue;
    const col = n.kind === 'crew' ? '#4dffa6' : n.isCombatant ? (n.state === 'combat' ? '#ff4040' : '#ff9a4a') : n.kind === 'civilian' ? '#c8d4e0' : '#9ab4ff';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(tx(n.pos.x), tz(n.pos.z), 3, 0, Math.PI * 2); ctx.fill();
  }
  // extraction
  if (data.extraction) {
    ctx.strokeStyle = '#4dffa6';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx(data.extraction.x), tz(data.extraction.z), 4.5 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }
  // player
  const px = tx(data.player.x), pz = tz(data.player.z);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-data.playerYaw + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  // legend
  ctx.fillStyle = 'rgba(200,215,230,0.7)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('N ↑ (−Z)   ■ loot   ● doors: red locked · amber closed · green open   ▲ you', 12, H - 10);
}

/** Simple level preview for the planning screen (static). */
export function drawLevelPreview(canvas: HTMLCanvasElement, level: LevelData, highlight: { entry?: string; escape?: string }): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const s = Math.min((W - 40) / 52, (H - 40) / 52);
  const tx = (x: number) => W / 2 + x * s;
  const tz = (z: number) => H / 2 + z * s;
  ctx.fillStyle = '#0b1118';
  ctx.fillRect(0, 0, W, H);
  for (const r of level.rooms) {
    if (r.id === 'street') continue;
    ctx.fillStyle = r.tags.includes('vault') ? 'rgba(255,190,80,0.2)' : 'rgba(120,200,160,0.12)';
    ctx.fillRect(tx(r.x0), tz(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
    ctx.strokeStyle = 'rgba(200,215,230,0.35)';
    ctx.strokeRect(tx(r.x0), tz(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
  }
  const markers: Array<[string, number, number, string]> = [
    ['FRONT', 0, 13, highlight.entry === 'front' ? '#4dffa6' : '#8899aa'],
    ['STAFF', 18.5, 0, highlight.entry === 'staff' ? '#4dffa6' : '#8899aa'],
    ['SERVICE', 15, -13, highlight.entry === 'service' ? '#4dffa6' : '#8899aa'],
    ['VAN', 8, 18.6, highlight.escape === 'van_street' ? '#ffc94d' : '#667788'],
    ['CAR', 23.4, 7, highlight.escape === 'alley_car' ? '#ffc94d' : '#667788'],
    ['N-ROUTE', 12, -24, highlight.escape === 'service_tunnel' ? '#ffc94d' : '#667788'],
  ];
  ctx.font = '11px system-ui, sans-serif';
  for (const [label, x, z, col] of markers) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(tx(x), tz(z), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(label, tx(x) + 6, tz(z) + 4);
  }
}

export type { DoorRuntime };
