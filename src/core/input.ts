/**
 * Input manager: keyboard state, mouse buttons, pointer-lock mouse deltas.
 * Gameplay code polls `isDown`/`wasPressed` once per frame; UI listens via events.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();   // edge-triggered this frame
  private mouseDown = new Set<number>();
  private mousePressed = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Set when the user presses keys while the game expects them (for focus handling). */
  onEscape?: () => void;
  onAnyKey?: (code: string) => void;
  private listeners: Array<() => void> = [];
  private target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    const kd = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.onAnyKey?.(e.code);
      if (e.code === 'Escape') this.onEscape?.();
    };
    const ku = (e: KeyboardEvent): void => { this.down.delete(e.code); };
    const md = (e: MouseEvent): void => {
      this.mouseDown.add(e.button);
      this.mousePressed.add(e.button);
    };
    const mu = (e: MouseEvent): void => { this.mouseDown.delete(e.button); };
    const mm = (e: MouseEvent): void => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    };
    const wh = (e: WheelEvent): void => { this.wheel += Math.sign(e.deltaY); };
    const blur = (): void => { this.down.clear(); this.mouseDown.clear(); };
    const pl = (): void => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) { this.down.clear(); this.mouseDown.clear(); }
      this.listeners.forEach((fn) => fn());
    };
    const ctx = (e: Event): void => e.preventDefault();

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('mousemove', mm);
    window.addEventListener('wheel', wh, { passive: true });
    window.addEventListener('blur', blur);
    document.addEventListener('pointerlockchange', pl);
    document.addEventListener('contextmenu', ctx);
    this.dispose = () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('wheel', wh);
      window.removeEventListener('blur', blur);
      document.removeEventListener('pointerlockchange', pl);
      document.removeEventListener('contextmenu', ctx);
    };
  }

  dispose: () => void;

  isDown(code: string): boolean { return this.down.has(code); }
  wasPressed(code: string): boolean { return this.pressed.has(code); }
  mouseHeld(button: number): boolean { return this.mouseDown.has(button); }
  mouseClicked(button: number): boolean { return this.mousePressed.has(button); }

  onPointerLockChange(fn: () => void): void { this.listeners.push(fn); }

  requestLock(): void {
    if (document.pointerLockElement !== this.target) {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture / browser refusal: UI shows fallback */ });
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Call at end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Clear everything (state transitions). */
  reset(): void {
    this.down.clear();
    this.pressed.clear();
    this.mouseDown.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
