import type {
  GraphParamValue,
  NodeKind,
  OperatorDefinition,
  OperatorExecution,
  OperatorParamDefinition,
  PortDefinition,
  PortType,
} from './types';

const port = (
  id: string,
  label: string,
  type: PortType,
  optional = false,
): PortDefinition => ({ id, label, type, optional });

const numberParam = (
  label: string,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
): OperatorParamDefinition => ({
  type: 'number',
  label,
  defaultValue,
  min,
  max,
  step,
});

const selectParam = (
  label: string,
  defaultValue: string,
  options: readonly string[],
): OperatorParamDefinition => ({
  type: 'select',
  label,
  defaultValue,
  options: options.map((value) => ({
    value,
    label:
      ({ api: 'API', http: 'HTTP', websocket: 'WebSocket', xor: 'XOR' })[
        value
      ] ??
      (value.charAt(0).toUpperCase() + value.slice(1)).replace(
        /([a-z0-9])([A-Z])/g,
        '$1 $2',
      ),
  })),
});

const textParam = (
  label: string,
  defaultValue: string,
  maxLength: number,
  options: { placeholder?: string; multiline?: boolean } = {},
): OperatorParamDefinition => ({
  type: 'text',
  label,
  defaultValue,
  maxLength,
  ...options,
});

