/**
 * M4 (overlap blending) — soft-edge blend math for overlapping projectors.
 *
 * Two projectors covering a shared band must together emit exactly one
 * screen's worth of light across it. That is a statement about *linear
 * light*, not about the encoded pixel values a canvas holds, so the weight
 * is computed in linear light and only encoded with the display gamma at
 * the very end.
 *
 * The weight uses the complementary family
 *
 *     w(t) = t^p / (t^p + (1-t)^p)
 *
 * which satisfies `w(t) + w(1-t) = 1` for every exponent `p`. The operator
 * can therefore reshape the ramp without ever breaking the sum, which is
 * the property that matters for a seam.
 *
 * ── What this module does not do ────────────────────────────────
 * Canvas alpha is not calibrated light output. This module computes signal
 * values; it makes no claim about a physical projector's gamma, colour
 * primaries, black floor, or uniformity. The doubled black level inside an
 * overlap cannot be removed by any blend curve — see `blackLevelReport`.
 * Physical acceptance requires the measured two-projector procedure in
 * docs/MAPPING.md and is NOT established by any test in this repository.
 */
import {
  MAX_BLEND_CURVE,
  MAX_BLEND_EDGE_FRACTION,
  MAX_BLEND_GAMMA,
  MIN_BLEND_CURVE,
  MIN_BLEND_GAMMA,
  type OutputBlendSettings,
  type OutputEdgeBlend,
} from '../store/contracts';

export type BlendEdge = keyof OutputEdgeBlend;

export const BLEND_EDGES: readonly BlendEdge[] = [
  'left',
  'right',
  'top',
  'bottom',
];

/** Neutral settings: no overlap, linear ramp, sRGB-ish gamma, no lift. */
export const DEFAULT_BLEND_SETTINGS: OutputBlendSettings = {
  edges: { left: 0, right: 0, top: 0, bottom: 0 },
  curve: 1,
  gamma: 2.2,
  brightness: 1,
  blackLevelLift: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: number): boolean => Number.isFinite(value);

export interface BlendValidation {
  valid: boolean;
  errors: readonly string[];
}

export function validateBlendSettings(
  settings: OutputBlendSettings,
): BlendValidation {
  const errors: string[] = [];
  for (const edge of BLEND_EDGES) {
    const width = settings.edges[edge];
    if (!finite(width) || width < 0 || width > MAX_BLEND_EDGE_FRACTION) {
      errors.push(
        `Blend width "${edge}" must be within 0..${MAX_BLEND_EDGE_FRACTION}.`,
      );
    }
  }
  // Opposing overlaps must leave a full-brightness interior. At a combined
  // width of exactly 1 that interior collapses to a zero-width line, so the
  // boundary itself is rejected rather than merely anything beyond it.
  if (
    finite(settings.edges.left) &&
    finite(settings.edges.right) &&
    settings.edges.left + settings.edges.right >= 1
  ) {
    errors.push('Left and right blend widths overlap each other.');
  }
  if (
    finite(settings.edges.top) &&
    finite(settings.edges.bottom) &&
    settings.edges.top + settings.edges.bottom >= 1
  ) {
    errors.push('Top and bottom blend widths overlap each other.');
  }
  if (
    !finite(settings.curve) ||
    settings.curve < MIN_BLEND_CURVE ||
    settings.curve > MAX_BLEND_CURVE
  ) {
    errors.push(
      `Blend curve must be within ${MIN_BLEND_CURVE}..${MAX_BLEND_CURVE}.`,
    );
  }
  if (
    !finite(settings.gamma) ||
    settings.gamma < MIN_BLEND_GAMMA ||
    settings.gamma > MAX_BLEND_GAMMA
  ) {
    errors.push(
      `Blend gamma must be within ${MIN_BLEND_GAMMA}..${MAX_BLEND_GAMMA}.`,
    );
  }
  if (!finite(settings.brightness) || settings.brightness < 0 || settings.brightness > 1) {
    errors.push('Brightness must be within 0..1.');
  }
  if (
    !finite(settings.blackLevelLift) ||
    settings.blackLevelLift < 0 ||
    settings.blackLevelLift > 1
  ) {
    errors.push('Black level lift must be within 0..1.');
  }
  return { valid: errors.length === 0, errors };
}

