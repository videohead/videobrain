import { WebGLRenderer } from '../../src/engine/WebGLRenderer';
import { GRAPH_SCHEMA_VERSION, createGraphNode, type GraphDocument } from '../../src/graph';

const HASH = 'a'.repeat(64);

function buildDocument(): GraphDocument {
  const wire = (source: string, sourcePort: string, target: string, targetPort: string) => ({
    id: `${source}-${sourcePort}-${target}-${targetPort}`,
    source: { nodeId: source, portId: sourcePort },
    target: { nodeId: target, portId: targetPort },
  });
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('asset3d', { x: 0, y: 0 }, { assetId: 'fixture', assetHash: HASH, scaleX: 0.25, scaleY: 0.25, scaleZ: 0.25 }, 'asset'),
      createGraphNode('instance3d', { x: 300, y: 0 }, { mode: 'grid', count: 8, spacing: 1.2 }, 'instances'),
      createGraphNode('camera3d', { x: 600, y: 300 }, { x: 0, y: 2.5, z: 5, targetX: 0, targetY: 0, targetZ: 0 }, 'camera'),
      createGraphNode('light3d', { x: 600, y: 600 }, { intensity: 4 }, 'light'),
      createGraphNode('light3d', { x: 900, y: 700 }, { mode: 'ambient', intensity: 1.2 }, 'ambient'),
      createGraphNode('render3d', { x: 900, y: 0 }, {}, 'render'),
      createGraphNode('display', { x: 1200, y: 0 }, {}, 'output'),
    ],
    edges: [
      wire('asset', 'assetScene', 'instances', 'assetScene'),
      wire('instances', 'assetScene', 'render', 'assetScene'),
      wire('camera', 'camera', 'render', 'camera'),
      wire('light', 'light', 'render', 'light'),
      wire('ambient', 'light', 'render', 'light2'),
      wire('render', 'frame', 'output', 'source'),
    ],
  };
}

async function run(byteValues: number[]): Promise<{
  visible: number;
  instancedDrawCalls: number;
  instances: number;
  diagnostics: string[];
  error: string | null;
}> {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('Fixture canvas missing.');
  canvas.width = 128;
  canvas.height = 128;

  const renderer = new WebGLRenderer(canvas, { width: 128, height: 128, pixelRatio: 1 });
  renderer.setGraph(buildDocument());

  const bytes = new Uint8Array(byteValues);
  const load = await renderer.loadSceneAsset(HASH, bytes);
  if (!load.ok) {
    renderer.dispose();
    return { visible: 0, instancedDrawCalls: 0, instances: 0, diagnostics: [], error: load.error };
  }

  const outcome = renderer.render(0);
  const report = renderer.getLastBatchReport();

  const readback = document.createElement('canvas');
  readback.width = 128;
  readback.height = 128;
  const ctx = readback.getContext('2d');
  if (!ctx) throw new Error('2D readback context unavailable.');
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, 128, 128).data;

  let visible = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 16) visible += 1;
  }

  const result = {
    visible,
    instancedDrawCalls: report?.instancedDrawCalls ?? 0,
    instances: report?.instances ?? 0,
    diagnostics: [...(report?.diagnostics ?? [])],
    error: outcome.error,
  };
  renderer.dispose();
  return result;
}

Reflect.set(globalThis, 'runSceneInstanceFixture', run);