const definitions = [
  {
    kind: 'time',
    title: 'Transport Time',
    summary: 'Playback time in seconds, with speed and offset controls.',
    domain: 'control',
    category: 'timing',
    inputs: [],
    outputs: [port('value', 'Time', 'control.f32')],
    params: {
      speed: numberParam('Speed', 1, -4, 4, 0.01),
      offset: numberParam('Offset', 0, -60, 60, 0.01),
    },
  },
  {
    kind: 'beatClock',
    title: 'Beat Clock',
    summary: 'Tempo-locked phase, beat pulse, and bar phase signals.',
    domain: 'control',
    category: 'timing',
    inputs: [port('time', 'Time', 'control.f32', true)],
    outputs: [
      port('phase', 'Phase', 'control.f32'),
      port('beat', 'Beat', 'control.f32'),
      port('bar', 'Bar', 'control.f32'),
    ],
    params: {
      bpm: numberParam('BPM', 120, 20, 300, 1),
      beatsPerBar: numberParam('Beats / bar', 4, 1, 16, 1),
      pulseWidth: numberParam('Pulse width', 0.12, 0.01, 0.95, 0.01),
      offset: numberParam('Beat offset', 0, -16, 16, 0.01),
    },
  },
  {
    kind: 'autoSelector',
    title: 'Auto Selector',
    summary: 'Advances a switch index on a deterministic timed interval.',
    domain: 'control',
    category: 'timing',
    inputs: [port('position', 'Position', 'control.f32', true)],
    outputs: [
      port('index', 'Index', 'control.f32'),
      port('phase', 'Phase', 'control.f32'),
    ],
    params: {
      interval: numberParam('Interval (s)', 1.5, 0.1, 60, 0.1),
      count: numberParam('Count', 4, 2, 4, 1),
      order: selectParam('Order', 'forward', [
        'forward',
        'reverse',
        'shuffleBag',
      ]),
      seed: numberParam('Seed', 23, 0, 65_535, 1),
    },
  },
  {
    kind: 'oscillator',
    title: 'Oscillator',
    summary: 'A normalized repeating control signal.',
    domain: 'control',
    category: 'timing',
    inputs: [port('phase', 'Phase', 'control.f32', true)],
    outputs: [port('value', 'Value', 'control.f32')],
    params: {
      frequency: numberParam('Frequency', 0.12, 0, 8, 0.01),
      phase: numberParam('Phase', 0, -1, 1, 0.01),
      amplitude: numberParam('Amplitude', 1, 0, 1, 0.01),
      offset: numberParam('Offset', 0, -1, 1, 0.01),
      waveform: selectParam('Waveform', 'sine', [
        'sine',
        'triangle',
        'saw',
        'square',
      ]),
    },
  },
  {
    kind: 'constant',
    title: 'Constant',
    summary: 'A fixed control value for parameters and calculations.',
    domain: 'control',
    category: 'control',
    inputs: [],
    outputs: [port('value', 'Value', 'control.f32')],
    params: {
      value: numberParam('Value', 0.5, -10, 10, 0.01),
    },
  },
  {
    kind: 'math',
    title: 'Math',
    summary: 'Combines two control values with a basic operation.',
    domain: 'control',
    category: 'control',
    inputs: [
      port('a', 'A', 'control.f32', true),
      port('b', 'B', 'control.f32', true),
    ],
    outputs: [port('value', 'Value', 'control.f32')],
    params: {
      a: numberParam('A', 0, -10, 10, 0.01),
      b: numberParam('B', 1, -10, 10, 0.01),
      operation: selectParam('Operation', 'add', [
        'add',
        'subtract',
        'multiply',
        'divide',
        'min',
        'max',
      ]),
    },
  },
  {
    kind: 'mapRange',
    title: 'Map Range',
    summary: 'Remaps a control value between numeric ranges.',
    domain: 'control',
    category: 'control',
    inputs: [port('value', 'Value', 'control.f32')],
    outputs: [port('value', 'Value', 'control.f32')],
    params: {
      inMin: numberParam('Input min', 0, -100, 100, 0.01),
      inMax: numberParam('Input max', 1, -100, 100, 0.01),
      outMin: numberParam('Output min', 0, -100, 100, 0.01),
      outMax: numberParam('Output max', 1, -100, 100, 0.01),
      boundary: selectParam('Boundary', 'clamp', [
        'none',
        'clamp',
        'wrap',
        'fold',
      ]),
    },
  },
  {
    kind: 'smooth',
    title: 'Smooth',
    summary: 'Eases rising and falling control changes over time.',
    domain: 'control',
    category: 'control',
    inputs: [port('value', 'Value', 'control.f32')],
    outputs: [port('value', 'Value', 'control.f32')],
    params: {
      rise: numberParam('Rise (s)', 0.25, 0, 10, 0.01),
      fall: numberParam('Fall (s)', 0.25, 0, 10, 0.01),
      initial: numberParam('Initial', 0, -10, 10, 0.01),
    },
    execution: {
      stateful: true,
    },
  },
  {
    kind: 'pointer',
    title: 'Pointer',
    summary: 'Stage coordinates plus held, press, and release signals.',
    domain: 'control',
    category: 'interaction-ai',
    inputs: [],
    outputs: [
      port('x', 'X', 'control.f32'),
      port('y', 'Y', 'control.f32'),
      port('down', 'Held', 'control.f32'),
      port('press', 'Press', 'control.f32'),
      port('release', 'Release', 'control.f32'),
    ],
    params: {},
  },
  {
    kind: 'aiPrompt',
    title: 'AI Chat',
    summary: 'Live text instructions for a connected generative model.',
    domain: 'control',
    category: 'interaction-ai',
    inputs: [],
    outputs: [port('prompt', 'Prompt', 'text.utf8')],
    params: {
      text: textParam(
        'Prompt',
        'A luminous living landscape, fluid motion, cinematic color',
        4_000,
        {
          placeholder: 'Describe the evolving image…',
          multiline: true,
        },
      ),
      negative: textParam(
        'Avoid',
        'flicker, text, watermark, compression artifacts',
        2_000,
        {
          placeholder: 'What should the model avoid?',
          multiline: true,
        },
      ),
    },
  },
  {
    kind: 'xyPad',
    title: 'XY Pad',
    summary: 'A hands-on pair of normalized control signals.',
    domain: 'control',
    category: 'interaction-ai',
    inputs: [],
    outputs: [
      port('x', 'X', 'control.f32'),
      port('y', 'Y', 'control.f32'),
    ],
    params: {
      x: numberParam('X', 0.5, 0, 1, 0.01),
      y: numberParam('Y', 0.5, 0, 1, 0.01),
    },
    parameterLayout: {
      type: 'xy',
      label: 'Position',
      xParamId: 'x',
      yParamId: 'y',
    },
  },
  {
    kind: 'audioLevel',
    title: 'Audio Level',
    summary:
      'Starts the microphone, reports its loudness, and passes the block on for analysis.',
    domain: 'control',
    category: 'inputs',
    inputs: [port('audio', 'Audio', 'audio.block', true)],
    outputs: [
      port('value', 'Level', 'control.f32'),
      port('audio', 'Audio', 'audio.block'),
    ],
    params: {
      gain: numberParam('Gain', 1.5, 0, 8, 0.01),
      floor: numberParam('Floor', 0.02, 0, 1, 0.01),
    },
  },
  {
    kind: 'audioSpectrum',
    title: 'Audio Spectrum',
    summary:
      'Splits a patched audio source into bass, mid, and treble control signals.',
    domain: 'control',
    category: 'inputs',
    inputs: [port('audio', 'Audio', 'audio.block', true)],
    outputs: [
      port('level', 'Level', 'control.f32'),
      port('bass', 'Bass', 'control.f32'),
      port('mid', 'Mid', 'control.f32'),
      port('treble', 'Treble', 'control.f32'),
    ],
    params: {
      gain: numberParam('Gain', 2, 0, 8, 0.01),
      floor: numberParam('Floor', 0.05, 0, 1, 0.01),
    },
  },
  {
    kind: 'audioTrigger',
    title: 'Audio Trigger',
    summary:
      'Turns rises above a band’s own recent average into a gate and a decaying envelope.',
    domain: 'control',
    category: 'control',
    inputs: [port('value', 'Value', 'control.f32', true)],
    outputs: [
      port('trigger', 'Trigger', 'control.f32'),
      port('envelope', 'Envelope', 'control.f32'),
    ],
    params: {
      threshold: numberParam('Threshold', 0.12, 0, 1, 0.01),
      sensitivity: numberParam('Sensitivity', 1.3, 0, 4, 0.01),
      hold: numberParam('Hold (s)', 0.12, 0.01, 2, 0.01),
      decay: numberParam('Decay (s)', 0.35, 0.01, 4, 0.01),
    },
    execution: {
      stateful: true,
    },
  },
  {
    kind: 'audioBeat',
    title: 'Audio Beat Clock',
    summary:
      'Infers tempo and beat phase from the spacing between incoming triggers.',
    domain: 'control',
    category: 'timing',
    inputs: [port('trigger', 'Trigger', 'control.f32', true)],
    outputs: [
      port('phase', 'Phase', 'control.f32'),
      port('beat', 'Beat', 'control.f32'),
      port('bar', 'Bar', 'control.f32'),
      port('bpm', 'BPM', 'control.f32'),
      port('confidence', 'Confidence', 'control.f32'),
    ],
    params: {
      restingBpm: numberParam('Resting BPM', 120, 40, 240, 1),
      minBpm: numberParam('Min BPM', 70, 40, 240, 1),
      maxBpm: numberParam('Max BPM', 170, 40, 240, 1),
      beatsPerBar: numberParam('Beats / bar', 4, 1, 16, 1),
      pulseWidth: numberParam('Pulse width', 0.12, 0.01, 0.95, 0.01),
      lock: numberParam('Lock', 0.35, 0.01, 1, 0.01),
    },
    execution: {
      stateful: true,
    },
  },
  {
    kind: 'videoInput',
    title: 'Video Input',
    summary: 'A live camera frame from this browser session.',
    domain: 'frame',
    category: 'inputs',
    inputs: [],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      facing: selectParam('Camera', 'user', ['user', 'environment']),
      fit: selectParam('Fit', 'cover', ['cover', 'contain', 'stretch']),
      mirror: selectParam('Mirror', 'on', ['on', 'off']),
    },
  },
  {
    kind: 'file',
    title: 'File',
    summary: 'A local image, video, or audio file selected in this browser session.',
    domain: 'frame',
    category: 'inputs',
    inputs: [],
    outputs: [
      port('frame', 'Frame', 'frame.rgba'),
      port('audio', 'Audio', 'audio.block'),
    ],
    params: {},
  },
  {
    kind: 'audioOutput',
    title: 'Audio Output',
    summary: 'Routes a connected audio block to this browser tab after activation.',
    domain: 'audio',
    category: 'output',
    inputs: [port('audio', 'Audio', 'audio.block')],
    outputs: [],
    params: {},
  },
  {
    kind: 'audioMixer',
    title: 'Audio Mixer',
    summary: 'Mixes 2, 4, or 8 audio sources with per-source gain and three-band EQ.',
    domain: 'audio',
    category: 'compositing',
    inputs: [
      port('source1', 'Source 1', 'audio.block', true),
      port('source2', 'Source 2', 'audio.block', true),
      port('source3', 'Source 3', 'audio.block', true),
      port('source4', 'Source 4', 'audio.block', true),
      port('source5', 'Source 5', 'audio.block', true),
      port('source6', 'Source 6', 'audio.block', true),
      port('source7', 'Source 7', 'audio.block', true),
      port('source8', 'Source 8', 'audio.block', true),
    ],
    outputs: [port('audio', 'Audio', 'audio.block')],
    params: {
      sourceCount: selectParam('Sources', '2', ['2', '4', '8']),
      gain1: numberParam('Source 1 gain', 1, 0, 2, 0.01),
      gain2: numberParam('Source 2 gain', 1, 0, 2, 0.01),
      gain3: numberParam('Source 3 gain', 1, 0, 2, 0.01),
      gain4: numberParam('Source 4 gain', 1, 0, 2, 0.01),
      gain5: numberParam('Source 5 gain', 1, 0, 2, 0.01),
      gain6: numberParam('Source 6 gain', 1, 0, 2, 0.01),
      gain7: numberParam('Source 7 gain', 1, 0, 2, 0.01),
      gain8: numberParam('Source 8 gain', 1, 0, 2, 0.01),
      low: numberParam('Low EQ', 0, -12, 12, 0.1),
      mid: numberParam('Mid EQ', 0, -12, 12, 0.1),
      high: numberParam('High EQ', 0, -12, 12, 0.1),
    },
  },
  {
    kind: 'videoModel',
    title: 'Video Model',
    summary: 'Receives generated frames from a compatible worker or API gateway.',
    domain: 'frame',
    category: 'interaction-ai',
    inputs: [
      port('source', 'Source', 'frame.rgba', true),
      port('prompt', 'Prompt', 'text.utf8'),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      runtime: selectParam('Runtime', 'preview', ['preview', 'local', 'api']),
      transport: selectParam('Transport', 'websocket', ['websocket', 'http']),
      endpoint: textParam(
        'Endpoint',
        'ws://127.0.0.1:8189/v1/stream',
        2_048,
        { placeholder: 'wss://… or https://…' },
      ),
      model: textParam('Model', 'realtime-video', 256, {
        placeholder: 'Model or workflow ID',
      }),
      strength: numberParam('Strength', 0.7, 0, 1, 0.01),
      guidance: numberParam('Guidance', 1.2, 0, 20, 0.1),
      seed: numberParam('Seed', 42, 0, 65_535, 1),
      inputFps: numberParam('Input FPS', 12, 1, 30, 1),
    },
  },
  {
    kind: 'solid',
    title: 'Solid Color',
    summary: 'A uniform RGBA frame with individually controllable channels.',
    domain: 'frame',
    category: 'generators',
    inputs: [
      port('red', 'Red', 'control.f32', true),
      port('green', 'Green', 'control.f32', true),
      port('blue', 'Blue', 'control.f32', true),
      port('alpha', 'Alpha', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      red: numberParam('Red', 0.08, 0, 1, 0.01),
      green: numberParam('Green', 0.18, 0, 1, 0.01),
      blue: numberParam('Blue', 0.42, 0, 1, 0.01),
      alpha: numberParam('Alpha', 1, 0, 1, 0.01),
    },
  },
  {
    kind: 'plasma',
    title: 'Flow Field',
    summary: 'A fluid procedural color field.',
    domain: 'frame',
    category: 'generators',
    inputs: [
      port('time', 'Time', 'control.f32', true),
      port('energy', 'Energy', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      scale: numberParam('Scale', 5, 1, 14, 0.1),
      speed: numberParam('Speed', 0.35, -3, 3, 0.01),
      energy: numberParam('Energy', 0.35, 0, 1, 0.01),
      hue: numberParam('Hue', 0.08, -1, 1, 0.01),
    },
  },
  {
    kind: 'cells',
    title: 'Cells',
    summary: 'An animated cellular noise field.',
    domain: 'frame',
    category: 'generators',
    inputs: [port('time', 'Time', 'control.f32', true)],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      scale: numberParam('Scale', 7, 2, 24, 0.1),
      speed: numberParam('Speed', 0.16, -3, 3, 0.01),
      contrast: numberParam('Contrast', 1.4, 0.25, 4, 0.01),
    },
  },
  {
    kind: 'transform2d',
    title: 'Transform 2D',
    summary: 'Moves, scales, and rotates a frame around an adjustable pivot.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('x', 'X', 'control.f32', true),
      port('y', 'Y', 'control.f32', true),
      port('scale', 'Scale', 'control.f32', true),
      port('rotation', 'Rotation', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      x: numberParam('X', 0, -1, 1, 0.01),
      y: numberParam('Y', 0, -1, 1, 0.01),
      scale: numberParam('Scale', 1, 0.1, 4, 0.01),
      rotation: numberParam('Rotation', 0, -180, 180, 1),
      pivotX: numberParam('Pivot X', 0.5, 0, 1, 0.01),
      pivotY: numberParam('Pivot Y', 0.5, 0, 1, 0.01),
      edgeMode: selectParam('Edges', 'transparent', [
        'transparent',
        'clamp',
        'repeat',
        'mirror',
      ]),
    },
  },
  {
    kind: 'warp',
    title: 'Warp',
    summary: 'Distorts a frame with a flowing coordinate field.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('amount', 'Amount', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      amount: numberParam('Amount', 0.22, 0, 1, 0.01),
      frequency: numberParam('Frequency', 5, 0.25, 20, 0.1),
      speed: numberParam('Speed', 0.2, -3, 3, 0.01),
    },
  },
  {
    kind: 'blur',
    title: 'Blur',
    summary: 'Softens a frame with a bounded single-pass filter.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('radius', 'Radius', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      radius: numberParam('Radius (px)', 8, 0, 24, 0.25),
    },
    execution: {
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    },
  },
  {
    kind: 'threshold',
    title: 'Threshold',
    summary: 'Extracts an opaque grayscale matte from a selected channel.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('level', 'Level', 'control.f32', true),
      port('softness', 'Softness', 'control.f32', true),
    ],
    outputs: [port('frame', 'Matte', 'frame.rgba')],
    params: {
      channel: selectParam('Channel', 'luminance', [
        'luminance',
        'red',
        'green',
        'blue',
        'alpha',
      ]),
      level: numberParam('Level', 0.5, 0, 1, 0.01),
      softness: numberParam('Softness', 0.05, 0, 0.5, 0.01),
      invert: selectParam('Invert', 'off', ['off', 'on']),
    },
  },
  {
    kind: 'mask',
    title: 'Mask',
    summary: 'Uses one frame channel to shape another frame’s transparency.',
    domain: 'frame',
    category: 'compositing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('mask', 'Mask', 'frame.rgba'),
      port('amount', 'Amount', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      channel: selectParam('Channel', 'luminance', [
        'luminance',
        'red',
        'green',
        'blue',
        'alpha',
      ]),
      amount: numberParam('Amount', 1, 0, 1, 0.01),
      invert: selectParam('Invert', 'off', ['off', 'on']),
    },
  },
  {
    kind: 'composite',
    title: 'Composite',
    summary: 'Layers two frames with standard source and destination rules.',
    domain: 'frame',
    category: 'compositing',
    inputs: [
      port('background', 'Background', 'frame.rgba'),
      port('foreground', 'Foreground', 'frame.rgba'),
      port('opacity', 'Opacity', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      operation: selectParam('Operation', 'sourceOver', [
        'sourceOver',
        'destinationOver',
        'sourceIn',
        'sourceOut',
        'sourceAtop',
        'xor',
      ]),
      opacity: numberParam('Opacity', 1, 0, 1, 0.01),
    },
  },
  {
    kind: 'frameSwitch',
    title: 'Frame Switch',
    summary: 'Selects one of four frame inputs by rounded index.',
    domain: 'frame',
    category: 'compositing',
    inputs: [
      port('a', 'A', 'frame.rgba'),
      port('b', 'B', 'frame.rgba', true),
      port('c', 'C', 'frame.rgba', true),
      port('d', 'D', 'frame.rgba', true),
      port('index', 'Index', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      index: numberParam('Index', 0, 0, 3, 1),
    },
  },
  {
    kind: 'blend',
    title: 'Blend',
    summary: 'Combines two frame signals.',
    domain: 'frame',
    category: 'compositing',
    inputs: [
      port('a', 'A', 'frame.rgba'),
      port('b', 'B', 'frame.rgba'),
      port('mix', 'Mix', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      mix: numberParam('Mix', 0.5, 0, 1, 0.01),
      mode: selectParam('Mode', 'screen', [
        'normal',
        'screen',
        'add',
        'multiply',
      ]),
    },
  },
  {
    kind: 'trails',
    title: 'Trails',
    summary: 'Accumulates an internally delayed previous frame.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('feedback', 'Feedback', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      feedback: numberParam('Feedback', 0.88, 0, 0.99, 0.01),
    },
    execution: {
      visualPasses: 1,
      renderTargets: 2,
      stateful: true,
    },
  },
  {
    kind: 'feedbackSpiral',
    title: 'Spiral Feedback',
    summary: 'Rotates and zooms retained history into a spiralling frame.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('feedback', 'Feedback', 'control.f32', true),
      port('rotation', 'Rotation', 'control.f32', true),
      port('zoom', 'Zoom', 'control.f32', true),
      port('centerX', 'Center X', 'control.f32', true),
      port('centerY', 'Center Y', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      feedback: numberParam('Feedback (1 s)', 0.62, 0, 0.99, 0.01),
      rotation: numberParam('Rotation (°/s)', 30, -360, 360, 1),
      zoom: numberParam('Zoom (×/s)', 1.06, 0.5, 2, 0.01),
      centerX: numberParam('Center X', 0.5, 0, 1, 0.01),
      centerY: numberParam('Center Y', 0.5, 0, 1, 0.01),
    },
    parameterLayout: {
      type: 'xy',
      label: 'Center',
      xParamId: 'centerX',
      yParamId: 'centerY',
    },
    execution: {
      visualPasses: 1,
      renderTargets: 2,
      stateful: true,
    },
  },
  {
    kind: 'strobe',
    title: 'Strobe',
    summary: 'Rhythmically gates a frame with internal rate capped at 3 Hz.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('phase', 'Phase', 'control.f32', true),
      port('amount', 'Amount', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      rate: numberParam('Rate (Hz)', 1, 0, 3, 0.01),
      duty: numberParam('Open fraction', 0.8, 0.05, 0.95, 0.01),
      amount: numberParam('Amount', 0.35, 0, 1, 0.01),
      closedMode: selectParam('Closed', 'black', [
        'black',
        'white',
        'transparent',
        'invert',
      ]),
    },
    execution: {
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    },
  },
  {
    kind: 'colorGrade',
    title: 'Color Grade',
    summary: 'Adjusts hue, exposure, contrast, and saturation.',
    domain: 'frame',
    category: 'image-processing',
    inputs: [
      port('source', 'Source', 'frame.rgba'),
      port('hue', 'Hue', 'control.f32', true),
      port('exposure', 'Exposure', 'control.f32', true),
      port('saturation', 'Saturation', 'control.f32', true),
    ],
    outputs: [port('frame', 'Frame', 'frame.rgba')],
    params: {
      hue: numberParam('Hue', 0, -1, 1, 0.01),
      exposure: numberParam('Exposure', 0.05, -2, 2, 0.01),
      contrast: numberParam('Contrast', 1.1, 0, 3, 0.01),
      saturation: numberParam('Saturation', 1.2, 0, 3, 0.01),
    },
  },
  {
    kind: 'display',
    title: 'Display',
    summary: 'Presents a frame on the stage.',
    domain: 'display',
    category: 'output',
    inputs: [port('source', 'Source', 'frame.rgba')],
    outputs: [],
    params: {},
  },
] as const satisfies readonly OperatorDefinition[];

export const OPERATOR_DEFINITIONS: readonly OperatorDefinition[] = definitions;

export const OPERATOR_REGISTRY: Readonly<Record<NodeKind, OperatorDefinition>> =
  Object.freeze(
    Object.fromEntries(
      definitions.map((definition) => [definition.kind, definition]),
    ) as unknown as Record<NodeKind, OperatorDefinition>,
  );

export function getOperatorDefinition(kind: NodeKind): OperatorDefinition {
  return OPERATOR_REGISTRY[kind];
}

export function getOperatorExecution(kind: NodeKind): OperatorExecution {
  const definition = OPERATOR_REGISTRY[kind];
  const defaults: OperatorExecution =
    definition.domain === 'control' || definition.domain === 'audio'
      ? { visualPasses: 0, renderTargets: 0, stateful: false }
      : definition.domain === 'display'
        ? { visualPasses: 1, renderTargets: 0, stateful: false }
        : { visualPasses: 1, renderTargets: 1, stateful: false };

  return { ...defaults, ...definition.execution };
}

export function getDefaultParams(kind: NodeKind): Record<string, GraphParamValue> {
  return Object.fromEntries(
    Object.entries(OPERATOR_REGISTRY[kind].params).map(([id, definition]) => [
      id,
      definition.defaultValue,
    ]),
  );
}
