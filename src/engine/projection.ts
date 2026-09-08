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
 */
export function computeInverseProjectionMap(
  shape: ProjectionShape,
): Float32Array | null {
  const corners: Point[] = [
    { x: shape.x0, y: shape.y0 },
    { x: shape.x1, y: shape.y1 },
    { x: shape.x2, y: shape.y2 },
    { x: shape.x3, y: shape.y3 },
  ].map((corner) => ({
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
  const sources = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];

  const rows: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const s = sources[index];
    const d = transformed[index];
    rows.push([
      s.x,
      s.y,
      1,
      0,
      0,
      0,
      -s.x * d.x,
      -s.y * d.x,
      d.x,
    ]);
    rows.push([
      0,
      0,
      0,
      s.x,
      s.y,
      1,
      -s.x * d.y,
      -s.y * d.y,
      d.y,
    ]);
  }

  const augmented = rows.map((row) => [...row, 1]);

  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let r = column + 1; r < 8; r += 1) {
      if (Math.abs(augmented[r][column]) > Math.abs(augmented[pivot][column])) {
        pivot = r;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      return null;
    }
    const swap = augmented[column];
    augmented[column] = augmented[pivot];
    augmented[pivot] = swap;
    const pivotValue = augmented[column][column];
    for (let c = 0; c < 9; c += 1) {
      augmented[column][c] /= pivotValue;
    }
    for (let r = 0; r < 8; r += 1) {
      if (r === column) {
        continue;
      }
      const factor = augmented[r][column];
      for (let c = 0; c < 9; c += 1) {
        augmented[r][c] -= factor * augmented[column][c];
      }
    }
  }

  const h = augmented.map((row) => row[8]);
  const m = [
    [h[0], h[1], h[6]],
    [h[2], h[3], h[7]],
    [h[4], h[5], 1],
  ];

  const determinant =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }

  const inverse = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / determinant,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / determinant,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / determinant,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / determinant,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / determinant,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / determinant,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / determinant,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / determinant,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / determinant,
    ],
  ];

  const flat = new Float32Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      flat[r * 3 + c] = inverse[r][c];
    }
  }
  return flat;
}
