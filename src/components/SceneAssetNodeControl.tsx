import type { GraphParamValue } from '../graph';
import type { SceneAssetRuntime } from '../hooks/useSceneAssets';
import { SceneAssetControl } from './SceneAssetControl';

interface SceneAssetNodeControlProps {
  nodeId: string;
  params: Record<string, GraphParamValue>;
  runtime: SceneAssetRuntime;
  onParamChange: (nodeId: string, paramId: string, value: GraphParamValue) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

/** Binds the model import control to an Asset 3D node's id/hash params. */
export function SceneAssetNodeControl({
  nodeId,
  params,
  runtime,
  onParamChange,
  onGestureStart,
  onGestureEnd,
}: SceneAssetNodeControlProps) {
  const assetId = String(params.assetId ?? '');
  const assetHash = String(params.assetHash ?? '');
  const apply = (nextId: string, nextHash: string) => {
    onGestureStart();
    onParamChange(nodeId, 'assetId', nextId);
    onParamChange(nodeId, 'assetHash', nextHash);
    onGestureEnd();
  };

  return (
    <SceneAssetControl
      assetId={assetId}
      assetHash={assetHash}
      status={runtime.getStatus(assetId, assetHash)}
      onImport={runtime.importFile}
      onApply={apply}
      onClear={() => apply('', '')}
    />
  );
}
