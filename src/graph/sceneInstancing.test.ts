import { describe, expect, it } from 'vitest';
import {
  MAX_ASSET_INSTANCES,
  MAX_BATCH_DRAW_CALLS,
  MAX_BATCH_TRIANGLES,
  instancePlacements,
  planInstanceBatch,
} from './sceneInstancing';
import type { ScenePlacement } from './scene3d';

const placement: ScenePlacement = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

describe('instance layout generation', () => {
  it('generates a bounded grid layout around the source placement', () => {
    const placements = instancePlacements(placement, { layout: 'grid', count: 8, spacing: 2, radius: 2 });
    expect(placements).toHaveLength(8);
    expect(placements.every(({ scale }) => scale[0] === 1)).toBe(true);
    expect(placements.every(({ position }) => Number.isFinite(position[0]) && Number.isFinite(position[2]))).toBe(true);
  });

  it('arranges ring instances facing outward and clamps the count', () => {
    const placements = instancePlacements(placement, { layout: 'ring', count: MAX_ASSET_INSTANCES + 10, spacing: 1, radius: 3 });
    expect(placements).toHaveLength(MAX_ASSET_INSTANCES);
    const first = placements[0]!;
    expect(first.position[0]).toBeCloseTo(3);
    expect(first.rotation[1]).toBeCloseTo(0);
    const last = placements[MAX_ASSET_INSTANCES - 1]!;
    expect(last.rotation[1]).toBeLessThanOrEqual(0);
  });

  it('keeps the source placement transform under the generated offsets', () => {
    const placements = instancePlacements(
      { position: [5, 1, -2], rotation: [10, 20, 30], scale: [2, 2, 2] },
      { layout: 'grid', count: 4, spacing: 1, radius: 1 },
    );
    expect(placements.every(({ rotation }) => rotation[0] === 10 && rotation[2] === 30)).toBe(true);
    expect(placements.every(({ scale }) => scale.every((value) => value === 2))).toBe(true);
    expect(placements[0]!.position[1]).toBe(1);
  });
});

describe('instance batch planning', () => {
  it('marks a compatible static scene as one instanced batch', () => {
    const batch = planInstanceBatch(
      Array.from({ length: 16 }, () => placement),
      { drawCalls: 2, triangles: 120, textures: 1 },
    );
    expect(batch.instancing).toBe(true);
    expect(batch.placements).toHaveLength(16);
    expect(batch.triangles).toBe(120 * 16);
    expect(batch.diagnostics).toEqual([]);
  });

  it('limits placements and reports the reduction', () => {
    const batch = planInstanceBatch(
      Array.from({ length: MAX_ASSET_INSTANCES + 5 }, () => placement),
      { drawCalls: 1, triangles: 12, textures: 0 },
    );
    expect(batch.placements).toHaveLength(MAX_ASSET_INSTANCES);
    expect(batch.diagnostics[0]).toContain('limited');
  });

  it('falls back with diagnostics when the triangle budget is exceeded', () => {
    const batch = planInstanceBatch(
      Array.from({ length: 64 }, () => placement),
      { drawCalls: 1, triangles: MAX_BATCH_TRIANGLES, textures: 0 },
    );
    expect(batch.instancing).toBe(false);
    expect(batch.diagnostics[0]).toContain('triangles');
  });

  it('rejects non-static or out-of-bound batches', () => {
    expect(planInstanceBatch([placement], { drawCalls: 0, triangles: 0, textures: 0 }).instancing).toBe(false);
    expect(
      planInstanceBatch([{ position: [NaN, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }], { drawCalls: 1, triangles: 12, textures: 0 }).diagnostics[0],
    ).toContain('bounded');
  });

  it('reports draw-call incompatibility without changing placements', () => {
    const batch = planInstanceBatch(
      [placement, placement],
      { drawCalls: MAX_BATCH_DRAW_CALLS + 1, triangles: 10, textures: 0 },
    );
    expect(batch.instancing).toBe(false);
    expect(batch.placements).toHaveLength(2);
    expect(batch.diagnostics[0]).toContain('mesh draws');
  });
});
