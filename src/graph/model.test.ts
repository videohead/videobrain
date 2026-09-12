import { describe, expect, it } from 'vitest';
import {
  GRAPH_SCHEMA_VERSION,
  GraphDocumentError,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_IDENTIFIER_LENGTH,
  MAX_GRAPH_JSON_BYTES,
  MAX_GRAPH_NODES,
  cloneGraphDocument,
  createDefaultGraph,
  createGraphNode,
  parseGraphDocument,
  serializeGraphDocument,
  type GraphDocument,
} from './index';

describe('graph document model', () => {
  it('creates nodes with independent default parameters', () => {
    const first = createGraphNode('warp', { x: 10, y: 20 }, {}, 'first');
    const second = createGraphNode('warp', { x: 30, y: 40 }, {}, 'second');

    expect(first.params).toMatchObject({
      amount: 0.22,
      frequency: 5,
      speed: 0.2,
    });
    first.params.amount = 0.75;
    expect(second.params.amount).toBe(0.22);
  });

  it('allows explicit parameters to override defaults', () => {
    const node = createGraphNode(
      'blend',
      { x: 0, y: 0 },
      { mix: 0.8, mode: 'multiply' },
      'blend',
    );

    expect(node.params).toMatchObject({ mix: 0.8, mode: 'multiply' });
  });

  it('fills omitted parameters from the registered defaults', () => {
    const document = parseGraphDocument({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        {
          id: 'partial',
          kind: 'time',
          position: { x: 0, y: 0 },
          params: { speed: 2 },
        },
      ],
      edges: [],
    });

    expect(document.nodes[0]?.params).toEqual({ speed: 2, offset: 0 });
  });

  it('rejects unknown, mistyped, out-of-range, and invalid select parameters', () => {
    const graph = createDefaultGraph();
    const field = graph.nodes.find(({ id }) => id === 'field');
    const blend = graph.nodes.find(({ id }) => id === 'blend');
    expect(field).toBeDefined();
    expect(blend).toBeDefined();
    if (!field || !blend) {
      throw new Error('Fixture nodes are missing.');
    }

    field.params.unknown = 1;
    expect(() => parseGraphDocument(graph)).toThrow(/unknown is not supported/);
    delete field.params.unknown;

    field.params.scale = 'large';
    expect(() => parseGraphDocument(graph)).toThrow(/scale must be a finite number/);
    field.params.scale = 15;
    expect(() => parseGraphDocument(graph)).toThrow(/between 1 and 14/);
    field.params.scale = 5;

    blend.params.mode = 'unsupported';
    expect(() => parseGraphDocument(graph)).toThrow(/must be one of/);
  });

  it('accepts bounded text parameters and rejects invalid prompt values', () => {
    const prompt = createGraphNode(
      'aiPrompt',
      { x: 0, y: 0 },
      { text: 'x'.repeat(4_000), negative: '' },
      'prompt',
    );
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [prompt],
      edges: [],
    };

    expect(parseGraphDocument(document).nodes[0]?.params).toMatchObject({
      text: 'x'.repeat(4_000),
      negative: '',
    });

    prompt.params.text = 'x'.repeat(4_001);
    expect(() => parseGraphDocument(document)).toThrow(
      /text must be at most 4000 characters/,
    );

    prompt.params.text = 42;
    expect(() => parseGraphDocument(document)).toThrow(/text must be text/);
  });

  it('rejects unsupported document fields and overlong identifiers', () => {
    const graph = createDefaultGraph() as GraphDocument & {
      extra?: boolean;
    };
    graph.extra = true;
    expect(() => parseGraphDocument(graph)).toThrow(/extra is not supported/);
    delete graph.extra;

    const first = graph.nodes[0];
    expect(first).toBeDefined();
    if (!first) {
      throw new Error('The default graph is unexpectedly empty.');
    }
    first.id = 'x'.repeat(MAX_GRAPH_IDENTIFIER_LENGTH + 1);
    expect(() => parseGraphDocument(graph)).toThrow(/at most/);
  });

  it('round-trips a project through stable JSON', () => {
    const graph = createDefaultGraph();
    const serialized = serializeGraphDocument(graph);
    const parsed = parseGraphDocument(serialized);

    expect(parsed).toEqual(graph);
    expect(parsed).not.toBe(graph);
  });

  it('deep-clones mutable graph records', () => {
    const graph = createDefaultGraph();
    const cloned = cloneGraphDocument(graph);

    const clonedNode = cloned.nodes[0];
    const originalNode = graph.nodes[0];
    const clonedEdge = cloned.edges[0];
    const originalEdge = graph.edges[0];
    expect(clonedNode).toBeDefined();
    expect(originalNode).toBeDefined();
    expect(clonedEdge).toBeDefined();
    expect(originalEdge).toBeDefined();
    if (!clonedNode || !originalNode || !clonedEdge || !originalEdge) {
      throw new Error('The default graph is unexpectedly empty.');
    }

    clonedNode.position.x = 999;
    clonedNode.params.speed = 99;
    clonedEdge.source.nodeId = 'changed';

    expect(originalNode.position.x).not.toBe(999);
    expect(originalNode.params.speed).not.toBe(99);
    expect(originalEdge.source.nodeId).not.toBe('changed');
  });

  it('rejects unsupported schema versions', () => {
    const incompatible = {
      ...createDefaultGraph(),
      schemaVersion: GRAPH_SCHEMA_VERSION + 1,
    };

    expect(() => parseGraphDocument(incompatible)).toThrow(
      /Unsupported schema version/,
    );
  });

  it('rejects JSON, node, and edge counts over their hard limits', () => {
    expect(() =>
      parseGraphDocument(' '.repeat(MAX_GRAPH_JSON_BYTES + 1)),
    ).toThrow(/byte limit/);
    expect(() =>
      parseGraphDocument('é'.repeat(Math.floor(MAX_GRAPH_JSON_BYTES / 2) + 1)),
    ).toThrow(/byte limit/);

    const nodes = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, index) =>
      createGraphNode('time', { x: index, y: 0 }, {}, `node-${index}`),
    );
    expect(() =>
      parseGraphDocument({
        schemaVersion: GRAPH_SCHEMA_VERSION,
        nodes,
        edges: [],
      }),
    ).toThrow(/node limit/);

    const edges = Array.from({ length: MAX_GRAPH_EDGES + 1 }, (_, index) => ({
      id: `edge-${index}`,
      source: { nodeId: 'source', portId: 'frame' },
      target: { nodeId: 'target', portId: 'source' },
    }));
    expect(() =>
      parseGraphDocument({
        schemaVersion: GRAPH_SCHEMA_VERSION,
        nodes: [],
        edges,
      }),
    ).toThrow(/edge limit/);
  });

  it('rejects malformed positions and parameter values', () => {
    const malformed: {
      schemaVersion: number;
      nodes: Array<{
        id: string;
        kind: string;
        position: { x: number; y: number };
        params: Record<string, unknown>;
      }>;
      edges: unknown[];
    } = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        {
          id: 'bad',
          kind: 'time',
          position: { x: Number.NaN, y: 0 },
          params: {},
        },
      ],
      edges: [],
    };

    expect(() => parseGraphDocument(malformed)).toThrow(GraphDocumentError);

    malformed.nodes[0] = {
      id: 'bad',
      kind: 'time',
      position: { x: 0, y: 0 },
      params: { speed: Number.POSITIVE_INFINITY },
    };
    expect(() => parseGraphDocument(malformed)).toThrow(/finite number/);
  });

  it('rejects unknown node kinds and duplicate IDs', () => {
    const graph = createDefaultGraph();
    const unknown = cloneGraphDocument(graph) as unknown as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
      edges: unknown[];
    };
    const firstNode = unknown.nodes[0];
    expect(firstNode).toBeDefined();
    if (!firstNode) {
      throw new Error('The default graph is unexpectedly empty.');
    }
    firstNode.kind = 'missing-kind';
    expect(() => parseGraphDocument(unknown)).toThrow(/registered node kind/);

    const duplicate = cloneGraphDocument(graph);
    const first = duplicate.nodes[0];
    const second = duplicate.nodes[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) {
      throw new Error('The default graph has too few nodes.');
    }
    second.id = first.id;
    expect(() => parseGraphDocument(duplicate)).toThrow(/duplicate id/);
  });

  it('does not share data between fresh default projects', () => {
    const first: GraphDocument = createDefaultGraph();
    const second: GraphDocument = createDefaultGraph();
    const firstNode = first.nodes[0];
    const secondNode = second.nodes[0];
    expect(firstNode).toBeDefined();
    expect(secondNode).toBeDefined();
    if (!firstNode || !secondNode) {
      throw new Error('The default graph is unexpectedly empty.');
    }

    firstNode.params.speed = -2;
    expect(secondNode.params.speed).not.toBe(-2);
  });
});
