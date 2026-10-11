import { createGraphNode } from './model';
import { GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge, type GraphParams, type NodeKind } from './types';

const node = (kind: NodeKind, id: string, x: number, y: number, params: GraphParams = {}) => createGraphNode(kind, { x, y }, params, id);
const wire = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
export const EVENT_PRESETS = [
  { id: 'signal-test-lab', title: 'Signal Test Lab', description: 'Inspect math, mapped and smoothed values, boolean edges, text, and chained manual bangs.' },
  { id: 'cue-logic-basics', title: 'Cue Logic Basics', description: 'Compare and gate a slow signal, then sample, latch, and count explicit events.' },
  { id: 'timed-transition-lab', title: 'Timed Transition', description: 'Drive a crossfade with timed cues, an interruptible transition, and an envelope.' },
  { id: 'step-sequence-lab', title: 'Step Sequence Lab', description: 'Sequence four frame sources and convert step events into visible control pulses.' },
] as const;

export const EVENT_PRESET_FACTORIES = {
  'signal-test-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      node('oscillator', 'wave', 0, 0, { frequency: 0.2 }),
      node('math', 'math', 340, 0, { operation: 'multiply', b: 2 }),
      node('mapRange', 'range', 680, 0, { inMax: 2, outMin: -1, outMax: 1 }),
      node('smooth', 'smooth', 1020, 0),
      node('signalNumber', 'number-test', 1360, 0, { label: 'Smoothed range', min: -1, max: 1 }),
      node('controlToBool', 'boolean', 1700, 0, { threshold: 0 }),
      node('signalEdge', 'edge-test', 2040, 0, { label: 'Leading edge' }),
      node('trigger', 'trigger', 2380, 0),
      node('signalBang', 'bang-test', 2720, 0, { label: 'Received or manual' }),
      node('signalBang', 'bang-chain', 3060, 0, { label: 'Forwarded event' }),
      node('textSource', 'caption', 0, 750, { text: 'Signal Test Lab\nMath / ranges / edges / bangs' }),
      node('signalText', 'text-test', 340, 750, { label: 'Source caption' }),
      node('text', 'text', 680, 750), node('display', 'output', 1020, 750),
    ],
    edges: [wire('wave', 'value', 'math', 'a'), wire('math', 'value', 'range', 'value'), wire('range', 'value', 'smooth', 'value'),
      wire('smooth', 'value', 'number-test', 'value'), wire('number-test', 'value', 'boolean', 'value'),
      wire('boolean', 'value', 'edge-test', 'value'), wire('edge-test', 'value', 'trigger', 'value'), wire('trigger', 'event', 'bang-test', 'value'),
      wire('bang-test', 'value', 'bang-chain', 'value'), wire('caption', 'text', 'text-test', 'value'), wire('text-test', 'value', 'text', 'text'), wire('text', 'frame', 'output', 'source')],
  }),
  'cue-logic-basics': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      node('oscillator', 'wave', 0, 0, { frequency: 0.15 }), node('compare', 'compare', 340, 0),
      node('controlToBool', 'enable', 340, 650, { value: 1 }), node('logic', 'logic', 680, 0),
      node('boolToControl', 'boolean-value', 1020, 650), node('trigger', 'edge', 1020, 0),
      node('gate', 'gate', 1360, 0), node('counter', 'counter', 1700, 0, { max: 1 }),
      node('random', 'random', 1700, 650), node('sampleHold', 'sample', 2040, 650),
      node('hold', 'hold', 2380, 650), node('solid', 'color', 2720, 0, { red: 0.2, green: 0.5, blue: 0.8 }),
      node('display', 'output', 3060, 0),
    ],
    edges: [
      wire('wave', 'value', 'compare', 'a'), wire('compare', 'value', 'logic', 'a'), wire('enable', 'value', 'logic', 'b'),
      wire('logic', 'value', 'edge', 'value'), wire('logic', 'value', 'boolean-value', 'value'),
      wire('boolean-value', 'value', 'gate', 'value'), wire('logic', 'value', 'gate', 'open'), wire('edge', 'event', 'gate', 'event'),
      wire('gate', 'event', 'counter', 'increment'), wire('gate', 'event', 'random', 'next'),
      wire('random', 'value', 'sample', 'value'), wire('gate', 'event', 'sample', 'sample'),
      wire('sample', 'value', 'hold', 'value'), wire('logic', 'value', 'hold', 'open'), wire('hold', 'value', 'color', 'blue'),
      wire('counter', 'value', 'color', 'red'), wire('gate', 'value', 'color', 'green'), wire('color', 'frame', 'output', 'source'),
    ],
  }),
  'timed-transition-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      node('cueScheduler', 'cues', 0, 0, { cues: '[{"id":"start","at":500,"value":1},{"id":"return","at":3000,"value":0},{"id":"again","at":5500,"value":1}]' }),
      node('timedTransition', 'transition', 360, 0, { duration: 1.5 }), node('timer', 'timer', 360, 650, { duration: 0.75 }),
      node('envelope', 'envelope', 720, 650, { attack: 0.4, hold: 0.25, release: 0.6, peak: 12 }),
      node('solid', 'first', 720, 0, { red: 0.95, green: 0.15, blue: 0.1 }), node('cells', 'second', 1080, 650),
      node('crossfade', 'mix', 1080, 0, { curve: 'linear' }), node('blur', 'blur', 1440, 0), node('display', 'output', 1800, 0),
    ],
    edges: [wire('cues', 'cue', 'transition', 'start'), wire('cues', 'value', 'transition', 'target'), wire('cues', 'cue', 'timer', 'start'),
      wire('timer', 'done', 'envelope', 'start'), wire('envelope', 'value', 'blur', 'radius'), wire('first', 'frame', 'mix', 'source'),
      wire('second', 'frame', 'mix', 'map'), wire('transition', 'value', 'mix', 'mix'), wire('mix', 'frame', 'blur', 'source'), wire('blur', 'frame', 'output', 'source')],
  }),
  'step-sequence-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      node('stepSequencer', 'sequence', 0, 0, { last: 3, seconds: 2, step1: 0, step2: 1, step3: 2, step4: 3 }),
      node('eventToControl', 'pulse', 360, 0, { duration: 0.4 }), node('plasma', 'field', 720, 0), node('cells', 'cells', 720, 500),
      node('gradient', 'gradient', 1080, 500), node('solid', 'solid', 1080, 1250), node('frameSwitch', 'switch', 1440, 0), node('display', 'output', 1800, 0),
    ],
    edges: [wire('sequence', 'step', 'pulse', 'event'), wire('pulse', 'value', 'field', 'energy'), wire('sequence', 'value', 'switch', 'index'),
      wire('field', 'frame', 'switch', 'a'), wire('cells', 'frame', 'switch', 'b'), wire('gradient', 'frame', 'switch', 'c'), wire('solid', 'frame', 'switch', 'd'), wire('switch', 'frame', 'output', 'source')],
  }),
};