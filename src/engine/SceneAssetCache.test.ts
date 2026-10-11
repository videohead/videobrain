import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { AssetRef } from '../store/contracts';
import {
  SceneAssetCache,
  decodeGlbScene,
  preflightGlb,
  type GlbValidation,
} from './SceneAssetCache';

/** Pack a glTF JSON object and optional BIN buffer into a GLB. */
function packGlb(gltf: object, bin: Uint8Array = new Uint8Array(0)): Uint8Array {
  const jsonBuf = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunkLen = jsonBuf.length + jsonPad;
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunkLen = bin.length + binPad;
  const hasBin = bin.length > 0;
  const total = 12 + 8 + jsonChunkLen + (hasBin ? 8 + binChunkLen : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // magic
  view.setUint32(4, 2, true); // version
  view.setUint32(8, total, true);
  let p = 12;
  view.setUint32(p, jsonChunkLen, true); p += 4;
  view.setUint32(p, 0x4e4f534a, true); p += 4;
  out.set(jsonBuf, p); p += jsonBuf.length;
  for (let i = 0; i < jsonPad; i += 1) { out[p++] = 0x20; }
  if (hasBin) {
    view.setUint32(p, binChunkLen, true); p += 4;
    view.setUint32(p, 0x004e4942, true); p += 4;
    out.set(bin, p); p += bin.length;
    for (let i = 0; i < binPad; i += 1) { out[p++] = 0; }
  }
  return out;
}

const validBox = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 6 },
  ],
  buffers: [{ byteLength: 48 }],
};

describe('preflightGlb — valid input', () => {
  it('accepts a valid single-mesh box GLB', () => {
    const glb = packGlb(validBox, new Uint8Array(48));
    const result = preflightGlb(glb);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validation.meshCount).toBe(1);
    expect(result.validation.triangles).toBe(1);
    expect(result.validation.materialCount).toBe(1);
  });

  it('accepts a real generated fixture file', () => {
    const path = `${process.cwd()}/public/test-data/fixtures-3d/single-mesh.glb`;
    const bytes = new Uint8Array(readFileSync(path));
    const result = preflightGlb(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validation.meshCount).toBe(1);
    expect(result.validation.triangles).toBe(12);
  });
});

describe('decodeGlbScene — real GLTFLoader path', () => {
  it('decodes a generated fixture into a Three.js object with a mesh', async () => {
    const path = `${process.cwd()}/public/test-data/fixtures-3d/single-mesh.glb`;
    const bytes = new Uint8Array(readFileSync(path));
    const object = await decodeGlbScene(bytes);
    let meshes = 0;
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshes += 1;
      }
    });
    expect(meshes).toBe(1);
  });

  it('decodes the multi-mesh fixture into two placed nodes', async () => {
    const path = `${process.cwd()}/public/test-data/fixtures-3d/multi-mesh.glb`;
    const bytes = new Uint8Array(readFileSync(path));
    const object = await decodeGlbScene(bytes);
    let meshes = 0;
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshes += 1;
      }
    });
    expect(meshes).toBe(2);
  });
});

describe('preflightGlb — container errors', () => {
  it('rejects a too-small buffer', () => {
    expect(preflightGlb(new Uint8Array(4)).ok).toBe(false);
  });

  it('rejects a bad magic', () => {
    const glb = packGlb(validBox);
    glb[0] = 0;
    expect(preflightGlb(glb).ok).toBe(false);
  });

  it('rejects a length mismatch', () => {
    const glb = packGlb(validBox);
    const view = new DataView(glb.buffer);
    view.setUint32(8, glb.byteLength + 4, true);
    expect(preflightGlb(glb).ok).toBe(false);
  });

  it('rejects a chunk that overruns the file', () => {
    const glb = packGlb(validBox);
    const view = new DataView(glb.buffer);
    view.setUint32(12, glb.byteLength, true); // JSON chunk claims the whole file
    expect(preflightGlb(glb).ok).toBe(false);
  });
});

describe('preflightGlb — subset and extension rules', () => {
  it('rejects skinned meshes', () => {
    const glb = packGlb({ ...validBox, skins: [{ joints: [0] }] }, new Uint8Array(48));
    const result = preflightGlb(glb);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Skinned/);
  });

  it('rejects animation', () => {
    const glb = packGlb({ ...validBox, animations: [{ channels: [], samplers: [] }] }, new Uint8Array(48));
    expect(preflightGlb(glb).ok).toBe(false);
  });

  it('rejects an unsupported required extension', () => {
    const glb = packGlb({ ...validBox, extensionsRequired: ['KHR_draco_mesh_compression'] }, new Uint8Array(48));
    const result = preflightGlb(glb);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unsupported required extension/);
  });

  it('accepts an allowlisted required extension', () => {
    const glb = packGlb({ ...validBox, extensionsRequired: ['KHR_materials_unlit'] }, new Uint8Array(48));
    expect(preflightGlb(glb).ok).toBe(true);
  });
});

