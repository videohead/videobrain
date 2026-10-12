/**
 * M2 (manual surface and mask editor) — warped and masked composition.
 *
 * Splits a surface's mesh into triangles, maps each one from its slice of
 * the source frame onto its displaced destination, and applies the surface
 * masks as a coverage pass. The geometry is pure maths so it can be tested
 * without a canvas; `drawSurface` is the thin 2D-context wrapper the editor
 * preview and any later output surface share.
 *
 * Destination coordinates are canvas pixels (y-down). Surface and source
 * coordinates are UV (y-up), converted here and nowhere else.
 */
import type { SurfaceLayout, SurfaceMaskPath } from '../store/contracts';
import { meshVertexUv } from './surfaceLayout';

export interface RasterPoint {
  x: number;
  y: number;
}

export interface RasterTriangle {
  /** Source pixels in the frame being sampled. */
  source: readonly [RasterPoint, RasterPoint, RasterPoint];
  /** Destination pixels on the output canvas. */
  destination: readonly [RasterPoint, RasterPoint, RasterPoint];
}

export interface RasterSize {
  width: number;
  height: number;
}

/** Affine transform `a c e / b d f` mapping source pixels to destination. */
export interface RasterAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Solves the affine transform carrying the source triangle onto the
 * destination triangle. Returns null when the source triangle is
 * degenerate and the mapping is therefore undefined.
 */
export function solveTriangleAffine(
  triangle: RasterTriangle,
): RasterAffine | null {
  const [s0, s1, s2] = triangle.source;
  const [d0, d1, d2] = triangle.destination;
  const determinant =
    (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return null;
  }
  const a =
    ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) /
    determinant;
  const c =
    ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) /
    determinant;
  const b =
    ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) /
    determinant;
  const d =
    ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) /
    determinant;
  return {
    a,
    b,
    c,
    d,
    e: d0.x - a * s0.x - c * s0.y,
    f: d0.y - b * s0.x - d * s0.y,
  };
}

/**
 * Default clip overlap, in destination pixels.
 *
 * Canvas clipping is antialiased, so two triangles meeting along a shared
 * edge each cover part of the boundary pixels and leave a visibly
 * translucent seam. Expanding every clip outward by a whole pixel makes
 * neighbours overlap rather than abut, so one of them always covers the
 * boundary pixel completely. Half a pixel still left a residual alpha dip.
 */
export const DEFAULT_SEAM_OVERLAP = 1;

/**
 * Grows a triangle about its centroid so that every edge moves outward by
 * at least `amount` pixels.
 *
 * Scaling about the centroid shifts an edge in proportion to its distance
 * from that centroid, so the factor is chosen from the closest edge. Corners
 * therefore travel further than `amount`, which is harmless for a clip.
 */
export function expandTriangle(
  triangle: readonly [RasterPoint, RasterPoint, RasterPoint],
  amount: number,
): [RasterPoint, RasterPoint, RasterPoint] {
  const copy = (): [RasterPoint, RasterPoint, RasterPoint] => [
    { x: triangle[0].x, y: triangle[0].y },
    { x: triangle[1].x, y: triangle[1].y },
    { x: triangle[2].x, y: triangle[2].y },
  ];
  if (amount === 0) {
    return copy();
  }
  const centroidX = (triangle[0].x + triangle[1].x + triangle[2].x) / 3;
  const centroidY = (triangle[0].y + triangle[1].y + triangle[2].y) / 3;

  let nearestEdge = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 3; index += 1) {
    const from = triangle[index] as RasterPoint;
    const to = triangle[(index + 1) % 3] as RasterPoint;
    const edgeLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (edgeLength < 1e-9) {
      continue;
    }
    const perpendicular =
      Math.abs(
        (to.x - from.x) * (centroidY - from.y) -
          (to.y - from.y) * (centroidX - from.x),
      ) / edgeLength;
    nearestEdge = Math.min(nearestEdge, perpendicular);
  }
  if (!Number.isFinite(nearestEdge) || nearestEdge < 1e-9) {
    return copy();
  }

  const factor = 1 + amount / nearestEdge;
  return [
    {
      x: centroidX + (triangle[0].x - centroidX) * factor,
      y: centroidY + (triangle[0].y - centroidY) * factor,
    },
    {
      x: centroidX + (triangle[1].x - centroidX) * factor,
      y: centroidY + (triangle[1].y - centroidY) * factor,
    },
    {
      x: centroidX + (triangle[2].x - centroidX) * factor,
      y: centroidY + (triangle[2].y - centroidY) * factor,
    },
  ];
}

/** Surface UV (y-up) to destination canvas pixels (y-down). */
const toDestination = (
  uv: { u: number; v: number },
  size: RasterSize,
): RasterPoint => ({ x: uv.u * size.width, y: (1 - uv.v) * size.height });

/** Source UV (y-up) to source frame pixels (y-down). */
const toSource = (
  u: number,
  v: number,
  size: RasterSize,
): RasterPoint => ({ x: u * size.width, y: (1 - v) * size.height });

/**
 * Triangles covering one surface. A surface without a mesh contributes a
 * single undisplaced quad, which keeps an unmapped surface identical to a
 * straight blit.
 */
