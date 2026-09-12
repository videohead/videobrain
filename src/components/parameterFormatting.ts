export function formatParameterNumber(value: number, step: number): string {
  if (Math.abs(step) >= 1) {
    return value.toFixed(0);
  }
  if (Math.abs(step) >= 0.1) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}
