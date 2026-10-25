# Test checklist and results

All results below come from runs on 2026-10-25 in this environment: Node 22, Vite 8.3.5, headless Chromium 14x (`@sparticuz/chromium` + `puppeteer-core`), software WebGL (SwiftShader). Frame rates here are roughly 2–25 fps. They reflect software rendering, not a GPU, so no FPS claim is made.

## Automated

| Suite | Command | Result |
|---|---|---|
| Unit + integration (vitest) | `npm test` | **86 / 86 passed** across 11 files (campaign, economy, save, perception, alarm, weapons, mission objectives, level integrity, settings, navigation, collision) |
| Type check | `npm run typecheck` | passes |
| Production build | `npm run build` | passes; outputs `dist/` (about 0.94 MB JS, 0.25 MB CSS, plus copied Rocketbox assets if installed) |
| Browser scenario suite | puppeteer script (not in repo) | **37 / 37 passed** |

## Browser scenarios (checklist mapped to the spec)

| # | Check | Result |
|---|---|---|
| 1 | Game starts in a browser; main menu renders | PASS |
| 2 | New campaign starts; class selection then hub | PASS |
| 3 | Class selection grants the class starting equipment (no loadout problems) | PASS |
| 4 | Rocketbox characters render when assets are installed | PASS |
| 5 | Deploy starts the mission (active phase, 19 NPCs) | PASS |
| 6 | Guards navigate patrol routes | PASS |
| 7 | NPCs stay in walkable rooms | PASS |
| 8 | Guard sees the player in its cone; suspicion rises | PASS |
| 9 | No sight through closed walls/doors | PASS |
| 10 | Guard hears gunfire and investigates | PASS |
| 11 | Radio: teammates alerted when one reports | PASS |
| 12 | Civilians react to gunfire (flee) | PASS |
| 13 | Alerted guard shoots back; armour absorbs first | PASS |
| 14 | Player hitscan damages an NPC | PASS |
| 15 | Taser incapacitates without killing | PASS |
| 16 | Harming a civilian is recorded | PASS |
| 17 | Alarm escalates to TRIGGERED with siren | PASS |
| 18 | Alarm panel cut caps escalation (no lockdown) | PASS |
| 19 | Hack minigame opens; solving it turns cameras off and completes the objective | PASS |
| 20 | Civilian disguise: staff door needs a hack; staff disguise opens it without one | PASS |
| 21 | Vault door cannot be opened from the door alone | PASS |
| 22 | Objectives track and complete in order | PASS |
| 23 | Vault opened → gold secured → extraction available at the van | PASS |
| 24 | Extraction completes; results screen with payout; mission saved | PASS |
| 25 | Refresh, then Continue restores money and class | PASS |
| 26 | Corrupted save does not crash; starts from the menu | PASS |
| 27 | Missing Rocketbox manifest → procedural characters; deploy still works | PASS |
| 28 | Planning choices (staff entry, staff disguise) change the deploy point and access | PASS |
| 29 | Escape pauses; Resume button resumes | PASS |

Unit-level spot checks cover: class starters, loadout validation and repair, skill prerequisites and point costs, shop and crew purchases, XP levels, reward formula (failure, stealth, civilians, optional objectives, difficulty), save versioning and migration, write-failure handling, sight cone and range, wall-blocked line of sight, hearing attenuation, alarm transitions, perimeter timer, auto-fire release count, reload interruption, falloff, attachments changing real stats, and bank level referential integrity.

## Bugs found and fixed during testing

- Class starter equipment was not added to the campaign inventory.
- Automatic fire released at most one round per frame.
- Closed doors did not block sight.
- Civilians could escalate into the guards' investigation state.
- Distant NPCs (level-of-detail think schedule) could miss gunfire entirely.
- `sanitizeCampaign` crashed on an unknown class id.
- `repairLoadout` could produce an invalid primary.
- The street spawn was inside the exterior guard's view.
- Entry facings were inverted; the reported detection peak could exceed 100%.
- The vault door prompt offered a breach that didn't exist.

## Not tested / not verified

- Real-GPU frame rate and the 60 FPS target. Software rendering was used.
- Real audio output (audio is synthesised; not listened to in this environment).
- Gamepad, touch, or non-Chromium browsers.
- Long sessions, memory growth over many missions.
- Hacking minigames other than the pattern puzzle were not driven end-to-end (sequence, timing and circuit code paths are implemented and type-checked but were not played through in the browser).
- The tactical map, inventory and pause overlays were not captured in screenshots.
