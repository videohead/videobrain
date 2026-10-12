/**
 * M2 (manual surface and mask editor) — GPU-free mask geometry.
 *
 * Authored masks are cubic Bezier node chains in surface-local coordinates
 * (y-up, bottom-left origin, matching `surfaceLayout`). Every authored path
 * is tessellated into the bounded point list that `SurfaceMaskPath` already
 * carries, so renderers and persistence never need the authored form.
 *
 * Freehand input is captured as raw samples, simplified, and fitted to the
 * same cubic nodes. That satisfies the Contracts rule that freehand produces
 * editable bounded paths; painted brush content is a separate child task.
 */
import {
  MAX_SURFACE_MASK_NODES,
  MAX_SURFACE_MASK_POINTS,
  type SurfaceMaskNode,
  type SurfaceMaskPath,
  type SurfaceMaskPoint,
} from '../store/contracts';

export { MAX_SURFACE_MASK_NODES, MAX_SURFACE_MASK_POINTS };

/**
 * Samples per cubic segment, before the whole-path budget is applied.
 * A perfectly flat segment needs only its start point, because the next
 * segment contributes the shared end point.
 */
export const MIN_SEGMENT_SAMPLES = 1;
export const MAX_SEGMENT_SAMPLES = 24;

/** Target chord deviation, in surface UV units, for a full-detail path. */
export const MASK_FLATNESS_TOLERANCE = 1e-4;

/** Circular-arc handle length for a quarter turn. */
const ARC_HANDLE = 0.5522847498307933;

const ORIGIN: SurfaceMaskPoint = { x: 0, y: 0 };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: number): boolean => Number.isFinite(value);

const add = (a: SurfaceMaskPoint, b: SurfaceMaskPoint): SurfaceMaskPoint => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

const subtract = (
  a: SurfaceMaskPoint,
  b: SurfaceMaskPoint,
): SurfaceMaskPoint => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Adding zero normalizes `-0` to `0`. JSON has no negative zero, so without
 * this a mirrored handle would not survive a save/reopen cycle unchanged.
 */
const scale = (point: SurfaceMaskPoint, factor: number): SurfaceMaskPoint => ({
  x: point.x * factor + 0,
  y: point.y * factor + 0,
});

