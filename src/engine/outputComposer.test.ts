import { describe, expect, it, vi } from 'vitest';

import type { OutputLayout, SurfaceLayout } from '../store/contracts';
import { createMeshWarp } from './surfaceLayout';
import { createMaskPath, rectangleMaskNodes } from './surfaceMask';
import {
  blendOperation,
  composeOutput,
  planOutputs,
  type OutputSource,
} from './outputComposer';

const SIZE = { width: 400, height: 200 };

const surface = (overrides: Partial<SurfaceLayout> = {}): SurfaceLayout => ({
  id: 'surface-1',
  sourceNodeId: 'plasma-1',
  sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
  warp: null,
  maskPaths: [],
  outputId: 'output-1',
  layerIndex: 0,
  visible: true,
  blend: 'normal',
  opacity: 1,
  ...overrides,
});

const output = (surfaces: SurfaceLayout[]): OutputLayout => ({
  id: 'output-1',
  name: 'Main Display',
  width: 1920,
  height: 1080,
  layoutX: 0,
  layoutY: 0,
  surfaces,
});

interface Call {
  name: string;
  args: readonly unknown[];
}

function recorder() {
  const calls: Call[] = [];
  const blends: GlobalCompositeOperation[] = [];
  const alphas: number[] = [];
  const context = {
    save: () => calls.push({ name: 'save', args: [] }),
    restore: () => calls.push({ name: 'restore', args: [] }),
    beginPath: () => calls.push({ name: 'beginPath', args: [] }),
    moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
    closePath: () => calls.push({ name: 'closePath', args: [] }),
    clip: () => calls.push({ name: 'clip', args: [] }),
    fill: () => calls.push({ name: 'fill', args: [] }),
    setTransform: (...args: unknown[]) => calls.push({ name: 'setTransform', args }),
    drawImage: (...args: unknown[]) => {
      blends.push(context.globalCompositeOperation);
      alphas.push(context.globalAlpha);
      calls.push({ name: 'drawImage', args });
    },
    clearRect: (...args: unknown[]) => calls.push({ name: 'clearRect', args }),
    fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
    filter: 'none',
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    globalAlpha: 1,
  };
  return { calls, blends, alphas, context };
}

const fakeImage = {} as CanvasImageSource;
const makeSource = (): OutputSource => ({
  image: fakeImage,
  width: 200,
  height: 100,
});

function targets() {
  const main = recorder();
  const layer = recorder();
  const mask = recorder();
  return {
    main,
    layer,
    mask,
    options: {
      layer: { context: layer.context, canvas: fakeImage },
      mask: { context: mask.context, canvas: fakeImage },
      size: SIZE,
    },
  };
}

describe('blend mapping', () => {
  it('maps every surface blend to a canvas operation', () => {
    expect(blendOperation('normal')).toBe('source-over');
    expect(blendOperation('add')).toBe('lighter');
    expect(blendOperation('multiply')).toBe('multiply');
    expect(blendOperation('screen')).toBe('screen');
  });
});

