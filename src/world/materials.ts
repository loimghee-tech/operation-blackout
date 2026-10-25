/**
 * Procedural material library. All textures are generated on <canvas> at
 * runtime — zero external image dependencies, tiny memory footprint, and
 * everything disposes cleanly between levels.
 */
import * as THREE from 'three';
import type { SurfaceType } from '../core/types';

export type MaterialKey =
  | 'marble' | 'marbleDark' | 'carpet' | 'carpetRed' | 'tile' | 'concrete'
  | 'wood' | 'woodDark' | 'wall' | 'wallTrim' | 'brick' | 'metal' | 'metalDark'
  | 'vaultSteel' | 'glass' | 'asphalt' | 'sidewalk' | 'ceiling' | 'gold'
  | 'screen' | 'fabric' | 'paper' | 'plastic' | 'rubber' | 'roofGravel' | 'hedge';

const cache = new Map<string, THREE.Texture>();

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = 1): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Deterministic value noise helper for texture painters. */
function noise2D(seed: number): (x: number, y: number) => number {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const grid: number[][] = [];
  for (let i = 0; i < 16; i++) { grid.push([]); for (let j = 0; j < 16; j++) grid[i].push(rnd()); }
  return (x: number, y: number) => {
    const xi = Math.floor(x) % 16, yi = Math.floor(y) % 16;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const x1 = (xi + 1) % 16, y1 = (yi + 1) % 16;
    const v00 = grid[yi][xi], v10 = grid[yi][x1], v01 = grid[y1][xi], v11 = grid[y1][x1];
    const tx = xf * xf * (3 - 2 * xf), ty = yf * yf * (3 - 2 * yf);
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };
}

