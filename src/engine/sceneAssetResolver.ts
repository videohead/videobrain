/**
 * D2 (data layer) — Bridge imported scene assets to the GPU scene cache.
 *
 * This connects the A1 AssetStore to the D1 SceneAssetCache: it builds a
 * SceneAssetResolver that fetches durable bytes by AssetRef, and validates the
 * ordered placement transforms that accompany an imported scene before they
 * reach the renderer.
 *
 * It is the testable, GPU-free half of D2. Wiring a live `asset3d` operator into
 * the graph registry, adding the additive Render 3D input, and the Scene3DRenderer
 * draw path remain a shared-file + GPU-gated step (see TASKS.md D2 handoff).
 */
import type { AssetStore } from '../store/assetStore';
import {
  MAX_SCENE_PLACEMENTS,
  type AssetRef,
  type ScenePlacementTransform,
  type SceneAssetDescriptor,
} from '../store/contracts';
import type { SceneAssetResolver } from './SceneAssetCache';

const PLACEMENT_RANGE = 1_000;
const SCALE_MIN = 0.001;
const SCALE_MAX = 1_000;

/** Build a cache resolver that reads durable asset bytes from the AssetStore. */
export function createAssetStoreResolver(store: AssetStore): SceneAssetResolver {
  return async (ref: AssetRef): Promise<Uint8Array | undefined> => {
    const record = await store.resolve(ref.id);
    if (!record) {
      return undefined;
    }
    // Content identity must match; a hash mismatch is a different asset.
    if (record.manifest.ref.hash !== ref.hash) {
      return undefined;
    }
    return record.bytes;
  };
}

function isFiniteVec3(value: readonly number[]): value is readonly [number, number, number] {
  return value.length === 3 && value.every(Number.isFinite);
}

function inRange(value: readonly number[], min: number, max: number): boolean {
  return value.every((component) => component >= min && component <= max);
}

/** Validate one placement transform against bounded ranges. */
export function validatePlacement(transform: ScenePlacementTransform): ScenePlacementTransform {
  if (
    !isFiniteVec3(transform.position) ||
    !isFiniteVec3(transform.rotation) ||
    !isFiniteVec3(transform.scale)
  ) {
    throw new Error('Placement transform requires finite vec3 position, rotation, and scale.');
  }
  if (!inRange(transform.position, -PLACEMENT_RANGE, PLACEMENT_RANGE)) {
    throw new Error('Placement position is out of bounds.');
  }
  if (!inRange(transform.rotation, -360, 360)) {
    throw new Error('Placement rotation must be within -360..360 degrees.');
  }
  if (!inRange(transform.scale, SCALE_MIN, SCALE_MAX)) {
    throw new Error('Placement scale is out of bounds.');
  }
  return transform;
}

/** Validate a full scene asset descriptor, including placement count and bounds. */
export function validateSceneAssetDescriptor(
  descriptor: SceneAssetDescriptor,
): SceneAssetDescriptor {
  if (descriptor.ref.kind !== 'glb' && descriptor.ref.kind !== 'gltf') {
    throw new Error('Scene asset must reference a glb or gltf asset.');
  }
  if (descriptor.placements.length === 0) {
    throw new Error('Scene asset requires at least one placement.');
  }
  if (descriptor.placements.length > MAX_SCENE_PLACEMENTS) {
    throw new Error(`Scene asset exceeds ${MAX_SCENE_PLACEMENTS} placements.`);
  }
  for (const placement of descriptor.placements) {
    validatePlacement(placement);
  }
  return descriptor;
}
