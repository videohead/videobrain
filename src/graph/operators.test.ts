import { describe, expect, it } from 'vitest';
import {
  NODE_KINDS,
  OPERATOR_CATEGORY_IDS,
  OPERATOR_DEFINITIONS,
  OPERATOR_REGISTRY,
  getDefaultParams,
  getOperatorExecution,
} from './index';

describe('operator registry', () => {
  it('contains exactly one definition for every node kind', () => {
    expect(OPERATOR_DEFINITIONS.map(({ kind }) => kind)).toEqual(NODE_KINDS);
    expect(Object.keys(OPERATOR_REGISTRY).sort()).toEqual(
      [...NODE_KINDS].sort(),
    );
  });

  it('assigns every operator to a known, represented library category', () => {
    expect(
      [...new Set(OPERATOR_DEFINITIONS.map(({ category }) => category))].sort(),
    ).toEqual([...OPERATOR_CATEGORY_IDS].sort());
    for (const definition of OPERATOR_DEFINITIONS) {
      expect(OPERATOR_CATEGORY_IDS).toContain(definition.category);
    }
  });

  it('uses unique input and output IDs within every definition', () => {
    for (const definition of OPERATOR_DEFINITIONS) {
      const inputIds = definition.inputs.map(({ id }) => id);
      const outputIds = definition.outputs.map(({ id }) => id);
      expect(new Set(inputIds).size, `${definition.kind} inputs`).toBe(
        inputIds.length,
      );
      expect(new Set(outputIds).size, `${definition.kind} outputs`).toBe(
        outputIds.length,
      );
    }
  });

  it('provides valid defaults for every parameter', () => {
    for (const definition of OPERATOR_DEFINITIONS) {
      const defaults = getDefaultParams(definition.kind);
      for (const [id, parameter] of Object.entries(definition.params)) {
        expect(defaults[id]).toBe(parameter.defaultValue);
        if (parameter.type === 'number') {
          expect(parameter.defaultValue).toBeGreaterThanOrEqual(parameter.min);
          expect(parameter.defaultValue).toBeLessThanOrEqual(parameter.max);
          expect(parameter.step).toBeGreaterThan(0);
        } else if (parameter.type === 'select') {
          expect(
            parameter.options.some(
              ({ value }) => value === parameter.defaultValue,
            ),
          ).toBe(true);
        } else {
          expect(typeof parameter.defaultValue).toBe('string');
          expect(parameter.defaultValue.length).toBeLessThanOrEqual(
            parameter.maxLength,
          );
          expect(parameter.maxLength).toBeGreaterThan(0);
        }
      }
    }
  });

  it('derives execution cost by domain and preserves explicit overrides', () => {
    expect(getOperatorExecution('constant')).toEqual({
      visualPasses: 0,
      renderTargets: 0,
      stateful: false,
    });
    expect(getOperatorExecution('solid')).toEqual({
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    });
    expect(getOperatorExecution('display')).toEqual({
      visualPasses: 1,
      renderTargets: 0,
      stateful: false,
    });
    expect(getOperatorExecution('smooth')).toEqual({
      visualPasses: 0,
      renderTargets: 0,
      stateful: true,
    });
    expect(OPERATOR_REGISTRY.blur.execution).toEqual({
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    });
    expect(getOperatorExecution('trails')).toEqual({
      visualPasses: 1,
      renderTargets: 2,
      stateful: true,
    });
    expect(getOperatorExecution('feedbackSpiral')).toEqual({
      visualPasses: 1,
      renderTargets: 2,
      stateful: true,
    });
    expect(getOperatorExecution('autoSelector')).toEqual({
      visualPasses: 0,
      renderTargets: 0,
      stateful: false,
    });
    expect(getOperatorExecution('strobe')).toEqual({
      visualPasses: 1,
      renderTargets: 1,
      stateful: false,
    });
  });

  it('keeps all public signals within the four exact port types', () => {
    const signalTypes = new Set(
      OPERATOR_DEFINITIONS.flatMap((definition) => [
        ...definition.inputs.map(({ type }) => type),
        ...definition.outputs.map(({ type }) => type),
      ]),
    );

    expect(signalTypes).toEqual(
      new Set(['frame.rgba', 'control.f32', 'text.utf8', 'audio.block']),
    );
  });

  it('defines tempo timing with phase, pulse, and bar outputs', () => {
    const definition = OPERATOR_REGISTRY.beatClock;

    expect(definition.domain).toBe('control');
    expect(definition.inputs).toEqual([
      { id: 'time', label: 'Time', type: 'control.f32', optional: true },
    ]);
    expect(definition.outputs).toEqual([
      { id: 'phase', label: 'Phase', type: 'control.f32', optional: false },
      { id: 'beat', label: 'Beat', type: 'control.f32', optional: false },
      { id: 'bar', label: 'Bar', type: 'control.f32', optional: false },
    ]);
    expect(getDefaultParams('beatClock')).toEqual({
      bpm: 120,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      offset: 0,
    });
  });

  it('defines deterministic timed switching with bounded selection modes', () => {
    const definition = OPERATOR_REGISTRY.autoSelector;

    expect(definition).toMatchObject({
      domain: 'control',
      category: 'timing',
      inputs: [
        {
          id: 'position',
          label: 'Position',
          type: 'control.f32',
          optional: true,
        },
      ],
      outputs: [
        {
          id: 'index',
          label: 'Index',
          type: 'control.f32',
          optional: false,
        },
        {
          id: 'phase',
          label: 'Phase',
          type: 'control.f32',
          optional: false,
        },
      ],
    });
    expect(getDefaultParams('autoSelector')).toEqual({
      interval: 1.5,
      count: 4,
      order: 'forward',
      seed: 23,
    });
    expect(definition.params.order).toMatchObject({
      type: 'select',
      options: [
        { value: 'forward', label: 'Forward' },
        { value: 'reverse', label: 'Reverse' },
        { value: 'shuffleBag', label: 'Shuffle Bag' },
      ],
    });
  });

  it('defines the foundational control operators and their stable contracts', () => {
    expect(OPERATOR_REGISTRY.constant).toMatchObject({
      domain: 'control',
      inputs: [],
      outputs: [
        { id: 'value', label: 'Value', type: 'control.f32', optional: false },
      ],
    });
    expect(getDefaultParams('constant')).toEqual({ value: 0.5 });

    expect(OPERATOR_REGISTRY.math.inputs).toEqual([
      { id: 'a', label: 'A', type: 'control.f32', optional: true },
      { id: 'b', label: 'B', type: 'control.f32', optional: true },
    ]);
    expect(OPERATOR_REGISTRY.math.outputs).toEqual([
      { id: 'value', label: 'Value', type: 'control.f32', optional: false },
    ]);
    expect(OPERATOR_REGISTRY.math.params.operation).toMatchObject({
      type: 'select',
      defaultValue: 'add',
      options: [
        { value: 'add', label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'divide', label: 'Divide' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
      ],
    });
    expect(getDefaultParams('math')).toEqual({
      a: 0,
      b: 1,
      operation: 'add',
    });

    expect(OPERATOR_REGISTRY.mapRange.inputs).toEqual([
      { id: 'value', label: 'Value', type: 'control.f32', optional: false },
    ]);
    expect(OPERATOR_REGISTRY.mapRange.outputs).toEqual([
      { id: 'value', label: 'Value', type: 'control.f32', optional: false },
    ]);
    expect(OPERATOR_REGISTRY.mapRange.params.boundary).toMatchObject({
      type: 'select',
      defaultValue: 'clamp',
      options: [
        { value: 'none', label: 'None' },
        { value: 'clamp', label: 'Clamp' },
        { value: 'wrap', label: 'Wrap' },
        { value: 'fold', label: 'Fold' },
      ],
    });
    expect(getDefaultParams('mapRange')).toEqual({
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 1,
      boundary: 'clamp',
    });

    expect(OPERATOR_REGISTRY.smooth.inputs).toEqual([
      { id: 'value', label: 'Value', type: 'control.f32', optional: false },
    ]);
    expect(OPERATOR_REGISTRY.smooth.outputs).toEqual([
      { id: 'value', label: 'Value', type: 'control.f32', optional: false },
    ]);
    expect(getDefaultParams('smooth')).toEqual({
      rise: 0.25,
      fall: 0.25,
      initial: 0,
    });
  });

  it('exposes pointer position and button-edge signals independently', () => {
    expect(OPERATOR_REGISTRY.pointer.outputs).toEqual([
      { id: 'x', label: 'X', type: 'control.f32', optional: false },
      { id: 'y', label: 'Y', type: 'control.f32', optional: false },
      { id: 'down', label: 'Held', type: 'control.f32', optional: false },
      { id: 'press', label: 'Press', type: 'control.f32', optional: false },
      { id: 'release', label: 'Release', type: 'control.f32', optional: false },
    ]);
  });

  it('defines a bounded text prompt source for model instructions', () => {
    const definition = OPERATOR_REGISTRY.aiPrompt;

    expect(definition.domain).toBe('control');
    expect(definition.outputs).toEqual([
      { id: 'prompt', label: 'Prompt', type: 'text.utf8', optional: false },
    ]);
    expect(definition.params.text).toMatchObject({
      type: 'text',
      maxLength: 4_000,
      multiline: true,
    });
    expect(definition.params.negative).toMatchObject({
      type: 'text',
      maxLength: 2_000,
      multiline: true,
    });
  });

  it('defines a model frame operator with typed prompt and optional source inputs', () => {
    const definition = OPERATOR_REGISTRY.videoModel;

    expect(definition.domain).toBe('frame');
    expect(definition.inputs).toEqual([
      { id: 'source', label: 'Source', type: 'frame.rgba', optional: true },
      { id: 'prompt', label: 'Prompt', type: 'text.utf8', optional: false },
    ]);
    expect(definition.outputs).toEqual([
      { id: 'frame', label: 'Frame', type: 'frame.rgba', optional: false },
    ]);
    expect(getDefaultParams('videoModel')).toMatchObject({
      runtime: 'preview',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:8189/v1/stream',
      model: 'realtime-video',
      strength: 0.7,
      guidance: 1.2,
      seed: 42,
      inputFps: 12,
    });
  });

  it('defines live video as a frame source with safe presentation defaults', () => {
    const definition = OPERATOR_REGISTRY.videoInput;

    expect(definition.domain).toBe('frame');
    expect(definition.inputs).toEqual([]);
    expect(definition.outputs).toEqual([
      { id: 'frame', label: 'Frame', type: 'frame.rgba', optional: false },
    ]);
    expect(getDefaultParams('videoInput')).toEqual({
      facing: 'user',
      fit: 'cover',
      mirror: 'on',
    });
  });

  it('splits audio analysis into three named bands plus overall level', () => {
    const definition = OPERATOR_REGISTRY.audioSpectrum;

    expect(definition.domain).toBe('control');
    expect(definition.category).toBe('inputs');
    expect(definition.inputs).toEqual([
      { id: 'audio', label: 'Audio', type: 'audio.block', optional: true },
    ]);
    expect(definition.outputs.map(({ id, type }) => [id, type])).toEqual([
      ['level', 'control.f32'],
      ['bass', 'control.f32'],
      ['mid', 'control.f32'],
      ['treble', 'control.f32'],
    ]);
    expect(getDefaultParams('audioSpectrum')).toEqual({
      gain: 2,
      floor: 0.05,
      bassFrequency: 70,
      bassQ: 0.7,
      midFrequency: 900,
      midQ: 0.7,
      trebleFrequency: 5_000,
      trebleQ: 0.7,
    });
    expect(getOperatorExecution('audioSpectrum')).toEqual({
      visualPasses: 0,
      renderTargets: 0,
      stateful: false,
    });
  });

  it('defines an optional-input audio trigger with gate and envelope outputs', () => {
    const definition = OPERATOR_REGISTRY.audioTrigger;

    expect(definition.inputs).toEqual([
      { id: 'value', label: 'Value', type: 'control.f32', optional: true },
    ]);
    expect(definition.outputs.map(({ id }) => id)).toEqual([
      'trigger',
      'envelope',
    ]);
    expect(getDefaultParams('audioTrigger')).toEqual({
      threshold: 0.12,
      sensitivity: 1.3,
      hold: 0.12,
      decay: 0.35,
    });
    expect(getOperatorExecution('audioTrigger').stateful).toBe(true);
  });

  it('mirrors tempo timing outputs on the inferred audio beat clock', () => {
    const definition = OPERATOR_REGISTRY.audioBeat;

    expect(definition.category).toBe('timing');
    expect(definition.inputs).toEqual([
      { id: 'trigger', label: 'Trigger', type: 'control.f32', optional: true },
    ]);
    expect(definition.outputs.map(({ id }) => id)).toEqual([
      'phase',
      'beat',
      'bar',
      'bpm',
      'confidence',
    ]);
    expect(getDefaultParams('audioBeat')).toEqual({
      restingBpm: 120,
      minBpm: 70,
      maxBpm: 170,
      beatsPerBar: 4,
      pulseWidth: 0.12,
      lock: 0.35,
    });
    expect(getOperatorExecution('audioBeat').stateful).toBe(true);
  });

  it('defines local files as output-only frame sources', () => {
    const definition = OPERATOR_REGISTRY.file;

    expect(definition.domain).toBe('frame');
    expect(definition.inputs).toEqual([]);
    expect(definition.outputs).toEqual([
      { id: 'frame', label: 'Frame', type: 'frame.rgba', optional: false },
      { id: 'audio', label: 'Audio', type: 'audio.block', optional: false },
    ]);
    expect(getDefaultParams('file')).toEqual({});
  });

  it('defines an 2, 4, or 8 source mixer with three EQ bands', () => {
    const definition = OPERATOR_REGISTRY.audioMixer;

    expect(definition.inputs).toHaveLength(8);
    expect(definition.inputs.every(({ type, optional }) => type === 'audio.block' && optional)).toBe(true);
    expect(definition.outputs).toEqual([
      { id: 'audio', label: 'Audio', type: 'audio.block', optional: false },
    ]);
    expect(definition.params.sourceCount).toMatchObject({
      type: 'select',
      defaultValue: '2',
    });
    expect(definition.params.low).toMatchObject({ min: -12, max: 12 });
    expect(definition.params.mid).toMatchObject({ min: -12, max: 12 });
    expect(definition.params.high).toMatchObject({ min: -12, max: 12 });
  });

  it('defines a single-pass 2D transform with controllable spatial inputs', () => {
    const definition = OPERATOR_REGISTRY.transform2d;

    expect(definition.domain).toBe('frame');
    expect(definition.inputs).toEqual([
      { id: 'source', label: 'Source', type: 'frame.rgba', optional: false },
      { id: 'x', label: 'X', type: 'control.f32', optional: true },
      { id: 'y', label: 'Y', type: 'control.f32', optional: true },
      { id: 'scale', label: 'Scale', type: 'control.f32', optional: true },
      {
        id: 'rotation',
        label: 'Rotation',
        type: 'control.f32',
        optional: true,
      },
    ]);
    expect(definition.outputs).toEqual([
      { id: 'frame', label: 'Frame', type: 'frame.rgba', optional: false },
    ]);
    expect(getDefaultParams('transform2d')).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      pivotX: 0.5,
      pivotY: 0.5,
      edgeMode: 'transparent',
    });
    expect(definition.params.edgeMode).toMatchObject({
      type: 'select',
      options: [
        { value: 'transparent', label: 'Transparent' },
        { value: 'clamp', label: 'Clamp' },
        { value: 'repeat', label: 'Repeat' },
        { value: 'mirror', label: 'Mirror' },
      ],
    });
  });

  it('defines Spiral Feedback with per-second controls and explicit retained state', () => {
    const definition = OPERATOR_REGISTRY.feedbackSpiral;

    expect(definition.domain).toBe('frame');
    expect(definition.category).toBe('image-processing');
    expect(definition.inputs).toEqual([
      { id: 'source', label: 'Source', type: 'frame.rgba', optional: false },
      {
        id: 'feedback',
        label: 'Feedback',
        type: 'control.f32',
        optional: true,
      },
      {
        id: 'rotation',
        label: 'Rotation',
        type: 'control.f32',
        optional: true,
      },
      { id: 'zoom', label: 'Zoom', type: 'control.f32', optional: true },
      {
        id: 'centerX',
        label: 'Center X',
        type: 'control.f32',
        optional: true,
      },
      {
        id: 'centerY',
        label: 'Center Y',
        type: 'control.f32',
        optional: true,
      },
    ]);
    expect(definition.outputs).toEqual([
      { id: 'frame', label: 'Frame', type: 'frame.rgba', optional: false },
    ]);
    expect(getDefaultParams('feedbackSpiral')).toEqual({
      feedback: 0.62,
      rotation: 30,
      zoom: 1.06,
      centerX: 0.5,
      centerY: 0.5,
    });
    expect(definition.params).toMatchObject({
      feedback: { label: 'Feedback (1 s)', min: 0, max: 0.99 },
      rotation: { label: 'Rotation (°/s)', min: -360, max: 360 },
      zoom: { label: 'Zoom (×/s)', min: 0.5, max: 2 },
    });
    expect(definition.parameterLayout).toEqual({
      type: 'xy',
      label: 'Center',
      xParamId: 'centerX',
      yParamId: 'centerY',
    });
  });

  it('defines a Strobe with a 3 Hz internal-rate cap and selectable closed frames', () => {
    const definition = OPERATOR_REGISTRY.strobe;

    expect(definition).toMatchObject({
      domain: 'frame',
      category: 'image-processing',
      inputs: [
        {
          id: 'source',
          label: 'Source',
          type: 'frame.rgba',
          optional: false,
        },
        {
          id: 'phase',
          label: 'Phase',
          type: 'control.f32',
          optional: true,
        },
        {
          id: 'amount',
          label: 'Amount',
          type: 'control.f32',
          optional: true,
        },
      ],
      outputs: [
        {
          id: 'frame',
          label: 'Frame',
          type: 'frame.rgba',
          optional: false,
        },
      ],
    });
    expect(getDefaultParams('strobe')).toEqual({
      rate: 1,
      duty: 0.8,
      amount: true,
      closedMode: 'black',
    });
    expect(definition.params).toMatchObject({
      rate: { label: 'Rate (Hz)', min: 0, max: 3 },
      duty: { label: 'Open fraction', min: 0.05, max: 0.95 },
      amount: { type: 'boolean', label: 'On', defaultValue: true },
      closedMode: {
        options: [
          { value: 'black', label: 'Black' },
          { value: 'white', label: 'White' },
          { value: 'transparent', label: 'Transparent' },
          { value: 'invert', label: 'Invert' },
        ],
      },
    });
  });

  it('defines additive frame generators and compositing contracts', () => {
    expect(OPERATOR_REGISTRY.solid.inputs).toEqual([
      { id: 'red', label: 'Red', type: 'control.f32', optional: true },
      { id: 'green', label: 'Green', type: 'control.f32', optional: true },
      { id: 'blue', label: 'Blue', type: 'control.f32', optional: true },
      { id: 'alpha', label: 'Alpha', type: 'control.f32', optional: true },
    ]);
    expect(getDefaultParams('solid')).toEqual({
      red: 0.08,
      green: 0.18,
      blue: 0.42,
      alpha: 1,
    });

    expect(OPERATOR_REGISTRY.blur.inputs).toEqual([
      { id: 'source', label: 'Source', type: 'frame.rgba', optional: false },
      { id: 'radius', label: 'Radius', type: 'control.f32', optional: true },
    ]);
    expect(getDefaultParams('blur')).toEqual({ radius: 8 });

    expect(OPERATOR_REGISTRY.threshold.inputs).toEqual([
      { id: 'source', label: 'Source', type: 'frame.rgba', optional: false },
      { id: 'level', label: 'Level', type: 'control.f32', optional: true },
      {
        id: 'softness',
        label: 'Softness',
        type: 'control.f32',
        optional: true,
      },
    ]);
    expect(getDefaultParams('threshold')).toEqual({
      channel: 'luminance',
      level: 0.5,
      softness: 0.05,
      invert: 'off',
    });

    expect(OPERATOR_REGISTRY.mask.inputs).toEqual([
      { id: 'source', label: 'Source', type: 'frame.rgba', optional: false },
      { id: 'mask', label: 'Mask', type: 'frame.rgba', optional: false },
      { id: 'amount', label: 'Amount', type: 'control.f32', optional: true },
    ]);
    expect(getDefaultParams('mask')).toEqual({
      channel: 'luminance',
      amount: 1,
      invert: 'off',
    });

    expect(OPERATOR_REGISTRY.composite.inputs).toEqual([
      {
        id: 'background',
        label: 'Background',
        type: 'frame.rgba',
        optional: false,
      },
      {
        id: 'foreground',
        label: 'Foreground',
        type: 'frame.rgba',
        optional: false,
      },
      { id: 'opacity', label: 'Opacity', type: 'control.f32', optional: true },
    ]);
    expect(getDefaultParams('composite')).toEqual({
      operation: 'sourceOver',
      opacity: 1,
    });
    expect(OPERATOR_REGISTRY.composite.params.operation).toMatchObject({
      type: 'select',
      options: [
        { value: 'sourceOver', label: 'Source Over' },
        { value: 'destinationOver', label: 'Destination Over' },
        { value: 'sourceIn', label: 'Source In' },
        { value: 'sourceOut', label: 'Source Out' },
        { value: 'sourceAtop', label: 'Source Atop' },
        { value: 'xor', label: 'XOR' },
      ],
    });

    expect(OPERATOR_REGISTRY.frameSwitch.inputs).toEqual([
      { id: 'a', label: 'A', type: 'frame.rgba', optional: false },
      { id: 'b', label: 'B', type: 'frame.rgba', optional: true },
      { id: 'c', label: 'C', type: 'frame.rgba', optional: true },
      { id: 'd', label: 'D', type: 'frame.rgba', optional: true },
      { id: 'index', label: 'Index', type: 'control.f32', optional: true },
    ]);
    expect(getDefaultParams('frameSwitch')).toEqual({ index: 0 });
  });

  it('defines the XY pad as two normalized editable control outputs', () => {
    const definition = OPERATOR_REGISTRY.xyPad;

    expect(definition.domain).toBe('control');
    expect(definition.inputs).toEqual([]);
    expect(definition.outputs).toEqual([
      { id: 'x', label: 'X', type: 'control.f32', optional: false },
      { id: 'y', label: 'Y', type: 'control.f32', optional: false },
    ]);
    expect(definition.params).toEqual({
      x: {
        type: 'number',
        label: 'X',
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
      y: {
        type: 'number',
        label: 'Y',
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
    });
    expect(definition.parameterLayout).toEqual({
      type: 'xy',
      label: 'Position',
      xParamId: 'x',
      yParamId: 'y',
    });
    expect(getDefaultParams('xyPad')).toEqual({ x: 0.5, y: 0.5 });
  });
});
