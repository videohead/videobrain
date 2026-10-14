import { describe, expect, it } from 'vitest';

import {
  GRAPH_SCHEMA_VERSION,
  createGraphNode,
  type GraphDocument,
} from '../graph';
import {
  composeOutput,
  planOutputs,
  type OutputSource,
} from '../engine/outputComposer';
import {
  createMeshWarp,
  meshVertexIndex,
  validateOutputLayouts,
} from '../engine/surfaceLayout';
import { createMaskPath, ellipseMaskNodes } from '../engine/surfaceMask';
import {
  addMaskPath,
  createEditorState,
  moveSelection,
  selectElement,
  undo,
} from '../engine/surfaceEditor';
import { createAssetStore, createMemoryBackend } from './assetStore';
import type { OutputLayout, SurfaceLayout } from './contracts';
import {
  createEnvelope,
  exportBundle,
  importBundle,
  parseEnvelope,
  serializeEnvelope,
} from './projectEnvelope';

/**
 * I1 — cross-track baseline.
 *
 * Walks one project the way a user would: a durable asset enters the shared
 * store, the graph that consumes it is authored, two surfaces are mapped and
 * edited, the output is composed cleanly, and the whole thing is saved,
 * reopened and exported as a portable bundle.
 *
 * ── Honest scope ────────────────────────────────────────────────
 * The asset here is ingested directly. G1/G2 (provider-neutral generation
 * jobs and their UI) are still `waiting`, so **nothing in this file is
 * evidence that a generated result reaches the store through a job
 * lifecycle.** It exercises the asset/mapping/persistence tracks that do
 * exist, standing in for the shape a generated result would take.
 */

const SIZE = { width: 400, height: 200 };

/** Stand-in for a generated image: a few bytes with an image MIME type. */
const generatedBytes = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function graph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('plasma', { x: 0, y: 0 }, {}, 'plasma-1'),
      createGraphNode('colorGrade', { x: 300, y: 0 }, {}, 'grade-1'),
      createGraphNode('display', { x: 600, y: 0 }, {}, 'display-1'),
    ],
    edges: [
      {
        id: 'edge-source',
        source: { nodeId: 'plasma-1', portId: 'frame' },
        target: { nodeId: 'grade-1', portId: 'source' },
      },
      {
        id: 'edge-display',
        source: { nodeId: 'grade-1', portId: 'frame' },
        target: { nodeId: 'display-1', portId: 'source' },
      },
    ],
  };
}

const surface = (overrides: Partial<SurfaceLayout> = {}): SurfaceLayout => ({
  id: 'surface-left',
  // Both surfaces read the post-effect node, which is the "frame effects"
  // leg of the baseline path.
  sourceNodeId: 'grade-1',
  sourceUvRegion: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
  warp: createMeshWarp(2, 2),
  maskPaths: [],
  outputId: 'output-1',
  layerIndex: 0,
  visible: true,
  blend: 'normal',
  opacity: 1,
  ...overrides,
});

function baselineOutput(): OutputLayout {
  return {
    id: 'output-1',
    name: 'Stage',
    width: 1920,
    height: 1080,
    layoutX: 0,
    layoutY: 0,
    surfaces: [
      surface(),
      surface({
        id: 'surface-right',
        sourceUvRegion: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
        layerIndex: 1,
      }),
    ],
  };
}

const fakeImage = {} as CanvasImageSource;
const makeSource = (): OutputSource => ({
  image: fakeImage,
  width: 320,
  height: 180,
});

function recorder() {
  const drawn: number[] = [];
  const context = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => {},
    fill: () => {},
    setTransform: () => {},
    drawImage: () => drawn.push(context.globalAlpha),
    clearRect: () => {},
    fillRect: () => {},
    filter: 'none',
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    globalAlpha: 1,
  };
  return { context, drawn };
}

