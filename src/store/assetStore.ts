/**
 * A1 — Bounded durable asset storage.
 *
 * Implements the AssetStore contract from contracts.ts:
 *   ingest, resolve, metadata lookup, explicit relink/remove, retain/release.
 *
 * Storage is pluggable. IndexedDB holds original blobs and manifests in the
 * browser; an in-memory backend is injectable for tests (not a silent
 * persistence fallback — callers choose the backend explicitly).
 *
 * Content identity is SHA-256 over the raw bytes. Ingest stages validation and
 * storage before publishing a ref. Deduplication reuses an existing record only
 * when the content hash AND asset kind match. Failed ingest leaves prior state
 * unchanged. Runtime handle release frees decoded resources, never durable bytes.
 */
import {
  MAX_ASSET_ENCODED_BYTES,
  MAX_PROJECT_ASSET_COUNT,
  type AssetKind,
  type AssetManifest,
  type AssetRef,
} from './contracts';

/** One durable record: manifest + original bytes. */
export interface AssetRecord {
  manifest: AssetManifest;
  bytes: Uint8Array;
}

/** Pluggable durable backend. Implementations must be reference-aware. */
export interface AssetStoreBackend {
  get(id: string): Promise<AssetRecord | undefined>;
  getByHash(hash: string): Promise<AssetRecord | undefined>;
  put(record: AssetRecord): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<readonly AssetManifest[]>;
  count(): Promise<number>;
}

export interface AssetIngestInput {
  kind: AssetKind;
  bytes: Uint8Array;
  mimeType: string;
  originalFilename: string;
  validatedWidth?: number;
  validatedHeight?: number;
  validatedDuration?: number;
  dependencyIds?: readonly string[];
  provenance?: string;
}

export type AssetIngestResult =
  | { ok: true; ref: AssetRef; deduplicated: boolean }
  | { ok: false; error: string };

export type AssetRelinkResult =
  | { ok: true; ref: AssetRef }
  | { ok: false; error: string };

/** Hash raw bytes to a 64-char lowercase SHA-256 hex digest. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `asset-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(16)}`;
}

/** In-memory backend for tests and ephemeral use. Explicit, never a fallback. */
export function createMemoryBackend(): AssetStoreBackend {
  const byId = new Map<string, AssetRecord>();
  const idByHash = new Map<string, string>();
  return {
    get(id) {
      return Promise.resolve(byId.get(id));
    },
    getByHash(hash) {
      const id = idByHash.get(hash);
      return Promise.resolve(id === undefined ? undefined : byId.get(id));
    },
    put(record) {
      byId.set(record.manifest.ref.id, record);
      idByHash.set(record.manifest.ref.hash, record.manifest.ref.id);
      return Promise.resolve();
    },
    delete(id) {
      const record = byId.get(id);
      if (record) {
        idByHash.delete(record.manifest.ref.hash);
        byId.delete(id);
      }
      return Promise.resolve();
    },
    list() {
      return Promise.resolve(Array.from(byId.values()).map((r) => r.manifest));
    },
    count() {
      return Promise.resolve(byId.size);
    },
  };
}

const DB_NAME = 'videobrain-assets';
const DB_VERSION = 1;
const STORE = 'assets';
const HASH_INDEX = 'by-hash';

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** IndexedDB-backed durable store. Requires a browser or a provided factory. */
export function createIndexedDbBackend(
  indexedDB: IDBFactory = globalThis.indexedDB,
): AssetStoreBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'manifest.ref.id' });
          store.createIndex(HASH_INDEX, 'manifest.ref.hash', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    return dbPromise;
  }

  async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await openDb();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  return {
    async get(id) {
      const store = await tx('readonly');
      return (await promisifyRequest(store.get(id))) as AssetRecord | undefined;
    },
    async getByHash(hash) {
      const store = await tx('readonly');
      const index = store.index(HASH_INDEX);
      return (await promisifyRequest(index.get(hash))) as AssetRecord | undefined;
    },
    async put(record) {
      const store = await tx('readwrite');
      await promisifyRequest(store.put(record));
    },
    async delete(id) {
      const store = await tx('readwrite');
      await promisifyRequest(store.delete(id));
    },
    async list() {
      const store = await tx('readonly');
      const records = (await promisifyRequest(store.getAll())) as AssetRecord[];
      return records.map((r) => r.manifest);
    },
    async count() {
      const store = await tx('readonly');
      return promisifyRequest(store.count());
    },
  };
}

