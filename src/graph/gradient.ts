import type { GraphParams } from './types';

export const GRADIENT_STOP_IDS = Array.from({ length: 8 }, (_, index) => `stop${index + 1}`);

export function getGradientStops(params: GraphParams) {
  const count = Math.max(2, Math.min(8, Math.round(Number(params.stopCount) || 2)));
  return GRADIENT_STOP_IDS.slice(0, count).map((id) => ({
    id,
    position: Number(params[`${id}Position`]),
    red: Number(params[`${id}Red`]),
    green: Number(params[`${id}Green`]),
    blue: Number(params[`${id}Blue`]),
    alpha: Number(params[`${id}Alpha`]),
  })).sort((first, second) => first.position - second.position);
}