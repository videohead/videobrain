import { describe, expect, it } from 'vitest';
import { createGraphNode, getOperatorDefinition, type CompiledNode } from '../graph';
import { EventEvaluator } from './EventEvaluator';
const compiled = (kind: CompiledNode['node']['kind'], params = {}): CompiledNode => ({ node: createGraphNode(kind, { x: 0, y: 0 }, params, 'node'), definition: getOperatorDefinition(kind), inputs: {} });
const event = (id: string, time: number) => [{ id, time, sequence: 0 }];

describe('typed event evaluation', () => {
  it('seeds boolean edges and consumes repeated event identities only once', () => {
    const evaluator = new EventEvaluator();
    const trigger = compiled('trigger');
    expect(evaluator.evaluate(trigger, { value: true }, 0).event).toEqual([]);
    evaluator.evaluate(trigger, { value: false }, 0);
    expect(evaluator.evaluate(trigger, { value: true }, 0).event).toHaveLength(1);
    expect(evaluator.evaluate(trigger, { value: true }, 0).event).toHaveLength(0);
    const counter = { ...compiled('counter'), node: createGraphNode('counter', { x: 0, y: 0 }, {}, 'counter') };
    expect(evaluator.evaluate(counter, { increment: event('a', 0) }, 0).value).toBe(1);
    expect(evaluator.evaluate(counter, { increment: event('a', 0) }, 0).value).toBe(1);
    expect(evaluator.evaluate(counter, { increment: event('b', 0), reset: event('c', 0) }, 0).value).toBe(0);
  });
  it('samples transitions at event time, freezes while paused, and resets on rewind', () => {
    const evaluator = new EventEvaluator(); const node = compiled('timedTransition', { duration: 2, curve: 'linear' });
    evaluator.evaluate(node, { start: event('go', 0) }, 0);
    expect(evaluator.evaluate(node, {}, 1).value).toBe(0.5);
    expect(evaluator.evaluate(node, { paused: true }, 2).value).toBe(0.5);
    expect(evaluator.evaluate(node, { reverse: event('back', 2) }, 3).value).toBe(0.25);
    expect(evaluator.evaluate(node, {}, 0).value).toBe(0);
  });
  it('completes zero-duration timers once and bounds repeat catchup', () => {
    const evaluator = new EventEvaluator(); const node = compiled('timer', { duration: 0 });
    expect(evaluator.evaluate(node, { start: event('go', 0) }, 0).done).toHaveLength(1);
    expect(evaluator.evaluate(node, { start: event('go', 0) }, 0).done).toHaveLength(0);
    const repeated = compiled('timer', { duration: 0.1, repeat: true }); evaluator.clear();
    evaluator.evaluate(repeated, { start: event('go', 0) }, 0);
    expect(evaluator.evaluate(repeated, {}, 100)).toMatchObject({ dropped: 936, active: true });
  });
  it('runs envelope stages across large ticks and deterministic sequence phases', () => {
    const evaluator = new EventEvaluator(); const envelope = compiled('envelope');
    evaluator.evaluate(envelope, { start: event('go', 0) }, 0);
    expect(evaluator.evaluate(envelope, {}, 2)).toMatchObject({ value: 0, active: false });
    evaluator.clear(); const sequence = compiled('stepSequencer', { mode: 'beats', bpm: 60 });
    evaluator.evaluate(sequence, {}, 0);
    expect(evaluator.evaluate(sequence, {}, 0.5).phase).toBe(0.5);
    sequence.node.params.bpm = 120;
    expect(evaluator.evaluate(sequence, {}, 0.75)).toMatchObject({ index: 1, phase: 0 });
  });
  it('schedules equal-time cues deterministically and resumes from live override', () => {
    const evaluator = new EventEvaluator(); const node = compiled('cueScheduler', { cues: '[{"id":"a","at":0,"value":1},{"id":"b","at":0,"value":2},{"id":"c","at":1000,"value":3}]' });
    expect(evaluator.evaluate(node, {}, 0)).toMatchObject({ value: 2 });
    expect(evaluator.evaluate(node, { overrideEnabled: true, override: 8 }, 1).value).toBe(8);
    expect(evaluator.evaluate(node, {}, 1).value).toBe(3);
    expect(evaluator.evaluate(node, {}, 1).cue).toHaveLength(0);
  });
});