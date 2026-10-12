/**
 * M1 (surface geometry and layout validation) — GPU-free geometry rules.
 *
 * Owns the coordinate conventions, bounded mesh/mask geometry, and layout
 * validation that later mapping work builds on. This module renders nothing,
 * owns no UI, and makes no physical calibration claim.
 *
 * ── Coordinate conventions ──────────────────────────────────────
 * • Screen space is y-down with the origin at the top-left corner.
 * • Frame and surface UV space is y-up with the origin at the bottom-left.
 * Every conversion between the two goes through `screenToFrameUv` /
 * `frameUvToScreen` so the flip is never repeated inline.
 *
 * Projector Mapping's shipped four-corner order (top-left, top-right,
 * bottom-right, bottom-left, in screen space) is preserved exactly and is
 * bridged to a 1x1 warp mesh by `meshFromProjectionCorners`.
 */
import {
  MAX_OUTPUT_LAYOUTS,
  MAX_SURFACE_MASK_POINTS,
  MAX_SURFACE_MESH_CELLS,
  type OutputLayout,
  type SurfaceBlendMode,
  type SurfaceLayout,
  type SurfaceMaskPath,
  type SurfaceMaskPoint,
  type SurfaceMeshWarp,
} from '../store/contracts';
import type { ProjectionShape } from './projection';

/** Point in screen space (y-down, top-left origin). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Point in frame or surface UV space (y-up, bottom-left origin). */
export interface FrameUv {
  u: number;
  v: number;
}

/**
 * Largest mesh span on one axis. `MAX_SURFACE_MESH_CELLS` is the area cap;
 * this keeps a single axis from degenerating into a 1 x 1024 strip.
 */
export const MAX_SURFACE_MESH_SPAN = 32;

/** Mask paths per surface. M1 proposal, pending C3 ratification. */
export const MAX_SURFACE_MASK_PATHS = 16;

/** Largest edge of one logical output, in pixels. */
export const MAX_OUTPUT_DIMENSION = 7680;

/** Aggregate addressable pixels across every logical output. */
export const MAX_TOTAL_OUTPUT_PIXELS = 7680 * 4320;

const BLEND_MODES: readonly SurfaceBlendMode[] = [
  'normal',
  'add',
  'multiply',
  'screen',
];

export class SurfaceLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurfaceLayoutError';
  }
}

/** Outcome of a geometry or layout check. Empty `errors` means accepted. */
export interface LayoutValidation {
  valid: boolean;
  errors: readonly string[];
}

const accepted = (): LayoutValidation => ({ valid: true, errors: [] });

const rejected = (errors: readonly string[]): LayoutValidation => ({
  valid: errors.length === 0,
  errors,
});

// ═══════════════════════════════════════════════════════════════
// Coordinate conversion
// ═══════════════════════════════════════════════════════════════

/** Screen (y-down) to frame/surface UV (y-up). */
export function screenToFrameUv(point: ScreenPoint): FrameUv {
  return { u: point.x, v: 1 - point.y };
}

/** Frame/surface UV (y-up) to screen (y-down). */
export function frameUvToScreen(uv: FrameUv): ScreenPoint {
  return { x: uv.u, y: 1 - uv.v };
}

// ═══════════════════════════════════════════════════════════════
// Stable identity
// ═══════════════════════════════════════════════════════════════

let generatedId = 0;

function nextId(prefix: string): string {
  generatedId += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return (
    randomId ??
    `${prefix}-${Date.now().toString(36)}-${generatedId.toString(36)}`
  );
}

export const createSurfaceId = (): string => nextId('surface');
export const createOutputId = (): string => nextId('output');

// ═══════════════════════════════════════════════════════════════
// Warp mesh geometry
// ═══════════════════════════════════════════════════════════════

/** Vertices in a `rows` x `cols` cell grid. Displacements are per vertex. */
export function meshVertexCount(rows: number, cols: number): number {
  return (rows + 1) * (cols + 1);
}

/** Row-major vertex index, with row 0 along the top edge of the surface. */
export function meshVertexIndex(cols: number, row: number, col: number): number {
  return row * (cols + 1) + col;
}

/** Undisplaced vertex position in surface UV space. */
export function meshBaseVertexUv(
  rows: number,
  cols: number,
  row: number,
  col: number,
): FrameUv {
  return { u: col / cols, v: 1 - row / rows };
}

