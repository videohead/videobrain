import { createGraphNode } from './model';
import { GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge } from './types';

const wire = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });

export const FRAME_EFFECT_PRESETS = [
  { id: 'prism-glow-lab', title: 'Prism & Glow Lab', description: 'Split RGB channels, bloom bright regions, and add scanlines.' },
  { id: 'liquid-surface-lab', title: 'Liquid Surface Lab', description: 'Move the pointer to attract colliding metaballs over a morphing texture.' },
  { id: 'particle-transition-lab', title: 'Particle Transition Lab', description: 'Scrub or animate 4,096 instanced texture tiles between two frames.' },
  { id: 'infinity-mirror-lab', title: 'Infinity Mirror Lab', description: 'Feed a mirrored frame through retained spiral feedback to form a tunnel.' },
] as const;

export const FRAME_EFFECT_PRESET_FACTORIES = {
  'prism-glow-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('plasma', { x: 0, y: 0 }, {}, 'source'),
      createGraphNode('chromaticAberration', { x: 370, y: 0 }, {}, 'prism'),
      createGraphNode('bloom', { x: 740, y: 0 }, {}, 'glow'),
      createGraphNode('scanlines', { x: 1110, y: 0 }, {}, 'scan'),
      createGraphNode('display', { x: 1480, y: 0 }, {}, 'output'),
    ], edges: [wire('source', 'frame', 'prism', 'source'), wire('prism', 'frame', 'glow', 'source'), wire('glow', 'frame', 'scan', 'source'), wire('scan', 'frame', 'output', 'source')],
  }),
  'liquid-surface-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('gradient', { x: 0, y: 0 }, {}, 'source'),
      createGraphNode('cells', { x: 0, y: 1400 }, {}, 'other'),
      createGraphNode('oscillator', { x: 370, y: 1400 }, { frequency: 0.06 }, 'motion'),
      createGraphNode('liquidMorph', { x: 740, y: 0 }, {}, 'morph'),
      createGraphNode('pointer', { x: 740, y: 1400 }, {}, 'pointer'),
      createGraphNode('liquidMetaballs', { x: 1110, y: 0 }, {}, 'liquid'),
      createGraphNode('display', { x: 1480, y: 0 }, {}, 'output'),
    ], edges: [wire('source', 'frame', 'morph', 'source'), wire('other', 'frame', 'morph', 'map'), wire('motion', 'value', 'morph', 'mix'), wire('morph', 'frame', 'liquid', 'source'), wire('pointer', 'x', 'liquid', 'pointerX'), wire('pointer', 'y', 'liquid', 'pointerY'), wire('liquid', 'frame', 'output', 'source')],
  }),
  'particle-transition-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('gradient', { x: 0, y: 0 }, {}, 'source'),
      createGraphNode('cells', { x: 370, y: 0 }, {}, 'other'),
      createGraphNode('oscillator', { x: 370, y: 900 }, { waveform: 'triangle', frequency: 0.05 }, 'motion'),
      createGraphNode('particleTransition', { x: 740, y: 0 }, {}, 'particles'),
      createGraphNode('display', { x: 1110, y: 0 }, {}, 'output'),
    ], edges: [wire('source', 'frame', 'particles', 'source'), wire('other', 'frame', 'particles', 'map'), wire('motion', 'value', 'particles', 'mix'), wire('particles', 'frame', 'output', 'source')],
  }),
  'infinity-mirror-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('shape', { x: 0, y: 0 }, { primitive: 'star', width: 0.6, height: 0.6 }, 'source'),
      createGraphNode('kaleidoscope', { x: 370, y: 0 }, { mode: 'mirror', repeatX: 2, repeatY: 2 }, 'mirror'),
      createGraphNode('feedbackSpiral', { x: 740, y: 0 }, { zoom: 1.35, rotation: 12, feedback: 0.94 }, 'portal'),
      createGraphNode('chromaticAberration', { x: 1110, y: 0 }, { amount: 0.035, distortion: 0 }, 'prism'),
      createGraphNode('display', { x: 1480, y: 0 }, {}, 'output'),
    ], edges: [wire('source', 'frame', 'mirror', 'source'), wire('mirror', 'frame', 'portal', 'source'), wire('portal', 'frame', 'prism', 'source'), wire('prism', 'frame', 'output', 'source')],
  }),
};