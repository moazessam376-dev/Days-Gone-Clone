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
  private scrollAccum = 0;
  private buttonsPressedThisFrame = new Set<number>();
  locked = false;
  /** Dev/test escape hatch (?mockinput): treat input as locked without real
   * pointer lock so automated tests can drive the game with synthetic events. */
  readonly mock = new URLSearchParams(location.search).has('mockinput');
  /** Dev mode (?dev=1): input counts as locked WITHOUT pointer lock, but the
   * real mouse belongs to the editor camera/gizmos — trusted mouse events are
   * ignored while keyboard stays live. The Pose Lab panel injects synthetic
   * mouse events for aim/fire (same mechanism as the test probes). */
  devUnlocked = false;

  constructor(private element: HTMLElement) {
    if (this.mock) this.locked = true;
    document.addEventListener('keydown', (e) => {
      // Tab must never move browser focus while playing.
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat || (this.mock && e.isTrusted)) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      if (this.mock && e.isTrusted) return;
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      if (this.mock) return;
      this.keys.clear();
      this.mouseButtons.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || ((this.mock || this.devUnlocked) && e.isTrusted)) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if ((this.mock || this.devUnlocked) && e.isTrusted) return;
      if (this.locked) {
        this.mouseButtons.add(e.button);
        this.buttonsPressedThisFrame.add(e.button);
      }
    });
    document.addEventListener('mouseup', (e) => {
      if ((this.mock || this.devUnlocked) && e.isTrusted) return;
      this.mouseButtons.delete(e.button);
    });

    document.addEventListener('wheel', (e) => {
      if (!this.locked || ((this.mock || this.devUnlocked) && e.isTrusted)) return;
      this.scrollAccum += Math.sign(e.deltaY);
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.mock || this.devUnlocked) return;
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.keys.clear();
        this.mouseButtons.clear();
      }
    });
  }

  requestLock(): void {
    if (this.devUnlocked) return;
    this.element.requestPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the first frame the key went down. Cleared in endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /**
   * Like wasPressed but consumes the press so only one caller (and one fixed
   * tick, even when several run in a single render frame) acts on it.
   */
  consumePressed(code: string): boolean {
    const had = this.pressedThisFrame.has(code);
    if (had) this.pressedThisFrame.delete(code);
    return had;
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  /** One-shot mouse press (consumed), for semi-auto triggers. */
  consumePressedButton(button: number): boolean {
    const had = this.buttonsPressedThisFrame.has(button);
    if (had) this.buttonsPressedThisFrame.delete(button);
    return had;
  }

  /** Net scroll steps since last consumed (+down / -up), then cleared. */
  consumeScroll(): number {
    const s = this.scrollAccum;
    this.scrollAccum = 0;
    return s;
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
    this.buttonsPressedThisFrame.clear();
  }
}
