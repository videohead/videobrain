import { describe, expect, it } from 'vitest';
import { LiquidSimulation } from './LiquidSimulation';

const parameters = { count: 12, seed: 42, radius: 0.04, attraction: 1, pointerX: 0.8, pointerY: 0.3 };
describe('liquid particle physics', () => {
  it('advances actual bodies, holds on pause, and resets deterministically', () => {
    const simulation = new LiquidSimulation();
    const initial = simulation.update(0, parameters);
    const moved = simulation.update(0.1, parameters);
    expect(moved).not.toEqual(initial);
    expect(simulation.update(0.1, parameters)).toEqual(moved);
    expect(simulation.update(0, parameters)).toEqual(initial);
    simulation.reset();
    expect(simulation.update(0, parameters)).toEqual(initial);
  });
  it('bounds suspended-tab catchup and responds to pointer forces', () => {
    const first = new LiquidSimulation();
    const second = new LiquidSimulation();
    const initial = first.update(0, parameters);
    second.update(0, parameters);
    expect(first.update(0.2, parameters)).not.toEqual(second.update(0.2, { ...parameters, pointerX: 0.1 }));
    expect(first.update(10, parameters)).toEqual(initial);
    expect(Array.from(first.update(10.1, parameters)).every(Number.isFinite)).toBe(true);
  });
});