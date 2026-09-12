import { createGraphNode } from './model';
import { GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge } from './types';

const edge = (
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): GraphEdge => ({
  id,
  source: { nodeId: sourceNodeId, portId: sourcePortId },
  target: { nodeId: targetNodeId, portId: targetPortId },
});

export function createDefaultGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('audioLevel', { x: -540, y: -410 }, {}, 'audio'),
      createGraphNode('time', { x: -540, y: -240 }, {}, 'clock'),
      createGraphNode('beatClock', { x: -300, y: -410 }, {}, 'beat'),
      createGraphNode(
        'oscillator',
        { x: -300, y: -240 },
        { frequency: 1 },
        'pulse',
      ),
      createGraphNode('pointer', { x: 110, y: 280 }, {}, 'pointer'),
      createGraphNode('xyPad', { x: 420, y: -260 }, {}, 'pad'),
      createGraphNode('aiPrompt', { x: 420, y: 290 }, {}, 'prompt'),
      createGraphNode('plasma', { x: -540, y: 20 }, {}, 'field'),
      createGraphNode('cells', { x: -540, y: 208 }, {}, 'cells'),
      createGraphNode('warp', { x: -300, y: 208 }, {}, 'warp'),
      createGraphNode('blend', { x: -60, y: 70 }, {}, 'blend'),
      createGraphNode('trails', { x: 180, y: 70 }, {}, 'trails'),
      createGraphNode('colorGrade', { x: 420, y: 70 }, {}, 'grade'),
      createGraphNode('videoModel', { x: 660, y: 70 }, {}, 'model'),
      createGraphNode('display', { x: 900, y: 70 }, {}, 'display'),
    ],
    edges: [
      edge('clock-beat', 'clock', 'value', 'beat', 'time'),
      edge('beat-pulse', 'beat', 'phase', 'pulse', 'phase'),
      edge('clock-field', 'clock', 'value', 'field', 'time'),
      edge('audio-field', 'audio', 'value', 'field', 'energy'),
      edge('clock-cells', 'clock', 'value', 'cells', 'time'),
      edge('pulse-warp', 'pulse', 'value', 'warp', 'amount'),
      edge('cells-warp', 'cells', 'frame', 'warp', 'source'),
      edge('field-blend', 'field', 'frame', 'blend', 'a'),
      edge('warp-blend', 'warp', 'frame', 'blend', 'b'),
      edge('pulse-blend', 'pulse', 'value', 'blend', 'mix'),
      edge('blend-trails', 'blend', 'frame', 'trails', 'source'),
      edge('trails-grade', 'trails', 'frame', 'grade', 'source'),
      edge('pad-grade-hue', 'pad', 'x', 'grade', 'hue'),
      edge('pad-grade-exposure', 'pad', 'y', 'grade', 'exposure'),
      edge('pointer-grade-saturation', 'pointer', 'y', 'grade', 'saturation'),
      edge('grade-model', 'grade', 'frame', 'model', 'source'),
      edge('prompt-model', 'prompt', 'prompt', 'model', 'prompt'),
      edge('model-display', 'model', 'frame', 'display', 'source'),
    ],
  };
}

export const DEFAULT_GRAPH: GraphDocument = createDefaultGraph();
