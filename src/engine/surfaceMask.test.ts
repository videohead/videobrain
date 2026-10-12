import { describe, expect, it } from 'vitest';

import {
  MAX_SURFACE_MASK_NODES,
  MAX_SURFACE_MASK_POINTS,
  type SurfaceMaskPoint,
} from '../store/contracts';
import {
  cornerNode,
  createMaskPath,
  ellipseMaskNodes,
  fitFreehandNodes,
  maskCoverage,
  rectangleMaskNodes,
  simplifyFreehand,
  smoothNode,
  surfaceMaskCoverage,
  tessellateMaskNodes,
  validateMaskNodes,
  withMaskNodes,
} from './surfaceMask';
import { validateMaskPath } from './surfaceLayout';

const square = rectangleMaskNodes(0.25, 0.25, 0.75, 0.75);

describe('tessellation', () => {
  it('keeps straight corners on their authored points', () => {
    const points = tessellateMaskNodes(square, true);
    // A flat segment needs no interior samples at all.
    expect(points).toHaveLength(square.length);
    for (const node of square) {
      expect(
        points.some(
          (point) =>
            Math.abs(point.x - node.point.x) < 1e-9 &&
            Math.abs(point.y - node.point.y) < 1e-9,
        ),
      ).toBe(true);
    }
  });

  it('emits the final node for an open path', () => {
    const open = [
      cornerNode({ x: 0.1, y: 0.1 }),
      cornerNode({ x: 0.9, y: 0.9 }),
    ];
    const points = tessellateMaskNodes(open, false);
    expect(points[points.length - 1]).toEqual({ x: 0.9, y: 0.9 });
  });

  it('samples a curved segment more densely than a straight one', () => {
    const straight = tessellateMaskNodes(
      [cornerNode({ x: 0, y: 0.5 }), cornerNode({ x: 1, y: 0.5 })],
      false,
    );
    const curved = tessellateMaskNodes(
      [
        smoothNode({ x: 0, y: 0.5 }, { x: 0.1, y: 0.45 }),
        smoothNode({ x: 1, y: 0.5 }, { x: 0.1, y: -0.45 }),
      ],
      false,
    );
    expect(curved.length).toBeGreaterThan(straight.length);
  });

  it('never exceeds the point budget, even for a dense path', () => {
    const nodes = Array.from({ length: MAX_SURFACE_MASK_NODES }, (_, index) => {
      const angle = (index / MAX_SURFACE_MASK_NODES) * Math.PI * 2;
      return smoothNode(
        { x: 0.5 + Math.cos(angle) * 0.4, y: 0.5 + Math.sin(angle) * 0.4 },
        { x: -Math.sin(angle) * 0.05, y: Math.cos(angle) * 0.05 },
      );
    });
    const points = tessellateMaskNodes(nodes, true);
    expect(points.length).toBeLessThanOrEqual(MAX_SURFACE_MASK_POINTS);
    expect(points.length).toBeGreaterThan(MAX_SURFACE_MASK_NODES);
  });

  it('traces an ellipse within a quarter percent of its radius', () => {
    const points = tessellateMaskNodes(
      ellipseMaskNodes(0.5, 0.5, 0.3, 0.3),
      true,
    );
    for (const point of points) {
      expect(Math.hypot(point.x - 0.5, point.y - 0.5)).toBeCloseTo(0.3, 2);
    }
  });
});

describe('mask paths', () => {
  it('produces a path the M1 validator accepts', () => {
    const path = createMaskPath(square, true, 0.05);
    expect(validateMaskPath(path).valid).toBe(true);
    expect(path.nodes).toHaveLength(4);
  });

  it('clamps feather into range', () => {
    expect(createMaskPath(square, true, 9).feather).toBe(1);
    expect(createMaskPath(square, true, -2).feather).toBe(0);
  });

  it('drops nodes beyond the authored ceiling', () => {
    const many = Array.from({ length: MAX_SURFACE_MASK_NODES + 10 }, (_, i) =>
      cornerNode({ x: (i % 10) / 10, y: Math.floor(i / 10) / 10 }),
    );
    expect(createMaskPath(many, true).nodes).toHaveLength(
      MAX_SURFACE_MASK_NODES,
    );
  });

  it('re-tessellates when nodes change but keeps closed and feather', () => {
    const path = createMaskPath(square, true, 0.2);
    const moved = withMaskNodes(path, ellipseMaskNodes(0.5, 0.5, 0.2, 0.2));
    expect(moved.closed).toBe(true);
    expect(moved.feather).toBe(0.2);
    expect(moved.points).not.toEqual(path.points);
  });

  it('rejects nodes outside the surface', () => {
    const result = validateMaskNodes(
      [...square, cornerNode({ x: 1.6, y: 0.5 })],
      true,
    );
    expect(result.errors.join(' ')).toContain('outside the surface');
  });

  it('requires enough nodes to close a path', () => {
    expect(validateMaskNodes(square.slice(0, 2), true).valid).toBe(false);
    expect(validateMaskNodes(square.slice(0, 2), false).valid).toBe(true);
  });

  it('rejects non-finite handles', () => {
    const broken = [
      { ...(square[0] as (typeof square)[0]), handleOut: { x: Number.NaN, y: 0 } },
      ...square.slice(1),
    ];
    expect(validateMaskNodes(broken, true).errors.join(' ')).toContain(
      'handleOut is not a finite point',
    );
  });
});

