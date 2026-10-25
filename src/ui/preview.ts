/**
 * Class-selection preview: a rotating character with the class's primary weapon.
 * One WebGL renderer is reused for the whole session (avoids leaking contexts).
 */
import * as THREE from 'three';
import { ProceduralHuman } from '../characters/human';
import { buildViewmodel } from '../weapons/weaponSystem';
import { WEAPONS } from '../config/weapons';
import type { ClassDef } from '../config/classes';

export class ClassPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private holder = new THREE.Group();
  private human: ProceduralHuman | null = null;
  private weapon: THREE.Group | null = null;
  private raf = 0;
  private t = 0;
  private container: HTMLElement | null = null;
  private classDef: ClassDef | null = null;

  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch (err) {
      console.warn('[preview] WebGL unavailable for class preview', err);
      this.renderer = null;
    }
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 3);
    const fill = new THREE.HemisphereLight(0x8fb4ff, 0x202430, 1.2);
    this.scene.add(key, fill, this.holder);
    this.camera.position.set(0, 1.25, 3.6);
    this.camera.lookAt(0, 1.0, 0);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
  }

  get available(): boolean { return this.renderer !== null; }

  mount(container: HTMLElement, def: ClassDef): void {
    this.classDef = def;
    if (!this.renderer) {
      container.innerHTML = '<div class="preview-fallback">3D preview unavailable (WebGL is disabled).</div>';
      return;
    }
    this.container = container;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('preview-canvas');
    this.setClass(def);
    this.resize();
    this.loop();
  }

  setClass(def: ClassDef): void {
    this.classDef = def;
    this.holder.clear();
    const colors: Record<string, { shirt: number; pants: number; vest: number; helmet: boolean }> = {
      loud: { shirt: 0x3a2a2a, pants: 0x242424, vest: 0x2a2f2a, helmet: true },
      ghost: { shirt: 0x202a36, pants: 0x14181e, vest: 0x1a1d22, helmet: false },
      hacker: { shirt: 0x1d3a2e, pants: 0x1a2220, vest: 0x1a2a24, helmet: false },
      mastermind: { shirt: 0x3a3320, pants: 0x2a2620, vest: 0x2a261a, helmet: false },
      conartist: { shirt: 0x4a2b3e, pants: 0x2b2330, vest: 0x2b2030, helmet: false },
      engineer: { shirt: 0x3a3a2e, pants: 0x2c2c26, vest: 0x25281f, helmet: true },
    };
    const c = colors[def.id] ?? colors.loud;
    this.human = new ProceduralHuman({ shirt: c.shirt, pants: c.pants, vest: c.vest, skin: 0xc69c7b, hair: 0x2a1d14, helmet: c.helmet, cap: false });
    this.holder.add(this.human.root);
    this.human.setState('idle', 0, false);
    const w = WEAPONS[def.loadout.primary];
    this.weapon = buildViewmodel(w ?? null);
    this.weapon.scale.setScalar(1.8);
    this.weapon.rotation.set(0, -Math.PI / 2, 0);
    this.weapon.position.set(0.02, 0.1, 0.2);
    this.human.attachHeld(this.weapon);
    this.holder.position.y = 0;
  }

  private resize(): void {
    if (!this.renderer || !this.container) return;
    const w = Math.max(100, this.container.clientWidth);
    const h = Math.max(100, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (!this.renderer || !this.container || !this.container.isConnected) { this.raf = 0; return; }
    this.t += 1 / 60;
    this.holder.rotation.y = Math.sin(this.t * 0.4) * 0.6;
    this.human?.update(1 / 60, true);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  unmount(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.container = null;
  }

  dispose(): void {
    this.unmount();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
