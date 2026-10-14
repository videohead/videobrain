/**
 * D1 — Validate and cache static GLB scenes.
 *
 * `preflightGlb` validates a GLB container and its glTF 2.0 JSON without a GPU:
 * container/chunk integrity, accessor/bufferView bounds, triangle budget, the
 * static-only subset (no skins/animation), a required-extension allowlist, and a
 * ban on implicit external resource fetches. Decoded-count checks that require a
 * GPU upload happen in the decoder, after preflight.
 *
 * `SceneAssetCache` resolves asset bytes through an injectable resolver, decodes
 * validated bytes through an injectable decoder (default: pinned Three.js
 * GLTFLoader), and reference-counts decoded scenes by content hash. A per-slot
 * loader preserves the last good scene on failure and discards stale loads.
 *
 * This module adds no operator, no registry entry, and no global renderer change.
 */
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  MAX_GLB_TRIANGLES,
  MAX_ASSET_ENCODED_BYTES,
  type AssetRef,
} from '../store/contracts';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** Required glTF extensions this static-scene subset can honor. */
export const SUPPORTED_REQUIRED_EXTENSIONS: readonly string[] = [
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_materials_emissive_strength',
];

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};
const TYPE_COUNTS: Record<string, number> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfBuffer {
  byteLength: number;
  uri?: string;
}
interface GltfImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}
interface GltfMesh {
  primitives: GltfPrimitive[];
}
interface GltfJson {
  asset?: { version?: string };
  extensionsRequired?: string[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
  images?: GltfImage[];
  meshes?: GltfMesh[];
  materials?: unknown[];
  nodes?: unknown[];
  textures?: unknown[];
  skins?: unknown[];
  animations?: unknown[];
}

export interface GlbValidation {
  json: GltfJson;
  bin: Uint8Array | null;
  triangles: number;
  meshCount: number;
  materialCount: number;
  nodeCount: number;
  textureCount: number;
}

export type GlbPreflightResult =
  | { ok: true; validation: GlbValidation }
  | { ok: false; error: string };

function isDataUri(uri: string): boolean {
  return uri.startsWith('data:');
}

function trianglesForPrimitive(primitive: GltfPrimitive, accessors: GltfAccessor[]): number {
  const mode = primitive.mode ?? 4;
  const countSource = primitive.indices !== undefined
    ? accessors[primitive.indices]
    : accessors[primitive.attributes.POSITION ?? -1];
  if (!countSource) {
    return 0;
  }
  const count = countSource.count;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

/** Validate a GLB container and its glTF JSON. No GPU, no network. */
export function preflightGlb(bytes: Uint8Array): GlbPreflightResult {
  if (bytes.byteLength > MAX_ASSET_ENCODED_BYTES) {
    return { ok: false, error: 'GLB exceeds the encoded byte limit.' };
  }
  if (bytes.byteLength < 12) {
    return { ok: false, error: 'GLB is too small to contain a header.' };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return { ok: false, error: 'Not a GLB file (bad magic).' };
  }
  if (view.getUint32(4, true) !== 2) {
    return { ok: false, error: 'Unsupported GLB version.' };
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== bytes.byteLength) {
    return { ok: false, error: 'GLB length does not match the file.' };
  }

  // Parse chunks.
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.byteLength) {
      return { ok: false, error: 'GLB chunk length overruns the file.' };
    }
    if (chunkType === CHUNK_JSON && json === null) {
      try {
        json = JSON.parse(new TextDecoder().decode(bytes.subarray(dataStart, dataEnd))) as GltfJson;
      } catch {
        return { ok: false, error: 'GLB JSON chunk is not valid JSON.' };
      }
    } else if (chunkType === CHUNK_BIN && bin === null) {
      bin = bytes.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }

  if (!json) {
    return { ok: false, error: 'GLB has no JSON chunk.' };
  }
  if (json.asset?.version !== '2.0') {
    return { ok: false, error: 'glTF asset version must be 2.0.' };
  }

  // Static subset: reject skins and animation rather than silently freezing.
  if ((json.skins?.length ?? 0) > 0) {
    return { ok: false, error: 'Skinned meshes are outside the static subset.' };
  }
  if ((json.animations?.length ?? 0) > 0) {
    return { ok: false, error: 'Animation is outside the static subset.' };
  }

  // Required-extension allowlist.
  for (const ext of json.extensionsRequired ?? []) {
    if (!SUPPORTED_REQUIRED_EXTENSIONS.includes(ext)) {
      return { ok: false, error: `Unsupported required extension: ${ext}.` };
    }
  }

  // Deny implicit external resource fetches.
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri !== undefined && !isDataUri(buffer.uri)) {
      return { ok: false, error: 'External buffer URIs are not permitted.' };
    }
  }
  for (const image of json.images ?? []) {
    if (image.uri !== undefined && !isDataUri(image.uri)) {
      return { ok: false, error: 'External image URIs are not permitted.' };
    }
  }

  // Accessor/bufferView bounds against the actual BIN chunk.
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const buffers = json.buffers ?? [];
  const binLength = bin?.byteLength ?? 0;

  for (const bufferView of bufferViews) {
    const buffer = buffers[bufferView.buffer];
    if (!buffer) {
      return { ok: false, error: 'bufferView references a missing buffer.' };
    }
    const end = (bufferView.byteOffset ?? 0) + bufferView.byteLength;
    // Buffer 0 with no uri is the BIN chunk.
    const capacity = buffer.uri === undefined ? Math.max(buffer.byteLength, binLength) : buffer.byteLength;
    if (end > capacity) {
      return { ok: false, error: 'bufferView overruns its buffer.' };
    }
  }

  for (const accessor of accessors) {
    if (accessor.bufferView === undefined) {
      continue;
    }
    const bufferView = bufferViews[accessor.bufferView];
    if (!bufferView) {
      return { ok: false, error: 'accessor references a missing bufferView.' };
    }
    const componentSize = COMPONENT_BYTES[accessor.componentType];
    const typeCount = TYPE_COUNTS[accessor.type];
    if (!componentSize || !typeCount) {
      return { ok: false, error: 'accessor has an unsupported component or type.' };
    }
    const elementSize = componentSize * typeCount;
    const stride = bufferView.byteStride ?? elementSize;
    const span = stride * (accessor.count - 1) + elementSize;
    const end = (accessor.byteOffset ?? 0) + span;
    if (end > bufferView.byteLength) {
      return { ok: false, error: 'accessor overruns its bufferView.' };
    }
  }

  // Triangle budget.
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      triangles += trianglesForPrimitive(primitive, accessors);
    }
  }
  if (triangles > MAX_GLB_TRIANGLES) {
    return { ok: false, error: `Scene exceeds the ${MAX_GLB_TRIANGLES}-triangle budget.` };
  }

  return {
    ok: true,
    validation: {
      json,
      bin,
      triangles,
      meshCount: json.meshes?.length ?? 0,
      materialCount: json.materials?.length ?? 0,
      nodeCount: json.nodes?.length ?? 0,
      textureCount: json.textures?.length ?? 0,
    },
  };
}

