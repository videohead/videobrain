import { describe, expect, it } from 'vitest';

import {
  MAX_OUTPUT_LAYOUTS,
  MAX_SURFACE_MASK_POINTS,
  MAX_SURFACE_MESH_CELLS,
  type OutputLayout,
  type SurfaceLayout,
  type SurfaceMaskPoint,
  type SurfaceMeshWarp,
} from '../store/contracts';
import { computeInverseProjectionMap } from './projection';
import {
  MAX_SURFACE_MASK_PATHS,
  MAX_SURFACE_MESH_SPAN,
  MAX_TOTAL_OUTPUT_PIXELS,
  SurfaceLayoutError,
  applySurfaceEdit,
  createMeshWarp,
  createOutputId,
  createSurfaceId,
  frameUvToScreen,
  meshBaseVertexUv,
  meshFromProjectionCorners,
  meshVertexCount,
  meshVertexIndex,
  meshVertexUv,
  orderedSurfaces,
  parseOutputLayouts,
  projectionCornersFromMesh,
  screenToFrameUv,
  serializeOutputLayouts,
  validateMaskPath,
  validateMeshWarp,
  validateOutputLayouts,
  validateSurfaceLayout,
} from './surfaceLayout';

const surface = (overrides: Partial<SurfaceLayout> = {}): SurfaceLayout => ({
  id: 'surface-1',
  sourceNodeId: 'plasma-1',
  sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
  warp: null,
  maskPaths: [],
  outputId: 'output-1',
  layerIndex: 0,
  visible: true,
  blend: 'normal',
  opacity: 1,
  ...overrides,
});

const output = (overrides: Partial<OutputLayout> = {}): OutputLayout => ({
  id: 'output-1',
  name: 'Main Display',
  width: 1920,
  height: 1080,
  layoutX: 0,
  layoutY: 0,
  surfaces: [surface()],
  ...overrides,
});

/** Replace one vertex displacement in a copy of the mesh. */
function displaced(
  warp: SurfaceMeshWarp,
  row: number,
  col: number,
  offset: SurfaceMaskPoint,
): SurfaceMeshWarp {
  const displacements = [...warp.displacements];
  displacements[meshVertexIndex(warp.cols, row, col)] = offset;
  return { ...warp, displacements };
}

/** Screen-space corner comparison that tolerates binary float drift. */
function expectScreenPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe('coordinate conversion', () => {
  it('flips y between screen (y-down) and UV (y-up)', () => {
    const uv = screenToFrameUv({ x: 0.25, y: 0.2 });
    expect(uv.u).toBeCloseTo(0.25, 10);
    expect(uv.v).toBeCloseTo(0.8, 10);
    expectScreenPoint(frameUvToScreen({ u: 0.25, v: 0.8 }), { x: 0.25, y: 0.2 });
  });

  it('round-trips a point through both conversions', () => {
    const point = { x: 0.37, y: 0.91 };
    expect(frameUvToScreen(screenToFrameUv(point))).toEqual(point);
  });
});

describe('identity', () => {
  it('issues distinct surface and output ids', () => {
    const ids = new Set([
      createSurfaceId(),
      createSurfaceId(),
      createOutputId(),
    ]);
    expect(ids.size).toBe(3);
  });
});

