#!/usr/bin/env node
/**
 * Verifies that Rocketbox FBX assets parse correctly with three.js' FBXLoader
 * in a headless environment: skeleton presence, skinned meshes, bone names,
 * animation clips and bone-name compatibility between avatars and animation
 * files (which is what makes runtime retargeting possible).
 *
 * Usage: node tools/verify-rocketbox.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal DOM stubs so three's ImageLoader/FileLoader don't crash headlessly.
// Textures referenced inside the FBX (Windows paths) simply fail to load,
// which is fine — the game assigns its own converted JPEG textures.
const noop = () => {};
globalThis.document = {
  createElementNS: () => ({
    style: {}, width: 0, height: 0, complete: false,
    addEventListener: noop, removeEventListener: noop,
    set src(_v) { /* drop external texture requests */ }, get src() { return ''; },
    crossOrigin: '',
  }),
  createElement: () => ({ style: {}, getContext: () => null }),
};
globalThis.window = globalThis;
globalThis.self = globalThis;

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ASSETS = join(ROOT, 'public/assets/models/rocketbox');

// FBXLoader's texture paths point at nonexistent Windows dirs — that's fine,
// loading errors are logged and materials stay white; we re-texture manually.
const loader = new FBXLoader();

async function parse(rel) {
  const buf = await readFile(join(ASSETS, rel));
  const group = loader.parse(buf.buffer, '');
  return group;
}

function collectBones(obj, out = []) {
  if (obj.isBone) out.push(obj.name);
  for (const c of obj.children) collectBones(c, out);
  return out;
}

function collectSkinned(obj, out = []) {
  if (obj.isSkinnedMesh) out.push(obj);
  for (const c of obj.children) collectSkinned(c, out);
  return out;
}

function collectMaterials(obj, out = []) {
  if (obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) if (!out.includes(m.name)) out.push(m.name);
  }
  for (const c of obj.children) collectMaterials(c, out);
  return out;
}

const report = { avatars: {}, animations: {}, retargetCompatible: false };

console.log('== AVATARS ==');
const avatarFiles = ['Security_Male_01', 'Police_Male_01', 'Business_Female_02', 'Sports_Male_01'];
let refBones = null;
for (const name of avatarFiles) {
  const g = await parse(`avatars/${name}.fbx`);
  const bones = collectBones(g);
  const skinned = collectSkinned(g);
  const mats = collectMaterials(g);
  const verts = skinned.reduce((s, m) => s + (m.geometry?.attributes?.position?.count || 0), 0);
  console.log(`${name}: bones=${bones.length} skinnedMeshes=${skinned.length} verts=${verts} materials=[${mats.join(', ')}]`);
  console.log(`   first bones: ${bones.slice(0, 6).join(' | ')}`);
  if (skinned[0]?.skeleton) console.log(`   skeleton bones: ${skinned[0].skeleton.bones.length}`);
  report.avatars[name] = { bones: bones.length, skinnedMeshes: skinned.length, verts, materials: mats, boneNames: bones };
  if (!refBones) refBones = new Set(bones);
}

console.log('\n== ANIMATIONS ==');
const animFiles = ['walk', 'run', 'idle', 'look_around', 'crouch_idle', 'talk', 'walk_fast', 'walk_female', 'run_female'];
for (const name of animFiles) {
  const g = await parse(`animations/${name}.fbx`);
  const clips = g.animations || [];
  const bones = collectBones(g);
  const info = clips.map((c) => ({
    name: c.name,
    tracks: c.tracks.length,
    duration: +c.duration.toFixed(2),
    sampleTracks: c.tracks.slice(0, 3).map((t) => t.name),
  }));
  console.log(`${name}.fbx: clips=${clips.length} bones=${bones.length} ${JSON.stringify(info)}`);
  report.animations[name] = info;
  // Retarget check: do clip track bone names exist in avatar skeleton?
  if (clips.length && refBones) {
    let matched = 0, total = 0;
    for (const t of clips[0].tracks) {
      const boneName = t.name.split('.')[0];
      total++;
      if (refBones.has(boneName)) matched++;
    }
    console.log(`   retarget vs Security_Male_01 skeleton: ${matched}/${total} tracks resolve`);
    if (matched / total > 0.9) report.retargetCompatible = true;
  }
}

await readFile(join(ASSETS, 'rocketbox-manifest.json'));
console.log('\nRESULT:', report.retargetCompatible ? 'RETARGET-COMPATIBLE' : 'CHECK FAILED');
console.log(JSON.stringify({ retargetCompatible: report.retargetCompatible }, null, 2));
