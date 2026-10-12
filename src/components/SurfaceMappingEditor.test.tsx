import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { OutputLayout, SurfaceLayout } from '../store/contracts';
import { createMeshWarp } from '../engine/surfaceLayout';
import { createMaskPath, rectangleMaskNodes } from '../engine/surfaceMask';
import {
  createEditorState,
  type SurfaceEditorState,
} from '../engine/surfaceEditor';
import { SurfaceMappingEditor } from './SurfaceMappingEditor';

const WIDTH = 400;
const HEIGHT = 200;

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

const layout = (overrides: Partial<SurfaceLayout> = {}): OutputLayout => ({
  id: 'output-1',
  name: 'Main Display',
  width: 1920,
  height: 1080,
  layoutX: 0,
  layoutY: 0,
  surfaces: [surface(overrides)],
});

/**
 * jsdom reports a zero-sized SVG, so pointer maths would divide by zero.
 * Pin the overlay bounds to the rendered size instead.
 */
function stubBounds(): void {
  Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: WIDTH,
      height: HEIGHT,
      right: WIDTH,
      bottom: HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function Harness({
  initial,
  cleanOutput = false,
}: {
  initial?: Partial<SurfaceLayout>;
  cleanOutput?: boolean;
}) {
  const [state, setState] = useState<SurfaceEditorState>(() =>
    createEditorState([layout(initial)]),
  );
  return (
    <>
      <SurfaceMappingEditor
        state={state}
        surfaceId="surface-1"
        onChange={setState}
        cleanOutput={cleanOutput}
        width={WIDTH}
        height={HEIGHT}
      />
      <output data-testid="probe">
        {JSON.stringify({
          warp: state.outputs[0]?.surfaces[0]?.warp?.displacements,
          masks: state.outputs[0]?.surfaces[0]?.maskPaths.length,
          locked: state.locked,
          errors: state.errors,
        })}
      </output>
    </>
  );
}

const probe = () =>
  JSON.parse(screen.getByTestId('probe').textContent ?? '{}') as {
    warp?: { x: number; y: number }[];
    masks: number;
    locked: string[];
    errors: string[];
  };

describe('SurfaceMappingEditor', () => {
  it('reports when no surface matches', () => {
    render(
      <SurfaceMappingEditor
        state={createEditorState([layout()])}
        surfaceId="missing"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('No surface selected')).toBeTruthy();
  });

  it('renders a handle for every mesh vertex', () => {
    render(<Harness />);
    // A 2x2 mesh has nine vertices.
    expect(screen.getAllByRole('button', { name: /^Mesh vertex/ })).toHaveLength(9);
    expect(screen.getByText('9 points, 0 masks')).toBeTruthy();
  });

  it('selects a vertex and nudges it with the keyboard', () => {
    stubBounds();
    render(<Harness />);
    const vertex = screen.getByRole('button', { name: 'Mesh vertex 1, 1' });
    fireEvent.pointerDown(vertex, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(vertex, { pointerId: 1 });
    expect(vertex.getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' });
    const moved = probe().warp?.[4];
    expect(moved?.x).toBeGreaterThan(0);
    expect(moved?.y).toBe(0);
  });

  it('takes a larger step when Shift is held', () => {
    stubBounds();
    render(<Harness />);
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Mesh vertex 1, 1' }),
      { pointerId: 1, clientX: 200, clientY: 100 },
    );
    const overlay = screen.getByRole('application');
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    const fine = probe().warp?.[4]?.x ?? 0;
    fireEvent.keyDown(overlay, { key: 'ArrowRight', shiftKey: true });
    const coarse = (probe().warp?.[4]?.x ?? 0) - fine;
    expect(coarse).toBeGreaterThan(fine);
  });

  it('drags a vertex to a new position', () => {
    stubBounds();
    render(<Harness />);
    const vertex = screen.getByRole('button', { name: 'Mesh vertex 1, 1' });
    fireEvent.pointerDown(vertex, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(vertex, { pointerId: 1, clientX: 240, clientY: 100 });
    fireEvent.pointerUp(vertex, { pointerId: 1 });
    expect(probe().warp?.[4]?.x).toBeCloseTo(0.1, 5);
  });

  it('refuses a drag that would fold a cell and keeps the mesh', () => {
    stubBounds();
    render(<Harness />);
    const vertex = screen.getByRole('button', { name: 'Mesh vertex 1, 1' });
    fireEvent.pointerDown(vertex, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(vertex, { pointerId: 1, clientX: -400, clientY: 100 });
    fireEvent.pointerUp(vertex, { pointerId: 1 });
    expect(probe().warp?.[4]).toEqual({ x: 0, y: 0 });
    expect(screen.getByRole('alert').textContent).toContain('folded');
  });

  it('clears the selection with Escape', () => {
    stubBounds();
    render(<Harness />);
    const vertex = screen.getByRole('button', { name: 'Mesh vertex 0, 0' });
    fireEvent.pointerDown(vertex, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(vertex, { pointerId: 1 });
    expect(vertex.getAttribute('data-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Escape' });
    expect(
      screen
        .getByRole('button', { name: 'Mesh vertex 0, 0' })
        .getAttribute('data-selected'),
    ).toBe('false');
  });

  it('changes the mesh resolution', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Mesh resolution'), {
      target: { value: '3' },
    });
    expect(screen.getAllByRole('button', { name: /^Mesh vertex/ })).toHaveLength(16);
  });

  it('adds a mask with the mask tool and exposes its nodes', () => {
    stubBounds();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add mask' }));
    fireEvent.pointerDown(screen.getByRole('application'), {
      pointerId: 2,
      clientX: 200,
      clientY: 100,
    });
    expect(probe().masks).toBe(1);
    expect(screen.getAllByRole('button', { name: /^Mask 1 node/ })).toHaveLength(4);
  });

  it('draws a freehand mask from a pointer stroke', () => {
    stubBounds();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw mask' }));
    const overlay = screen.getByRole('application');
    fireEvent.pointerDown(overlay, { pointerId: 3, clientX: 100, clientY: 50 });
    for (const [x, y] of [
      [300, 50],
      [300, 150],
      [100, 150],
    ] as const) {
      fireEvent.pointerMove(overlay, { pointerId: 3, clientX: x, clientY: y });
    }
    fireEvent.pointerUp(overlay, { pointerId: 3 });
    expect(probe().masks).toBe(1);
  });

  it('adjusts mask feathering', () => {
    render(
      <Harness
        initial={{
          maskPaths: [
            createMaskPath(rectangleMaskNodes(0.2, 0.2, 0.8, 0.8), true, 0),
          ],
        }}
      />,
    );
    const slider = screen.getByLabelText('Mask feather');
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect((slider as HTMLInputElement).value).toBe('0.3');
  });

  it('removes every mask', () => {
    render(
      <Harness
        initial={{
          maskPaths: [
            createMaskPath(rectangleMaskNodes(0.2, 0.2, 0.8, 0.8), true, 0),
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove masks' }));
    expect(probe().masks).toBe(0);
  });

  it('locks the surface and blocks further edits', () => {
    stubBounds();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Lock surface' }));
    expect(probe().locked).toEqual(['surface-1']);
    expect(screen.getByText('Surface locked')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reset mesh' }),
    ).toHaveProperty('disabled', true);

    const vertex = screen.getByRole('button', { name: 'Mesh vertex 1, 1' });
    fireEvent.pointerDown(vertex, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(vertex, { pointerId: 1, clientX: 260, clientY: 100 });
    fireEvent.pointerUp(vertex, { pointerId: 1 });
    expect(probe().warp?.[4]).toEqual({ x: 0, y: 0 });
  });

  it('resets the mesh and supports undo and redo', () => {
    stubBounds();
    render(<Harness />);
    const vertex = screen.getByRole('button', { name: 'Mesh vertex 1, 1' });
    fireEvent.pointerDown(vertex, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(vertex, { pointerId: 1, clientX: 240, clientY: 100 });
    fireEvent.pointerUp(vertex, { pointerId: 1 });
    expect(probe().warp?.[4]?.x).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Reset mesh' }));
    expect(probe().warp?.[4]).toEqual({ x: 0, y: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(probe().warp?.[4]?.x).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(probe().warp?.[4]).toEqual({ x: 0, y: 0 });
  });

  it('disables undo until an edit has been made', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('toggles the calibration pattern', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Calibration pattern' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no editing interface in clean output', () => {
    render(<Harness cleanOutput />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('application')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByLabelText('Mapped frame')).toBeTruthy();
  });
});
