#!/usr/bin/env node
/**
 * Generate C3 fixture files for P0.
 * Run via: docker run --rm -v /opt/videobrain:/srv -w /srv node:22-alpine node scripts/generate-fixtures.mjs
 *
 * Produces real, parseable glTF 2.0 GLB geometry (indexed boxes with normals and
 * a PBR material) plus deliberately malformed / over-budget variants and mapping
 * test patterns. Everything is content-addressed with SHA-256.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_3D = join(ROOT, 'public/test-data/fixtures-3d');
const OUT_MAP = join(ROOT, 'public/test-data/fixtures-mapping');

mkdirSync(OUT_3D, { recursive: true });
mkdirSync(OUT_MAP, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const GL_FLOAT = 5126;
const GL_UNSIGNED_SHORT = 5123;
const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;

/** Build an indexed unit box: 24 positions/normals, 36 indices. */
function boxGeometry(size = 1) {
  const h = size / 2;
  const faces = [
    { n: [0, 0, 1], v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
    { n: [0, 1, 0], v: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
    { n: [1, 0, 0], v: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, f) => {
    for (const vertex of face.v) {
      positions.push(...vertex);
      normals.push(...face.n);
    }
    const base = f * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

function minMax(arr, stride) {
  const min = new Array(stride).fill(Infinity);
  const max = new Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i += stride) {
    for (let c = 0; c < stride; c++) {
      min[c] = Math.min(min[c], arr[i + c]);
      max[c] = Math.max(max[c], arr[i + c]);
    }
  }
  return { min, max };
}

/** Pack one box geometry into BIN and return offsets. */
function packBoxBin(geo) {
  const align4 = (n) => (n + 3) & ~3;
  const posBytes = geo.positions.byteLength;
  const normBytes = geo.normals.byteLength;
  const idxBytes = geo.indices.byteLength;
  const posOff = 0;
  const normOff = align4(posOff + posBytes);
  const idxOff = align4(normOff + normBytes);
  const binLen = align4(idxOff + idxBytes);
  const bin = Buffer.alloc(binLen);
  Buffer.from(geo.positions.buffer).copy(bin, posOff);
  Buffer.from(geo.normals.buffer).copy(bin, normOff);
  Buffer.from(geo.indices.buffer).copy(bin, idxOff);
  return { bin, posOff, normOff, idxOff, posBytes, normBytes, idxBytes, binLen };
}

/** Assemble a valid single-mesh GLB from one box geometry. */
function buildBoxGLB(size, color) {
  const geo = boxGeometry(size);
  const b = packBoxBin(geo);
  const posRange = minMax(geo.positions, 3);
  const vertexCount = geo.positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'videobrain-fixture-generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Box' }],
    meshes: [{
      name: 'BoxMesh',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }],
    }],
    materials: [{ name: 'BoxMaterial', pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0.1, roughnessFactor: 0.6 } }],
    accessors: [
      { bufferView: 0, componentType: GL_FLOAT, count: vertexCount, type: 'VEC3', min: posRange.min, max: posRange.max },
      { bufferView: 1, componentType: GL_FLOAT, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: geo.indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: b.posOff, byteLength: b.posBytes, target: GL_ARRAY_BUFFER },
      { buffer: 0, byteOffset: b.normOff, byteLength: b.normBytes, target: GL_ARRAY_BUFFER },
      { buffer: 0, byteOffset: b.idxOff, byteLength: b.idxBytes, target: GL_ELEMENT_ARRAY_BUFFER },
    ],
    buffers: [{ byteLength: b.binLen }],
  };
  return packGLB(gltf, b.bin);
}