describe('warp mesh geometry', () => {
  it('allocates one displacement per grid vertex', () => {
    const warp = createMeshWarp(2, 3);
    expect(meshVertexCount(2, 3)).toBe(12);
    expect(warp.displacements).toHaveLength(12);
    expect(validateMeshWarp(warp).valid).toBe(true);
  });

  it('places row 0 along the top edge of the surface', () => {
    expect(meshBaseVertexUv(2, 2, 0, 0)).toEqual({ u: 0, v: 1 });
    expect(meshBaseVertexUv(2, 2, 2, 2)).toEqual({ u: 1, v: 0 });
  });

  it('adds displacements to the base grid position', () => {
    const warp = displaced(createMeshWarp(1, 1), 0, 0, { x: 0.1, y: -0.2 });
    expect(meshVertexUv(warp, 0, 0)).toEqual({ u: 0.1, v: 0.8 });
  });

  it('accepts a bounded pull on an interior vertex', () => {
    const warp = displaced(createMeshWarp(2, 2), 1, 1, { x: 0.1, y: 0.1 });
    expect(validateMeshWarp(warp).valid).toBe(true);
  });

  it('rejects a collapsed cell', () => {
    const warp = displaced(createMeshWarp(1, 1), 0, 1, { x: -1, y: 0 });
    const result = validateMeshWarp(warp);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('degenerate or folded');
  });

  it('rejects a folded cell', () => {
    // Drag the top-right vertex past the top-left one to create a bow tie.
    const warp = displaced(createMeshWarp(1, 1), 0, 1, { x: -1.5, y: 0 });
    expect(validateMeshWarp(warp).valid).toBe(false);
  });

  it('rejects a mismatched displacement count', () => {
    const warp: SurfaceMeshWarp = { rows: 2, cols: 2, displacements: [] };
    expect(validateMeshWarp(warp).errors.join(' ')).toContain(
      'needs 9 displacements',
    );
  });

  it('rejects non-finite displacements', () => {
    const warp = displaced(createMeshWarp(1, 1), 0, 0, {
      x: Number.NaN,
      y: 0,
    });
    expect(validateMeshWarp(warp).errors.join(' ')).toContain('finite point');
  });

  it('rejects a mesh with no cells', () => {
    expect(validateMeshWarp(createMeshWarp(0, 4)).valid).toBe(false);
  });

  it('enforces the per-axis span limit', () => {
    const span = MAX_SURFACE_MESH_SPAN + 1;
    const result = validateMeshWarp(createMeshWarp(1, span));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('span exceeds');
  });

  it('accepts the largest allowed mesh', () => {
    const warp = createMeshWarp(MAX_SURFACE_MESH_SPAN, MAX_SURFACE_MESH_SPAN);
    expect(warp.rows * warp.cols).toBe(MAX_SURFACE_MESH_CELLS);
    expect(validateMeshWarp(warp).valid).toBe(true);
  });
});

describe('four-corner compatibility', () => {
  const corners = {
    x0: 0.14,
    y0: 0.2,
    x1: 0.86,
    y1: 0.2,
    x2: 0.86,
    y2: 0.8,
    x3: 0.14,
    y3: 0.8,
  };

  it('preserves the shipped top-left, top-right, bottom-right, bottom-left order', () => {
    const warp = meshFromProjectionCorners(corners);
    expect(warp.rows).toBe(1);
    expect(warp.cols).toBe(1);
    expectScreenPoint(frameUvToScreen(meshVertexUv(warp, 0, 0)), { x: 0.14, y: 0.2 });
    expectScreenPoint(frameUvToScreen(meshVertexUv(warp, 0, 1)), { x: 0.86, y: 0.2 });
    expectScreenPoint(frameUvToScreen(meshVertexUv(warp, 1, 1)), { x: 0.86, y: 0.8 });
    expectScreenPoint(frameUvToScreen(meshVertexUv(warp, 1, 0)), { x: 0.14, y: 0.8 });
  });

  it('round-trips corners through the mesh representation', () => {
    const restored = projectionCornersFromMesh(meshFromProjectionCorners(corners));
    expect(restored).not.toBeNull();
    for (const [key, value] of Object.entries(corners)) {
      expect(restored?.[key as keyof typeof corners]).toBeCloseTo(value, 10);
    }
  });

  it('declines to express a multi-cell mesh as four corners', () => {
    expect(projectionCornersFromMesh(createMeshWarp(2, 2))).toBeNull();
  });

  it('agrees with the projection solver about which quads are usable', () => {
    const map = computeInverseProjectionMap({
      ...corners,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
    });
    expect(map).not.toBeNull();
    expect(validateMeshWarp(meshFromProjectionCorners(corners)).valid).toBe(true);
  });

  it('rejects a folded quad that the projection solver still accepts', () => {
    // Swapping the bottom corners folds the quad; the homography stays
    // solvable, so winding has to be rejected here instead.
    const folded = { ...corners, x2: 0.14, x3: 0.86 };
    expect(
      computeInverseProjectionMap({
        ...folded,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        rotation: 0,
      }),
    ).not.toBeNull();
    expect(validateMeshWarp(meshFromProjectionCorners(folded)).valid).toBe(false);
  });
});

