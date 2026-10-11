import { describe, expect, it } from 'vitest';

import {
  createAssetStore,
  createMemoryBackend,
  hashBytes,
  type AssetIngestInput,
  type AssetStoreBackend,
} from './assetStore';
import { MAX_ASSET_ENCODED_BYTES } from './contracts';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function imageInput(content = 'png-data'): AssetIngestInput {
  return {
    kind: 'image',
    bytes: bytes(content),
    mimeType: 'image/png',
    originalFilename: 'test.png',
    validatedWidth: 8,
    validatedHeight: 8,
  };
}

describe('hashBytes', () => {
  it('produces a stable 64-char SHA-256 hex digest', async () => {
    const a = await hashBytes(bytes('hello'));
    const b = await hashBytes(bytes('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs for different content', async () => {
    expect(await hashBytes(bytes('a'))).not.toBe(await hashBytes(bytes('b')));
  });
});

describe('AssetStore ingest and resolve', () => {
  it('ingests, resolves bytes, and looks up metadata', async () => {
    const store = createAssetStore(createMemoryBackend());
    const result = await store.ingest(imageInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const record = await store.resolve(result.ref.id);
    expect(record).toBeDefined();
    expect(record?.manifest.originalFilename).toBe('test.png');
    expect(record?.manifest.encodedBytes).toBe(bytes('png-data').byteLength);

    const manifest = await store.getManifest(result.ref.id);
    expect(manifest?.ref.hash).toBe(result.ref.hash);
  });

  it('survives reopen by sharing the same backend', async () => {
    const backend = createMemoryBackend();
    const first = createAssetStore(backend);
    const ingest = await first.ingest(imageInput('durable'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const reopened = createAssetStore(backend);
    const record = await reopened.resolve(ingest.ref.id);
    expect(record?.manifest.ref.id).toBe(ingest.ref.id);
  });
});

describe('AssetStore deduplication', () => {
  it('reuses an existing ref for identical content and kind', async () => {
    const store = createAssetStore(createMemoryBackend());
    const first = await store.ingest(imageInput('same'));
    const second = await store.ingest(imageInput('same'));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.deduplicated).toBe(true);
    expect(second.ref.id).toBe(first.ref.id);
  });

  it('rejects identical bytes claimed as a different kind', async () => {
    const store = createAssetStore(createMemoryBackend());
    await store.ingest(imageInput('shared-bytes'));
    const clash = await store.ingest({
      ...imageInput('shared-bytes'),
      kind: 'texture',
    });
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.error).toMatch(/different kind/);
  });
});

describe('AssetStore validation', () => {
  it('rejects empty bytes', async () => {
    const store = createAssetStore(createMemoryBackend());
    const result = await store.ingest({ ...imageInput(), bytes: new Uint8Array(0) });
    expect(result.ok).toBe(false);
  });

  it('rejects oversized assets', async () => {
    const store = createAssetStore(createMemoryBackend());
    const big = new Uint8Array(MAX_ASSET_ENCODED_BYTES + 1);
    const result = await store.ingest({ ...imageInput(), bytes: big });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/limit/);
  });

  it('rejects a missing MIME type', async () => {
    const store = createAssetStore(createMemoryBackend());
    const result = await store.ingest({ ...imageInput(), mimeType: '' });
    expect(result.ok).toBe(false);
  });
});

describe('AssetStore failure isolation', () => {
  it('leaves prior state unchanged when backend.put throws', async () => {
    const memory = createMemoryBackend();
    const failing: AssetStoreBackend = {
      ...memory,
      put: async (record) => {
        if (record.manifest.originalFilename === 'bad.png') {
          throw new Error('disk full');
        }
        return memory.put(record);
      },
    };
    const store = createAssetStore(failing);
    const good = await store.ingest(imageInput('good'));
    expect(good.ok).toBe(true);

    const bad = await store.ingest({ ...imageInput('bad'), originalFilename: 'bad.png' });
    expect(bad.ok).toBe(false);

    // The good asset is still resolvable; the failed ingest left no record.
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.originalFilename).toBe('test.png');
  });
});

describe('AssetStore retain and release', () => {
  it('tracks two consumers and does not delete durable bytes on release', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(imageInput('held'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const a = await store.retain(ingest.ref.id);
    const b = await store.retain(ingest.ref.id);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    store.release(ingest.ref.id);
    store.release(ingest.ref.id);

    // Durable bytes remain after all handles release.
    const record = await store.resolve(ingest.ref.id);
    expect(record).toBeDefined();
  });

  it('ignores release of an unknown id', () => {
    const store = createAssetStore(createMemoryBackend());
    expect(() => store.release('missing')).not.toThrow();
  });
});

describe('AssetStore relink', () => {
  it('relinks when bytes match the original hash', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(imageInput('relink-me'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const relink = await store.relink(ingest.ref.id, {
      ...imageInput('relink-me'),
      originalFilename: 'renamed.png',
    });
    expect(relink.ok).toBe(true);
    const manifest = await store.getManifest(ingest.ref.id);
    expect(manifest?.originalFilename).toBe('renamed.png');
  });

  it('rejects a relink whose bytes do not match the hash', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(imageInput('original'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const relink = await store.relink(ingest.ref.id, imageInput('different'));
    expect(relink.ok).toBe(false);
    if (relink.ok) return;
    expect(relink.error).toMatch(/do not match/);
  });

  it('rejects relink of an unknown id', async () => {
    const store = createAssetStore(createMemoryBackend());
    const relink = await store.relink('missing', imageInput());
    expect(relink.ok).toBe(false);
  });
});

describe('AssetStore remove', () => {
  it('removes durable bytes only on explicit remove', async () => {
    const store = createAssetStore(createMemoryBackend());
    const ingest = await store.ingest(imageInput('removable'));
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    await store.remove(ingest.ref.id);
    expect(await store.resolve(ingest.ref.id)).toBeUndefined();
    expect(await store.list()).toHaveLength(0);
  });
});
