import { describe, expect, it } from 'vitest';
import { EVENT_DEFINITIONS } from './eventOperators';
import { compileGraph, createGraphNode, GRAPH_SCHEMA_VERSION, parseGraphDocument, serializeGraphDocument, type GraphDocument } from './index';

describe('event node contracts', () => {
  it.each(EVENT_DEFINITIONS)('round-trips $kind and rejects invalid parameters', ({ kind, params }) => {
    const node = createGraphNode(kind, { x: 0, y: 0 });
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [node], edges: [] };
    expect(parseGraphDocument(serializeGraphDocument(document))).toEqual(document);
    for (const [id, parameter] of Object.entries(params)) {
      const value = parameter.type === 'number' ? parameter.max + 1 : parameter.type === 'boolean' ? 1 : 'invalid';
      expect(() => parseGraphDocument({ ...document, nodes: [{ ...node, params: { ...node.params, [id]: value } }] })).toThrow();
    }
  });
  it('rejects implicit event/scalar and boolean/scalar conversions', () => {
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [createGraphNode('trigger', { x: 0, y: 0 }, {}, 'trigger'), createGraphNode('constant', { x: 0, y: 0 }, {}, 'value'), createGraphNode('math', { x: 0, y: 0 }, {}, 'math')],
      edges: [{ id: 'bad', source: { nodeId: 'trigger', portId: 'event' }, target: { nodeId: 'math', portId: 'a' } }],
    };
    expect(() => compileGraph(document)).toThrow('event.trigger');
    document.edges = [{ id: 'bad', source: { nodeId: 'value', portId: 'value' }, target: { nodeId: 'trigger', portId: 'value' } }];
    expect(() => compileGraph(document)).toThrow('control.bool');
  });
});