describe('mask paths', () => {
  const triangle = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.5, y: 0.8 },
  ];

  it('accepts a bounded closed path', () => {
    expect(
      validateMaskPath({ points: triangle, closed: true, feather: 0.1 }).valid,
    ).toBe(true);
  });

  it('requires three points to close a path', () => {
    expect(
      validateMaskPath({
        points: triangle.slice(0, 2),
        closed: true,
        feather: 0,
      }).valid,
    ).toBe(false);
  });

  it('enforces the point ceiling', () => {
    const points = Array.from(
      { length: MAX_SURFACE_MASK_POINTS + 1 },
      (_, index) => ({ x: index / 1000, y: 0.5 }),
    );
    expect(
      validateMaskPath({ points, closed: true, feather: 0 }).errors.join(' '),
    ).toContain('exceeds');
  });

  it('rejects points outside the surface', () => {
    expect(
      validateMaskPath({
        points: [...triangle, { x: 1.4, y: 0.5 }],
        closed: true,
        feather: 0,
      }).errors.join(' '),
    ).toContain('outside the surface');
  });

  it('bounds feathering', () => {
    expect(
      validateMaskPath({ points: triangle, closed: true, feather: 4 }).valid,
    ).toBe(false);
  });
});

describe('surface and output validation', () => {
  it('accepts a minimal full-frame surface', () => {
    expect(validateSurfaceLayout(surface()).valid).toBe(true);
    expect(validateOutputLayouts([output()]).valid).toBe(true);
  });

  it('rejects a degenerate source region', () => {
    const result = validateSurfaceLayout(
      surface({ sourceUvRegion: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } }),
    );
    expect(result.errors.join(' ')).toContain('degenerate');
  });

  it('rejects a source region outside the frame', () => {
    expect(
      validateSurfaceLayout(
        surface({ sourceUvRegion: { u0: 0, v0: 0, u1: 1.5, v1: 1 } }),
      ).valid,
    ).toBe(false);
  });

  it('rejects out-of-range opacity and unknown blend modes', () => {
    expect(validateSurfaceLayout(surface({ opacity: 2 })).valid).toBe(false);
    expect(
      validateSurfaceLayout(
        surface({ blend: 'overlay' as SurfaceLayout['blend'] }),
      ).valid,
    ).toBe(false);
  });

  it('enforces the mask path ceiling per surface', () => {
    const maskPaths = Array.from(
      { length: MAX_SURFACE_MASK_PATHS + 1 },
      () => ({
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.5, y: 0.9 },
        ],
        closed: true,
        feather: 0,
      }),
    );
    expect(validateSurfaceLayout(surface({ maskPaths })).valid).toBe(false);
  });

  it('rejects a surface routed to a different output', () => {
    const result = validateOutputLayouts([
      output({ surfaces: [surface({ outputId: 'other' })] }),
    ]);
    expect(result.errors.join(' ')).toContain('routed to another output');
  });

  it('rejects duplicate surface ids across outputs', () => {
    const result = validateOutputLayouts([
      output(),
      output({
        id: 'output-2',
        surfaces: [surface({ outputId: 'output-2' })],
      }),
    ]);
    expect(result.errors.join(' ')).toContain('used by another output');
  });

  it('enforces the output count ceiling', () => {
    const outputs = Array.from({ length: MAX_OUTPUT_LAYOUTS + 1 }, (_, index) =>
      output({ id: `output-${index}`, surfaces: [] }),
    );
    expect(validateOutputLayouts(outputs).errors.join(' ')).toContain(
      'exceeds 8 outputs',
    );
  });

  it('enforces the aggregate output pixel ceiling', () => {
    const outputs = Array.from({ length: 4 }, (_, index) =>
      output({ id: `output-${index}`, width: 7680, height: 4320, surfaces: [] }),
    );
    const result = validateOutputLayouts(outputs);
    expect(result.errors.join(' ')).toContain(`${MAX_TOTAL_OUTPUT_PIXELS}`);
  });

  it('rejects fractional output dimensions', () => {
    expect(validateOutputLayouts([output({ width: 1920.5 })]).valid).toBe(false);
  });

  it('orders surfaces by layer index with a stable tie-break', () => {
    const ordered = orderedSurfaces(
      output({
        surfaces: [
          surface({ id: 'c', layerIndex: 2 }),
          surface({ id: 'b', layerIndex: 1 }),
          surface({ id: 'a', layerIndex: 1 }),
        ],
      }),
    );
    expect(ordered.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });
});

