import { createDefaultGraph } from './defaultGraph';
import { createGraphNode } from './model';
import {
  GRAPH_SCHEMA_VERSION,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from './types';

export const GRAPH_PRESETS = [
  {
    id: 'blank',
    title: 'Blank Canvas',
    description: 'An empty graph ready for your own nodes.',
  },
  {
    id: 'full-studio',
    title: 'Full Studio',
    description: 'A broad built-in tour of signals, visuals, and models.',
  },
  {
    id: 'beat-color',
    title: 'Beat-Synced Color',
    description: 'Tempo, oscillator, warp, and trails in one rhythmic visual.',
  },
  {
    id: 'spiral-feedback-lab',
    title: 'Spiral Feedback Lab',
    description: 'Rotate and zoom retained frames into a vivid recursive spiral.',
  },
  {
    id: 'two-world-mixer',
    title: 'Two-World Mixer',
    description: 'Blend Flow Field and Cells with an animated mix control.',
  },
  {
    id: 'control-math',
    title: 'Control Math',
    description: 'Constant × Oscillator → Math → Map Range drives a two-source mix.',
  },
  {
    id: 'smooth-pointer',
    title: 'Smooth Pointer',
    description: 'Map and smooth pointer motion before it moves a Transform 2D.',
  },
  {
    id: 'transform-playground',
    title: 'Transform Playground',
    description: 'Use XY Pad, mapped rotation, and scale to explore Transform 2D.',
  },
  {
    id: 'mask-composite-lab',
    title: 'Mask & Composite Lab',
    description: 'Build a soft animated matte, apply it, and layer the result over color.',
  },
  {
    id: 'beat-switcher',
    title: 'Beat Switcher',
    description: 'Step through four visual sources over each tempo-locked bar.',
  },
  {
    id: 'live-cut-lab',
    title: 'Live Cut Lab',
    description:
      'Shuffle four sources with a slow Strobe accent (flashing imagery).',
  },
  {
    id: 'audio-soft-focus',
    title: 'Audio Soft Focus',
    description: 'Map demo or microphone energy into a clearly visible blur radius.',
  },
  {
    id: 'pointer-bend',
    title: 'Pointer Bend',
    description: 'Move and click over the monitor to shape a flowing image.',
  },
  {
    id: 'mic-pulse-trails',
    title: 'Mic Pulse Trails',
    description: 'Audio energy drives color and feedback, with a demo pulse fallback.',
  },
  {
    id: 'camera-dream',
    title: 'Camera Dream',
    description: 'Mix an opt-in camera with a visible procedural fallback.',
  },
  {
    id: 'prompted-preview',
    title: 'Prompted Visual Preview',
    description: 'A ready-to-connect prompt and model preview frame path.',
  },
  {
    id: 'file-preview',
    title: 'Local File Preview',
    description: 'Display an image or video selected from this browser session.',
  },
] as const;

export type GraphPresetId = (typeof GRAPH_PRESETS)[number]['id'];
export type GraphPreset = (typeof GRAPH_PRESETS)[number];

export const FOUNDATION_NODE_EXAMPLES = {
  constant: ['control-math', 'transform-playground'],
  math: ['control-math'],
  mapRange: ['control-math', 'smooth-pointer', 'transform-playground'],
  smooth: ['smooth-pointer'],
  transform2d: ['smooth-pointer', 'transform-playground'],
} as const satisfies Record<
  'constant' | 'math' | 'mapRange' | 'smooth' | 'transform2d',
  readonly GraphPresetId[]
>;

export const NODE_EXAMPLES = {
  ...FOUNDATION_NODE_EXAMPLES,
  solid: ['mask-composite-lab'],
  threshold: ['mask-composite-lab'],
  mask: ['mask-composite-lab'],
  composite: ['mask-composite-lab'],
  frameSwitch: ['beat-switcher'],
  blur: ['audio-soft-focus'],
  feedbackSpiral: ['spiral-feedback-lab'],
  autoSelector: ['live-cut-lab'],
  strobe: ['live-cut-lab'],
  file: ['file-preview'],
  audioOutput: ['file-preview'],
  audioMixer: ['file-preview'],
} as const satisfies Record<
  | 'constant'
  | 'math'
  | 'mapRange'
  | 'smooth'
  | 'transform2d'
  | 'solid'
  | 'threshold'
  | 'mask'
  | 'composite'
  | 'frameSwitch'
  | 'blur'
  | 'feedbackSpiral'
  | 'autoSelector'
  | 'strobe'
  | 'file'
  | 'audioOutput'
  | 'audioMixer',
  readonly GraphPresetId[]
>;

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

function graph(nodes: GraphNode[], edges: GraphEdge[]): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
  };
}

