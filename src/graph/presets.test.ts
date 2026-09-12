import { describe, expect, it } from 'vitest';

import { compileGraph } from './compiler';
import { createDefaultGraph } from './defaultGraph';
import { NODE_KINDS } from './types';
import {
  GRAPH_PRESETS,
  FOUNDATION_NODE_EXAMPLES,
  NODE_EXAMPLES,
  createGraphPreset,
  getGraphPreset,
} from './presets';

describe('graph presets', () => {
  it('provides unique, discoverable preset metadata', () => {
    expect(GRAPH_PRESETS).toHaveLength(20);
    expect(new Set(GRAPH_PRESETS.map(({ id }) => id)).size).toBe(
      GRAPH_PRESETS.length,
    );
    expect(new Set(GRAPH_PRESETS.map(({ title }) => title)).size).toBe(
      GRAPH_PRESETS.length,
    );
    expect(getGraphPreset('blank').title).toBe('Blank Canvas');
  });

  it.each(GRAPH_PRESETS)('$title creates a valid graph', ({ id }) => {
    const document = createGraphPreset(id);
    const compiled = compileGraph(document);

    expect(compiled.document).toEqual(document);
    expect(
      document.nodes.every((node) => NODE_KINDS.includes(node.kind)),
    ).toBe(true);
    expect(new Set(document.nodes.map(({ id: nodeId }) => nodeId)).size).toBe(
      document.nodes.length,
    );
    expect(new Set(document.edges.map(({ id: edgeId }) => edgeId)).size).toBe(
      document.edges.length,
    );
  });

  it.each(
    GRAPH_PRESETS.filter(({ id }) => id !== 'blank'),
  )('$title has a complete visible frame path', ({ id }) => {
    const document = createGraphPreset(id);
    const compiled = compileGraph(document);

    expect(compiled.displayNodes).toHaveLength(1);
    expect(compiled.frameNodes.length).toBeGreaterThan(0);
    expect(compiled.reachableNodeIds.size).toBe(document.nodes.length);
  });

  it.each(NODE_KINDS)('%s has a reachable bundled example', (kind) => {
    const hasReachableExample = GRAPH_PRESETS.some(({ id }) => {
      if (id === 'blank') {
        return false;
      }
      const document = createGraphPreset(id);
      const compiled = compileGraph(document);
      return document.nodes.some(
        (node) => node.kind === kind && compiled.reachableNodeIds.has(node.id),
      );
    });

    expect(hasReachableExample).toBe(true);
  });

  it('keeps Blank Canvas truly empty', () => {
    const blank = createGraphPreset('blank');

    expect(blank.nodes).toEqual([]);
    expect(blank.edges).toEqual([]);
  });

  it('maps Full Studio to the built-in composition', () => {
    expect(createGraphPreset('full-studio')).toEqual(createDefaultGraph());
  });

  it.each(Object.entries(NODE_EXAMPLES))(
    '%s is taught by a reachable starter path',
    (kind, presetIds) => {
      expect(presetIds.length).toBeGreaterThan(0);

      for (const presetId of presetIds) {
        const document = createGraphPreset(presetId);
        const compiled = compileGraph(document);
        const examples = document.nodes.filter((node) => node.kind === kind);

        expect(examples.length).toBeGreaterThan(0);
        expect(
          examples.every((node) => compiled.reachableNodeIds.has(node.id)),
        ).toBe(true);
        expect(compiled.displayNodes).toHaveLength(1);
      }
    },
  );

  it('preserves the foundation example export contract', () => {
    expect(Object.keys(FOUNDATION_NODE_EXAMPLES)).toEqual([
      'constant',
      'math',
      'mapRange',
      'smooth',
      'transform2d',
    ]);
  });

  it('wires the compositing lesson from generators through a matte to Display', () => {
    const document = createGraphPreset('mask-composite-lab');

    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'mask-lab-matte-source', portId: 'frame' },
          target: { nodeId: 'mask-lab-threshold', portId: 'source' },
        }),
        expect.objectContaining({
          source: { nodeId: 'mask-lab-threshold', portId: 'frame' },
          target: { nodeId: 'mask-lab-mask', portId: 'mask' },
        }),
        expect.objectContaining({
          source: { nodeId: 'mask-lab-mask', portId: 'frame' },
          target: { nodeId: 'mask-lab-composite', portId: 'foreground' },
        }),
        expect.objectContaining({
          source: { nodeId: 'mask-lab-composite', portId: 'frame' },
          target: { nodeId: 'mask-lab-display', portId: 'source' },
        }),
      ]),
    );
  });

  it('routes all four sources and a tempo-mapped index through Beat Switcher', () => {
    const document = createGraphPreset('beat-switcher');
    const range = document.nodes.find(({ id }) => id === 'beat-switch-map');
    const routerInputs = document.edges
      .filter(({ target }) => target.nodeId === 'beat-switch-router')
      .map(({ target }) => target.portId);

    expect(routerInputs).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'index']));
    expect(document.edges).toContainEqual(
      expect.objectContaining({
        source: { nodeId: 'beat-switch-clock', portId: 'bar' },
        target: { nodeId: 'beat-switch-map', portId: 'value' },
      }),
    );
    expect(range?.params).toMatchObject({ outMin: -0.5, outMax: 3.5 });

    const selectedIndex = (barPhase: number) =>
      Math.max(0, Math.min(3, Math.round(-0.5 + barPhase * 4)));
    expect([
      selectedIndex(0),
      selectedIndex(0.249),
      selectedIndex(0.25),
      selectedIndex(0.499),
      selectedIndex(0.5),
      selectedIndex(0.749),
      selectedIndex(0.75),
      selectedIndex(0.999),
    ]).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('teaches deterministic live cuts and phase-bound pulsing below one cycle per second', () => {
    const document = createGraphPreset('live-cut-lab');
    const compiled = compileGraph(document);
    const selector = document.nodes.find(
      ({ id }) => id === 'live-cut-selector',
    );
    const strobe = document.nodes.find(({ id }) => id === 'live-cut-strobe');
    const switchInputs = document.edges
      .filter(({ target }) => target.nodeId === 'live-cut-switch')
      .map(({ target }) => target.portId);

    expect(selector).toMatchObject({
      kind: 'autoSelector',
      params: {
        interval: 1.5,
        count: 4,
        order: 'shuffleBag',
        seed: 23,
      },
    });
    expect(strobe).toMatchObject({
      kind: 'strobe',
      params: {
        duty: 0.82,
        amount: true,
        closedMode: 'invert',
      },
    });
    expect(1 / Number(selector?.params.interval)).toBeLessThan(1);
    expect(switchInputs).toEqual(
      expect.arrayContaining(['a', 'b', 'c', 'd', 'index']),
    );
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'live-cut-time', portId: 'value' },
          target: { nodeId: 'live-cut-selector', portId: 'position' },
        }),
        expect.objectContaining({
          source: { nodeId: 'live-cut-selector', portId: 'index' },
          target: { nodeId: 'live-cut-switch', portId: 'index' },
        }),
        expect.objectContaining({
          source: { nodeId: 'live-cut-selector', portId: 'phase' },
          target: { nodeId: 'live-cut-strobe', portId: 'phase' },
        }),
        expect.objectContaining({
          source: { nodeId: 'live-cut-switch', portId: 'frame' },
          target: { nodeId: 'live-cut-strobe', portId: 'source' },
        }),
        expect.objectContaining({
          source: { nodeId: 'live-cut-strobe', portId: 'frame' },
          target: { nodeId: 'live-cut-grade', portId: 'source' },
        }),
        expect.objectContaining({
          source: { nodeId: 'live-cut-grade', portId: 'frame' },
          target: { nodeId: 'live-cut-display', portId: 'source' },
        }),
      ]),
    );
    expect(compiled.displayNodes).toHaveLength(1);
    expect(compiled.reachableNodeIds.size).toBe(document.nodes.length);
  });

  it('maps the audio control fallback to blur radius without an audio frame path', () => {
    const document = createGraphPreset('audio-soft-focus');
    const range = document.nodes.find(({ id }) => id === 'soft-focus-map');

    expect(range?.params).toMatchObject({ outMin: 0, outMax: 18 });
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'soft-focus-audio', portId: 'value' },
          target: { nodeId: 'soft-focus-map', portId: 'value' },
        }),
        expect.objectContaining({
          source: { nodeId: 'soft-focus-map', portId: 'value' },
          target: { nodeId: 'soft-focus-blur', portId: 'radius' },
        }),
      ]),
    );
  });

  it('ships the mapping and motion teaching paths as wired examples', () => {
    const controlMath = createGraphPreset('control-math');
    const smoothPointer = createGraphPreset('smooth-pointer');
    const transformPlayground = createGraphPreset('transform-playground');

    expect(controlMath.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'control-math-constant', portId: 'value' },
          target: { nodeId: 'control-math-multiply', portId: 'b' },
        }),
        expect.objectContaining({
          source: { nodeId: 'control-math-map', portId: 'value' },
          target: { nodeId: 'control-math-blend', portId: 'mix' },
        }),
      ]),
    );
    expect(
      controlMath.nodes.find(({ id }) => id === 'control-math-blend')?.params,
    ).toMatchObject({ mode: 'normal' });
    expect(smoothPointer.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'smooth-pointer-map', portId: 'value' },
          target: { nodeId: 'smooth-pointer-slew', portId: 'value' },
        }),
        expect.objectContaining({
          source: { nodeId: 'smooth-pointer-slew', portId: 'value' },
          target: { nodeId: 'smooth-pointer-transform', portId: 'x' },
        }),
      ]),
    );
    expect(transformPlayground.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'transform-play-map-x', portId: 'value' },
          target: { nodeId: 'transform-play-transform', portId: 'x' },
        }),
        expect.objectContaining({
          source: { nodeId: 'transform-play-rotation', portId: 'value' },
          target: { nodeId: 'transform-play-transform', portId: 'rotation' },
        }),
      ]),
    );
  });

  it('crossfades the complete range between both mixer sources', () => {
    const mixer = createGraphPreset('two-world-mixer');
    const oscillator = mixer.nodes.find(({ id }) => id === 'mixer-wave');
    const blend = mixer.nodes.find(({ id }) => id === 'mixer-blend');

    expect(oscillator?.params).toMatchObject({ amplitude: 1, offset: 0 });
    expect(blend?.params.mode).toBe('normal');
    expect(mixer.edges).toContainEqual(
      expect.objectContaining({
        source: { nodeId: 'mixer-wave', portId: 'value' },
        target: { nodeId: 'mixer-blend', portId: 'mix' },
      }),
    );
  });

  it('builds a bounded, movable spiral feedback lesson ending at Display', () => {
    const document = createGraphPreset('spiral-feedback-lab');
    const compiled = compileGraph(document);
    const spiral = document.nodes.find(
      ({ id }) => id === 'spiral-lab-feedback',
    );

    expect(spiral).toMatchObject({
      kind: 'feedbackSpiral',
      params: {
        feedback: 0.82,
        rotation: 42,
        zoom: 1.16,
        centerX: 0.46,
        centerY: 0.54,
      },
    });
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { nodeId: 'spiral-lab-cells', portId: 'frame' },
          target: { nodeId: 'spiral-lab-feedback', portId: 'source' },
        }),
        expect.objectContaining({
          source: { nodeId: 'spiral-lab-center', portId: 'x' },
          target: { nodeId: 'spiral-lab-feedback', portId: 'centerX' },
        }),
        expect.objectContaining({
          source: { nodeId: 'spiral-lab-center', portId: 'y' },
          target: { nodeId: 'spiral-lab-feedback', portId: 'centerY' },
        }),
        expect.objectContaining({
          source: { nodeId: 'spiral-lab-feedback', portId: 'frame' },
          target: { nodeId: 'spiral-lab-grade', portId: 'source' },
        }),
        expect.objectContaining({
          source: { nodeId: 'spiral-lab-grade', portId: 'frame' },
          target: { nodeId: 'spiral-lab-display', portId: 'source' },
        }),
      ]),
    );
    expect(compiled.displayNodes).toHaveLength(1);
    expect(compiled.reachableNodeIds.size).toBe(document.nodes.length);
  });

  it('returns a fresh graph for every selection', () => {
    const first = createGraphPreset('pointer-bend');
    const second = createGraphPreset('pointer-bend');
    const firstNode = first.nodes[0];
    const secondNode = second.nodes[0];

    expect(first).not.toBe(second);
    expect(firstNode).toBeDefined();
    expect(secondNode).toBeDefined();
    if (!firstNode || !secondNode) {
      return;
    }

    firstNode.position.x = 999;
    expect(secondNode.position.x).not.toBe(999);
  });
});
