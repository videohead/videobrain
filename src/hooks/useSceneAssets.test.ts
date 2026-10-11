import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GRAPH_SCHEMA_VERSION, createGraphNode, type GraphDocument } from '../graph';
import { createAssetStore, createMemoryBackend } from '../store/assetStore';
import { useSceneAssets, type SceneAssetImportResult } from './useSceneAssets';

/** Minimal valid GLB: header + JSON chunk declaring asset 2.0. */
function minimalGlb(): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
  const pad = (4 - (json.length % 4)) % 4;
  const chunkLen = json.length + pad;
  const total = 12 + 8 + chunkLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, chunkLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  for (let i = 20 + json.length; i < total; i += 1) { out[i] = 0x20; }
  return out;
}

function emptyDocument(): GraphDocument {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [], edges: [] };
}

describe('useSceneAssets', () => {
  it('imports a GLB file and exposes its bytes by hash', async () => {
    const store = createAssetStore(createMemoryBackend());
    const { result } = renderHook(() => useSceneAssets(emptyDocument(), store));

    const file = new File([minimalGlb() as BlobPart], 'model.glb', { type: 'model/gltf-binary' });
    let imported!: SceneAssetImportResult;
    await act(async () => {
      imported = await result.current.importFile(file);
    });
    const settled = imported;
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    await waitFor(() => expect(result.current.bytesByHash.has(settled.assetHash)).toBe(true));
    expect(result.current.getStatus(settled.assetId, settled.assetHash)).toBe('ready');
  });

  it('rejects a non-GLB file', async () => {
    const store = createAssetStore(createMemoryBackend());
    const { result } = renderHook(() => useSceneAssets(emptyDocument(), store));

    const file = new File([new Uint8Array([0, 1, 2, 3])], 'bad.bin', { type: 'application/octet-stream' });
    let outcome: SceneAssetImportResult = { ok: true, assetId: '', assetHash: '' };
    await act(async () => {
      outcome = await result.current.importFile(file);
    });
    expect(outcome.ok).toBe(false);
  });

  it('reports missing when a referenced asset is not stored', async () => {
    const store = createAssetStore(createMemoryBackend());
    const hash = 'b'.repeat(64);
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [createGraphNode('asset3d', { x: 0, y: 0 }, { assetId: 'ghost', assetHash: hash }, 'asset')],
      edges: [],
    };
    const { result } = renderHook(() => useSceneAssets(document, store));
    await waitFor(() => expect(result.current.getStatus('ghost', hash)).toBe('missing'));
  });

  it('returns none for an unset asset reference', () => {
    const store = createAssetStore(createMemoryBackend());
    const { result } = renderHook(() => useSceneAssets(emptyDocument(), store));
    expect(result.current.getStatus('', '')).toBe('none');
  });
});
