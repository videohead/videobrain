import { describe, expect, it } from 'vitest';

import { DEFAULT_GRAPH, cloneGraphDocument } from '../graph';
import {
  createAssetStore,
  createMemoryBackend,
  type AssetIngestInput,
} from './assetStore';
import {
  BUNDLE_SCHEMA_VERSION,
  createEnvelope,
  exportBundle,
  importBundle,
  parseEnvelope,
  serializeEnvelope,
  serializeGraphOnly,
} from './projectEnvelope';
import { ENVELOPE_SCHEMA_VERSION } from './contracts';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function imageInput(content: string): AssetIngestInput {
  return {
    kind: 'image',
    bytes: bytes(content),
    mimeType: 'image/png',
    originalFilename: 'img.png',
  };
}

describe('parseEnvelope backward compatibility', () => {
  it('wraps a bare schema-1 GraphDocument', () => {
    const result = parseEnvelope(cloneGraphDocument(DEFAULT_GRAPH));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.envelopeVersion).toBe(ENVELOPE_SCHEMA_VERSION);
    expect(result.envelope.graphDocument.schemaVersion).toBe(1);
    expect(result.envelope.assetManifests).toEqual({});
  });

  it('parses a full envelope round-trip', () => {
    const envelope = createEnvelope(cloneGraphDocument(DEFAULT_GRAPH));
    const serialized = serializeEnvelope(envelope);
    const result = parseEnvelope(JSON.parse(serialized));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.graphDocument.nodes.length).toBe(DEFAULT_GRAPH.nodes.length);
  });

  it('rejects an unsupported envelope version', () => {
    const result = parseEnvelope({
      envelopeVersion: ENVELOPE_SCHEMA_VERSION + 1,
      graphDocument: DEFAULT_GRAPH,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an envelope whose graph cannot compile', () => {
    const broken = cloneGraphDocument(DEFAULT_GRAPH);
    broken.edges.push({
      id: 'dangling',
      source: { nodeId: 'missing', portId: 'frame' },
      target: { nodeId: 'display', portId: 'source' },
    });
    const result = parseEnvelope({
      envelopeVersion: ENVELOPE_SCHEMA_VERSION,
      graphDocument: broken,
    });
    expect(result.ok).toBe(false);
  });
});

describe('serializeGraphOnly', () => {
  it('produces a legacy graph-only document', () => {
    const envelope = createEnvelope(cloneGraphDocument(DEFAULT_GRAPH));
    const json = serializeGraphOnly(envelope);
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toHaveProperty('schemaVersion', 1);
    expect(parsed).not.toHaveProperty('envelopeVersion');
  });
});