/** Clamps every field into range, for UI edits that should not hard-fail. */
export function normalizeBlendSettings(
  settings: Partial<OutputBlendSettings> = {},
): OutputBlendSettings {
  const edges = settings.edges ?? DEFAULT_BLEND_SETTINGS.edges;
  const safeEdge = (value: number | undefined): number =>
    finite(value ?? Number.NaN)
      ? clamp(value as number, 0, MAX_BLEND_EDGE_FRACTION)
      : 0;
  return {
    edges: {
      left: safeEdge(edges.left),
      right: safeEdge(edges.right),
      top: safeEdge(edges.top),
      bottom: safeEdge(edges.bottom),
    },
    curve: finite(settings.curve ?? Number.NaN)
      ? clamp(settings.curve as number, MIN_BLEND_CURVE, MAX_BLEND_CURVE)
      : DEFAULT_BLEND_SETTINGS.curve,
    gamma: finite(settings.gamma ?? Number.NaN)
      ? clamp(settings.gamma as number, MIN_BLEND_GAMMA, MAX_BLEND_GAMMA)
      : DEFAULT_BLEND_SETTINGS.gamma,
    brightness: finite(settings.brightness ?? Number.NaN)
      ? clamp(settings.brightness as number, 0, 1)
      : DEFAULT_BLEND_SETTINGS.brightness,
    blackLevelLift: finite(settings.blackLevelLift ?? Number.NaN)
      ? clamp(settings.blackLevelLift as number, 0, 1)
      : DEFAULT_BLEND_SETTINGS.blackLevelLift,
  };
}

// ═══════════════════════════════════════════════════════════════
// Blend weight
// ═══════════════════════════════════════════════════════════════

/**
 * Linear-light weight at position `t` across one overlap band, where `t` is
 * 0 at the outer edge (all light handed to the neighbour) and 1 at the
 * inner edge (this projector at full brightness).
 *
 * Guarantees `blendWeight(t) + blendWeight(1 - t) === 1` for all `t`, which
 * is what makes two opposing ramps sum to a single screen of light.
 */
export function blendWeight(t: number, curve = 1): number {
  if (!finite(t)) {
    return 0;
  }
  const position = clamp(t, 0, 1);
  if (position <= 0) return 0;
  if (position >= 1) return 1;
  const power = clamp(finite(curve) ? curve : 1, MIN_BLEND_CURVE, MAX_BLEND_CURVE);
  const rising = Math.pow(position, power);
  const falling = Math.pow(1 - position, power);
  const total = rising + falling;
  return total > 0 ? rising / total : 0;
}

/**
 * Encodes a linear-light weight into the signal domain.
 * Projector light rises roughly as `signal^gamma`, so the signal that
 * produces a given light level is `light^(1/gamma)`.
 */
export function encodeBlendWeight(weight: number, gamma: number): number {
  const light = clamp(finite(weight) ? weight : 0, 0, 1);
  const exponent = clamp(
    finite(gamma) ? gamma : DEFAULT_BLEND_SETTINGS.gamma,
    MIN_BLEND_GAMMA,
    MAX_BLEND_GAMMA,
  );
  return Math.pow(light, 1 / exponent);
}

/** Inverse of `encodeBlendWeight`, for checking a measured signal. */
export function decodeBlendWeight(signal: number, gamma: number): number {
  const encoded = clamp(finite(signal) ? signal : 0, 0, 1);
  const exponent = clamp(
    finite(gamma) ? gamma : DEFAULT_BLEND_SETTINGS.gamma,
    MIN_BLEND_GAMMA,
    MAX_BLEND_GAMMA,
  );
  return Math.pow(encoded, exponent);
}

/**
 * Linear-light coverage at a normalized output position.
 * `u` runs 0..1 left to right, `v` runs 0..1 bottom to top (y-up, matching
 * the surface UV convention). Corners sit in two bands at once, so the
 * per-axis weights multiply.
 */
export function blendCoverageAt(
  u: number,
  v: number,
  settings: OutputBlendSettings,
): number {
  const { edges, curve } = settings;
  let coverage = 1;
  if (edges.left > 0 && u < edges.left) {
    coverage *= blendWeight(u / edges.left, curve);
  }
  if (edges.right > 0 && u > 1 - edges.right) {
    coverage *= blendWeight((1 - u) / edges.right, curve);
  }
  if (edges.bottom > 0 && v < edges.bottom) {
    coverage *= blendWeight(v / edges.bottom, curve);
  }
  if (edges.top > 0 && v > 1 - edges.top) {
    coverage *= blendWeight((1 - v) / edges.top, curve);
  }
  return clamp(coverage, 0, 1);
}

/**
 * Signal-domain alpha for one output pixel: the gamma-encoded blend
 * coverage, trimmed by the output brightness.
 */
export function blendAlphaAt(
  u: number,
  v: number,
  settings: OutputBlendSettings,
): number {
  const coverage = blendCoverageAt(u, v, settings);
  const encoded = encodeBlendWeight(coverage, settings.gamma);
  return clamp(encoded * clamp(settings.brightness, 0, 1), 0, 1);
}

