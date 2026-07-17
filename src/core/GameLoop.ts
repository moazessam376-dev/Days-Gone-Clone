import { PHYSICS } from '../config';

export interface LoopCallbacks {
  /** Called at a fixed rate (PHYSICS.fixedDt). All gameplay + physics here. */
  fixedUpdate: (dt: number) => void;
  /**
   * Called once per animation frame after zero or more fixed updates.
   * `alpha` is the interpolation factor [0,1) between the previous and current
   * physics state; `dt` is the real frame delta in seconds.
   */
  render: (alpha: number, dt: number) => void;
}

/**
 * Fixed-timestep accumulator loop with render interpolation.
 * Physics/gameplay tick at exactly 60 Hz regardless of display refresh rate;
 * rendering interpolates between the last two physics states so motion stays
 * smooth on 120/144 Hz displays and never jitters on uneven frame times.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;
  private running = false;

  constructor(private callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (timeMs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    if (this.lastTime < 0) {
      this.lastTime = timeMs;
      return;
    }

    // Clamp so a backgrounded tab doesn't produce a huge catch-up burst.
    const frameDt = Math.min((timeMs - this.lastTime) / 1000, PHYSICS.maxFrameDelta);
    this.lastTime = timeMs;

    this.accumulator += frameDt;
    const fixedDt = PHYSICS.fixedDt;
    while (this.accumulator >= fixedDt) {
      this.callbacks.fixedUpdate(fixedDt);
      this.accumulator -= fixedDt;
    }

    this.callbacks.render(this.accumulator / fixedDt, frameDt);
  };
}
