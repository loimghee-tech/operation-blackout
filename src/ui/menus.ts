/**
 * Menu screens: main menu, class selection, operations hub & contract board,
 * briefing, heist planning, loadout, armory (shop), crew, skills, settings,
 * credits and mission results. Every control dispatches a real action.
 */
import type { CampaignState, Loadout, PlanChoices, AmmoType } from '../progression/campaign';
import {
  AMMO_TYPES, attachmentsFor, validateLoadout, purchase, hireCrew, upgradeCrew, unlockSkill, skillStatus,
  xpForNextLevel, levelForXp, crewSlots, type ShopItem, defaultLoadout, grantClassStarter,
} from '../progression/campaign';
import type { Settings } from '../progression/settings';
import { DEFAULT_SETTINGS } from '../progression/settings';
import { CLASS_LIST, CLASSES } from '../config/classes';
import { WEAPONS, ATTACHMENTS, effectiveWeaponStats } from '../config/weapons';
import { ARMORS, GADGETS, DISGUISES, type GadgetId, type ArmorId, type DisguiseId } from '../config/gadgets';
import { CREW, CREW_BY_ID } from '../config/crew';
import { SKILL_TREES, SKILLS, XP_TABLE, MAX_LEVEL } from '../config/skills';
import { DIFFICULTIES } from '../config/balance';
import type { Difficulty } from '../core/types';
import { CONTRACTS, type ContractInfo } from '../missions/bank';
import { escapeHtml } from './hud';
import type { MissionEndResult } from '../game/missionWorld';

export type ScreenName = 'main' | 'class' | 'hub' | 'briefing' | 'planning' | 'loadout' | 'armory' | 'crew' | 'skills' | 'settings' | 'credits' | 'results';

export interface ResultView {
  success: boolean;
  reason: string;
  money: number;
  xp: number;
  rep: number;
  breakdown: Array<{ label: string; value: number; kind: 'money' | 'xp' | 'rep' | 'penalty' }>;
  stats: MissionEndResult['stats'];
  objectivesDone: string[];
  approach: string;
  classLabel: string;
  levelUps: number;
  levelBefore: number;
}

export interface MenuApi {
  campaign: CampaignState;
  settings: Settings;
  hasSave: boolean;
  saveNote: string;
  rocketboxNote: string;
  lastResult: ResultView | null;
  go(screen: ScreenName, arg?: string): void;
  save(): void;
  newCampaign(): void;
  clearSave(): void;
  continueCampaign(): void;
  startContract(id: string): void;
  deploy(): void;
  applySettings(): void;
  toast(text: string, kind?: 'info' | 'warn' | 'success'): void;
  currentModifiers(): Array<{ label: string; description: string }>;
  rerollModifiers(): void;
  /** Pauses the hub music etc. */
  onScreen?(s: ScreenName): void;
}

const fmt = (n: number): string => `$${Math.round(n).toLocaleString()}`;
const esc = escapeHtml;

const btn = (act: string, label: string, arg = '', cls = '', extra = ''): string =>
  `<button type="button" class="btn ${cls}" data-act="${act}" data-arg="${esc(arg)}" ${extra}>${esc(label)}</button>`;