/** Identity mesh: every vertex sits on the undisplaced grid. */
export function createMeshWarp(rows: number, cols: number): SurfaceMeshWarp {
  const displacements: SurfaceMaskPoint[] = [];
  for (let index = 0; index < meshVertexCount(rows, cols); index += 1) {
    displacements.push({ x: 0, y: 0 });
  }
  return { rows, cols, displacements };
}

/** Displaced vertex position in surface UV space. */
export function meshVertexUv(
  warp: SurfaceMeshWarp,
  row: number,
  col: number,
): FrameUv {
  const base = meshBaseVertexUv(warp.rows, warp.cols, row, col);
  const offset = warp.displacements[meshVertexIndex(warp.cols, row, col)];
  return {
    u: base.u + (offset?.x ?? 0),
    v: base.v + (offset?.y ?? 0),
  };
}

function cross(origin: FrameUv, from: FrameUv, to: FrameUv): number {
  return (
    (from.u - origin.u) * (to.v - origin.v) -
    (from.v - origin.v) * (to.u - origin.u)
  );
}

const finitePoint = (point: SurfaceMaskPoint | undefined): boolean =>
  point !== undefined &&
  Number.isFinite(point.x) &&
  Number.isFinite(point.y);

/**
 * Rejects degenerate and folded meshes.
 *
 * Each cell is checked as the quad top-left, top-right, bottom-right,
 * bottom-left. In y-up UV that winding is clockwise, so every corner's cross
 * product must stay negative. A zero crossing is a collapsed corner and a
 * positive one is a fold, so this single sign test catches both.
 */
export function validateMeshWarp(warp: SurfaceMeshWarp): LayoutValidation {
  const errors: string[] = [];
  const { rows, cols } = warp;
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
    return rejected(['Mesh rows and cols must be integers.']);
  }
  if (rows < 1 || cols < 1) {
    return rejected(['Mesh must have at least one cell.']);
  }
  if (rows > MAX_SURFACE_MESH_SPAN || cols > MAX_SURFACE_MESH_SPAN) {
    errors.push(
      `Mesh span exceeds ${MAX_SURFACE_MESH_SPAN} cells on one axis.`,
    );
  }
  if (rows * cols > MAX_SURFACE_MESH_CELLS) {
    errors.push(`Mesh exceeds ${MAX_SURFACE_MESH_CELLS} cells.`);
  }
  const expectedVertices = meshVertexCount(rows, cols);
  if (warp.displacements.length !== expectedVertices) {
    errors.push(
      `Mesh needs ${expectedVertices} displacements, received ${warp.displacements.length}.`,
    );
  }
  if (errors.length > 0) {
    return rejected(errors);
  }
  for (let index = 0; index < warp.displacements.length; index += 1) {
    if (!finitePoint(warp.displacements[index])) {
      errors.push(`Mesh displacement ${index} is not a finite point.`);
    }
  }
  if (errors.length > 0) {
    return rejected(errors);
  }

  const minimumArea = (1 / rows) * (1 / cols) * 1e-3;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const quad: readonly FrameUv[] = [
        meshVertexUv(warp, row, col),
        meshVertexUv(warp, row, col + 1),
        meshVertexUv(warp, row + 1, col + 1),
        meshVertexUv(warp, row + 1, col),
      ];
      for (let corner = 0; corner < 4; corner += 1) {
        const origin = quad[corner] as FrameUv;
        const from = quad[(corner + 1) % 4] as FrameUv;
        const to = quad[(corner + 3) % 4] as FrameUv;
        if (cross(origin, from, to) > -minimumArea) {
          errors.push(`Mesh cell ${row},${col} is degenerate or folded.`);
          corner = 4;
        }
      }
    }
  }
  return errors.length > 0 ? rejected(errors) : accepted();
}

// ═══════════════════════════════════════════════════════════════
// Four-corner compatibility
// ═══════════════════════════════════════════════════════════════

/**
 * Converts the shipped Projector Mapping corners into a 1x1 warp mesh.
 *
 * The corner parameters are screen-space (y-down) in the order top-left,
 * top-right, bottom-right, bottom-left. Mesh vertices are row-major, so the
 * last two are swapped on the way in. Move/scale/rotation are intentionally
 * not baked in: they stay whole-shape transforms on the node.
 */