export interface AssetStore {
  ingest(input: AssetIngestInput): Promise<AssetIngestResult>;
  resolve(id: string): Promise<AssetRecord | undefined>;
  getManifest(id: string): Promise<AssetManifest | undefined>;
  list(): Promise<readonly AssetManifest[]>;
  remove(id: string): Promise<void>;
  relink(id: string, input: AssetIngestInput): Promise<AssetRelinkResult>;
  retain(id: string): Promise<AssetRecord | undefined>;
  release(id: string): void;
}

/** Create an AssetStore over a durable backend. */
export function createAssetStore(backend: AssetStoreBackend): AssetStore {
  const retained = new Map<string, number>();

  function validate(input: AssetIngestInput): string | null {
    if (input.bytes.byteLength === 0) {
      return 'Asset has no bytes.';
    }
    if (input.bytes.byteLength > MAX_ASSET_ENCODED_BYTES) {
      return `Asset exceeds ${MAX_ASSET_ENCODED_BYTES} byte limit.`;
    }
    if (!input.mimeType) {
      return 'Asset is missing a MIME type.';
    }
    return null;
  }

  function buildManifest(input: AssetIngestInput, hash: string): AssetManifest {
    return {
      manifestVersion: 1,
      ref: { id: makeId(), kind: input.kind, hash },
      mimeType: input.mimeType,
      encodedBytes: input.bytes.byteLength,
      validatedWidth: input.validatedWidth,
      validatedHeight: input.validatedHeight,
      validatedDuration: input.validatedDuration,
      originalFilename: input.originalFilename,
      dependencyIds: input.dependencyIds ?? [],
      provenance: input.provenance ?? '',
    };
  }

  return {
    async ingest(input) {
      const invalid = validate(input);
      if (invalid) {
        return { ok: false, error: invalid };
      }
      const hash = await hashBytes(input.bytes);

      const existing = await backend.getByHash(hash);
      if (existing) {
        if (existing.manifest.ref.kind === input.kind) {
          return { ok: true, ref: existing.manifest.ref, deduplicated: true };
        }
        return { ok: false, error: 'Content hash matches an asset of a different kind.' };
      }

      if ((await backend.count()) >= MAX_PROJECT_ASSET_COUNT) {
        return { ok: false, error: `Project already holds ${MAX_PROJECT_ASSET_COUNT} assets.` };
      }

      const manifest = buildManifest(input, hash);
      try {
        await backend.put({ manifest, bytes: input.bytes });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Storage failed.' };
      }
      return { ok: true, ref: manifest.ref, deduplicated: false };
    },

    async resolve(id) {
      return backend.get(id);
    },

    async getManifest(id) {
      return (await backend.get(id))?.manifest;
    },

    async list() {
      return backend.list();
    },

    async remove(id) {
      await backend.delete(id);
      retained.delete(id);
    },

    async relink(id, input) {
      const current = await backend.get(id);
      if (!current) {
        return { ok: false, error: 'No asset to relink.' };
      }
      const invalid = validate(input);
      if (invalid) {
        return { ok: false, error: invalid };
      }
      const hash = await hashBytes(input.bytes);
      if (hash !== current.manifest.ref.hash) {
        return { ok: false, error: 'Relink bytes do not match the original content hash.' };
      }
      const manifest: AssetManifest = {
        ...current.manifest,
        mimeType: input.mimeType,
        originalFilename: input.originalFilename,
        dependencyIds: input.dependencyIds ?? current.manifest.dependencyIds,
      };
      await backend.put({ manifest, bytes: input.bytes });
      return { ok: true, ref: manifest.ref };
    },

    async retain(id) {
      const record = await backend.get(id);
      if (!record) {
        return undefined;
      }
      retained.set(id, (retained.get(id) ?? 0) + 1);
      return record;
    },

    release(id) {
      const count = retained.get(id);
      if (count === undefined) {
        return;
      }
      if (count <= 1) {
        retained.delete(id);
      } else {
        retained.set(id, count - 1);
      }
    },
  };
}
