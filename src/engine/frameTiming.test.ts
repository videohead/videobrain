import { describe, expect, it } from 'vitest';

import {
  FRAME_PACING_OPTIONS,
  FramePacer,
  RollingFrameRate,
} from './frameTiming';

function renderedTimestamps(
  pacer: FramePacer,
  timestamps: number[],
): number[] {
  return timestamps.filter((timestamp) => pacer.shouldRender(timestamp));
}

describe('monitor frame pacing', () => {
  it('offers display-synchronized, 60 fps, and 30 fps modes', () => {
    expect(
      FRAME_PACING_OPTIONS.map(({ value, label }) => ({ value, label })),
    ).toEqual([
      { value: 'display', label: 'Display sync' },
      { value: '60-fps', label: '60 fps' },
      { value: '30-fps', label: '30 fps' },
    ]);
  });

  it('renders every animation callback in display-sync mode', () => {
    const pacer = new FramePacer('display');
    const timestamps = [0, 6.94, 13.89, 20.83, 27.78];

    expect(renderedTimestamps(pacer, timestamps)).toEqual(timestamps);
  });

  it('deterministically selects 60 fps from a 120 Hz callback stream', () => {
    const pacer = new FramePacer('60-fps');
    const timestamps = Array.from({ length: 9 }, (_, index) =>
      index * (1000 / 120),
    );

    expect(renderedTimestamps(pacer, timestamps)).toEqual([
      timestamps[0],
      timestamps[2],
      timestamps[4],
      timestamps[6],
      timestamps[8],
    ]);
  });

  it('deterministically selects 30 fps from a 60 Hz callback stream', () => {
    const pacer = new FramePacer('30-fps');
    const timestamps = Array.from({ length: 7 }, (_, index) =>
      index * (1000 / 60),
    );

    expect(renderedTimestamps(pacer, timestamps)).toEqual([
      timestamps[0],
      timestamps[2],
      timestamps[4],
      timestamps[6],
    ]);
  });

  it('skips missed frame slots without shifting the cadence', () => {
    const pacer = new FramePacer('60-fps');

    expect(pacer.shouldRender(0)).toBe(true);
    expect(pacer.shouldRender(16.7)).toBe(true);
    expect(pacer.shouldRender(53)).toBe(true);
    expect(pacer.shouldRender(60)).toBe(false);
    expect(pacer.shouldRender(66.7)).toBe(true);
  });

  it('reanchors safely when an animation timestamp moves backward', () => {
    const pacer = new FramePacer('30-fps');

    expect(pacer.shouldRender(100)).toBe(true);
    expect(pacer.shouldRender(110)).toBe(false);
    expect(pacer.shouldRender(5)).toBe(true);
  });
});

describe('rolling frame-rate measurement', () => {
  it('reports an average across recent renders instead of the last interval', () => {
    const meter = new RollingFrameRate();

    for (const timestamp of [0, 17, 33, 51, 66, 84, 100]) {
      meter.sample(timestamp);
    }

    expect(meter.value).toBeCloseTo(60, 5);
    expect(meter.value).not.toBeCloseTo(62.5, 1);
  });

  it('uses a rolling time window for changing render rates', () => {
    const meter = new RollingFrameRate(1000);
    for (let timestamp = 0; timestamp <= 1000; timestamp += 100) {
      meter.sample(timestamp);
    }
    for (let timestamp = 1050; timestamp <= 2050; timestamp += 50) {
      meter.sample(timestamp);
    }

    expect(meter.value).toBeCloseTo(20, 5);
  });

  it('starts a fresh measurement after a long render stall', () => {
    const meter = new RollingFrameRate();

    meter.sample(0);
    expect(meter.sample(100)).toBe(10);
    expect(meter.sample(400)).toBe(0);
    expect(meter.sample(450)).toBe(20);
  });
});
