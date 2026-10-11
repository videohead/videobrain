import { describe, expect, it } from 'vitest';
import { compileGraph, createGraphNode, GRAPH_SCHEMA_VERSION } from '../graph';
import { DataEvaluator } from './DataEvaluator';

describe('data evaluator', () => {
  it('evaluates literals and deterministic error fallbacks with cached results', () => {
    const plan = compileGraph({ schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [createGraphNode('jsonParse', { x: 0, y: 0 }, {}, 'parse'), createGraphNode('dataInspect', { x: 0, y: 0 }, {}, 'inspect')], edges: [{ id: 'wire', source: { nodeId: 'parse', portId: 'json' }, target: { nodeId: 'inspect', portId: 'json' } }] });
    const compiled = plan.controlNodes.find(({ node }) => node.id === 'parse')!;
    const evaluator = new DataEvaluator();
    const good = evaluator.evaluate(compiled, {});
    expect(good.json).toEqual({ title: 'VideoBrain', amount: 0.5 });
    expect(evaluator.evaluate(compiled, {})).toBe(good);
    expect(evaluator.evaluate(compiled, { text: '{' })).toMatchObject({ json: null, valid: 0 });
    expect(evaluator.evaluate(compiled, { text: '{' }).error).not.toBe('');
    expect(plan.visualPasses).toBe(0);
    expect(plan.reachableNodeIds.size).toBe(2);
  });
});