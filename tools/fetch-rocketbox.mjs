#!/usr/bin/env node
/**
 * OPERATION: BLACKOUT — Rocketbox asset fetch & conversion tool
 * ------------------------------------------------------------------
 * Downloads a curated subset of Microsoft Rocketbox avatars/animations
 * (MIT License, (c) 2020 Microsoft — see public/assets/models/rocketbox/LICENSE)
 * from the official GitHub repository via the GitHub REST API and
 * prepares them for direct use with three.js' FBXLoader at runtime.
 *
 * What it does:
 *   1. Reads the repository git tree (single API call) to find file SHAs.
 *   2. Downloads curated avatar body FBX files (~600 KB each).
 *   3. Downloads curated animation FBX files (~1-2 MB each).
 *   4. Downloads diffuse color TGA textures (12 MB each in the source repo)
 *      and converts them to compact 1024px JPEGs using Python + Pillow
 *      (`pip install pillow`). If Pillow is unavailable the raw TGAs are
 *      kept and a warning is printed (the runtime loader can read TGAs too,
 *      but JPEGs keep the repo small).
 *   5. Writes rocketbox-manifest.json used by the in-game character loader.
 *
 * Usage:
 *   node tools/fetch-rocketbox.mjs [--out public/assets/models/rocketbox]
 *                                  [--skip-textures] [--token <GITHUB_TOKEN>]
 *
 * The game runs perfectly WITHOUT these assets: the character pipeline
 * falls back to built-in procedural characters. This script only adds
 * photoreal-ish human models for NPCs. See docs/ROCKETBOX.md.
 */
import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'microsoft/Microsoft-Rocketbox';
const BRANCH = 'master';
const API = 'https://api.github.com';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Curated asset selection (role -> Rocketbox avatar).
// All avatars share one skeleton, so any animation retargets to any avatar.
// ---------------------------------------------------------------------------
const AVATARS = [
  'Security_Male_01',     // bank security guards
  'Security_Female_01',   // bank security guards
  'Police_Male_01',       // police response units
  'Police_Female_01',     // police response units
  'Military_Male_01',     // heavy response units (SWAT-style)
  'Business_Male_01',     // bank manager / male civilians
  'Business_Female_02',   // receptionist / female civilians
  'Sports_Male_01',       // crew member (casual) / civilians
  'Medical_Male_01',      // crew medic
  'Construction_Male_01', // crew engineer
];

// Locomotion loops come from the root-motion-extracted "xy" set,
// in-place gestures/idles come from the "static" set.
const ANIMATIONS = [
  { file: 'all_animations_max_motextr_xy/m_walk_neutral.max.fbx',            clip: 'walk' },
  { file: 'all_animations_max_motextr_xy/f_walk_neutral.max.fbx',            clip: 'walk_female' },
  { file: 'all_animations_max_motextr_xy/m_run_neutral.max.fbx',             clip: 'run' },
  { file: 'all_animations_max_motextr_xy/f_run_neutral.max.fbx',             clip: 'run_female' },
  { file: 'all_animations_max_motextr_xy/m_run_slow_01.max.fbx',             clip: 'walk_fast' },
  { file: 'all_animations_max_motextr_static/f_idle_breathe_01.max.fbx',     clip: 'idle' },
  { file: 'all_animations_max_motextr_static/f_idle_look_around_01.max.fbx', clip: 'look_around' },
  { file: 'all_animations_max_motextr_static/m_crouch_idle.max.fbx',         clip: 'crouch_idle' },
  { file: 'all_animations_max_motextr_static/f_gestic_listen_accept_01.max.fbx', clip: 'talk' },
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT_DIR = join(ROOT, getArg('out', 'public/assets/models/rocketbox'));
const SKIP_TEXTURES = args.includes('--skip-textures');
const TOKEN = getArg('token', process.env.GITHUB_TOKEN || '');

let calls = 0;
async function gh(path) {
  calls++;
  let res;
  try {
    res = await ghFetch(path);
  } catch (err) {
    if (String(err?.cause?.message || err?.message).includes('certificate')) {
      throw new Error(
        'TLS certificate verification failed. If you are behind a TLS-inspecting proxy, re-run with:\n' +
        '  NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt node tools/fetch-rocketbox.mjs');
    }
    throw err;
  }
  return res;
}

async function ghFetch(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      'User-Agent': 'operation-blackout-asset-tool',
      Accept: 'application/vnd.github+json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(`GitHub API ${res.status} for ${path} (rate-limit remaining: ${remaining})`);
  }
  return res.json();
}

async function downloadBlob(sha, destPath) {
  if (existsSync(destPath)) return false; // idempotent
  const blob = await gh(`/repos/${REPO}/git/blobs/${sha}`);
  const buf = Buffer.from(blob.content, 'base64');
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
  return true;
}

