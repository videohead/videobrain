import { importSceneToGlb } from '../../src/engine/sceneImport';
import { preflightGlb } from '../../src/engine/SceneAssetCache';

interface ImportPayload {
  primary: { name: string; bytes: number[] };
  companions: { name: string; bytes: number[] }[];
}

async function run(payload: ImportPayload): Promise<{
  ok: boolean;
  error: string | null;
  triangles: number;
  meshCount: number;
}> {
  const primary = { name: payload.primary.name, bytes: new Uint8Array(payload.primary.bytes) };
  const companions = payload.companions.map((entry) => ({ name: entry.name, bytes: new Uint8Array(entry.bytes) }));
  const converted = await importSceneToGlb(primary, companions);
  if (!converted.ok) {
    return { ok: false, error: converted.error, triangles: 0, meshCount: 0 };
  }
  const preflight = preflightGlb(converted.glb);
  if (!preflight.ok) {
    return { ok: false, error: preflight.error, triangles: 0, meshCount: 0 };
  }
  return {
    ok: true,
    error: null,
    triangles: preflight.validation.triangles,
    meshCount: preflight.validation.meshCount,
  };
}

Reflect.set(globalThis, 'runSceneImportFixture', run);
