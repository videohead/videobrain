import { MAX_ASSET_ENCODED_BYTES } from '../store/contracts';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXTENSION));

interface GltfBufferJson { byteLength: number; uri?: string }
interface GltfViewJson { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }
interface GltfImageJson { uri?: string; bufferView?: number; mimeType?: string }
interface GltfPackJson {
  buffers?: GltfBufferJson[];
  bufferViews?: GltfViewJson[];
  images?: GltfImageJson[];
}

export type GltfPackResult = { ok: true; glb: Uint8Array } | { ok: false; error: string };

class PackError extends Error {}

export function isGlbBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === GLB_MAGIC;
}

/** Lowercased basename used to match a glTF uri against selected companion files. */
export function companionKey(name: string): string {
  return name.split(/[\\/]/).pop()!.toLowerCase();
}

function resolveUri(
  uri: string,
  companions: ReadonlyMap<string, Uint8Array>,
): { bytes: Uint8Array; mime?: string } {
  if (uri.startsWith('data:')) {
    const match = /^data:([^;,]*);base64,(.*)$/s.exec(uri);
    if (!match) {
      throw new PackError('Only base64 data URIs are supported.');
    }
    if (match[2]!.length > MAX_ASSET_ENCODED_BYTES * 2) {
      throw new PackError('Embedded data exceeds the encoded byte limit.');
    }
    let binary: string;
    try {
      binary = atob(match[2]!);
    } catch {
      throw new PackError('Embedded data URI is not valid base64.');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { bytes, mime: match[1] || undefined };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')) {
    throw new PackError('External network URIs are not permitted.');
  }
  let name: string;
  try {
    name = decodeURIComponent(uri);
  } catch {
    throw new PackError(`Invalid resource path: ${uri}`);
  }
  const bytes = companions.get(companionKey(name));
  if (!bytes) {
    throw new PackError(`Missing file "${companionKey(name)}". Select it together with the .gltf file.`);
  }
  return { bytes };
}

const align4 = (value: number): number => (value + 3) & ~3;

/**
 * Pack a .gltf (JSON) plus its companion files into one self-contained GLB so the
 * rest of the pipeline only ever sees a single validated binary container.
 */
export function packGltfToGlb(
  gltfBytes: Uint8Array,
  companions: ReadonlyMap<string, Uint8Array>,
): GltfPackResult {
  try {
    let json: GltfPackJson;
    try {
      json = JSON.parse(new TextDecoder().decode(gltfBytes)) as GltfPackJson;
    } catch {
      throw new PackError('Not a valid glTF or GLB file.');
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new PackError('Not a valid glTF or GLB file.');
    }

    const parts: Uint8Array[] = [];
    let cursor = 0;
    const append = (bytes: Uint8Array): number => {
      const offset = cursor;
      parts.push(bytes);
      cursor += bytes.byteLength;
      const padding = align4(cursor) - cursor;
      if (padding > 0) {
        parts.push(new Uint8Array(padding));
        cursor += padding;
      }
      if (cursor > MAX_ASSET_ENCODED_BYTES) {
        throw new PackError('Model exceeds the encoded byte limit.');
      }
      return offset;
    };

    const bufferOffsets: number[] = [];
    (json.buffers ?? []).forEach((buffer, index) => {
      if (buffer.uri === undefined) {
        throw new PackError(`glTF buffer ${index} has no data.`);
      }
      const { bytes } = resolveUri(buffer.uri, companions);
      if (bytes.byteLength < buffer.byteLength) {
        throw new PackError(`Buffer file for buffer ${index} is shorter than declared.`);
      }
      bufferOffsets.push(append(bytes.subarray(0, buffer.byteLength)));
    });

    const views = json.bufferViews ?? [];
    for (const view of views) {
      const base = bufferOffsets[view.buffer];
      if (base === undefined) {
        throw new PackError('bufferView references a missing buffer.');
      }
      view.buffer = 0;
      view.byteOffset = (view.byteOffset ?? 0) + base;
    }

    for (const image of json.images ?? []) {
      if (image.uri === undefined) {
        continue;
      }
      const { bytes, mime } = resolveUri(image.uri, companions);
      const extension = image.uri.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? '';
      const mimeType = image.mimeType ?? mime ?? IMAGE_MIME_BY_EXTENSION[extension];
      if (!mimeType || !IMAGE_MIMES.has(mimeType)) {
        throw new PackError('Textures must be PNG, JPEG or WebP.');
      }
      const byteOffset = append(bytes);
      views.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength });
      image.bufferView = views.length - 1;
      image.mimeType = mimeType;
      delete image.uri;
    }

    if (cursor > 0) {
      json.buffers = [{ byteLength: cursor }];
      json.bufferViews = views;
    } else {
      delete json.buffers;
    }

    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = align4(jsonBytes.byteLength);
    const total = 12 + 8 + jsonLength + (cursor > 0 ? 8 + cursor : 0);
    const glb = new Uint8Array(total);
    const view = new DataView(glb.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, CHUNK_JSON, true);
    glb.set(jsonBytes, 20);
    glb.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
    if (cursor > 0) {
      const binStart = 20 + jsonLength;
      view.setUint32(binStart, cursor, true);
      view.setUint32(binStart + 4, CHUNK_BIN, true);
      let offset = binStart + 8;
      for (const part of parts) {
        glb.set(part, offset);
        offset += part.byteLength;
      }
    }
    return { ok: true, glb };
  } catch (error) {
    if (error instanceof PackError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
