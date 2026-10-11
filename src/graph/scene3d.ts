export type VectorValue = readonly number[];
export interface Transform3DValue {
  position: VectorValue;
  rotation: VectorValue;
  scale: VectorValue;
  pivot: VectorValue;
}
export interface Geometry3DValue {
  shape: 'box' | 'sphere' | 'plane' | 'cylinder' | 'line' | 'grid';
  width: number;
  height: number;
  depth: number;
  detail: number;
  countX: number;
  countY: number;
  transforms: readonly Transform3DValue[];
}
export interface Material3DValue {
  color: VectorValue;
  metalness: number;
  roughness: number;
  emissive: number;
  opacity: number;
  wireframe: boolean;
  pointSize: number;
}
export interface Camera3DValue {
  mode: 'perspective' | 'orthographic';
  position: VectorValue;
  target: VectorValue;
  fov: number;
  span: number;
  near: number;
  far: number;
}
export interface Light3DValue {
  mode: 'directional' | 'point' | 'ambient';
  color: VectorValue;
  position: VectorValue;
  intensity: number;
}
export type Scene3DValue = VectorValue | Geometry3DValue | Material3DValue | Camera3DValue | Light3DValue | null;

export const DEFAULT_MATERIAL: Material3DValue = { color: [0.2, 0.7, 0.55], metalness: 0.1, roughness: 0.45, emissive: 0, opacity: 1, wireframe: false, pointSize: 0.06 };
export const DEFAULT_CAMERA: Camera3DValue = { mode: 'perspective', position: [3, 2, 4], target: [0, 0, 0], fov: 45, span: 4, near: 0.01, far: 100 };
export const DEFAULT_LIGHT: Light3DValue = { mode: 'directional', color: [1, 1, 1], position: [3, 4, 5], intensity: 3 };
export const MAX_3D_TRANSFORMS = 16;
export const MAX_3D_TRIANGLES = 8192;
export const MAX_3D_POINTS = 4096;

export function geometryCost(value: Geometry3DValue): { triangles: number; points: number } {
  const detail = value.detail;
  const triangles = value.shape === 'box' ? 12 * detail * detail
    : value.shape === 'sphere' ? 2 * detail * (detail - 1)
    : value.shape === 'cylinder' ? 4 * detail
    : value.shape === 'plane' ? 2 * detail * detail : 0;
  return { triangles, points: value.shape === 'grid' ? value.countX * value.countY : value.shape === 'line' ? value.countX : 0 };
}

export function validateGeometry(value: Geometry3DValue): Geometry3DValue {
  if (!['box', 'sphere', 'plane', 'cylinder', 'line', 'grid'].includes(value.shape) ||
    ![value.width, value.height, value.depth].every((size) => Number.isFinite(size) && size >= 0.01 && size <= 20) ||
    !Number.isInteger(value.detail) || value.detail < 3 || value.detail > 24 ||
    ![value.countX, value.countY].every((count) => Number.isInteger(count) && count >= 2 && count <= 64) ||
    value.transforms.length > MAX_3D_TRANSFORMS) throw new Error('Geometry exceeds its shape, detail, or transform bounds.');
  const cost = geometryCost(value);
  if (cost.triangles > MAX_3D_TRIANGLES || cost.points > MAX_3D_POINTS) throw new Error('Geometry exceeds the triangle/point budget.');
  for (const transform of value.transforms) {
    for (const vector of [transform.position, transform.rotation, transform.scale, transform.pivot]) {
      if (vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('Transform requires finite vec3 values.');
    }
  }
  return value;
}