function convertTgaToJpeg(tgaPath, jpegPath, size = 1024, quality = 78) {
  const py = spawnSync('python3', ['-c', `
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB')
img.thumbnail((int(sys.argv[2]), int(sys.argv[2])), Image.LANCZOS)
img.save(sys.argv[3], 'JPEG', quality=int(sys.argv[4]), optimize=True)
`, tgaPath, String(size), jpegPath, String(quality)]);
  return py.status === 0;
}

async function main() {
  console.log(`Rocketbox asset fetch -> ${OUT_DIR}`);
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(OUT_DIR, 'avatars'), { recursive: true });
  await mkdir(join(OUT_DIR, 'animations'), { recursive: true });

  // License attribution (required by MIT).
  const lic = await gh(`/repos/${REPO}/contents/LICENSE.md`);
  await writeFile(join(OUT_DIR, 'LICENSE'), Buffer.from(lic.content, 'base64'));
  await writeFile(join(OUT_DIR, 'ATTRIBUTION.txt'),
    `Character models and animations from Microsoft Rocketbox\nhttps://github.com/${REPO}\nMIT License (c) 2020 Microsoft\n\n` +
    `Files in this folder were fetched from the repository above and (for textures)\nconverted from TGA to JPEG. No other modifications were made.\n`);

  // 1. Full tree in one call.
  console.log('Reading repository git tree...');
  const tree = await gh(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  if (tree.truncated) console.warn('WARNING: tree response truncated; some files may not be found.');
  const byPath = new Map(tree.tree.map((e) => [e.path, e]));
  const find = (p) => {
    const e = byPath.get(p);
    if (!e || e.type !== 'blob') throw new Error(`Not found in repo tree: ${p}`);
    return e.sha;
  };

  const manifest = {
    generator: 'tools/fetch-rocketbox.mjs',
    source: `https://github.com/${REPO}`,
    license: 'MIT (c) 2020 Microsoft',
    coordinateNotes: 'Rocketbox FBX are Y-up, units in cm-ish scale; runtime loader normalizes scale and strips root motion for locomotion clips.',
    avatars: {},
    animations: {},
  };

  // 2. Avatars + textures
  for (const name of AVATARS) {
    const base = `Assets/Avatars/Professions/${name}`;
    console.log(`Avatar: ${name}`);
    const fbxSha = find(`${base}/Export/${name}.fbx`);
    const fbxPath = join(OUT_DIR, 'avatars', `${name}.fbx`);
    if (await downloadBlob(fbxSha, fbxPath)) console.log(`  downloaded ${name}.fbx`);

    const entry = { fbx: `avatars/${name}.fbx`, textures: {} };
    if (!SKIP_TEXTURES) {
      // find color TGAs in the avatar's Textures folder
      const texPrefix = `${base}/Textures/`;
      const colorMaps = tree.tree.filter((e) =>
        e.path.startsWith(texPrefix) && e.path.endsWith('_color.tga'));
      for (const t of colorMaps) {
        const kind = t.path.includes('body') ? 'body'
                   : t.path.includes('head') ? 'head'
                   : t.path.includes('equipment') ? 'equipment' : null;
        if (!kind) continue;
        const tmpTga = join(OUT_DIR, 'avatars', `_tmp_${name}_${kind}.tga`);
        const jpegName = `${name}_${kind}.jpg`;
        const jpegPath = join(OUT_DIR, 'avatars', jpegName);
        if (existsSync(jpegPath)) { entry.textures[kind] = `avatars/${jpegName}`; continue; }
        console.log(`  texture ${kind} (${(t.size / 1e6).toFixed(1)} MB TGA)...`);
        await downloadBlob(t.sha, tmpTga);
        if (convertTgaToJpeg(tmpTga, jpegPath)) {
          await rm(tmpTga);
          entry.textures[kind] = `avatars/${jpegName}`;
        } else {
          console.warn(`  Pillow conversion failed; keeping raw TGA. Install with: pip install pillow`);
          const tgaName = `${name}_${kind}.tga`;
          await writeFile(join(OUT_DIR, 'avatars', tgaName), await readFile(tmpTga));
          await rm(tmpTga);
          entry.textures[kind] = `avatars/${tgaName}`;
        }
      }
    }
    manifest.avatars[name] = entry;
  }

  // 3. Animations
  for (const anim of ANIMATIONS) {
    const p = `Assets/Animations/${anim.file}`;
    console.log(`Animation: ${anim.clip} (${anim.file})`);
    const sha = find(p);
    const outName = `${anim.clip}.fbx`;
    if (await downloadBlob(sha, join(OUT_DIR, 'animations', outName))) {
      console.log(`  downloaded -> ${outName}`);
    }
    manifest.animations[anim.clip] = { fbx: `animations/${outName}`, source: p };
  }

  manifest.fetchedAt = new Date().toISOString();
  await writeFile(join(OUT_DIR, 'rocketbox-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Done. ${calls} API calls. Manifest written to rocketbox-manifest.json`);
}

main().catch((err) => {
  console.error('FETCH FAILED:', err.message);
  console.error('The game does not require these assets (procedural fallbacks are used).');
  console.error('You can re-run this script later: npm run fetch-assets');
  process.exit(1);
});
