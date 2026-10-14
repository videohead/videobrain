/**
 * D4 — Import adapters for OBJ/MTL, STL, FBX, 3MF, 3DS, USD/USDZ and .gltf.
 *
 * Every adapter decodes the source file into a Three.js object with the pinned
 * Three.js loaders, then normalizes it into one self-contained GLB via the
 * pinned GLTFExporter. Downstream storage, preflight and rendering only ever
 * see validated GLB, so budgets and the static-subset policy stay single-format.
 *
 * Adapters are GPU-free and do no network I/O: companion files (materials,
 * textures, bins) must be provided alongside the primary file, and URL-backed
 * texture lookups are blocked by an intercepting LoadingManager.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';

import { isGlbBytes, packGltfToGlb } from './gltfPack';

export const SCENE_IMPORT_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'fbx', '3mf', '3ds', 'usda', 'usdc', 'usd', 'usdz'] as const;

export const SCENE_IMPORT_ACCEPT = [
  '.glb', '.gltf', '.bin', '.obj', '.mtl', '.stl', '.fbx', '.3mf', '.3ds', '.usda', '.usdc', '.usd', '.usdz',
  'image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'model/gltf+json',
].join(',');

export type SceneImportErrorCode =
  | 'empty'
  | 'no-model'
  | 'unsupported'
  | 'missing-dependency'
  | 'parse'
  | 'static-subset'
  | 'export';

export interface SceneImportSuccess { ok: true; glb: Uint8Array; sourceFormat: string }
export interface SceneImportFailure { ok: false; error: string; code: SceneImportErrorCode }
export type SceneImportResult = SceneImportSuccess | SceneImportFailure;

interface NamedFile { name: string; bytes: Uint8Array }

class ImportError extends Error {
  constructor(
    message: string,
    readonly code: SceneImportErrorCode,
  ) {
    super(message);
  }
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Loading manager that serves data/blob/object URLs and blocks everything else. */
function createOfflineManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob:|data:|about:)/.test(url)) {
      return url;
    }
    if (url.startsWith('texture://') || url.startsWith('vfs:')) {
      return url;
    }
    throw new ImportError(
      `External resource "${url.split('/').pop() ?? url}" is not bundled. Select its file together with the model.`,
      'missing-dependency',
    );
  });
  return manager;
}

/** Register companion files under texture:// URLs so manager-served loads stay offline. */
function registerCompanions(files: readonly NamedFile[]): () => void {
  const created: string[] = [];
  const urls = new Map<string, string>();
  if (typeof URL.createObjectURL === 'function') {
    for (const file of files) {
      const mime = file.name.toLowerCase().endsWith('.png')
        ? 'image/png'
        : /\.(jpe?g)$/i.test(file.name)
          ? 'image/jpeg'
          : 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([toArrayBuffer(file.bytes)], { type: mime }));
      created.push(url);
      urls.set(file.name.split(/[\\/]/).pop()!.toLowerCase(), url);
    }
  }
  (globalThis as Record<string, unknown>).__videobrainImportUrls = urls;
  return () => {
    for (const url of created) {
      URL.revokeObjectURL(url);
    }
    delete (globalThis as Record<string, unknown>).__videobrainImportUrls;
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function findCompanion(files: readonly NamedFile[], extension: string): NamedFile | undefined {
  return files.find((file) => extensionOf(file.name) === extension);
}

function decode(primary: NamedFile, files: readonly NamedFile[]): THREE.Object3D {
  const extension = extensionOf(primary.name);
  const manager = createOfflineManager();
  const text = () => new TextDecoder().decode(primary.bytes);
  const buffer = () => toArrayBuffer(primary.bytes);

  switch (extension) {
    case 'obj': {
      const mtl = findCompanion(files, 'mtl');
      const group = new OBJLoader().parse(text());
      if (mtl) {
        const materials = new MTLLoader(manager).parse(new TextDecoder().decode(mtl.bytes), '');
        materials.preload();
        const nameByObject = new Map<string, THREE.Material>();
        for (const [name, material] of Object.entries(materials.materials)) {
          nameByObject.set(name, material);
        }
        const reassign = (mesh: THREE.Mesh): void => {
          const fromGeometry = (mesh.geometry.userData?.materialNames as string[] | undefined) ?? [];
          const source = mesh.material as unknown;
          const list = Array.isArray(source) ? source : [source];
          const current = list.filter((material): material is THREE.Material => material instanceof THREE.Material);
          if (current.length === 0) return;
          const mapped = current.map((material, index) => {
            const name = material.name || fromGeometry[index];
            return (name && nameByObject.get(name)) ?? material;
          });
          mesh.material = (Array.isArray(source) ? mapped : mapped[0]) as THREE.Mesh['material'];
        };
        group.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            reassign(mesh);
          }
        });
      }
      return group;
    }
    case 'stl': {
      const geometry = new STLLoader().parse(buffer());
      const material = new THREE.MeshStandardMaterial({ color: 0xb0b8bc, metalness: 0, roughness: 0.6 });
      return new THREE.Mesh(geometry, material);
    }
    case 'fbx':
      return new FBXLoader(manager).parse(buffer(), '');
    case '3mf':
      return new ThreeMFLoader(manager).parse(buffer());
    case '3ds':
      return new TDSLoader(manager).parse(buffer(), '');
    case 'usda':
    case 'usd': {
      const source: string | ArrayBuffer = extension === 'usd' && !looksLikeText(primary.bytes) ? buffer() : text();
      return new USDLoader(manager).parse(source);
    }
    case 'usdc':
      return new USDLoader(manager).parse(buffer());
    case 'usdz':
      return new USDLoader(manager).parse(buffer());
    default:
      throw new ImportError(`Unsupported model format ".${extension}".`, 'unsupported');
  }
}

