/**
 * Keyboard + pointer-lock mouse input.
 *
 * Mouse deltas accumulate between frames and are consumed once per render
 * frame via `consumeMouseDelta`. Key state is queried by `KeyboardEvent.code`
 * (physical key, layout-independent).
 */
export class Input {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseButtons = new Set<number>();
  locked = false;

  constructor(private element: HTMLElement) {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.locked) this.mouseButtons.add(e.button);
    });
    document.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.keys.clear();
        this.mouseButtons.clear();
      }
    });
  }

  requestLock(): void {
    this.element.requestPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the first frame the key went down. Cleared in endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Call once at the end of each render frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
