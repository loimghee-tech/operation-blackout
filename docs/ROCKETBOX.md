# Microsoft Rocketbox integration

OPERATION: BLACKOUT can use Microsoft Rocketbox avatars for NPCs. The game does **not** require them: without the assets it renders procedural characters, and it logs the state in the main menu footer.

## What was verified (2026-10-25)

Checked against `microsoft/Microsoft-Rocketbox` (default branch `master`):

| Item | Finding |
|---|---|
| Licence | MIT (c) 2020 Microsoft (`LICENSE.md`). Redistribution with attribution is permitted. |
| Avatar format | FBX (`Assets/Avatars/Professions/<Name>/Export/<Name>.fbx`), about 0.5–0.9 MB each. |
| Textures | TGA in each avatar's `Textures/` folder (about 12 MB each). The fetch tool converts colour maps to JPEG with Pillow. |
| Skeleton | All avatars share a `Bip01` biped (81 bones). |
| Animations | FBX in `Assets/Animations/all_animations_max_motextr_xy` (locomotion) and `..._static` (idles, gestures). |
| Retargeting | Animation tracks use the same bone names. 243/248 tracks resolve on `Security_Male_01`. The remainder (`MotionExtractionHelper`) is dropped at load time. No IK retargeting is needed. |
| Death animation | None in the set. Death is a procedural fall. |
| Hold-weapon pose | No aim pose in the set. Weapons are attached to the right hand bone. |

Verification script: `node tools/verify-rocketbox.mjs` (needs the assets installed first).

## Installing the assets

```bash
npm run fetch-assets        # downloads ~20 MB into public/assets/models/rocketbox/
npm run dev                 # or npm run build
```

`tools/fetch-rocketbox.mjs` reads the GitHub git tree through the REST API and downloads:
- 10 avatars (security, police, military, business, medical, construction, sports)
- 9 animation clips (walk, run, idle, crouch, talk, look-around)
- colour, head, body and equipment textures, converted to JPEG (needs `python3` with Pillow: `pip install pillow`)
- `LICENSE` and `ATTRIBUTION.txt`, plus `rocketbox-manifest.json`, which the runtime reads.

Set `GITHUB_TOKEN` to avoid API rate limits. In sandboxes that use a TLS-intercepting proxy, run with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

The downloaded binaries are git-ignored (`public/assets/models/rocketbox/`). Keep them out of the repository.

## How the runtime uses them

- `src/characters/human.ts`
  - `CharacterLibrary` fetches the manifest once. A missing or unreadable manifest is not an error; the library reports `missing` or `error` and the game continues.
  - `avatar(key)` loads an FBX once and assigns textures by material name suffix (`_body`, `_head`, `_equipment`). It normalises height to 1.78 m and sits the feet on y=0.
  - `retargetClip()` filters tracks to the avatar's bones and removes root translation (`Bip01.position`), because movement is driven by physics.
  - `createHuman()` clones the template with `SkeletonUtils`, builds an `AnimationMixer`, and returns a `RocketboxHuman`. Any failure falls back to `ProceduralHuman`.
- The NPC AI never refers to the model. `AppearanceSpec.modelKey` names the preferred avatar and `modelFallbacks` lists alternatives (see `src/missions/bank.ts`). Each NPC state maps to a locomotion state (`idle`, `walk`, `run`, `crouch`, `talk`, `dead`).
- Animation LOD: full rate within 22 m, 15 Hz to 55 m, frozen beyond 55 m.

## Replacing or adding characters

1. Add an avatar's FBX and textures to `public/assets/models/rocketbox/` and an entry in `rocketbox-manifest.json`. The `fbx` path is relative to that folder.
2. Reference the key in an NPC's `modelKey` or `modelFallbacks` (for example in `src/missions/bank.ts`).
3. Avatars must share the `Bip01` skeleton to use the shared animation set. Other skeletons need their own clip set.

## Licence notes

Rocketbox is MIT licensed. The distributed game must keep `LICENSE` and `ATTRIBUTION.txt` alongside the models (the fetch tool writes both). Nothing from Rocketbox is committed to this repository.
