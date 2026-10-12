import { describe, expect, it } from 'vitest';

import { computeInverseProjectionMap, type ProjectionShape } from './projection';

/**
 * M1 regression lock for the shipped Projector Mapping four-corner semantics.
 *
 * Corner order is screen-space top-left, top-right, bottom-right, bottom-left
 * with y pointing down. The returned map is the inverse homography in
 * row-major order: it takes a destination frame UV (y-up) back to the source
 * UV that should be sampled.
 */

const shape = (overrides: Partial<ProjectionShape> = {}): ProjectionShape => ({
  x0: 0,
  y0: 0,
  x1: 1,
  y1: 0,
  x2: 1,
  y2: 1,
  x3: 0,
  y3: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  ...overrides,
});

interface Uv {
  u: number;
  v: number;
}

/** Row-major application: `dot(row_n, vec3(uv, 1))`. */
function sampleRowMajor(map: Float32Array, point: Uv): Uv {
  const x = (map[0] ?? 0) * point.u + (map[1] ?? 0) * point.v + (map[2] ?? 0);
  const y = (map[3] ?? 0) * point.u + (map[4] ?? 0) * point.v + (map[5] ?? 0);
  const w = (map[6] ?? 0) * point.u + (map[7] ?? 0) * point.v + (map[8] ?? 0);
  return { u: x / w, v: y / w };
}

/**
 * Application matching a GLSL `mat3(row0, row1, row2)` constructor, which
 * fills columns rather than rows and therefore transposes the buffer.
 */
function sampleColumnMajor(map: Float32Array, point: Uv): Uv {
  const x = (map[0] ?? 0) * point.u + (map[3] ?? 0) * point.v + (map[6] ?? 0);
  const y = (map[1] ?? 0) * point.u + (map[4] ?? 0) * point.v + (map[7] ?? 0);
  const w = (map[2] ?? 0) * point.u + (map[5] ?? 0) * point.v + (map[8] ?? 0);
  return { u: x / w, v: y / w };
}

/** Screen-space corner (y-down) expressed as a destination frame UV (y-up). */
const destinationUv = (x: number, y: number): Uv => ({ u: x, v: 1 - y });

describe('computeInverseProjectionMap', () => {
  it('returns an identity map for the full-frame quad', () => {
    const map = computeInverseProjectionMap(shape());
    expect(map).not.toBeNull();
    const sampled = sampleRowMajor(map as Float32Array, { u: 0.3, v: 0.7 });
    expect(sampled.u).toBeCloseTo(0.3, 6);
    expect(sampled.v).toBeCloseTo(0.7, 6);
  });

  it('maps each screen corner back to its source corner in order', () => {
    const map = computeInverseProjectionMap(
      shape({ x0: 0.14, y0: 0.2, x1: 0.86, y1: 0.2, x2: 0.86, y2: 0.8, x3: 0.14, y3: 0.8 }),
    );
    expect(map).not.toBeNull();
    const expected: readonly [Uv, Uv][] = [
      [destinationUv(0.14, 0.2), { u: 0, v: 1 }],
      [destinationUv(0.86, 0.2), { u: 1, v: 1 }],
      [destinationUv(0.86, 0.8), { u: 1, v: 0 }],
      [destinationUv(0.14, 0.8), { u: 0, v: 0 }],
    ];
    for (const [destination, source] of expected) {
      const sampled = sampleRowMajor(map as Float32Array, destination);
      expect(sampled.u).toBeCloseTo(source.u, 5);
      expect(sampled.v).toBeCloseTo(source.v, 5);
    }
  });

  it('treats Move X as a destination translation', () => {
    const map = computeInverseProjectionMap(shape({ offsetX: 0.2 }));
    expect(map).not.toBeNull();
    const sampled = sampleRowMajor(map as Float32Array, { u: 0.5, v: 0.5 });
    expect(sampled.u).toBeCloseTo(0.3, 6);
    expect(sampled.v).toBeCloseTo(0.5, 6);
  });

  it('scales the quad about the frame centre', () => {
    const map = computeInverseProjectionMap(shape({ scale: 2 }));
    expect(map).not.toBeNull();
    const sampled = sampleRowMajor(map as Float32Array, { u: 0.5, v: 0.5 });
    expect(sampled.u).toBeCloseTo(0.5, 6);
    expect(sampled.v).toBeCloseTo(0.5, 6);
    const edge = sampleRowMajor(map as Float32Array, { u: 1, v: 0.5 });
    expect(edge.u).toBeCloseTo(0.75, 6);
  });

  it('rotates counter-clockwise on screen for positive rotation', () => {
    const map = computeInverseProjectionMap(shape({ rotation: 90 }));
    expect(map).not.toBeNull();
    // Source top-left lands where screen bottom-left used to be.
    const sampled = sampleRowMajor(map as Float32Array, destinationUv(0, 1));
    expect(sampled.u).toBeCloseTo(0, 5);
    expect(sampled.v).toBeCloseTo(1, 5);
  });

  it('clamps corner coordinates into the unit square', () => {
    const clamped = computeInverseProjectionMap(
      shape({ x0: -3, y0: -3, x2: 4, y2: 4 }),
    );
    const explicit = computeInverseProjectionMap(shape());
    expect(clamped).not.toBeNull();
    expect(Array.from(clamped as Float32Array)).toEqual(
      Array.from(explicit as Float32Array),
    );
  });

  it('rejects a fully collapsed quad', () => {
    expect(
      computeInverseProjectionMap(
        shape({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, x3: 0.5, y3: 0.5 }),
      ),
    ).toBeNull();
  });

  it('rejects a collapsed edge', () => {
    expect(
      computeInverseProjectionMap(shape({ x1: 0, y1: 0, x3: 1, y3: 1 })),
    ).toBeNull();
  });

  it('still solves a folded bow-tie quad, so winding must be checked upstream', () => {
    // Swapping the two bottom corners folds the quad without making the
    // homography singular; the solver cannot reject this on its own.
    const folded = computeInverseProjectionMap(shape({ x2: 0, y2: 1, x3: 1, y3: 1 }));
    expect(folded).not.toBeNull();
  });

  it('is sampled the same way by the row-major and transposed readings only when symmetric', () => {
    const map = computeInverseProjectionMap(shape({ offsetX: 0.2 })) as Float32Array;
    const rowMajor = sampleRowMajor(map, { u: 0.5, v: 0.5 });
    const columnMajor = sampleColumnMajor(map, { u: 0.5, v: 0.5 });
    // Guards the uniform upload convention: the two readings disagree, so the
    // shader must consume uMapRow0..2 as rows, not as mat3 columns.
    expect(rowMajor.u).not.toBeCloseTo(columnMajor.u, 3);
  });
});
