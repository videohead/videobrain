#!/usr/bin/env node
/**
 * Generate D4 import-format fixtures for the scene import adapters.
 * Run: docker run --rm -v "$PWD":/srv -w /srv node:22-bookworm-slim sh -c \
 *   "npm ci --silent && node scripts/generate-d4-fixtures.mjs"
 *
 * OBJ/MTL, STL (ASCII), 3MF and USDZ are written with the pinned Three.js
 * exporters (or hand-rolled 3MF); FBX is synthesized as the smallest valid
 * binary file the pinned FBXLoader accepts. All outputs are tiny, CC0, and
 * deterministic.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public/test-data/fixtures-3d');
mkdirSync(OUT, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const manifest = [];

function emit(name, bytes, description) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  writeFileSync(join(OUT, name), buf);
  manifest.push({ name, sha256: sha256(buf), bytes: buf.byteLength, description });
  console.log(`${name} ${buf.byteLength}B ${sha256(buf).slice(0, 12)}`);
}

const quad = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x4488cc, roughness: 0.5, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'd4-quad';
  return mesh;
};

// OBJ + MTL
const objText = new OBJExporter().parse(quad());
emit('d4-quad.obj', objText, 'OBJ quad exported from pinned OBJExporter');
emit('d4-quad.mtl', 'newmtl d4\nKd 0.27 0.53 0.80\n', 'Companion MTL for d4-quad.obj');

// STL (ascii for readability; loader path identical)
const stlText = new STLExporter().parse(quad(), { binary: false });
emit('d4-quad.stl', stlText, 'ASCII STL quad from pinned STLExporter');

// USDZ via pinned exporter (geometry must hang under a root object)
const usdzRoot = new THREE.Group();
usdzRoot.add(quad());
const usdzBuffer = await new Promise((resolve, reject) => {
  new USDZExporter().parse(usdzRoot, resolve, reject);
});
emit('d4-quad.usdz', new Uint8Array(usdzBuffer), 'USDZ quad from pinned USDZExporter');

// 3MF (OPC zip with the minimal 3D model part, stored+deflate entries)
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}
function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, compress } of entries) {
    const nameBuf = Buffer.from(name);
    const payload = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + payload.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}
const model3mf = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="10" y="0" z="0"/>
     <vertex x="0" y="10" z="0"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>
`;
const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;
const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;
const zip3mf = zipStore([
  { name: '[Content_Types].xml', data: Buffer.from(contentTypes), compress: false },
  { name: '_rels/.rels', data: Buffer.from(rels), compress: false },
  { name: '3D/3dmodel.model', data: Buffer.from(model3mf), compress: true },
]);
emit('d4-triangle.3mf', zip3mf, 'Hand-packed minimal 3MF (single triangle)');

// Minimal binary FBX (7.4, 32-bit node records) accepted by the pinned FBXLoader.
const i32 = (v) => { const b = Buffer.alloc(5); b.write('i'); b.writeInt32LE(v, 1); return b; };
const i64 = (v) => { const b = Buffer.alloc(9); b.write('L'); b.writeBigInt64LE(BigInt(v), 1); return b; };
const str = (v) => { const b = Buffer.from(v); const h = Buffer.alloc(5); h.write('S'); h.writeUInt32LE(b.length, 1); return Buffer.concat([h, b]); };
const f64arr = (values) => {
  const body = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => body.writeDoubleLE(v, i * 8));
  const h = Buffer.alloc(13);
  h.write('d');
  h.writeUInt32LE(values.length, 1);
  h.writeUInt32LE(0, 5);
  h.writeUInt32LE(body.length, 9);
  return Buffer.concat([h, body]);
};
const i32arr = (values) => {
  const body = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => body.writeInt32LE(v, i * 4));
  const h = Buffer.alloc(13);
  h.write('i');
  h.writeUInt32LE(values.length, 1);
  h.writeUInt32LE(0, 5);
  h.writeUInt32LE(body.length, 9);
  return Buffer.concat([h, body]);
};

function serializeFbxNode(node, offset) {
  const children = node.children ?? [];
  const props = node.properties ?? [];
  const headerSize = 13 + Buffer.from(node.name).length;
  const childBufs = [];
  let cursor = offset + headerSize + props.reduce((sum, p) => sum + p.length, 0);
  for (const child of children) {
    const buf = serializeFbxNode(child, cursor);
    childBufs.push(buf);
    cursor += buf.length;
  }
  if (children.length > 0) {
    cursor += 13;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32LE(cursor, 0);
  header.writeUInt32LE(props.length, 4);
  header.writeUInt32LE(props.reduce((sum, p) => sum + p.length, 0), 8);
  header.writeUInt8(node.name.length, 12);
  const parts = [header, Buffer.from(node.name), ...props, ...childBufs];
  if (children.length > 0) {
    parts.push(Buffer.alloc(13));
  }
  return Buffer.concat(parts);
}

const fbxVersion = Buffer.alloc(4);
fbxVersion.writeUInt32LE(7400, 0);
const fbxHeader = Buffer.concat([
  Buffer.from('Kaydara FBX Binary  \x00\x1a\x00', 'binary'),
  fbxVersion,
]);
const fbxNodes = [
  {
    name: 'Objects',
    children: [
      {
        name: 'Geometry',
        properties: [i64(1001), str('Geometry::d4'), str('Mesh')],
        children: [
          { name: 'Vertices', properties: [f64arr([0, 0, 0, 1, 0, 0, 0, 1, 0])] },
          { name: 'PolygonVertexIndex', properties: [i32arr([0, 1, -3])] },
        ],
      },
      { name: 'Model', properties: [i64(2002), str('Model::d4'), str('Mesh')] },
    ],
  },
  {
    name: 'Connections',
    children: [
      { name: 'C', properties: [str('OO'), i64(1001), i64(2002)] },
      { name: 'C', properties: [str('OO'), i64(2002), i64(0)] },
    ],
  },
];
let fbxOffset = fbxHeader.length;
const fbxParts = [fbxHeader];
for (const node of fbxNodes) {
  const buf = serializeFbxNode(node, fbxOffset);
  fbxParts.push(buf);
  fbxOffset += buf.length;
}
fbxParts.push(Buffer.alloc(13));
// FBX files end with a ~160-byte footer; the loader stops early otherwise.
const fbxPad = Buffer.concat(fbxParts);
const fbx = Buffer.concat([fbxPad, Buffer.alloc(176)]);
emit('d4-triangle.fbx', fbx, 'Minimal binary FBX (one triangle)');

// 3DS is covered by unit tests with a synthesized chunk stream; a fixture file
// is not required for loader parity, so we record the deferral in the manifest.
manifest.push({ name: 'd4-triangle.3ds', deferred: '3DS fixture generated inside sceneImport.test.ts (chunk stream)' });

writeFileSync(join(OUT, 'd4-fixture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest written');