describe('portable bundle round-trip', () => {
  it('exports and reimports assets into a fresh store', async () => {
    const sourceStore = createAssetStore(createMemoryBackend());
    const ingest = await sourceStore.ingest(imageInput('bundle-asset'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const manifest = await sourceStore.getManifest(ingest.ref.id);
    if (!manifest) throw new Error('manifest missing');

    const envelope = createEnvelope(cloneGraphDocument(DEFAULT_GRAPH), {
      assetManifests: { [ingest.ref.id]: manifest },
    });
    const bundleJson = await exportBundle(envelope, sourceStore);

    const targetStore = createAssetStore(createMemoryBackend());
    const result = await importBundle(JSON.parse(bundleJson), targetStore);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ingestedIds).toHaveLength(1);

    const reimported = await targetStore.resolve(result.ingestedIds[0]!);
    expect(reimported?.manifest.ref.hash).toBe(manifest.ref.hash);
    expect(new TextDecoder().decode(reimported!.bytes)).toBe('bundle-asset');
  });

  it('does not embed bytes for missing assets but still imports the graph', async () => {
    const store = createAssetStore(createMemoryBackend());
    const envelope = createEnvelope(cloneGraphDocument(DEFAULT_GRAPH), {
      assetManifests: {
        'ghost-id': {
          manifestVersion: 1,
          ref: { id: 'ghost-id', kind: 'image', hash: 'b'.repeat(64) },
          mimeType: 'image/png',
          encodedBytes: 10,
          originalFilename: 'ghost.png',
          dependencyIds: [],
          provenance: '',
        },
      },
    });
    const bundleJson = await exportBundle(envelope, store);
    const bundle: unknown = JSON.parse(bundleJson);
    expect(bundle).toHaveProperty('assets', {});

    const target = createAssetStore(createMemoryBackend());
    const result = await importBundle(bundle, target);
    expect(result.ok).toBe(true);
  });
});

describe('bundle validation and limits', () => {
  it('rejects a malformed bundle', async () => {
    const store = createAssetStore(createMemoryBackend());
    const result = await importBundle({ notABundle: true }, store);
    expect(result.ok).toBe(false);
  });

  it('rejects an asset id with path traversal', async () => {
    const store = createAssetStore(createMemoryBackend());
    const bundle = {
      bundleVersion: BUNDLE_SCHEMA_VERSION,
      envelope: createEnvelope(cloneGraphDocument(DEFAULT_GRAPH)),
      assets: {
        '../escape': {
          manifest: {
            manifestVersion: 1,
            ref: { id: '../escape', kind: 'image', hash: 'c'.repeat(64) },
            mimeType: 'image/png',
            encodedBytes: 4,
            originalFilename: 'x.png',
            dependencyIds: [],
            provenance: '',
          },
          bytesBase64: btoa('data'),
        },
      },
    };
    const result = await importBundle(bundle, store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unsafe asset id|Invalid asset manifest/);
  });

  it('rejects invalid base64 asset content', async () => {
    const store = createAssetStore(createMemoryBackend());
    const good = await store.ingest(imageInput('seed'));
    expect(good.ok).toBe(true);

    const bundle = {
      bundleVersion: BUNDLE_SCHEMA_VERSION,
      envelope: createEnvelope(cloneGraphDocument(DEFAULT_GRAPH)),
      assets: {
        'valid-id-123': {
          manifest: {
            manifestVersion: 1,
            ref: { id: 'valid-id-123', kind: 'image', hash: 'd'.repeat(64) },
            mimeType: 'image/png',
            encodedBytes: 4,
            originalFilename: 'x.png',
            dependencyIds: [],
            provenance: '',
          },
          bytesBase64: '!!!not base64!!!',
        },
      },
    };
    const result = await importBundle(bundle, store);
    expect(result.ok).toBe(false);
  });
});

describe('bundle rollback', () => {
  it('removes newly ingested assets but preserves pre-existing ones on failure', async () => {
    const store = createAssetStore(createMemoryBackend());
    // Pre-existing asset in the target store.
    const existing = await store.ingest(imageInput('already-here'));
    expect(existing.ok).toBe(true);
    if (!existing.ok) return;

    // Build a bundle: one good new asset, then one that fails ingest (empty bytes).
    const bundle = {
      bundleVersion: BUNDLE_SCHEMA_VERSION,
      envelope: createEnvelope(cloneGraphDocument(DEFAULT_GRAPH)),
      assets: {
        'new-good-asset': {
          manifest: {
            manifestVersion: 1,
            ref: { id: 'new-good-asset', kind: 'image', hash: 'e'.repeat(64) },
            mimeType: 'image/png',
            encodedBytes: 8,
            originalFilename: 'good.png',
            dependencyIds: [],
            provenance: '',
          },
          bytesBase64: btoa('fresh-content'),
        },
        'new-bad-asset': {
          manifest: {
            manifestVersion: 1,
            ref: { id: 'new-bad-asset', kind: 'image', hash: 'f'.repeat(64) },
            mimeType: '',
            encodedBytes: 0,
            originalFilename: 'bad.png',
            dependencyIds: [],
            provenance: '',
          },
          bytesBase64: btoa('x'),
        },
      },
    };

    const result = await importBundle(bundle, store);
    expect(result.ok).toBe(false);

    // The pre-existing asset survives; the newly ingested good asset was rolled back.
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.originalFilename).toBe('img.png');
    expect(await store.resolve(existing.ref.id)).toBeDefined();
  });
});

describe('export excludes credentials', () => {
  it('serializes no credential or signed-url fields', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(imageInput('clean'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;
    const manifest = await store.getManifest(ingest.ref.id);
    if (!manifest) throw new Error('manifest missing');

    const envelope = createEnvelope(cloneGraphDocument(DEFAULT_GRAPH), {
      assetManifests: { [ingest.ref.id]: manifest },
    });
    const bundleJson = await exportBundle(envelope, store);
    expect(bundleJson).not.toMatch(/credential|signedUrl|authorization|token/i);
  });
});
