/**
 * Character visuals.
 *
 *  - RocketboxHuman: Microsoft Rocketbox FBX avatars + FBX animation clips
 *    (retargeted by bone name — all Rocketbox avatars share the Bip01 skeleton).
 *  - ProceduralHuman: built-in capsule/box humanoid with a code-driven pose
 *    system. Used when the optional Rocketbox assets are not installed, and
 *    for any model that fails to load — the game never depends on it.
 *
 * Both implement HumanVisual so NPC AI never cares which one it has.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AppearanceSpec } from '../core/types';

export type LocoState = 'idle' | 'walk' | 'run' | 'crouch' | 'talk' | 'dead';

export interface HumanVisual {
  readonly root: THREE.Object3D;
  readonly kind: 'rocketbox' | 'procedural';
  setState(state: LocoState, speed: number, aiming: boolean): void;
  /** Attach a prop to the right hand. */
  attachHeld(obj: THREE.Object3D): void;
  update(dt: number, visible: boolean): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Asset library: loads the Rocketbox manifest (if present) once.
// ---------------------------------------------------------------------------
export interface RocketboxManifest {
  avatars: Record<string, { fbx: string; textures: Record<string, string> }>;
  animations: Record<string, { fbx: string }>;
}

export class CharacterLibrary {
  private manifest: RocketboxManifest | null = null;
  private status: 'idle' | 'loading' | 'ready' | 'missing' | 'error' = 'idle';
  private avatarTemplates = new Map<string, Promise<THREE.Object3D | null>>();
  private clipCache = new Map<string, Promise<THREE.AnimationClip | null>>();
  private textureCache = new Map<string, THREE.Texture>();
  private loader = new FBXLoader();
  readonly base: string;
  message = '';

  constructor(base = import.meta.env?.BASE_URL ?? './') {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  get ready(): boolean { return this.status === 'ready'; }
  get state(): string { return this.status; }
  get avatarKeys(): string[] { return this.manifest ? Object.keys(this.manifest.avatars) : []; }

  /** Loads the manifest. Never throws: a missing manifest simply selects procedural characters. */
  async init(): Promise<void> {
    if (this.status === 'loading' || this.status === 'ready') return;
    this.status = 'loading';
    try {
      const res = await fetch(`${this.base}assets/models/rocketbox/rocketbox-manifest.json`, { cache: 'no-cache' });
      if (!res.ok) {
        this.status = 'missing';
        this.message = 'Rocketbox assets not installed — using built-in characters. Run "npm run fetch-assets".';
        return;
      }
      this.manifest = (await res.json()) as RocketboxManifest;
      this.status = 'ready';
      this.message = `Rocketbox: ${this.avatarKeys.length} avatars available.`;
    } catch (err) {
      this.status = 'error';
      this.message = `Rocketbox manifest unreadable (${err instanceof Error ? err.message : 'error'}); using built-in characters.`;
    }
  }

  hasAvatar(key: string | undefined): boolean {
    return !!(this.manifest && key && this.manifest.avatars[key]);
  }

  private url(rel: string): string { return `${this.base}assets/models/rocketbox/${rel}`; }

  private texture(rel: string): THREE.Texture {
    let t = this.textureCache.get(rel);
    if (!t) {
      t = new THREE.TextureLoader().load(this.url(rel));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.textureCache.set(rel, t);
    }
    return t;
  }

  /** Loads (once) and returns a fully textured avatar template, or null on failure. */
  avatar(key: string): Promise<THREE.Object3D | null> {
    if (!this.manifest || !this.manifest.avatars[key]) return Promise.resolve(null);
    let p = this.avatarTemplates.get(key);
    if (!p) {
      const entry = this.manifest.avatars[key];
      p = this.loader.loadAsync(this.url(entry.fbx)).then((obj) => {
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = true;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          const newMats = mats.map((mat) => {
            const name = (mat as THREE.Material).name || '';
            const kind = name.endsWith('_head') ? 'head' : name.endsWith('_equipment') ? 'equipment' : name.endsWith('_body') ? 'body' : null;
            const rel = kind ? entry.textures[kind] : undefined;
            const std = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.02, color: 0xffffff });
            if (rel) std.map = this.texture(rel);
            else if (kind === null && entry.textures.body) std.map = this.texture(entry.textures.body);
            if (name.includes('opacity')) { std.transparent = true; std.opacity = 0.9; }
            return std;
          });
          m.material = Array.isArray(m.material) ? newMats : newMats[0];
        });
        // normalise scale to ~1.8 m tall (Rocketbox FBX export units vary)
        const box = new THREE.Box3().setFromObject(obj);
        const h = Math.max(0.001, box.max.y - box.min.y);
        const wrapper = new THREE.Group();
        obj.scale.multiplyScalar(1.78 / h);
        // lift so feet sit on y=0
        const b2 = new THREE.Box3().setFromObject(obj);
        obj.position.y -= b2.min.y;
        wrapper.add(obj);
        return wrapper;
      }).catch((err) => {
        console.warn(`[characters] failed to load avatar ${key}:`, err);
        return null;
      });
      this.avatarTemplates.set(key, p);
    }
    return p;
  }

  clip(name: string): Promise<THREE.AnimationClip | null> {
    if (!this.manifest || !this.manifest.animations[name]) return Promise.resolve(null);
    let p = this.clipCache.get(name);
    if (!p) {
      p = this.loader.loadAsync(this.url(this.manifest.animations[name].fbx)).then((g) => {
        const c = g.animations[0] ?? null;
        if (c) c.name = name;
        return c;
      }).catch(() => null);
      this.clipCache.set(name, p);
    }
    return p;
  }
}

