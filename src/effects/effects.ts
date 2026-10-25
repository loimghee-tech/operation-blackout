/**
 * Pooled visual effects: tracers, muzzle flash, impact dust, bullet decals,
 * loot sparkle and mission flashes. Everything is pre-allocated to avoid
 * per-shot allocations and disposed when the level changes.
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';

interface Timed { obj: THREE.Object3D; life: number; max: number; vel?: THREE.Vector3; fade?: THREE.Material[] }

export class EffectsPool {
  private scene: THREE.Scene;
  private timed: Timed[] = [];
  private tracers: THREE.Line[] = [];
  private tracerIdx = 0;
  private dust: THREE.Mesh[] = [];
  private dustIdx = 0;
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private flash: THREE.PointLight;
  private flashSprite: THREE.Mesh;
  private flashLife = 0;
  private quality: 'low' | 'high' = 'high';
  private tracerMat: THREE.LineBasicMaterial;
  private dustGeo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
  private dustMat: THREE.MeshBasicMaterial[] = [];
  private decalGeo = new THREE.CircleGeometry(0.035, 8);
  private decalMat = new THREE.MeshBasicMaterial({ color: 0x18140f, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private flashMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, quality: 'low' | 'high' = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 24; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      const l = new THREE.Line(g, this.tracerMat.clone());
      l.visible = false;
      l.frustumCulled = false;
      scene.add(l);
      this.tracers.push(l);
    }
    for (let i = 0; i < 40; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xb8a88a, transparent: true, opacity: 0.9 });
      this.dustMat.push(m);
      const mesh = new THREE.Mesh(this.dustGeo, m);
      mesh.visible = false;
      scene.add(mesh);
      this.dust.push(mesh);
    }
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(this.decalGeo, this.decalMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.decals.push(mesh);
    }
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flashSprite = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), this.flashMat);
    this.flashSprite.visible = false;
    scene.add(this.flashSprite);
    this.flash = new THREE.PointLight(0xffb660, 0, 6, 2);
    scene.add(this.flash);
  }

  /** Muzzle position is in world space; the flash sprite follows the camera-held muzzle. */
  muzzleFlash(pos: Vec3, dir: Vec3, _silent: boolean): void {
    if (this.quality === 'low') return;
    this.flashLife = 0.06;
    this.flash.position.set(pos.x, pos.y, pos.z);
    this.flash.intensity = 3.5;
    this.flashSprite.position.set(pos.x + dir.x * 0.1, pos.y + dir.y * 0.1, pos.z + dir.z * 0.1);
    this.flashSprite.lookAt(pos.x + dir.x * 4, pos.y + dir.y * 4, pos.z + dir.z * 4);
    this.flashSprite.visible = true;
    this.flashMat.opacity = 0.95;
    this.flashSprite.rotation.z = Math.random() * Math.PI;
  }

  tracer(from: Vec3, to: Vec3): void {
    const l = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    (l.material as THREE.LineBasicMaterial).opacity = 0.75;
    l.visible = true;
    this.timed.push({ obj: l, life: 0.08, max: 0.08, fade: [l.material as THREE.Material] });
  }

  impact(pos: Vec3, normal: Vec3, surface: string): void {
    if (this.quality === 'low') return;
    const n = surface === 'glass' ? 6 : surface === 'metal' ? 5 : 4;
    const tint = surface === 'metal' ? 0xd8d8e0 : surface === 'marble' ? 0xe6e2d8 : surface === 'wood' ? 0x9a7048 : 0xb8a88a;
    for (let i = 0; i < n; i++) {
      const mesh = this.dust[this.dustIdx];
      this.dustIdx = (this.dustIdx + 1) % this.dust.length;
      mesh.visible = true;
      mesh.position.set(pos.x + normal.x * 0.05, pos.y + normal.y * 0.05, pos.z + normal.z * 0.05);
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.color.setHex(tint);
      m.opacity = 0.9;
      const vel = new THREE.Vector3(normal.x + (Math.random() - 0.5), normal.y + Math.random() * 0.8, normal.z + (Math.random() - 0.5)).multiplyScalar(1.6 + Math.random() * 1.4);
      this.timed.push({ obj: mesh, life: 0.45 + Math.random() * 0.2, max: 0.6, vel, fade: [m] });
    }
    // decal
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.visible = true;
    d.position.set(pos.x + normal.x * 0.012, pos.y + normal.y * 0.012, pos.z + normal.z * 0.012);
    d.lookAt(d.position.x + normal.x, d.position.y + normal.y, d.position.z + normal.z);
    (d.material as THREE.MeshBasicMaterial).opacity = 0.85;
    this.timed.push({ obj: d, life: 25, max: 25, fade: [d.material as THREE.Material] });
  }

  /** Short-lived burst of sparks/dust for flashbangs, drills, breaches. */
  burst(pos: Vec3, color: number, count: number, speed: number, life = 0.6): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.dust[this.dustIdx];
      this.dustIdx = (this.dustIdx + 1) % this.dust.length;
      mesh.visible = true;
      mesh.position.set(pos.x, pos.y, pos.z);
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.color.setHex(color);
      m.opacity = 1;
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.timed.push({ obj: mesh, life, max: life, vel, fade: [m] });
    }
  }

  /** Temporary full-scene light pulse at a position (flashbang, alarm strobe). */
  pulse(pos: Vec3, color: number, intensity: number, seconds: number): void {
    const l = new THREE.PointLight(color, intensity, 12, 2);
    l.position.set(pos.x, pos.y, pos.z);
    this.scene.add(l);
    this.timed.push({ obj: l, life: seconds, max: seconds });
  }

  update(dt: number): void {
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) { this.flash.intensity = 0; this.flashSprite.visible = false; }
      else this.flashMat.opacity = Math.max(0, this.flashLife / 0.06);
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.life -= dt;
      if (t.vel) {
        t.obj.position.addScaledVector(t.vel, dt);
        t.vel.y -= 6 * dt;
        if (t.obj.position.y < 0.02) { t.vel.set(0, 0, 0); t.obj.position.y = 0.02; }
      }
      if (t.fade) {
        const k = Math.max(0, t.life / t.max);
        for (const m of t.fade) (m as THREE.Material & { opacity: number }).opacity = Math.min((m as THREE.Material & { opacity: number }).opacity, k * 0.95);
      }
      if (t.life <= 0) {
        if (t.obj instanceof THREE.PointLight) { this.scene.remove(t.obj); t.obj.dispose(); }
        else t.obj.visible = false;
        this.timed.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.flash);
    this.scene.remove(this.flashSprite);
    this.flashSprite.geometry.dispose();
    this.flashMat.dispose();
    for (const t of this.tracers) { this.scene.remove(t); t.geometry.dispose(); (t.material as THREE.Material).dispose(); }
    for (const d of this.dust) { this.scene.remove(d); }
    for (const d of this.decals) { this.scene.remove(d); (d.material as THREE.Material).dispose(); }
    for (const m of this.dustMat) m.dispose();
    this.dustGeo.dispose();
    this.decalGeo.dispose();
    this.decalMat.dispose();
    this.tracerMat.dispose();
    this.timed = [];
  }
}