// ═══════════════════════════════════════════════════════════════
// Seam verification
// ═══════════════════════════════════════════════════════════════

export interface SeamReport {
  /** Largest absolute deviation from unit light across the overlap. */
  maxError: number;
  /** Mean absolute deviation across the sampled band. */
  meanError: number;
  samples: number;
}

/**
 * Measures how closely two opposing ramps sum to one screen of light.
 *
 * `left` fades out across the band while `right` fades in. Both are
 * evaluated in linear light, because adding encoded values would be
 * physically meaningless.
 */
export function seamCoverage(
  left: OutputBlendSettings,
  right: OutputBlendSettings,
  samples = 64,
): SeamReport {
  const count = Math.max(2, Math.floor(samples));
  let maxError = 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const position = index / (count - 1);
    const fading = blendWeight(1 - position, left.curve);
    const rising = blendWeight(position, right.curve);
    const error = Math.abs(fading + rising - 1);
    maxError = Math.max(maxError, error);
    total += error;
  }
  return { maxError, meanError: total / count, samples: count };
}

export interface BlackLevelReport {
  /** Black floor of one projector, as a fraction of its peak white. */
  projectorBlack: number;
  /** Black inside the overlap, where both projectors still emit. */
  overlapBlack: number;
  /** Lift that would make the non-overlap region match the overlap. */
  requiredLift: number;
  /** Static contrast ratio before any lift. */
  contrastBefore: number;
  /** Static contrast ratio after lifting, which is always lower. */
  contrastAfter: number;
  /** True when no blend curve can hide the overlap's raised floor. */
  visibleWithoutLift: boolean;
}

/**
 * Quantifies the black-level limitation of overlap blending.
 *
 * A blend curve scales light *down*, so it can never remove the light a
 * projector emits for black. Inside an overlap two black floors add, making
 * that band brighter than the rest of the image. The only mitigation is to
 * raise black everywhere else to match, which costs contrast. This function
 * reports that trade rather than implying it has been solved.
 *
 * `justNoticeable` is the relative difference a viewer is assumed to catch;
 * it is a reporting threshold, not a measured perceptual result.
 */
export function blackLevelReport(
  projectorBlack: number,
  justNoticeable = 0.01,
): BlackLevelReport {
  const black = clamp(finite(projectorBlack) ? projectorBlack : 0, 0, 1);
  const overlapBlack = clamp(black * 2, 0, 1);
  const requiredLift = overlapBlack - black;
  return {
    projectorBlack: black,
    overlapBlack,
    requiredLift,
    contrastBefore: black > 0 ? 1 / black : Number.POSITIVE_INFINITY,
    contrastAfter: overlapBlack > 0 ? 1 / overlapBlack : Number.POSITIVE_INFINITY,
    visibleWithoutLift: requiredLift > justNoticeable,
  };
}

/**
 * Applies the operator's black-level lift to a signal value. Lifting
 * compresses the range into `[lift, 1]`, which is the contrast cost.
 */
export function applyBlackLevelLift(signal: number, lift: number): number {
  const value = clamp(finite(signal) ? signal : 0, 0, 1);
  const floor = clamp(finite(lift) ? lift : 0, 0, 1);
  return floor + value * (1 - floor);
}

// ═══════════════════════════════════════════════════════════════
// Canvas application
// ═══════════════════════════════════════════════════════════════

export interface BlendGradientStop {
  /** Position along the edge's axis, 0 at the outer border. */
  offset: number;
  /** Gamma-encoded signal weight at that position. */
  alpha: number;
}

/**
 * Sampled stops describing one edge's ramp in the signal domain.
 *
 * Encoding is a power function, so encoding each edge separately and
 * multiplying them is identical to multiplying the linear weights and
 * encoding once: `enc(a)*enc(b) = (a*b)^(1/gamma) = enc(a*b)`. That is what
 * lets the four edges be applied as four independent gradient passes while
 * still producing the correct product at a corner.
 */
export function blendGradientStops(
  edge: BlendEdge,
  settings: OutputBlendSettings,
  steps = 16,
): BlendGradientStop[] {
  const width = settings.edges[edge];
  if (!finite(width) || width <= 0) {
    return [];
  }
  const count = Math.max(2, Math.floor(steps));
  const stops: BlendGradientStop[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    stops.push({
      offset: t * width,
      alpha: encodeBlendWeight(blendWeight(t, settings.curve), settings.gamma),
    });
  }
  return stops;
}

type BlendContext = {
  save: () => void;
  restore: () => void;
  setTransform: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ) => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => {
    addColorStop: (offset: number, color: string) => void;
  };
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalCompositeOperation: GlobalCompositeOperation;
  globalAlpha: number;
};

