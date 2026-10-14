import { describe, expect, it } from 'vitest';

import { companionKey, isGlbBytes, packGltfToGlb } from './gltfPack';
import { preflightGlb } from './SceneAssetCache';

const BIN = new Uint8Array([0, 1, 2, 3, 4, 5]);

function baseGltf(): object {
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: BIN.byteLength, uri: 'scene.bin' }],
    bufferViews: [{ buffer: 0, byteOffset: 2, byteLength: 3 }],
    meshes: [],
  };
}

function asBytes(value: object | string): Uint8Array {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(text);
}

function companions(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map(Object.entries(entries).map(([name, bytes]) => [companionKey(name), bytes]));
}

describe('packGltfToGlb', () => {
  it('packs a glTF with an external buffer into a self-contained GLB', () => {
    const result = packGltfToGlb(asBytes(baseGltf()), companions({ 'scene.bin': BIN }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(Array.from((preflight.validation.bin ?? new Uint8Array()).subarray(0, BIN.byteLength))).toEqual(Array.from(BIN));
      expect(preflight.validation.json.bufferViews?.[0]?.byteOffset).toBe(2);
    }
  });

  it('remaps image files to bufferViews with their mime types', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const gltf = { ...baseGltf(), images: [{ uri: 'tex.png' }] };
    const result = packGltfToGlb(asBytes(gltf), companions({ 'scene.bin': BIN, 'tex.png': png }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      const image = preflight.validation.json.images?.[0];
      expect(image?.uri).toBeUndefined();
      expect(image?.mimeType).toBe('image/png');
      expect(image?.bufferView).toBe(1);
      const view = preflight.validation.json.bufferViews?.[1];
      expect(view?.buffer).toBe(0);
    }
  });

  it('embeds a data-URI buffer', () => {
    const uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...BIN))}`;
    const gltf = { ...baseGltf(), buffers: [{ byteLength: BIN.byteLength, uri }] };
    const result = packGltfToGlb(asBytes(gltf), new Map());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(preflightGlb(result.glb).ok).toBe(true);
  });

  it('reports the missing companion file by name', () => {
    const result = packGltfToGlb(asBytes(baseGltf()), new Map());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('scene.bin');
  });

  it('rejects network URIs', () => {
    const gltf = { ...baseGltf(), buffers: [{ byteLength: 4, uri: 'https://example.com/a.bin' }] };
    const result = packGltfToGlb(asBytes(gltf), new Map());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('network');
  });

  it('rejects buffers shorter than declared', () => {
    const result = packGltfToGlb(asBytes(baseGltf()), companions({ 'scene.bin': new Uint8Array(2) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('shorter');
  });

  it('rejects unsupported texture types', () => {
    const gltf = { ...baseGltf(), images: [{ uri: 'map.tiff' }] };
    const result = packGltfToGlb(asBytes(gltf), companions({ 'scene.bin': BIN, 'map.tiff': BIN }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('PNG');
  });

  it('rejects invalid JSON', () => {
    const result = packGltfToGlb(new Uint8Array([0x7b, 0xff]), new Map());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('glTF');
  });

  it('isGlbBytes recognizes the GLB magic', () => {
    expect(isGlbBytes(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0]))).toBe(true);
    expect(isGlbBytes(new Uint8Array([0x7b, 0x22]))).toBe(false);
  });
});