describe('composeOutput', () => {
  it('clears the destination before drawing', () => {
    const { main, options } = targets();
    composeOutput(main.context, output([surface()]), {
      ...options,
      resolveSource: makeSource,
    });
    expect(main.calls[0]?.name).toBe('save');
    expect(main.calls.some(({ name }) => name === 'clearRect')).toBe(true);
  });

  it('composites each surface through its own layer', () => {
    const { main, options } = targets();
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', layerIndex: 0 }),
        surface({ id: 'b', layerIndex: 1 }),
      ]),
      { ...options, resolveSource: makeSource },
    );
    expect(report.drawn).toBe(2);
    expect(main.calls.filter(({ name }) => name === 'drawImage')).toHaveLength(2);
  });

  it('resolves a shared source exactly once', () => {
    const { main, options } = targets();
    const resolveSource = vi.fn(makeSource);
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', sourceNodeId: 'shared' }),
        surface({ id: 'b', sourceNodeId: 'shared', layerIndex: 1 }),
        surface({ id: 'c', sourceNodeId: 'shared', layerIndex: 2 }),
      ]),
      { ...options, resolveSource },
    );
    expect(resolveSource).toHaveBeenCalledTimes(1);
    expect(report.sourceEvaluations).toBe(1);
    expect(report.drawn).toBe(3);
  });

  it('resolves distinct sources once each', () => {
    const { main, options } = targets();
    const resolveSource = vi.fn(makeSource);
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', sourceNodeId: 'one' }),
        surface({ id: 'b', sourceNodeId: 'two', layerIndex: 1 }),
      ]),
      { ...options, resolveSource },
    );
    expect(resolveSource).toHaveBeenCalledTimes(2);
    expect(report.sourceEvaluations).toBe(2);
  });

  it('draws in ascending layer order', () => {
    const { main, options } = targets();
    const seen: string[] = [];
    composeOutput(
      main.context,
      output([
        surface({ id: 'top', layerIndex: 2, sourceNodeId: 'top' }),
        surface({ id: 'bottom', layerIndex: 0, sourceNodeId: 'bottom' }),
        surface({ id: 'middle', layerIndex: 1, sourceNodeId: 'middle' }),
      ]),
      {
        ...options,
        resolveSource: (nodeId) => {
          seen.push(nodeId);
          return makeSource();
        },
      },
    );
    expect(seen).toEqual(['bottom', 'middle', 'top']);
  });

  it('applies opacity and blend at composite time', () => {
    const { main, options } = targets();
    composeOutput(
      main.context,
      output([surface({ opacity: 0.4, blend: 'screen' })]),
      { ...options, resolveSource: makeSource },
    );
    expect(main.alphas).toEqual([0.4]);
    expect(main.blends).toEqual(['screen']);
  });

  it('skips hidden and fully transparent surfaces', () => {
    const { main, options } = targets();
    const resolveSource = vi.fn(makeSource);
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', visible: false }),
        surface({ id: 'b', opacity: 0, layerIndex: 1 }),
      ]),
      { ...options, resolveSource },
    );
    expect(report.drawn).toBe(0);
    expect(report.skipped).toBe(2);
    expect(resolveSource).not.toHaveBeenCalled();
  });

  it('reports a missing source and still draws the others', () => {
    const { main, options } = targets();
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', sourceNodeId: 'gone' }),
        surface({ id: 'b', sourceNodeId: 'present', layerIndex: 1 }),
      ]),
      {
        ...options,
        resolveSource: (nodeId) =>
          nodeId === 'present' ? makeSource() : undefined,
      },
    );
    expect(report.missingSources).toEqual(['gone']);
    expect(report.drawn).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it('retries a missing source only once per frame', () => {
    const { main, options } = targets();
    const resolveSource = vi.fn(() => undefined);
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', sourceNodeId: 'gone' }),
        surface({ id: 'b', sourceNodeId: 'gone', layerIndex: 1 }),
      ]),
      { ...options, resolveSource },
    );
    expect(resolveSource).toHaveBeenCalledTimes(1);
    expect(report.missingSources).toEqual(['gone']);
  });

  it('counts rasterized triangles across surfaces', () => {
    const { main, options } = targets();
    const report = composeOutput(
      main.context,
      output([
        surface({ id: 'a', warp: createMeshWarp(2, 2) }),
        surface({ id: 'b', layerIndex: 1 }),
      ]),
      { ...options, resolveSource: makeSource },
    );
    // A 2x2 mesh is eight triangles; an unmapped surface is two.
    expect(report.triangles).toBe(10);
  });

  it('masks a surface without erasing the one beneath it', () => {
    const { main, layer, mask, options } = targets();
    composeOutput(
      main.context,
      output([
        surface({ id: 'base', layerIndex: 0 }),
        surface({
          id: 'masked',
          layerIndex: 1,
          maskPaths: [
            createMaskPath(rectangleMaskNodes(0.2, 0.2, 0.8, 0.8), true, 0),
          ],
        }),
      ]),
      { ...options, resolveSource: makeSource },
    );
    // Masking happens on the scratch layer, never on the output itself.
    expect(mask.calls.some(({ name }) => name === 'fill')).toBe(true);
    expect(layer.context.globalCompositeOperation).toBe('destination-in');
    expect(main.blends).toEqual(['source-over', 'source-over']);
  });

  it('handles an output with no surfaces', () => {
    const { main, options } = targets();
    const report = composeOutput(main.context, output([]), {
      ...options,
      resolveSource: makeSource,
    });
    expect(report).toMatchObject({ drawn: 0, skipped: 0, sourceEvaluations: 0 });
  });
});

describe('planOutputs', () => {
  it('lists distinct source nodes across outputs', () => {
    const plan = planOutputs([
      output([
        surface({ id: 'a', sourceNodeId: 'one' }),
        surface({ id: 'b', sourceNodeId: 'two', layerIndex: 1 }),
        surface({ id: 'c', sourceNodeId: 'one', layerIndex: 2 }),
      ]),
    ]);
    expect(plan.sourceNodeIds).toEqual(['one', 'two']);
    expect(plan.valid).toBe(true);
  });

  it('flags an output with no surfaces', () => {
    const plan = planOutputs([output([])]);
    expect(plan.issues.map(({ message }) => message).join(' ')).toContain(
      'has no surfaces',
    );
  });

  it('reports invalid geometry from the layout validator', () => {
    const plan = planOutputs([
      { ...output([surface()]), width: 0 },
    ]);
    expect(plan.valid).toBe(false);
    expect(plan.issues.length).toBeGreaterThan(0);
  });
});
