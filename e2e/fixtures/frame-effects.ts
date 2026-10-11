import { WebGLRenderer } from '../../src/engine/WebGLRenderer';
import { createGraphNode, createGraphPreset, GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphParams, type NodeKind } from '../../src/graph';

function run() {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('Missing fixture canvas.');
  const renderer = new WebGLRenderer(canvas, { width: 96, height: 64, pixelRatio: 1 });
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is required.');
  const read = (time: number) => {
    const result = renderer.render(time);
    if (result.error) throw new Error(result.error);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GPU error ${error}`);
    return pixels;
  };
  const install = (kind: NodeKind, params: GraphParams = {}, patterned = false) => {
    const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [
      createGraphNode(patterned ? 'gradient' : 'solid', { x: 0, y: 0 }, patterned ? {} : { red: 1, green: 0, blue: 0, alpha: 0.5 }, 'source'),
      createGraphNode('solid', { x: 0, y: 400 }, { red: 0, green: 0, blue: 1, alpha: 0.75 }, 'other'),
      createGraphNode(kind, { x: 300, y: 0 }, params, 'effect'),
      createGraphNode('display', { x: 600, y: 0 }, {}, 'output'),
    ], edges: [
      { id: 'source', source: { nodeId: 'source', portId: 'frame' }, target: { nodeId: 'effect', portId: 'source' } },
      { id: 'output', source: { nodeId: 'effect', portId: 'frame' }, target: { nodeId: 'output', portId: 'source' } },
    ] };
    if (kind === 'liquidMorph' || kind === 'particleTransition') document.edges.push({ id: 'other', source: { nodeId: 'other', portId: 'frame' }, target: { nodeId: 'effect', portId: 'map' } });
    renderer.setGraph(document);
    return document;
  };
  const center = (pixels: Uint8Array) => Array.from(pixels.slice((32 * 96 + 48) * 4, (32 * 96 + 48) * 4 + 4));
  const samples: Record<string, number[]> = {};
  for (const [kind, params] of [
    ['chromaticAberration', { amount: 0, distortion: 0 }], ['scanlines', { amount: 0, chroma: 0 }],
    ['bloom', { strength: 0 }], ['liquidMorph', { mix: 0 }], ['particleTransition', { mix: 0, density: 100 }],
  ] as [NodeKind, GraphParams][]) { install(kind, params); samples[kind] = center(read(0)); }
  install('liquidMorph', { mix: 1 }); samples.morphEnd = center(read(0));
  install('particleTransition', { mix: 1 }); samples.particleEnd = center(read(0));
  install('particleTransition', { mix: 0.45, density: 100 }); samples.particleMiddle = center(read(0));
  const changes: Record<string, boolean> = {};
  for (const [kind, neutral, active] of [
    ['chromaticAberration', { amount: 0, distortion: 0 }, { amount: 0.3, distortion: 0.5 }],
    ['bloom', { strength: 0 }, { strength: 3, threshold: 0.1 }],
    ['scanlines', { amount: 0, chroma: 0 }, { amount: 0.8, chroma: 0.4 }],
  ] as [NodeKind, GraphParams, GraphParams][]) {
    install(kind, neutral, true); const before = read(0);
    install(kind, active, true); const after = read(0);
    changes[kind] = before.some((value, index) => value !== after[index]);
  }
  install('liquidMetaballs', { pointerX: 0.8, attraction: 1 });
  renderer.reset(); const initial = read(0); const moved = read(0.2); const held = read(0.2);
  renderer.reset(); const reset = read(0);
  const liquid = { moves: initial.some((value, index) => value !== moved[index]), holds: held.every((value, index) => value === moved[index]), resets: reset.every((value, index) => value === initial[index]) };
  const presets = [];
  for (const id of ['prism-glow-lab', 'liquid-surface-lab', 'particle-transition-lab', 'infinity-mirror-lab'] as const) {
    renderer.setGraph(createGraphPreset(id)); renderer.reset(); read(0);
    const pixels = read(0.1);
    presets.push({ id, visible: pixels.some((value, index) => index % 4 !== 3 && value > 20) });
  }
  install('particleTransition', { mix: 0.4 }); read(0);
  Reflect.set(globalThis, 'recoverFrameEffects', async () => {
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Context loss extension unavailable.');
    const lost = new Promise<void>((resolve) => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    extension.loseContext(); await lost;
    const restored = new Promise<void>((resolve) => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
    setTimeout(() => extension.restoreContext(), 100); await restored;
    read(0); install('liquidMetaballs'); read(0);
    renderer.setGraph(createGraphPreset('blank')); read(0); renderer.dispose();
    return true;
  });
  return { samples, changes, liquid, presets };
}

Reflect.set(globalThis, 'runFrameEffects', run);