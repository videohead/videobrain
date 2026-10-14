import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GraphDocument } from '../graph';
import { preflightGlb } from '../engine/SceneAssetCache';
import { companionKey } from '../engine/gltfPack';
import { importSceneToGlb, SCENE_IMPORT_EXTENSIONS } from '../engine/sceneImport';
import {
  createAssetStore,
  createIndexedDbBackend,
  createMemoryBackend,
  type AssetStore,
} from '../store/assetStore';

export type SceneAssetImportResult =
  | { ok: true; assetId: string; assetHash: string }
  | { ok: false; error: string };

export interface SceneAssetRuntime {
  /** Decoded-ready asset bytes keyed by content hash, for the renderer bridge. */
  bytesByHash: ReadonlyMap<string, Uint8Array>;
  /** Import a local GLB/glTF file (plus companions for .gltf) into durable storage. */
  importFile: (files: File | readonly File[]) => Promise<SceneAssetImportResult>;
  /** Whether a node's referenced asset resolves to stored bytes. */
  getStatus: (assetId: string, assetHash: string) => 'ready' | 'missing' | 'none';
  store: AssetStore;
}

const MAX_SCENE_ASSET_BYTES = 50 * 1024 * 1024;

function defaultStore(): AssetStore {
  try {
    if (typeof indexedDB !== 'undefined') {
      return createAssetStore(createIndexedDbBackend());
    }
  } catch {
    // Fall through to memory backend when IndexedDB is unavailable.
  }
  return createAssetStore(createMemoryBackend());
}

/** Collect the asset ids referenced by Asset 3D nodes in the document. */
function referencedAssets(document: GraphDocument): { id: string; hash: string }[] {
  const seen = new Map<string, string>();
  for (const node of document.nodes) {
    if (node.kind !== 'asset3d') {
      continue;
    }
    const id = typeof node.params.assetId === 'string' ? node.params.assetId : '';
    const hash = typeof node.params.assetHash === 'string' ? node.params.assetHash : '';
    if (id.length > 0 && /^[a-f0-9]{64}$/.test(hash)) {
      seen.set(id, hash);
    }
  }
  return Array.from(seen, ([id, hash]) => ({ id, hash }));
}

export function useSceneAssets(
  document: GraphDocument,
  injectedStore?: AssetStore,
): SceneAssetRuntime {
  const [store] = useState<AssetStore>(() => injectedStore ?? defaultStore());
  const [bytesByHash, setBytesByHash] = useState<ReadonlyMap<string, Uint8Array>>(new Map());
  const [statusByHash, setStatusByHash] = useState<ReadonlyMap<string, 'ready' | 'missing'>>(new Map());

  const assetKey = useMemo(
    () => referencedAssets(document).map(({ id, hash }) => `${id}:${hash}`).join('|'),
    [document],
  );

  useEffect(() => {
    let cancelled = false;
    const refs = assetKey.length === 0
      ? []
      : assetKey.split('|').map((entry) => {
          const [id = '', hash = ''] = entry.split(':');
          return { id, hash };
        });
    void (async () => {
      const bytes = new Map<string, Uint8Array>();
      const status = new Map<string, 'ready' | 'missing'>();
      for (const { id, hash } of refs) {
        const record = await store.resolve(id);
        if (record && record.manifest.ref.hash === hash) {
          bytes.set(hash, record.bytes);
          status.set(hash, 'ready');
        } else {
          status.set(hash, 'missing');
        }
      }
      if (!cancelled) {
        setBytesByHash(bytes);
        setStatusByHash(status);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetKey, store]);

  const importFile = useCallback<SceneAssetRuntime['importFile']>(
    async (files) => {
      const selected: readonly File[] = Array.isArray(files) ? (files as readonly File[]) : [files as File];
      if (selected.length === 0) {
        return { ok: false, error: 'No file selected.' };
      }
      const total = selected.reduce((sum, entry) => sum + entry.size, 0);
      if (total > MAX_SCENE_ASSET_BYTES) {
        return { ok: false, error: 'Model exceeds the 50 MB import limit.' };
      }
      const read = new Map<string, Uint8Array>();
      for (const entry of selected) {
        try {
          read.set(companionKey(entry.name), new Uint8Array(await entry.arrayBuffer()));
        } catch {
          return { ok: false, error: `The file "${entry.name}" could not be read.` };
        }
      }
      const modelPattern = new RegExp(`\\.(${SCENE_IMPORT_EXTENSIONS.join('|')})$`, 'i');
      const primary = (selected.find((entry) => modelPattern.test(entry.name)) ?? selected[0])!;
      const primaryBytes = read.get(companionKey(primary.name));
      if (!primaryBytes) {
        return { ok: false, error: 'The model file could not be read.' };
      }
      const companions = selected
        .filter((entry) => entry !== primary)
        .map((entry) => ({ name: entry.name, bytes: read.get(companionKey(entry.name))! }));
      const converted = await importSceneToGlb({ name: primary.name, bytes: primaryBytes }, companions);
      if (!converted.ok) {
        return { ok: false, error: converted.error };
      }
      const bytes = converted.glb;
      const preflight = preflightGlb(bytes);
      if (!preflight.ok) {
        return { ok: false, error: preflight.error };
      }
      const ingest = await store.ingest({
        kind: 'glb',
        bytes,
        mimeType: 'model/gltf-binary',
        originalFilename: primary.name,
      });
      if (!ingest.ok) {
        return { ok: false, error: ingest.error };
      }
      setBytesByHash((previous) => {
        const next = new Map(previous);
        next.set(ingest.ref.hash, bytes);
        return next;
      });
      setStatusByHash((previous) => {
        const next = new Map(previous);
        next.set(ingest.ref.hash, 'ready');
        return next;
      });
      return { ok: true, assetId: ingest.ref.id, assetHash: ingest.ref.hash };
    },
    [store],
  );

  const getStatus = useCallback<SceneAssetRuntime['getStatus']>(
    (assetId, assetHash) => {
      if (assetId.length === 0 || !/^[a-f0-9]{64}$/.test(assetHash)) {
        return 'none';
      }
      return statusByHash.get(assetHash) ?? 'missing';
    },
    [statusByHash],
  );

  return { bytesByHash, importFile, getStatus, store };
}
