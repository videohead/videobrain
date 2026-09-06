import { describe, expect, it } from 'vitest';

import { createGraphNode } from './model';
import { OPERATOR_DEFINITIONS } from './operators';
import {
  GRAPH_PROTOCOL_VERSION,
  OPERATOR_CATALOG_VERSION,
  getOperatorCatalog,
  inspectGraph,
} from './protocol';
import {
  GRAPH_SCHEMA_VERSION,
  OPERATOR_CATEGORY_IDS,
  type GraphDocument,
} from './types';

describe('graph protocol inspection', () => {
  it('returns a detached, versioned operator catalog', () => {
    const first = getOperatorCatalog();
    const second = getOperatorCatalog();

    expect(first.protocolVersion).toBe(GRAPH_PROTOCOL_VERSION);
    expect(first.graphSchemaVersion).toBe(GRAPH_SCHEMA_VERSION);
    expect(first.catalogVersion).toBe(OPERATOR_CATALOG_VERSION);
    expect(first.catalogVersion).toBe(8);
    expect(first.operators.map(({ kind }) => kind)).toEqual(
      OPERATOR_DEFINITIONS.map(({ kind }) => kind),
    );
    expect(first.portTypes).toEqual([
      'frame.rgba',
      'control.f32',
      'text.utf8',
      'audio.block',
    ]);
    expect(first.categories).toEqual(OPERATOR_CATEGORY_IDS);
    expect(first.operators.map(({ category }) => category)).toEqual(
      OPERATOR_DEFINITIONS.map(({ category }) => category),
    );
    expect(
      first.operators.every(({ category }) =>
        first.categories.includes(category),
      ),
    ).toBe(true);
    expect(
      first.operators.every(
        ({ inputs, outputs }) =>
          inputs.every(({ index }, position) => index === position) &&
          outputs.every(({ index }, position) => index === position),
      ),
    ).toBe(true);
    expect(
      first.operators.find(({ kind }) => kind === 'blur')?.execution,
    ).toEqual({
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    });
    expect(
      first.operators.find(({ kind }) => kind === 'trails')?.execution,
    ).toEqual({
      visualPasses: 1,
      renderTargets: 2,
      stateful: true,
    });
    expect(
      first.operators.find(({ kind }) => kind === 'feedbackSpiral')?.execution,
    ).toEqual({
      visualPasses: 1,
      renderTargets: 2,
      stateful: true,
    });
    expect(
      first.operators.find(({ kind }) => kind === 'autoSelector')?.execution,
    ).toEqual({
      visualPasses: 0,
      renderTargets: 0,
      stateful: false,
    });
    expect(
      first.operators.find(({ kind }) => kind === 'strobe')?.execution,
    ).toEqual({
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    });
    expect(
      first.operators.find(({ kind }) => kind === 'xyPad')?.parameterLayout,
    ).toEqual({
      type: 'xy',
      label: 'Position',
      xParamId: 'x',
      yParamId: 'y',
    });

    first.operators[0]!.title = 'Changed by a caller';
    first.operators[0]!.execution.visualPasses = 999;
    expect(second.operators[0]!.title).not.toBe('Changed by a caller');
    expect(second.operators[0]!.execution.visualPasses).not.toBe(999);
    expect(OPERATOR_DEFINITIONS[0]!.title).not.toBe('Changed by a caller');
  });

  it('describes stable bindings, execution order, and inactive nodes', () => {
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        createGraphNode('time', { x: 0, y: 0 }, {}, 'clock'),
        createGraphNode('plasma', { x: 200, y: 0 }, {}, 'field'),
        createGraphNode('display', { x: 400, y: 0 }, {}, 'screen'),
        createGraphNode('constant', { x: 0, y: 240 }, {}, 'unused'),
      ],
      edges: [
        {
          id: 'clock-field',
          source: { nodeId: 'clock', portId: 'value' },
          target: { nodeId: 'field', portId: 'time' },
        },
        {
          id: 'field-screen',
          source: { nodeId: 'field', portId: 'frame' },
          target: { nodeId: 'screen', portId: 'source' },
        },
      ],
    };

    const result = inspectGraph(document);

    expect(result).toMatchObject({
      ok: true,
      nodeCount: 4,
      edgeCount: 2,
      executionOrder: ['clock', 'field', 'screen'],
      controlOrder: ['clock'],
      frameOrder: ['field'],
      displayNodeIds: ['screen'],
      inactiveNodeIds: ['unused'],
      resources: {
        visualPasses: 2,
        renderTargets: 1,
        statefulNodeIds: [],
      },
    });
    expect(result.nodes.find(({ id }) => id === 'field')).toMatchObject({
      kind: 'plasma',
      domain: 'frame',
      reachable: true,
      inputs: [
        {
          targetPortId: 'time',
          targetPortIndex: 0,
          edgeId: 'clock-field',
          sourceNodeId: 'clock',
          sourcePortId: 'value',
          sourcePortIndex: 0,
          type: 'control.f32',
        },
      ],
    });
  });

  it('reports compile diagnostics without inventing an execution plan', () => {
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        createGraphNode('math', { x: 0, y: 0 }, {}, 'a'),
        createGraphNode('math', { x: 200, y: 0 }, {}, 'b'),
      ],
      edges: [
        {
          id: 'a-b',
          source: { nodeId: 'a', portId: 'value' },
          target: { nodeId: 'b', portId: 'a' },
        },
        {
          id: 'b-a',
          source: { nodeId: 'b', portId: 'value' },
          target: { nodeId: 'a', portId: 'a' },
        },
      ],
    };

    const result = inspectGraph(document);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'cycle' }),
    ]);
    expect(result.executionOrder).toEqual([]);
    expect(result.inactiveNodeIds).toEqual(['a', 'b']);
    expect(result.resources).toEqual({
      visualPasses: 0,
      renderTargets: 0,
      statefulNodeIds: [],
    });
  });

  it('reports reachable state boundaries without counting inactive state', () => {
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        createGraphNode('time', { x: 0, y: 0 }, {}, 'clock'),
        createGraphNode('smooth', { x: 150, y: 0 }, {}, 'slew'),
        createGraphNode('plasma', { x: 300, y: 0 }, {}, 'field'),
        createGraphNode('display', { x: 450, y: 0 }, {}, 'screen'),
        createGraphNode('trails', { x: 0, y: 200 }, {}, 'inactive-history'),
      ],
      edges: [
        {
          id: 'clock-slew',
          source: { nodeId: 'clock', portId: 'value' },
          target: { nodeId: 'slew', portId: 'value' },
        },
        {
          id: 'slew-field',
          source: { nodeId: 'slew', portId: 'value' },
          target: { nodeId: 'field', portId: 'time' },
        },
        {
          id: 'field-screen',
          source: { nodeId: 'field', portId: 'frame' },
          target: { nodeId: 'screen', portId: 'source' },
        },
      ],
    };

    const result = inspectGraph(document);

    expect(result.ok).toBe(true);
    expect(result.resources.statefulNodeIds).toEqual(['slew']);
    expect(result.inactiveNodeIds).toEqual(['inactive-history']);
    expect(
      result.nodes.find(({ id }) => id === 'inactive-history')?.execution
        .stateful,
    ).toBe(true);
  });

  it('reports Spiral Feedback as one stateful pass with two retained targets', () => {
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        createGraphNode('solid', { x: 0, y: 0 }, {}, 'source'),
        createGraphNode('feedbackSpiral', { x: 200, y: 0 }, {}, 'spiral'),
        createGraphNode('display', { x: 400, y: 0 }, {}, 'screen'),
      ],
      edges: [
        {
          id: 'source-spiral',
          source: { nodeId: 'source', portId: 'frame' },
          target: { nodeId: 'spiral', portId: 'source' },
        },
        {
          id: 'spiral-screen',
          source: { nodeId: 'spiral', portId: 'frame' },
          target: { nodeId: 'screen', portId: 'source' },
        },
      ],
    };

    const result = inspectGraph(document);

    expect(result).toMatchObject({
      ok: true,
      frameOrder: ['source', 'spiral'],
      resources: {
        visualPasses: 3,
        renderTargets: 3,
        statefulNodeIds: ['spiral'],
      },
    });
  });

  it('reports selector-driven Strobe as stateless control and frame work', () => {
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        createGraphNode('autoSelector', { x: 0, y: 0 }, {}, 'selector'),
        createGraphNode('solid', { x: 0, y: 160 }, {}, 'source'),
        createGraphNode('strobe', { x: 200, y: 80 }, {}, 'strobe'),
        createGraphNode('display', { x: 400, y: 80 }, {}, 'screen'),
      ],
      edges: [
        {
          id: 'selector-strobe',
          source: { nodeId: 'selector', portId: 'phase' },
          target: { nodeId: 'strobe', portId: 'phase' },
        },
        {
          id: 'source-strobe',
          source: { nodeId: 'source', portId: 'frame' },
          target: { nodeId: 'strobe', portId: 'source' },
        },
        {
          id: 'strobe-screen',
          source: { nodeId: 'strobe', portId: 'frame' },
          target: { nodeId: 'screen', portId: 'source' },
        },
      ],
    };

    expect(inspectGraph(document)).toMatchObject({
      ok: true,
      controlOrder: ['selector'],
      frameOrder: ['source', 'strobe'],
      resources: {
        visualPasses: 3,
        renderTargets: 2,
        statefulNodeIds: [],
      },
    });
  });
});