export function meshFromProjectionCorners(
  shape: Pick<
    ProjectionShape,
    'x0' | 'y0' | 'x1' | 'y1' | 'x2' | 'y2' | 'x3' | 'y3'
  >,
): SurfaceMeshWarp {
  const screenCorners: readonly ScreenPoint[] = [
    { x: shape.x0, y: shape.y0 },
    { x: shape.x1, y: shape.y1 },
    { x: shape.x3, y: shape.y3 },
    { x: shape.x2, y: shape.y2 },
  ];
  const displacements = screenCorners.map((corner, index) => {
    const target = screenToFrameUv(corner);
    const base = meshBaseVertexUv(1, 1, index < 2 ? 0 : 1, index % 2);
    return { x: target.u - base.u, y: target.v - base.v };
  });
  return { rows: 1, cols: 1, displacements };
}

/** Inverse of `meshFromProjectionCorners`; null when the mesh is not 1x1. */
export function projectionCornersFromMesh(
  warp: SurfaceMeshWarp,
): Pick<
  ProjectionShape,
  'x0' | 'y0' | 'x1' | 'y1' | 'x2' | 'y2' | 'x3' | 'y3'
> | null {
  if (warp.rows !== 1 || warp.cols !== 1) {
    return null;
  }
  const topLeft = frameUvToScreen(meshVertexUv(warp, 0, 0));
  const topRight = frameUvToScreen(meshVertexUv(warp, 0, 1));
  const bottomLeft = frameUvToScreen(meshVertexUv(warp, 1, 0));
  const bottomRight = frameUvToScreen(meshVertexUv(warp, 1, 1));
  return {
    x0: topLeft.x,
    y0: topLeft.y,
    x1: topRight.x,
    y1: topRight.y,
    x2: bottomRight.x,
    y2: bottomRight.y,
    x3: bottomLeft.x,
    y3: bottomLeft.y,
  };
}

// ═══════════════════════════════════════════════════════════════
// Mask paths
// ═══════════════════════════════════════════════════════════════

export function validateMaskPath(path: SurfaceMaskPath): LayoutValidation {
  const errors: string[] = [];
  const minimumPoints = path.closed ? 3 : 2;
  if (path.points.length < minimumPoints) {
    errors.push(
      `Mask path needs at least ${minimumPoints} points, received ${path.points.length}.`,
    );
  }
  if (path.points.length > MAX_SURFACE_MASK_POINTS) {
    errors.push(`Mask path exceeds ${MAX_SURFACE_MASK_POINTS} points.`);
  }
  for (let index = 0; index < path.points.length; index += 1) {
    const point = path.points[index];
    if (!finitePoint(point) || !point) {
      errors.push(`Mask point ${index} is not a finite point.`);
      continue;
    }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      errors.push(`Mask point ${index} falls outside the surface.`);
    }
  }
  if (!Number.isFinite(path.feather) || path.feather < 0 || path.feather > 1) {
    errors.push('Mask feather must be within 0..1.');
  }
  return errors.length > 0 ? rejected(errors) : accepted();
}

// ═══════════════════════════════════════════════════════════════
// Surface and output layouts
// ═══════════════════════════════════════════════════════════════

export function validateSurfaceLayout(surface: SurfaceLayout): LayoutValidation {
  const errors: string[] = [];
  if (surface.id.length === 0) {
    errors.push('Surface id must not be empty.');
  }
  if (surface.sourceNodeId.length === 0) {
    errors.push('Surface must reference a source node.');
  }
  const region = surface.sourceUvRegion;
  const bounds = [region.u0, region.v0, region.u1, region.v1];
  if (bounds.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    errors.push('Source UV region must stay within 0..1.');
  } else if (region.u1 <= region.u0 || region.v1 <= region.v0) {
    errors.push('Source UV region is degenerate.');
  }
  if (!Number.isInteger(surface.layerIndex) || surface.layerIndex < 0) {
    errors.push('Layer index must be a non-negative integer.');
  }
  if (
    !Number.isFinite(surface.opacity) ||
    surface.opacity < 0 ||
    surface.opacity > 1
  ) {
    errors.push('Opacity must be within 0..1.');
  }
  if (!BLEND_MODES.includes(surface.blend)) {
    errors.push(`Unknown blend mode "${surface.blend}".`);
  }
  if (surface.maskPaths.length > MAX_SURFACE_MASK_PATHS) {
    errors.push(`Surface exceeds ${MAX_SURFACE_MASK_PATHS} mask paths.`);
  }
  surface.maskPaths.forEach((path, index) => {
    const result = validateMaskPath(path);
    for (const error of result.errors) {
      errors.push(`Mask ${index}: ${error}`);
    }
  });
  if (surface.warp !== null) {
    const result = validateMeshWarp(surface.warp);
    errors.push(...result.errors);
  }
  return errors.length > 0 ? rejected(errors) : accepted();
}

