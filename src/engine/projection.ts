export interface ProjectionShape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
}

interface Point {
  x: number;
  y: number;
}

const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

/**
 * Applies the whole-shape transform (move, scale, rotate around the canvas
 * center) to a screen-space corner. Rotation is visually counter-clockwise.
 */
function transformCorner(corner: Point, shape: ProjectionShape): Point {
  const dx = corner.x - 0.5;
  const dy = corner.y - 0.5;
  const scaledX = dx * shape.scale + shape.offsetX;
  const scaledY = dy * shape.scale + shape.offsetY;
  const radians = (shape.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: 0.5 + cosine * scaledX + sine * scaledY,
    y: 0.5 - sine * scaledX + cosine * scaledY,
  };
}

/**
 * Solves the 3x3 homography (with m33 = 1) that maps the unit square
 * (vUv space, origin bottom-left) to the four given corners, then returns
 * its inverse flattened row-major. Returns null when the quad is degenerate.
 *
 * Written with fixed-size tuples and explicit non-null locals so it typechecks
 * under `noUncheckedIndexedAccess` (tsc -b build mode).
 */
export function computeInverseProjectionMap(
  shape: ProjectionShape,
): Float32Array | null {
  const cornerInputs: readonly [Point, Point, Point, Point] = [
    { x: shape.x0, y: shape.y0 },
    { x: shape.x1, y: shape.y1 },
    { x: shape.x2, y: shape.y2 },
    { x: shape.x3, y: shape.y3 },
  ];
  const corners = cornerInputs.map((corner) => ({
    x: clampUnit(corner.x),
    y: clampUnit(corner.y),
  }));

  const transformed = corners.map((corner) => {
    const moved = transformCorner(corner, shape);
    // Screen space is y-down; vUv is y-up.
    return { x: moved.x, y: 1 - moved.y };
  });

  // Source corners (vUv, bottom-left origin) in the same order as the
  // screen corners top-left -> top-right -> bottom-right -> bottom-left.
  const sources: readonly [Point, Point, Point, Point] = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];

  // 8 rows x 9 columns (8 unknowns + RHS) for the homography solve.
  const augmented: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const s = sources[index] as Point;
    const d = transformed[index] as Point;
    augmented.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x, d.x]);
    augmented.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y, d.y]);
  }

  // Gaussian elimination with partial pivoting to reduced row echelon form.
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    let pivotMagnitude = Math.abs(augmented[column]?.[column] ?? 0);
    for (let r = column + 1; r < 8; r += 1) {
      const magnitude = Math.abs(augmented[r]?.[column] ?? 0);
      if (magnitude > pivotMagnitude) {
        pivot = r;
        pivotMagnitude = magnitude;
      }
    }
    if (pivotMagnitude < 1e-12) {
      return null;
    }
    if (pivot !== column) {
      const swap = augmented[column] as number[];
      augmented[column] = augmented[pivot] as number[];
      augmented[pivot] = swap;
    }
    const pivotRow = augmented[column] as number[];
    const pivotValue = pivotRow[column] as number;
    for (let c = 0; c < 9; c += 1) {
      pivotRow[c] = (pivotRow[c] as number) / pivotValue;
    }
    for (let r = 0; r < 8; r += 1) {
      if (r === column) {
        continue;
      }
      const row = augmented[r] as number[];
      const factor = row[column] as number;
      if (factor === 0) {
        continue;
      }
      for (let c = 0; c < 9; c += 1) {
        row[c] = (row[c] as number) - factor * (pivotRow[c] as number);
      }
    }
  }

  // The 9th column now holds h11..h32 (m33 = 1).
  const h = augmented.map((row) => row[8] ?? 0);
  const m00 = h[0] ?? 0;
  const m01 = h[1] ?? 0;
  const m02 = h[6] ?? 0;
  const m10 = h[2] ?? 0;
  const m11 = h[3] ?? 0;
  const m12 = h[7] ?? 0;
  const m20 = h[4] ?? 0;
  const m21 = h[5] ?? 0;
  const m22 = 1;

  const determinant =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }

  const inverse: number[][] = [
    [
      (m11 * m22 - m12 * m21) / determinant,
      (m02 * m21 - m01 * m22) / determinant,
      (m01 * m12 - m02 * m11) / determinant,
    ],
    [
      (m12 * m20 - m10 * m22) / determinant,
      (m00 * m22 - m02 * m20) / determinant,
      (m02 * m10 - m00 * m12) / determinant,
    ],
    [
      (m10 * m21 - m11 * m20) / determinant,
      (m01 * m20 - m00 * m21) / determinant,
      (m00 * m11 - m01 * m10) / determinant,
    ],
  ];

  const flat = new Float32Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      flat[r * 3 + c] = inverse[r]?.[c] ?? 0;
    }
  }
  return flat;
}
