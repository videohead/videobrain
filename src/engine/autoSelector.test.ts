import { describe, expect, it } from 'vitest';

import { evaluateAutoSelector } from './autoSelector';

function sampleStep(
  step: number,
  order: 'forward' | 'reverse' | 'shuffleBag',
  count = 4,
  seed = 23,
) {
  return evaluateAutoSelector(step + 0.25, 1, count, order, seed);
}

describe('Auto Selector evaluation', () => {
  it('advances forward and reverse in exact modular order', () => {
    expect(
      [0, 1, 2, 3, 4].map((step) => sampleStep(step, 'forward').index),
    ).toEqual([0, 1, 2, 3, 0]);
    expect(
      [0, 1, 2, 3, 4].map((step) => sampleStep(step, 'reverse').index),
    ).toEqual([3, 2, 1, 0, 3]);
  });

  it('uses floor steps and a positive phase for negative positions', () => {
    expect(evaluateAutoSelector(-0.25, 1, 4, 'forward', 23)).toEqual({
      index: 3,
      phase: 0.75,
      step: -1,
    });
    expect(evaluateAutoSelector(-1.25, 1, 4, 'reverse', 23)).toEqual({
      index: 1,
      phase: 0.75,
      step: -2,
    });
  });

  it('visits every index exactly once in each deterministic shuffle bag', () => {
    for (let bag = -3; bag <= 3; bag += 1) {
      const indices = Array.from({ length: 4 }, (_, slot) =>
        sampleStep(bag * 4 + slot, 'shuffleBag').index,
      );
      expect([...indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    }
  });

  it('reproduces shuffle output after rewind and skipped evaluation', () => {
    const positions = [-8.75, -0.75, 0.25, 9.25, 2.25, 17.25];
    const first = positions.map(
      (position) =>
        evaluateAutoSelector(position, 1, 4, 'shuffleBag', 4_211).index,
    );
    const skipped = evaluateAutoSelector(10_000.25, 1, 4, 'shuffleBag', 4_211);
    const second = positions.map(
      (position) =>
        evaluateAutoSelector(position, 1, 4, 'shuffleBag', 4_211).index,
    );

    expect(skipped.index).toBeGreaterThanOrEqual(0);
    expect(second).toEqual(first);
  });

  it('rounds count and seed into their bounded integer contracts', () => {
    const rounded = evaluateAutoSelector(2.25, 1, 3.6, 'shuffleBag', 22.8);
    const integers = evaluateAutoSelector(2.25, 1, 4, 'shuffleBag', 23);

    expect(rounded).toEqual(integers);
  });
});