function speckle(ctx: CanvasRenderingContext2D, size: number, base: string, speckColors: string[], density: number, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const n = noise2D(seed);
  for (let i = 0; i < density; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const v = n(x / 40, y / 40);
    ctx.fillStyle = speckColors[Math.floor(v * speckColors.length) % speckColors.length];
    ctx.globalAlpha = 0.25 + v * 0.5;
    const r = 0.6 + v * 2.4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function makeTextures(): void {
  if (cache.size > 0) return;

  cache.set('marble', canvasTexture(512, (ctx) => {
    ctx.fillStyle = '#d8d5cc'; ctx.fillRect(0, 0, 512, 512);
    // veins
    ctx.strokeStyle = 'rgba(120,115,105,0.35)';
    for (let i = 0; i < 14; i++) {
      ctx.lineWidth = 0.5 + Math.random() * 2;
      ctx.beginPath();
      let x = Math.random() * 512, y = Math.random() * 512;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (Math.random() - 0.5) * 180; y += (Math.random() - 0.5) * 180; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // tile grid 2x2
    ctx.strokeStyle = 'rgba(90,88,80,0.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256); ctx.strokeRect(256, 0, 256, 256);
    ctx.strokeRect(0, 256, 256, 256); ctx.strokeRect(256, 256, 256, 256);
    speckle(ctx, 512, 'rgba(0,0,0,0)', ['#c9c5ba', '#e6e3da'], 900, 7);
  }, 3));

  cache.set('marbleDark', canvasTexture(512, (ctx) => {
    speckle(ctx, 512, '#3a3f45', ['#2e3238', '#464c53', '#52585f'], 1600, 21);
    ctx.strokeStyle = 'rgba(20,22,25,0.7)'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256); ctx.strokeRect(256, 256, 256, 256);
  }, 3));

  cache.set('carpet', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#39414d', ['#333a45', '#414a57', '#2e3540'], 3200, 5);
  }, 6));

  cache.set('carpetRed', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#5a2b30', ['#4e242a', '#673339', '#432025'], 3200, 9);
  }, 6));

  cache.set('tile', canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#b9bfc2'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#8d9498'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke();
    }
    speckle(ctx, 256, 'rgba(0,0,0,0)', ['#aab1b5', '#c6ccd0'], 500, 33);
  }, 4));

  cache.set('concrete', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#7d7d78', ['#71716c', '#8a8a84', '#666660'], 2600, 11);
  }, 4));

  cache.set('wood', canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#8a6a45'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 30},${30 + Math.random() * 20},0.4)`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 256;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
      ctx.stroke();
    }
  }, 3));

  cache.set('woodDark', canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#4a3524'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${40 + Math.random() * 30},${28 + Math.random() * 20},${16 + Math.random() * 14},0.5)`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 256;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y + Math.sin(i) * 4); ctx.stroke();
    }
  }, 3));

  cache.set('wall', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#cfc9bd', ['#c8c2b6', '#d6d0c4', '#c2bcb0'], 1500, 17);
  }, 4));

  cache.set('wallTrim', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#5c4a38', ['#54432f', '#665340', '#4b3a29'], 900, 23);
  }, 4));

  cache.set('brick', canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#6e6259'; ctx.fillRect(0, 0, 256, 256);
    const bw = 64, bh = 28;
    for (let row = 0; row < 256 / bh; row++) {
      const offset = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col < 256 / bw + 1; col++) {
        const x = col * bw + offset + 2, y = row * bh + 2;
        const v = Math.random() * 26 - 13;
        ctx.fillStyle = `rgb(${128 + v},${92 + v},${80 + v})`;
        ctx.fillRect(x, y, bw - 4, bh - 4);
      }
    }
  }, 6));

  cache.set('metal', canvasTexture(128, (ctx) => {
    speckle(ctx, 128, '#9aa0a6', ['#8d9399', '#a7adb3', '#7e848a'], 700, 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 128; i += 4) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke(); }
  }, 2));

  cache.set('metalDark', canvasTexture(128, (ctx) => {
    speckle(ctx, 128, '#3b3f44', ['#34383d', '#454a50', '#2c3034'], 700, 8);
  }, 2));

  cache.set('vaultSteel', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#77808a', ['#6d767f', '#838c96', '#5f686f'], 900, 13);
    // rivets
    ctx.fillStyle = '#565e66';
    for (let i = 16; i < 256; i += 32) {
      for (let j = 16; j < 256; j += 32) {
        if ((i + j) % 64 === 32) { ctx.beginPath(); ctx.arc(i, j, 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  }, 2));

  cache.set('asphalt', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#33363a', ['#2c2e32', '#3c3f44', '#26282b'], 3000, 19);
    ctx.strokeStyle = 'rgba(220,200,60,0.7)'; ctx.lineWidth = 4;
    ctx.setLineDash([36, 28]);
    ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke();
    ctx.setLineDash([]);
  }, 8));

  cache.set('sidewalk', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#87898c', ['#7d7f82', '#929498', '#74767a'], 1800, 29);
    ctx.strokeStyle = 'rgba(60,62,64,0.6)'; ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 128, 128); ctx.strokeRect(128, 128, 128, 128);
  }, 8));

  cache.set('ceiling', canvasTexture(128, (ctx) => {
    speckle(ctx, 128, '#b8b6ae', ['#b0aea6', '#c0beb6'], 600, 37);
    ctx.strokeStyle = 'rgba(120,118,112,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 64, 64); ctx.strokeRect(64, 64, 64, 64);
  }, 4));

  cache.set('gold', canvasTexture(128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, '#c9a227'); g.addColorStop(0.5, '#f0d468'); g.addColorStop(1, '#b8860b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }, 1));

  cache.set('roofGravel', canvasTexture(256, (ctx) => {
    speckle(ctx, 256, '#55524c', ['#4b4842', '#605d56', '#413e39'], 2400, 41);
  }, 6));

  cache.set('hedge', canvasTexture(128, (ctx) => {
    speckle(ctx, 128, '#2e4a2a', ['#274022', '#38572f', '#1f331b'], 1200, 43);
  }, 2));

  cache.set('fabric', canvasTexture(128, (ctx) => {
    speckle(ctx, 128, '#43506b', ['#3d4963', '#4a5875', '#374259'], 900, 47);
  }, 3));

  cache.set('screen', canvasTexture(64, (ctx) => {
    ctx.fillStyle = '#0a1420'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1d4d6b';
    for (let i = 0; i < 10; i++) ctx.fillRect(4 + Math.random() * 40, 6 + i * 6, 8 + Math.random() * 14, 2);
  }, 1));

  cache.set('paper', canvasTexture(64, (ctx) => {
    speckle(ctx, 64, '#ded8c8', ['#d6d0c0', '#e6e0d0'], 300, 53);
  }, 2));

  cache.set('plastic', canvasTexture(64, (ctx) => {
    speckle(ctx, 64, '#22252a', ['#1c1f24', '#2a2e34'], 200, 59);
  }, 1));

  cache.set('rubber', canvasTexture(64, (ctx) => {
    speckle(ctx, 64, '#181a1c', ['#141517', '#1e2124'], 200, 61);
  }, 1));

  cache.set('glass', canvasTexture(64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, 'rgba(180,210,230,0.5)');
    g.addColorStop(1, 'rgba(120,160,190,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  }, 1));
}

export interface MatDef {
  color?: number;
  roughness: number;
  metalness: number;
  texture?: string;
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
}

const MATERIAL_DEFS: Record<MaterialKey, MatDef> = {
  marble: { texture: 'marble', roughness: 0.25, metalness: 0.05 },
  marbleDark: { texture: 'marbleDark', roughness: 0.3, metalness: 0.08 },
  carpet: { texture: 'carpet', roughness: 0.95, metalness: 0 },
  carpetRed: { texture: 'carpetRed', roughness: 0.95, metalness: 0 },
  tile: { texture: 'tile', roughness: 0.4, metalness: 0.02 },
  concrete: { texture: 'concrete', roughness: 0.9, metalness: 0 },
  wood: { texture: 'wood', roughness: 0.6, metalness: 0.02 },
  woodDark: { texture: 'woodDark', roughness: 0.55, metalness: 0.02 },
  wall: { texture: 'wall', roughness: 0.85, metalness: 0 },
  wallTrim: { texture: 'wallTrim', roughness: 0.6, metalness: 0.05 },
  brick: { texture: 'brick', roughness: 0.9, metalness: 0 },
  metal: { texture: 'metal', roughness: 0.4, metalness: 0.7 },
  metalDark: { texture: 'metalDark', roughness: 0.5, metalness: 0.6 },
  vaultSteel: { texture: 'vaultSteel', roughness: 0.35, metalness: 0.85 },
  glass: { texture: 'glass', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28 },
  asphalt: { texture: 'asphalt', roughness: 0.95, metalness: 0 },
  sidewalk: { texture: 'sidewalk', roughness: 0.9, metalness: 0 },
  ceiling: { texture: 'ceiling', roughness: 0.9, metalness: 0 },
  gold: { texture: 'gold', roughness: 0.2, metalness: 0.95 },
  screen: { texture: 'screen', roughness: 0.3, metalness: 0.1, emissive: 0x3aa0d8, emissiveIntensity: 0.9 },
  fabric: { texture: 'fabric', roughness: 0.9, metalness: 0 },
  paper: { texture: 'paper', roughness: 0.9, metalness: 0 },
  plastic: { texture: 'plastic', roughness: 0.55, metalness: 0.05 },
  rubber: { texture: 'rubber', roughness: 0.95, metalness: 0 },
  roofGravel: { texture: 'roofGravel', roughness: 0.95, metalness: 0 },
  hedge: { texture: 'hedge', roughness: 0.95, metalness: 0 },
};

let built = false;
const materials = new Map<string, THREE.MeshStandardMaterial>();

export function getMaterial(key: MaterialKey, colorOverride?: number): THREE.MeshStandardMaterial {
  if (!built) { makeTextures(); built = true; }
  const id = colorOverride !== undefined ? `${key}#${colorOverride.toString(16)}` : key;
  let mat = materials.get(id);
  if (!mat) {
    const def = MATERIAL_DEFS[key] ?? MATERIAL_DEFS.concrete;
    const tex = def.texture ? cache.get(def.texture)?.clone() : undefined;
    if (tex) {
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(cache.get(def.texture!)!.repeat.x, cache.get(def.texture!)!.repeat.y);
    }
    mat = new THREE.MeshStandardMaterial({
      map: tex ?? null,
      color: colorOverride ?? 0xffffff,
      roughness: def.roughness,
      metalness: def.metalness,
      transparent: def.transparent ?? false,
      opacity: def.opacity ?? 1,
      emissive: def.emissive ?? 0x000000,
      emissiveIntensity: def.emissiveIntensity ?? 1,
      side: def.side ?? THREE.FrontSide,
    });
    materials.set(id, mat);
  }
  return mat;
}

export const SURFACE_TO_MATERIAL: Record<SurfaceType, MaterialKey> = {
  concrete: 'concrete', marble: 'marble', carpet: 'carpet',
  metal: 'metal', wood: 'wood', glass: 'glass', dirt: 'roofGravel',
};

export function disposeMaterials(): void {
  for (const m of materials.values()) m.dispose();
  materials.clear();
  for (const t of cache.values()) t.dispose();
  cache.clear();
  built = false;
}
