import { describe, expect, it } from 'vitest';
import { geometryCost, validateGeometry, type Geometry3DValue } from './scene3d';
import { SCENE_3D_DEFINITIONS } from './scene3dOperators';
import { compileGraph, createGraphNode, GRAPH_SCHEMA_VERSION, inspectGraph, parseGraphDocument, serializeGraphDocument, type GraphDocument } from './index';

const box: Geometry3DValue = { shape: 'box', width: 1, height: 1, depth: 1, detail: 3, countX: 8, countY: 8, transforms: [] };
describe('3D descriptor budgets', () => {
  it('appends Light 3 without changing existing Render 3D input indexes', () => {
    const definition = SCENE_3D_DEFINITIONS.find(({ kind }) => kind === 'render3d')!;
    expect(definition.inputs.map(({ id }) => id)).toEqual(['geometry', 'points', 'material', 'camera', 'light', 'light2', 'texture', 'light3']);
    expect(definition.inputs[7]).toMatchObject({ type: 'scene.light', optional: true });
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [createGraphNode('light3d', { x: 0, y: 0 }, {}, 'light'), createGraphNode('render3d', { x: 0, y: 0 }, {}, 'render'), createGraphNode('display', { x: 0, y: 0 }, {}, 'output')],
      edges: [
        { id: 'light', source: { nodeId: 'light', portId: 'light' }, target: { nodeId: 'render', portId: 'light3' } },
        { id: 'frame', source: { nodeId: 'render', portId: 'frame' }, target: { nodeId: 'output', portId: 'source' } },
      ],
    };
    expect(parseGraphDocument(serializeGraphDocument(document))).toEqual(document);
    expect(inspectGraph(document).nodes.find(({ id }) => id === 'render')?.inputs[0]).toMatchObject({ targetPortId: 'light3', targetPortIndex: 7, type: 'scene.light' });
  });
  it.each(SCENE_3D_DEFINITIONS)('round-trips $kind and rejects out-of-bound parameters', ({ kind, params }) => {
    const node = createGraphNode(kind, { x: 0, y: 0 });
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [node], edges: [] };
    expect(parseGraphDocument(serializeGraphDocument(document))).toEqual(document);
    for (const [id, parameter] of Object.entries(params)) {
      const value = parameter.type === 'number' ? parameter.max + 1 : 'invalid';
      expect(() => parseGraphDocument({ ...document, nodes: [{ ...node, params: { ...node.params, [id]: value } }] })).toThrow();
    }
  });
  it('rejects incompatible wires and overlong transform chains, and reports scene limits', () => {
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [createGraphNode('primitive3d', { x: 0, y: 0 }, {}, 'mesh'), createGraphNode('render3d', { x: 0, y: 0 }, {}, 'render'), createGraphNode('display', { x: 0, y: 0 }, {}, 'output')], edges: [
      { id: 'mesh', source: { nodeId: 'mesh', portId: 'geometry' }, target: { nodeId: 'render', portId: 'geometry' } },
      { id: 'frame', source: { nodeId: 'render', portId: 'frame' }, target: { nodeId: 'output', portId: 'source' } },
    ] };
    expect(inspectGraph(document).scene3dBudgets).toEqual([{ nodeId: 'render', maxTriangles: 8192, maxPoints: 4096, maxDrawCalls: 4, textureSlots: 1, resourcePixelUnits: 5 }]);
    const bad = { ...document, edges: [{ id: 'bad', source: { nodeId: 'mesh', portId: 'geometry' }, target: { nodeId: 'output', portId: 'source' } }] };
    expect(() => compileGraph(bad)).toThrow('geometry.mesh');
    document.edges.shift();
    let previous = 'mesh';
    for (let index = 0; index < 17; index++) {
      const id = `transform-${index}`;
      document.nodes.push(createGraphNode('transform3d', { x: 0, y: 0 }, {}, id));
      document.edges.push({ id, source: { nodeId: previous, portId: 'geometry' }, target: { nodeId: id, portId: 'geometry' } });
      previous = id;
    }
    document.edges.push({ id: 'last', source: { nodeId: previous, portId: 'geometry' }, target: { nodeId: 'render', portId: 'geometry' } });
    expect(() => compileGraph(document)).toThrow('16 levels');
  });
  it('bounds primitive detail and grid point counts', () => {
    expect(geometryCost(box)).toEqual({ triangles: 108, points: 0 });
    expect(geometryCost(validateGeometry({ ...box, detail: 24 })).triangles).toBe(6912);
    expect(geometryCost(validateGeometry({ ...box, shape: 'grid', countX: 64, countY: 64 })).points).toBe(4096);
    expect(() => validateGeometry({ ...box, detail: 100 })).toThrow();
    expect(() => validateGeometry({ ...box, width: NaN })).toThrow();
    expect(() => validateGeometry({ ...box, countX: 65 })).toThrow();
  });
  it('rejects malformed or excessive transforms', () => {
    const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] };
    expect(() => validateGeometry({ ...box, transforms: Array.from({ length: 17 }, () => transform) })).toThrow();
    expect(() => validateGeometry({ ...box, transforms: [{ ...transform, position: [NaN, 0, 0] }] })).toThrow();
  });
});