export function validateOutputLayout(output: OutputLayout): LayoutValidation {
  const errors: string[] = [];
  if (output.id.length === 0) {
    errors.push('Output id must not be empty.');
  }
  if (output.name.trim().length === 0) {
    errors.push('Output name must not be empty.');
  }
  for (const [label, value] of [
    ['width', output.width],
    ['height', output.height],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_OUTPUT_DIMENSION) {
      errors.push(
        `Output ${label} must be an integer within 1..${MAX_OUTPUT_DIMENSION}.`,
      );
    }
  }
  if (!Number.isFinite(output.layoutX) || !Number.isFinite(output.layoutY)) {
    errors.push('Output layout coordinates must be finite.');
  }
  const seen = new Set<string>();
  for (const surface of output.surfaces) {
    if (seen.has(surface.id)) {
      errors.push(`Duplicate surface id "${surface.id}".`);
    }
    seen.add(surface.id);
    if (surface.outputId !== output.id) {
      errors.push(`Surface "${surface.id}" is routed to another output.`);
    }
    const result = validateSurfaceLayout(surface);
    for (const error of result.errors) {
      errors.push(`Surface "${surface.id}": ${error}`);
    }
  }
  return errors.length > 0 ? rejected(errors) : accepted();
}

export function validateOutputLayouts(
  outputs: readonly OutputLayout[],
): LayoutValidation {
  const errors: string[] = [];
  if (outputs.length > MAX_OUTPUT_LAYOUTS) {
    errors.push(`Project exceeds ${MAX_OUTPUT_LAYOUTS} outputs.`);
  }
  const outputIds = new Set<string>();
  const surfaceIds = new Set<string>();
  let totalPixels = 0;
  for (const output of outputs) {
    if (outputIds.has(output.id)) {
      errors.push(`Duplicate output id "${output.id}".`);
    }
    outputIds.add(output.id);
    for (const surface of output.surfaces) {
      if (surfaceIds.has(surface.id)) {
        errors.push(`Surface id "${surface.id}" is used by another output.`);
      }
      surfaceIds.add(surface.id);
    }
    totalPixels += Math.max(0, output.width) * Math.max(0, output.height);
    errors.push(...validateOutputLayout(output).errors);
  }
  if (totalPixels > MAX_TOTAL_OUTPUT_PIXELS) {
    errors.push(
      `Outputs address ${totalPixels} pixels, above the ${MAX_TOTAL_OUTPUT_PIXELS} ceiling.`,
    );
  }
  return errors.length > 0 ? rejected(errors) : accepted();
}

/** Deterministic draw order: ascending layer index, ties broken by id. */
export function orderedSurfaces(
  output: OutputLayout,
): readonly SurfaceLayout[] {
  return [...output.surfaces].sort(
    (left, right) =>
      left.layerIndex - right.layerIndex || left.id.localeCompare(right.id),
  );
}

// ═══════════════════════════════════════════════════════════════
// Edits
// ═══════════════════════════════════════════════════════════════

export interface LayoutEditResult {
  /** The accepted layout, or the unchanged previous one when rejected. */
  outputs: readonly OutputLayout[];
  applied: boolean;
  errors: readonly string[];
}

/**
 * Applies a partial surface edit. A rejected edit returns the previous
 * layout untouched so an invalid drag never destroys a working alignment.
 */
export function applySurfaceEdit(
  outputs: readonly OutputLayout[],
  surfaceId: string,
  patch: Partial<Omit<SurfaceLayout, 'id'>>,
): LayoutEditResult {
  let found = false;
  const next = outputs.map((output) => ({
    ...output,
    surfaces: output.surfaces.map((surface) => {
      if (surface.id !== surfaceId) {
        return surface;
      }
      found = true;
      return { ...surface, ...patch };
    }),
  }));
  if (!found) {
    return {
      outputs,
      applied: false,
      errors: [`No surface "${surfaceId}" in this layout.`],
    };
  }
  const result = validateOutputLayouts(next);
  if (!result.valid) {
    return { outputs, applied: false, errors: result.errors };
  }
  return { outputs: next, applied: true, errors: [] };
}

