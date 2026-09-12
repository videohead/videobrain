export type AutoSelectorOrder = 'forward' | 'reverse' | 'shuffleBag';

export interface AutoSelectorSample {
  index: number;
  phase: number;
  step: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function seedForBag(seed: number, bag: number): number {
  let value =
    (Math.round(seed) & 0xffff) ^
    Math.imul((Math.trunc(bag) | 0) ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function shuffledBag(count: number, seed: number, bag: number): number[] {
  const values = Array.from({ length: count }, (_, index) => index);
  let state = seedForBag(seed, bag);
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  for (let index = count - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [
      values[swapIndex] as number,
      values[index] as number,
    ];
  }
  return values;
}

export function evaluateAutoSelector(
  position: number,
  interval: number,
  count: number,
  order: AutoSelectorOrder,
  seed: number,
): AutoSelectorSample {
  const safeInterval = clamp(finiteOr(interval, 1.5), 0.1, 60);
  const safeCount = Math.round(clamp(finiteOr(count, 4), 2, 4));
  const safeSeed = Math.round(clamp(finiteOr(seed, 23), 0, 65_535));
  const rawCycle = finiteOr(position, 0) / safeInterval;
  const cycle = finiteOr(rawCycle, 0);
  const step = Math.floor(cycle);
  const phase = cycle - step;

  if (order === 'shuffleBag') {
    const bag = Math.floor(step / safeCount);
    const slot = positiveModulo(step, safeCount);
    return {
      index: shuffledBag(safeCount, safeSeed, bag)[slot] as number,
      phase,
      step,
    };
  }

  return {
    index:
      order === 'reverse'
        ? safeCount - 1 - positiveModulo(step, safeCount)
        : positiveModulo(step, safeCount),
    phase,
    step,
  };
}
