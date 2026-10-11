import { describe, expect, it } from 'vitest';

import {
  createAssetStore,
  createMemoryBackend,
  type AssetIngestInput,
} from '../store/assetStore';
import type { ScenePlacementTransform, SceneAssetDescriptor } from '../store/contracts';
import {
  createAssetStoreResolver,
  validatePlacement,
  validateSceneAssetDescriptor,
} from './sceneAssetResolver';
import { SceneAssetCache, preflightGlb } from './SceneAssetCache';
import * as THREE from 'three';

function glbInput(bytes: Uint8Array): AssetIngestInput {
  return {
    kind: 'glb',
    bytes,
    mimeType: 'model/gltf-binary',
    originalFilename: 'scene.glb',
  };
}

/** Minimal valid GLB (header + JSON chunk declaring asset 2.0). */
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

const identity: ScenePlacementTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

describe('createAssetStoreResolver', () => {
  it('resolves bytes for a stored asset by ref', async () => {
    const store = createAssetStore(createMemoryBackend());
    const glb = minimalGlb();
    const ingest = await store.ingest(glbInput(glb));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const resolver = createAssetStoreResolver(store);
    const bytes = await resolver(ingest.ref);
    expect(bytes).toBeDefined();
    expect(preflightGlb(bytes!).ok).toBe(true);
  });

  it('returns undefined for a missing asset', async () => {
    const store = createAssetStore(createMemoryBackend());
    const resolver = createAssetStoreResolver(store);
    const bytes = await resolver({ id: 'nope', kind: 'glb', hash: 'a'.repeat(64) });
    expect(bytes).toBeUndefined();
  });

  it('returns undefined on a hash mismatch', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(glbInput(minimalGlb()));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const resolver = createAssetStoreResolver(store);
    const bytes = await resolver({ ...ingest.ref, hash: 'b'.repeat(64) });
    expect(bytes).toBeUndefined();
  });

  it('feeds the SceneAssetCache end to end', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(glbInput(minimalGlb()));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const cache = new SceneAssetCache(
      createAssetStoreResolver(store),
      () => Promise.resolve(new THREE.Group()),
    );
    const result = await cache.loadInto('slot', ingest.ref);
    expect(result.ok).toBe(true);
    expect(cache.residentCount()).toBe(1);
  });
});

describe('validatePlacement', () => {
  it('accepts an identity placement', () => {
    expect(validatePlacement(identity)).toBe(identity);
  });

  it('rejects a non-finite position', () => {
    expect(() => validatePlacement({ ...identity, position: [NaN, 0, 0] })).toThrow();
  });

  it('rejects an out-of-range scale', () => {
    expect(() => validatePlacement({ ...identity, scale: [0, 1, 1] })).toThrow();
    expect(() => validatePlacement({ ...identity, scale: [5000, 1, 1] })).toThrow();
  });

  it('rejects rotation beyond +-360', () => {
    expect(() => validatePlacement({ ...identity, rotation: [720, 0, 0] })).toThrow();
  });
});

describe('validateSceneAssetDescriptor', () => {
  it('accepts a glb descriptor with one placement', () => {
    const descriptor: SceneAssetDescriptor = {
      ref: { id: 'a', kind: 'glb', hash: 'c'.repeat(64) },
      placements: [identity],
    };
    expect(validateSceneAssetDescriptor(descriptor)).toBe(descriptor);
  });

  it('rejects a non-scene asset kind', () => {
    const descriptor: SceneAssetDescriptor = {
      ref: { id: 'a', kind: 'image', hash: 'c'.repeat(64) },
      placements: [identity],
    };
    expect(() => validateSceneAssetDescriptor(descriptor)).toThrow(/glb or gltf/);
  });

  it('rejects zero placements', () => {
    const descriptor: SceneAssetDescriptor = {
      ref: { id: 'a', kind: 'glb', hash: 'c'.repeat(64) },
      placements: [],
    };
    expect(() => validateSceneAssetDescriptor(descriptor)).toThrow(/at least one/);
  });

  it('rejects more than the placement limit', () => {
    const descriptor: SceneAssetDescriptor = {
      ref: { id: 'a', kind: 'glb', hash: 'c'.repeat(64) },
      placements: Array.from({ length: 65 }, () => identity),
    };
    expect(() => validateSceneAssetDescriptor(descriptor)).toThrow(/exceeds/);
  });
});