/** Build a two-node scene reusing one shared mesh. */
function buildMultiMeshGLB() {
  const geo = boxGeometry(1);
  const b = packBoxBin(geo);
  const posRange = minMax(geo.positions, 3);
  const vertexCount = geo.positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'videobrain-fixture-generator' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, name: 'BoxA', translation: [-1, 0, 0] },
      { mesh: 0, name: 'BoxB', translation: [1, 0, 0] },
    ],
    meshes: [{ name: 'SharedBox', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{ name: 'Mat', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.3, 0.8, 1], metallicFactor: 0.1, roughnessFactor: 0.5 } }],
    accessors: [
      { bufferView: 0, componentType: GL_FLOAT, count: vertexCount, type: 'VEC3', min: posRange.min, max: posRange.max },
      { bufferView: 1, componentType: GL_FLOAT, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: geo.indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: b.posOff, byteLength: b.posBytes, target: GL_ARRAY_BUFFER },
      { buffer: 0, byteOffset: b.normOff, byteLength: b.normBytes, target: GL_ARRAY_BUFFER },
      { buffer: 0, byteOffset: b.idxOff, byteLength: b.idxBytes, target: GL_ELEMENT_ARRAY_BUFFER },
    ],
    buffers: [{ byteLength: b.binLen }],
  };
  return packGLB(gltf, b.bin);
}

/** Wrap a glTF JSON + BIN buffer into a GLB container. */
function packGLB(gltf, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunkLen = jsonBuf.length + jsonPad;
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunkLen = bin.length + binPad;
  const total = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const glb = Buffer.alloc(total);
  let p = 0;
  glb.write('glTF', p); p += 4;
  glb.writeUInt32LE(2, p); p += 4;
  glb.writeUInt32LE(total, p); p += 4;
  glb.writeUInt32LE(jsonChunkLen, p); p += 4;
  glb.writeUInt32LE(0x4e4f534a, p); p += 4;
  jsonBuf.copy(glb, p); p += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) { glb[p++] = 0x20; }
  glb.writeUInt32LE(binChunkLen, p); p += 4;
  glb.writeUInt32LE(0x004e4942, p); p += 4;
  bin.copy(glb, p); p += bin.length;
  for (let i = 0; i < binPad; i++) { glb[p++] = 0; }
  return glb;
}

const files = [];
function emit(dir, name, buf, expectedResult) {
  writeFileSync(join(dir, name), buf);
  const hash = sha256(buf);
  const rel = `${dir === OUT_3D ? 'fixtures-3d' : 'fixtures-mapping'}/${name}`;
  files.push({ path: rel, size: buf.length, hash, expectedResult });
  console.log(name.padEnd(28), String(buf.length).padStart(8), 'bytes  hash', hash.slice(0, 16));
}

emit(OUT_3D, 'single-mesh.glb', buildBoxGLB(1, [0.8, 0.2, 0.2, 1]), 'valid-single-mesh');
emit(OUT_3D, 'multi-mesh.glb', buildMultiMeshGLB(), 'valid-multi-mesh');
const validForCorrupt = buildBoxGLB(1, [0.2, 0.6, 0.9, 1]);
emit(OUT_3D, 'corrupt.glb', validForCorrupt.subarray(0, validForCorrupt.length - 40), 'truncated-error');
const oversizedGltf = {
  asset: { version: '2.0' },
  buffers: [{ byteLength: 300 * 1024 * 1024 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 300 * 1024 * 1024 }],
};
emit(OUT_3D, 'oversized.glb', packGLB(oversizedGltf, Buffer.alloc(16)), 'over-budget-reject');
const comfy = JSON.stringify({ prompt: 'a red cube on a blue background', workflow: 'minimal-test', nodes: [], version: '1.0' });
emit(OUT_3D, 'comfy-minimal-workflow.json', Buffer.from(comfy, 'utf8'), 'valid-prompt');

const cw = 16, ch = 16;
const checker = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const off = (y * cw + x) * 4;
    const white = ((x >> 2) + (y >> 2)) % 2 === 0;
    checker[off] = checker[off + 1] = checker[off + 2] = white ? 255 : 0;
    checker[off + 3] = 255;
  }
}
emit(OUT_MAP, 'checker-16x16.rgba', checker, 'pixels-precise');
const triMask = JSON.stringify({
  paths: [
    { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], closed: true, feather: 0 },
    { points: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.75, y: 1 }], closed: true, feather: 0.05 },
  ],
});
emit(OUT_MAP, 'tris-mask.json', Buffer.from(triMask, 'utf8'), 'valid-paths');

const manifest = {
  generatedAt: new Date().toISOString(),
  version: 'fixture-draft-2',
  environment: { node: process.version, platform: process.platform },
  files,
  licenses: { default: 'CC0-1.0', source: 'generated-by-script', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
};
writeFileSync(join(OUT_3D, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nManifest written: fixture-manifest.json');