export type SceneAssetResolver = (ref: AssetRef) => Promise<Uint8Array | undefined>;
export type SceneDecoder = (bytes: Uint8Array, validation: GlbValidation) => Promise<THREE.Object3D>;

export type SceneLoadResult =
  | { ok: true; scene: THREE.Object3D; validation: GlbValidation; stale: false }
  | { ok: true; stale: true }
  | { ok: false; error: string };

interface CacheEntry {
  scene: THREE.Object3D;
  validation: GlbValidation;
  refCount: number;
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material;
    if (material) {
      const materials = Array.isArray(material) ? material : [material];
      for (const entry of materials) {
        const withMap = entry as THREE.MeshStandardMaterial;
        withMap.map?.dispose();
        entry.dispose();
      }
    }
  });
}

/** Decode validated GLB bytes into a Three.js scene via the pinned GLTFLoader. */
export function decodeGlbScene(bytes: Uint8Array): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Promise((resolve, reject) => {
    loader.parse(
      copy.buffer,
      '', // Empty resource path: deny implicit external fetches.
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error('GLTF parse failed.')),
    );
  });
}

/** Default decoder: pinned Three.js GLTFLoader parsing the BIN-embedded GLB. */
function defaultDecoder(bytes: Uint8Array): Promise<THREE.Object3D> {
  return decodeGlbScene(bytes);
}

export class SceneAssetCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly slots = new Map<string, { hash: string | null; sequence: number }>();
  private readonly decoder: SceneDecoder;

  constructor(
    private readonly resolver: SceneAssetResolver,
    decoder: SceneDecoder = defaultDecoder,
  ) {
    this.decoder = decoder;
  }

  /** Load a scene into a named slot; preserves the last good scene on failure. */
  async loadInto(slotId: string, ref: AssetRef): Promise<SceneLoadResult> {
    const slot = this.slots.get(slotId) ?? { hash: null, sequence: 0 };
    const sequence = slot.sequence + 1;
    slot.sequence = sequence;
    this.slots.set(slotId, slot);

    const bytes = await this.resolver(ref);
    if (sequence !== slot.sequence) {
      return { ok: true, stale: true };
    }
    if (!bytes) {
      return { ok: false, error: 'Asset bytes are unavailable.' };
    }

    const preflight = preflightGlb(bytes);
    if (!preflight.ok) {
      return { ok: false, error: preflight.error };
    }

    // Reuse a cached decode when the same content is already resident.
    const cached = this.entries.get(ref.hash);
    if (cached) {
      if (sequence !== slot.sequence) {
        return { ok: true, stale: true };
      }
      this.bindSlot(slotId, slot, ref.hash);
      cached.refCount += 1;
      return { ok: true, scene: cached.scene, validation: cached.validation, stale: false };
    }

    let scene: THREE.Object3D;
    try {
      scene = await this.decoder(bytes, preflight.validation);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Decode failed.' };
    }

    if (sequence !== slot.sequence) {
      // A newer load superseded this one; discard the decoded result.
      disposeObject3D(scene);
      return { ok: true, stale: true };
    }

    this.entries.set(ref.hash, { scene, validation: preflight.validation, refCount: 1 });
    this.bindSlot(slotId, slot, ref.hash);
    return { ok: true, scene, validation: preflight.validation, stale: false };
  }

  private bindSlot(slotId: string, slot: { hash: string | null; sequence: number }, hash: string): void {
    const previous = slot.hash;
    slot.hash = hash;
    this.slots.set(slotId, slot);
    if (previous && previous !== hash) {
      this.releaseHash(previous);
    }
  }

  private releaseHash(hash: string): void {
    const entry = this.entries.get(hash);
    if (!entry) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      disposeObject3D(entry.scene);
      this.entries.delete(hash);
    }
  }

  /** Release a slot's hold on its current scene. */
  releaseSlot(slotId: string): void {
    const slot = this.slots.get(slotId);
    if (slot?.hash) {
      this.releaseHash(slot.hash);
    }
    this.slots.delete(slotId);
  }

  residentCount(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      disposeObject3D(entry.scene);
    }
    this.entries.clear();
    this.slots.clear();
  }
}
