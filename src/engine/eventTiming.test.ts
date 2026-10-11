import { describe, expect, it } from 'vitest';
import { advanceTransition, dueCues, orderedEvents, parseSchedule, seededValue, startTransition, transitionState } from './eventTiming';

describe('event timing contracts', () => {
  it('sorts equal-time events by sequence/id and deduplicates identities', () => {
    const first = { id: 'first', time: 1, sequence: 0 };
    expect(orderedEvents([{ id: 'last', time: 1, sequence: 2 }, first, first]).map(({ id }) => id)).toEqual(['first', 'last']);
    expect(() => orderedEvents([{ ...first, time: NaN }])).toThrow();
  });
  it('supports zero duration and exactly one completion', () => {
    const state = transitionState(0);
    startTransition(state, 1, 0, 'restart');
    expect(advanceTransition(state, 0, 'linear')).toBe(true);
    expect(state.value).toBe(1);
    expect(advanceTransition(state, 0, 'linear')).toBe(false);
  });
  it('restarts smoothly from current value, ignores retriggers, and reverses', () => {
    const state = transitionState(0);
    startTransition(state, 1, 2, 'restart');
    advanceTransition(state, 1, 'linear');
    expect(state.value).toBe(0.5);
    expect(startTransition(state, 0, 1, 'ignore')).toBe(false);
    startTransition(state, 0, 1, 'restart');
    advanceTransition(state, 0.5, 'linear');
    expect(state.value).toBe(0.25);
    advanceTransition(state, 0.5, 'linear');
    expect(state.value).toBe(0);
  });
  it('validates schedules and bounds late-event replay while preserving final value', () => {
    const cues = parseSchedule(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ id: `cue${index}`, at: index, value: index }))));
    const due = dueCues(cues, -1, 10);
    expect(due.cues).toHaveLength(64);
    expect(due.dropped).toBe(36);
    expect(due.value).toBe(99);
    expect(dueCues(cues, 10, 10).cues).toHaveLength(0);
    expect(() => parseSchedule('[{"id":"a","at":0,"value":0},{"id":"a","at":1,"value":1}]')).toThrow();
  });
  it('generates repeatable bounded random values', () => {
    expect(seededValue(42, 5)).toBe(seededValue(42, 5));
    expect(seededValue(42, 5)).not.toBe(seededValue(42, 6));
    expect(seededValue(42, 5)).toBeGreaterThanOrEqual(0);
    expect(seededValue(42, 5)).toBeLessThan(1);
  });
});