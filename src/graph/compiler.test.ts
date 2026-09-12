import { describe, expect, it } from 'vitest';
import {
  GRAPH_SCHEMA_VERSION,
  GraphCompileError,
  MAX_GPU_RENDER_TARGETS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_REACHABLE_FRAME_NODES,
  compileGraph,
  createDefaultGraph,
  createGraphNode,
  tryCompileGraph,
  validateConnection,
  type GraphDocument,
  type GraphEdge,
  type GraphEndpoint,
  type NodeKind,
} from './index';

const position = { x: 0, y: 0 };

function node(kind: NodeKind, id: string) {
  return createGraphNode(kind, position, {}, id);
}

function edge(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): GraphEdge {
  return {
    id,
    source: { nodeId: sourceNodeId, portId: sourcePortId },
    target: { nodeId: targetNodeId, portId: targetPortId },
  };
}

function graph(
  nodes: GraphDocument['nodes'],
  edges: GraphDocument['edges'],
): GraphDocument {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges };
}

function issueCodes(document: GraphDocument): string[] {
  const result = tryCompileGraph(document);
  if (result.ok) {
    throw new Error('Expected graph compilation to fail.');
  }
  return result.issues.map(({ code }) => code);
}

describe('graph compiler', () => {
  it('compiles the permission-free default graph end to end', () => {
    const compiled = compileGraph(createDefaultGraph());

    expect(compiled.nodes).toHaveLength(15);
    expect(compiled.controlNodes.map(({ node: item }) => item.kind)).toEqual([
      'audioLevel',
      'time',
      'beatClock',
      'xyPad',
      'pointer',
      'aiPrompt',
      'oscillator',
    ]);
    expect(compiled.frameNodes.map(({ node: item }) => item.kind)).toEqual([
      'cells',
      'plasma',
      'warp',
      'blend',
      'trails',
      'colorGrade',
      'videoModel',
    ]);
    expect(compiled.displayNodes.map(({ node: item }) => item.id)).toEqual([
      'display',
    ]);
    expect(compiled.nodes.some(({ node: item }) => item.kind === 'audioLevel')).toBe(
      true,
    );
    expect(compiled.document.nodes).toHaveLength(15);
    expect(compiled.reachableNodeIds.has('pointer')).toBe(true);
    expect(compiled.reachableNodeIds.has('prompt')).toBe(true);
    expect(compiled.reachableNodeIds.has('beat')).toBe(true);
    expect(compiled.visualPasses).toBe(8);
    expect(compiled.renderTargets).toBe(8);
  });

  it('binds text instructions to a model without mixing signal types', () => {
    const document = graph(
      [
        node('aiPrompt', 'chat'),
        node('videoModel', 'model'),
        node('display', 'display'),
      ],
      [
        edge('chat-model', 'chat', 'prompt', 'model', 'prompt'),
        edge('model-display', 'model', 'frame', 'display', 'source'),
      ],
    );
    const compiled = compileGraph(document);
    const model = compiled.nodes.find(({ node: item }) => item.id === 'model');

    expect(compiled.controlNodes.map(({ node: item }) => item.id)).toEqual([
      'chat',
    ]);
    expect(compiled.frameNodes.map(({ node: item }) => item.id)).toEqual([
      'model',
    ]);
    expect(model?.inputs.prompt).toEqual({
      edgeId: 'chat-model',
      sourceNodeId: 'chat',
      sourcePortId: 'prompt',
      type: 'text.utf8',
    });
    expect(
      validateConnection(
        graph(document.nodes, [document.edges[1] as GraphEdge]),
        { nodeId: 'chat', portId: 'prompt' },
        { nodeId: 'model', portId: 'prompt' },
      ),
    ).toEqual({ valid: true });
  });

  it('routes File audio blocks to an Audio Output root', () => {
    const document = graph(
      [node('file', 'file'), node('audioOutput', 'audio-output')],
      [edge('file-audio', 'file', 'audio', 'audio-output', 'audio')],
    );
    const compiled = compileGraph(document);

    expect(compiled.audioNodes.map(({ node: item }) => item.kind)).toEqual([
      'audioOutput',
    ]);
    expect(compiled.audioOutputNodes.map(({ node: item }) => item.id)).toEqual([
      'audio-output',
    ]);
    expect(compiled.reachableNodeIds).toEqual(new Set(['file', 'audio-output']));
  });

  it('rejects frame-to-audio connections', () => {
    const document = graph(
      [node('file', 'file'), node('audioOutput', 'audio-output')],
      [edge('file-frame', 'file', 'frame', 'audio-output', 'audio')],
    );

    expect(issueCodes(document)).toContain('port-type-mismatch');
  });

  it('binds both XY pad outputs to independent control inputs', () => {
    const compiled = compileGraph(
      graph(
        [
          node('xyPad', 'pad'),
          node('plasma', 'source'),
          node('colorGrade', 'grade'),
          node('display', 'display'),
        ],
        [
          edge('source-grade', 'source', 'frame', 'grade', 'source'),
          edge('pad-hue', 'pad', 'x', 'grade', 'hue'),
          edge('pad-exposure', 'pad', 'y', 'grade', 'exposure'),
          edge('grade-display', 'grade', 'frame', 'display', 'source'),
        ],
      ),
    );

    expect(compiled.controlNodes.map(({ node: item }) => item.id)).toEqual([
      'pad',
    ]);
    const grade = compiled.nodes.find(({ node: item }) => item.id === 'grade');
    expect(grade?.inputs.hue).toMatchObject({
      edgeId: 'pad-hue',
      sourceNodeId: 'pad',
      sourcePortId: 'x',
      type: 'control.f32',
    });
    expect(grade?.inputs.exposure).toMatchObject({
      edgeId: 'pad-exposure',
      sourceNodeId: 'pad',
      sourcePortId: 'y',
      type: 'control.f32',
    });
  });

  it('prunes nodes that cannot reach a display', () => {
    const document = createDefaultGraph();
    document.nodes.push(node('audioLevel', 'unused-audio'));
    document.nodes.push(node('plasma', 'unused-frame'));
    const compiled = compileGraph(document);

    expect(compiled.reachableNodeIds.has('unused-audio')).toBe(false);
    expect(compiled.reachableNodeIds.has('unused-frame')).toBe(false);
    expect(compiled.nodes.some(({ node: item }) => item.id === 'unused-frame')).toBe(
      false,
    );
  });

  it('returns an empty schedule when no display exists', () => {
    const compiled = compileGraph(
      graph([node('plasma', 'source'), node('warp', 'effect')], [
        edge('source-effect', 'source', 'frame', 'effect', 'source'),
      ]),
    );

    expect(compiled.nodes).toEqual([]);
    expect(compiled.reachableNodeIds.size).toBe(0);
  });

  it('uses a deterministic topological order independent of document order', () => {
    const nodes = [
      node('display', 'display'),
      node('blend', 'mix'),
      node('plasma', 'z-source'),
      node('cells', 'a-source'),
    ];
    const edges = [
      edge('a-mix', 'a-source', 'frame', 'mix', 'a'),
      edge('z-mix', 'z-source', 'frame', 'mix', 'b'),
      edge('mix-display', 'mix', 'frame', 'display', 'source'),
    ];

    const forward = compileGraph(graph(nodes, edges)).nodes.map(
      ({ node: item }) => item.id,
    );
    const reversed = compileGraph(
      graph([...nodes].reverse(), [...edges].reverse()),
    ).nodes.map(({ node: item }) => item.id);

    expect(forward).toEqual(['a-source', 'z-source', 'mix', 'display']);
    expect(reversed).toEqual(forward);
  });

  it('allows output fan-out while enforcing one edge per input', () => {
    const valid = graph(
      [
        node('time', 'clock'),
        node('plasma', 'first'),
        node('cells', 'second'),
        node('blend', 'blend'),
        node('display', 'display'),
      ],
      [
        edge('clock-first', 'clock', 'value', 'first', 'time'),
        edge('clock-second', 'clock', 'value', 'second', 'time'),
        edge('first-blend', 'first', 'frame', 'blend', 'a'),
        edge('second-blend', 'second', 'frame', 'blend', 'b'),
        edge('blend-display', 'blend', 'frame', 'display', 'source'),
      ],
    );
    expect(() => compileGraph(valid)).not.toThrow();

    valid.edges.push(
      edge('second-same-input', 'second', 'frame', 'blend', 'a'),
    );
    expect(issueCodes(valid)).toContain('input-occupied');
  });

  it('rejects control-to-frame and frame-to-control mismatches', () => {
    const controlIntoFrame = graph(
      [node('time', 'clock'), node('display', 'display')],
      [edge('bad', 'clock', 'value', 'display', 'source')],
    );
    expect(issueCodes(controlIntoFrame)).toContain('port-type-mismatch');

    const frameIntoControl = graph(
      [
        node('plasma', 'source'),
        node('oscillator', 'oscillator'),
        node('display', 'display'),
      ],
      [
        edge('bad', 'source', 'frame', 'oscillator', 'phase'),
        edge('source-display', 'source', 'frame', 'display', 'source'),
      ],
    );
    expect(issueCodes(frameIntoControl)).toContain('port-type-mismatch');

    const textIntoControl = graph(
      [
        node('aiPrompt', 'chat'),
        node('oscillator', 'oscillator'),
        node('plasma', 'source'),
        node('display', 'display'),
      ],
      [
        edge('bad-text', 'chat', 'prompt', 'oscillator', 'phase'),
        edge('source-display', 'source', 'frame', 'display', 'source'),
      ],
    );
    expect(issueCodes(textIntoControl)).toContain('port-type-mismatch');

    const controlIntoText = graph(
      [
        node('time', 'clock'),
        node('videoModel', 'model'),
        node('display', 'display'),
      ],
      [
        edge('bad-control', 'clock', 'value', 'model', 'prompt'),
        edge('model-display', 'model', 'frame', 'display', 'source'),
      ],
    );
    expect(issueCodes(controlIntoText)).toContain('port-type-mismatch');
  });

  it('reports missing nodes and ports without crashing', () => {
    const missingNodes = graph([node('display', 'display')], [
      edge('missing-source', 'absent', 'frame', 'display', 'source'),
      edge('missing-target', 'display', 'frame', 'absent', 'source'),
    ]);
    expect(issueCodes(missingNodes)).toEqual([
      'source-node-missing',
      'target-node-missing',
    ]);

    const missingPorts = graph(
      [node('plasma', 'source'), node('display', 'display')],
      [
        edge('missing-output', 'source', 'unknown', 'display', 'source'),
        edge('missing-input', 'source', 'frame', 'display', 'unknown'),
      ],
    );
    expect(issueCodes(missingPorts)).toEqual([
      'source-port-missing',
      'target-port-missing',
    ]);
  });

  it('rejects duplicate node and edge IDs', () => {
    const duplicateNodes = graph(
      [node('plasma', 'same'), node('display', 'same')],
      [],
    );
    expect(issueCodes(duplicateNodes)).toContain('duplicate-node-id');

    const duplicateEdges = graph(
      [
        node('plasma', 'source'),
        node('blend', 'blend'),
        node('display', 'display'),
      ],
      [
        edge('same', 'source', 'frame', 'blend', 'a'),
        edge('same', 'source', 'frame', 'blend', 'b'),
        edge('out', 'blend', 'frame', 'display', 'source'),
      ],
    );
    expect(issueCodes(duplicateEdges)).toContain('duplicate-edge-id');
  });

  it('rejects ordinary cycles, including edges around a stateful node', () => {
    const document = graph(
      [
        node('trails', 'trail'),
        node('warp', 'warp'),
        node('display', 'display'),
      ],
      [
        edge('trail-warp', 'trail', 'frame', 'warp', 'source'),
        edge('warp-trail', 'warp', 'frame', 'trail', 'source'),
        edge('trail-display', 'trail', 'frame', 'display', 'source'),
      ],
    );

    expect(() => compileGraph(document)).toThrow(GraphCompileError);
    expect(issueCodes(document)).toContain('cycle');
  });

  it('copies the document into the compiled plan', () => {
    const document = createDefaultGraph();
    const compiled = compileGraph(document);
    const source = document.nodes.find(({ id }) => id === 'field');
    const compiledSource = compiled.document.nodes.find(({ id }) => id === 'field');
    expect(source).toBeDefined();
    expect(compiledSource).toBeDefined();
    if (!source || !compiledSource) {
      throw new Error('Expected source node is missing.');
    }

    source.params.scale = 99;
    expect(compiledSource.params.scale).not.toBe(99);
  });

  it('rejects oversized in-memory documents before graph traversal', () => {
    const tooManyNodes = graph(
      Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, index) =>
        node('time', `node-${index}`),
      ),
      [],
    );
    expect(issueCodes(tooManyNodes)).toEqual(['node-limit']);

    const tooManyEdges = graph(
      [],
      Array.from({ length: MAX_GRAPH_EDGES + 1 }, (_, index) =>
        edge(`edge-${index}`, 'source', 'frame', 'target', 'source'),
      ),
    );
    expect(issueCodes(tooManyEdges)).toEqual(['edge-limit']);
  });

  it('caps reachable frame passes and offscreen frame allocations', () => {
    const passNodes = [node('plasma', 'pass-source')];
    const passEdges: GraphEdge[] = [];
    let previousId = 'pass-source';
    for (let index = 1; index < MAX_REACHABLE_FRAME_NODES + 1; index += 1) {
      const id = `pass-${index}`;
      passNodes.push(node('warp', id));
      passEdges.push(edge(`to-${id}`, previousId, 'frame', id, 'source'));
      previousId = id;
    }
    passNodes.push(node('display', 'pass-display'));
    passEdges.push(
      edge('pass-display-edge', previousId, 'frame', 'pass-display', 'source'),
    );
    expect(issueCodes(graph(passNodes, passEdges))).toEqual([
      'frame-pass-limit',
    ]);

    const resourceNodes = [node('plasma', 'resource-source')];
    const resourceEdges: GraphEdge[] = [];
    previousId = 'resource-source';
    const trailCount = Math.floor(MAX_GPU_RENDER_TARGETS / 2) + 1;
    for (let index = 0; index < trailCount; index += 1) {
      const id = `trail-${index}`;
      resourceNodes.push(node('trails', id));
      resourceEdges.push(
        edge(`to-${id}`, previousId, 'frame', id, 'source'),
      );
      previousId = id;
    }
    resourceNodes.push(node('display', 'resource-display'));
    resourceEdges.push(
      edge(
        'resource-display-edge',
        previousId,
        'frame',
        'resource-display',
        'source',
      ),
    );
    expect(issueCodes(graph(resourceNodes, resourceEdges))).toEqual([
      'gpu-resource-limit',
    ]);
  });
});

