/**
 * Procedural skate SFX synthesized with Web Audio — no audio assets to ship or license.
 * The AudioContext is only created on the first user gesture (browser autoplay policy), so
 * anything triggered before that (e.g. AI mode with no input yet) is silently skipped.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private grind: { src: AudioBufferSourceNode; lfo: OscillatorNode; gain: GainNode; band: BiquadFilterNode } | null = null;
  private lastImpact = -Infinity;
  private paused = false;

  constructor(private volume = 0.7) {
    for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, this.unlock, { passive: true });
    // The setup flow's clicks already count as activation — start right away when we can.
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) this.unlock();
  }

  private unlock = () => {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      // Bus compressor so stacked hits (bail + impact + grind) don't clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.ctx = ctx;
    }
    if (this.ctx.state === "suspended" && !this.paused) void this.ctx.resume();
  };

  /** Context only while audible — no point scheduling voices into a suspended graph. */
  private live(): AudioContext | null {
    return this.ctx && this.ctx.state === "running" && !this.paused ? this.ctx : null;
  }

  /** Ollie pop: tail snap + low body thump + a woody tick. */
  jump() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseSrc(ctx, t, 0.08).connect(this.filter(ctx, "bandpass", 2200, 1.2)).connect(this.env(ctx, t, 0.9, 0.002, 0.05));
    this.osc(ctx, "sine", 180, 55, t, 0.1).connect(this.env(ctx, t, 0.8, 0.003, 0.12));
    this.osc(ctx, "triangle", 820, 760, t, 0.05).connect(this.env(ctx, t, 0.22, 0.001, 0.04));
  }

  /**
   * Hit against the world. `strength` 0..1 scales loudness + brightness; `metal` adds a
   * ringing partial stack for rail side-hits. Rate-limited so contact jitter doesn't machine-gun.
   */
  impact(strength: number, metal = false) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastImpact < 0.12) return;
    this.lastImpact = t;
    const s = Math.min(1, Math.max(0.15, strength));
    this.osc(ctx, "sine", 110, 40, t, 0.2).connect(this.env(ctx, t, 0.9 * s, 0.004, 0.18));
    this.noiseSrc(ctx, t, 0.15).connect(this.filter(ctx, "lowpass", 500 + 900 * s)).connect(this.env(ctx, t, 0.6 * s, 0.003, 0.12));
    if (metal) this.ring(ctx, t, [520, 1230, 2110], 0.3 * s, 0.35);
  }

  /** Grind entry clank + start the looping scrape. Loudness/pitch follow `setGrindSpeed`. */
  grindStart() {
    const ctx = this.live();
    if (!ctx || this.grind) return;
    const t = ctx.currentTime;
    this.ring(ctx, t, [1450, 2380, 3960], 0.3, 0.3);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = this.filter(ctx, "bandpass", 2600, 2.5);
    // Narrow resonant bump = the "singing" metal of the rail.
    const sing = this.filter(ctx, "peaking", 4300, 8);
    sing.gain.value = 9;
    // Fast square tremolo gives the gritty, stuttering scrape texture. It sits before the level
    // gain so fading the level to 0 fully silences the loop.
    const trem = ctx.createGain();
    trem.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 17;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.25;
    lfo.connect(lfoDepth).connect(trem.gain);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(0.4, t, 0.03);
    src.connect(this.filter(ctx, "highpass", 700)).connect(band).connect(sing).connect(trem).connect(gain).connect(this.master!);
    src.start(t, Math.random() * 0.9);
    lfo.start(t);
    this.grind = { src, lfo, gain, band };
  }

  setGrindSpeed(speed: number) {
    const g = this.grind;
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(speed, 6);
    g.gain.gain.setTargetAtTime(0.2 + 0.06 * v, t, 0.05);
    g.band.frequency.setTargetAtTime(1800 + 250 * v, t, 0.05);
  }

  grindStop() {
    const g = this.grind;
    if (!g || !this.ctx) return;
    this.grind = null;
    const t = this.ctx.currentTime;
    g.gain.gain.cancelScheduledValues(t);
    g.gain.gain.setTargetAtTime(0, t, 0.04);
    g.src.stop(t + 0.3);
    g.lfo.stop(t + 0.3);
  }

  /** Bail: body slam, scuff across the ground, then the board clattering away. */
  bail() {
    this.grindStop();
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.lastImpact = t;
    this.osc(ctx, "sine", 90, 35, t, 0.3).connect(this.env(ctx, t, 1, 0.005, 0.28));
    this.noiseSrc(ctx, t, 0.2).connect(this.filter(ctx, "lowpass", 900)).connect(this.env(ctx, t, 0.7, 0.003, 0.15));

    const scuff = this.filter(ctx, "bandpass", 1200, 0.8);
    scuff.frequency.setValueAtTime(1200, t + 0.03);
    scuff.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    this.noiseSrc(ctx, t + 0.03, 0.45).connect(scuff).connect(this.env(ctx, t + 0.03, 0.45, 0.02, 0.38));

    [0.08, 0.19, 0.28, 0.34].forEach((dt, i) => {
      const at = t + dt + Math.random() * 0.03;
      const peak = 0.6 * (1 - i * 0.2);
      this.noiseSrc(ctx, at, 0.06).connect(this.filter(ctx, "bandpass", 1300 + Math.random() * 800, 4)).connect(this.env(ctx, at, peak, 0.001, 0.05));
      const f = 600 + Math.random() * 300;
      this.osc(ctx, "triangle", f, f * 0.9, at, 0.05).connect(this.env(ctx, at, peak * 0.4, 0.001, 0.04));
    });
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  dispose() {
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, this.unlock);
    this.grind = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  private ring(ctx: AudioContext, t: number, partials: number[], peak: number, decay: number) {
    partials.forEach((f, i) => {
      this.osc(ctx, "sine", f, f, t, decay + 0.05).connect(this.env(ctx, t, peak / (i + 1), 0.001, decay / (1 + i * 0.4)));
    });
  }

  /** Gain envelope wired to the master bus: exp attack to `peak`, exp decay to silence. */
  private env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private noiseSrc(ctx: AudioContext, t: number, dur: number): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random() * 0.9);
    s.stop(t + dur);
    return s;
  }

  /** Oscillator gliding exponentially from `f0` to `f1` over `dur`. */
  private osc(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, t: number, dur: number): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.start(t);
    o.stop(t + dur);
    return o;
  }
}

const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;