function looksLikeText(bytes: Uint8Array): boolean {
  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 512));
  for (const byte of probe) {
    if (byte === 0) return false;
  }
  return true;
}

/** Static scenes only: morph targets and skinned meshes are outside the subset. */
function assertStatic(root: THREE.Object3D): void {
  let hasGeometry = false;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      hasGeometry = true;
      const geometry = mesh.geometry as THREE.BufferGeometry & { morphAttributes?: Record<string, unknown> };
      if ((geometry.morphAttributes?.position?.length ?? 0) > 0) {
        throw new ImportError('Morph targets are outside the static subset.', 'static-subset');
      }
    }
    if ((child as THREE.SkinnedMesh).isSkinnedMesh || child.type === 'Bone') {
      throw new ImportError('Skinned meshes are outside the static subset.', 'static-subset');
    }
  });
  if (!hasGeometry) {
    throw new ImportError('The model contains no geometry.', 'empty');
  }
}

const MAX_EXPORT_EMBED_BYTES = 50 * 1024 * 1024;

function exportGlb(root: THREE.Object3D): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
        } else {
          reject(new ImportError('GLTF export did not produce binary output.', 'export'));
        }
      },
      (error) => {
        const message = error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'unknown exporter error';
        reject(new ImportError(`GLTF export failed: ${message}`, 'export'));
      },
      { binary: true, animations: [], embedImages: true, maxTextureSize: MAX_EXPORT_EMBED_BYTES },
    );
  });
}

/**
 * Convert one primary model file (plus optional companion files) into a
 * self-contained GLB. GLB input passes through unchanged; .gltf is packed with
 * its companions; every other format is decoded and re-exported as GLB.
 */
export async function importSceneToGlb(
  primary: NamedFile,
  companions: readonly NamedFile[],
): Promise<SceneImportResult> {
  try {
    const extension = extensionOf(primary.name);
    if (extension === 'glb' || isGlbBytes(primary.bytes)) {
      return { ok: true, glb: primary.bytes, sourceFormat: 'glb' };
    }
    if (extension === 'gltf') {
      const map = new Map([primary, ...companions].map((file) => [file.name.split(/[\\/]/).pop()!.toLowerCase(), file.bytes]));
      const packed = packGltfToGlb(primary.bytes, map);
      if (!packed.ok) {
        return { ok: false, error: packed.error, code: 'missing-dependency' };
      }
      return { ok: true, glb: packed.glb, sourceFormat: 'gltf' };
    }
    if (!(SCENE_IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
      return { ok: false, error: `Unsupported model format ".${extension}".`, code: 'unsupported' };
    }
    const revoke = registerCompanions(companions);
    let root: THREE.Object3D;
    try {
      root = decode(primary, [primary, ...companions]);
    } finally {
      revoke();
    }
    assertStatic(root);
    const glb = await exportGlb(root);
    return { ok: true, glb, sourceFormat: extension };
  } catch (error) {
    if (error instanceof ImportError) {
      return { ok: false, error: error.message, code: error.code };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not parse the model: ${message}`, code: 'parse' };
  }
}
