/**
 * WebAudio engine. All V1 sounds are synthesized procedurally (no assets):
 * gunshots are layered noise-crack + sine sub-thump pre-rendered into
 * AudioBuffers per weapon; impacts are short filtered noise bursts. The
 * SoundBank API is sample-ready — recorded SFX can replace synth buffers
 * later without touching call sites.
 *
 * Everything routes through a compressor so stacked gunshots don't clip.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: DynamicsCompressorNode | null = null;
  private buffers = new Map<string, AudioBuffer>();

  /** Must be called from (or after) a user gesture; safe to call repeatedly. */
  ensureContext(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createDynamicsCompressor();
    this.master.threshold.value = -18;
    this.master.ratio.value = 8;
    this.master.connect(this.ctx.destination);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Pre-render a gunshot buffer: sub sine thump + noise body + high crack. */
  registerGunshot(key: string, opts: { sub: number; crack: number; body: number }): void {
    if (!this.ctx || this.buffers.has(key)) return;
    const sr = this.ctx.sampleRate;
    const dur = 0.45;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      // Sub thump: pitch-dropping sine, fast decay.
      const subFreq = opts.sub * (1 - t * 0.7);
      const sub = Math.sin(2 * Math.PI * subFreq * t) * Math.exp(-t * 18) * 0.9;
      // Body: noise through exponential decay (the "boom").
      const body = (Math.random() * 2 - 1) * Math.exp(-t * 22) * opts.body * 4;
      // Crack: very short bright noise transient.
      const crack = t < 0.012 ? (Math.random() * 2 - 1) * opts.crack : 0;
      data[i] = Math.tanh(sub + body + crack); // soft clip for punch
    }
    this.buffers.set(key, buf);
  }

  /** Short procedural impact: filtered noise tick (surface) or thud (flesh). */
  registerImpact(key: string, opts: { freq: number; dur: number; gain: number }): void {
    if (!this.ctx || this.buffers.has(key)) return;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * opts.dur), sr);
    const data = buf.getChannelData(0);
    let lp = 0;
    const alpha = Math.min(1, opts.freq / sr) * 6;
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      lp += alpha * ((Math.random() * 2 - 1) - lp);
      data[i] = lp * Math.exp(-t * (4 / opts.dur)) * opts.gain;
    }
    this.buffers.set(key, buf);
  }

  /**
   * Play a registered buffer. `pitchJitter` randomizes playbackRate ±fraction
   * (kills machine-gun sameness). Pass a position for 3D panning.
   */
  play(
    key: string,
    opts: { gain?: number; pitch?: number; pitchJitter?: number; at?: { x: number; y: number; z: number } } = {},
  ): void {
    if (!this.ctx || !this.master) return;
    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const jitter = opts.pitchJitter ?? 0.08;
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);

    const gain = this.ctx.createGain();
    gain.gain.value = opts.gain ?? 1;
    src.connect(gain);

    if (opts.at) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.maxDistance = 120;
      panner.positionX.value = opts.at.x;
      panner.positionY.value = opts.at.y;
      panner.positionZ.value = opts.at.z;
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    src.start();
  }

  /** Keep the listener glued to the camera. */
  updateListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    l.positionX.value = pos.x;
    l.positionY.value = pos.y;
    l.positionZ.value = pos.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }
}
