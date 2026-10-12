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
  it('expands an asset placement into a bounded instance batch', () => {
    const asset = {
      kind: 'asset-scene',
      assetId: 'fixture',
      assetHash: 'a'.repeat(64),
      assetKind: 'glb',
      placement: { position: [1, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
    } as const;
    const batch = evaluateScene3D(compiled('instance3d'), { assetScene: asset });
    const batched = batch.assetScene as typeof asset & { placements: readonly unknown[] };
    expect(batched.assetHash).toBe(asset.assetHash);
    expect(batched.placements).toHaveLength(4);
    expect(batched.placement).toEqual(asset.placement);
    const ring = evaluateScene3D(
      { node: createGraphNode('instance3d', { x: 0, y: 0 }, { mode: 'ring' }), definition: getOperatorDefinition('instance3d'), inputs: {} },
      { assetScene: asset },
    );
    expect((ring.assetScene as typeof batched).placements).toHaveLength(4);
    expect(evaluateScene3D(compiled('instance3d'), { assetScene: null })).toEqual({ assetScene: null });
  });
});