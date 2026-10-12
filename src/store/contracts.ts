import type { GraphDocument } from '../graph';

/**
 * VideoBrain P0 Shared Contracts
 *
 * Version: contract-draft-1 (2026-10-11)
 * Status:  C2/C3 running — types proposed, awaiting integration lease
 *          for graph/registry/compiler changes.
 *
 * These types define the cross-track contracts agreed in C2 and measured
 * in C3.  They do NOT alter existing graph schema or persistence without
 * a coordinator-approved shared-file lease.
 *
 * ── Design rules ────────────────────────────────────────────────
 * • No native handles, object URLs, credentials, or signed URLs.
 * • Asset identity is immutable content identity; placement identity is
 *   separate and editable.
 * • GraphDocument remains schema-1; the envelope wraps it.
 * • Budgets are additive caps, not changes to existing graph/frame limits.
 * • Numeric ceilings below mirror C3 fixture measurements.
 */

// ═══════════════════════════════════════════════════════════════
// Asset identity and persistence
// ═══════════════════════════════════════════════════════════════

export type AssetKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'gltf'
  | 'glb'
  | 'texture'
  | 'mask'
  | 'brush';

/**
 * Immutable content identity.
 * The `id` is a stable UUID allocated at ingest time.
 * The `hash` is a content-addressed digest (SHA-256 hex).
 */
export interface AssetRef {
  id: string;
  kind: AssetKind;
  hash: string;
}

/**
 * Manifest stores durable metadata for one asset.
 * Versioned independently from graph schema.
 */
export interface AssetManifest {
  manifestVersion: 1;
  ref: AssetRef;
  mimeType: string;
  encodedBytes: number;          // raw encoded size
  validatedWidth?: number;       // px, for raster images/video
  validatedHeight?: number;      // px
  validatedDuration?: number;    // seconds, for audio/video
  originalFilename: string;
  /** AssetRef.id values of local dependencies (e.g. glTF buffers). */
  dependencyIds: readonly string[];
  /** Bounded provenance: source adapter, model, prompt excerpt, timestamp. */
  provenance: string;
}

// ═══════════════════════════════════════════════════════════════
// Scene asset contract
// ═══════════════════════════════════════════════════════════════

/** Ordered placement transform for one asset instance in a scene. */
export interface ScenePlacementTransform {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number]; // Euler, degrees
  scale: readonly [number, number, number];
}

/** Descriptor for an imported scene asset and its placements. */
export interface SceneAssetDescriptor {
  ref: AssetRef;
  placements: readonly ScenePlacementTransform[];
}

/**
 * Typed scene value for graph propagation.
 * Separate from primitive `Geometry3DValue`; additive to the type system.
 */
export interface AssetSceneValue {
  kind: 'asset-scene';
  descriptor: SceneAssetDescriptor;
}

// ═══════════════════════════════════════════════════════════════
// Generation jobs
// ═══════════════════════════════════════════════════════════════

export type GenerationJobState =
  | 'idle'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'fetching'
  | 'ready'
  | 'failed'
  | 'cancel-requested'
  | 'cancelled'
  | 'unknown';

/** Immutable generation request, never mutated after creation. */
export interface GenerationRequest {
  id: string;
  prompt: string;
  sourceImageRef?: AssetRef;
  sourceMaskRef?: AssetRef;
  sourceVideoRef?: AssetRef;
  model: string;
  adapter: string;               // e.g. 'comfyui', 'atlas', 'comet'
  settings: Readonly<Record<string, unknown>>;
  outputKind: 'image' | 'video' | 'clip';
}

/** Mutable job tracking one request from submission to result or failure. */
export interface GenerationJob {
  request: GenerationRequest;
  state: GenerationJobState;
  resultRef: AssetRef | null;
  error: string | null;
  submittedAt: number;           // ms timestamp
  resolvedAt: number | null;
  providerJobId: string | null;
}

// ═══════════════════════════════════════════════════════════════
// Mapping surfaces and outputs
// ═══════════════════════════════════════════════════════════════

export type SurfaceBlendMode = 'normal' | 'add' | 'multiply' | 'screen';

