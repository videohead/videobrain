import { describe, expect, it } from 'vitest';

import {
  AUDIO_BAND_RANGES,
  analyzeShapedBands,
  analyzeSpectrumBands,
  bandResponse,
  createAudioBeatState,
  createAudioOnsetState,
  evaluateAudioBeat,
  evaluateAudioOnset,
  type AudioBeatState,
  type AudioOnsetState,
} from './audioAnalysis';

const SAMPLE_RATE = 48_000;
const BIN_COUNT = 512;

function spectrumWithPeak(
  band: 'bass' | 'mid' | 'treble',
  peakDecibels = -35,
  floorDecibels = -100,
): Float32Array {
  const [low, high] = AUDIO_BAND_RANGES[band];
  const binWidth = SAMPLE_RATE / 2 / BIN_COUNT;
  const bins = new Float32Array(BIN_COUNT).fill(floorDecibels);
  for (let index = 0; index < BIN_COUNT; index += 1) {
    const frequency = (index + 0.5) * binWidth;
    if (frequency >= low && frequency < high) {
      bins[index] = peakDecibels;
    }
  }
  return bins;
}

function runOnsets(
  values: readonly number[],
  step: number,
  threshold = 0.1,
): { times: number[]; state: AudioOnsetState } {
  let state = createAudioOnsetState();
  const times: number[] = [];
  values.forEach((value, index) => {
    const time = index * step;
    const result = evaluateAudioOnset(state, {
      value,
      time,
      threshold,
      sensitivity: 1.2,
      hold: 0.08,
      decay: 0.2,
    });
    state = result.state;
    if (result.onset) {
      times.push(time);
    }
  });
  return { times, state };
}

function trackBeats(
  beatInterval: number,
  seconds: number,
  step = 1 / 60,
): { state: AudioBeatState; bpm: number; phase: number; confidence: number } {
  let state = createAudioBeatState(120);
  let bpm = 120;
  let phase = 0;
  let confidence = 0;
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame <= frames; frame += 1) {
    const time = frame * step;
    const sincePulse = time % beatInterval;
    const result = evaluateAudioBeat(state, {
      trigger: sincePulse < step ? 1 : 0,
      time,
      restingBpm: 120,
      minBpm: 70,
      maxBpm: 170,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      lock: 0.5,
    });
    state = result.state;
    bpm = result.bpm;
    phase = result.phase;
    confidence = result.confidence;
  }
  return { state, bpm, phase, confidence };
}

describe('spectrum band analysis', () => {
  it.each(['bass', 'mid', 'treble'] as const)(
    'isolates energy inside the %s range',
    (band) => {
      const bands = analyzeSpectrumBands(
        spectrumWithPeak(band),
        SAMPLE_RATE,
        -100,
        -30,
      );

      expect(bands[band]).toBeGreaterThan(0.8);
      for (const other of ['bass', 'mid', 'treble'] as const) {
        if (other !== band) {
          expect(bands[other]).toBeLessThan(0.05);
        }
      }
    },
  );

  it('returns silence for an empty, inverted, or unclocked spectrum', () => {
    const silent = { bass: 0, mid: 0, treble: 0 };

    expect(analyzeSpectrumBands(new Float32Array(0), SAMPLE_RATE)).toEqual(silent);
    expect(analyzeSpectrumBands(new Float32Array(BIN_COUNT), 0)).toEqual(silent);
    expect(
      analyzeSpectrumBands(new Float32Array(BIN_COUNT), SAMPLE_RATE, -30, -100),
    ).toEqual(silent);
  });

  it('clamps out-of-range and non-finite decibel readings', () => {
    const bins = new Float32Array(BIN_COUNT).fill(Number.NaN);
    bins[1] = Number.POSITIVE_INFINITY;

    const bands = analyzeSpectrumBands(bins, SAMPLE_RATE, -100, -30);

    expect(bands.bass).toBeGreaterThanOrEqual(0);
    expect(bands.bass).toBeLessThanOrEqual(1);
    expect(Number.isFinite(bands.mid)).toBe(true);
  });
});