const panel = (title: string, body: string, cls = ''): string =>
  `<section class="panel ${cls}"><header class="panel-title">${esc(title)}</header>${body}</section>`;

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
function frame(title: string, body: string, nav = true, crumbs = ''): string {
  const navHtml = nav ? `
    <nav class="topnav">
      ${btn('go', 'Hub', 'hub', 'nav')}
      ${btn('go', 'Loadout', 'loadout', 'nav')}
      ${btn('go', 'Armory', 'armory', 'nav')}
      ${btn('go', 'Crew', 'crew', 'nav')}
      ${btn('go', 'Skills', 'skills', 'nav')}
      ${btn('go', 'Settings', 'settings', 'nav')}
      ${btn('go', 'Menu', 'main', 'nav ghost')}
    </nav>` : '';
  return `<div class="screen">
    <header class="screen-head">
      <div class="brand-mini">OPERATION: <b>BLACKOUT</b></div>
      ${navHtml}
    </header>
    <div class="screen-title"><h1>${esc(title)}</h1>${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}</div>
    <div class="screen-body">${body}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
export function renderScreen(name: ScreenName, api: MenuApi, arg?: string): { html: string; preview?: 'class'; classId?: string } {
  const c = api.campaign;
  switch (name) {
    case 'main': return { html: mainMenu(api) };
    case 'class': return { html: classSelect(api), preview: 'class', classId: c.classId ?? undefined };
    case 'hub': return { html: hub(api) };
    case 'briefing': return { html: briefing(api, arg ?? 'bank_central') };
    case 'planning': return { html: planning(api, arg ?? 'bank_central') };
    case 'loadout': return { html: loadout(api) };
    case 'armory': return { html: armory(api) };
    case 'crew': return { html: crew(api) };
    case 'skills': return { html: skills(api) };
    case 'settings': return { html: settings(api) };
    case 'credits': return { html: credits() };
    case 'results': return { html: results(api) };
  }
}

function mainMenu(api: MenuApi): string {
  const c = api.campaign;
  const continueDisabled = !api.hasSave ? 'disabled' : '';
  return `<div class="screen main-menu">
    <div class="hero">
      <div class="hero-kicker">A HEIST IN THREE DIMENSIONS</div>
      <h1 class="hero-title">OPERATION<br><span>BLACKOUT</span></h1>
      <p class="hero-sub">Plan the job. Pick your crew. Own the building — or walk out of it unseen.</p>
    </div>
    <nav class="menu-list" aria-label="Main menu">
      ${btn('newcampaign', 'New Campaign', '', 'primary big')}
      ${btn('continue', 'Continue', '', 'big', continueDisabled)}
      ${btn('go', 'Contract Board', 'hub', 'big')}
      ${btn('go', 'Loadout', 'loadout', 'big')}
      ${btn('go', 'Crew Management', 'crew', 'big')}
      ${btn('go', 'Skills', 'skills', 'big')}
      ${btn('go', 'Operations Hub', 'hub', 'big')}
      ${btn('go', 'Settings', 'settings', 'big')}
      ${btn('go', 'Credits', 'credits', 'big')}
    </nav>
    <footer class="menu-foot">
      <div>${c.started ? `Operator class: <b>${esc(c.classId ? CLASSES[c.classId].name : 'none')}</b> · Money ${fmt(c.money)} · Reputation ${c.reputation}` : 'No active campaign.'}</div>
      <div class="muted">${esc(api.saveNote)}</div>
      <div class="muted">${esc(api.rocketboxNote)}</div>
    </footer>
  </div>`;
}

function classSelect(api: MenuApi): string {
  const cur = api.campaign.classId;
  const cards = CLASS_LIST.map((cl) => {
    const sel = cur === cl.id ? 'selected' : '';
    return `<button type="button" class="class-card ${sel}" style="--accent:${cl.accentColor}" data-act="pickclass" data-arg="${cl.id}" aria-pressed="${cur === cl.id}">
      <div class="cc-tag">${esc(cl.tagline)}</div>
      <div class="cc-name">${esc(cl.name)}</div>
      <div class="cc-desc">${esc(cl.description.slice(0, 120))}…</div>
    </button>`;
  }).join('');
  const cl = cur ? CLASSES[cur] : CLASS_LIST[0];
  const stat = (label: string, v: number, lo = 0.5, hi = 1.3, inverse = false) => {
    const pct = Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
    return `<div class="stat"><span>${esc(label)}</span><div class="stat-bar"><div style="width:${inverse ? 100 - pct : pct}%"></div></div></div>`;
  };
  const detail = `
    <div class="class-detail" style="--accent:${cl.accentColor}">
      <div class="preview-wrap"><div id="class-preview" class="preview-box"></div></div>
      <div class="detail-text">
        <div class="cc-tag">${esc(cl.tagline)}</div>
        <h2>${esc(cl.name)}</h2>
        <p>${esc(cl.description)}</p>
        <div class="two-col">
          <div><h4>Strengths</h4><ul>${cl.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
          <div><h4>Trade-offs</h4><ul class="warn">${cl.tradeoffs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
        </div>
        <h4>Starting statistics</h4>
        <div class="stats-grid">
          ${stat('Health', cl.stats.healthMult, 0.8, 1.2)}
          ${stat('Armour', cl.stats.armorMult, 0.6, 1.3)}
          ${stat('Weapon handling', cl.stats.weaponHandlingMult, 0.7, 1.1, true)}
          ${stat('Movement noise', cl.stats.noiseMult, 0.5, 1.2, true)}
          ${stat('Suspicion resist', cl.stats.suspicionResist, 0, 0.5)}
          ${stat('Hacking speed', cl.stats.hackSpeedMult, 0.5, 1.2, true)}
        </div>
        <h4>Starting equipment</h4>
        <ul class="equip">
          <li>Primary: ${esc(WEAPONS[cl.loadout.primary].name)}</li>
          <li>Sidearm: ${esc(WEAPONS[cl.loadout.secondary].name)}</li>
          <li>Melee: ${esc(WEAPONS[cl.loadout.melee].name)}</li>
          <li>Armour: ${esc(ARMORS[cl.loadout.armor].name)}</li>
          <li>Gadgets: ${cl.loadout.gadgets.map((g) => esc(GADGETS[g].name)).join(', ')} · Throwable: ${cl.loadout.throwables.map((g) => esc(GADGETS[g].name)).join(', ')}</li>
          <li>Starting disguise: ${esc(DISGUISES[cl.loadout.startingDisguise].name)}</li>
        </ul>
        <h4>Passive bonuses</h4>
        <ul>${cl.passives.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <h4>Signature ability — <kbd>X</kbd> ${esc(cl.ability.name)}</h4>
        <p>${esc(cl.ability.description)} <span class="muted">(cooldown ${cl.ability.cooldown}s)</span></p>
        <h4>Skill affinity</h4>
        <p class="muted">${Object.entries(cl.stats.treeAffinity).map(([k, v]) => `${k} skills ${Math.round((1 - (v ?? 1)) * 100)}% cheaper`).join(' · ') || 'Balanced across all trees'}</p>
        <div class="row gap">
          ${btn('confirmclass', cur === cl.id ? 'Continue with this operator' : `Select ${cl.name}`, cl.id, 'primary')}
          ${btn('go', 'Back', 'main')}
        </div>
      </div>
    </div>`;
  return frame('Choose your operator', `<div class="class-grid">${cards}</div>${detail}`, false);
}

function hub(api: MenuApi): string {
  const c = api.campaign;
  const cls = c.classId ? CLASSES[c.classId] : null;
  const xp = xpForNextLevel(c);
  const pct = xp.next ? ((xp.current === xp.next ? 1 : (c.xp - xp.current) / (xp.next - xp.current)) * 100) : 100;
  const contracts = CONTRACTS.map((k: ContractInfo) => {
    const avail = k.status === 'available';
    return `<article class="contract ${avail ? '' : 'locked'}">
      <div class="contract-head"><h3>${esc(k.name)}</h3><span class="tag ${avail ? 'ok' : ''}">${avail ? 'AVAILABLE' : 'LOCKED'}</span></div>
      <p>${esc(k.blurb)}</p>
      ${k.definition ? `<div class="contract-meta">Primary value ${fmt(k.definition.primaryLootValue)} · Par ${Math.round(k.definition.parTime / 60)} min</div>` : `<div class="muted">${esc(k.unlockNote ?? '')}</div>`}
      <div class="row">${avail ? btn('contract', cls ? 'Review contract' : 'Pick operator first', k.id, 'primary') : btn('noop', 'Unavailable', '', 'ghost', 'disabled')}</div>
    </article>`;
  }).join('');
  const hist = c.history.slice(-6).reverse().map((h) => `<tr><td>${esc(h.date.slice(0, 10))}</td><td>${esc(h.missionId)}</td><td class="${h.result === 'success' ? 'good' : 'bad'}">${h.result.toUpperCase()}</td><td>${fmt(h.payout)}</td><td>${h.xp} XP</td><td>${esc(h.approach)}</td></tr>`).join('');
  const body = `
    <div class="grid-hub">
      ${panel('Operator', `
        <div class="kv"><span>Class</span><b>${cls ? esc(cls.name) : '<em>Not selected</em>'}</b></div>
        <div class="kv"><span>Money</span><b class="money">${fmt(c.money)}</b></div>
        <div class="kv"><span>Reputation</span><b>${c.reputation}</b></div>
        <div class="kv"><span>Level</span><b>${c.level} / ${MAX_LEVEL + 1}</b></div>
        <div class="xp"><div style="width:${Math.min(100, pct)}%"></div></div>
        <div class="muted small">${c.xp.toLocaleString()} XP ${xp.next ? `· next level at ${xp.next.toLocaleString()}` : '· max level'}</div>
        <div class="kv"><span>Skill points</span><b>${c.skillPoints}</b></div>
        <div class="kv"><span>Crew</span><b>${c.crewHired.length} / ${crewSlots(c)} slots</b></div>
        <div class="row gap">${btn('go', 'Skills', 'skills')}${btn('go', 'Crew', 'crew')}</div>
      `)}
      ${panel('Statistics', `
        <div class="kv"><span>Contracts run</span><b>${c.stats.missionsRun}</b></div>
        <div class="kv"><span>Contracts won</span><b>${c.stats.missionsWon}</b></div>
        <div class="kv"><span>Shots fired</span><b>${c.stats.shotsFired}</b></div>
        <div class="kv"><span>Hacks</span><b>${c.stats.hacks}</b></div>
        <div class="kv"><span>Total loot</span><b>${fmt(c.stats.totalLoot)}</b></div>
        <div class="row">${btn('newcampaign', 'Start a new campaign', '', 'danger small')}</div>
      `)}
    </div>
    <h2 class="section">Contract board</h2>
    <div class="contract-grid">${contracts}</div>
    <h2 class="section">Recent operations</h2>
    ${hist ? `<table class="table"><thead><tr><th>Date</th><th>Contract</th><th>Result</th><th>Payout</th><th>XP</th><th>Approach</th></tr></thead><tbody>${hist}</tbody></table>` : '<p class="muted">No operations on record yet.</p>'}
  `;
  return frame('Operations Hub', body);
}

function briefing(api: MenuApi, contractId: string): string {
  const k = CONTRACTS.find((x) => x.id === contractId);
  if (!k || !k.definition) return frame('Contract', '<p>Contract unavailable.</p>');
  const d = k.definition;
  const body = `
    <div class="briefing">
      <div class="briefing-main">
        ${panel('Dossier', `<div class="dossier">${d.briefing.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`)}
        ${panel('Objectives', `<ol class="objectives-list">${d.objectives.filter((o) => !o.hidden).map((o) => `<li class="${o.optional ? 'optional' : ''}">${esc(o.text)}${o.optional ? ' <em>optional</em>' : ''}</li>`).join('')}</ol>
          <p class="muted small">Some optional objectives are only revealed by intelligence purchased in planning.</p>`)}
      </div>
      <div class="briefing-side">
        ${panel('Target', `<div class="kv"><span>Location</span><b>${esc(d.name)}</b></div>
          <div class="kv"><span>Primary value</span><b class="money">${fmt(d.primaryLootValue)}</b></div>
          <div class="kv"><span>Par time</span><b>${Math.round(d.parTime / 60)} min</b></div>
          <div class="kv"><span>Subtitle</span><b>${esc(d.subtitle)}</b></div>`)}
        <div class="row gap">${btn('startplanning', 'Plan the heist', contractId, 'primary big')}${btn('go', 'Back to board', 'hub')}</div>
      </div>
    </div>`;
  return frame(d.name, body, true, `<span>Contract</span> › <span>Briefing</span>`);
}

export function planningOptions(c: CampaignState): { entries: Array<[string, string]>; escapes: Array<[string, string]> } {
  return {
    entries: [['front', 'Front entrance — public lobby, cameras and guards'], ['staff', 'Staff entrance — needs staff access or a hack'], ['service', 'Service door — breach or lockpick, or an engineer route']],
    escapes: [['van_street', 'Street van — waiting outside the front'], ['alley_car', 'Alley car — east alley, quiet route'], ['service_tunnel', `North service route — ${c.skills.includes('e_service') || c.classId === 'engineer' ? 'unlocked' : 'needs Engineer or Service Knowledge'}`]],
  };
}

function planning(api: MenuApi, contractId: string): string {
  const c = api.campaign;
  const k = CONTRACTS.find((x) => x.id === contractId);
  if (!k || !k.definition) return frame('Planning', '<p>Unavailable.</p>');
  const d = k.definition;
  const p = c.plan;
  const opts = planningOptions(c);
  const diffs = (Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => {
    const df = DIFFICULTIES[id];
    return `<label class="choice ${p.difficulty === id ? 'sel' : ''}"><input type="radio" name="difficulty" data-set="plan.difficulty" value="${id}" ${p.difficulty === id ? 'checked' : ''}><span class="choice-title" style="color:${df.color}">${df.name}</span><span class="choice-desc">${esc(df.description)}</span>
      <span class="muted small">Response in ${df.responseFirstDelay}s · ${df.responseWaveSize} units/wave · dmg taken ×${df.playerDamageTakenMult.toFixed(2)} · loot ×${df.lootValueMult.toFixed(2)}</span></label>`;
  }).join('');
  const entries = opts.entries.map(([id, label]) => `<label class="choice ${p.entry === id ? 'sel' : ''}"><input type="radio" name="entry" data-set="plan.entry" value="${id}" ${p.entry === id ? 'checked' : ''}><span class="choice-title">${esc(label.split(' — ')[0])}</span><span class="choice-desc">${esc(label.split(' — ')[1] ?? '')}</span></label>`).join('');
  const escapes = opts.escapes.map(([id, label]) => {
    const locked = id === 'service_tunnel' && !(c.classId === 'engineer' || c.skills.includes('e_service'));
    return `<label class="choice ${p.escape === id ? 'sel' : ''} ${locked ? 'warn' : ''}"><input type="radio" name="escape" data-set="plan.escape" value="${id}" ${p.escape === id ? 'checked' : ''}><span class="choice-title">${esc(label.split(' — ')[0])}</span><span class="choice-desc">${esc(label.split(' — ')[1] ?? '')}</span></label>`;
  }).join('');
  const disguises = c.ownedDisguises.map((id) => {
    const dg = DISGUISES[id];
    return `<label class="choice compact ${p.disguise === id ? 'sel' : ''}"><input type="radio" name="disguise" data-set="plan.disguise" value="${id}" ${p.disguise === id ? 'checked' : ''}><span class="choice-title">${esc(dg.name)}</span><span class="choice-desc">Access: ${dg.access.join(', ')}</span></label>`;
  }).join('');
  const crewSel = c.crewHired.map((id) => {
    const cr = CREW_BY_ID[id];
    const on = p.crew.includes(id);
    return `<label class="choice compact ${on ? 'sel' : ''}"><input type="checkbox" data-crew="${id}" ${on ? 'checked' : ''}><span class="choice-title">${esc(cr.name)}</span><span class="choice-desc">${esc(cr.role)} · fee ${fmt(cr.missionFee)}</span></label>`;
  }).join('') || '<p class="muted">No crew hired. Visit Crew Management.</p>';
  const intelItems = [
    { id: 'floor_plan', name: 'Floor plan', price: 2500, desc: 'Reveals camera coverage and the building layout on the map; unlocks the "Blackout the cameras" objective.' },
    { id: 'guard_rota', name: 'Guard rota', price: 3000, desc: 'Patrol timings. Reveals the "Disable the alarm panel" objective.' },
    { id: 'insider', name: 'Insider tip', price: 6000, desc: 'A teller knows the manager well. Reveals the "Get the vault override" objective.' },
  ];
  const intel = intelItems.map((it) => {
    const owned = c.intelPurchased.includes(it.id);
    const on = p.intel.includes(it.id);
    return `<div class="choice compact ${on ? 'sel' : ''}"><div class="choice-title">${esc(it.name)} <span class="muted">${owned ? '' : fmt(it.price)}</span></div><div class="choice-desc">${esc(it.desc)}</div>
      <div class="row">${owned
        ? `<label><input type="checkbox" data-intel="${it.id}" ${on ? 'checked' : ''}> Bring to the job</label>`
        : btn('buyintel', `Buy · ${fmt(it.price)}`, it.id, 'small', c.money < it.price ? 'disabled' : '')}</div></div>`;
  }).join('');
  const approaches: Array<[string, string, string]> = [
    ['auto', 'Adaptive', 'Use whatever the building gives you.'],
    ['quiet', 'Quiet infiltration', 'Guards 10% slower to suspect. Best with Ghost / stealth tools.'],
    ['social', 'Social infiltration', 'Staff doors respect your uniform and the manager may trust credentials.'],
    ['technical', 'Technical infiltration', 'Hacks are one tier easier; engineer routes open up.'],
    ['loud', 'Loud assault', 'Police respond faster, loot pays 10% more. Expect fire.'],
  ];
  const approach = approaches.map(([id, name, desc]) => `<label class="choice compact ${p.approach === id ? 'sel' : ''}"><input type="radio" name="approach" data-set="plan.approach" value="${id}" ${p.approach === id ? 'checked' : ''}><span class="choice-title">${esc(name)}</span><span class="choice-desc">${esc(desc)}</span></label>`).join('');
  const mods = api.currentModifiers();
  const modsHtml = mods.length ? mods.map((m) => `<li><b>${esc(m.label)}</b> — ${esc(m.description)}</li>`).join('') : '<li class="muted">None</li>';
  const problems = validateLoadout(c, c.loadout);
  const sec = securityLevel(p.difficulty, mods.length);
  const body = `
    <div class="planning">
      <div class="plan-col">
        ${panel('Operation map', `<canvas id="plan-map" width="560" height="360" class="plan-map"></canvas>
          <div class="legend small muted">Green = selected entry · Yellow = selected escape route</div>`)}
        ${panel('Entry point', `<div class="choices">${entries}</div>`)}
        ${panel('Escape route', `<div class="choices">${escapes}</div>`)}
        ${panel('Approach', `<div class="choices">${approach}</div>`)}
      </div>
      <div class="plan-col">
        ${panel('Starting disguise', `<div class="choices">${disguises}</div><p class="muted small">Disguises change which staff/security doors you can use and how NPCs judge you. They never open the vault.</p>`)}
        ${panel('Crew', `<div class="choices">${crewSel}</div><p class="muted small">Up to ${crewSlots(c)} crew. Crew follow you and execute commands with C.</p>`)}
        ${panel('Intelligence', `<div class="choices">${intel}</div>`)}
        ${panel('Difficulty', `<div class="choices">${diffs}</div>`)}
        ${panel('Operation details', `
          <label class="toggle"><input type="checkbox" data-set="plan.optionalLoot" ${p.optionalLoot ? 'checked' : ''}> Include optional loot &amp; objectives</label>
          <div class="row gap"><label>Start location
            <select data-set="plan.startLocation"><option value="street" ${p.startLocation === 'street' ? 'selected' : ''}>Street</option><option value="alley" ${p.startLocation === 'alley' ? 'selected' : ''}>East alley</option></select></label></div>
          <h4>Randomised modifiers</h4><ul class="mods">${modsHtml}</ul>
          ${btn('reroll', 'Re-roll modifiers', '', 'small ghost')}
          <div class="kv"><span>Estimated security</span><b class="sec-${sec.level}">${sec.label}</b></div>
          <div class="kv"><span>Loadout</span><b>${problems.length ? `<span class="bad">${problems.length} issue(s)</span>` : '<span class="good">Ready</span>'}</b></div>
          ${problems.length ? `<ul class="warn small">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="row gap">${btn('go', 'Adjust loadout', 'loadout', 'small')}${btn('deploy', 'DEPLOY', contractId, 'primary big')}</div>
          <p class="muted small">Deploying uses your current loadout and selected crew. Crew fees are paid now.</p>
        `)}
      </div>
    </div>
    <div class="row"><a class="muted" data-act="go" data-arg="briefing:${contractId}" href="#">← Back to briefing</a></div>`;
  return frame(`Plan: ${d.name}`, body, true, '<span>Contract</span> › <span>Planning</span>');
}

function securityLevel(diff: Difficulty, mods: number): { level: 'low' | 'med' | 'high' | 'extreme'; label: string } {
  const score = { story: 1, normal: 2, hard: 3, overkill: 4 }[diff] + mods * 0.4;
  if (score < 2.2) return { level: 'low', label: 'LOW — routine guards' };
  if (score < 3.2) return { level: 'med', label: 'MEDIUM — alert guards' };
  if (score < 4) return { level: 'high', label: 'HIGH — elite response' };
  return { level: 'extreme', label: 'EXTREME — the building expects you' };
}

export function loadoutSummary(c: CampaignState, l: Loadout): string {
  const w = WEAPONS[l.primary];
  if (!w) return '';
  const st = effectiveWeaponStats(w, l.attachments[l.primary] ?? []);
  const arm = ARMORS[l.armor];
  return `${w.name}: ${st.damage.toFixed(0)} dmg · ${st.magazine} rounds · ${st.recoilVertical.toFixed(1)} recoil · reload ${st.reloadTime.toFixed(1)}s · noise ${st.noiseLevel.toFixed(0)}m · armour ${arm.armor} (move ×${arm.moveSpeedMult.toFixed(2)}, noise ×${arm.noiseMult.toFixed(2)})`;
}

function loadout(api: MenuApi): string {
  const c = api.campaign;
  const l = c.loadout;
  const sel = (slotKey: 'primary' | 'secondary' | 'melee', cats: (w: typeof WEAPONS[string]) => boolean) => {
    const opts = c.ownedWeapons.filter((id) => cats(WEAPONS[id])).map((id) => `<option value="${id}" ${l[slotKey] === id ? 'selected' : ''}>${esc(WEAPONS[id].name)}</option>`).join('');
    return `<select data-set="loadout.${slotKey}">${opts}</select>`;
  };
  const weaponAtt = (wid: string) => {
    if (!WEAPONS[wid]) return '';
    const fits = attachmentsFor(wid).filter((a) => c.ownedAttachments.includes(a.id) || true);
    const cur = l.attachments[wid] ?? [];
    return fits.map((a) => {
      const owned = c.ownedAttachments.includes(a.id);
      const on = cur.includes(a.id);
      return `<label class="chip ${on ? 'on' : ''} ${owned ? '' : 'unowned'}"><input type="checkbox" data-att="${wid}" data-attid="${a.id}" ${on ? 'checked' : ''} ${owned ? '' : 'disabled'}> ${esc(a.name)} <span class="muted">${esc(a.slot)}</span></label>`;
    }).join('') || '<span class="muted">No attachments for this weapon.</span>';
  };
  const gadgetSel = (idx: 0 | 1) => {
    const cur = l.gadgets[idx];
    const opts = `<option value="">— empty —</option>` + c.ownedGadgets.filter((g) => GADGETS[g].kind === 'equipment').map((g) => `<option value="${g}" ${cur === g ? 'selected' : ''}>${esc(GADGETS[g].name)}</option>`).join('');
    return `<select data-set="loadout.gadget${idx}">${opts}</select>`;
  };
  const throwSel = () => {
    const opts = `<option value="">— none —</option>` + c.ownedGadgets.filter((g) => GADGETS[g].kind === 'throwable').map((g) => `<option value="${g}" ${l.throwable === g ? 'selected' : ''}>${esc(GADGETS[g].name)}</option>`).join('');
    return `<select data-set="loadout.throwable">${opts}</select>`;
  };
  const armorSel = `<select data-set="loadout.armor">${c.ownedArmor.map((a) => `<option value="${a}" ${l.armor === a ? 'selected' : ''}>${esc(ARMORS[a].name)} (${ARMORS[a].armor})</option>`).join('')}</select>`;
  const disguiseSel = `<select data-set="loadout.disguise">${c.ownedDisguises.map((a) => `<option value="${a}" ${l.disguise === a ? 'selected' : ''}>${esc(DISGUISES[a].name)}</option>`).join('')}</select>`;
  const ammoSel = `<select data-set="loadout.ammo">${c.ownedAmmo.map((a) => `<option value="${a}" ${l.ammo === a ? 'selected' : ''}>${esc(AMMO_TYPES[a].name)} — ${esc(AMMO_TYPES[a].description)}</option>`).join('')}</select>`;
  const problems = validateLoadout(c, l);
  const saved = c.savedLoadouts.map((s, i) => `<div class="row"><span>${esc(s.name)}</span>${btn('loadload', 'Load', String(i), 'small')}${btn('loaddel', 'Delete', String(i), 'small danger')}</div>`).join('') || '<p class="muted small">No saved loadouts.</p>';
  const body = `
    <div class="loadout">
      <div class="loadout-main">
        ${panel('Weapons', `
          <div class="form-grid">
            <label>Primary ${sel('primary', (w) => !!w && w.size !== 'compact' && w.category !== 'melee')}</label>
            <label>Sidearm ${sel('secondary', (w) => !!w && w.size === 'compact' && w.category !== 'melee' || (!!w && w.category === 'pistol'))}</label>
            <label>Melee ${sel('melee', (w) => !!w && w.category === 'melee' || w?.category === 'nonlethal')}</label>
            <label>Ammunition ${ammoSel}</label>
          </div>
          <p class="muted small">${esc(loadoutSummary(c, l))}</p>`)}
        ${panel('Attachments', `
          <div class="att-block"><h4>Primary — ${esc(WEAPONS[l.primary]?.name ?? '')}</h4><div class="chips">${weaponAtt(l.primary)}</div></div>
          <div class="att-block"><h4>Sidearm — ${esc(WEAPONS[l.secondary]?.name ?? '')}</h4><div class="chips">${weaponAtt(l.secondary)}</div></div>
          <p class="muted small">Attachments change real stats: range, spread, recoil, noise, reload and handling. Unowned attachments can be bought in the Armory.</p>`)}
      </div>
      <div class="loadout-side">
        ${panel('Protection & kit', `
          <div class="form-grid">
            <label>Armour ${armorSel}</label>
            <label>Gadget slot 1 ${gadgetSel(0)}</label>
            <label>Gadget slot 2 ${gadgetSel(1)}</label>
            <label>Throwable ${throwSel()}</label>
            <label>Disguise ${disguiseSel}</label>
          </div>
          <p class="muted small">Heavier armour absorbs more damage but slows you and makes more noise.</p>`)}
        ${panel('Validation', problems.length ? `<ul class="warn">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="good">Loadout is valid for deployment.</p>')}
        ${panel('Saved loadouts', `${saved}<div class="row gap"><input id="loadout-name" maxlength="24" placeholder="Name" value="${esc(l.name)}"> ${btn('loadsave', 'Save current', '', 'small')}</div>`)}
      </div>
    </div>`;
  return frame('Loadout', body);
}

function armory(api: MenuApi): string {
  const c = api.campaign;
  const items: ShopItem[] = [];
  for (const w of Object.values(WEAPONS)) if (w.price > 0) items.push({ kind: 'weapon', id: w.id, name: w.name, price: w.price, requiresRep: w.unlockRep ?? 0, owned: c.ownedWeapons.includes(w.id), description: w.description });
  for (const a of Object.values(ATTACHMENTS)) items.push({ kind: 'attachment', id: a.id, name: a.name, price: a.price, requiresRep: a.unlockRep ?? 0, owned: c.ownedAttachments.includes(a.id), description: a.description });
  for (const a of Object.values(ARMORS)) if (a.price > 0) items.push({ kind: 'armor', id: a.id, name: a.name, price: a.price, requiresRep: a.unlockRep ?? 0, owned: c.ownedArmor.includes(a.id), description: a.description });
  for (const g of Object.values(GADGETS)) items.push({ kind: 'gadget', id: g.id, name: g.name, price: g.price, requiresRep: g.unlockRep ?? 0, owned: c.ownedGadgets.includes(g.id), description: g.description });
  for (const dg of Object.values(DISGUISES)) if (dg.price > 0) items.push({ kind: 'disguise', id: dg.id, name: dg.name, price: dg.price, requiresRep: dg.unlockRep ?? 0, owned: c.ownedDisguises.includes(dg.id), description: dg.description });
  for (const [id, a] of Object.entries(AMMO_TYPES)) if (a.price > 0) items.push({ kind: 'ammo', id, name: a.name, price: a.price, requiresRep: 0, owned: c.ownedAmmo.includes(id as AmmoType), description: a.description });
  const groups: Record<string, ShopItem[]> = {};
  for (const it of items) (groups[it.kind] ??= []).push(it);
  const titles: Record<string, string> = { weapon: 'Weapons', attachment: 'Attachments', armor: 'Armour', gadget: 'Gadgets', disguise: 'Disguises', ammo: 'Ammunition' };
  const html = Object.entries(groups).map(([k, list]) => panel(titles[k] ?? k, `<div class="shop-grid">${list.map((it) => {
    const locked = it.requiresRep > c.reputation;
    const afford = c.money >= it.price;
    return `<div class="shop-item ${it.owned ? 'owned' : ''} ${locked ? 'locked' : ''}">
      <div class="si-name">${esc(it.name)}</div>
      <div class="si-desc">${esc(it.description)}</div>
      <div class="row">${it.owned ? '<span class="tag ok">OWNED</span>'
        : `${btn('buy', `${fmt(it.price)}`, `${it.kind}:${it.id}`, 'small', afford && !locked ? '' : 'disabled')}${locked ? `<span class="muted small">Needs rep ${it.requiresRep}</span>` : ''}`}</div>
    </div>`;
  }).join('')}</div>`)).join('');
  const skill = `<p class="muted">Funds: <b class="money">${fmt(c.money)}</b> · Reputation ${c.reputation}</p>`;
  return frame('Armory', `${skill}${html}`);
}

function crew(api: MenuApi): string {
  const c = api.campaign;
  const slots = crewSlots(c);
  const cards = CREW.map((cr) => {
    const hired = c.crewHired.includes(cr.id);
    const tier = c.crewTier[cr.id] ?? 0;
    const next = cr.upgrades[tier];
    const locked = c.reputation < cr.unlockRep;
    return `<article class="crew-card ${hired ? 'hired' : ''} ${locked ? 'locked' : ''}">
      <div class="crew-head"><h3>${esc(cr.name)}</h3><span class="tag">${esc(cr.role.toUpperCase())}</span></div>
      <p>${esc(cr.description)}</p>
      <p class="muted small"><em>${esc(cr.personality)}</em></p>
      <div class="kv small"><span>Loadout</span><b>${esc(cr.loadoutText)}</b></div>
      <div class="kv small"><span>Stats</span><b>Accuracy ${Math.round(cr.stats.accuracy * 100)}% · Health ${cr.stats.health}</b></div>
      <div class="kv small"><span>Mission fee</span><b>${fmt(cr.missionFee)}</b></div>
      ${hired ? `<div class="kv small"><span>Upgrade tier</span><b>${tier} / ${cr.upgrades.length}</b></div>
        ${next ? `<div class="upgrade"><span>${esc(next.description)}</span> ${btn('upgradecrew', `Upgrade · ${fmt(next.cost)}`, cr.id, 'small', c.money >= next.cost ? '' : 'disabled')}</div>` : '<div class="good small">Fully upgraded</div>'}
        <div class="row">${btn('dismiss', 'Dismiss', cr.id, 'small danger')}</div>`
        : `<div class="row">${locked ? `<span class="muted">Requires reputation ${cr.unlockRep}</span>` : btn('hire', `Recruit · ${fmt(cr.hireCost)}`, cr.id, 'primary small', c.money >= cr.hireCost && c.crewHired.length < slots ? '' : 'disabled')}</div>`}
    </article>`;
  }).join('');
  return frame('Crew management', `<p class="muted">Crew slots: <b>${c.crewHired.length} / ${slots}</b> · Funds ${fmt(c.money)}</p><div class="crew-grid">${cards}</div>`);
}

function skills(api: MenuApi): string {
  const c = api.campaign;
  const trees = SKILL_TREES.map((t) => {
    const nodes = SKILLS.filter((s) => s.tree === t.id).sort((a, b) => a.tier - b.tier);
    const items = nodes.map((s) => {
      const st = skillStatus(c, s);
      const owned = c.skills.includes(s.id);
      return `<button type="button" class="skill ${owned ? 'owned' : st.ok ? 'avail' : 'locked'}" data-act="skill" data-arg="${s.id}" ${owned ? 'disabled' : ''} title="${esc(st.reason ?? s.description)}">
        <span class="skill-tier">T${s.tier + 1}</span><span class="skill-name">${esc(s.name)}</span><span class="skill-desc">${esc(s.description)}</span>
        <span class="skill-cost">${owned ? 'UNLOCKED' : `${s.cost} SP${s.repRequired ? ` · rep ${s.repRequired}` : ''}`}</span>
        ${!owned && st.reason ? `<span class="skill-why">${esc(st.reason)}</span>` : ''}</button>`;
    }).join('');
    return `<section class="tree" style="--tree:${t.color}"><header><h3>${esc(t.name)}</h3><p class="muted small">${esc(t.description)}</p></header>${items}</section>`;
  }).join('');
  return frame('Skill trees', `<p>Skill points: <b>${c.skillPoints}</b> · Reputation <b>${c.reputation}</b> · Level <b>${c.level}</b></p><div class="trees">${trees}</div>`);
}

const SETTING_FIELDS: Array<{ key: keyof Settings; label: string; type: 'range' | 'bool' | 'select'; min?: number; max?: number; step?: number; options?: string[]; group: string }> = [
  { key: 'mouseSensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.1, max: 3, step: 0.05, group: 'Controls' },
  { key: 'adsSensitivityMult', label: 'Aim sensitivity multiplier', type: 'range', min: 0.3, max: 1, step: 0.05, group: 'Controls' },
  { key: 'invertY', label: 'Invert vertical look', type: 'bool', group: 'Controls' },
  { key: 'toggleCrouch', label: 'Toggle crouch (instead of hold)', type: 'bool', group: 'Controls' },
  { key: 'toggleAim', label: 'Toggle aim (instead of hold)', type: 'bool', group: 'Controls' },
  { key: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, group: 'Display' },
  { key: 'renderScale', label: 'Resolution scale', type: 'range', min: 0.5, max: 1.5, step: 0.05, group: 'Display' },
  { key: 'shadows', label: 'Shadows', type: 'select', options: ['off', 'low', 'high'], group: 'Display' },
  { key: 'effects', label: 'Effects quality', type: 'select', options: ['low', 'high'], group: 'Display' },
  { key: 'viewDistance', label: 'View distance', type: 'range', min: 60, max: 160, step: 5, group: 'Display' },
  { key: 'antialias', label: 'Anti-aliasing (requires restart)', type: 'bool', group: 'Display' },
  { key: 'textScale', label: 'Text size', type: 'range', min: 0.8, max: 1.4, step: 0.05, group: 'Accessibility' },
  { key: 'highContrast', label: 'High contrast HUD', type: 'bool', group: 'Accessibility' },
  { key: 'subtitles', label: 'Subtitles', type: 'bool', group: 'Accessibility' },
  { key: 'screenShake', label: 'Screen shake', type: 'range', min: 0, max: 1, step: 0.05, group: 'Accessibility' },
  { key: 'volumeMaster', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, group: 'Audio' },
  { key: 'volumeMusic', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, group: 'Audio' },
  { key: 'volumeSfx', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, group: 'Audio' },
  { key: 'volumeDialogue', label: 'Dialogue & radio', type: 'range', min: 0, max: 1, step: 0.05, group: 'Audio' },
  { key: 'volumeAmbience', label: 'Ambience', type: 'range', min: 0, max: 1, step: 0.05, group: 'Audio' },
  { key: 'showFps', label: 'Show FPS counter', type: 'bool', group: 'Debug' },
  { key: 'debugOverlay', label: 'Debug overlay (AI, mission state)', type: 'bool', group: 'Debug' },
];

function settings(api: MenuApi): string {
  const s = api.settings;
  const groups: Record<string, string[]> = {};
  for (const f of SETTING_FIELDS) {
    const v = s[f.key];
    let input: string;
    if (f.type === 'range') input = `<input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" data-set="settings.${f.key}"><output>${typeof v === 'number' ? (v < 2 && (f.step ?? 1) < 1 ? v.toFixed(2) : Math.round(v as number)) : v}</output>`;
    else if (f.type === 'bool') input = `<input type="checkbox" data-set="settings.${f.key}" ${v ? 'checked' : ''}>`;
    else input = `<select data-set="settings.${f.key}">${(f.options ?? []).map((o) => `<option value="${o}" ${v === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    (groups[f.group] ??= []).push(`<label class="setting"><span>${esc(f.label)}</span>${input}</label>`);
  }
  const html = Object.entries(groups).map(([g, items]) => panel(g, items.join(''))).join('');
  const keys = `<div class="keys">
    <div><kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Ctrl</kbd> crouch · <kbd>Space</kbd> jump / vault</div>
    <div><kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim · <kbd>R</kbd> reload · <kbd>1-3</kbd> weapons · <kbd>Wheel</kbd> cycle</div>
    <div><kbd>E</kbd> interact (hold where shown) · <kbd>Z</kbd> select equipment · <kbd>F</kbd> use equipment · <kbd>G</kbd> throw · <kbd>X</kbd> class ability</div>
    <div><kbd>C</kbd> crew commands (then 1-5) · <kbd>Tab</kbd> objectives · <kbd>M</kbd> tactical map · <kbd>I</kbd> inventory · <kbd>Esc</kbd> pause</div></div>`;
  return frame('Settings', `${html}${panel('Key bindings', keys)}
    <div class="row gap">
      ${btn('resetsettings', 'Reset to defaults', '', 'ghost')}
      ${btn('clearsave', 'Erase campaign save…', '', 'danger')}
    </div>
    <p class="muted small">${esc(api.saveNote)}</p>`);
}

function credits(): string {
  return frame('Credits', `<div class="credits">
    <p><b>OPERATION: BLACKOUT</b> is an original fictional heist game built with Three.js, TypeScript and Vite.</p>
    <p>Character models (when installed): Microsoft Rocketbox avatars and animations, MIT License, © 2020 Microsoft.</p>
    <p>All weapons, organisations, locations and characters are fictional. Hacking, lock and security interactions are abstract game mechanics.</p>
    <p class="muted small">Audio is synthesised at runtime with the Web Audio API. No third-party sound assets are bundled.</p></div>`);
}

function results(api: MenuApi): string {
  const r = api.lastResult;
  if (!r) return frame('Results', '<p>No operation on record.</p>');
  const lines = r.breakdown.map((l) => `<div class="kv ${l.kind}"><span>${esc(l.label)}</span><b class="${l.value < 0 ? 'bad' : ''}">${l.kind === 'money' || l.kind === 'penalty' ? fmt(l.value) : l.value + (l.kind === 'xp' ? ' XP' : ' rep')}</b></div>`).join('');
  const stats = r.stats;
  const body = `
    <div class="results ${r.success ? 'win' : 'lose'}">
      <div class="result-banner">${r.success ? 'OPERATION SUCCESSFUL' : 'OPERATION FAILED'}</div>
      <p class="muted">${esc(r.reason)}</p>
      <div class="two-col">
        ${panel('Payout', `${lines}<div class="kv total"><span>Total</span><b class="money">${fmt(r.money)}</b></div>${r.levelUps ? `<div class="good">Level up! Skill points +${r.levelUps * 2}</div>` : ''}`)}
        ${panel('Mission statistics', `
          <div class="kv"><span>Objectives</span><b>${r.objectivesDone.length} complete</b></div>
          <div class="kv"><span>Time</span><b>${Math.floor(stats.timeSeconds / 60)}:${String(Math.floor(stats.timeSeconds % 60)).padStart(2, '0')}</b></div>
          <div class="kv"><span>Detection peak</span><b>${Math.round(stats.detectionPeak)}%</b></div>
          <div class="kv"><span>Alarm triggers</span><b>${stats.alarmTriggers}</b></div>
          <div class="kv"><span>Shots fired</span><b>${stats.shotsFired}</b></div>
          <div class="kv"><span>Kills</span><b>${stats.kills}</b></div>
          <div class="kv"><span>Hacks</span><b>${stats.hacksOk} ok · ${stats.hacksFailed} failed</b></div>
          <div class="kv"><span>Civilians harmed</span><b>${stats.civiliansHarmed}</b></div>
          <div class="kv"><span>Crew down</span><b>${stats.crewDowned}</b></div>
          <div class="kv"><span>Approach</span><b>${esc(r.approach)} · ${esc(r.classLabel)}</b></div>`)}
      </div>
      <div class="row gap">${btn('go', 'Return to Operations Hub', 'hub', 'primary big')}</div>
    </div>`;
  return frame('Mission results', body, false);
}

// ---------------------------------------------------------------------------
// Actions (dispatched from data-act attributes; value inputs go through setValue)
// ---------------------------------------------------------------------------
export function handleAction(api: MenuApi, act: string, arg: string, el?: HTMLElement): void {
  const c = api.campaign;
  switch (act) {
    case 'go': {
      const [screen, extra] = arg.split(':');
      api.go(screen as ScreenName, extra);
      return;
    }
    case 'newcampaign':
      if (api.hasSave && !window.confirm('Start a NEW campaign? Your current campaign save will be erased.')) return;
      api.newCampaign();
      return;
    case 'continue':
      api.continueCampaign();
      return;
    case 'pickclass':
      c.classId = arg as typeof c.classId;
      api.toast(`Operator: ${CLASSES[arg as keyof typeof CLASSES].name}`, 'info');
      api.go('class');
      return;
    case 'confirmclass': {
      const cl = CLASSES[arg as keyof typeof CLASSES];
      c.classId = cl.id;
      c.started = true;
      grantClassStarter(c, cl.id);
      c.loadout = defaultLoadout(cl.id);
      c.plan = { ...c.plan, disguise: cl.loadout.startingDisguise };
      api.save();
      api.toast(`${cl.name} selected. Equipment loaded.`, 'success');
      api.go('hub');
      return;
    }
    case 'contract':
      if (!c.classId) { api.toast('Select an operator first.', 'warn'); api.go('class'); return; }
      api.go('briefing', arg);
      return;
    case 'startplanning':
      if (!c.classId) { api.go('class'); return; }
      api.go('planning', arg);
      return;
    case 'deploy':
      api.deploy();
      return;
    case 'reroll':
      api.rerollModifiers();
      api.go('planning', arg === '' ? 'bank_central' : arg);
      return;
    case 'buyintel': {
      const prices: Record<string, number> = { floor_plan: 2500, guard_rota: 3000, insider: 6000 };
      const price = prices[arg];
      if (c.intelPurchased.includes(arg)) return;
      if (c.money < price) { api.toast('Not enough money.', 'warn'); return; }
      c.money -= price;
      c.intelPurchased.push(arg);
      api.save();
      api.toast('Intel acquired.', 'success');
      api.go('planning', 'bank_central');
      return;
    }
    case 'buy': {
      const [kind, id] = arg.split(':');
      const item = findShopItem(c, kind, id);
      if (!item) return;
      const res = purchase(c, item);
      if (!res.ok) { api.toast(res.reason ?? 'Cannot buy', 'warn'); return; }
      api.save();
      api.toast(`Purchased ${item.name}.`, 'success');
      api.go('armory');
      return;
    }
    case 'hire': {
      const cr = CREW_BY_ID[arg];
      const res = hireCrew(c, cr);
      if (!res.ok) { api.toast(res.reason ?? 'Cannot hire', 'warn'); return; }
      api.save();
      api.toast(`${cr.name} joined the crew.`, 'success');
      api.go('crew');
      return;
    }
    case 'dismiss': {
      c.crewHired = c.crewHired.filter((x) => x !== arg);
      c.plan.crew = c.plan.crew.filter((x) => x !== arg);
      api.save();
      api.go('crew');
      return;
    }
    case 'upgradecrew': {
      const res = upgradeCrew(c, CREW_BY_ID[arg]);
      if (!res.ok) { api.toast(res.reason ?? 'Cannot upgrade', 'warn'); return; }
      api.save();
      api.toast('Crew upgraded.', 'success');
      api.go('crew');
      return;
    }
    case 'skill': {
      const res = unlockSkill(c, arg);
      if (!res.ok) { api.toast(res.reason ?? 'Locked', 'warn'); return; }
      api.save();
      api.toast('Skill unlocked.', 'success');
      api.go('skills');
      return;
    }
    case 'loadsave': {
      const name = (document.getElementById('loadout-name') as HTMLInputElement | null)?.value.trim() || 'Loadout';
      const snapshot: Loadout = JSON.parse(JSON.stringify({ ...c.loadout, name }));
      if (c.savedLoadouts.length >= 8) { api.toast('Up to 8 saved loadouts.', 'warn'); return; }
      c.savedLoadouts.push(snapshot);
      api.save();
      api.toast('Loadout saved.', 'success');
      api.go('loadout');
      return;
    }
    case 'loadload': {
      const idx = Number(arg);
      const s = c.savedLoadouts[idx];
      if (!s) return;
      c.loadout = JSON.parse(JSON.stringify(s));
      api.save();
      api.toast(`Loaded "${s.name}".`, 'success');
      api.go('loadout');
      return;
    }
    case 'loaddel':
      c.savedLoadouts.splice(Number(arg), 1);
      api.save();
      api.go('loadout');
      return;
    case 'resetsettings':
      Object.assign(api.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
      api.applySettings();
      api.go('settings');
      return;
    case 'clearsave':
      if (!window.confirm('Erase ALL campaign progress? This cannot be undone.')) return;
      if (!window.confirm('Really erase the campaign? Money, skills, crew and loadouts will be lost.')) return;
      api.clearSave();
      api.go('main');
      return;
    case 'noop':
      return;
    default:
      void el;
  }
}

/** Applies a form control's value to the campaign/settings. */
export function handleChange(api: MenuApi, target: HTMLInputElement | HTMLSelectElement): void {
  const key = target.dataset.set;
  const c = api.campaign;
  const val: string | boolean | number = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked
    : target instanceof HTMLInputElement && target.type === 'range' ? Number(target.value) : target.value;
  if (target.dataset.crew) {
    const id = target.dataset.crew;
    const on = (target as HTMLInputElement).checked;
    c.plan.crew = on ? [...c.plan.crew.filter((x) => x !== id), id] : c.plan.crew.filter((x) => x !== id);
    if (c.plan.crew.length > crewSlots(c)) {
      c.plan.crew = c.plan.crew.slice(-crewSlots(c));
      api.toast(`Crew slots full (${crewSlots(c)}).`, 'warn');
    }
    api.save();
    api.go('planning', 'bank_central');
    return;
  }
  if (target.dataset.intel) {
    const id = target.dataset.intel;
    const on = (target as HTMLInputElement).checked;
    c.plan.intel = on ? [...c.plan.intel.filter((x) => x !== id), id] : c.plan.intel.filter((x) => x !== id);
    api.save();
    return;
  }
  if (target.dataset.att) {
    const wid = target.dataset.att;
    const aid = target.dataset.attid!;
    const cur = (c.loadout.attachments[wid] ?? []).filter((x) => x !== aid);
    const slot = ATTACHMENTS[aid].slot;
    const sameSlot = cur.filter((x) => ATTACHMENTS[x].slot !== slot);
    c.loadout.attachments[wid] = (target as HTMLInputElement).checked ? [...sameSlot, aid] : cur;
    api.save();
    api.go('loadout');
    return;
  }
  if (!key) return;
  if (key.startsWith('settings.')) {
    const k = key.slice(9) as keyof Settings;
    (api.settings as unknown as Record<string, unknown>)[k] = val;
    api.applySettings();
    const out = target.parentElement?.querySelector('output');
    if (out && typeof val === 'number') out.textContent = val < 2 && Number((target as HTMLInputElement).step) < 1 ? val.toFixed(2) : String(Math.round(val));
    return;
  }
  if (key.startsWith('plan.')) {
    const k = key.slice(5) as keyof PlanChoices;
    (c.plan as unknown as Record<string, unknown>)[k] = val;
    if (k === 'escape' && val === 'service_tunnel' && !(c.classId === 'engineer' || c.skills.includes('e_service'))) {
      api.toast('North service route needs Engineer or the Service Knowledge skill.', 'warn');
    }
    if (k === 'difficulty' || k === 'entry' || k === 'escape' || k === 'approach' || k === 'disguise' || k === 'optionalLoot' || k === 'startLocation') {
      api.save();
      api.go('planning', 'bank_central');
    }
    return;
  }
  if (key.startsWith('loadout.')) {
    const k = key.slice(8);
    const l = c.loadout;
    if (k === 'gadget0') l.gadgets[0] = (val || null) as GadgetId | null;
    else if (k === 'gadget1') l.gadgets[1] = (val || null) as GadgetId | null;
    else if (k === 'throwable') l.throwable = (val || null) as GadgetId | null;
    else if (k === 'armor') l.armor = val as ArmorId;
    else if (k === 'disguise') l.disguise = val as DisguiseId;
    else if (k === 'ammo') l.ammo = val as AmmoType;
    else if (k === 'primary' || k === 'secondary' || k === 'melee') {
      (l as unknown as Record<string, string>)[k] = String(val);
      // drop attachments that do not fit the new weapon
      const valid = attachmentsFor(String(val)).map((a) => a.id);
      l.attachments[String(val)] = (l.attachments[String(val)] ?? []).filter((a) => valid.includes(a));
    }
    api.save();
    api.go('loadout');
  }
}

function findShopItem(c: CampaignState, kind: string, id: string): ShopItem | null {
  const rep = c.reputation;
  void rep;
  switch (kind) {
    case 'weapon': { const w = WEAPONS[id]; return w ? { kind: 'weapon', id, name: w.name, price: w.price, requiresRep: w.unlockRep ?? 0, owned: c.ownedWeapons.includes(id), description: w.description } : null; }
    case 'attachment': { const a = ATTACHMENTS[id]; return a ? { kind: 'attachment', id, name: a.name, price: a.price, requiresRep: a.unlockRep ?? 0, owned: c.ownedAttachments.includes(id), description: a.description } : null; }
    case 'armor': { const a = ARMORS[id as ArmorId]; return a ? { kind: 'armor', id, name: a.name, price: a.price, requiresRep: a.unlockRep ?? 0, owned: c.ownedArmor.includes(id as ArmorId), description: a.description } : null; }
    case 'gadget': { const g = GADGETS[id as GadgetId]; return g ? { kind: 'gadget', id, name: g.name, price: g.price, requiresRep: g.unlockRep ?? 0, owned: c.ownedGadgets.includes(id as GadgetId), description: g.description } : null; }
    case 'disguise': { const d = DISGUISES[id as DisguiseId]; return d ? { kind: 'disguise', id, name: d.name, price: d.price, requiresRep: d.unlockRep ?? 0, owned: c.ownedDisguises.includes(id as DisguiseId), description: d.description } : null; }
    case 'ammo': { const a = AMMO_TYPES[id as AmmoType]; return a ? { kind: 'ammo', id, name: a.name, price: a.price, requiresRep: 0, owned: c.ownedAmmo.includes(id as AmmoType), description: a.description } : null; }
    default: return null;
  }
}

export { XP_TABLE, levelForXp, validateLoadout };