/** Gradient endpoints for one edge, in destination pixels. */
function edgeAxis(
  edge: BlendEdge,
  width: number,
  height: number,
): [number, number, number, number] {
  // Screen space is y-down, so the top edge starts at y = 0.
  switch (edge) {
    case 'left':
      return [0, 0, width, 0];
    case 'right':
      return [width, 0, 0, 0];
    case 'top':
      return [0, 0, 0, height];
    case 'bottom':
      return [0, height, 0, 0];
  }
}

/**
 * Multiplies a composed output by its edge-blend ramps.
 *
 * Each active edge is one `destination-in` gradient pass, so the passes
 * multiply, and the uniform brightness trim is applied once at the end.
 * Returns the number of passes applied.
 */
export function applyEdgeBlend(
  context: BlendContext,
  settings: OutputBlendSettings,
  size: { width: number; height: number },
): number {
  let passes = 0;
  for (const edge of BLEND_EDGES) {
    const stops = blendGradientStops(edge, settings);
    if (stops.length === 0) {
      continue;
    }
    const [x0, y0, x1, y1] = edgeAxis(edge, size.width, size.height);
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    for (const stop of stops) {
      gradient.addColorStop(
        clamp(stop.offset, 0, 1),
        `rgba(255,255,255,${stop.alpha})`,
      );
    }
    // Everything past the band stays at full brightness.
    gradient.addColorStop(1, 'rgba(255,255,255,1)');
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = gradient;
    context.fillRect(0, 0, size.width, size.height);
    context.restore();
    passes += 1;
  }

  const brightness = clamp(settings.brightness, 0, 1);
  if (brightness < 1) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = brightness;
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = 'rgba(255,255,255,1)';
    context.fillRect(0, 0, size.width, size.height);
    context.restore();
    passes += 1;
  }
  return passes;
}

// ═══════════════════════════════════════════════════════════════
// Calibration patterns
// ═══════════════════════════════════════════════════════════════

export type CalibrationPattern = 'grid' | 'blend-edges' | 'flat-field';

export interface CalibrationLine {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** `blend` marks an overlap boundary; `grid` is alignment reference. */
  role: 'grid' | 'blend' | 'border';
}

export interface CalibrationField {
  /** Uniform signal level, for spotting a seam against a flat wall. */
  level: number;
}

export interface CalibrationPatternData {
  pattern: CalibrationPattern;
  lines: readonly CalibrationLine[];
  field: CalibrationField | null;
}

/**
 * Builds a declarative calibration pattern in normalized output space.
 * Returning data rather than drawing keeps the pattern testable and lets
 * the editor and any output surface render it the same way.
 */
export function calibrationPattern(
  pattern: CalibrationPattern,
  settings: OutputBlendSettings,
  divisions = 8,
): CalibrationPatternData {
  const lines: CalibrationLine[] = [];
  const steps = Math.max(2, Math.floor(divisions));

  if (pattern === 'grid') {
    for (let index = 1; index < steps; index += 1) {
      const position = index / steps;
      lines.push({ u0: position, v0: 0, u1: position, v1: 1, role: 'grid' });
      lines.push({ u0: 0, v0: position, u1: 1, v1: position, role: 'grid' });
    }
  }

  if (pattern === 'grid' || pattern === 'blend-edges') {
    lines.push(
      { u0: 0, v0: 0, u1: 1, v1: 0, role: 'border' },
      { u0: 1, v0: 0, u1: 1, v1: 1, role: 'border' },
      { u0: 1, v0: 1, u1: 0, v1: 1, role: 'border' },
      { u0: 0, v0: 1, u1: 0, v1: 0, role: 'border' },
    );
  }

  if (pattern === 'blend-edges') {
    // One line per active overlap, marking where full brightness begins.
    if (settings.edges.left > 0) {
      const u = settings.edges.left;
      lines.push({ u0: u, v0: 0, u1: u, v1: 1, role: 'blend' });
    }
    if (settings.edges.right > 0) {
      const u = 1 - settings.edges.right;
      lines.push({ u0: u, v0: 0, u1: u, v1: 1, role: 'blend' });
    }
    if (settings.edges.bottom > 0) {
      const v = settings.edges.bottom;
      lines.push({ u0: 0, v0: v, u1: 1, v1: v, role: 'blend' });
    }
    if (settings.edges.top > 0) {
      const v = 1 - settings.edges.top;
      lines.push({ u0: 0, v0: v, u1: 1, v1: v, role: 'blend' });
    }
  }

  return {
    pattern,
    lines,
    field: pattern === 'flat-field' ? { level: 0.5 } : null,
  };
}
