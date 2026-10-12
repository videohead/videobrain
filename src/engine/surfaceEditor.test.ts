import { describe, expect, it } from 'vitest';

import type { OutputLayout, SurfaceLayout } from '../store/contracts';
import { createMeshWarp, meshVertexIndex, meshVertexUv } from './surfaceLayout';
import { createMaskPath, rectangleMaskNodes } from './surfaceMask';
import {
  COARSE_NUDGE_STEP,
  MAX_EDIT_HISTORY,
  NUDGE_STEP,
  addMaskPath,
  canRedo,
  canUndo,
  clearSelection,
  createEditorState,
  isLocked,
  moveSelection,
  nudgeSelection,
  redo,
  removeMaskPath,
  resetSurfaceMasks,
  resetSurfaceMesh,
  selectElement,
  setMaskFeather,
  setMeshResolution,
  toggleSurfaceLock,
  undo,
  type SurfaceEditorState,
} from './surfaceEditor';

const surface = (overrides: Partial<SurfaceLayout> = {}): SurfaceLayout => ({
  id: 'surface-1',
  sourceNodeId: 'plasma-1',
  sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
  warp: createMeshWarp(2, 2),
  maskPaths: [],
  outputId: 'output-1',
  layerIndex: 0,
  visible: true,
  blend: 'normal',
  opacity: 1,
  ...overrides,
});

const layout = (overrides: Partial<OutputLayout> = {}): OutputLayout => ({
  id: 'output-1',
  name: 'Main Display',
  width: 1920,
  height: 1080,
  layoutX: 0,
  layoutY: 0,
  surfaces: [surface()],
  ...overrides,
});

const start = (overrides: Partial<SurfaceLayout> = {}): SurfaceEditorState =>
  createEditorState([layout({ surfaces: [surface(overrides)] })]);

const firstSurface = (state: SurfaceEditorState): SurfaceLayout => {
  const found = state.outputs[0]?.surfaces[0];
  if (!found) throw new Error('Fixture surface missing.');
  return found;
};

const vertexOffset = (state: SurfaceEditorState, row: number, col: number) => {
  const warp = firstSurface(state).warp;
  if (!warp) throw new Error('Fixture mesh missing.');
  return warp.displacements[meshVertexIndex(warp.cols, row, col)];
};

const centreVertex = {
  kind: 'mesh-vertex',
  surfaceId: 'surface-1',
  row: 1,
  col: 1,
} as const;

describe('selection', () => {
  it('replaces the selection by default', () => {
    const state = selectElement(
      selectElement(start(), centreVertex),
      { ...centreVertex, row: 0, col: 0 },
    );
    expect(state.selection).toHaveLength(1);
    expect(state.selection[0]).toMatchObject({ row: 0, col: 0 });
  });

  it('adds and removes with an additive click', () => {
    const added = selectElement(
      selectElement(start(), centreVertex),
      { ...centreVertex, row: 0, col: 0 },
      true,
    );
    expect(added.selection).toHaveLength(2);
    expect(selectElement(added, centreVertex, true).selection).toHaveLength(1);
  });

  it('clears the selection', () => {
    expect(
      clearSelection(selectElement(start(), centreVertex)).selection,
    ).toHaveLength(0);
  });
});

describe('locking', () => {
  it('refuses edits and drops the selection while locked', () => {
    const selected = selectElement(start(), centreVertex);
    const locked = toggleSurfaceLock(selected, 'surface-1');
    expect(isLocked(locked, 'surface-1')).toBe(true);
    expect(locked.selection).toHaveLength(0);

    const blocked = moveSelection(
      selectElement(locked, centreVertex),
      0.05,
      0,
    );
    expect(blocked.errors.join(' ')).toContain('is locked');
    expect(blocked.outputs).toBe(locked.outputs);
  });

  it('unlocks again', () => {
    const toggled = toggleSurfaceLock(
      toggleSurfaceLock(start(), 'surface-1'),
      'surface-1',
    );
    expect(isLocked(toggled, 'surface-1')).toBe(false);
  });

  it('refuses mesh and mask resets while locked', () => {
    const locked = toggleSurfaceLock(start(), 'surface-1');
    expect(resetSurfaceMesh(locked, 'surface-1').errors).toHaveLength(1);
    expect(resetSurfaceMasks(locked, 'surface-1').errors).toHaveLength(1);
    expect(
      addMaskPath(
        locked,
        'surface-1',
        createMaskPath(rectangleMaskNodes(0.2, 0.2, 0.8, 0.8), true),
      ).errors,
    ).toHaveLength(1);
  });
});

