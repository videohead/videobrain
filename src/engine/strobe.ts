export const MAX_INTERNAL_STROBE_RATE = 3;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeStrobePhase(position: number): number {
  const safePosition = finiteOr(position, 0);
  return safePosition - Math.floor(safePosition);
}

export function evaluateInternalStrobePhase(
  time: number,
  rate: number,
): number {
  const safeRate = clamp(finiteOr(rate, 1), 0, MAX_INTERNAL_STROBE_RATE);
  const cycle = finiteOr(time, 0) * safeRate;
  return normalizeStrobePhase(cycle);
}
