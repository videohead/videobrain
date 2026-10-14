import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importSceneToGlb } from './sceneImport';
import { preflightGlb } from './SceneAssetCache';

const FIXTURES = join(process.cwd(), 'public/test-data/fixtures-3d');
const fixture = (name: string): { name: string; bytes: Uint8Array } => ({
  name,
  bytes: new Uint8Array(readFileSync(join(FIXTURES, name))),
});

function textFile(name: string, content: string): { name: string; bytes: Uint8Array } {
  return { name, bytes: new TextEncoder().encode(content) };
}

function binaryStl(triangles: number): Uint8Array {
  const bytes = new Uint8Array(84 + triangles * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles, true);
  // One triangle spanning the unit XY square's first half.
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (let index = 0; index < vertices.length; index += 1) {
    view.setFloat32(84 + 12 + index * 4, vertices[index]!, true);
  }
  return bytes;
}

const OBJ_CUBE = `
v -0.5 -0.5 -0.5
v 0.5 -0.5 -0.5
v 0.5 0.5 -0.5
f 1 2 3
`;

const OBJ_WITH_MTL = `mtllib cube.mtl
o cube
v -0.5 -0.5 -0.5
v 0.5 -0.5 -0.5
v 0.5 0.5 -0.5
usemtl red
f 1 2 3
`;

const MTL_RED = `newmtl red
Kd 1 0 0
`;

const USDA_SCENE = `#usda 1.0
(
  upAxis = "Y"
)

def Xform "root"
{
  def Mesh "quad"
  {
    int[] faceVertexCounts = [3]
    int[] faceVertexIndices = [0, 1, 2]
    point3f[] points = [(-0.5, -0.5, 0), (0.5, -0.5, 0), (0, 0.5, 0)]
  }
}
`;

/** Minimal 3DS: M3DMAGIC > MDATA > NAMED_OBJECT(name) > OBJ_TRIMESH(verts+face). */
function make3ds(): Uint8Array {
  const u16 = (v: number): number[] => [v & 0xff, v >> 8];
  const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  const f32 = (v: number): number[] => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    return [...b];
  };
  const chunk = (id: number, body: number[]): number[] => [
    ...u16(id),
    ...u32(body.length + 6),
    ...body,
  ];
  const vertices = chunk(0x4110, [
    ...u16(3),
    ...f32(0), ...f32(0), ...f32(0),
    ...f32(1), ...f32(0), ...f32(0),
    ...f32(0), ...f32(1), ...f32(0),
  ]);
  const faces = chunk(0x4120, [...u16(1), ...u16(0), ...u16(1), ...u16(2), ...u16(0)]);
  const trimesh = chunk(0x4100, [...vertices, ...faces]);
  const namedObject = chunk(0x4000, [...'tri'.split('').map((c) => c.charCodeAt(0)), 0, ...trimesh]);
  const mdata = chunk(0x3d3d, namedObject);
  const version = chunk(0x0002, u32(3));
  return new Uint8Array(chunk(0x4d4d, [...version, ...mdata]));
}

describe('importSceneToGlb', () => {
  it('passes a GLB through unchanged', async () => {
    const glb = textFile('model.glb', '');
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
    const result = await importSceneToGlb({ name: glb.name, bytes }, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceFormat).toBe('glb');
      expect(result.glb).toBe(bytes);
    }
  });

  it('imports an OBJ triangle', async () => {
    const result = await importSceneToGlb(textFile('cube.obj', OBJ_CUBE), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceFormat).toBe('obj');
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBeGreaterThanOrEqual(1);
    }
  });

  it('applies an OBJ companion MTL', async () => {
    const result = await importSceneToGlb(textFile('cube.obj', OBJ_WITH_MTL), [textFile('cube.mtl', MTL_RED)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.materialCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('imports a binary STL', async () => {
    const result = await importSceneToGlb({ name: 'shape.stl', bytes: binaryStl(1) }, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBe(1);
    }
  });

  it('imports an ASCII STL', async () => {
    const ascii = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t
`;
    const result = await importSceneToGlb(textFile('shape.stl', ascii), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
  });

  it('imports a USDA scene', async () => {
    const result = await importSceneToGlb(textFile('scene.usda', USDA_SCENE), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBeGreaterThanOrEqual(1);
    }
  });

  it('imports the OBJ fixture with its MTL companion', async () => {
    const result = await importSceneToGlb(fixture('d4-quad.obj'), [fixture('d4-quad.mtl')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBe(2);
      expect(preflight.validation.materialCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('imports the STL fixture', async () => {
    const result = await importSceneToGlb(fixture('d4-quad.stl'), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBe(2);
    }
  });

  it('imports the USDZ fixture', async () => {
    const result = await importSceneToGlb(fixture('d4-quad.usdz'), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBeGreaterThanOrEqual(2);
    }
  });

  it('imports the 3MF fixture', async () => {
    const result = await importSceneToGlb(fixture('d4-triangle.3mf'), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBe(1);
    }
  });

  it('imports the FBX fixture', async () => {
    const result = await importSceneToGlb(fixture('d4-triangle.fbx'), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBeGreaterThanOrEqual(1);
    }
  });

  it('imports a 3DS chunk stream', async () => {
    const result = await importSceneToGlb({ name: 'tri.3ds', bytes: make3ds() }, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preflight = preflightGlb(result.glb);
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.validation.triangles).toBe(1);
    }
  });

  it('reports an unsupported extension', async () => {
    const result = await importSceneToGlb(textFile('model.step', 'ISO-10303'), []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unsupported');
  });

  it('fails cleanly on empty OBJ geometry', async () => {
    const result = await importSceneToGlb(textFile('empty.obj', '# nothing here\n'), []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('empty');
  });

  it('surfaces a missing .gltf companion', async () => {
    const gltf = { asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'scene.bin' }] };
    const result = await importSceneToGlb(textFile('scene.gltf', JSON.stringify(gltf)), []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('scene.bin');
  });
});