export interface SurfaceMaskPoint {
  x: number;
  y: number;
}

/**
 * One authored cubic node. Handles are offsets from `point`, expressed in
 * the same surface-local coordinates. Two zero handles make a corner.
 */
export interface SurfaceMaskNode {
  point: SurfaceMaskPoint;
  handleIn: SurfaceMaskPoint;
  handleOut: SurfaceMaskPoint;
}

/** Bounded mask path in surface-local coordinates. */
export interface SurfaceMaskPath {
  points: readonly SurfaceMaskPoint[];
  closed: boolean;
  feather: number;
  /**
   * Authored cubic nodes, when the path came from the mapping editor.
   * `points` is always their bounded tessellation, so renderers and
   * persistence can ignore this field entirely.
   */
  nodes?: readonly SurfaceMaskNode[];
}

/**
 * Bounded warp mesh for a surface.
 * Displacements are normalized UV offsets (0..1 domain).
 */
export interface SurfaceMeshWarp {
  rows: number;
  cols: number;
  displacements: readonly SurfaceMaskPoint[];
}

/** One surface layer in an output layout. */
export interface SurfaceLayout {
  id: string;
  /** Frame-source node in the graph. */
  sourceNodeId: string;
  /** Source UV region in the frame (bottom-left origin). */
  sourceUvRegion: {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
  };
  warp: SurfaceMeshWarp | null;
  maskPaths: readonly SurfaceMaskPath[];
  outputId: string;
  layerIndex: number;
  visible: boolean;
  blend: SurfaceBlendMode;
  opacity: number;
}

/** One logical output (screen / projector). */
export interface OutputLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Screen-relative placement (px). */
  layoutX: number;
  layoutY: number;
  surfaces: readonly SurfaceLayout[];
}

// ═══════════════════════════════════════════════════════════════
// Project envelope
// ═══════════════════════════════════════════════════════════════

export const ENVELOPE_SCHEMA_VERSION = 1 as const;

/**
 * Wraps one GraphDocument with asset manifests, output layouts,
 * and historical generation jobs.
 *
 * GraphDocument remains schema-1; old graph-only imports are retained
 * by treating `assetManifests`, `outputLayouts`, and `generationJobs`
 * as optional when absent.
 */
export interface ProjectEnvelope {
  envelopeVersion: typeof ENVELOPE_SCHEMA_VERSION;
  graphDocument: GraphDocument;
  assetManifests: Record<string, AssetManifest>;
  outputLayouts: readonly OutputLayout[];
  generationJobs: readonly GenerationJob[];
}

// ═══════════════════════════════════════════════════════════════
// Budgets and ceilings (C3 measurements)
// ═══════════════════════════════════════════════════════════════

/** Encoded asset size cap. 50 MB selected from fixture measurement ceiling. */
export const MAX_ASSET_ENCODED_BYTES = 50 * 1024 * 1024;

/** Maximum durable assets per project. */
export const MAX_PROJECT_ASSET_COUNT = 256;

/** Concurrent generation jobs. */
export const MAX_GENERATION_QUEUE_DEPTH = 4;

/** Maximum completed output size per job. */
export const MAX_GENERATION_OUTPUT_BYTES = 20 * 1024 * 1024;

/** Per-mask path point limit, counting tessellated points. */
export const MAX_SURFACE_MASK_POINTS = 256;

/** Authored cubic nodes per mask path, before tessellation. */
export const MAX_SURFACE_MASK_NODES = 64;

/** Warp mesh grid cell limit. */
export const MAX_SURFACE_MESH_CELLS = 32 * 32;

/** Logical outputs per project. */
export const MAX_OUTPUT_LAYOUTS = 8;

/** Surface layers per output. */
export const MAX_SURFACE_LAYERS_PER_OUTPUT = 16;

/** Maximum scene placements per imported asset. */
export const MAX_SCENE_PLACEMENTS = 64;

/** Maximum triangle count for accepted GLB subset. */
export const MAX_GLB_TRIANGLES = 65_536;

/** Maximum texture dimension for accepted GLB subset. */
export const MAX_GLB_TEXTURE_DIMENSION = 2048;
