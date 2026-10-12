import { WebGLRenderer } from '../../src/engine/WebGLRenderer';
import {
  createGraphNode,
  GRAPH_SCHEMA_VERSION,
  type GraphDocument,
  type GraphParams,
} from '../../src/graph';

const WIDTH = 96;
const HEIGHT = 64;

function run() {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('Missing fixture canvas.');
  const renderer = new WebGLRenderer(canvas, {
    width: WIDTH,
    height: HEIGHT,
    pixelRatio: 1,
  });
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is required.');

  const read = () => {
    const result = renderer.render(0);
    if (result.error) throw new Error(result.error);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GPU error ${error}`);
    return pixels;
  };

  /** Opaque red source; `mapped` false routes it straight to Display. */
  const install = (params: GraphParams | null) => {
    const source = createGraphNode(
      'solid',
      { x: 0, y: 0 },
      { red: 1, green: 0, blue: 0, alpha: 1 },
      'source',
    );
    const display = createGraphNode('display', { x: 600, y: 0 }, {}, 'output');
    if (params === null) {
      const document: GraphDocument = {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        nodes: [source, display],
        edges: [
          {
            id: 'direct',
            source: { nodeId: 'source', portId: 'frame' },
            target: { nodeId: 'output', portId: 'source' },
          },
        ],
      };
      renderer.setGraph(document);
      return;
    }
    const document: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [
        source,
        createGraphNode('projectorMapping', { x: 300, y: 0 }, params, 'map'),
        display,
      ],
      edges: [
        {
          id: 'source',
          source: { nodeId: 'source', portId: 'frame' },
          target: { nodeId: 'map', portId: 'source' },
        },
        {
          id: 'output',
          source: { nodeId: 'map', portId: 'frame' },
          target: { nodeId: 'output', portId: 'source' },
        },
      ],
    };
    renderer.setGraph(document);
  };

  /**
   * Samples one pixel addressed in screen fractions (y-down, top-left origin).
   * readPixels returns rows bottom-up, so the row is flipped here.
   */
  const sampleScreen = (
    pixels: Uint8Array,
    screenX: number,
    screenY: number,
  ): number[] => {
    const column = Math.min(WIDTH - 1, Math.floor(screenX * WIDTH));
    const rowFromTop = Math.min(HEIGHT - 1, Math.floor(screenY * HEIGHT));
    const rowFromBottom = HEIGHT - 1 - rowFromTop;
    const offset = (rowFromBottom * WIDTH + column) * 4;
    return Array.from(pixels.slice(offset, offset + 4));
  };

  const fullFrame = {
    x0: 0,
    y0: 0,
    x1: 1,
    y1: 0,
    x2: 1,
    y2: 1,
    x3: 0,
    y3: 1,
  };

  install(null);
  const passthrough = read();

  // An identity quad must leave the frame untouched: any transposed or
  // mis-indexed homography shows up here first.
  install({ ...fullFrame, edgeMode: 'transparent' });
  const identity = read();
  const identityMatchesSource = identity.every(
    (value, index) => value === passthrough[index],
  );

  // Asymmetric placement: the source is pinned into the top-left screen
  // quadrant, so each quadrant centre reports a distinct expected result.
  install({
    x0: 0,
    y0: 0,
    x1: 0.5,
    y1: 0,
    x2: 0.5,
    y2: 0.5,
    x3: 0,
    y3: 0.5,
    edgeMode: 'transparent',
  });
  const quadrantPixels = read();
  const quadrants = {
    topLeft: sampleScreen(quadrantPixels, 0.25, 0.25),
    topRight: sampleScreen(quadrantPixels, 0.75, 0.25),
    bottomRight: sampleScreen(quadrantPixels, 0.75, 0.75),
    bottomLeft: sampleScreen(quadrantPixels, 0.25, 0.75),
  };

  // Shipped node defaults inset the quad to 0.14..0.86 x 0.2..0.8. Before the
  // homography fix this solved to null and rendered an unwarped frame.
  install({ edgeMode: 'transparent' });
  const defaultsPixels = read();
  const defaults = {
    centre: sampleScreen(defaultsPixels, 0.5, 0.5),
    outsideTop: sampleScreen(defaultsPixels, 0.5, 0.05),
    outsideLeft: sampleScreen(defaultsPixels, 0.03, 0.5),
    differsFromSource: defaultsPixels.some(
      (value, index) => value !== passthrough[index],
    ),
  };

  // A collapsed quad must fail safe rather than smear the frame.
  install({
    x0: 0.5,
    y0: 0.5,
    x1: 0.5,
    y1: 0.5,
    x2: 0.5,
    y2: 0.5,
    x3: 0.5,
    y3: 0.5,
    edgeMode: 'transparent',
  });
  const degenerate = read();
  const degenerateIsFinite = degenerate.every((value) => Number.isFinite(value));

  Reflect.set(globalThis, 'disposeProjectorMapping', () => {
    renderer.dispose();
    return true;
  });

  return {
    identityMatchesSource,
    quadrants,
    defaults,
    degenerateIsFinite,
  };
}

Reflect.set(globalThis, 'runProjectorMapping', run);
