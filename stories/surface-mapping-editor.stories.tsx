import { useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SurfaceMappingEditor } from '../src/components/SurfaceMappingEditor';
import {
  createEditorState,
  type SurfaceEditorState,
} from '../src/engine/surfaceEditor';
import { createMeshWarp } from '../src/engine/surfaceLayout';
import {
  createMaskPath,
  ellipseMaskNodes,
} from '../src/engine/surfaceMask';
import type { OutputLayout } from '../src/store/contracts';
import './catalog.css';

const WIDTH = 480;
const HEIGHT = 270;

/** Procedural stand-in for a graph frame, so the story needs no assets. */
function createTestPattern(): HTMLCanvasElement | null {
  const element = document.createElement('canvas');
  element.width = 320;
  element.height = 180;
  const context = element.getContext('2d');
  if (!context) return null;
  const columns = 8;
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      context.fillStyle = (row + column) % 2 === 0 ? '#1d2630' : '#d8ff5f';
      context.fillRect(
        (column * element.width) / columns,
        (row * element.height) / rows,
        element.width / columns,
        element.height / rows,
      );
    }
  }
  context.strokeStyle = '#ff795c';
  context.lineWidth = 6;
  context.strokeRect(3, 3, element.width - 6, element.height - 6);
  return element;
}

function makeLayout(): OutputLayout {
  return {
    id: 'output-1',
    name: 'Main Display',
    width: 1920,
    height: 1080,
    layoutX: 0,
    layoutY: 0,
    surfaces: [
      {
        id: 'surface-1',
        sourceNodeId: 'plasma-1',
        sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
        warp: createMeshWarp(3, 3),
        maskPaths: [
          createMaskPath(ellipseMaskNodes(0.5, 0.5, 0.42, 0.42), true, 0.12),
        ],
        outputId: 'output-1',
        layerIndex: 0,
        visible: true,
        blend: 'normal',
        opacity: 1,
      },
    ],
  };
}

function MappingDemo({ cleanOutput = false }: { cleanOutput?: boolean }) {
  const [state, setState] = useState<SurfaceEditorState>(() =>
    createEditorState([makeLayout()]),
  );
  const source = useMemo(() => {
    const pattern = createTestPattern();
    return pattern
      ? { image: pattern, width: pattern.width, height: pattern.height }
      : undefined;
  }, []);

  return (
    <section className="vb-story">
      <div>
        <h1>Surface mapping editor</h1>
        <p className="vb-story-intro">
          Drag mesh points to align a frame onto an irregular surface, cut it
          with feathered Bezier masks, and overlay a calibration grid while
          aligning. Edits that would fold a mesh cell or push a mask node off
          the surface are refused, leaving the previous alignment in place.
          Clean output drops every handle and shows only the mapped frame.
        </p>
      </div>
      <SurfaceMappingEditor
        state={state}
        surfaceId="surface-1"
        onChange={setState}
        source={source}
        cleanOutput={cleanOutput}
        width={WIDTH}
        height={HEIGHT}
      />
      <p className="vb-story-status">
        {state.errors[0] ?? `History: ${state.past.length} undo steps`}
      </p>
    </section>
  );
}

const meta: Meta<typeof MappingDemo> = {
  title: 'Controls/Surface Mapping Editor',
  component: MappingDemo,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof MappingDemo>;

export const Editing: Story = { args: { cleanOutput: false } };

export const CleanOutput: Story = { args: { cleanOutput: true } };