describe('preflightGlb — external resources and bounds', () => {
  it('rejects external buffer URIs', () => {
    const glb = packGlb({ ...validBox, buffers: [{ byteLength: 48, uri: 'http://evil/data.bin' }] });
    const result = preflightGlb(glb);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/External buffer/);
  });

  it('rejects external image URIs', () => {
    const glb = packGlb(
      { ...validBox, images: [{ uri: 'https://evil/tex.png' }] },
      new Uint8Array(48),
    );
    expect(preflightGlb(glb).ok).toBe(false);
  });

  it('accepts a data: image URI', () => {
    const glb = packGlb(
      { ...validBox, images: [{ uri: 'data:image/png;base64,AAAA' }] },
      new Uint8Array(48),
    );
    expect(preflightGlb(glb).ok).toBe(true);
  });

  it('rejects an accessor that overruns its bufferView', () => {
    const broken = {
      ...validBox,
      accessors: [
        { bufferView: 0, componentType: 5126, count: 100, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    const glb = packGlb(broken, new Uint8Array(48));
    const result = preflightGlb(glb);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/accessor overruns/);
  });

  it('rejects a bufferView that overruns its buffer', () => {
    const broken = {
      ...validBox,
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 1000 },
      ],
    };
    const glb = packGlb(broken, new Uint8Array(48));
    expect(preflightGlb(glb).ok).toBe(false);
  });
});

/* ── SceneAssetCache ──────────────────────────────────────────── */

function makeRef(hash: string): AssetRef {
  return { id: `id-${hash}`, kind: 'glb', hash: hash.padEnd(64, '0') };
}

function fakeDecoder(): { decode: (b: Uint8Array, v: GlbValidation) => Promise<THREE.Object3D>; calls: () => number } {
  let count = 0;
  return {
    decode: () => {
      count += 1;
      return Promise.resolve(new THREE.Group());
    },
    calls: () => count,
  };
}

describe('SceneAssetCache lifecycle', () => {
  it('decodes once and caches by content hash across slots', async () => {
    const glb = packGlb(validBox, new Uint8Array(48));
    const refA = makeRef('aaaa');
    const resolver = () => Promise.resolve(glb);
    const decoder = fakeDecoder();
    const cache = new SceneAssetCache(resolver, decoder.decode);

    const first = await cache.loadInto('slot-1', refA);
    const second = await cache.loadInto('slot-2', refA);
    expect(first.ok && second.ok).toBe(true);
    expect(decoder.calls()).toBe(1);
    expect(cache.residentCount()).toBe(1);

    cache.releaseSlot('slot-1');
    expect(cache.residentCount()).toBe(1); // slot-2 still holds it
    cache.releaseSlot('slot-2');
    expect(cache.residentCount()).toBe(0);
  });

  it('preserves the last good scene when a replacement fails preflight', async () => {
    const good = packGlb(validBox, new Uint8Array(48));
    const bad = new Uint8Array([1, 2, 3, 4]);
    const refGood = makeRef('g00d');
    const refBad = makeRef('bad0');
    const bytesByHash = new Map([[refGood.hash, good], [refBad.hash, bad]]);
    const resolver = (ref: AssetRef) => Promise.resolve(bytesByHash.get(ref.hash));
    const decoder = fakeDecoder();
    const cache = new SceneAssetCache(resolver, decoder.decode);

    const ok = await cache.loadInto('slot', refGood);
    expect(ok.ok).toBe(true);
    expect(cache.residentCount()).toBe(1);

    const fail = await cache.loadInto('slot', refBad);
    expect(fail.ok).toBe(false);
    // The good scene is untouched.
    expect(cache.residentCount()).toBe(1);
  });

  it('discards a stale load superseded by a newer request', async () => {
    const glbA = packGlb(validBox, new Uint8Array(48));
    const glbB = packGlb(validBox, new Uint8Array(48));
    const refA = makeRef('slowA');
    const refB = makeRef('fastB');
    const bytesByHash = new Map([[refA.hash, glbA], [refB.hash, glbB]]);

    let gateRelease: () => void = () => {};
    const gate = new Promise<void>((resolve) => { gateRelease = resolve; });
    let calls = 0;
    const resolver = async (ref: AssetRef): Promise<Uint8Array | undefined> => {
      calls += 1;
      if (calls === 1) {
        await gate; // Hold the first (A) load.
      }
      return bytesByHash.get(ref.hash);
    };
    const decoder = fakeDecoder();
    const cache = new SceneAssetCache(resolver, decoder.decode);

    const pA = cache.loadInto('slot', refA);
    const rB = await cache.loadInto('slot', refB); // supersedes A
    expect(rB.ok).toBe(true);
    gateRelease();
    const rA = await pA;
    expect(rA).toEqual({ ok: true, stale: true });
    // Only B is resident.
    expect(cache.residentCount()).toBe(1);
  });

  it('reports an unavailable asset as an error', async () => {
    const resolver = () => Promise.resolve(undefined);
    const cache = new SceneAssetCache(resolver, fakeDecoder().decode);
    const result = await cache.loadInto('slot', makeRef('none'));
    expect(result.ok).toBe(false);
  });

  it('disposes all resident scenes on dispose', async () => {
    const glb = packGlb(validBox, new Uint8Array(48));
    const cache = new SceneAssetCache(() => Promise.resolve(glb), fakeDecoder().decode);
    await cache.loadInto('slot', makeRef('keep'));
    expect(cache.residentCount()).toBe(1);
    cache.dispose();
    expect(cache.residentCount()).toBe(0);
  });
});