describe('band shaping', () => {
  it('peaks at the center frequency and falls away either side', () => {
    expect(bandResponse(1_000, 1_000, 4)).toBeCloseTo(1);
    expect(bandResponse(500, 1_000, 4)).toBeLessThan(0.5);
    expect(bandResponse(2_000, 1_000, 4)).toBeLessThan(0.5);
  });

  it('narrows the passband as Q rises', () => {
    const wide = bandResponse(1_400, 1_000, 0.7);
    const tight = bandResponse(1_400, 1_000, 8);

    expect(tight).toBeLessThan(wide);
    expect(bandResponse(1_000, 1_000, 8)).toBeCloseTo(1);
  });

  it('rejects a non-finite or non-positive frequency', () => {
    expect(bandResponse(0, 1_000, 1)).toBe(0);
    expect(bandResponse(Number.NaN, 1_000, 1)).toBe(0);
    expect(Number.isFinite(bandResponse(1_000, Number.NaN, Number.NaN))).toBe(
      true,
    );
  });

  it('moves a band onto new energy when its center frequency changes', () => {
    const magnitudes = new Float32Array(BIN_COUNT);
    const binWidth = SAMPLE_RATE / 2 / BIN_COUNT;
    magnitudes[Math.round(3_000 / binWidth)] = 1;
    const spectrum = { magnitudes, sampleRate: SAMPLE_RATE };

    const away = analyzeShapedBands(spectrum, {
      bass: { frequency: 70, q: 6 },
      mid: { frequency: 900, q: 6 },
      treble: { frequency: 12_000, q: 6 },
    });
    const onto = analyzeShapedBands(spectrum, {
      bass: { frequency: 70, q: 6 },
      mid: { frequency: 900, q: 6 },
      treble: { frequency: 3_000, q: 6 },
    });

    expect(onto.treble).toBeGreaterThan(away.treble);
  });
});

describe('audio onset detection', () => {
  it('fires once per impulse and blocks retriggers during the hold window', () => {
    const step = 1 / 60;
    const frames = Array.from({ length: 120 }, (_, index) =>
      index % 30 < 2 ? 0.9 : 0.05,
    );

    const { times } = runOnsets(frames, step);

    expect(times).toHaveLength(4);
    expect((times[1] as number) - (times[0] as number)).toBeCloseTo(0.5, 2);
  });

  it('stays silent below the threshold', () => {
    const { times } = runOnsets(Array.from({ length: 120 }, () => 0.04), 1 / 60);

    expect(times).toEqual([]);
  });

  it('decays the envelope toward zero after an impulse', () => {
    const first = evaluateAudioOnset(createAudioOnsetState(), {
      value: 0.9,
      time: 0,
      threshold: 0.1,
      sensitivity: 1,
      hold: 0.1,
      decay: 0.2,
    });
    const later = evaluateAudioOnset(first.state, {
      value: 0.02,
      time: 1,
      threshold: 0.1,
      sensitivity: 1,
      hold: 0.1,
      decay: 0.2,
    });

    expect(first.envelope).toBe(1);
    expect(first.trigger).toBe(1);
    expect(later.envelope).toBeLessThan(0.01);
    expect(later.trigger).toBe(0);
  });

  it('rebuilds state when the transport rewinds', () => {
    const forward = evaluateAudioOnset(createAudioOnsetState(), {
      value: 0.9,
      time: 4,
      threshold: 0.1,
      sensitivity: 1,
      hold: 0.1,
      decay: 0.2,
    });
    const rewound = evaluateAudioOnset(forward.state, {
      value: 0.9,
      time: 0,
      threshold: 0.1,
      sensitivity: 1,
      hold: 0.1,
      decay: 0.2,
    });

    expect(rewound.onset).toBe(false);
    expect(rewound.envelope).toBe(0);
    expect(rewound.state.time).toBe(0);
  });
});