function createBlankGraph(): GraphDocument {
  return graph([], []);
}

function createFilePreviewGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('file', { x: -240, y: 0 }, {}, 'file-input'),
      createGraphNode('audioMixer', { x: -40, y: 180 }, {}, 'file-mixer'),
      createGraphNode('display', { x: 120, y: 0 }, {}, 'file-display'),
      createGraphNode('audioOutput', { x: 120, y: 180 }, {}, 'file-audio'),
    ],
    [
      edge('file-display', 'file-input', 'frame', 'file-display', 'source'),
      edge('file-mixer', 'file-input', 'audio', 'file-mixer', 'source1'),
      edge('file-audio', 'file-mixer', 'audio', 'file-audio', 'audio'),
    ],
  );
}

function createBeatColorGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -540, y: -180 }, {}, 'beat-time'),
      createGraphNode(
        'beatClock',
        { x: -300, y: -260 },
        { bpm: 124, pulseWidth: 0.18 },
        'beat-clock',
      ),
      createGraphNode(
        'oscillator',
        { x: -300, y: -40 },
        { frequency: 1, waveform: 'triangle', amplitude: 0.8 },
        'beat-wave',
      ),
      createGraphNode(
        'plasma',
        { x: -60, y: -180 },
        { scale: 4.2, speed: 0.5, hue: 0.12 },
        'beat-field',
      ),
      createGraphNode(
        'warp',
        { x: 180, y: -180 },
        { amount: 0.4, frequency: 8, speed: 0.32 },
        'beat-warp',
      ),
      createGraphNode(
        'trails',
        { x: 420, y: -180 },
        { feedback: 0.82 },
        'beat-trails',
      ),
      createGraphNode('display', { x: 660, y: -180 }, {}, 'beat-display'),
    ],
    [
      edge('beat-time-clock', 'beat-time', 'value', 'beat-clock', 'time'),
      edge('beat-clock-wave', 'beat-clock', 'phase', 'beat-wave', 'phase'),
      edge('beat-time-field', 'beat-time', 'value', 'beat-field', 'time'),
      edge('beat-wave-field', 'beat-wave', 'value', 'beat-field', 'energy'),
      edge('beat-field-warp', 'beat-field', 'frame', 'beat-warp', 'source'),
      edge('beat-clock-warp', 'beat-clock', 'beat', 'beat-warp', 'amount'),
      edge('beat-warp-trails', 'beat-warp', 'frame', 'beat-trails', 'source'),
      edge(
        'beat-trails-display',
        'beat-trails',
        'frame',
        'beat-display',
        'source',
      ),
    ],
  );
}

function createSpiralFeedbackLabGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -720, y: -280 }, {}, 'spiral-lab-time'),
      createGraphNode(
        'cells',
        { x: -450, y: -180 },
        { scale: 9.2, speed: -0.14, contrast: 2.3 },
        'spiral-lab-cells',
      ),
      createGraphNode(
        'xyPad',
        { x: -450, y: 150 },
        { x: 0.46, y: 0.54 },
        'spiral-lab-center',
      ),
      createGraphNode(
        'feedbackSpiral',
        { x: -120, y: -100 },
        {
          feedback: 0.82,
          rotation: 42,
          zoom: 1.16,
          centerX: 0.46,
          centerY: 0.54,
        },
        'spiral-lab-feedback',
      ),
      createGraphNode(
        'colorGrade',
        { x: 220, y: -100 },
        { hue: 0.08, exposure: 0.08, contrast: 1.24, saturation: 1.55 },
        'spiral-lab-grade',
      ),
      createGraphNode(
        'display',
        { x: 520, y: -100 },
        {},
        'spiral-lab-display',
      ),
    ],
    [
      edge('spiral-lab-time-cells', 'spiral-lab-time', 'value', 'spiral-lab-cells', 'time'),
      edge('spiral-lab-cells-feedback', 'spiral-lab-cells', 'frame', 'spiral-lab-feedback', 'source'),
      edge('spiral-lab-center-x', 'spiral-lab-center', 'x', 'spiral-lab-feedback', 'centerX'),
      edge('spiral-lab-center-y', 'spiral-lab-center', 'y', 'spiral-lab-feedback', 'centerY'),
      edge('spiral-lab-feedback-grade', 'spiral-lab-feedback', 'frame', 'spiral-lab-grade', 'source'),
      edge('spiral-lab-grade-display', 'spiral-lab-grade', 'frame', 'spiral-lab-display', 'source'),
    ],
  );
}

function createTwoWorldMixerGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -500, y: -260 }, {}, 'mixer-time'),
      createGraphNode(
        'oscillator',
        { x: -260, y: -260 },
        { frequency: 0.08, amplitude: 1, offset: 0 },
        'mixer-wave',
      ),
      createGraphNode(
        'plasma',
        { x: -500, y: 20 },
        { scale: 5.8, hue: -0.08 },
        'mixer-field',
      ),
      createGraphNode(
        'cells',
        { x: -260, y: 20 },
        { scale: 9.5, contrast: 1.8 },
        'mixer-cells',
      ),
      createGraphNode(
        'blend',
        { x: 0, y: 20 },
        { mode: 'normal', mix: 0.5 },
        'mixer-blend',
      ),
      createGraphNode(
        'colorGrade',
        { x: 260, y: 20 },
        { saturation: 1.45, contrast: 1.2 },
        'mixer-grade',
      ),
      createGraphNode('display', { x: 520, y: 20 }, {}, 'mixer-display'),
    ],
    [
      edge('mixer-time-wave', 'mixer-time', 'value', 'mixer-wave', 'phase'),
      edge('mixer-time-field', 'mixer-time', 'value', 'mixer-field', 'time'),
      edge('mixer-time-cells', 'mixer-time', 'value', 'mixer-cells', 'time'),
      edge('mixer-field-blend', 'mixer-field', 'frame', 'mixer-blend', 'a'),
      edge('mixer-cells-blend', 'mixer-cells', 'frame', 'mixer-blend', 'b'),
      edge('mixer-wave-blend', 'mixer-wave', 'value', 'mixer-blend', 'mix'),
      edge('mixer-blend-grade', 'mixer-blend', 'frame', 'mixer-grade', 'source'),
      edge(
        'mixer-grade-display',
        'mixer-grade',
        'frame',
        'mixer-display',
        'source',
      ),
    ],
  );
}

function createControlMathGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -720, y: -260 }, {}, 'control-math-time'),
      createGraphNode(
        'oscillator',
        { x: -470, y: -280 },
        { frequency: 0.12, waveform: 'sine', amplitude: 1, offset: 0 },
        'control-math-wave',
      ),
      createGraphNode(
        'constant',
        { x: -470, y: -30 },
        { value: 0.72 },
        'control-math-constant',
      ),
      createGraphNode(
        'math',
        { x: -210, y: -170 },
        { operation: 'multiply' },
        'control-math-multiply',
      ),
      createGraphNode(
        'mapRange',
        { x: 40, y: -170 },
        {
          inMin: 0,
          inMax: 0.72,
          outMin: 0,
          outMax: 1,
          boundary: 'clamp',
        },
        'control-math-map',
      ),
      createGraphNode(
        'plasma',
        { x: -210, y: 120 },
        { scale: 5.2, speed: 0.25, hue: -0.12 },
        'control-math-field',
      ),
      createGraphNode(
        'cells',
        { x: 40, y: 120 },
        { scale: 8.8, speed: 0.34, contrast: 1.6 },
        'control-math-cells',
      ),
      createGraphNode(
        'blend',
        { x: 300, y: 90 },
        { mode: 'normal', mix: 0.5 },
        'control-math-blend',
      ),
      createGraphNode(
        'colorGrade',
        { x: 560, y: 90 },
        { saturation: 1.35, contrast: 1.12 },
        'control-math-grade',
      ),
      createGraphNode('display', { x: 820, y: 90 }, {}, 'control-math-display'),
    ],
    [
      edge('control-math-time-wave', 'control-math-time', 'value', 'control-math-wave', 'phase'),
      edge('control-math-wave-a', 'control-math-wave', 'value', 'control-math-multiply', 'a'),
      edge('control-math-constant-b', 'control-math-constant', 'value', 'control-math-multiply', 'b'),
      edge('control-math-result-map', 'control-math-multiply', 'value', 'control-math-map', 'value'),
      edge('control-math-map-mix', 'control-math-map', 'value', 'control-math-blend', 'mix'),
      edge('control-math-time-field', 'control-math-time', 'value', 'control-math-field', 'time'),
      edge('control-math-time-cells', 'control-math-time', 'value', 'control-math-cells', 'time'),
      edge('control-math-field-blend', 'control-math-field', 'frame', 'control-math-blend', 'a'),
      edge('control-math-cells-blend', 'control-math-cells', 'frame', 'control-math-blend', 'b'),
      edge('control-math-blend-grade', 'control-math-blend', 'frame', 'control-math-grade', 'source'),
      edge('control-math-grade-display', 'control-math-grade', 'frame', 'control-math-display', 'source'),
    ],
  );
}

function createSmoothPointerGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -620, y: -260 }, {}, 'smooth-pointer-time'),
      createGraphNode('pointer', { x: -620, y: 130 }, {}, 'smooth-pointer-input'),
      createGraphNode(
        'mapRange',
        { x: -340, y: 150 },
        { inMin: 0, inMax: 1, outMin: -0.72, outMax: 0.72, boundary: 'clamp' },
        'smooth-pointer-map',
      ),
      createGraphNode(
        'smooth',
        { x: -70, y: 150 },
        { rise: 0.18, fall: 0.35, initial: 0 },
        'smooth-pointer-slew',
      ),
      createGraphNode(
        'plasma',
        { x: -340, y: -170 },
        { scale: 5.8, speed: 0.24, hue: 0.08 },
        'smooth-pointer-field',
      ),
      createGraphNode(
        'transform2d',
        { x: 220, y: -90 },
        { scale: 1.12, edgeMode: 'mirror' },
        'smooth-pointer-transform',
      ),
      createGraphNode(
        'colorGrade',
        { x: 500, y: -90 },
        { saturation: 1.3, contrast: 1.14 },
        'smooth-pointer-grade',
      ),
      createGraphNode('display', { x: 770, y: -90 }, {}, 'smooth-pointer-display'),
    ],
    [
      edge('smooth-pointer-time-field', 'smooth-pointer-time', 'value', 'smooth-pointer-field', 'time'),
      edge('smooth-pointer-x-map', 'smooth-pointer-input', 'x', 'smooth-pointer-map', 'value'),
      edge('smooth-pointer-map-slew', 'smooth-pointer-map', 'value', 'smooth-pointer-slew', 'value'),
      edge('smooth-pointer-slew-transform', 'smooth-pointer-slew', 'value', 'smooth-pointer-transform', 'x'),
      edge('smooth-pointer-field-transform', 'smooth-pointer-field', 'frame', 'smooth-pointer-transform', 'source'),
      edge('smooth-pointer-transform-grade', 'smooth-pointer-transform', 'frame', 'smooth-pointer-grade', 'source'),
      edge('smooth-pointer-grade-display', 'smooth-pointer-grade', 'frame', 'smooth-pointer-display', 'source'),
    ],
  );
}

function createTransformPlaygroundGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -760, y: -300 }, {}, 'transform-play-time'),
      createGraphNode(
        'oscillator',
        { x: -500, y: -320 },
        { frequency: 0.06, waveform: 'sine', amplitude: 1, offset: 0 },
        'transform-play-wave',
      ),
      createGraphNode(
        'mapRange',
        { x: -230, y: -300 },
        { inMin: 0, inMax: 1, outMin: -35, outMax: 35, boundary: 'clamp' },
        'transform-play-rotation',
      ),
      createGraphNode(
        'xyPad',
        { x: -760, y: 40 },
        { x: 0.5, y: 0.5 },
        'transform-play-pad',
      ),
      createGraphNode(
        'mapRange',
        { x: -500, y: 20 },
        { inMin: 0, inMax: 1, outMin: -0.55, outMax: 0.55, boundary: 'clamp' },
        'transform-play-map-x',
      ),
      createGraphNode(
        'mapRange',
        { x: -500, y: 260 },
        { inMin: 0, inMax: 1, outMin: -0.55, outMax: 0.55, boundary: 'clamp' },
        'transform-play-map-y',
      ),
      createGraphNode(
        'constant',
        { x: -230, y: 260 },
        { value: 1.12 },
        'transform-play-scale',
      ),
      createGraphNode(
        'plasma',
        { x: -230, y: -20 },
        { scale: 4.8, speed: 0.28, hue: -0.16 },
        'transform-play-field',
      ),
      createGraphNode(
        'transform2d',
        { x: 70, y: -20 },
        { edgeMode: 'mirror' },
        'transform-play-transform',
      ),
      createGraphNode('display', { x: 380, y: -20 }, {}, 'transform-play-display'),
    ],
    [
      edge('transform-play-time-wave', 'transform-play-time', 'value', 'transform-play-wave', 'phase'),
      edge('transform-play-wave-rotation', 'transform-play-wave', 'value', 'transform-play-rotation', 'value'),
      edge('transform-play-time-field', 'transform-play-time', 'value', 'transform-play-field', 'time'),
      edge('transform-play-pad-map-x', 'transform-play-pad', 'x', 'transform-play-map-x', 'value'),
      edge('transform-play-pad-map-y', 'transform-play-pad', 'y', 'transform-play-map-y', 'value'),
      edge('transform-play-map-x-transform', 'transform-play-map-x', 'value', 'transform-play-transform', 'x'),
      edge('transform-play-map-y-transform', 'transform-play-map-y', 'value', 'transform-play-transform', 'y'),
      edge('transform-play-rotation-transform', 'transform-play-rotation', 'value', 'transform-play-transform', 'rotation'),
      edge('transform-play-scale-transform', 'transform-play-scale', 'value', 'transform-play-transform', 'scale'),
      edge('transform-play-field-transform', 'transform-play-field', 'frame', 'transform-play-transform', 'source'),
      edge('transform-play-transform-display', 'transform-play-transform', 'frame', 'transform-play-display', 'source'),
    ],
  );
}

function createMaskCompositeLabGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -820, y: -260 }, {}, 'mask-lab-time'),
      createGraphNode(
        'solid',
        { x: -540, y: -460 },
        { red: 0.035, green: 0.02, blue: 0.12, alpha: 1 },
        'mask-lab-background',
      ),
      createGraphNode(
        'plasma',
        { x: -540, y: -160 },
        { scale: 4.2, speed: 0.2, energy: 0.48, hue: 0.16 },
        'mask-lab-source',
      ),
      createGraphNode(
        'cells',
        { x: -540, y: 180 },
        { scale: 7.6, speed: 0.13, contrast: 1.8 },
        'mask-lab-matte-source',
      ),
      createGraphNode(
        'threshold',
        { x: -260, y: 180 },
        { channel: 'luminance', level: 0.5, softness: 0.12, invert: 'off' },
        'mask-lab-threshold',
      ),
      createGraphNode(
        'mask',
        { x: 20, y: -80 },
        { channel: 'luminance', amount: 1, invert: 'off' },
        'mask-lab-mask',
      ),
      createGraphNode(
        'composite',
        { x: 300, y: -220 },
        { operation: 'sourceOver', opacity: 0.94 },
        'mask-lab-composite',
      ),
      createGraphNode(
        'display',
        { x: 600, y: -220 },
        {},
        'mask-lab-display',
      ),
    ],
    [
      edge('mask-lab-time-source', 'mask-lab-time', 'value', 'mask-lab-source', 'time'),
      edge('mask-lab-time-matte', 'mask-lab-time', 'value', 'mask-lab-matte-source', 'time'),
      edge('mask-lab-matte-threshold', 'mask-lab-matte-source', 'frame', 'mask-lab-threshold', 'source'),
      edge('mask-lab-source-mask', 'mask-lab-source', 'frame', 'mask-lab-mask', 'source'),
      edge('mask-lab-threshold-mask', 'mask-lab-threshold', 'frame', 'mask-lab-mask', 'mask'),
      edge('mask-lab-background-composite', 'mask-lab-background', 'frame', 'mask-lab-composite', 'background'),
      edge('mask-lab-mask-composite', 'mask-lab-mask', 'frame', 'mask-lab-composite', 'foreground'),
      edge('mask-lab-composite-display', 'mask-lab-composite', 'frame', 'mask-lab-display', 'source'),
    ],
  );
}

function createBeatSwitcherGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -820, y: -420 }, {}, 'beat-switch-time'),
      createGraphNode(
        'beatClock',
        { x: -540, y: -440 },
        { bpm: 120, beatsPerBar: 4, pulseWidth: 0.12, offset: 0 },
        'beat-switch-clock',
      ),
      createGraphNode(
        'mapRange',
        { x: -260, y: -440 },
        { inMin: 0, inMax: 1, outMin: -0.5, outMax: 3.5, boundary: 'clamp' },
        'beat-switch-map',
      ),
      createGraphNode(
        'plasma',
        { x: -540, y: -160 },
        { scale: 3.2, speed: 0.18, energy: 0.42, hue: -0.32 },
        'beat-switch-a',
      ),
      createGraphNode(
        'cells',
        { x: -540, y: 80 },
        { scale: 5.4, speed: -0.16, contrast: 2.3 },
        'beat-switch-b',
      ),
      createGraphNode(
        'plasma',
        { x: -260, y: -160 },
        { scale: 8.2, speed: -0.28, energy: 0.72, hue: 0.34 },
        'beat-switch-c',
      ),
      createGraphNode(
        'cells',
        { x: -260, y: 80 },
        { scale: 15.5, speed: 0.34, contrast: 1.45 },
        'beat-switch-d',
      ),
      createGraphNode(
        'frameSwitch',
        { x: 60, y: -100 },
        { index: 0 },
        'beat-switch-router',
      ),
      createGraphNode(
        'display',
        { x: 370, y: -100 },
        {},
        'beat-switch-display',
      ),
    ],
    [
      edge('beat-switch-time-clock', 'beat-switch-time', 'value', 'beat-switch-clock', 'time'),
      edge('beat-switch-clock-map', 'beat-switch-clock', 'bar', 'beat-switch-map', 'value'),
      edge('beat-switch-map-router', 'beat-switch-map', 'value', 'beat-switch-router', 'index'),
      edge('beat-switch-time-a', 'beat-switch-time', 'value', 'beat-switch-a', 'time'),
      edge('beat-switch-time-b', 'beat-switch-time', 'value', 'beat-switch-b', 'time'),
      edge('beat-switch-time-c', 'beat-switch-time', 'value', 'beat-switch-c', 'time'),
      edge('beat-switch-time-d', 'beat-switch-time', 'value', 'beat-switch-d', 'time'),
      edge('beat-switch-a-router', 'beat-switch-a', 'frame', 'beat-switch-router', 'a'),
      edge('beat-switch-b-router', 'beat-switch-b', 'frame', 'beat-switch-router', 'b'),
      edge('beat-switch-c-router', 'beat-switch-c', 'frame', 'beat-switch-router', 'c'),
      edge('beat-switch-d-router', 'beat-switch-d', 'frame', 'beat-switch-router', 'd'),
      edge('beat-switch-router-display', 'beat-switch-router', 'frame', 'beat-switch-display', 'source'),
    ],
  );
}

function createLiveCutLabGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -980, y: -440 }, {}, 'live-cut-time'),
      createGraphNode(
        'autoSelector',
        { x: -700, y: -440 },
        { interval: 1.5, count: 4, order: 'shuffleBag', seed: 23 },
        'live-cut-selector',
      ),
      createGraphNode(
        'plasma',
        { x: -700, y: -170 },
        { scale: 3.1, speed: 0.22, energy: 0.42, hue: -0.34 },
        'live-cut-a',
      ),
      createGraphNode(
        'cells',
        { x: -700, y: 100 },
        { scale: 5.6, speed: -0.16, contrast: 2.35 },
        'live-cut-b',
      ),
      createGraphNode(
        'solid',
        { x: -410, y: -170 },
        { red: 0.94, green: 0.08, blue: 0.34, alpha: 1 },
        'live-cut-c',
      ),
      createGraphNode(
        'plasma',
        { x: -410, y: 100 },
        { scale: 9.4, speed: -0.31, energy: 0.78, hue: 0.34 },
        'live-cut-d',
      ),
      createGraphNode(
        'frameSwitch',
        { x: -90, y: -90 },
        { index: 0 },
        'live-cut-switch',
      ),
      createGraphNode(
        'strobe',
        { x: 230, y: -90 },
        { rate: 0.67, duty: 0.82, amount: 0.55, closedMode: 'invert' },
        'live-cut-strobe',
      ),
      createGraphNode(
        'colorGrade',
        { x: 540, y: -90 },
        { hue: 0.02, exposure: 0, contrast: 1.12, saturation: 1.3 },
        'live-cut-grade',
      ),
      createGraphNode(
        'display',
        { x: 840, y: -90 },
        {},
        'live-cut-display',
      ),
    ],
    [
      edge('live-cut-time-selector', 'live-cut-time', 'value', 'live-cut-selector', 'position'),
      edge('live-cut-time-a', 'live-cut-time', 'value', 'live-cut-a', 'time'),
      edge('live-cut-time-b', 'live-cut-time', 'value', 'live-cut-b', 'time'),
      edge('live-cut-time-d', 'live-cut-time', 'value', 'live-cut-d', 'time'),
      edge('live-cut-a-switch', 'live-cut-a', 'frame', 'live-cut-switch', 'a'),
      edge('live-cut-b-switch', 'live-cut-b', 'frame', 'live-cut-switch', 'b'),
      edge('live-cut-c-switch', 'live-cut-c', 'frame', 'live-cut-switch', 'c'),
      edge('live-cut-d-switch', 'live-cut-d', 'frame', 'live-cut-switch', 'd'),
      edge('live-cut-selector-switch', 'live-cut-selector', 'index', 'live-cut-switch', 'index'),
      edge('live-cut-selector-strobe', 'live-cut-selector', 'phase', 'live-cut-strobe', 'phase'),
      edge('live-cut-switch-strobe', 'live-cut-switch', 'frame', 'live-cut-strobe', 'source'),
      edge('live-cut-strobe-grade', 'live-cut-strobe', 'frame', 'live-cut-grade', 'source'),
      edge('live-cut-grade-display', 'live-cut-grade', 'frame', 'live-cut-display', 'source'),
    ],
  );
}

function createAudioSoftFocusGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -620, y: -260 }, {}, 'soft-focus-time'),
      createGraphNode(
        'audioLevel',
        { x: -620, y: 120 },
        { gain: 2.4, floor: 0.025 },
        'soft-focus-audio',
      ),
      createGraphNode(
        'mapRange',
        { x: -330, y: 120 },
        { inMin: 0, inMax: 1, outMin: 0, outMax: 18, boundary: 'clamp' },
        'soft-focus-map',
      ),
      createGraphNode(
        'plasma',
        { x: -330, y: -180 },
        { scale: 7.4, speed: 0.22, energy: 0.5, hue: -0.08 },
        'soft-focus-field',
      ),
      createGraphNode(
        'blur',
        { x: -20, y: -120 },
        { radius: 4 },
        'soft-focus-blur',
      ),
      createGraphNode(
        'display',
        { x: 290, y: -120 },
        {},
        'soft-focus-display',
      ),
    ],
    [
      edge('soft-focus-time-field', 'soft-focus-time', 'value', 'soft-focus-field', 'time'),
      edge('soft-focus-audio-map', 'soft-focus-audio', 'value', 'soft-focus-map', 'value'),
      edge('soft-focus-map-blur', 'soft-focus-map', 'value', 'soft-focus-blur', 'radius'),
      edge('soft-focus-field-blur', 'soft-focus-field', 'frame', 'soft-focus-blur', 'source'),
      edge('soft-focus-blur-display', 'soft-focus-blur', 'frame', 'soft-focus-display', 'source'),
    ],
  );
}

function createPointerBendGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -500, y: -220 }, {}, 'pointer-time'),
      createGraphNode('pointer', { x: -500, y: 80 }, {}, 'pointer-input'),
      createGraphNode(
        'plasma',
        { x: -240, y: -120 },
        { scale: 6.5, speed: 0.22 },
        'pointer-field',
      ),
      createGraphNode(
        'warp',
        { x: 20, y: -120 },
        { frequency: 10, speed: 0.45 },
        'pointer-warp',
      ),
      createGraphNode(
        'colorGrade',
        { x: 280, y: -120 },
        { saturation: 1.35 },
        'pointer-grade',
      ),
      createGraphNode('display', { x: 540, y: -120 }, {}, 'pointer-display'),
    ],
    [
      edge('pointer-time-field', 'pointer-time', 'value', 'pointer-field', 'time'),
      edge(
        'pointer-field-warp',
        'pointer-field',
        'frame',
        'pointer-warp',
        'source',
      ),
      edge(
        'pointer-x-warp',
        'pointer-input',
        'x',
        'pointer-warp',
        'amount',
      ),
      edge(
        'pointer-warp-grade',
        'pointer-warp',
        'frame',
        'pointer-grade',
        'source',
      ),
      edge(
        'pointer-y-grade',
        'pointer-input',
        'y',
        'pointer-grade',
        'hue',
      ),
      edge(
        'pointer-held-grade',
        'pointer-input',
        'down',
        'pointer-grade',
        'saturation',
      ),
      edge(
        'pointer-grade-display',
        'pointer-grade',
        'frame',
        'pointer-display',
        'source',
      ),
    ],
  );
}

function createMicPulseTrailsGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -500, y: -220 }, {}, 'mic-time'),
      createGraphNode(
        'audioLevel',
        { x: -500, y: 80 },
        { gain: 2.2, floor: 0.03 },
        'mic-level',
      ),
      createGraphNode(
        'plasma',
        { x: -240, y: -120 },
        { scale: 4.8, speed: 0.4 },
        'mic-field',
      ),
      createGraphNode(
        'trails',
        { x: 20, y: -120 },
        { feedback: 0.9 },
        'mic-trails',
      ),
      createGraphNode(
        'colorGrade',
        { x: 280, y: -120 },
        { contrast: 1.25, saturation: 1.5 },
        'mic-grade',
      ),
      createGraphNode('display', { x: 540, y: -120 }, {}, 'mic-display'),
    ],
    [
      edge('mic-time-field', 'mic-time', 'value', 'mic-field', 'time'),
      edge('mic-level-field', 'mic-level', 'value', 'mic-field', 'energy'),
      edge('mic-field-trails', 'mic-field', 'frame', 'mic-trails', 'source'),
      edge('mic-level-trails', 'mic-level', 'value', 'mic-trails', 'feedback'),
      edge('mic-trails-grade', 'mic-trails', 'frame', 'mic-grade', 'source'),
      edge('mic-level-grade', 'mic-level', 'value', 'mic-grade', 'hue'),
      edge(
        'mic-grade-display',
        'mic-grade',
        'frame',
        'mic-display',
        'source',
      ),
    ],
  );
}

function createCameraDreamGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -560, y: -260 }, {}, 'camera-time'),
      createGraphNode(
        'plasma',
        { x: -320, y: -220 },
        { scale: 5.5, speed: 0.24, hue: 0.18 },
        'camera-field',
      ),
      createGraphNode('videoInput', { x: -320, y: 80 }, {}, 'camera-input'),
      createGraphNode('pointer', { x: -80, y: 220 }, {}, 'camera-pointer'),
      createGraphNode(
        'blend',
        { x: -60, y: -100 },
        { mode: 'screen', mix: 0.72 },
        'camera-blend',
      ),
      createGraphNode(
        'warp',
        { x: 200, y: -100 },
        { frequency: 6.5, speed: 0.16 },
        'camera-warp',
      ),
      createGraphNode(
        'colorGrade',
        { x: 460, y: -100 },
        { saturation: 1.25, contrast: 1.15 },
        'camera-grade',
      ),
      createGraphNode('display', { x: 720, y: -100 }, {}, 'camera-display'),
    ],
    [
      edge('camera-time-field', 'camera-time', 'value', 'camera-field', 'time'),
      edge(
        'camera-field-blend',
        'camera-field',
        'frame',
        'camera-blend',
        'a',
      ),
      edge(
        'camera-input-blend',
        'camera-input',
        'frame',
        'camera-blend',
        'b',
      ),
      edge(
        'camera-blend-warp',
        'camera-blend',
        'frame',
        'camera-warp',
        'source',
      ),
      edge(
        'camera-pointer-warp',
        'camera-pointer',
        'x',
        'camera-warp',
        'amount',
      ),
      edge(
        'camera-warp-grade',
        'camera-warp',
        'frame',
        'camera-grade',
        'source',
      ),
      edge(
        'camera-pointer-grade',
        'camera-pointer',
        'y',
        'camera-grade',
        'hue',
      ),
      edge(
        'camera-grade-display',
        'camera-grade',
        'frame',
        'camera-display',
        'source',
      ),
    ],
  );
}

function createPromptedPreviewGraph(): GraphDocument {
  return graph(
    [
      createGraphNode('time', { x: -500, y: -220 }, {}, 'prompt-time'),
      createGraphNode(
        'plasma',
        { x: -240, y: -180 },
        { scale: 4.5, speed: 0.28, hue: -0.12 },
        'prompt-field',
      ),
      createGraphNode(
        'aiPrompt',
        { x: -240, y: 140 },
        {
          text: 'Slow aurora ribbons folding through an infinite glass garden',
          negative: 'flicker, lettering, abrupt cuts',
        },
        'prompt-chat',
      ),
      createGraphNode(
        'videoModel',
        { x: 40, y: -100 },
        { runtime: 'preview', strength: 0.78, seed: 108 },
        'prompt-model',
      ),
      createGraphNode('display', { x: 340, y: -100 }, {}, 'prompt-display'),
    ],
    [
      edge('prompt-time-field', 'prompt-time', 'value', 'prompt-field', 'time'),
      edge(
        'prompt-field-model',
        'prompt-field',
        'frame',
        'prompt-model',
        'source',
      ),
      edge(
        'prompt-chat-model',
        'prompt-chat',
        'prompt',
        'prompt-model',
        'prompt',
      ),
      edge(
        'prompt-model-display',
        'prompt-model',
        'frame',
        'prompt-display',
        'source',
      ),
    ],
  );
}

const PRESET_FACTORIES: Readonly<
  Record<GraphPresetId, () => GraphDocument>
> = {
  blank: createBlankGraph,
  'full-studio': createDefaultGraph,
  'beat-color': createBeatColorGraph,
  'spiral-feedback-lab': createSpiralFeedbackLabGraph,
  'two-world-mixer': createTwoWorldMixerGraph,
  'control-math': createControlMathGraph,
  'smooth-pointer': createSmoothPointerGraph,
  'transform-playground': createTransformPlaygroundGraph,
  'mask-composite-lab': createMaskCompositeLabGraph,
  'beat-switcher': createBeatSwitcherGraph,
  'live-cut-lab': createLiveCutLabGraph,
  'audio-soft-focus': createAudioSoftFocusGraph,
  'pointer-bend': createPointerBendGraph,
  'mic-pulse-trails': createMicPulseTrailsGraph,
  'camera-dream': createCameraDreamGraph,
  'prompted-preview': createPromptedPreviewGraph,
  'file-preview': createFilePreviewGraph,
};

export function getGraphPreset(id: GraphPresetId): GraphPreset {
  const preset = GRAPH_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) {
    throw new RangeError('Unknown graph preset "' + id + '".');
  }
  return preset;
}

export function createGraphPreset(id: GraphPresetId): GraphDocument {
  return PRESET_FACTORIES[id]();
}
