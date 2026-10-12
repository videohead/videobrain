import { describe, expect, it } from 'vitest';

import { GRAPH_SCHEMA_VERSION, createGraphNode, type GraphDocument } from '../graph';
import { createMeshWarp, meshVertexIndex } from '../engine/surfaceLayout';
import { createMaskPath, ellipseMaskNodes } from '../engine/surfaceMask';
import type { OutputLayout, SurfaceLayout } from './contracts';
import { createEnvelope, parseEnvelope, serializeEnvelope } from './projectEnvelope';

/**
 * M3 — saved mapping layouts must survive a save/reopen cycle intact, and a
 * corrupted file must be refused rather than silently installed.
 */

function graph(): GraphDocument {
  const source = createGraphNode('plasma', { x: 0, y: 0 }, {}, 'plasma-1');
  const display = createGraphNode('display', { x: 400, y: 0 }, {}, 'display-1');
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [source, display],
    edges: [
      {
        id: 'edge-1',
        source: { nodeId: 'plasma-1', portId: 'frame' },
        target: { nodeId: 'display-1', portId: 'source' },
      },
    ],
  };
}

const surface = (overrides: Partial<SurfaceLayout> = {}): SurfaceLayout => ({
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
  ...overrides,
});

/** Two edited surfaces sharing one source, routed to one named output. */
function mappedOutput(): OutputLayout {
  const warp = createMeshWarp(2, 2);
  const displacements = [...warp.displacements];
  displacements[meshVertexIndex(2, 1, 1)] = { x: 0.08, y: -0.05 };
  return {
    id: 'output-1',
    name: 'Stage Left',
    width: 1920,
    height: 1080,
    layoutX: 0,
    layoutY: 0,
    surfaces: [
      surface({
        id: 'surface-left',
        sourceUvRegion: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
        warp: { ...warp, displacements },
        layerIndex: 0,
      }),
      surface({
        id: 'surface-right',
        sourceUvRegion: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
        maskPaths: [
          createMaskPath(ellipseMaskNodes(0.5, 0.5, 0.4, 0.4), true, 0.15),
        ],
        layerIndex: 1,
        blend: 'screen',
        opacity: 0.8,
      }),
    ],
  };
}

const reopen = (text: string) => parseEnvelope(JSON.parse(text) as unknown);

describe('mapping persistence', () => {
  it('round-trips two edited surfaces through save and reopen', () => {
    const layouts = [mappedOutput()];
    const result = reopen(
      serializeEnvelope(createEnvelope(graph(), { outputLayouts: layouts })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.outputLayouts).toEqual(layouts);

    const restored = result.envelope.outputLayouts[0];
    expect(restored?.name).toBe('Stage Left');
    expect(restored?.surfaces).toHaveLength(2);
    // Mesh displacement, mask nodes, blend and opacity all survive.
    expect(restored?.surfaces[0]?.warp?.displacements[4]).toEqual({
      x: 0.08,
      y: -0.05,
    });
    expect(restored?.surfaces[1]?.maskPaths[0]?.nodes).toHaveLength(4);
    expect(restored?.surfaces[1]?.blend).toBe('screen');
    expect(restored?.surfaces[1]?.opacity).toBe(0.8);
  });

  it('keeps both surfaces pointed at the same evaluated source', () => {
    const result = reopen(
      serializeEnvelope(
        createEnvelope(graph(), { outputLayouts: [mappedOutput()] }),
      ),
    );
    if (!result.ok) return;
    const sources = result.envelope.outputLayouts[0]?.surfaces.map(
      ({ sourceNodeId }) => sourceNodeId,
    );
    expect(sources).toEqual(['plasma-1', 'plasma-1']);
  });

  it('reopens an older project that has no layouts', () => {
    const result = reopen(serializeEnvelope(createEnvelope(graph())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.outputLayouts).toEqual([]);
  });

  it('still accepts a bare graph-only document', () => {
    const result = parseEnvelope(graph());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.outputLayouts).toEqual([]);
  });

  it('refuses a saved layout whose geometry folds', () => {
    const folded = mappedOutput();
    const warp = folded.surfaces[0]?.warp;
    if (!warp) throw new Error('Fixture mesh missing.');
    const displacements = [...warp.displacements];
    displacements[meshVertexIndex(2, 0, 1)] = { x: -1.5, y: 0 };
    const payload = JSON.stringify(
      createEnvelope(graph(), {
        outputLayouts: [
          {
            ...folded,
            surfaces: [
              { ...folded.surfaces[0], warp: { ...warp, displacements } } as SurfaceLayout,
            ],
          },
        ],
      }),
    );
    const result = reopen(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('folded');
  });

  it('refuses a saved layout that exceeds the output pixel ceiling', () => {
    const huge = Array.from({ length: 4 }, (_, index) => ({
      ...mappedOutput(),
      id: `output-${index}`,
      width: 7680,
      height: 4320,
      surfaces: [],
    }));
    const result = reopen(
      JSON.stringify(createEnvelope(graph(), { outputLayouts: huge })),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a malformed layout payload', () => {
    const result = reopen(
      JSON.stringify({
        ...createEnvelope(graph()),
        outputLayouts: [{ id: 'output-1' }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses layouts that are not an array', () => {
    const result = reopen(
      JSON.stringify({ ...createEnvelope(graph()), outputLayouts: 'nope' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('must be an array');
  });

  it('saves edge-blend settings per output', () => {
    const blended: OutputLayout = {
      ...mappedOutput(),
      blend: {
        edges: { left: 0, right: 0.18, top: 0, bottom: 0 },
        curve: 1.6,
        gamma: 2.2,
        brightness: 0.9,
        blackLevelLift: 0.04,
      },
    };
    const neighbour: OutputLayout = {
      ...mappedOutput(),
      id: 'output-2',
      name: 'Stage Right',
      surfaces: [],
      blend: {
        edges: { left: 0.18, right: 0, top: 0, bottom: 0 },
        curve: 1.6,
        gamma: 2.2,
        brightness: 0.9,
        blackLevelLift: 0.04,
      },
    };
    const result = reopen(
      serializeEnvelope(
        createEnvelope(graph(), { outputLayouts: [blended, neighbour] }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.outputLayouts).toEqual([blended, neighbour]);
    // The two facing edges keep matching widths and curves, which is what
    // the seam depends on.
    expect(result.envelope.outputLayouts[0]?.blend?.edges.right).toBe(0.18);
    expect(result.envelope.outputLayouts[1]?.blend?.edges.left).toBe(0.18);
  });

  it('reopens an output that has no blend settings', () => {
    const result = reopen(
      serializeEnvelope(
        createEnvelope(graph(), { outputLayouts: [mappedOutput()] }),
      ),
    );
    if (!result.ok) return;
    expect(result.envelope.outputLayouts[0]?.blend).toBeUndefined();
  });

  it('refuses a saved blend that leaves no full-brightness interior', () => {
    const broken: OutputLayout = {
      ...mappedOutput(),
      blend: {
        edges: { left: 0.5, right: 0.5, top: 0, bottom: 0 },
        curve: 1,
        gamma: 2.2,
        brightness: 1,
        blackLevelLift: 0,
      },
    };
    const result = reopen(
      JSON.stringify(createEnvelope(graph(), { outputLayouts: [broken] })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('overlap each other');
  });

  it('does not serialize any credential-like field', () => {
    const text = serializeEnvelope(
      createEnvelope(graph(), { outputLayouts: [mappedOutput()] }),
    );
    expect(text).not.toMatch(/token|apiKey|secret|authorization|signedUrl/i);
  });
});