// ═══════════════════════════════════════════════════════════════
// Serialization
// ═══════════════════════════════════════════════════════════════

export function serializeOutputLayouts(
  outputs: readonly OutputLayout[],
): string {
  const result = validateOutputLayouts(outputs);
  if (!result.valid) {
    throw new SurfaceLayoutError(
      `Refusing to serialize an invalid layout: ${result.errors.join(' ')}`,
    );
  }
  return JSON.stringify(outputs);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SurfaceLayoutError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SurfaceLayoutError(`${path} must be an array.`);
  }
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SurfaceLayoutError(`${path} must be a finite number.`);
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new SurfaceLayoutError(`${path} must be a string.`);
  }
  return value;
}

function parsePoint(value: unknown, path: string): SurfaceMaskPoint {
  const record = expectRecord(value, path);
  return {
    x: expectNumber(record.x, `${path}.x`),
    y: expectNumber(record.y, `${path}.y`),
  };
}

function parseWarp(value: unknown, path: string): SurfaceMeshWarp | null {
  if (value === null || value === undefined) {
    return null;
  }
  const record = expectRecord(value, path);
  return {
    rows: expectNumber(record.rows, `${path}.rows`),
    cols: expectNumber(record.cols, `${path}.cols`),
    displacements: expectArray(
      record.displacements,
      `${path}.displacements`,
    ).map((entry, index) => parsePoint(entry, `${path}.displacements[${index}]`)),
  };
}

function parseSurface(value: unknown, path: string): SurfaceLayout {
  const record = expectRecord(value, path);
  const region = expectRecord(record.sourceUvRegion, `${path}.sourceUvRegion`);
  return {
    id: expectString(record.id, `${path}.id`),
    sourceNodeId: expectString(record.sourceNodeId, `${path}.sourceNodeId`),
    sourceUvRegion: {
      u0: expectNumber(region.u0, `${path}.sourceUvRegion.u0`),
      v0: expectNumber(region.v0, `${path}.sourceUvRegion.v0`),
      u1: expectNumber(region.u1, `${path}.sourceUvRegion.u1`),
      v1: expectNumber(region.v1, `${path}.sourceUvRegion.v1`),
    },
    warp: parseWarp(record.warp, `${path}.warp`),
    maskPaths: expectArray(record.maskPaths, `${path}.maskPaths`).map(
      (entry, index) => {
        const maskPath = `${path}.maskPaths[${index}]`;
        const mask = expectRecord(entry, maskPath);
        return {
          points: expectArray(mask.points, `${maskPath}.points`).map(
            (point, pointIndex) =>
              parsePoint(point, `${maskPath}.points[${pointIndex}]`),
          ),
          closed: mask.closed === true,
          feather: expectNumber(mask.feather, `${maskPath}.feather`),
        };
      },
    ),
    outputId: expectString(record.outputId, `${path}.outputId`),
    layerIndex: expectNumber(record.layerIndex, `${path}.layerIndex`),
    visible: record.visible !== false,
    blend: expectString(record.blend, `${path}.blend`) as SurfaceBlendMode,
    opacity: expectNumber(record.opacity, `${path}.opacity`),
  };
}

/** Parses serialized layouts. Throws `SurfaceLayoutError` when invalid. */
export function parseOutputLayouts(text: string): readonly OutputLayout[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SurfaceLayoutError('Layout payload is not valid JSON.');
  }
  const outputs = expectArray(raw, 'layouts').map((entry, index) => {
    const path = `layouts[${index}]`;
    const record = expectRecord(entry, path);
    return {
      id: expectString(record.id, `${path}.id`),
      name: expectString(record.name, `${path}.name`),
      width: expectNumber(record.width, `${path}.width`),
      height: expectNumber(record.height, `${path}.height`),
      layoutX: expectNumber(record.layoutX, `${path}.layoutX`),
      layoutY: expectNumber(record.layoutY, `${path}.layoutY`),
      surfaces: expectArray(record.surfaces, `${path}.surfaces`).map(
        (surface, surfaceIndex) =>
          parseSurface(surface, `${path}.surfaces[${surfaceIndex}]`),
      ),
    } satisfies OutputLayout;
  });
  const result = validateOutputLayouts(outputs);
  if (!result.valid) {
    throw new SurfaceLayoutError(
      `Rejected layout payload: ${result.errors.join(' ')}`,
    );
  }
  return outputs;
}
