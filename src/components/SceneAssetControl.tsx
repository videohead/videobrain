import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';

import { SCENE_IMPORT_ACCEPT } from '../engine/sceneImport';
import type { SceneAssetImportResult } from '../hooks/useSceneAssets';

interface SceneAssetControlProps {
  assetId: string;
  assetHash: string;
  status: 'ready' | 'missing' | 'none';
  onImport: (files: readonly File[]) => Promise<SceneAssetImportResult>;
  onApply: (assetId: string, assetHash: string) => void;
  onClear: () => void;
}

function label(status: SceneAssetControlProps['status'], loading: boolean): string {
  if (loading) return 'Importing model...';
  if (status === 'ready') return 'Model ready';
  if (status === 'missing') return 'Model missing — relink';
  return 'No model imported';
}

export function SceneAssetControl({ assetId, assetHash, status, onImport, onApply, onClear }: SceneAssetControlProps) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importModel(files: File[]) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    const result = await onImport(files);
    if (request.current !== current) {
      return;
    }
    setLoading(false);
    if (result.ok) {
      onApply(result.assetId, result.assetHash);
    } else {
      setError(result.error);
    }
  }

  const hasAsset = assetId.length > 0 && /^[a-f0-9]{64}$/.test(assetHash);

  return (
    <div
      className="scene-asset-control nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="vector-artwork-actions">
        <span data-status={status}>{label(status, loading)}</span>
        <button
          className="icon-button"
          type="button"
          title={status === 'missing' ? 'Relink model' : 'Import model'}
          aria-label={status === 'missing' ? 'Relink model' : 'Import model'}
          disabled={loading}
          onClick={() => input.current?.click()}
        >
          <Upload size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Remove model"
          aria-label="Remove model"
          disabled={!hasAsset || loading}
          onClick={() => {
            setError(null);
            onClear();
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept={SCENE_IMPORT_ACCEPT}
        aria-label="Import 3D model asset"
        title="Select a model file (.glb, .gltf, .obj, .stl, .fbx, .3mf, .3ds, .usd/.usda/.usdc/.usdz), plus any companion files it needs"
        disabled={loading}
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) {
            void importModel(files);
          }
        }}
      />
      {error && <p className="vector-error" role="alert">{error}</p>}
    </div>
  );
}
