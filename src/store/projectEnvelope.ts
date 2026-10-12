/**
 * A2 — Project resource envelope and portable bundle.
 *
 * Wraps the existing schema-1 GraphDocument with asset manifests, output layouts,
 * and generation-job records, then packages referenced asset bytes into a portable
 * bundle. This module is additive: it composes the production graph parser and the
 * A1 AssetStore without changing GraphDocument schema, persistence.ts, or
 * projectStore.ts.
 *
 * Backward compatibility: parseEnvelope accepts either a bare schema-1
 * GraphDocument (wrapping it) or a full envelope. Graph-only import is preserved.
 *
 * Security: no credentials or signed URLs are serialized; bundle import enforces
 * byte, asset-count, and asset-id path-traversal limits, and rolls back any
 * newly ingested assets when validation fails.
 */
import {
  compileGraph,
  parseGraphDocument,
  serializeGraphDocument,
  type GraphDocument,
} from '../graph';
import { parseOutputLayouts } from '../engine/surfaceLayout';
import {
  type AssetStore,
} from './assetStore';
import {
  ENVELOPE_SCHEMA_VERSION,
  MAX_ASSET_ENCODED_BYTES,
  MAX_PROJECT_ASSET_COUNT,
  type AssetKind,
  type AssetManifest,
  type GenerationJob,
  type OutputLayout,
  type ProjectEnvelope,
} from './contracts';

export const BUNDLE_SCHEMA_VERSION = 1 as const;

/** Total decoded bundle byte ceiling (asset bytes + envelope JSON). */
export const MAX_BUNDLE_BYTES = MAX_ASSET_ENCODED_BYTES * MAX_PROJECT_ASSET_COUNT;

const ASSET_KINDS: readonly AssetKind[] = [
  'image', 'video', 'audio', 'gltf', 'glb', 'texture', 'mask', 'brush',
];

export interface ProjectBundleAsset {
  manifest: AssetManifest;
  bytesBase64: string;
}

export interface ProjectBundle {
  bundleVersion: typeof BUNDLE_SCHEMA_VERSION;
  envelope: ProjectEnvelope;
  assets: Record<string, ProjectBundleAsset>;
}

export type EnvelopeParseResult =
  | { ok: true; envelope: ProjectEnvelope }
  | { ok: false; error: string };

