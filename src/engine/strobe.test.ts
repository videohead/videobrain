import { describe, expect, it } from 'vitest';

import {
  MAX_INTERNAL_STROBE_RATE,
  evaluateInternalStrobePhase,
  normalizeStrobePhase,
} from './strobe';

describe('Strobe timing', () => {
  it('hard-caps its internal clock at 3 Hz', () => {
    expect(MAX_INTERNAL_STROBE_RATE).toBe(3);
    expect(evaluateInternalStrobePhase(0.2, 99)).toBeCloseTo(0.6);
  });

  it('stops negative rates and safely normalizes invalid values', () => {
    expect(evaluateInternalStrobePhase(10, -4)).toBe(0);
    expect(evaluateInternalStrobePhase(Number.NaN, 2)).toBe(0);
    expect(evaluateInternalStrobePhase(0.25, Number.NaN)).toBe(0.25);
  });

  it('normalizes internal and connected positions to a positive phase', () => {
    expect(evaluateInternalStrobePhase(-0.25, 3)).toBe(0.25);
    expect(normalizeStrobePhase(-0.25)).toBe(0.75);
    expect(normalizeStrobePhase(3.25)).toBe(0.25);
  });
});
