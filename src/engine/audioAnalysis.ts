export type AudioBandId = 'bass' | 'mid' | 'treble';

export interface AudioBands {
  bass: number;
  mid: number;
  treble: number;
}

/** Normalized 0–1 FFT magnitudes, so a shaped band can be measured per node. */
export interface AudioSpectrum {
  magnitudes: ArrayLike<number>;
  sampleRate: number;
}

export interface AudioAnalysisFrame extends AudioBands {
  level: number;
  spectrum?: AudioSpectrum | null;
}

export interface AudioBandShape {
  frequency: number;
  q: number;
}

export type AudioBandShapes = Readonly<Record<AudioBandId, AudioBandShape>>;

export const AUDIO_BAND_IDS: readonly AudioBandId[] = Object.freeze([
  'bass',
  'mid',
  'treble',
]);

export const AUDIO_BAND_RANGES: Readonly<
  Record<AudioBandId, readonly [number, number]>
> = {
  bass: [20, 160],
  mid: [160, 2_000],
  treble: [2_000, 12_000],
};

export const DEFAULT_AUDIO_BAND_SHAPES: AudioBandShapes = Object.freeze({
  bass: Object.freeze({ frequency: 70, q: 0.7 }),
  mid: Object.freeze({ frequency: 900, q: 0.7 }),
  treble: Object.freeze({ frequency: 5_000, q: 0.7 }),
});

export const MIN_BAND_FREQUENCY = 20;
export const MAX_BAND_FREQUENCY = 18_000;
export const MIN_BAND_Q = 0.2;
export const MAX_BAND_Q = 12;

export const SILENT_AUDIO_FRAME: AudioAnalysisFrame = Object.freeze({
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
});

/**
 * Analysis for the session default source plus every patchable audio source
 * node, keyed by node id, so an analyzer can read the block wired into it.
 */
export interface AudioAnalysisSnapshot {
  frame: AudioAnalysisFrame;
  sources: Readonly<Record<string, AudioAnalysisFrame>>;
}

export const EMPTY_AUDIO_SOURCES: Readonly<
  Record<string, AudioAnalysisFrame>
> = Object.freeze({});

export interface AnalyserBuffers {
  samples: Float32Array<ArrayBuffer>;
  spectrum: Float32Array<ArrayBuffer>;
  magnitudes: Float32Array<ArrayBuffer>;
}

const DEFAULT_SAMPLE_RATE = 48_000;
const RMS_BOOST = 4.5;

const BASELINE_SECONDS = 0.45;
const CONFIDENCE_SECONDS = 6;
const MIN_DECAY_SECONDS = 0.001;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(finiteOr(value, 0), 0, 1);
}

function bandForFrequency(frequency: number): AudioBandId | null {
  for (const band of ['bass', 'mid', 'treble'] as const) {
    const [low, high] = AUDIO_BAND_RANGES[band];
    if (frequency >= low && frequency < high) {
      return band;
    }
  }
  return null;
}

/** Averages normalized FFT magnitudes into fixed bass, mid, and treble ranges. */
export function analyzeSpectrumBands(
  decibels: ArrayLike<number>,
  sampleRate: number,
  minDecibels = -100,
  maxDecibels = -30,
): AudioBands {
  const binCount = decibels.length;
  const span = finiteOr(maxDecibels, -30) - finiteOr(minDecibels, -100);
  const nyquist = finiteOr(sampleRate, 0) / 2;
  if (binCount === 0 || span <= 0 || nyquist <= 0) {
    return { bass: 0, mid: 0, treble: 0 };
  }

  const binWidth = nyquist / binCount;
  const sums: AudioBands = { bass: 0, mid: 0, treble: 0 };
  const counts: AudioBands = { bass: 0, mid: 0, treble: 0 };
  for (let index = 0; index < binCount; index += 1) {
    const band = bandForFrequency((index + 0.5) * binWidth);
    if (!band) {
      continue;
    }
    const decibel = finiteOr(decibels[index] ?? minDecibels, minDecibels);
    sums[band] += clamp01((decibel - minDecibels) / span);
    counts[band] += 1;
  }

  return {
    bass: counts.bass === 0 ? 0 : sums.bass / counts.bass,
    mid: counts.mid === 0 ? 0 : sums.mid / counts.mid,
    treble: counts.treble === 0 ? 0 : sums.treble / counts.treble,
  };
}

export function createAnalyserBuffers(analyser: AnalyserNode): AnalyserBuffers {
  return {
    samples: new Float32Array(analyser.fftSize),
    spectrum: new Float32Array(analyser.frequencyBinCount),
    magnitudes: new Float32Array(analyser.frequencyBinCount),
  };
}

/**
 * Resonant bandpass magnitude, so Frequency reads as the listening center and
 * Q reads as how tightly the band rejects everything either side of it.
 */