export type BundleImportResult =
  | { ok: true; envelope: ProjectEnvelope; ingestedIds: readonly string[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Asset ids must be safe to use as storage keys: no path separators or traversal. */
function isSafeAssetId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 128 &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('..') &&
    !id.includes('\0')
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function validateManifest(value: unknown): value is AssetManifest {
  if (!isRecord(value) || value.manifestVersion !== 1 || !isRecord(value.ref)) {
    return false;
  }
  const ref = value.ref;
  return (
    typeof ref.id === 'string' &&
    isSafeAssetId(ref.id) &&
    typeof ref.hash === 'string' &&
    /^[a-f0-9]{64}$/.test(ref.hash) &&
    typeof ref.kind === 'string' &&
    ASSET_KINDS.includes(ref.kind as AssetKind) &&
    typeof value.mimeType === 'string' &&
    typeof value.encodedBytes === 'number'
  );
}

/** Build an envelope around a GraphDocument and optional resources. */
export function createEnvelope(
  graphDocument: GraphDocument,
  resources: {
    assetManifests?: Record<string, AssetManifest>;
    outputLayouts?: readonly OutputLayout[];
    generationJobs?: readonly GenerationJob[];
  } = {},
): ProjectEnvelope {
  return {
    envelopeVersion: ENVELOPE_SCHEMA_VERSION,
    graphDocument,
    assetManifests: resources.assetManifests ?? {},
    outputLayouts: resources.outputLayouts ?? [],
    generationJobs: resources.generationJobs ?? [],
  };
}

/** Serialize an envelope, validating that its graph compiles. */
export function serializeEnvelope(envelope: ProjectEnvelope): string {
  const compiled = compileGraph(parseGraphDocument(envelope.graphDocument)).document;
  const normalized: ProjectEnvelope = { ...envelope, graphDocument: compiled };
  return JSON.stringify(normalized);
}

/**
 * Parse a bare GraphDocument (schema-1) or a full envelope.
 * Returns a normalized envelope with a compiled graph.
 */
export function parseEnvelope(value: unknown): EnvelopeParseResult {
  try {
    if (isRecord(value) && 'envelopeVersion' in value) {
      if (value.envelopeVersion !== ENVELOPE_SCHEMA_VERSION) {
        return { ok: false, error: 'Unsupported envelope version.' };
      }
      const graphDocument = compileGraph(parseGraphDocument(value.graphDocument)).document;

      const manifests: Record<string, AssetManifest> = {};
      if (value.assetManifests !== undefined) {
        if (!isRecord(value.assetManifests)) {
          return { ok: false, error: 'assetManifests must be an object.' };
        }
        for (const [id, manifest] of Object.entries(value.assetManifests)) {
          if (!isSafeAssetId(id) || !validateManifest(manifest)) {
            return { ok: false, error: `Invalid asset manifest for id "${id}".` };
          }
          manifests[id] = manifest;
        }
      }

      // M3: saved mapping layouts are re-validated on reopen, so a corrupted
      // or hand-edited file cannot install folded geometry or an unbounded
      // output. Absent layouts stay an empty list, preserving older projects.
      let outputLayouts: readonly OutputLayout[] = [];
      if (value.outputLayouts !== undefined) {
        if (!Array.isArray(value.outputLayouts)) {
          return { ok: false, error: 'outputLayouts must be an array.' };
        }
        try {
          outputLayouts = parseOutputLayouts(JSON.stringify(value.outputLayouts));
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Invalid output layouts.',
          };
        }
      }
      const generationJobs = Array.isArray(value.generationJobs)
        ? (value.generationJobs as GenerationJob[])
        : [];

      return {
        ok: true,
        envelope: createEnvelope(graphDocument, {
          assetManifests: manifests,
          outputLayouts,
          generationJobs,
        }),
      };
    }

    // Bare graph-only import (legacy).
    const graphDocument = compileGraph(parseGraphDocument(value)).document;
    return { ok: true, envelope: createEnvelope(graphDocument) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid envelope.' };
  }
}

/** Export a portable bundle, embedding bytes for every referenced asset. */
export async function exportBundle(
  envelope: ProjectEnvelope,
  assetStore: AssetStore,
): Promise<string> {
  const compiled = compileGraph(parseGraphDocument(envelope.graphDocument)).document;
  const assets: Record<string, ProjectBundleAsset> = {};

  for (const [id, manifest] of Object.entries(envelope.assetManifests)) {
    const record = await assetStore.resolve(id);
    if (!record) {
      continue; // Missing assets remain relinkable; they are not embedded.
    }
    assets[id] = {
      manifest,
      bytesBase64: bytesToBase64(record.bytes),
    };
  }

  const bundle: ProjectBundle = {
    bundleVersion: BUNDLE_SCHEMA_VERSION,
    envelope: { ...envelope, graphDocument: compiled },
    assets,
  };
  return JSON.stringify(bundle);
}

/**
 * Import a portable bundle: validate structure and limits, ingest asset bytes
 * atomically, and roll back newly ingested assets on any failure.
 */
export async function importBundle(
  value: unknown,
  assetStore: AssetStore,
): Promise<BundleImportResult> {
  if (!isRecord(value) || value.bundleVersion !== BUNDLE_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported or malformed bundle.' };
  }
  if (!isRecord(value.assets)) {
    return { ok: false, error: 'Bundle assets must be an object.' };
  }

  const assetEntries = Object.entries(value.assets);
  if (assetEntries.length > MAX_PROJECT_ASSET_COUNT) {
    return { ok: false, error: `Bundle exceeds ${MAX_PROJECT_ASSET_COUNT} assets.` };
  }

  const parsed = parseEnvelope(value.envelope);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  // Validate every asset entry and decode bytes before any ingest.
  const decoded: Array<{ id: string; manifest: AssetManifest; bytes: Uint8Array }> = [];
  let totalBytes = 0;
  for (const [id, asset] of assetEntries) {
    if (!isSafeAssetId(id)) {
      return { ok: false, error: `Unsafe asset id "${id}".` };
    }
    if (!isRecord(asset) || !validateManifest(asset.manifest) || typeof asset.bytesBase64 !== 'string') {
      return { ok: false, error: `Malformed bundle asset "${id}".` };
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(asset.bytesBase64);
    } catch {
      return { ok: false, error: `Asset "${id}" has invalid base64.` };
    }
    if (bytes.byteLength > MAX_ASSET_ENCODED_BYTES) {
      return { ok: false, error: `Asset "${id}" exceeds the byte limit.` };
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_BUNDLE_BYTES) {
      return { ok: false, error: 'Bundle exceeds the total byte limit.' };
    }
    decoded.push({ id, manifest: asset.manifest, bytes });
  }

  // Ingest atomically; track newly created assets for rollback.
  const ingestedIds: string[] = [];
  const newlyCreated: string[] = [];
  try {
    for (const entry of decoded) {
      const result = await assetStore.ingest({
        kind: entry.manifest.ref.kind,
        bytes: entry.bytes,
        mimeType: entry.manifest.mimeType,
        originalFilename: entry.manifest.originalFilename,
        validatedWidth: entry.manifest.validatedWidth,
        validatedHeight: entry.manifest.validatedHeight,
        validatedDuration: entry.manifest.validatedDuration,
        dependencyIds: entry.manifest.dependencyIds,
        provenance: entry.manifest.provenance,
      });
      if (!result.ok) {
        throw new Error(`Asset "${entry.id}" ingest failed: ${result.error}`);
      }
      ingestedIds.push(result.ref.id);
      if (!result.deduplicated) {
        newlyCreated.push(result.ref.id);
      }
    }
  } catch (error) {
    for (const id of newlyCreated) {
      await assetStore.remove(id);
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Bundle ingest failed.' };
  }

  return { ok: true, envelope: parsed.envelope, ingestedIds };
}

/** Serialize just the graph for legacy graph-only export. */
export function serializeGraphOnly(envelope: ProjectEnvelope): string {
  return serializeGraphDocument(envelope.graphDocument);
}
