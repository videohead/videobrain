import { describe, expect, it } from 'vitest';
import { createGraphNode, getOperatorDefinition, type CompiledNode } from '../graph';
import { evaluateScene3D } from './Scene3DEvaluator';

function compiled(kind: CompiledNode['node']['kind']): CompiledNode { return { node: createGraphNode(kind, { x: 0, y: 0 }), definition: getOperatorDefinition(kind), inputs: {} }; }
describe('scene descriptor evaluation', () => {
  it('composes and splits vectors explicitly', () => {
    expect(evaluateScene3D(compiled('vector3'), { x: 2, y: 3, z: 4 })).toEqual({ vector: [2, 3, 4] });
    expect(evaluateScene3D(compiled('splitVector4'), { vector: [1, 2, 3, 4] })).toEqual({ x: 1, y: 2, z: 3, w: 4 });
    expect(evaluateScene3D(compiled('splitVector2'), {})).toEqual({ x: 0, y: 0 });
  });
  it('preserves source descriptors and applies bounded transforms', () => {
    const primitive = evaluateScene3D(compiled('primitive3d'), {});
    const result = evaluateScene3D(compiled('transform3d'), { geometry: primitive.geometry ?? null, position: [50, 0, 0] });
    expect(result.geometry).toMatchObject({ transforms: [{ position: [20, 0, 0] }] });
    expect(primitive.geometry).toMatchObject({ transforms: [] });
    expect(evaluateScene3D(compiled('transform3d'), {})).toEqual({ geometry: null, points: null });
  });
});