describe('mesh editing', () => {
  it('moves the selected vertex', () => {
    const state = moveSelection(
      selectElement(start(), centreVertex),
      0.1,
      -0.05,
    );
    expect(state.errors).toHaveLength(0);
    expect(vertexOffset(state, 1, 1)).toEqual({ x: 0.1, y: -0.05 });
  });

  it('moves several selected vertices together', () => {
    const selected = selectElement(
      selectElement(start(), centreVertex),
      { ...centreVertex, row: 1, col: 0 },
      true,
    );
    const state = moveSelection(selected, 0.02, 0.02);
    expect(vertexOffset(state, 1, 1)).toEqual({ x: 0.02, y: 0.02 });
    expect(vertexOffset(state, 1, 0)).toEqual({ x: 0.02, y: 0.02 });
  });

  it('nudges by the fine and coarse steps', () => {
    const fine = nudgeSelection(selectElement(start(), centreVertex), 'right');
    expect(vertexOffset(fine, 1, 1)?.x).toBeCloseTo(NUDGE_STEP, 10);
    const coarse = nudgeSelection(
      selectElement(start(), centreVertex),
      'up',
      true,
    );
    expect(vertexOffset(coarse, 1, 1)?.y).toBeCloseTo(COARSE_NUDGE_STEP, 10);
  });

  it('keeps the previous mesh when an edit would fold a cell', () => {
    const selected = selectElement(start(), centreVertex);
    const folded = moveSelection(selected, -0.9, 0);
    expect(folded.errors.join(' ')).toContain('degenerate or folded');
    expect(folded.outputs).toBe(selected.outputs);
  });

  it('refuses a non-finite offset', () => {
    expect(
      moveSelection(selectElement(start(), centreVertex), Number.NaN, 0).errors,
    ).toHaveLength(1);
  });

  it('refuses to move nothing', () => {
    expect(moveSelection(start(), 0.1, 0).errors.join(' ')).toContain(
      'Nothing is selected',
    );
  });

  it('resets the mesh to its undisplaced grid', () => {
    const moved = moveSelection(selectElement(start(), centreVertex), 0.1, 0.1);
    const reset = resetSurfaceMesh(moved, 'surface-1');
    const warp = firstSurface(reset).warp;
    if (!warp) throw new Error('Mesh missing after reset.');
    expect(meshVertexUv(warp, 1, 1)).toEqual({ u: 0.5, v: 0.5 });
  });

  it('changes mesh resolution and discards old displacements', () => {
    const moved = moveSelection(selectElement(start(), centreVertex), 0.1, 0.1);
    const resized = setMeshResolution(moved, 'surface-1', 4, 4);
    expect(firstSurface(resized).warp?.rows).toBe(4);
    expect(
      firstSurface(resized).warp?.displacements.every(
        ({ x, y }) => x === 0 && y === 0,
      ),
    ).toBe(true);
  });

  it('refuses an out-of-range mesh resolution', () => {
    expect(setMeshResolution(start(), 'surface-1', 64, 64).errors.length)
      .toBeGreaterThan(0);
  });

  it('refuses to move a vertex on a surface with no mesh', () => {
    const state = selectElement(start({ warp: null }), centreVertex);
    expect(moveSelection(state, 0.1, 0).errors.join(' ')).toContain(
      'has no mesh',
    );
  });
});