export function bandResponse(
  frequency: number,
  center: number,
  q: number,
): number {
  const target = finiteOr(frequency, 0);
  const middle = clamp(
    finiteOr(center, MIN_BAND_FREQUENCY),
    MIN_BAND_FREQUENCY,
    MAX_BAND_FREQUENCY,
  );
  const quality = clamp(finiteOr(q, 1), MIN_BAND_Q, MAX_BAND_Q);
  if (target <= 0) {
    return 0;
  }
  const detune = target / middle - middle / target;
  return 1 / Math.sqrt(1 + quality * quality * detune * detune);
}

/** Weights every bin by its band response, so each band tracks its own shape. */
export function analyzeShapedBands(
  spectrum: AudioSpectrum,
  shapes: AudioBandShapes = DEFAULT_AUDIO_BAND_SHAPES,
): AudioBands {
  const binCount = spectrum.magnitudes.length;
  const nyquist = finiteOr(spectrum.sampleRate, 0) / 2;
  if (binCount === 0 || nyquist <= 0) {
    return { bass: 0, mid: 0, treble: 0 };
  }

  const binWidth = nyquist / binCount;
  const sums: AudioBands = { bass: 0, mid: 0, treble: 0 };
  const weights: AudioBands = { bass: 0, mid: 0, treble: 0 };
  for (let index = 0; index < binCount; index += 1) {
    const frequency = (index + 0.5) * binWidth;
    const magnitude = clamp01(spectrum.magnitudes[index] ?? 0);
    for (const band of AUDIO_BAND_IDS) {
      const shape = shapes[band];
      const weight = bandResponse(frequency, shape.frequency, shape.q);
      sums[band] += magnitude * weight;
      weights[band] += weight;
    }
  }

  return {
    bass: weights.bass === 0 ? 0 : clamp01(sums.bass / weights.bass),
    mid: weights.mid === 0 ? 0 : clamp01(sums.mid / weights.mid),
    treble: weights.treble === 0 ? 0 : clamp01(sums.treble / weights.treble),
  };
}

/** Reads one unsmoothed level-and-band frame from any Web Audio analyser. */
export function analyzeAnalyser(
  analyser: AnalyserNode,
  buffers: AnalyserBuffers,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): AudioAnalysisFrame {
  let level = 0;
  if (typeof analyser.getFloatTimeDomainData === 'function') {
    analyser.getFloatTimeDomainData(buffers.samples);
    let energy = 0;
    for (const sample of buffers.samples) {
      energy += sample * sample;
    }
    level = clamp01(Math.sqrt(energy / buffers.samples.length) * RMS_BOOST);
  }
  if (typeof analyser.getFloatFrequencyData !== 'function') {
    return { level, bass: 0, mid: 0, treble: 0, spectrum: null };
  }
  analyser.getFloatFrequencyData(buffers.spectrum);
  const rate = finiteOr(sampleRate, DEFAULT_SAMPLE_RATE);
  const minDecibels = finiteOr(analyser.minDecibels, -100);
  const span = finiteOr(analyser.maxDecibels, -30) - minDecibels;
  for (let index = 0; index < buffers.magnitudes.length; index += 1) {
    const decibel = finiteOr(buffers.spectrum[index] ?? minDecibels, minDecibels);
    buffers.magnitudes[index] = span <= 0 ? 0 : clamp01((decibel - minDecibels) / span);
  }
  const spectrum: AudioSpectrum = {
    magnitudes: buffers.magnitudes,
    sampleRate: rate,
  };
  return { level, ...analyzeShapedBands(spectrum), spectrum };
}

export interface AudioOnsetState {
  time: number;
  baseline: number;
  envelope: number;
  holdUntil: number;
}

export interface AudioOnsetOptions {
  value: number;
  time: number;
  threshold: number;
  sensitivity: number;
  hold: number;
  decay: number;
}

export interface AudioOnsetResult {
  state: AudioOnsetState;
  onset: boolean;
  trigger: number;
  envelope: number;
}

export function createAudioOnsetState(): AudioOnsetState {
  return { time: 0, baseline: 0, envelope: 0, holdUntil: 0 };
}

/**
 * Fires when a band rises above its own recent average, so a quiet source stays
 * responsive without re-tuning the threshold.
 */
export function evaluateAudioOnset(
  state: AudioOnsetState,
  options: AudioOnsetOptions,
): AudioOnsetResult {
  const time = finiteOr(options.time, 0);
  const value = clamp01(options.value);
  const threshold = clamp01(options.threshold);
  const sensitivity = clamp(finiteOr(options.sensitivity, 1), 0, 4);
  const hold = clamp(finiteOr(options.hold, 0.12), 0.01, 2);
  const decay = Math.max(
    MIN_DECAY_SECONDS,
    clamp(finiteOr(options.decay, 0.25), 0, 4),
  );

  if (time < state.time) {
    const reset: AudioOnsetState = {
      time,
      baseline: value,
      envelope: 0,
      holdUntil: 0,
    };
    return { state: reset, onset: false, trigger: 0, envelope: 0 };
  }

  const elapsed = time - state.time;
  const gate = threshold + state.baseline * sensitivity;
  const onset = value > gate && time >= state.holdUntil;
  const baseline =
    state.baseline +
    (value - state.baseline) * (1 - Math.exp(-elapsed / BASELINE_SECONDS));
  const decayed = state.envelope * Math.exp(-elapsed / decay);
  const envelope = onset ? 1 : clamp01(decayed);
  const holdUntil = onset ? time + hold : state.holdUntil;

  return {
    state: { time, baseline: clamp01(baseline), envelope, holdUntil },
    onset,
    trigger: time < holdUntil ? 1 : 0,
    envelope,
  };
}