const distance = (a: SurfaceMaskPoint, b: SurfaceMaskPoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** A node with both handles collapsed: the path turns a hard corner here. */
export function cornerNode(point: SurfaceMaskPoint): SurfaceMaskNode {
  return { point, handleIn: ORIGIN, handleOut: ORIGIN };
}

/** Mirrored handles, so the curve passes smoothly through the node. */
export function smoothNode(
  point: SurfaceMaskPoint,
  handleOut: SurfaceMaskPoint,
): SurfaceMaskNode {
  return { point, handleIn: scale(handleOut, -1), handleOut };
}

// ═══════════════════════════════════════════════════════════════
// Tessellation
// ═══════════════════════════════════════════════════════════════

function cubicAt(
  p0: SurfaceMaskPoint,
  p1: SurfaceMaskPoint,
  p2: SurfaceMaskPoint,
  p3: SurfaceMaskPoint,
  t: number,
): SurfaceMaskPoint {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Ordered node pairs that form the path's segments. */
function segments(
  nodes: readonly SurfaceMaskNode[],
  closed: boolean,
): readonly (readonly [SurfaceMaskNode, SurfaceMaskNode])[] {
  const pairs: (readonly [SurfaceMaskNode, SurfaceMaskNode])[] = [];
  const last = closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    if (from && to) {
      pairs.push([from, to]);
    }
  }
  return pairs;
}

/**
 * Samples one segment from how far its control polygon departs from the
 * straight chord, so a flat run costs a single point while a tight curve
 * earns detail up to `MAX_SEGMENT_SAMPLES`. `tolerance` is the accepted
 * chord deviation; the caller raises it to fit the whole-path budget.
 */
function segmentSamples(
  from: SurfaceMaskNode,
  to: SurfaceMaskNode,
  tolerance: number,
): number {
  const p0 = from.point;
  const p1 = add(from.point, from.handleOut);
  const p2 = add(to.point, to.handleIn);
  const p3 = to.point;
  const polygon = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
  const chord = distance(p0, p3);
  const deviation = Math.max(0, polygon - chord);
  const requested = Math.ceil(Math.sqrt(deviation / tolerance));
  return clamp(requested, MIN_SEGMENT_SAMPLES, MAX_SEGMENT_SAMPLES);
}

/**
 * Converts authored nodes into a bounded point list.
 *
 * Sampling density is reduced uniformly until the whole path fits inside
 * `MAX_SURFACE_MASK_POINTS`, so a complex path loses detail rather than
 * breaching the budget.
 */
export function tessellateMaskNodes(
  nodes: readonly SurfaceMaskNode[],
  closed: boolean,
): SurfaceMaskPoint[] {
  const pairs = segments(nodes, closed);
  if (pairs.length === 0) {
    return nodes.map(({ point }) => ({ x: point.x, y: point.y }));
  }

  let tolerance = MASK_FLATNESS_TOLERANCE;
  let counts = pairs.map(([from, to]) => segmentSamples(from, to, tolerance));
  const total = () => counts.reduce((sum, count) => sum + count, 0);
  // An open path also emits its final node, so it costs one extra point.
  const overhead = closed ? 0 : 1;
  // Relax the flatness target until the whole path fits its budget. Each
  // pass quarters the sample count, so this converges in a few rounds.
  while (total() + overhead > MAX_SURFACE_MASK_POINTS) {
    const relaxed = tolerance * 16;
    const next = pairs.map(([from, to]) => segmentSamples(from, to, relaxed));
    if (next.every((count, index) => count === counts[index])) {
      break;
    }
    tolerance = relaxed;
    counts = next;
  }

  const points: SurfaceMaskPoint[] = [];
  pairs.forEach(([from, to], index) => {
    const samples = counts[index] ?? MIN_SEGMENT_SAMPLES;
    const p0 = from.point;
    const p1 = add(from.point, from.handleOut);
    const p2 = add(to.point, to.handleIn);
    const p3 = to.point;
    // The segment's end node is emitted by the next segment's start.
    for (let step = 0; step < samples; step += 1) {
      points.push(cubicAt(p0, p1, p2, p3, step / samples));
    }
  });
  if (!closed) {
    const last = nodes[nodes.length - 1];
    if (last) {
      points.push({ x: last.point.x, y: last.point.y });
    }
  }
  return points.slice(0, MAX_SURFACE_MASK_POINTS);
}

/** Builds a renderable mask path from authored nodes. */
export function createMaskPath(
  nodes: readonly SurfaceMaskNode[],
  closed: boolean,
  feather = 0,
): SurfaceMaskPath {
  const bounded = nodes.slice(0, MAX_SURFACE_MASK_NODES);
  return {
    points: tessellateMaskNodes(bounded, closed),
    closed,
    feather: clamp(feather, 0, 1),
    nodes: bounded,
  };
}

/** Re-tessellates after a node edit, preserving `closed` and `feather`. */
export function withMaskNodes(
  path: SurfaceMaskPath,
  nodes: readonly SurfaceMaskNode[],
): SurfaceMaskPath {
  return createMaskPath(nodes, path.closed, path.feather);
}

export interface MaskNodeValidation {
  valid: boolean;
  errors: readonly string[];
}

export function validateMaskNodes(
  nodes: readonly SurfaceMaskNode[],
  closed: boolean,
): MaskNodeValidation {
  const errors: string[] = [];
  const minimum = closed ? 3 : 2;
  if (nodes.length < minimum) {
    errors.push(
      `Mask needs at least ${minimum} nodes, received ${nodes.length}.`,
    );
  }
  if (nodes.length > MAX_SURFACE_MASK_NODES) {
    errors.push(`Mask exceeds ${MAX_SURFACE_MASK_NODES} nodes.`);
  }
  nodes.forEach((node, index) => {
    for (const [name, point] of [
      ['point', node.point],
      ['handleIn', node.handleIn],
      ['handleOut', node.handleOut],
    ] as const) {
      if (!point || !finite(point.x) || !finite(point.y)) {
        errors.push(`Node ${index} ${name} is not a finite point.`);
      }
    }
    if (
      node.point &&
      finite(node.point.x) &&
      finite(node.point.y) &&
      (node.point.x < 0 || node.point.x > 1 || node.point.y < 0 || node.point.y > 1)
    ) {
      errors.push(`Node ${index} falls outside the surface.`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════
// Primitive mask shapes
// ═══════════════════════════════════════════════════════════════

export function rectangleMaskNodes(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SurfaceMaskNode[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const bottom = Math.min(y0, y1);
  const top = Math.max(y0, y1);
  // Clockwise in y-up space, matching the mesh cell winding.
  return [
    cornerNode({ x: left, y: top }),
    cornerNode({ x: right, y: top }),
    cornerNode({ x: right, y: bottom }),
    cornerNode({ x: left, y: bottom }),
  ];
}

export function ellipseMaskNodes(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): SurfaceMaskNode[] {
  const handleX = radiusX * ARC_HANDLE;
  const handleY = radiusY * ARC_HANDLE;
  return [
    smoothNode({ x: centerX, y: centerY + radiusY }, { x: handleX, y: 0 }),
    smoothNode({ x: centerX + radiusX, y: centerY }, { x: 0, y: -handleY }),
    smoothNode({ x: centerX, y: centerY - radiusY }, { x: -handleX, y: 0 }),
    smoothNode({ x: centerX - radiusX, y: centerY }, { x: 0, y: handleY }),
  ];
}

// ═══════════════════════════════════════════════════════════════
// Freehand capture
// ═══════════════════════════════════════════════════════════════

/** Perpendicular distance from `point` to the segment `from`-`to`. */
function distanceToSegment(
  point: SurfaceMaskPoint,
  from: SurfaceMaskPoint,
  to: SurfaceMaskPoint,
): number {
  const span = subtract(to, from);
  const lengthSquared = span.x * span.x + span.y * span.y;
  if (lengthSquared === 0) {
    return distance(point, from);
  }
  const offset = subtract(point, from);
  const t = clamp((offset.x * span.x + offset.y * span.y) / lengthSquared, 0, 1);
  return distance(point, add(from, scale(span, t)));
}

/** Ramer-Douglas-Peucker simplification. */
export function simplifyFreehand(
  samples: readonly SurfaceMaskPoint[],
  tolerance: number,
): SurfaceMaskPoint[] {
  if (samples.length < 3) {
    return samples.map((point) => ({ x: point.x, y: point.y }));
  }
  const first = samples[0] as SurfaceMaskPoint;
  const last = samples[samples.length - 1] as SurfaceMaskPoint;
  let furthest = 0;
  let furthestIndex = 0;
  for (let index = 1; index < samples.length - 1; index += 1) {
    const sample = samples[index];
    if (!sample) {
      continue;
    }
    const offset = distanceToSegment(sample, first, last);
    if (offset > furthest) {
      furthest = offset;
      furthestIndex = index;
    }
  }
  if (furthest <= tolerance) {
    return [first, last];
  }
  const head = simplifyFreehand(samples.slice(0, furthestIndex + 1), tolerance);
  const tail = simplifyFreehand(samples.slice(furthestIndex), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * Fits simplified freehand samples with Catmull-Rom tangents converted to
 * cubic handles, producing nodes the user can keep editing afterwards.
 */
export function fitFreehandNodes(
  samples: readonly SurfaceMaskPoint[],
  options: { closed?: boolean; tolerance?: number } = {},
): SurfaceMaskNode[] {
  const closed = options.closed ?? false;
  const tolerance = options.tolerance ?? 0.01;
  const usable = samples.filter(
    (point): point is SurfaceMaskPoint =>
      Boolean(point) && finite(point.x) && finite(point.y),
  );
  if (usable.length === 0) {
    return [];
  }
  let simplified = simplifyFreehand(usable, tolerance);
  if (closed && simplified.length > 2) {
    const first = simplified[0] as SurfaceMaskPoint;
    const last = simplified[simplified.length - 1] as SurfaceMaskPoint;
    if (distance(first, last) <= tolerance) {
      simplified = simplified.slice(0, -1);
    }
  }
  if (simplified.length > MAX_SURFACE_MASK_NODES) {
    // Keep the endpoints and drop interior nodes at an even stride.
    const stride = simplified.length / MAX_SURFACE_MASK_NODES;
    const reduced: SurfaceMaskPoint[] = [];
    for (let index = 0; index < MAX_SURFACE_MASK_NODES; index += 1) {
      const sample = simplified[Math.floor(index * stride)];
      if (sample) {
        reduced.push(sample);
      }
    }
    simplified = reduced;
  }
  if (simplified.length < 2) {
    return simplified.map((point) => cornerNode(point));
  }

  return simplified.map((point, index) => {
    const previous =
      simplified[index - 1] ??
      (closed ? simplified[simplified.length - 1] : undefined) ??
      point;
    const next =
      simplified[index + 1] ?? (closed ? simplified[0] : undefined) ?? point;
    const tangent = scale(subtract(next, previous), 1 / 6);
    const isEnd = !closed && (index === 0 || index === simplified.length - 1);
    if (isEnd) {
      return cornerNode(point);
    }
    return { point, handleIn: scale(tangent, -1), handleOut: tangent };
  });
}

// ═══════════════════════════════════════════════════════════════
// Coverage
// ═══════════════════════════════════════════════════════════════

function pointInPolygon(
  point: SurfaceMaskPoint,
  polygon: readonly SurfaceMaskPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (!current || !prior) {
      continue;
    }
    const straddles = current.y > point.y !== prior.y > point.y;
    if (!straddles) {
      continue;
    }
    const crossing =
      ((prior.x - current.x) * (point.y - current.y)) /
        (prior.y - current.y) +
      current.x;
    if (point.x < crossing) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygon(
  point: SurfaceMaskPoint,
  polygon: readonly SurfaceMaskPoint[],
  closed: boolean,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  const last = closed ? polygon.length : polygon.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    if (!from || !to) {
      continue;
    }
    nearest = Math.min(nearest, distanceToSegment(point, from, to));
  }
  return nearest;
}

/**
 * Coverage of one point against one mask path, in 0..1.
 *
 * A closed path returns 1 well inside, 0 well outside, and a smooth ramp
 * across the feather band straddling the edge. An open path is treated as
 * a feathered stroke rather than a fill, since it encloses no area.
 */
export function maskCoverage(
  path: SurfaceMaskPath,
  point: SurfaceMaskPoint,
): number {
  if (path.points.length < 2) {
    return 1;
  }
  const feather = clamp(path.feather, 0, 1);
  const edgeDistance = distanceToPolygon(point, path.points, path.closed);
  if (!path.closed) {
    if (feather <= 0) {
      return 0;
    }
    return clamp(1 - edgeDistance / feather, 0, 1);
  }
  const inside = pointInPolygon(point, path.points);
  if (feather <= 0) {
    return inside ? 1 : 0;
  }
  const signed = inside ? edgeDistance : -edgeDistance;
  // Ramp across the band centred on the edge.
  const normalized = clamp(signed / feather + 0.5, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Combined coverage of every mask on a surface. Paths intersect, so the
 * minimum wins: each mask can only remove what the others already kept.
 */
export function surfaceMaskCoverage(
  paths: readonly SurfaceMaskPath[],
  point: SurfaceMaskPoint,
): number {
  let coverage = 1;
  for (const path of paths) {
    coverage = Math.min(coverage, maskCoverage(path, point));
    if (coverage <= 0) {
      return 0;
    }
  }
  return coverage;
}
