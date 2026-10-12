import { describe, expect, it } from 'vitest';

import type { SurfaceLayout } from '../store/contracts';
import { createMeshWarp, meshVertexIndex } from './surfaceLayout';
import { createMaskPath, rectangleMaskNodes } from './surfaceMask';
import {
  drawSurface,
  expandTriangle,
  featherRadius,
  maskPathToDestination,
  solveTriangleAffine,
  surfaceTriangles,
  type RasterPoint,
  type RasterTriangle,
} from './surfaceRaster';

const SOURCE = { width: 200, height: 100 };
const DESTINATION = { width: 400, height: 200 };

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

/** Applies an affine to a point, mirroring canvas `setTransform`. */
function apply(
  affine: NonNullable<ReturnType<typeof solveTriangleAffine>>,
  point: RasterPoint,
): RasterPoint {
  return {
    x: affine.a * point.x + affine.c * point.y + affine.e,
    y: affine.b * point.x + affine.d * point.y + affine.f,
  };
}

interface Call {
  name: string;
  args: readonly unknown[];
}

/** Minimal recording stand-in for a 2D context. */
function recorder() {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  return {
    calls,
    context: {
      save: record('save'),
      restore: record('restore'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      closePath: record('closePath'),
      clip: record('clip'),
      fill: record('fill'),
      setTransform: record('setTransform'),
      drawImage: record('drawImage'),
      clearRect: record('clearRect'),
      fillRect: record('fillRect'),
      filter: 'none',
      fillStyle: '#000000',
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    },
  };
}

const fakeImage = {} as CanvasImageSource;

describe('triangle affine', () => {
  it('carries each source corner onto its destination corner', () => {
    const triangle: RasterTriangle = {
      source: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 5 },
      ],
      destination: [
        { x: 100, y: 20 },
        { x: 140, y: 30 },
        { x: 90, y: 60 },
      ],
    };
    const affine = solveTriangleAffine(triangle);
    expect(affine).not.toBeNull();
    if (!affine) return;
    triangle.source.forEach((point, index) => {
      const mapped = apply(affine, point);
      expect(mapped.x).toBeCloseTo(triangle.destination[index]?.x ?? 0, 6);
      expect(mapped.y).toBeCloseTo(triangle.destination[index]?.y ?? 0, 6);
    });
  });

  it('refuses a collapsed source triangle', () => {
    expect(
      solveTriangleAffine({
        source: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        destination: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      }),
    ).toBeNull();
  });
});

describe('seam overlap', () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 0, y: 30 },
  ] as const;

  /** Perpendicular distance from the centroid to one edge. */
  const edgeDistance = (
    corners: readonly RasterPoint[],
    index: number,
  ): number => {
    const from = corners[index] as RasterPoint;
    const to = corners[(index + 1) % 3] as RasterPoint;
    const centroidX = ((corners[0]?.x ?? 0) + (corners[1]?.x ?? 0) + (corners[2]?.x ?? 0)) / 3;
    const centroidY = ((corners[0]?.y ?? 0) + (corners[1]?.y ?? 0) + (corners[2]?.y ?? 0)) / 3;
    return (
      Math.abs(
        (to.x - from.x) * (centroidY - from.y) -
          (to.y - from.y) * (centroidX - from.x),
      ) / Math.hypot(to.x - from.x, to.y - from.y)
    );
  };

  it('moves every edge outward by at least the requested overlap', () => {
    const expanded = expandTriangle(triangle, 1);
    for (let index = 0; index < 3; index += 1) {
      const shift = edgeDistance(expanded, index) - edgeDistance(triangle, index);
      expect(shift).toBeGreaterThanOrEqual(1 - 1e-9);
    }
    // The closest edge is the one that sets the factor, so it moves exactly.
    const shifts = [0, 1, 2].map(
      (index) => edgeDistance(expanded, index) - edgeDistance(triangle, index),
    );
    expect(Math.min(...shifts)).toBeCloseTo(1, 6);
  });

  it('leaves a triangle unchanged when the overlap is zero', () => {
    expect(expandTriangle(triangle, 0)).toEqual([...triangle]);
  });

  it('keeps a fully collapsed corner in place', () => {
    const point = { x: 5, y: 5 };
    expect(expandTriangle([point, point, point], 2)).toEqual([
      point,
      point,
      point,
    ]);
  });
});

