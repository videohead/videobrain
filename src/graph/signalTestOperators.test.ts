import { describe, expect, it } from 'vitest';
import { SIGNAL_TEST_DEFINITIONS } from './signalTestOperators';
import { compileGraph, createGraphNode, GRAPH_SCHEMA_VERSION, inspectGraph, parseGraphDocument, serializeGraphDocument, type GraphDocument } from './index';

describe('signal test contracts', () => {
  it.each(SIGNAL_TEST_DEFINITIONS)('$title is a typed zero-pass demand root', (definition) => {
    const node = createGraphNode(definition.kind, { x: 0, y: 0 }, {}, 'monitor');
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [node], edges: [] };
    const plan = compileGraph(document);
    expect(plan.reachableNodeIds.has('monitor')).toBe(true);
    expect(plan.visualPasses).toBe(0);
    expect(plan.renderTargets).toBe(0);
    expect(definition.inputs[0]?.type).toBe(definition.outputs[0]?.type);
    expect(inspectGraph(document).signalTestNodeIds).toEqual(['monitor']);
    expect(parseGraphDocument(serializeGraphDocument(document))).toEqual(document);
  });
  it('cooks a Math and Smooth chain without Display and rejects implicit conversions', () => {
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [createGraphNode('math', { x: 0, y: 0 }, {}, 'math'), createGraphNode('smooth', { x: 0, y: 0 }, {}, 'smooth'), createGraphNode('signalNumber', { x: 0, y: 0 }, {}, 'monitor')],
      edges: [
        { id: 'math', source: { nodeId: 'math', portId: 'value' }, target: { nodeId: 'smooth', portId: 'value' } },
        { id: 'smooth', source: { nodeId: 'smooth', portId: 'value' }, target: { nodeId: 'monitor', portId: 'value' } },
      ],
    };
    expect(compileGraph(document).controlNodes.map(({ node }) => node.id)).toEqual(['math', 'smooth', 'monitor']);
    document.nodes[2] = createGraphNode('signalBang', { x: 0, y: 0 }, {}, 'monitor');
    expect(() => compileGraph(document)).toThrow('event.trigger');
  });
});