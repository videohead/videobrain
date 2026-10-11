import type { CompiledNode } from '../graph';
import { SCENE_3D_DEFINITIONS } from '../graph/scene3dOperators';
import { validateGeometry, type Geometry3DValue, type Scene3DValue, type VectorValue } from '../graph/scene3d';

const kinds = new Set(SCENE_3D_DEFINITIONS.filter(({ domain }) => domain === 'control').map(({ kind }) => kind));
export function isScene3DNode(kind: CompiledNode['node']['kind']) { return kinds.has(kind); }

export function evaluateScene3D(compiled: CompiledNode, input: Record<string, Scene3DValue | number>): Record<string, Scene3DValue | number> {
  const { node, definition } = compiled;
  const number = (id: string) => {
    const parameter = definition.params[id];
    if (parameter?.type !== 'number') throw new Error(`Missing numeric scene parameter ${id}.`);
    const value = input[id] ?? node.params[id];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(parameter.min, Math.min(parameter.max, value)) : parameter.defaultValue;
  };
  const vector = (id: string, fallback: number[], min: number, max: number): VectorValue => {
    const value = input[id];
    return Array.isArray(value) && value.length === fallback.length ? value.map((component, index) => typeof component === 'number' && Number.isFinite(component) ? Math.max(min, Math.min(max, component)) : fallback[index] ?? 0) : fallback;
  };
  const color = () => vector('color', [number('red'), number('green'), number('blue')], 0, 1);
  if (node.kind.startsWith('vector')) {
    const size = Number(node.kind.at(-1));
    return { vector: ['x', 'y', 'z', 'w'].slice(0, size).map(number) };
  }
  if (node.kind.startsWith('splitVector')) {
    const size = Number(node.kind.at(-1));
    const value = vector('vector', Array.from({ length: size }, () => 0), -1000, 1000);
    return Object.fromEntries(['x', 'y', 'z', 'w'].slice(0, size).map((axis, index) => [axis, value[index] ?? 0]));
  }
  switch (node.kind) {
    case 'primitive3d': return { geometry: validateGeometry({ shape: node.params.shape as Geometry3DValue['shape'], width: number('width'), height: number('height'), depth: number('depth'), detail: Math.floor(number('detail')), countX: 2, countY: 2, transforms: [] }) };
    case 'grid3d': return { points: validateGeometry({ shape: node.params.mode === 'line' ? 'line' : 'grid', width: number('width'), height: number('height'), depth: 1, detail: 3, countX: Math.floor(number('countX')), countY: Math.floor(number('countY')), transforms: [] }) };
    case 'transform3d': {
      const transform = {
        position: vector('position', [number('x'), number('y'), number('z')], -20, 20),
        rotation: vector('rotationVector', [number('rotationX'), number('rotationY'), number('rotationZ')], -360, 360),
        scale: vector('scaleVector', [number('scaleX'), number('scaleY'), number('scaleZ')], 0.01, 10),
        pivot: [number('pivotX'), number('pivotY'), number('pivotZ')],
      };
      const apply = (id: string) => {
        const geometry = input[id] as Geometry3DValue | undefined;
        return geometry ? validateGeometry({ ...geometry, transforms: [...geometry.transforms, transform] }) : null;
      };
      return { geometry: apply('geometry'), points: apply('points') };
    }
    case 'material3d': return { material: { color: color(), metalness: number('metalness'), roughness: number('roughness'), emissive: number('emissive'), opacity: number('opacity'), wireframe: node.params.wireframe === 'on', pointSize: number('pointSize') } };
    case 'camera3d': return { camera: { mode: node.params.mode === 'orthographic' ? 'orthographic' : 'perspective', position: vector('position', [number('x'), number('y'), number('z')], -50, 50), target: vector('target', [number('targetX'), number('targetY'), number('targetZ')], -20, 20), fov: number('fov'), span: number('span'), near: number('near'), far: number('far') } };
    case 'light3d': return { light: { mode: node.params.mode as 'directional' | 'point' | 'ambient', color: color(), position: vector('position', [number('x'), number('y'), number('z')], -50, 50), intensity: number('intensity') } };
    case 'asset3d': {
      const assetId = typeof node.params.assetId === 'string' ? node.params.assetId : '';
      const assetHash = typeof node.params.assetHash === 'string' ? node.params.assetHash : '';
      const assetKind = node.params.assetKind === 'gltf' ? 'gltf' : 'glb';
      if (assetId.length === 0 || !/^[a-f0-9]{64}$/.test(assetHash)) {
        return { assetScene: null };
      }
      return {
        assetScene: {
          kind: 'asset-scene', assetId, assetHash, assetKind,
          placement: {
            position: [number('x'), number('y'), number('z')],
            rotation: [number('rotationX'), number('rotationY'), number('rotationZ')],
            scale: [number('scaleX'), number('scaleY'), number('scaleZ')],
          },
        },
      };
    }
    default: return {};
  }
}