describe('edits', () => {
  const layouts = [output()];

  it('applies a valid edit', () => {
    const result = applySurfaceEdit(layouts, 'surface-1', { opacity: 0.5 });
    expect(result.applied).toBe(true);
    expect(result.outputs[0]?.surfaces[0]?.opacity).toBe(0.5);
  });

  it('keeps the previous layout when an edit is invalid', () => {
    const result = applySurfaceEdit(layouts, 'surface-1', {
      sourceUvRegion: { u0: 1, v0: 0, u1: 0, v1: 1 },
    });
    expect(result.applied).toBe(false);
    expect(result.outputs).toBe(layouts);
    expect(result.errors.join(' ')).toContain('degenerate');
  });

  it('keeps the previous layout when a warp edit folds a cell', () => {
    const folded = displaced(createMeshWarp(1, 1), 0, 1, { x: -1.5, y: 0 });
    const result = applySurfaceEdit(layouts, 'surface-1', { warp: folded });
    expect(result.applied).toBe(false);
    expect(result.outputs[0]?.surfaces[0]?.warp).toBeNull();
  });

  it('reports an unknown surface without changing anything', () => {
    const result = applySurfaceEdit(layouts, 'missing', { opacity: 0.2 });
    expect(result.applied).toBe(false);
    expect(result.outputs).toBe(layouts);
  });
});

describe('serialization', () => {
  it('round-trips a layout with a warp and a mask', () => {
    const layouts = [
      output({
        surfaces: [
          surface({
            warp: meshFromProjectionCorners({
              x0: 0.1,
              y0: 0.1,
              x1: 0.9,
              y1: 0.15,
              x2: 0.95,
              y2: 0.9,
              x3: 0.05,
              y3: 0.85,
            }),
            maskPaths: [
              {
                points: [
                  { x: 0.2, y: 0.2 },
                  { x: 0.8, y: 0.2 },
                  { x: 0.5, y: 0.8 },
                ],
                closed: true,
                feather: 0.05,
              },
            ],
          }),
        ],
      }),
    ];
    expect(parseOutputLayouts(serializeOutputLayouts(layouts))).toEqual(layouts);
  });

  it('refuses to serialize an invalid layout', () => {
    expect(() => serializeOutputLayouts([output({ width: 0 })])).toThrow(
      SurfaceLayoutError,
    );
  });

  it('rejects malformed JSON', () => {
    expect(() => parseOutputLayouts('{')).toThrow(SurfaceLayoutError);
  });

  it('rejects a payload with a missing field', () => {
    expect(() => parseOutputLayouts('[{"id":"output-1"}]')).toThrow(
      SurfaceLayoutError,
    );
  });

  it('rejects a payload whose geometry is out of bounds', () => {
    const layouts = [output({ surfaces: [surface({ opacity: 4 })] })];
    expect(() => parseOutputLayouts(JSON.stringify(layouts))).toThrow(
      SurfaceLayoutError,
    );
  });
});