describe('audio beat tracking', () => {
  it.each([
    [0.5, 120],
    [0.4, 150],
    [0.75, 80],
  ])('locks %ss between impulses to about %s BPM', (interval, expected) => {
    const { bpm } = trackBeats(interval, 12);

    expect(bpm).toBeGreaterThan(expected - 4);
    expect(bpm).toBeLessThan(expected + 4);
  });

  it('folds a half-time impulse spacing into the tracked range', () => {
    const { bpm } = trackBeats(1, 12);

    expect(bpm).toBeGreaterThan(116);
    expect(bpm).toBeLessThan(124);
  });

  it('places the beat pulse near phase zero once locked', () => {
    let state = createAudioBeatState(120);
    const step = 1 / 60;
    let beatAtPulse = 0;
    for (let frame = 0; frame <= 720; frame += 1) {
      const time = frame * step;
      const trigger = time % 0.5 < step ? 1 : 0;
      const result = evaluateAudioBeat(state, {
        trigger,
        time,
        restingBpm: 120,
        minBpm: 70,
        maxBpm: 170,
        beatsPerBar: 4,
        pulseWidth: 0.2,
        lock: 0.5,
      });
      state = result.state;
      if (frame > 600 && trigger === 1) {
        beatAtPulse = result.beat;
      }
    }

    expect(beatAtPulse).toBe(1);
  });

  it('free-runs at the resting tempo without any trigger', () => {
    let state = createAudioBeatState(120);
    let result = evaluateAudioBeat(state, {
      trigger: 0,
      time: 0,
      restingBpm: 90,
      minBpm: 70,
      maxBpm: 170,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      lock: 0.35,
    });
    state = result.state;
    result = evaluateAudioBeat(state, {
      trigger: 0,
      time: 2,
      restingBpm: 90,
      minBpm: 70,
      maxBpm: 170,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      lock: 0.35,
    });

    expect(result.bpm).toBeCloseTo(120, 5);
    expect(result.confidence).toBe(0);
    expect(result.phase).toBeGreaterThanOrEqual(0);
    expect(result.phase).toBeLessThan(1);
  });

  it('raises confidence for steady impulses and loses it in silence', () => {
    const steady = trackBeats(0.5, 8);
    const decayed = evaluateAudioBeat(steady.state, {
      trigger: 0,
      time: steady.state.time + 30,
      restingBpm: 120,
      minBpm: 70,
      maxBpm: 170,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      lock: 0.5,
    });

    expect(steady.confidence).toBeGreaterThan(0.6);
    expect(decayed.confidence).toBeLessThan(0.05);
  });

  it('resets to the resting tempo when the transport rewinds', () => {
    const steady = trackBeats(0.4, 8);
    const rewound = evaluateAudioBeat(steady.state, {
      trigger: 0,
      time: 0,
      restingBpm: 100,
      minBpm: 70,
      maxBpm: 170,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      lock: 0.5,
    });

    expect(rewound.bpm).toBeCloseTo(100, 5);
    expect(rewound.phase).toBe(0);
    expect(rewound.confidence).toBe(0);
    expect(rewound.state.lastOnset).toBeNull();
  });

  it('keeps every output finite for hostile parameters', () => {
    const result = evaluateAudioBeat(createAudioBeatState(120), {
      trigger: Number.NaN,
      time: Number.NaN,
      restingBpm: Number.NaN,
      minBpm: Number.POSITIVE_INFINITY,
      maxBpm: Number.NEGATIVE_INFINITY,
      beatsPerBar: Number.NaN,
      pulseWidth: Number.NaN,
      lock: Number.NaN,
    });

    for (const value of [
      result.bpm,
      result.phase,
      result.beat,
      result.bar,
      result.confidence,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
