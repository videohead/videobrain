import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SceneAssetControl } from '../src/components/SceneAssetControl';
import type { SceneAssetImportResult } from '../src/hooks/useSceneAssets';
import './catalog.css';

const HASH = 'a'.repeat(64);

function StatefulSceneAsset({ initialStatus }: { initialStatus: 'none' | 'ready' | 'missing' }) {
  const [assetId, setAssetId] = useState(initialStatus === 'none' ? '' : 'asset-demo');
  const [assetHash, setAssetHash] = useState(initialStatus === 'none' ? '' : HASH);
  const [status, setStatus] = useState(initialStatus);
  const [log, setLog] = useState('Ready');

  const onImport = async (file: File): Promise<SceneAssetImportResult> => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!file.name.endsWith('.glb') && !file.name.endsWith('.gltf')) {
      return { ok: false, error: 'Choose a .glb or .gltf model.' };
    }
    return { ok: true, assetId: 'asset-demo', assetHash: HASH };
  };

  return (
    <section className="vb-story vb-story--narrow">
      <div>
        <h1>Asset 3D import control</h1>
        <p className="vb-story-intro">
          Imports a local GLB/glTF model into durable storage, then stores its content
          identity on the node. Missing assets offer a relink affordance; the placement
          transform stays on the node parameters.
        </p>
      </div>
      <div className="vb-inline-control-frame" style={{ '--node-accent': 'var(--mint)' } as React.CSSProperties}>
        <SceneAssetControl
          assetId={assetId}
          assetHash={assetHash}
          status={status}
          onImport={onImport}
          onApply={(id, hash) => {
            setAssetId(id);
            setAssetHash(hash);
            setStatus('ready');
            setLog(`Applied ${id}`);
          }}
          onClear={() => {
            setAssetId('');
            setAssetHash('');
            setStatus('none');
            setLog('Cleared');
          }}
        />
      </div>
      <p className="vb-story-status">{log}</p>
    </section>
  );
}

const meta: Meta<typeof StatefulSceneAsset> = {
  title: 'Controls/Scene Asset Control',
  component: StatefulSceneAsset,
};

export default meta;
type Story = StoryObj<typeof StatefulSceneAsset>;

export const NoModel: Story = { args: { initialStatus: 'none' } };
export const ModelReady: Story = { args: { initialStatus: 'ready' } };
export const ModelMissing: Story = { args: { initialStatus: 'missing' } };