export interface AudioBeatState {
  time: number;
  interval: number;
  anchor: number;
  lastOnset: number | null;
  lastTrigger: number;
  confidence: number;
}

export interface AudioBeatOptions {
  trigger: number;
  time: number;
  restingBpm: number;
  minBpm: number;
  maxBpm: number;
  beatsPerBar: number;
  pulseWidth: number;
  lock: number;
}

export interface AudioBeatResult {
  state: AudioBeatState;
  bpm: number;
  phase: number;
  beat: number;
  bar: number;
  confidence: number;
}

export const MIN_TRACKED_BPM = 40;
export const MAX_TRACKED_BPM = 240;

export function createAudioBeatState(restingBpm = 120): AudioBeatState {
  return {
    time: 0,
    interval: 60 / clamp(finiteOr(restingBpm, 120), MIN_TRACKED_BPM, MAX_TRACKED_BPM),
    anchor: 0,
    lastOnset: null,
    lastTrigger: 0,
    confidence: 0,
  };
}

function wrapPhase(value: number): number {
  const wrapped = value - Math.floor(value);
  return Number.isFinite(wrapped) ? wrapped : 0;
}

/**
 * Infers tempo from the spacing between trigger rising edges, folding an
 * interval into the allowed range so half- and double-time hits still agree.
 */
export function evaluateAudioBeat(
  state: AudioBeatState,
  options: AudioBeatOptions,
): AudioBeatResult {
  const time = finiteOr(options.time, 0);
  const restingBpm = clamp(
    finiteOr(options.restingBpm, 120),
    MIN_TRACKED_BPM,
    MAX_TRACKED_BPM,
  );
  const minBpm = clamp(finiteOr(options.minBpm, 60), MIN_TRACKED_BPM, MAX_TRACKED_BPM);
  const maxBpm = Math.max(
    minBpm,
    clamp(finiteOr(options.maxBpm, 180), MIN_TRACKED_BPM, MAX_TRACKED_BPM),
  );
  const beatsPerBar = Math.max(
    1,
    Math.round(clamp(finiteOr(options.beatsPerBar, 4), 1, 16)),
  );
  const pulseWidth = clamp(finiteOr(options.pulseWidth, 0.12), 0.01, 0.95);
  const lock = clamp(finiteOr(options.lock, 0.35), 0.01, 1);
  const trigger = clamp01(options.trigger);

  if (time < state.time) {
    const reset = { ...createAudioBeatState(restingBpm), time, anchor: time };
    return {
      state: reset,
      bpm: 60 / reset.interval,
      phase: 0,
      beat: 1,
      bar: 0,
      confidence: 0,
    };
  }

  const minInterval = 60 / maxBpm;
  const maxInterval = 60 / minBpm;
  let interval = clamp(state.interval, minInterval, maxInterval);
  let anchor = state.anchor;
  let lastOnset = state.lastOnset;
  let confidence = clamp01(
    state.confidence * Math.exp(-(time - state.time) / CONFIDENCE_SECONDS),
  );
  const onset = trigger >= 0.5 && state.lastTrigger < 0.5;

  if (onset) {
    if (lastOnset !== null) {
      let delta = time - lastOnset;
      for (let step = 0; step < 4 && delta > 0 && delta < minInterval; step += 1) {
        delta *= 2;
      }
      for (let step = 0; step < 4 && delta > maxInterval; step += 1) {
        delta /= 2;
      }
      if (delta >= minInterval && delta <= maxInterval) {
        const agreement = clamp01(1 - Math.abs(delta - interval) / interval);
        confidence = clamp01(confidence + (agreement - confidence) * 0.4);
        interval = clamp(
          interval + (delta - interval) * lock,
          minInterval,
          maxInterval,
        );
        const beats = (time - anchor) / interval;
        anchor += (beats - Math.round(beats)) * interval * lock;
      }
    }
    lastOnset = time;
  }

  const phase = wrapPhase((time - anchor) / interval);
  const bar = wrapPhase((time - anchor) / (interval * beatsPerBar));

  return {
    state: {
      time,
      interval,
      anchor,
      lastOnset,
      lastTrigger: trigger,
      confidence,
    },
    bpm: 60 / interval,
    phase,
    beat: phase < pulseWidth ? 1 : 0,
    bar,
    confidence,
  };
}