function composeTargets() {
  const main = recorder();
  const layer = recorder();
  const mask = recorder();
  return {
    main,
    options: {
      layer: { context: layer.context, canvas: fakeImage },
      mask: { context: mask.context, canvas: fakeImage },
      size: SIZE,
    },
  };
}

describe('I1 combined baseline', () => {
  it('carries an asset, two mapped surfaces and a clean output through save and reopen', async () => {
    const store = createAssetStore(createMemoryBackend());

    // 1. A durable asset enters the shared store.
    const ingest = await store.ingest({
      kind: 'image',
      bytes: generatedBytes(),
      mimeType: 'image/png',
      originalFilename: 'generated.png',
      provenance: 'fixture',
    });
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    // 2. Two surfaces are mapped onto one named output and edited.
    let editor = createEditorState([baselineOutput()]);
    editor = selectElement(editor, {
      kind: 'mesh-vertex',
      surfaceId: 'surface-left',
      row: 1,
      col: 1,
    });
    editor = moveSelection(editor, 0.06, -0.04);
    editor = addMaskPath(
      editor,
      'surface-right',
      createMaskPath(ellipseMaskNodes(0.5, 0.5, 0.35, 0.35), true, 0.1),
    );
    expect(editor.errors).toEqual([]);

    // 3. The edited layout is valid and routed to one output.
    const plan = planOutputs(editor.outputs);
    expect(plan.valid).toBe(true);
    expect(plan.sourceNodeIds).toEqual(['grade-1']);

    // 4. The output composes cleanly, evaluating its source exactly once.
    const { main, options } = composeTargets();
    let evaluations = 0;
    const report = composeOutput(
      main.context,
      editor.outputs[0] as OutputLayout,
      {
        ...options,
        resolveSource: () => {
          evaluations += 1;
          return makeSource();
        },
      },
    );
    expect(report.drawn).toBe(2);
    expect(report.missingSources).toEqual([]);
    expect(evaluations).toBe(1);
    expect(report.sourceEvaluations).toBe(1);

    // 5. Save and reopen preserves the graph, the asset and the mapping.
    const manifest = await store.getManifest(ingest.ref.id);
    expect(manifest).toBeDefined();
    if (!manifest) return;
    const saved = serializeEnvelope(
      createEnvelope(graph(), {
        assetManifests: { [ingest.ref.id]: manifest },
        outputLayouts: editor.outputs,
      }),
    );
    const reopened = parseEnvelope(JSON.parse(saved) as unknown);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.envelope.outputLayouts).toEqual(editor.outputs);
    expect(reopened.envelope.assetManifests[ingest.ref.id]).toEqual(manifest);
    expect(reopened.envelope.graphDocument.nodes).toHaveLength(3);

    // 6. The reopened layout still composes to the same result.
    const second = composeTargets();
    const replay = composeOutput(
      second.main.context,
      reopened.envelope.outputLayouts[0] as OutputLayout,
      { ...second.options, resolveSource: makeSource },
    );
    expect(replay.drawn).toBe(report.drawn);
    expect(replay.triangles).toBe(report.triangles);
  });

  it('round-trips the whole project as a portable bundle', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest({
      kind: 'image',
      bytes: generatedBytes(),
      mimeType: 'image/png',
      originalFilename: 'generated.png',
    });
    if (!ingest.ok) return;
    const manifest = await store.getManifest(ingest.ref.id);
    if (!manifest) return;

    const envelope = createEnvelope(graph(), {
      assetManifests: { [ingest.ref.id]: manifest },
      outputLayouts: [baselineOutput()],
    });
    const bundle = await exportBundle(envelope, store);
    expect(bundle).not.toMatch(/token|apiKey|secret|authorization|signedUrl/i);

    // Import into a clean store, as another machine would.
    const target = createAssetStore(createMemoryBackend());
    const imported = await importBundle(bundle, target);
    expect(imported.ok ? null : imported.error).toBeNull();
    if (!imported.ok) return;
    expect(imported.envelope.outputLayouts).toEqual([baselineOutput()]);
    expect(await target.list()).toHaveLength(1);

    // The target store allocates its own ids, so the returned envelope must
    // reference ids that actually resolve there.
    const importedIds = Object.keys(imported.envelope.assetManifests);
    expect(importedIds).toEqual(imported.ingestedIds);
    const restored = await target.resolve(importedIds[0] as string);
    expect(restored?.bytes).toEqual(generatedBytes());

    // Content identity is what carries across machines, and it is unchanged.
    expect(restored?.manifest.ref.hash).toBe(ingest.ref.hash);
  });

  it('keeps editing ordinary when an asset is missing', async () => {
    // A project whose asset was never imported must still open and map.
    const reopened = parseEnvelope(
      JSON.parse(
        serializeEnvelope(
          createEnvelope(graph(), { outputLayouts: [baselineOutput()] }),
        ),
      ) as unknown,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.envelope.assetManifests).toEqual({});

    const store = createAssetStore(createMemoryBackend());
    expect(await store.resolve('never-ingested')).toBeUndefined();
    expect(
      validateOutputLayouts(reopened.envelope.outputLayouts).valid,
    ).toBe(true);
  });

  it('skips a surface whose source node is gone, without failing the output', () => {
    const { main, options } = composeTargets();
    const output: OutputLayout = {
      ...baselineOutput(),
      surfaces: [
        surface(),
        surface({
          id: 'surface-right',
          sourceNodeId: 'deleted-node',
          layerIndex: 1,
        }),
      ],
    };
    const report = composeOutput(main.context, output, {
      ...options,
      resolveSource: (nodeId) =>
        nodeId === 'grade-1' ? makeSource() : undefined,
    });
    expect(report.drawn).toBe(1);
    expect(report.missingSources).toEqual(['deleted-node']);
  });

  it('undoes a mapping edit without disturbing the stored asset', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest({
      kind: 'image',
      bytes: generatedBytes(),
      mimeType: 'image/png',
      originalFilename: 'generated.png',
    });
    if (!ingest.ok) return;

    let editor = createEditorState([baselineOutput()]);
    editor = selectElement(editor, {
      kind: 'mesh-vertex',
      surfaceId: 'surface-left',
      row: 1,
      col: 1,
    });
    editor = moveSelection(editor, 0.05, 0);
    const warp = editor.outputs[0]?.surfaces[0]?.warp;
    expect(warp?.displacements[meshVertexIndex(2, 1, 1)]?.x).toBeCloseTo(0.05, 10);

    editor = undo(editor);
    expect(
      editor.outputs[0]?.surfaces[0]?.warp?.displacements[
        meshVertexIndex(2, 1, 1)
      ],
    ).toEqual({ x: 0, y: 0 });

    // Undo is a layout operation; durable bytes are untouched by it.
    expect(await store.list()).toHaveLength(1);
    expect((await store.resolve(ingest.ref.id))?.bytes).toEqual(generatedBytes());
  });

  it('refuses to reopen a project whose saved mapping is corrupt', () => {
    const corrupt = JSON.parse(
      serializeEnvelope(
        createEnvelope(graph(), { outputLayouts: [baselineOutput()] }),
      ),
    ) as { outputLayouts: OutputLayout[] };
    const target = corrupt.outputLayouts[0]?.surfaces[0];
    if (!target?.warp) throw new Error('Fixture mesh missing.');
    const displacements = [...target.warp.displacements];
    displacements[meshVertexIndex(2, 0, 1)] = { x: -1.5, y: 0 };
    target.warp = { ...target.warp, displacements };

    const result = parseEnvelope(corrupt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('folded');
  });

  it('opens an older graph-only project with no mapping or assets', () => {
    const result = parseEnvelope(graph());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.outputLayouts).toEqual([]);
    expect(result.envelope.assetManifests).toEqual({});
    expect(result.envelope.generationJobs).toEqual([]);
  });
});