export function surfaceTriangles(
  surface: SurfaceLayout,
  sourceSize: RasterSize,
  destinationSize: RasterSize,
): RasterTriangle[] {
  const region = surface.sourceUvRegion;
  const warp = surface.warp;
  const rows = warp?.rows ?? 1;
  const cols = warp?.cols ?? 1;
  const triangles: RasterTriangle[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cornerUv = (cornerRow: number, cornerCol: number) =>
        warp
          ? meshVertexUv(warp, cornerRow, cornerCol)
          : { u: cornerCol / cols, v: 1 - cornerRow / rows };

      const destinations = [
        toDestination(cornerUv(row, col), destinationSize),
        toDestination(cornerUv(row, col + 1), destinationSize),
        toDestination(cornerUv(row + 1, col + 1), destinationSize),
        toDestination(cornerUv(row + 1, col), destinationSize),
      ] as const;

      // The source slice mirrors the undisplaced grid position of the cell.
      const spanU = region.u1 - region.u0;
      const spanV = region.v1 - region.v0;
      const u0 = region.u0 + (col / cols) * spanU;
      const u1 = region.u0 + ((col + 1) / cols) * spanU;
      const v0 = region.v1 - (row / rows) * spanV;
      const v1 = region.v1 - ((row + 1) / rows) * spanV;
      const sources = [
        toSource(u0, v0, sourceSize),
        toSource(u1, v0, sourceSize),
        toSource(u1, v1, sourceSize),
        toSource(u0, v1, sourceSize),
      ] as const;

      triangles.push(
        {
          source: [sources[0], sources[1], sources[2]],
          destination: [destinations[0], destinations[1], destinations[2]],
        },
        {
          source: [sources[0], sources[2], sources[3]],
          destination: [destinations[0], destinations[2], destinations[3]],
        },
      );
    }
  }
  return triangles;
}

/** Mask path converted to destination canvas pixels. */
export function maskPathToDestination(
  path: SurfaceMaskPath,
  size: RasterSize,
): RasterPoint[] {
  return path.points.map((point) => toDestination({ u: point.x, v: point.y }, size));
}

/**
 * Feather radius in destination pixels. Feather is a fraction of the
 * surface, so it scales with the smaller output axis to stay isotropic.
 */
export function featherRadius(
  path: SurfaceMaskPath,
  size: RasterSize,
): number {
  return (path.feather * Math.min(size.width, size.height)) / 2;
}

type Context2D = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'clip'
  | 'fill'
  | 'setTransform'
  | 'drawImage'
  | 'clearRect'
  | 'fillRect'
> & {
  filter?: string;
  fillStyle?: string | CanvasGradient | CanvasPattern;
  globalCompositeOperation?: GlobalCompositeOperation;
  imageSmoothingEnabled?: boolean;
};

/** Scratch surface used to accumulate mask coverage before compositing. */
export interface MaskTarget {
  context: Context2D;
  canvas: CanvasImageSource;
}

export interface DrawSurfaceOptions {
  source: CanvasImageSource;
  sourceSize: RasterSize;
  destinationSize: RasterSize;
  /** Supply when masks should be applied; omitted draws geometry only. */
  mask?: MaskTarget;
  /** Clip overlap in destination pixels. Defaults to DEFAULT_SEAM_OVERLAP. */
  seamOverlap?: number;
}

/**
 * Draws one surface's warped frame, then removes whatever its masks
 * exclude. Returns the number of triangles actually rasterized, so callers
 * can tell a skipped degenerate cell from an empty surface.
 */
export function drawSurface(
  context: Context2D,
  surface: SurfaceLayout,
  options: DrawSurfaceOptions,
): number {
  const { source, sourceSize, destinationSize } = options;
  const triangles = surfaceTriangles(surface, sourceSize, destinationSize);
  let drawn = 0;

  for (const triangle of triangles) {
    const affine = solveTriangleAffine(triangle);
    if (!affine) {
      continue;
    }
    // The clip is widened, but the affine still comes from the true corners,
    // so the overlap samples slightly beyond the cell rather than distorting it.
    const [d0, d1, d2] = expandTriangle(
      triangle.destination,
      options.seamOverlap ?? DEFAULT_SEAM_OVERLAP,
    );
    context.save();
    context.beginPath();
    context.moveTo(d0.x, d0.y);
    context.lineTo(d1.x, d1.y);
    context.lineTo(d2.x, d2.y);
    context.closePath();
    context.clip();
    context.setTransform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
    context.drawImage(source, 0, 0, sourceSize.width, sourceSize.height);
    context.restore();
    drawn += 1;
  }

  if (options.mask && surface.maskPaths.length > 0) {
    applyMasks(context, options.mask, surface.maskPaths, destinationSize);
  }
  return drawn;
}

/**
 * Builds the combined mask coverage on its own surface and punches it into
 * the destination. Masks intersect, so each path is applied in turn.
 */
export function applyMasks(
  context: Context2D,
  mask: MaskTarget,
  paths: readonly SurfaceMaskPath[],
  size: RasterSize,
): void {
  const maskContext = mask.context;
  maskContext.save();
  maskContext.setTransform(1, 0, 0, 1, 0, 0);
  maskContext.clearRect(0, 0, size.width, size.height);
  maskContext.fillStyle = '#ffffff';
  maskContext.fillRect(0, 0, size.width, size.height);
  maskContext.globalCompositeOperation = 'destination-in';

  for (const path of paths) {
    const points = maskPathToDestination(path, size);
    if (points.length < 3 || !path.closed) {
      continue;
    }
    const radius = featherRadius(path, size);
    maskContext.filter = radius > 0 ? `blur(${radius}px)` : 'none';
    maskContext.beginPath();
    const [first, ...rest] = points;
    if (!first) {
      continue;
    }
    maskContext.moveTo(first.x, first.y);
    for (const point of rest) {
      maskContext.lineTo(point.x, point.y);
    }
    maskContext.closePath();
    maskContext.fill();
  }
  maskContext.filter = 'none';
  maskContext.restore();

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(mask.canvas, 0, 0, size.width, size.height);
  context.restore();
}