describe('freehand capture', () => {
  const noisyLine: SurfaceMaskPoint[] = Array.from(
    { length: 40 },
    (_, index) => ({
      x: index / 39,
      y: 0.5 + (index % 2 === 0 ? 0.001 : -0.001),
    }),
  );

  it('simplifies a nearly straight stroke to its endpoints', () => {
    expect(simplifyFreehand(noisyLine, 0.01)).toHaveLength(2);
  });

  it('keeps a genuine corner', () => {
    const corner: SurfaceMaskPoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
    ];
    expect(simplifyFreehand(corner, 0.01)).toHaveLength(3);
  });

  it('fits editable nodes a user can keep adjusting', () => {
    const arc: SurfaceMaskPoint[] = Array.from({ length: 30 }, (_, index) => {
      const angle = (index / 29) * Math.PI;
      return { x: 0.5 + Math.cos(angle) * 0.3, y: 0.5 + Math.sin(angle) * 0.3 };
    });
    const nodes = fitFreehandNodes(arc, { tolerance: 0.005 });
    expect(nodes.length).toBeGreaterThan(2);
    expect(nodes.length).toBeLessThanOrEqual(MAX_SURFACE_MASK_NODES);
    expect(validateMaskNodes(nodes, false).valid).toBe(true);
    // Interior nodes carry tangents; the endpoints stay hard corners.
    expect(nodes[0]?.handleOut).toEqual({ x: 0, y: 0 });
    expect(nodes[1]?.handleOut).not.toEqual({ x: 0, y: 0 });
  });

  it('bounds a very long stroke to the node ceiling', () => {
    const scribble: SurfaceMaskPoint[] = Array.from(
      { length: 2000 },
      (_, index) => ({
        x: 0.5 + Math.cos(index) * 0.4,
        y: 0.5 + Math.sin(index * 1.7) * 0.4,
      }),
    );
    const nodes = fitFreehandNodes(scribble, { tolerance: 0.0001 });
    expect(nodes.length).toBeLessThanOrEqual(MAX_SURFACE_MASK_NODES);
    expect(
      createMaskPath(nodes, true).points.length,
    ).toBeLessThanOrEqual(MAX_SURFACE_MASK_POINTS);
  });

  it('drops a duplicated closing sample', () => {
    const loop: SurfaceMaskPoint[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.2 },
    ];
    const nodes = fitFreehandNodes(loop, { closed: true, tolerance: 0.001 });
    expect(nodes).toHaveLength(3);
  });

  it('ignores non-finite samples', () => {
    expect(
      fitFreehandNodes([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0.5 },
        { x: 1, y: 1 },
      ]),
    ).toHaveLength(2);
  });

  it('returns nothing for an empty stroke', () => {
    expect(fitFreehandNodes([])).toEqual([]);
  });
});

describe('coverage', () => {
  it('fills inside and clears outside a hard-edged mask', () => {
    const path = createMaskPath(square, true, 0);
    expect(maskCoverage(path, { x: 0.5, y: 0.5 })).toBe(1);
    expect(maskCoverage(path, { x: 0.05, y: 0.5 })).toBe(0);
  });

  it('ramps smoothly across a feathered edge', () => {
    const path = createMaskPath(square, true, 0.2);
    const inside = maskCoverage(path, { x: 0.5, y: 0.5 });
    const edge = maskCoverage(path, { x: 0.25, y: 0.5 });
    const outside = maskCoverage(path, { x: 0.05, y: 0.5 });
    expect(inside).toBeCloseTo(1, 2);
    expect(edge).toBeCloseTo(0.5, 2);
    expect(outside).toBeCloseTo(0, 2);
    expect(edge).toBeGreaterThan(outside);
    expect(inside).toBeGreaterThan(edge);
  });

  it('treats an open path as a feathered stroke, not a fill', () => {
    const stroke = createMaskPath(
      [cornerNode({ x: 0.1, y: 0.5 }), cornerNode({ x: 0.9, y: 0.5 })],
      false,
      0.2,
    );
    expect(maskCoverage(stroke, { x: 0.5, y: 0.5 })).toBeCloseTo(1, 5);
    expect(maskCoverage(stroke, { x: 0.5, y: 0.9 })).toBe(0);
  });

  it('intersects several masks by taking the smallest coverage', () => {
    const left = createMaskPath(rectangleMaskNodes(0, 0, 0.6, 1), true, 0);
    const right = createMaskPath(rectangleMaskNodes(0.4, 0, 1, 1), true, 0);
    expect(surfaceMaskCoverage([left, right], { x: 0.5, y: 0.5 })).toBe(1);
    expect(surfaceMaskCoverage([left, right], { x: 0.2, y: 0.5 })).toBe(0);
    expect(surfaceMaskCoverage([left, right], { x: 0.8, y: 0.5 })).toBe(0);
  });

  it('leaves the surface untouched when no mask is present', () => {
    expect(surfaceMaskCoverage([], { x: 0.5, y: 0.5 })).toBe(1);
  });
});
