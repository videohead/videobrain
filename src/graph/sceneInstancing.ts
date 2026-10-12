/**
 * D5 (GPU instancing) — GPU-free instance batch planning.
 *
 * Expands one imported scene placement into a bounded batch of per-instance
 * transforms and reports aggregate batch costs before any GPU work runs.
 * Scene duplication (independent nodes sharing cached bytes) stays separate:
 * this module only computes compatible instance batches for one resolved scene.
 */
import {
  MAX_ASSET_INSTANCES,
  type ScenePlacement,
} from './scene3d';

/** Aggregate per-batch caps shared with the renderer. */
export const MAX_BATCH_TRIANGLES = 65536;
export const MAX_BATCH_DRAW_CALLS = 64;
export const MAX_BATCH_TEXTURES = 64;

export type InstanceLayout = 'grid' | 'ring';

export interface InstanceLayoutParams {
  layout: InstanceLayout;
  /** Instances per ring/row; clamped to 1..MAX_ASSET_INSTANCES. */
  count: number;
  spacing: number;
  radius: number;
}

export interface InstanceBatch {
  placements: readonly ScenePlacement[];
  /** Distinct mesh materials found in the source scene (compatibility). */
  drawCalls: number;
  triangles: number;
  textures: number;
  /** Non-empty when the batch was reduced or fell back to duplication. */
  diagnostics: string[];
  /** True when the source scene is compatible with GPU instancing. */
  instancing: boolean;
}

const PLACEMENT_RANGE = 1000;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Generate bounded per-instance placement offsets for a layout.
 * Grid arranges rows on XZ; ring arranges instances around Y.
 * The source placement transform is applied on top of every instance.
 */
export function instancePlacements(
  source: ScenePlacement,
  params: InstanceLayoutParams,
): ScenePlacement[] {
  const count = clampInt(params.count, 1, MAX_ASSET_INSTANCES);
  const spacing = Number.isFinite(params.spacing) ? params.spacing : 1;
  const radius = Number.isFinite(params.radius) ? params.radius : 2;
  const placements: ScenePlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    const offsetX = params.layout === 'grid'
      ? (index % 4) * spacing - (Math.min(count, 4) - 1) * spacing * 0.5
      : Math.cos((index / count) * Math.PI * 2) * radius;
    const offsetZ = params.layout === 'grid'
      ? Math.floor(index / 4) * spacing - (Math.ceil(count / 4) - 1) * spacing * 0.5
      : Math.sin((index / count) * Math.PI * 2) * radius;
    placements.push({
      position: [
        (source.position[0] ?? 0) + offsetX,
        source.position[1] ?? 0,
        (source.position[2] ?? 0) + offsetZ,
      ],
      rotation: [
        params.layout === 'ring' ? (source.rotation[0] ?? 0) : source.rotation[0] ?? 0,
        params.layout === 'ring'
          ? (source.rotation[1] ?? 0) - (index / count) * 360
          : source.rotation[1] ?? 0,
        source.rotation[2] ?? 0,
      ],
      scale: [source.scale[0] ?? 1, source.scale[1] ?? 1, source.scale[2] ?? 1],
    });
  }
  return placements;
}

/** Validate one generated placement against the shared placement bounds. */
function validPlacement(placement: ScenePlacement): boolean {
  return [placement.position, placement.rotation, placement.scale].every((vector) =>
    vector.length === 3 &&
    vector.every((value) => Number.isFinite(value) && Math.abs(value) <= PLACEMENT_RANGE));
}

export interface BatchSourceStats {
  /** Distinct mesh draw calls in the decoded source scene. */
  drawCalls: number;
  triangles: number;
  textures: number;
}

/**
 * Evaluate one placement batch against decoded-scene stats.
 * Returns diagnostics for incompatibility or budget overruns instead of
 * silently freezing or stripping content. `instancing` is false when the
 * batch must fall back to duplicated placements.
 */
export function planInstanceBatch(
  placements: readonly ScenePlacement[],
  stats: BatchSourceStats,
): InstanceBatch {
  const diagnostics: string[] = [];
  const bounded = placements.slice(0, MAX_ASSET_INSTANCES);
  if (placements.length > MAX_ASSET_INSTANCES) {
    diagnostics.push(`Batch limited to ${MAX_ASSET_INSTANCES} placements.`);
  }
  for (const placement of bounded) {
    if (!validPlacement(placement)) {
      return {
        placements: [],
        drawCalls: stats.drawCalls,
        triangles: 0,
        textures: stats.textures,
        diagnostics: ['A placement transform is outside the bounded instance ranges.'],
        instancing: false,
      };
    }  }
  const triangles = stats.triangles * bounded.length;
  let instancing = true;
  if (stats.drawCalls === 0) {
    diagnostics.push('The scene has no static meshes to instance.');
    instancing = false;
  }
  if (triangles > MAX_BATCH_TRIANGLES) {
    diagnostics.push(
      `Batch needs ${triangles} triangles; the limit is ${MAX_BATCH_TRIANGLES}.`,
    );
    instancing = false;
  }
  if (stats.textures > MAX_BATCH_TEXTURES) {
    diagnostics.push(
      `Batch needs ${stats.textures} texture slots; the limit is ${MAX_BATCH_TEXTURES}.`,
    );
    instancing = false;
  }
  if (stats.drawCalls > MAX_BATCH_DRAW_CALLS) {
    diagnostics.push(
      `Batch needs ${stats.drawCalls} distinct mesh draws; the limit is ${MAX_BATCH_DRAW_CALLS}.`,
    );
    instancing = false;
  }
  return {
    placements: bounded,
    drawCalls: stats.drawCalls,
    triangles,
    textures: stats.textures,
    diagnostics,
    instancing: instancing && bounded.length > 1,
  };
}
