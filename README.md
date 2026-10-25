# OPERATION: BLACKOUT

A first-person 3D heist game that runs in the browser. Built with Three.js, TypeScript and Vite. No server, no paid services, and no native executable.

## Run it

Requirements: Node 20+ (tested on Node 22) and a WebGL2-capable browser (Chrome, Edge, Firefox or Safari on desktop).

```bash
npm install
npm run dev            # http://localhost:5173  (binds to 0.0.0.0)
npm run build          # type-checks, then builds dist/
npm run preview        # serves dist/
npm test               # unit tests (vitest)
npm run fetch-assets   # optional: download Microsoft Rocketbox characters (see docs/ROCKETBOX.md)
```

The game plays without Rocketbox. Characters fall back to procedural models.

## Controls

| Key | Action |
|---|---|
| WASD / mouse | Move / look (click the game to capture the mouse) |
| Shift / Ctrl | Sprint (stamina on Normal and above) / crouch |
| Space | Jump, or vault over waist-high cover |
| LMB / RMB | Fire / aim (hold, or toggle in Settings) |
| R | Reload |
| 1 2 3, wheel | Weapon slots, cycle |
| E (hold where shown) | Interact: doors, hacks, containers, loot, NPCs, hiding, extraction |
| Z | Select equipment slot 1 or 2 |
| F | Use selected equipment |
| G | Throw utility item |
| X | Class signature ability |
| C, then 1–5 | Crew commands: follow, hold, regroup, cover, assist |
| Tab | Objectives |
| M | Tactical map |
| I | Inventory |
| Esc | Pause |

## Game summary

Loop: Operations Hub → Contract board → Briefing → Planning (entry, escape, disguise, crew, intel, difficulty, approach) → Deploy → infiltrate → objectives → extraction → results → upgrade.

- **Six classes** with different stats, starter kits, passives and signature abilities: Enforcer, Ghost, Spectre (hacker), Architect (mastermind), Face (con artist), Tinker (engineer).
- **Stealth and detection:** field of view, line of sight through open space (closed doors block), distance and light, player stance and movement, noise (footsteps, gunfire, hacks, drilling), suspicion meters, eight alert states, radio relay, body discovery, camera spotting, and an alarm that escalates from calm to lockdown and response waves.
- **Hacking:** four timed minigames (sequence, timing, circuit, pattern) scaled by level. Failures add alarm pressure. Successes change the world: doors unlock, cameras go offline, the alarm panel is disabled, the vault opens.
- **Disguises and access:** staff and security uniforms open tiered doors. No disguise opens the vault.
- **Weapons:** 14 weapons across pistols, revolvers, SMGs, rifles, shotguns, a precision rifle, an LMG, melee and a taser, with real attachment effects.
- **Crew:** six recruitable specialists, each with commands, combat behaviour and revives.
- **Progression:** money, XP, reputation, six skill trees, shops, crew upgrades, and persistent saves in localStorage (versioned, with backup recovery).
- **Bank mission:** one complete contract with three entries, three escape routes, four vault approaches, optional objectives, randomised modifiers, and four difficulties.

## Project layout

```
src/
  app.ts, main.ts           app shell, screen router, mission lifecycle
  core/                     input, event bus, math, RNG, shared types
  config/                   weapons, gadgets, classes, skills, crew, balance
  progression/              campaign state, economy and rewards, settings
  save/                     versioned save manager
  world/                    level model, collision, scene builder, materials
  navigation/               navgrid (access-aware), A*, smoothing
  ai/                       perception, alarm, NPC entity, brain, crew brain, NPC manager
  characters/               Rocketbox loader, procedural humanoid, animation
  weapons/, effects/        weapon system, viewmodel, pooled effects
  player/                   first-person controller
  interaction/              contextual prompts and hold-to-use
  hacking/                  minigames (DOM)
  missions/                 mission framework, bank level data, bank definition
  game/                     MissionWorld (integration)
  audio/                    synthesised Web Audio
  ui/                       HUD, tactical map, menus, class preview, styles
tests/                      vitest suites
tools/                      Rocketbox fetch and verify scripts
docs/                       Rocketbox integration, testing checklist
```

## Known limitations

These are real gaps, not planned features:

- **Single floor.** The navigation grid is 2.5D (one walkable height per cell), so overlapping floors are not supported. The bank is one level. Stairs are supported in the grid, but no mission uses them.
- **Only one contract is playable.** The other contracts on the board are labelled as locked future missions.
- **Some skill unlocks are not wired.** These include suppression fire, pocket ECM, body carrier, ghostwalk, advanced hacks, backdoor intel, the blackout protocol, fast orders, crew suppression, anti-jam, strong barricades, small talk, uniform eye, crowd comfort and master face. Skill stat effects (recoil, damage, noise, speed, armour, health) are applied.
- **Crew upgrades:** only the armour tier effect is applied. Other tier effects are descriptive only.
- **Approaches** change real rules but modestly: Quiet reduces suspicion by 10%, Loud speeds up response and adds 10% loot, Technical lowers hack difficulty by one tier, Social improves the manager override chance.
- **Saves are between contracts.** Progress is saved when a contract ends and when loadouts or plans change. Refreshing mid-mission abandons the contract with no penalty.
- **Audio** is synthesised. There are no recorded voice lines, so NPC dialogue is subtitled and uses short synthesised blips.
- **Performance** was measured only in software rendering. The simulation costs about 2 ms per frame with 20 NPCs. Real-GPU frame rate is unverified.
- **Rocketbox has no death or aim-pose animations.** Death is a procedural fall, and weapons are attached to the hand without an aim pose.
- **Blood** is not depicted. Impacts show dust and decals only.
- Only desktop Chromium was tested end to end. Firefox and Safari are not verified.

See `docs/TESTING.md` for the full test results and the untested areas.

## Licence

Game code is provided for the project owner. Microsoft Rocketbox assets (if downloaded) are MIT licensed. See `docs/ROCKETBOX.md`.
