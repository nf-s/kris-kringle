/** Synthesised sound effects. Nothing plays until `unlock` runs inside a user gesture. */
export interface Sfx {
  unlock(): void;
  setMuted(muted: boolean): void;
  /** Light knock. `pitch` is a multiplier around 1. */
  tap(pitch?: number): void;
  /** Brittle crack. `intensity` is 0 to 1. */
  crack(intensity?: number): void;
  pop(): void;
  /** Sharp bang, like a cracker going off. */
  snap(): void;
  whoosh(): void;
  /** Bell note on a pentatonic scale. Higher steps are higher notes. */
  chime(step?: number): void;
  /** Soft friction noise for rubbing or dragging. Safe to call every frame. `intensity` 0 to 1. */
  rub(intensity?: number): void;
  /** Rising creak for something under tension. `tension` is 0 to 1. Safe to call every frame. */
  stretch(tension: number): void;
  fanfare(): void;
}

interface AudioGraph {
  context: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

const PENTATONIC = [0, 2, 4, 7, 9];

export function createSfx(): Sfx {
  let graph: AudioGraph | null = null;
  let muted = false;
  let lastRub = 0;
  let lastStretch = 0;

  function ensure(): AudioGraph | null {
    if (graph) return graph;
    if (typeof AudioContext === 'undefined') return null;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(context.destination);
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const channel = noise.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
    graph = { context, master, noise };
    return graph;
  }

  function tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    slideTo?: number,
  ): void {
    const g = graph;
    if (!g || muted) return;
    const start = g.context.currentTime + delay;
    const oscillator = g.context.createOscillator();
    const envelope = g.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(g.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function noiseBurst(
    duration: number,
    gain: number,
    filterType: BiquadFilterType,
    frequency: number,
    q = 1,
    delay = 0,
    sweepTo?: number,
  ): void {
    const g = graph;
    if (!g || muted) return;
    const start = g.context.currentTime + delay;
    const source = g.context.createBufferSource();
    source.buffer = g.noise;
    source.loop = true;
    const filter = g.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    if (sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), start + duration);
    }
    filter.Q.value = q;
    const envelope = g.context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(g.master);
    source.start(start, Math.random() * 0.5);
    source.stop(start + duration + 0.05);
  }

  function chimeAt(step: number, delay: number, gain: number): void {
    const octave = Math.floor(step / PENTATONIC.length);
    const semitone = PENTATONIC[((step % PENTATONIC.length) + PENTATONIC.length) % 5];
    const frequency = 659.25 * Math.pow(2, octave + semitone / 12);
    tone(frequency, 0.9, 'sine', gain, delay);
    tone(frequency * 2.01, 0.5, 'sine', gain * 0.35, delay);
    tone(frequency * 3.02, 0.25, 'sine', gain * 0.15, delay);
  }

  return {
    unlock() {
      const g = ensure();
      if (g && g.context.state === 'suspended') void g.context.resume();
    },
    setMuted(next) {
      muted = next;
      if (graph) graph.master.gain.value = muted ? 0 : 0.8;
    },
    tap(pitch = 1) {
      tone(520 * pitch, 0.09, 'triangle', 0.3);
      noiseBurst(0.03, 0.18, 'highpass', 2200);
    },
    crack(intensity = 0.5) {
      noiseBurst(0.09 + 0.08 * intensity, 0.55, 'bandpass', 2400 - 900 * intensity, 1.4);
      noiseBurst(0.04, 0.35, 'highpass', 5000, 1, 0.02);
      tone(190 - 60 * intensity, 0.07, 'square', 0.14);
    },
    pop() {
      tone(420, 0.22, 'sine', 0.6, 0, 70);
      noiseBurst(0.12, 0.4, 'lowpass', 1800, 0.7);
    },
    snap() {
      noiseBurst(0.16, 0.9, 'highpass', 900, 0.6);
      noiseBurst(0.35, 0.35, 'lowpass', 500, 0.7);
      tone(110, 0.25, 'sine', 0.6, 0, 40);
    },
    whoosh() {
      noiseBurst(0.45, 0.3, 'bandpass', 350, 1.2, 0, 2800);
    },
    chime(step = 0) {
      chimeAt(step, 0, 0.22);
    },
    rub(intensity = 0.5) {
      const now = performance.now();
      if (now - lastRub < 55) return;
      lastRub = now;
      noiseBurst(0.09, 0.04 + 0.1 * intensity, 'bandpass', 2600 + 1800 * intensity, 0.9);
    },
    stretch(tension) {
      const now = performance.now();
      if (now - lastStretch < 90) return;
      lastStretch = now;
      tone(140 + 420 * tension, 0.1, 'sawtooth', 0.03 + 0.05 * tension);
    },
    fanfare() {
      [0, 2, 4, 5, 7, 9, 10].forEach((step, index) => chimeAt(step, index * 0.085, 0.2));
      chimeAt(12, 0.7, 0.24);
      noiseBurst(1.4, 0.07, 'highpass', 6000, 0.5, 0.05);
    },
  };
}
