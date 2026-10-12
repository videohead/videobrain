import { describe, expect, it } from 'vitest';

import {
  MAX_BLEND_CURVE,
  MAX_BLEND_EDGE_FRACTION,
  type OutputBlendSettings,
} from '../store/contracts';
import {
  BLEND_EDGES,
  DEFAULT_BLEND_SETTINGS,
  applyBlackLevelLift,
  applyEdgeBlend,
  blackLevelReport,
  blendAlphaAt,
  blendCoverageAt,
  blendGradientStops,
  blendWeight,
  calibrationPattern,
  decodeBlendWeight,
  encodeBlendWeight,
  normalizeBlendSettings,
  seamCoverage,
  validateBlendSettings,
} from './edgeBlend';

const settings = (
  overrides: Partial<OutputBlendSettings> = {},
): OutputBlendSettings => ({
  ...DEFAULT_BLEND_SETTINGS,
  ...overrides,
  edges: { ...DEFAULT_BLEND_SETTINGS.edges, ...(overrides.edges ?? {}) },
});

describe('blend weight', () => {
  it('runs from no light to full light across the band', () => {
    expect(blendWeight(0)).toBe(0);
    expect(blendWeight(1)).toBe(1);
    expect(blendWeight(0.5)).toBeCloseTo(0.5, 10);
  });

  it('is complementary for every curve, which is what closes the seam', () => {
    for (const curve of [0.25, 0.5, 1, 2, 3.5, MAX_BLEND_CURVE]) {
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        expect(blendWeight(t, curve) + blendWeight(1 - t, curve)).toBeCloseTo(
          1,
          10,
        );
      }
    }
  });

  it('rises monotonically', () => {
    let previous = -1;
    for (let step = 0; step <= 32; step += 1) {
      const value = blendWeight(step / 32, 2);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('makes a higher curve hand over light more abruptly', () => {
    expect(blendWeight(0.25, 3)).toBeLessThan(blendWeight(0.25, 1));
    expect(blendWeight(0.75, 3)).toBeGreaterThan(blendWeight(0.75, 1));
  });

  it('clamps out-of-range and non-finite positions', () => {
    expect(blendWeight(-5)).toBe(0);
    expect(blendWeight(9)).toBe(1);
    expect(blendWeight(Number.NaN)).toBe(0);
  });
});

describe('gamma encoding', () => {
  it('round-trips a linear-light weight through the signal domain', () => {
    for (const weight of [0, 0.1, 0.5, 0.9, 1]) {
      expect(decodeBlendWeight(encodeBlendWeight(weight, 2.2), 2.2)).toBeCloseTo(
        weight,
        10,
      );
    }
  });

  it('raises the encoded signal above the light it represents', () => {
    // Half the light needs well over half the signal on a gamma display.
    expect(encodeBlendWeight(0.5, 2.2)).toBeGreaterThan(0.5);
    expect(encodeBlendWeight(0.5, 2.2)).toBeCloseTo(0.5 ** (1 / 2.2), 10);
  });

  it('is an identity at gamma 1', () => {
    expect(encodeBlendWeight(0.37, 1)).toBeCloseTo(0.37, 10);
  });

  it('clamps an unusable gamma rather than producing a bogus signal', () => {
    expect(encodeBlendWeight(0.5, 0)).toBeCloseTo(0.5, 10);
    expect(encodeBlendWeight(0.5, 99)).toBeCloseTo(0.5 ** (1 / 3.2), 10);
  });
});

describe('coverage across an output', () => {
  it('leaves the interior at full brightness', () => {
    const value = blendCoverageAt(0.5, 0.5, settings({ edges: { left: 0.2, right: 0.2, top: 0, bottom: 0 } }));
    expect(value).toBe(1);
  });

  it('fades to nothing at an overlapping edge', () => {
    const blend = settings({ edges: { left: 0.25, right: 0, top: 0, bottom: 0 } });
    expect(blendCoverageAt(0, 0.5, blend)).toBe(0);
    expect(blendCoverageAt(0.125, 0.5, blend)).toBeCloseTo(0.5, 10);
    expect(blendCoverageAt(0.25, 0.5, blend)).toBe(1);
  });

  it('leaves a non-overlapping edge at full brightness', () => {
    // No neighbour on the right, so the right edge must not be dimmed.
    const blend = settings({ edges: { left: 0.25, right: 0, top: 0, bottom: 0 } });
    expect(blendCoverageAt(1, 0.5, blend)).toBe(1);
  });

  it('multiplies two bands at a corner', () => {
    const blend = settings({ edges: { left: 0.2, right: 0, top: 0, bottom: 0.2 } });
    const corner = blendCoverageAt(0.1, 0.1, blend);
    expect(corner).toBeCloseTo(0.5 * 0.5, 10);
  });

  it('blends vertically as well as horizontally', () => {
    const blend = settings({ edges: { left: 0, right: 0, top: 0.2, bottom: 0 } });
    expect(blendCoverageAt(0.5, 1, blend)).toBe(0);
    expect(blendCoverageAt(0.5, 0.9, blend)).toBeCloseTo(0.5, 10);
  });

  it('applies gamma and brightness to the output alpha', () => {
    const blend = settings({
      edges: { left: 0.25, right: 0, top: 0, bottom: 0 },
      brightness: 0.5,
    });
    const alpha = blendAlphaAt(0.125, 0.5, blend);
    expect(alpha).toBeCloseTo(0.5 ** (1 / 2.2) * 0.5, 10);
  });
});

describe('seam coverage', () => {
  it('sums two opposing ramps to exactly one screen of light', () => {
    const report = seamCoverage(settings(), settings());
    expect(report.maxError).toBeLessThan(1e-9);
    expect(report.meanError).toBeLessThan(1e-9);
  });

  it('stays closed when the operator reshapes both ramps together', () => {
    const report = seamCoverage(
      settings({ curve: 2.5 }),
      settings({ curve: 2.5 }),
    );
    expect(report.maxError).toBeLessThan(1e-9);
  });

  it('opens a measurable seam when the two curves disagree', () => {
    // A real misconfiguration: each projector was given a different curve.
    const report = seamCoverage(settings({ curve: 1 }), settings({ curve: 3 }));
    expect(report.maxError).toBeGreaterThan(0.05);
  });

  it('reports the sample count it used', () => {
    expect(seamCoverage(settings(), settings(), 16).samples).toBe(16);
    expect(seamCoverage(settings(), settings(), 1).samples).toBe(2);
  });
});

describe('black level', () => {
  it('doubles the black floor inside an overlap', () => {
    const report = blackLevelReport(0.02);
    expect(report.overlapBlack).toBeCloseTo(0.04, 10);
    expect(report.requiredLift).toBeCloseTo(0.02, 10);
  });

  it('shows that lifting to match costs contrast', () => {
    const report = blackLevelReport(0.02);
    expect(report.contrastBefore).toBeCloseTo(50, 6);
    expect(report.contrastAfter).toBeCloseTo(25, 6);
    expect(report.contrastAfter).toBeLessThan(report.contrastBefore);
  });

  it('flags a floor a viewer would notice', () => {
    expect(blackLevelReport(0.02).visibleWithoutLift).toBe(true);
    expect(blackLevelReport(0.001).visibleWithoutLift).toBe(false);
  });

  it('treats an ideal projector as having no limitation', () => {
    const report = blackLevelReport(0);
    expect(report.requiredLift).toBe(0);
    expect(report.visibleWithoutLift).toBe(false);
    expect(report.contrastBefore).toBe(Number.POSITIVE_INFINITY);
  });

  it('compresses the signal range when a lift is applied', () => {
    expect(applyBlackLevelLift(0, 0.04)).toBeCloseTo(0.04, 10);
    expect(applyBlackLevelLift(1, 0.04)).toBeCloseTo(1, 10);
    expect(applyBlackLevelLift(0.5, 0.04)).toBeCloseTo(0.52, 10);
  });
});

describe('validation', () => {
  it('accepts the neutral default', () => {
    expect(validateBlendSettings(DEFAULT_BLEND_SETTINGS).valid).toBe(true);
  });

  it('rejects an over-wide edge', () => {
    const result = validateBlendSettings(
      settings({ edges: { left: 0.9, right: 0, top: 0, bottom: 0 } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('left');
  });

  it('rejects opposing overlaps that consume the whole axis', () => {
    const result = validateBlendSettings(
      settings({ edges: { left: 0.5, right: 0.5, top: 0, bottom: 0 } }),
    );
    expect(result.errors.join(' ')).toContain('overlap each other');
  });

  it('rejects an out-of-range curve, gamma, brightness and lift', () => {
    expect(validateBlendSettings(settings({ curve: 99 })).valid).toBe(false);
    expect(validateBlendSettings(settings({ gamma: 0.2 })).valid).toBe(false);
    expect(validateBlendSettings(settings({ brightness: 4 })).valid).toBe(false);
    expect(validateBlendSettings(settings({ blackLevelLift: -1 })).valid).toBe(
      false,
    );
  });

  it('rejects non-finite values on every edge', () => {
    for (const edge of BLEND_EDGES) {
      const result = validateBlendSettings(
        settings({ edges: { ...DEFAULT_BLEND_SETTINGS.edges, [edge]: Number.NaN } }),
      );
      expect(result.valid).toBe(false);
    }
  });

  it('clamps rather than fails when normalizing an edit', () => {
    const normalized = normalizeBlendSettings({
      edges: { left: 9, right: -2, top: Number.NaN, bottom: 0.1 },
      curve: 500,
      gamma: 0,
      brightness: 7,
      blackLevelLift: -3,
    });
    expect(normalized.edges.left).toBe(MAX_BLEND_EDGE_FRACTION);
    expect(normalized.edges.right).toBe(0);
    expect(normalized.edges.top).toBe(0);
    expect(normalized.edges.bottom).toBeCloseTo(0.1, 10);
    expect(validateBlendSettings(normalized).valid).toBe(true);
  });

  it('falls back to defaults for missing fields', () => {
    expect(normalizeBlendSettings()).toEqual(DEFAULT_BLEND_SETTINGS);
  });
});

describe('canvas application', () => {
  const blend = settings({
    edges: { left: 0.25, right: 0, top: 0, bottom: 0.1 },
  });

  function gradientRecorder() {
    const gradients: { stops: [number, string][] }[] = [];
    const fills: number[] = [];
    const context = {
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      fillRect: () => fills.push(context.globalAlpha),
      createLinearGradient: () => {
        const entry: { stops: [number, string][] } = { stops: [] };
        gradients.push(entry);
        return {
          addColorStop: (offset: number, color: string) =>
            entry.stops.push([offset, color]),
        };
      },
      fillStyle: '' as string | CanvasGradient | CanvasPattern,
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      globalAlpha: 1,
    };
    return { context, gradients, fills };
  }

  it('returns no stops for an edge that does not overlap', () => {
    expect(blendGradientStops('right', blend)).toHaveLength(0);
  });

  it('ramps an active edge from dark to full within its width', () => {
    const stops = blendGradientStops('left', blend, 5);
    expect(stops[0]).toEqual({ offset: 0, alpha: 0 });
    expect(stops[stops.length - 1]?.offset).toBeCloseTo(0.25, 10);
    expect(stops[stops.length - 1]?.alpha).toBeCloseTo(1, 10);
  });

  it('encodes multiplicatively, so separate passes equal one product', () => {
    // enc(a) * enc(b) must equal enc(a * b), which is why four independent
    // gradient passes still produce the right value at a corner.
    const a = blendWeight(0.3, blend.curve);
    const b = blendWeight(0.7, blend.curve);
    expect(
      encodeBlendWeight(a, blend.gamma) * encodeBlendWeight(b, blend.gamma),
    ).toBeCloseTo(encodeBlendWeight(a * b, blend.gamma), 10);
  });

  it('applies one pass per active edge', () => {
    const { context, gradients } = gradientRecorder();
    expect(applyEdgeBlend(context, blend, { width: 400, height: 200 })).toBe(2);
    expect(gradients).toHaveLength(2);
    expect(context.globalCompositeOperation).toBe('destination-in');
  });

  it('adds a final full-brightness stop so the interior is untouched', () => {
    const { context, gradients } = gradientRecorder();
    applyEdgeBlend(context, blend, { width: 400, height: 200 });
    for (const gradient of gradients) {
      expect(gradient.stops[gradient.stops.length - 1]?.[0]).toBe(1);
      expect(gradient.stops[gradient.stops.length - 1]?.[1]).toContain('1)');
    }
  });

  it('applies brightness once, after the edges', () => {
    const { context, fills } = gradientRecorder();
    const passes = applyEdgeBlend(
      context,
      settings({ edges: { left: 0.25, right: 0, top: 0, bottom: 0 }, brightness: 0.6 }),
      { width: 400, height: 200 },
    );
    expect(passes).toBe(2);
    expect(fills.filter((alpha) => Math.abs(alpha - 0.6) < 1e-9)).toHaveLength(1);
  });

  it('does nothing when no edge overlaps and brightness is full', () => {
    const { context, gradients } = gradientRecorder();
    expect(
      applyEdgeBlend(context, DEFAULT_BLEND_SETTINGS, { width: 400, height: 200 }),
    ).toBe(0);
    expect(gradients).toHaveLength(0);
  });
});

describe('calibration patterns', () => {
  const blend = settings({
    edges: { left: 0.2, right: 0.15, top: 0, bottom: 0.1 },
  });

  it('draws an alignment grid with a border', () => {
    const pattern = calibrationPattern('grid', blend, 4);
    expect(pattern.lines.filter(({ role }) => role === 'grid')).toHaveLength(6);
    expect(pattern.lines.filter(({ role }) => role === 'border')).toHaveLength(4);
    expect(pattern.field).toBeNull();
  });

  it('marks exactly the active overlap boundaries', () => {
    const pattern = calibrationPattern('blend-edges', blend);
    const marks = pattern.lines.filter(({ role }) => role === 'blend');
    expect(marks).toHaveLength(3);
    expect(marks.some(({ u0 }) => Math.abs(u0 - 0.2) < 1e-9)).toBe(true);
    expect(marks.some(({ u0 }) => Math.abs(u0 - 0.85) < 1e-9)).toBe(true);
    expect(marks.some(({ v0 }) => Math.abs(v0 - 0.1) < 1e-9)).toBe(true);
  });

  it('marks nothing when no edge overlaps', () => {
    const pattern = calibrationPattern('blend-edges', DEFAULT_BLEND_SETTINGS);
    expect(pattern.lines.filter(({ role }) => role === 'blend')).toHaveLength(0);
  });

  it('offers a flat field for spotting a seam', () => {
    const pattern = calibrationPattern('flat-field', blend);
    expect(pattern.field?.level).toBe(0.5);
    expect(pattern.lines).toHaveLength(0);
  });
});
