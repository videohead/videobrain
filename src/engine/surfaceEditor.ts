/**
 * M2 (manual surface and mask editor) — editor state without any UI.
 *
 * Every mutation is routed through the M1 layout validator, so a fold, a
 * degenerate cell, or an out-of-bounds node leaves the previous layout
 * exactly as it was. History is a bounded undo/redo stack over whole
 * layout snapshots, which keeps undo correct across mixed mesh and mask
 * edits without tracking per-operation inverses.
 */
import type {
  OutputLayout,
  SurfaceLayout,
  SurfaceMaskPath,
  SurfaceMaskPoint,
  SurfaceMeshWarp,
} from '../store/contracts';
import {
  createMeshWarp,
  meshVertexCount,
  meshVertexIndex,
  validateOutputLayouts,
} from './surfaceLayout';
import { withMaskNodes } from './surfaceMask';

/** Undo steps retained, matching the vector editor's bounded history. */
export const MAX_EDIT_HISTORY = 30;

/** Keyboard nudge distance in surface UV units. */
export const NUDGE_STEP = 1 / 256;
export const COARSE_NUDGE_STEP = NUDGE_STEP * 10;

export interface MeshVertexSelection {
  kind: 'mesh-vertex';
  surfaceId: string;
  row: number;
  col: number;
}

export interface MaskNodeSelection {
  kind: 'mask-node';
  surfaceId: string;
  maskIndex: number;
  nodeIndex: number;
}

export type EditorSelection = MeshVertexSelection | MaskNodeSelection;

export interface SurfaceEditorState {
  outputs: readonly OutputLayout[];
  selection: readonly EditorSelection[];
  /** Surface ids that reject edits until unlocked. */
  locked: readonly string[];
  past: readonly (readonly OutputLayout[])[];
  future: readonly (readonly OutputLayout[])[];
  /** Populated when the last operation was refused. */
  errors: readonly string[];
}

export function createEditorState(
  outputs: readonly OutputLayout[],
): SurfaceEditorState {
  return {
    outputs,
    selection: [],
    locked: [],
    past: [],
    future: [],
    errors: [],
  };
}

export const sameSelection = (
  left: EditorSelection,
  right: EditorSelection,
): boolean => {
  if (left.kind !== right.kind || left.surfaceId !== right.surfaceId) {
    return false;
  }
  if (left.kind === 'mesh-vertex' && right.kind === 'mesh-vertex') {
    return left.row === right.row && left.col === right.col;
  }
  if (left.kind === 'mask-node' && right.kind === 'mask-node') {
    return (
      left.maskIndex === right.maskIndex && left.nodeIndex === right.nodeIndex
    );
  }
  return false;
};

export const isLocked = (
  state: SurfaceEditorState,
  surfaceId: string,
): boolean => state.locked.includes(surfaceId);