describe('surface triangles', () => {
  it('covers an unmapped surface with one quad', () => {
    const triangles = surfaceTriangles(surface(), SOURCE, DESTINATION);
    expect(triangles).toHaveLength(2);
    const corners = triangles.flatMap(({ destination }) => destination);
    expect(corners.some(({ x, y }) => x === 0 && y === 0)).toBe(true);
    expect(
      corners.some(
        ({ x, y }) => x === DESTINATION.width && y === DESTINATION.height,
      ),
    ).toBe(true);
  });

  it('emits two triangles per mesh cell', () => {
    const triangles = surfaceTriangles(
      surface({ warp: createMeshWarp(3, 4) }),
      SOURCE,
      DESTINATION,
    );
    expect(triangles).toHaveLength(3 * 4 * 2);
  });

  it('maps the source top-left to the destination top-left', () => {
    const [first] = surfaceTriangles(surface(), SOURCE, DESTINATION);
    expect(first?.source[0]).toEqual({ x: 0, y: 0 });
    expect(first?.destination[0]).toEqual({ x: 0, y: 0 });
  });

  it('follows a displaced vertex into the destination', () => {
    const warp = createMeshWarp(1, 1);
    const displacements = [...warp.displacements];
    displacements[meshVertexIndex(1, 0, 0)] = { x: 0.25, y: -0.5 };
    const triangles = surfaceTriangles(
      surface({ warp: { ...warp, displacements } }),
      SOURCE,
      DESTINATION,
    );
    // Top-left vertex moved right by a quarter and down by half.
    expect(triangles[0]?.destination[0]).toEqual({ x: 100, y: 100 });
    // Its source slice is unchanged, which is what produces the warp.
    expect(triangles[0]?.source[0]).toEqual({ x: 0, y: 0 });
  });

  it('samples only the requested source region', () => {
    const triangles = surfaceTriangles(
      surface({ sourceUvRegion: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 } }),
      SOURCE,
      DESTINATION,
    );
    const xs = triangles.flatMap(({ source }) => source.map(({ x }) => x));
    const ys = triangles.flatMap(({ source }) => source.map(({ y }) => y));
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(200, 6);
    // v 0..0.5 in y-up is the lower half, which is y 50..100 in pixels.
    expect(Math.min(...ys)).toBeCloseTo(50, 6);
    expect(Math.max(...ys)).toBeCloseTo(100, 6);
  });
});

describe('mask projection', () => {
  const path = createMaskPath(rectangleMaskNodes(0.25, 0.25, 0.75, 0.75), true, 0.1);

  it('flips mask points into canvas space', () => {
    const points = maskPathToDestination(path, DESTINATION);
    expect(points).toContainEqual({ x: 100, y: 50 });
    expect(points).toContainEqual({ x: 300, y: 150 });
  });

  it('scales feathering by the smaller output axis', () => {
    expect(featherRadius(path, DESTINATION)).toBeCloseTo(10, 6);
    expect(featherRadius({ ...path, feather: 0 }, DESTINATION)).toBe(0);
  });
});

describe('drawSurface', () => {
  it('clips and draws every triangle', () => {
    const { calls, context } = recorder();
    const drawn = drawSurface(context, surface({ warp: createMeshWarp(2, 2) }), {
      source: fakeImage,
      sourceSize: SOURCE,
      destinationSize: DESTINATION,
    });
    expect(drawn).toBe(8);
    expect(calls.filter(({ name }) => name === 'clip')).toHaveLength(8);
    expect(calls.filter(({ name }) => name === 'drawImage')).toHaveLength(8);
    expect(calls.filter(({ name }) => name === 'save')).toHaveLength(8);
    expect(calls.filter(({ name }) => name === 'restore')).toHaveLength(8);
  });

  it('skips a degenerate cell instead of smearing it', () => {
    const warp = createMeshWarp(1, 1);
    const collapsed = {
      ...warp,
      displacements: warp.displacements.map(() => ({ x: 0, y: 0 })),
    };
    const { context } = recorder();
    // A zero-area source region leaves every triangle unsolvable.
    const drawn = drawSurface(
      context,
      surface({
        warp: collapsed,
        sourceUvRegion: { u0: 0.5, v0: 0.5, u1: 0.5, v1: 0.5 },
      }),
      { source: fakeImage, sourceSize: SOURCE, destinationSize: DESTINATION },
    );
    expect(drawn).toBe(0);
  });

  it('applies masks only when a mask target is supplied', () => {
    const masked = surface({
      maskPaths: [createMaskPath(rectangleMaskNodes(0.2, 0.2, 0.8, 0.8), true, 0.1)],
    });
    const withoutMask = recorder();
    drawSurface(withoutMask.context, masked, {
      source: fakeImage,
      sourceSize: SOURCE,
      destinationSize: DESTINATION,
    });
    expect(
      withoutMask.calls.some(({ name }) => name === 'fillRect'),
    ).toBe(false);

    const main = recorder();
    const mask = recorder();
    drawSurface(main.context, masked, {
      source: fakeImage,
      sourceSize: SOURCE,
      destinationSize: DESTINATION,
      mask: { context: mask.context, canvas: fakeImage },
    });
    expect(mask.calls.some(({ name }) => name === 'fillRect')).toBe(true);
    expect(mask.calls.filter(({ name }) => name === 'fill')).toHaveLength(1);
    expect(main.context.globalCompositeOperation).toBe('destination-in');
  });

  it('ignores an open mask path, which encloses no area', () => {
    const mask = recorder();
    const main = recorder();
    drawSurface(
      main.context,
      surface({
        maskPaths: [
          { points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], closed: false, feather: 0.1 },
        ],
      }),
      {
        source: fakeImage,
        sourceSize: SOURCE,
        destinationSize: DESTINATION,
        mask: { context: mask.context, canvas: fakeImage },
      },
    );
    expect(mask.calls.filter(({ name }) => name === 'fill')).toHaveLength(0);
  });
});