describe('mask editing', () => {
  const rectangle = createMaskPath(
    rectangleMaskNodes(0.2, 0.2, 0.8, 0.8),
    true,
    0.05,
  );
  const withMask = () => addMaskPath(start(), 'surface-1', rectangle);

  it('adds a mask path', () => {
    const state = withMask();
    expect(state.errors).toHaveLength(0);
    expect(firstSurface(state).maskPaths).toHaveLength(1);
  });

  it('moves a mask node and re-tessellates the path', () => {
    const state = withMask();
    const selected = selectElement(state, {
      kind: 'mask-node',
      surfaceId: 'surface-1',
      maskIndex: 0,
      nodeIndex: 0,
    });
    const moved = moveSelection(selected, 0.05, 0);
    const path = firstSurface(moved).maskPaths[0];
    expect(path?.nodes?.[0]?.point.x).toBeCloseTo(0.25, 10);
    expect(path?.points).not.toEqual(rectangle.points);
  });

  it('keeps the previous mask when a node leaves the surface', () => {
    const selected = selectElement(withMask(), {
      kind: 'mask-node',
      surfaceId: 'surface-1',
      maskIndex: 0,
      nodeIndex: 0,
    });
    const moved = moveSelection(selected, 0, 0.9);
    expect(moved.errors.join(' ')).toContain('outside the surface');
    expect(moved.outputs).toBe(selected.outputs);
  });

  it('sets and bounds mask feathering', () => {
    const state = setMaskFeather(withMask(), 'surface-1', 0, 0.4);
    expect(firstSurface(state).maskPaths[0]?.feather).toBe(0.4);
    const invalid = setMaskFeather(state, 'surface-1', 0, 4);
    expect(invalid.errors.join(' ')).toContain('feather');
    expect(firstSurface(invalid).maskPaths[0]?.feather).toBe(0.4);
  });

  it('removes one mask path', () => {
    expect(
      firstSurface(removeMaskPath(withMask(), 'surface-1', 0)).maskPaths,
    ).toHaveLength(0);
  });

  it('reports a missing mask path', () => {
    expect(removeMaskPath(start(), 'surface-1', 3).errors).toHaveLength(1);
  });

  it('removes every mask on reset', () => {
    const two = addMaskPath(withMask(), 'surface-1', rectangle);
    expect(firstSurface(resetSurfaceMasks(two, 'surface-1')).maskPaths)
      .toHaveLength(0);
  });
});

describe('history', () => {
  it('undoes and redoes a mesh edit', () => {
    const moved = moveSelection(
      selectElement(start(), centreVertex),
      0.1,
      0.1,
    );
    expect(canUndo(moved)).toBe(true);
    const back = undo(moved);
    expect(vertexOffset(back, 1, 1)).toEqual({ x: 0, y: 0 });
    expect(canRedo(back)).toBe(true);
    expect(vertexOffset(redo(back), 1, 1)).toEqual({ x: 0.1, y: 0.1 });
  });

  it('undoes a mask edit and a mesh edit in order', () => {
    const meshEdit = moveSelection(
      selectElement(start(), centreVertex),
      0.1,
      0,
    );
    const maskEdit = addMaskPath(
      meshEdit,
      'surface-1',
      createMaskPath(rectangleMaskNodes(0.2, 0.2, 0.8, 0.8), true),
    );
    const afterFirstUndo = undo(maskEdit);
    expect(firstSurface(afterFirstUndo).maskPaths).toHaveLength(0);
    expect(vertexOffset(afterFirstUndo, 1, 1)).toEqual({ x: 0.1, y: 0 });
    expect(vertexOffset(undo(afterFirstUndo), 1, 1)).toEqual({ x: 0, y: 0 });
  });

  it('discards the redo branch after a new edit', () => {
    const moved = moveSelection(selectElement(start(), centreVertex), 0.1, 0);
    const branched = moveSelection(
      selectElement(undo(moved), centreVertex),
      -0.1,
      0,
    );
    expect(canRedo(branched)).toBe(false);
  });

  it('does not record a refused edit', () => {
    const selected = selectElement(start(), centreVertex);
    const refused = moveSelection(selected, -0.9, 0);
    expect(canUndo(refused)).toBe(false);
  });

  it('is a no-op at the ends of the stack', () => {
    const state = start();
    expect(undo(state).outputs).toBe(state.outputs);
    expect(redo(state).outputs).toBe(state.outputs);
  });

  it('bounds the history depth', () => {
    let state = selectElement(start(), centreVertex);
    for (let step = 0; step < MAX_EDIT_HISTORY + 10; step += 1) {
      state = selectElement(nudgeSelection(state, 'right'), centreVertex);
    }
    expect(state.past.length).toBe(MAX_EDIT_HISTORY);
  });
});