// ---------------------------------------------------------------------------
// Rocketbox humanoid with AnimationMixer.
// ---------------------------------------------------------------------------
const CLIP_FOR: Record<LocoState, string[]> = {
  idle: ['idle', 'look_around'],
  walk: ['walk', 'walk_female'],
  run: ['run', 'run_female'],
  crouch: ['crouch_idle'],
  talk: ['talk', 'idle'],
  dead: [],
};

/**
 * Makes a Rocketbox clip safe for any Rocketbox avatar:
 *  - drops tracks for nodes the avatar does not have (e.g. "MotionExtractionHelper")
 *  - removes root translation (Bip01.position) so NPCs stay where physics puts them
 */
export function retargetClip(clip: THREE.AnimationClip, bones: Set<string>): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => {
    const [node, prop] = t.name.split('.');
    if (!bones.has(node)) return false;
    if (node === 'Bip01' && prop === 'position') return false;
    return true;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export class RocketboxHuman implements HumanVisual {
  readonly kind = 'rocketbox' as const;
  readonly root: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentState: LocoState | null = null;
  private held: THREE.Object3D | null = null;
  private hand: THREE.Object3D | null = null;
  private dead = false;
  private fallT = 0;

  constructor(private avatar: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.root = new THREE.Group();
    this.root.add(avatar);
    this.mixer = new THREE.AnimationMixer(avatar);
    for (const [name, clip] of clips) {
      const action = this.mixer.clipAction(clip);
      action.clampWhenFinished = false;
      this.actions.set(name, action);
    }
    this.hand = avatar.getObjectByName('Bip01_R_Hand') ?? avatar.getObjectByName('Bip01_R_Forearm') ?? null;
  }

  setState(state: LocoState, _speed: number, _aiming: boolean): void {
    if (state === 'dead') {
      if (!this.dead) { this.dead = true; this.fallT = 0; }
      return;
    }
    if (this.dead) { this.dead = false; this.root.rotation.x = 0; this.root.position.y = 0; }
    if (state === this.currentState) return;
    this.currentState = state;
    const candidates = CLIP_FOR[state];
    const name = candidates.find((n) => this.actions.has(n));
    const next = name ? this.actions.get(name)! : null;
    if (next === this.current) return;
    if (this.current) this.current.fadeOut(0.25);
    if (next) {
      next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    }
    this.current = next;
  }

  attachHeld(obj: THREE.Object3D): void {
    if (this.held) this.held.removeFromParent();
    this.held = obj;
    (this.hand ?? this.avatar).add(obj);
  }

  update(dt: number, visible: boolean): void {
    if (visible) this.mixer.update(dt);
    if (this.dead) {
      this.fallT = Math.min(1, this.fallT + dt * 1.6);
      this.root.rotation.x = -Math.PI / 2 * this.fallT;
      this.root.position.y = 0.2 * this.fallT;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => { (mm as THREE.Material).dispose(); });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Procedural humanoid (always available).
// ---------------------------------------------------------------------------
interface ProcColors {
  shirt: number; pants: number; skin: number; vest: number; hair: number;
  helmet: boolean; cap: boolean;
}

export class ProceduralHuman implements HumanVisual {
  readonly kind = 'procedural' as const;
  readonly root: THREE.Group;
  private pelvis: THREE.Group;
  private torso: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private head: THREE.Group;
  private phase = 0;
  private state: LocoState = 'idle';
  private speed = 0;
  private aiming = false;
  private poseBlend = 0;   // 0 standing, 1 crouched
  private fallT = 0;
  private held: THREE.Object3D | null = null;
  private meshes: THREE.Mesh[] = [];
  private static geos: { box?: THREE.BoxGeometry; sphere?: THREE.SphereGeometry } = {};

  constructor(colors: Partial<ProcColors> = {}) {
    const c: ProcColors = {
      shirt: colors.shirt ?? 0x3d4a5c, pants: colors.pants ?? 0x2b2f36, skin: colors.skin ?? 0xc69c7b,
      vest: colors.vest ?? 0x222222, hair: colors.hair ?? 0x2a1d14, helmet: colors.helmet ?? false, cap: colors.cap ?? false,
    };
    const g = ProceduralHuman.geos;
    g.box ??= new THREE.BoxGeometry(1, 1, 1);
    g.sphere ??= new THREE.SphereGeometry(0.5, 14, 10);
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
    const mShirt = mat(c.shirt), mPants = mat(c.pants), mSkin = mat(c.skin), mVest = mat(c.vest), mHair = mat(c.hair);
    const box = (m: THREE.Material, w: number, h: number, d: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(g.box!, m);
      mesh.scale.set(w, h, d);
      mesh.castShadow = true;
      this.meshes.push(mesh);
      return mesh;
    };

    this.root = new THREE.Group();
    this.pelvis = new THREE.Group(); this.pelvis.position.y = 0.92;
    const pelvisMesh = box(mPants, 0.36, 0.2, 0.24); pelvisMesh.position.y = 0;
    this.pelvis.add(pelvisMesh);

    this.torso = new THREE.Group(); this.torso.position.y = 0.12;
    const torsoMesh = box(mShirt, 0.44, 0.56, 0.26); torsoMesh.position.y = 0.28;
    this.torso.add(torsoMesh);
    const vestMesh = box(mVest, 0.46, 0.34, 0.28); vestMesh.position.y = 0.3; vestMesh.visible = c.vest !== 0x222222 || true;
    this.torso.add(vestMesh);
    this.pelvis.add(this.torso);

    this.head = new THREE.Group(); this.head.position.y = 0.66;
    const headMesh = new THREE.Mesh(g.sphere!, mSkin); headMesh.scale.set(0.2, 0.24, 0.21); headMesh.position.y = 0.1; headMesh.castShadow = true;
    this.meshes.push(headMesh);
    this.head.add(headMesh);
    const hairMesh = new THREE.Mesh(g.sphere!, mHair); hairMesh.scale.set(0.21, 0.13, 0.22); hairMesh.position.y = 0.2;
    this.head.add(hairMesh);
    if (c.helmet) {
      const hel = box(mat(0x1b2230), 0.26, 0.12, 0.26); hel.position.y = 0.23; this.head.add(hel);
    }
    if (c.cap) {
      const cap = box(mat(0x1f2a22), 0.24, 0.07, 0.24); cap.position.y = 0.22; this.head.add(cap);
    }
    this.torso.add(this.head);

    this.armL = new THREE.Group(); this.armL.position.set(-0.28, 0.55, 0);
    const armLm = box(mShirt, 0.12, 0.56, 0.12); armLm.position.y = -0.27; this.armL.add(armLm);
    this.torso.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.28, 0.55, 0);
    const armRm = box(mShirt, 0.12, 0.56, 0.12); armRm.position.y = -0.27; this.armR.add(armRm);
    this.torso.add(this.armR);

    this.legL = new THREE.Group(); this.legL.position.set(-0.1, 0, 0);
    const legLm = box(mPants, 0.15, 0.88, 0.16); legLm.position.y = -0.46; this.legL.add(legLm);
    this.pelvis.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.1, 0, 0);
    const legRm = box(mPants, 0.15, 0.88, 0.16); legRm.position.y = -0.46; this.legR.add(legRm);
    this.pelvis.add(this.legR);

    this.root.add(this.pelvis);
  }

  setState(state: LocoState, speed: number, aiming: boolean): void {
    this.state = state;
    this.speed = speed;
    this.aiming = aiming;
  }

  attachHeld(obj: THREE.Object3D): void {
    if (this.held) this.held.removeFromParent();
    this.held = obj;
    obj.position.set(0.02, -0.5, 0.2);
    this.armR.add(obj);
  }

  update(dt: number, _visible: boolean): void {
    const crouchTarget = this.state === 'crouch' ? 1 : 0;
    this.poseBlend += (crouchTarget - this.poseBlend) * Math.min(1, dt * 10);
    const moving = this.state === 'walk' || this.state === 'run';
    const rate = this.state === 'run' ? 10 : 6.5;
    if (moving) this.phase += dt * rate * Math.max(0.5, this.speed / 3.2);
    const swing = moving ? Math.sin(this.phase) * (this.state === 'run' ? 0.9 : 0.55) : 0;

    if (this.state === 'dead') {
      this.fallT = Math.min(1, this.fallT + dt * 2.2);
      this.root.rotation.x = -Math.PI / 2 * this.fallT;
      this.root.position.y = 0.02 * this.fallT;
      return;
    }
    if (this.fallT > 0) { this.fallT = 0; this.root.rotation.x = 0; this.root.position.y = 0; }

    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = this.aiming || this.held ? -1.2 : swing * 0.8 - 0.1;
    // Crouch: lower pelvis and bend knees
    this.pelvis.position.y = 0.92 - this.poseBlend * 0.42;
    this.legL.rotation.x += this.poseBlend * 0.9;
    this.legR.rotation.x += this.poseBlend * 0.9;
    this.torso.rotation.x = this.poseBlend * 0.25;
    if (this.state === 'talk') this.head.rotation.y = Math.sin(this.phase * 0.5) * 0.25;
    else this.head.rotation.y *= 0.9;
    // breathing bob
    this.torso.position.y = 0.12 + Math.sin(this.phase * 0.2 + performance.now() * 0.002) * 0.004;
  }

  dispose(): void {
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}

/** Factory: prefers Rocketbox when the avatar template is available; otherwise procedural. */
export async function createHuman(
  lib: CharacterLibrary,
  spec: AppearanceSpec,
  fallbackKeys: string[],
): Promise<HumanVisual> {
  const keys = [spec.modelKey, ...fallbackKeys].filter(Boolean) as string[];
  if (lib.ready) {
    const key = keys.find((k) => lib.hasAvatar(k));
    if (key) {
      try {
        const tpl = await lib.avatar(key);
        if (tpl) {
          const clone = SkeletonUtils.clone(tpl);
          const bones = new Set<string>();
          clone.traverse((o) => { if (o.name) bones.add(o.name); });
          const names = ['idle', 'look_around', 'walk', 'walk_female', 'run', 'run_female', 'crouch_idle', 'talk', 'walk_fast'];
          const clipMap = new Map<string, THREE.AnimationClip>();
          await Promise.all(names.map(async (n) => {
            const c = await lib.clip(n);
            if (c) clipMap.set(n, retargetClip(c, bones));
          }));
          return new RocketboxHuman(clone, clipMap);
        }
      } catch (err) {
        console.warn('[characters] Rocketbox build failed, using procedural:', err);
      }
    }
  }
  return new ProceduralHuman({
    shirt: spec.shirtColor, pants: spec.pantsColor, skin: spec.skinColor, vest: spec.vestColor,
    helmet: spec.helmet, cap: spec.cap,
  });
}