describe('connection validation', () => {
  const source: GraphEndpoint = { nodeId: 'source', portId: 'frame' };
  const target: GraphEndpoint = { nodeId: 'display', portId: 'source' };

  it('accepts a compatible unoccupied connection', () => {
    const document = graph(
      [node('plasma', 'source'), node('display', 'display')],
      [],
    );

    expect(validateConnection(document, source, target)).toEqual({ valid: true });
  });

  it('rejects missing endpoints, missing ports, and type mismatch', () => {
    const document = graph(
      [
        node('plasma', 'source'),
        node('time', 'clock'),
        node('display', 'display'),
      ],
      [],
    );

    expect(
      validateConnection(document, { nodeId: 'absent', portId: 'frame' }, target)
        .code,
    ).toBe('source-node-missing');
    expect(
      validateConnection(document, source, {
        nodeId: 'absent',
        portId: 'source',
      }).code,
    ).toBe('target-node-missing');
    expect(
      validateConnection(
        document,
        { nodeId: 'source', portId: 'absent' },
        target,
      ).code,
    ).toBe('source-port-missing');
    expect(
      validateConnection(document, { nodeId: 'clock', portId: 'value' }, target)
        .code,
    ).toBe('port-type-mismatch');
  });

  it('rejects an occupied input and a prospective cycle', () => {
    const occupied = graph(
      [
        node('plasma', 'source'),
        node('cells', 'other'),
        node('display', 'display'),
      ],
      [edge('existing', 'other', 'frame', 'display', 'source')],
    );
    expect(validateConnection(occupied, source, target).code).toBe(
      'input-occupied',
    );

    const cyclic = graph(
      [node('warp', 'first'), node('warp', 'second')],
      [edge('first-second', 'first', 'frame', 'second', 'source')],
    );
    expect(
      validateConnection(
        cyclic,
        { nodeId: 'second', portId: 'frame' },
        { nodeId: 'first', portId: 'source' },
      ).code,
    ).toBe('cycle');
  });

  it('rejects a connection that would exceed the reachable pass limit', () => {
    const nodes = [node('plasma', 'source')];
    const edges: GraphEdge[] = [];
    let previousId = 'source';
    for (
      let index = 1;
      index < MAX_REACHABLE_FRAME_NODES - 1;
      index += 1
    ) {
      const id = `effect-${index}`;
      nodes.push(node('warp', id));
      edges.push(edge(`to-${id}`, previousId, 'frame', id, 'source'));
      previousId = id;
    }
    nodes.push(node('blend', 'mix'));
    nodes.push(node('plasma', 'candidate'));
    nodes.push(node('display', 'display'));
    edges.push(edge('chain-mix', previousId, 'frame', 'mix', 'a'));
    edges.push(edge('mix-display', 'mix', 'frame', 'display', 'source'));

    expect(
      validateConnection(
        graph(nodes, edges),
        { nodeId: 'candidate', portId: 'frame' },
        { nodeId: 'mix', portId: 'b' },
      ),
    ).toMatchObject({ valid: false, code: 'frame-pass-limit' });
  });
});