function findSurface(
  outputs: readonly OutputLayout[],
  surfaceId: string,
): SurfaceLayout | undefined {
  for (const output of outputs) {
    const match = output.surfaces.find(({ id }) => id === surfaceId);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function mapSurface(
  outputs: readonly OutputLayout[],
  surfaceId: string,
  update: (surface: SurfaceLayout) => SurfaceLayout,
): readonly OutputLayout[] {
  return outputs.map((output) => ({
    ...output,
    surfaces: output.surfaces.map((surface) =>
      surface.id === surfaceId ? update(surface) : surface,
    ),
  }));
}

/** Records a validated layout, or returns the state unchanged with errors. */
function commit(
  state: SurfaceEditorState,
  outputs: readonly OutputLayout[],
): SurfaceEditorState {
  const result = validateOutputLayouts(outputs);
  if (!result.valid) {
    return { ...state, errors: result.errors };
  }
  return {
    ...state,
    outputs,
    past: [...state.past, state.outputs].slice(-MAX_EDIT_HISTORY),
    future: [],
    errors: [],
  };
}

const refuse = (
  state: SurfaceEditorState,
  message: string,
): SurfaceEditorState => ({ ...state, errors: [message] });

// ═══════════════════════════════════════════════════════════════
// Selection and locking
// ═══════════════════════════════════════════════════════════════

export function selectElement(
  state: SurfaceEditorState,
  selection: EditorSelection,
  additive = false,
): SurfaceEditorState {
  if (!additive) {
    return { ...state, selection: [selection], errors: [] };
  }
  const existing = state.selection.some((entry) =>
    sameSelection(entry, selection),
  );
  return {
    ...state,
    selection: existing
      ? state.selection.filter((entry) => !sameSelection(entry, selection))
      : [...state.selection, selection],
    errors: [],
  };
}

export function clearSelection(state: SurfaceEditorState): SurfaceEditorState {
  return { ...state, selection: [], errors: [] };
}

export function toggleSurfaceLock(
  state: SurfaceEditorState,
  surfaceId: string,
): SurfaceEditorState {
  const locked = isLocked(state, surfaceId)
    ? state.locked.filter((id) => id !== surfaceId)
    : [...state.locked, surfaceId];
  return {
    ...state,
    locked,
    // Dropping the selection avoids a locked handle that still looks active.
    selection: state.selection.filter(
      (entry) => !locked.includes(entry.surfaceId),
    ),
    errors: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// Mesh editing
// ═══════════════════════════════════════════════════════════════

function displaceVertex(
  warp: SurfaceMeshWarp,
  row: number,
  col: number,
  update: (current: SurfaceMaskPoint) => SurfaceMaskPoint,
): SurfaceMeshWarp {
  const index = meshVertexIndex(warp.cols, row, col);
  const displacements = warp.displacements.map((offset, position) =>
    position === index ? update(offset) : offset,
  );
  return { ...warp, displacements };
}

/** Changes the mesh resolution, discarding displacements it cannot keep. */
export function setMeshResolution(
  state: SurfaceEditorState,
  surfaceId: string,
  rows: number,
  cols: number,
): SurfaceEditorState {
  if (isLocked(state, surfaceId)) {
    return refuse(state, `Surface "${surfaceId}" is locked.`);
  }
  const surface = findSurface(state.outputs, surfaceId);
  if (!surface) {
    return refuse(state, `No surface "${surfaceId}" in this layout.`);
  }
  const warp = createMeshWarp(rows, cols);
  if (warp.displacements.length !== meshVertexCount(rows, cols)) {
    return refuse(state, 'Mesh resolution is out of range.');
  }
  return commit(
    { ...state, selection: [] },
    mapSurface(state.outputs, surfaceId, (entry) => ({ ...entry, warp })),
  );
}

/** Moves every selected mesh vertex and mask node by one offset. */
export function moveSelection(
  state: SurfaceEditorState,
  deltaX: number,
  deltaY: number,
): SurfaceEditorState {
  if (state.selection.length === 0) {
    return refuse(state, 'Nothing is selected.');
  }
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return refuse(state, 'Edit offset must be finite.');
  }
  const blocked = state.selection.find((entry) =>
    isLocked(state, entry.surfaceId),
  );
  if (blocked) {
    return refuse(state, `Surface "${blocked.surfaceId}" is locked.`);
  }

  let outputs = state.outputs;
  for (const entry of state.selection) {
    const surface = findSurface(outputs, entry.surfaceId);
    if (!surface) {
      return refuse(state, `No surface "${entry.surfaceId}" in this layout.`);
    }
    if (entry.kind === 'mesh-vertex') {
      const warp = surface.warp;
      if (!warp) {
        return refuse(state, `Surface "${entry.surfaceId}" has no mesh.`);
      }
      outputs = mapSurface(outputs, entry.surfaceId, (current) => ({
        ...current,
        warp: current.warp
          ? displaceVertex(current.warp, entry.row, entry.col, (offset) => ({
              x: offset.x + deltaX,
              y: offset.y + deltaY,
            }))
          : current.warp,
      }));
      continue;
    }
    const path = surface.maskPaths[entry.maskIndex];
    const nodes = path?.nodes;
    if (!path || !nodes) {
      return refuse(state, 'Selected mask has no editable nodes.');
    }
    const moved = nodes.map((node, index) =>
      index === entry.nodeIndex
        ? {
            ...node,
            point: { x: node.point.x + deltaX, y: node.point.y + deltaY },
          }
        : node,
    );
    outputs = mapSurface(outputs, entry.surfaceId, (current) => ({
      ...current,
      maskPaths: current.maskPaths.map((entryPath, index) =>
        index === entry.maskIndex ? withMaskNodes(entryPath, moved) : entryPath,
      ),
    }));
  }
  return commit(state, outputs);
}

/** Keyboard nudge; `coarse` applies the larger step. */
export function nudgeSelection(
  state: SurfaceEditorState,
  direction: 'up' | 'down' | 'left' | 'right',
  coarse = false,
): SurfaceEditorState {
  const step = coarse ? COARSE_NUDGE_STEP : NUDGE_STEP;
  const offsets = {
    up: [0, step],
    down: [0, -step],
    left: [-step, 0],
    right: [step, 0],
  } as const;
  const [deltaX, deltaY] = offsets[direction];
  return moveSelection(state, deltaX, deltaY);
}

/** Returns one surface's mesh to the undisplaced grid. */
export function resetSurfaceMesh(
  state: SurfaceEditorState,
  surfaceId: string,
): SurfaceEditorState {
  if (isLocked(state, surfaceId)) {
    return refuse(state, `Surface "${surfaceId}" is locked.`);
  }
  const surface = findSurface(state.outputs, surfaceId);
  if (!surface) {
    return refuse(state, `No surface "${surfaceId}" in this layout.`);
  }
  if (!surface.warp) {
    return refuse(state, `Surface "${surfaceId}" has no mesh.`);
  }
  const warp = createMeshWarp(surface.warp.rows, surface.warp.cols);
  return commit(
    { ...state, selection: [] },
    mapSurface(state.outputs, surfaceId, (entry) => ({ ...entry, warp })),
  );
}

// ═══════════════════════════════════════════════════════════════
// Mask editing
// ═══════════════════════════════════════════════════════════════

export function addMaskPath(
  state: SurfaceEditorState,
  surfaceId: string,
  path: SurfaceMaskPath,
): SurfaceEditorState {
  if (isLocked(state, surfaceId)) {
    return refuse(state, `Surface "${surfaceId}" is locked.`);
  }
  if (!findSurface(state.outputs, surfaceId)) {
    return refuse(state, `No surface "${surfaceId}" in this layout.`);
  }
  return commit(
    { ...state, selection: [] },
    mapSurface(state.outputs, surfaceId, (surface) => ({
      ...surface,
      maskPaths: [...surface.maskPaths, path],
    })),
  );
}

export function removeMaskPath(
  state: SurfaceEditorState,
  surfaceId: string,
  maskIndex: number,
): SurfaceEditorState {
  if (isLocked(state, surfaceId)) {
    return refuse(state, `Surface "${surfaceId}" is locked.`);
  }
  const surface = findSurface(state.outputs, surfaceId);
  if (!surface?.maskPaths[maskIndex]) {
    return refuse(state, 'No such mask path.');
  }
  return commit(
    { ...state, selection: [] },
    mapSurface(state.outputs, surfaceId, (entry) => ({
      ...entry,
      maskPaths: entry.maskPaths.filter((_, index) => index !== maskIndex),
    })),
  );
}

export function setMaskFeather(
  state: SurfaceEditorState,
  surfaceId: string,
  maskIndex: number,
  feather: number,
): SurfaceEditorState {
  if (isLocked(state, surfaceId)) {
    return refuse(state, `Surface "${surfaceId}" is locked.`);
  }
  const surface = findSurface(state.outputs, surfaceId);
  if (!surface?.maskPaths[maskIndex]) {
    return refuse(state, 'No such mask path.');
  }
  return commit(
    state,
    mapSurface(state.outputs, surfaceId, (entry) => ({
      ...entry,
      maskPaths: entry.maskPaths.map((path, index) =>
        index === maskIndex ? { ...path, feather } : path,
      ),
    })),
  );
}

/** Removes every mask from one surface. */
export function resetSurfaceMasks(
  state: SurfaceEditorState,
  surfaceId: string,
): SurfaceEditorState {
  if (isLocked(state, surfaceId)) {
    return refuse(state, `Surface "${surfaceId}" is locked.`);
  }
  if (!findSurface(state.outputs, surfaceId)) {
    return refuse(state, `No surface "${surfaceId}" in this layout.`);
  }
  return commit(
    { ...state, selection: [] },
    mapSurface(state.outputs, surfaceId, (entry) => ({
      ...entry,
      maskPaths: [],
    })),
  );
}

// ═══════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════

export const canUndo = (state: SurfaceEditorState): boolean =>
  state.past.length > 0;

export const canRedo = (state: SurfaceEditorState): boolean =>
  state.future.length > 0;

export function undo(state: SurfaceEditorState): SurfaceEditorState {
  const previous = state.past[state.past.length - 1];
  if (!previous) {
    return { ...state, errors: [] };
  }
  return {
    ...state,
    outputs: previous,
    past: state.past.slice(0, -1),
    future: [state.outputs, ...state.future].slice(0, MAX_EDIT_HISTORY),
    selection: [],
    errors: [],
  };
}

export function redo(state: SurfaceEditorState): SurfaceEditorState {
  const next = state.future[0];
  if (!next) {
    return { ...state, errors: [] };
  }
  return {
    ...state,
    outputs: next,
    past: [...state.past, state.outputs].slice(-MAX_EDIT_HISTORY),
    future: state.future.slice(1),
    selection: [],
    errors: [],
  };
}
