import { describe, expect, it } from 'vitest';
import type { GraphDocument } from '../graph';
import type {
  AssetKind,
  AssetManifest,
  AssetRef,
  SceneAssetDescriptor,
  ScenePlacementTransform,
  GenerationJob,
  GenerationJobState,
  GenerationRequest,
  SurfaceLayout,
  OutputLayout,
  ProjectEnvelope,
} from './contracts';
import {
  ENVELOPE_SCHEMA_VERSION,
  MAX_ASSET_ENCODED_BYTES,
  MAX_GENERATION_OUTPUT_BYTES,
  MAX_GENERATION_QUEUE_DEPTH,
  MAX_GLB_TEXTURE_DIMENSION,
  MAX_GLB_TRIANGLES,
  MAX_OUTPUT_LAYOUTS,
  MAX_PROJECT_ASSET_COUNT,
  MAX_SCENE_PLACEMENTS,
  MAX_SURFACE_MASK_POINTS,
  MAX_SURFACE_MESH_CELLS,
} from './contracts';

function makeAssetRef(kind: AssetKind): AssetRef {
  return { id: 'test-asset-001', kind, hash: 'a'.repeat(64) };
}

function makeManifest(): AssetManifest {
  return {
    manifestVersion: 1,
    ref: makeAssetRef('image'),
    mimeType: 'image/png',
    encodedBytes: 1234,
    validatedWidth: 1920,
    validatedHeight: 1080,
    originalFilename: 'test.png',
    dependencyIds: [] as const,
    provenance: 'generated-by-test',
  };
}

describe('AssetRef contract', () => {
  it('accepts all eight AssetKind values', () => {
    const kinds: AssetKind[] = ['image', 'video', 'audio', 'gltf', 'glb', 'texture', 'mask', 'brush'];
    for (const kind of kinds) {
      const ref: AssetRef = makeAssetRef(kind);
      expect(ref.kind).toBe(kind);
      expect(ref.id).toHaveLength(14);
      expect(ref.hash).toHaveLength(64);
    }
  });

  it('requires a 64-char SHA-256 hash', () => {
    const ref: AssetRef = { id: 'x', kind: 'image', hash: 'a'.repeat(64) };
    expect(ref.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('AssetManifest contract', () => {
  it('is versioned at manifestVersion 1', () => {
    const m = makeManifest();
    expect(m.manifestVersion).toBe(1);
  });

  it('does not store native handles or credentials', () => {
    const m = makeManifest();
    expect(m).not.toHaveProperty('objectUrl');
    expect(m).not.toHaveProperty('credential');
    expect(m).not.toHaveProperty('signedUrl');
    expect(m).not.toHaveProperty('expiresAt');
  });

  it('records optional width/height/duration', () => {
    const m = makeManifest();
    expect(m.validatedWidth).toBe(1920);
    expect(m.validatedHeight).toBe(1080);
    expect(m.validatedDuration).toBeUndefined();
  });
});

describe('Scene asset contract', () => {
  it('accepts a static GLB placement', () => {
    const transform: ScenePlacementTransform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const descriptor: SceneAssetDescriptor = {
      ref: makeAssetRef('glb'),
      placements: [transform],
    };
    expect(descriptor.ref.kind).toBe('glb');
    expect(descriptor.placements).toHaveLength(1);
  });

  it('allows up to MAX_SCENE_PLACEMENTS per asset', () => {
    expect(MAX_SCENE_PLACEMENTS).toBe(64);
  });
});

describe('GenerationJob contract', () => {
  it('has ten ordered states', () => {
    const states: GenerationJobState[] = [
      'idle',
      'submitting',
      'queued',
      'running',
      'fetching',
      'ready',
      'failed',
      'cancel-requested',
      'cancelled',
      'unknown',
    ];
    expect(new Set(states).size).toBe(10);
  });

  it('can track a request from idle to ready', () => {
    const request: GenerationRequest = {
      id: 'req-001',
      prompt: 'a red cube',
      model: 'sdxl-base',
      adapter: 'comfyui',
      settings: { steps: 20 },
      outputKind: 'image',
    };
    const job: GenerationJob = {
      request,
      state: 'idle',
      resultRef: null,
      error: null,
      submittedAt: 0,
      resolvedAt: null,
      providerJobId: null,
    };
    expect(job.state).toBe('idle');
    expect(job.resultRef).toBeNull();
    expect(job.request.id).toBe('req-001');
  });
});

describe('SurfaceLayout contract', () => {
  it('defines a bounded mesh warp grid or leaves it null', () => {
    const surface: SurfaceLayout = {
      id: 'surf-001',
      sourceNodeId: 'node-42',
      sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
      warp: null,
      maskPaths: [],
      outputId: 'out-1',
      layerIndex: 0,
      visible: true,
      blend: 'normal',
      opacity: 1,
    };
    expect(surface.warp).toBeNull();
    expect(surface.blend).toBe('normal');
  });

  it('enforces mask point and mesh cell ceilings', () => {
    expect(MAX_SURFACE_MASK_POINTS).toBe(256);
    expect(MAX_SURFACE_MESH_CELLS).toBe(32 * 32);
  });
});

describe('OutputLayout contract', () => {
  it('captures a single display at 1920x1080', () => {
    const out: OutputLayout = {
      id: 'out-1',
      name: 'Main Display',
      width: 1920,
      height: 1080,
      layoutX: 0,
      layoutY: 0,
      surfaces: [],
    };
    expect(out.surfaces).toHaveLength(0);
    expect(out.width * out.height).toBe(2_073_600);
  });

  it('allows up to MAX_OUTPUT_LAYOUTS', () => {
    expect(MAX_OUTPUT_LAYOUTS).toBe(8);
  });
});

describe('ProjectEnvelope contract', () => {
  it('is versioned independently from graph schema', () => {
    expect(ENVELOPE_SCHEMA_VERSION).toBe(1);
  });

  it('wraps a minimal GraphDocument without schema changes', () => {
    const envelope: ProjectEnvelope = {
      envelopeVersion: ENVELOPE_SCHEMA_VERSION,
      graphDocument: {
        schemaVersion: 1,
        nodes: [],
        edges: [],
      } as unknown as GraphDocument,
      assetManifests: {},
      outputLayouts: [],
      generationJobs: [],
    };
    expect(envelope.graphDocument.schemaVersion).toBe(1);
    expect(envelope.assetManifests).toEqual({});
    expect(envelope.outputLayouts).toHaveLength(0);
  });
});

describe('Budget ceilings', () => {
  it('caps asset size at 50 MB', () => {
    expect(MAX_ASSET_ENCODED_BYTES).toBe(50 * 1024 * 1024);
  });

  it('caps project asset count at 256', () => {
    expect(MAX_PROJECT_ASSET_COUNT).toBe(256);
  });

  it('caps generation queue at 4', () => {
    expect(MAX_GENERATION_QUEUE_DEPTH).toBe(4);
  });

  it('caps generation output at 20 MB', () => {
    expect(MAX_GENERATION_OUTPUT_BYTES).toBe(20 * 1024 * 1024);
  });

  it('caps GLB geometry at 65536 triangles', () => {
    expect(MAX_GLB_TRIANGLES).toBe(65_536);
    expect(MAX_GLB_TEXTURE_DIMENSION).toBe(2048);
  });
});
