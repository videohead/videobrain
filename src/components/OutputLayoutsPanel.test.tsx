import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createGraphNode,
  GRAPH_SCHEMA_VERSION,
  type GraphDocument,
} from '../graph';
import type { OutputLayout } from '../store/contracts';
import { OutputLayoutsPanel } from './OutputLayoutsPanel';

const output = (): OutputLayout => ({
  id: 'output-1',
  name: 'Main Output',
  width: 1920,
  height: 1080,
  layoutX: 0,
  layoutY: 0,
  surfaces: [],
});

function graphWithDisplay(wired: boolean): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('plasma', { x: 0, y: 0 }, {}, 'plasma-1'),
      createGraphNode('display', { x: 300, y: 0 }, {}, 'display-1'),
    ],
    edges: wired
      ? [
          {
            id: 'plasma-display',
            source: { nodeId: 'plasma-1', portId: 'frame' },
            target: { nodeId: 'display-1', portId: 'source' },
          },
        ]
      : [],
  };
}

describe('OutputLayoutsPanel', () => {
  it('offers routed Display nodes as assignable output sources', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OutputLayoutsPanel
        outputLayouts={[output()]}
        onChange={onChange}
        graphDocument={graphWithDisplay(true)}
        onOpenPresentation={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add Surface' }));

    const nextLayouts = onChange.mock.calls.at(-1)?.[0] as readonly OutputLayout[];
    expect(nextLayouts[0]?.surfaces[0]?.sourceNodeId).toBe('display-1');

    render(
      <OutputLayoutsPanel
        outputLayouts={nextLayouts}
        onChange={onChange}
        graphDocument={graphWithDisplay(true)}
        onOpenPresentation={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand surface' }));
    const source = screen.getByRole('combobox', { name: 'Source Node' });
    expect(source).toHaveTextContent('display (display-1)');
  });

  it('does not offer unwired Display nodes as output sources', async () => {
    const user = userEvent.setup();
    render(
      <OutputLayoutsPanel
        outputLayouts={[
          {
            ...output(),
            surfaces: [
              {
                id: 'surface-1',
                sourceNodeId: 'plasma-1',
                sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
                warp: null,
                maskPaths: [],
                outputId: 'output-1',
                layerIndex: 0,
                visible: true,
                blend: 'normal',
                opacity: 1,
              },
            ],
          },
        ]}
        onChange={() => undefined}
        graphDocument={graphWithDisplay(false)}
        onOpenPresentation={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand surface' }));
    const source = screen.getByRole('combobox', { name: 'Source Node' });
    expect(source).toHaveTextContent('plasma (plasma-1)');
    expect(source).not.toHaveTextContent('display (display-1)');
  });
});
