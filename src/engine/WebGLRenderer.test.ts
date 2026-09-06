import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  GRAPH_SCHEMA_VERSION,
  MAX_RENDER_DIMENSION,
  MAX_RENDER_PIXELS,
  cloneGraphDocument,
  createGraphNode,
  type GraphDocument,
} from '../graph';
import {
  WebGLRenderer,
  constrainRenderSize,
  readImageFrameSize,
  readVideoFrameSize,
} from './WebGLRenderer';

interface FakeWebGLContext {
  gl: WebGL2RenderingContext;
  bindTexture: Mock;
  clearColor: Mock;
  createTexture: Mock;
  deleteTexture: Mock;
  drawArrays: Mock;
  pixelStorei: Mock;
  texImage2D: Mock;
  uniform1f: Mock;
  uniform2f: Mock;
  uniform4f: Mock;
}

function createFakeWebGLContext(): FakeWebGLContext {
  let resourceId = 0;
  const resource = () => ({ id: (resourceId += 1) });
  const deleteTexture = vi.fn();
  const createTexture = vi.fn(resource);
  const bindTexture = vi.fn();
  const clearColor = vi.fn();
  const pixelStorei = vi.fn();
  const texImage2D = vi.fn();
  const uniform1f = vi.fn();
  const uniform2f = vi.fn();
  const uniform4f = vi.fn();
  const drawArrays = vi.fn();
  const gl = {
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    BLEND: 0x0be2,
    MAX_TEXTURE_SIZE: 0x0d33,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    UNSIGNED_BYTE: 0x1401,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
    COLOR_BUFFER_BIT: 0x4000,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    TRIANGLES: 0x0004,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    getParameter: vi.fn(() => MAX_RENDER_DIMENSION),
    disable: vi.fn(),
    createVertexArray: vi.fn(resource),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createTexture,
    deleteTexture,
    bindTexture,
    texParameteri: vi.fn(),
    texImage2D,
    texStorage2D: vi.fn(),
    pixelStorei,
    createFramebuffer: vi.fn(resource),
    deleteFramebuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    viewport: vi.fn(),
    clearColor,
    clear: vi.fn(),
    createShader: vi.fn(resource),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => null),
    deleteShader: vi.fn(),
    createProgram: vi.fn(resource),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => null),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn(
      (_program: WebGLProgram, name: string) => ({ name }),
    ),
    uniform1f,
    uniform1i: vi.fn(),
    uniform2f,
    uniform4f,
    activeTexture: vi.fn(),
    drawArrays,
  } as unknown as WebGL2RenderingContext;
  return {
    gl,
    bindTexture,
    clearColor,
    createTexture,
    deleteTexture,
    drawArrays,
    pixelStorei,
    texImage2D,
    uniform1f,
    uniform2f,
    uniform4f,
  };
}

function createVideoGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('videoInput', { x: 0, y: 0 }, {}, 'camera'),
      createGraphNode('display', { x: 300, y: 0 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'camera-to-display',
        source: { nodeId: 'camera', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createXYControlGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('xyPad', { x: 0, y: 0 }, { x: 0.23, y: 0.77 }, 'pad'),
      createGraphNode('plasma', { x: 250, y: 0 }, {}, 'source'),
      createGraphNode('colorGrade', { x: 500, y: 0 }, {}, 'grade'),
      createGraphNode('display', { x: 750, y: 0 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'source-grade',
        source: { nodeId: 'source', portId: 'frame' },
        target: { nodeId: 'grade', portId: 'source' },
      },
      {
        id: 'pad-grade-hue',
        source: { nodeId: 'pad', portId: 'x' },
        target: { nodeId: 'grade', portId: 'hue' },
      },
      {
        id: 'pad-grade-exposure',
        source: { nodeId: 'pad', portId: 'y' },
        target: { nodeId: 'grade', portId: 'exposure' },
      },
      {
        id: 'grade-display',
        source: { nodeId: 'grade', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createBeatClockGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('beatClock', { x: 0, y: 0 }, {}, 'beat'),
      createGraphNode('plasma', { x: 250, y: 0 }, {}, 'source'),
      createGraphNode('colorGrade', { x: 500, y: 0 }, {}, 'grade'),
      createGraphNode('display', { x: 750, y: 0 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'source-grade',
        source: { nodeId: 'source', portId: 'frame' },
        target: { nodeId: 'grade', portId: 'source' },
      },
      {
        id: 'beat-grade-hue',
        source: { nodeId: 'beat', portId: 'phase' },
        target: { nodeId: 'grade', portId: 'hue' },
      },
      {
        id: 'beat-grade-exposure',
        source: { nodeId: 'beat', portId: 'beat' },
        target: { nodeId: 'grade', portId: 'exposure' },
      },
      {
        id: 'bar-grade-saturation',
        source: { nodeId: 'beat', portId: 'bar' },
        target: { nodeId: 'grade', portId: 'saturation' },
      },
      {
        id: 'grade-display',
        source: { nodeId: 'grade', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createPointerControlGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('pointer', { x: 0, y: 0 }, {}, 'pointer'),
      createGraphNode('plasma', { x: 250, y: 0 }, {}, 'source'),
      createGraphNode('warp', { x: 500, y: 0 }, {}, 'warp'),
      createGraphNode('colorGrade', { x: 750, y: 0 }, {}, 'grade'),
      createGraphNode('display', { x: 1_000, y: 0 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'pointer-source-energy',
        source: { nodeId: 'pointer', portId: 'x' },
        target: { nodeId: 'source', portId: 'energy' },
      },
      {
        id: 'source-warp',
        source: { nodeId: 'source', portId: 'frame' },
        target: { nodeId: 'warp', portId: 'source' },
      },
      {
        id: 'pointer-warp-amount',
        source: { nodeId: 'pointer', portId: 'y' },
        target: { nodeId: 'warp', portId: 'amount' },
      },
      {
        id: 'warp-grade',
        source: { nodeId: 'warp', portId: 'frame' },
        target: { nodeId: 'grade', portId: 'source' },
      },
      {
        id: 'pointer-grade-hue',
        source: { nodeId: 'pointer', portId: 'down' },
        target: { nodeId: 'grade', portId: 'hue' },
      },
      {
        id: 'pointer-grade-exposure',
        source: { nodeId: 'pointer', portId: 'press' },
        target: { nodeId: 'grade', portId: 'exposure' },
      },
      {
        id: 'pointer-grade-saturation',
        source: { nodeId: 'pointer', portId: 'release' },
        target: { nodeId: 'grade', portId: 'saturation' },
      },
      {
        id: 'grade-display',
        source: { nodeId: 'grade', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createControlOutputGraph(
  controlNodes: GraphDocument['nodes'],
  controlEdges: GraphDocument['edges'],
  output: { nodeId: string; portId: string },
): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      ...controlNodes,
      createGraphNode('plasma', { x: 250, y: 0 }, {}, 'control-source'),
      createGraphNode('colorGrade', { x: 500, y: 0 }, {}, 'control-grade'),
      createGraphNode('display', { x: 750, y: 0 }, {}, 'control-display'),
    ],
    edges: [
      ...controlEdges,
      {
        id: 'control-source-grade',
        source: { nodeId: 'control-source', portId: 'frame' },
        target: { nodeId: 'control-grade', portId: 'source' },
      },
      {
        id: 'control-output-grade',
        source: output,
        target: { nodeId: 'control-grade', portId: 'saturation' },
      },
      {
        id: 'control-grade-display',
        source: { nodeId: 'control-grade', portId: 'frame' },
        target: { nodeId: 'control-display', portId: 'source' },
      },
    ],
  };
}

function createVideoModelGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('aiPrompt', { x: 0, y: 0 }, {}, 'prompt'),
      createGraphNode('videoModel', { x: 250, y: 0 }, {}, 'model'),
      createGraphNode('display', { x: 500, y: 0 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'prompt-model',
        source: { nodeId: 'prompt', portId: 'prompt' },
        target: { nodeId: 'model', portId: 'prompt' },
      },
      {
        id: 'model-display',
        source: { nodeId: 'model', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createTransform2dGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('plasma', { x: 0, y: 0 }, {}, 'source'),
      createGraphNode(
        'transform2d',
        { x: 250, y: 0 },
        {
          x: 0.25,
          y: -0.3,
          scale: 2,
          rotation: 90,
          pivotX: 0.2,
          pivotY: 0.8,
          edgeMode: 'mirror',
        },
        'transform',
      ),
      createGraphNode('display', { x: 500, y: 0 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'source-transform',
        source: { nodeId: 'source', portId: 'frame' },
        target: { nodeId: 'transform', portId: 'source' },
      },
      {
        id: 'transform-display',
        source: { nodeId: 'transform', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createFeedbackSpiralGraph(connectSource = true): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('plasma', { x: 0, y: 0 }, {}, 'spiral-source'),
      createGraphNode(
        'feedbackSpiral',
        { x: 250, y: 0 },
        {
          feedback: 0.64,
          rotation: 60,
          zoom: 1.21,
          centerX: 0.25,
          centerY: 0.75,
        },
        'spiral',
      ),
      createGraphNode('display', { x: 500, y: 0 }, {}, 'spiral-display'),
    ],
    edges: [
      ...(connectSource
        ? [
            {
              id: 'spiral-source-feedback',
              source: { nodeId: 'spiral-source', portId: 'frame' },
              target: { nodeId: 'spiral', portId: 'source' },
            },
          ]
        : []),
      {
        id: 'spiral-feedback-display',
        source: { nodeId: 'spiral', portId: 'frame' },
        target: { nodeId: 'spiral-display', portId: 'source' },
      },
    ],
  };
}

function createStrobeGraph(connectControls = true): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      ...(connectControls
        ? [
            createGraphNode(
              'constant',
              { x: 0, y: 0 },
              { value: -0.25 },
              'strobe-phase',
            ),
            createGraphNode(
              'constant',
              { x: 0, y: 120 },
              { value: 0.72 },
              'strobe-amount',
            ),
          ]
        : []),
      createGraphNode('plasma', { x: 0, y: 240 }, {}, 'strobe-source'),
      createGraphNode(
        'strobe',
        { x: 250, y: 120 },
        {
          rate: 3,
          duty: 0.6,
          amount: true,
          closedMode: 'invert',
        },
        'strobe',
      ),
      createGraphNode('display', { x: 500, y: 120 }, {}, 'strobe-display'),
    ],
    edges: [
      {
        id: 'strobe-source-effect',
        source: { nodeId: 'strobe-source', portId: 'frame' },
        target: { nodeId: 'strobe', portId: 'source' },
      },
      ...(connectControls
        ? [
            {
              id: 'strobe-phase-effect',
              source: { nodeId: 'strobe-phase', portId: 'value' },
              target: { nodeId: 'strobe', portId: 'phase' },
            },
            {
              id: 'strobe-amount-effect',
              source: { nodeId: 'strobe-amount', portId: 'value' },
              target: { nodeId: 'strobe', portId: 'amount' },
            },
          ]
        : []),
      {
        id: 'strobe-effect-display',
        source: { nodeId: 'strobe', portId: 'frame' },
        target: { nodeId: 'strobe-display', portId: 'source' },
      },
    ],
  };
}

function createCompositingGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode(
        'solid',
        { x: 0, y: 0 },
        { red: 0.2, green: 0.4, blue: 0.6, alpha: 0.8 },
        'background',
      ),
      createGraphNode('plasma', { x: 0, y: 180 }, {}, 'source'),
      createGraphNode(
        'blur',
        { x: 200, y: 180 },
        { radius: 12 },
        'blur',
      ),
      createGraphNode('cells', { x: 0, y: 360 }, {}, 'matte-source'),
      createGraphNode(
        'threshold',
        { x: 200, y: 360 },
        { channel: 'blue', level: 0.35, softness: 0.12, invert: 'on' },
        'threshold',
      ),
      createGraphNode(
        'mask',
        { x: 400, y: 180 },
        { channel: 'alpha', amount: 0.7, invert: 'on' },
        'mask',
      ),
      createGraphNode(
        'composite',
        { x: 600, y: 100 },
        { operation: 'sourceAtop', opacity: 0.65 },
        'composite',
      ),
      createGraphNode(
        'frameSwitch',
        { x: 800, y: 100 },
        { index: 1.6 },
        'switch',
      ),
      createGraphNode('display', { x: 1_000, y: 100 }, {}, 'display'),
    ],
    edges: [
      {
        id: 'source-blur',
        source: { nodeId: 'source', portId: 'frame' },
        target: { nodeId: 'blur', portId: 'source' },
      },
      {
        id: 'matte-threshold',
        source: { nodeId: 'matte-source', portId: 'frame' },
        target: { nodeId: 'threshold', portId: 'source' },
      },
      {
        id: 'blur-mask-source',
        source: { nodeId: 'blur', portId: 'frame' },
        target: { nodeId: 'mask', portId: 'source' },
      },
      {
        id: 'threshold-mask',
        source: { nodeId: 'threshold', portId: 'frame' },
        target: { nodeId: 'mask', portId: 'mask' },
      },
      {
        id: 'background-composite',
        source: { nodeId: 'background', portId: 'frame' },
        target: { nodeId: 'composite', portId: 'background' },
      },
      {
        id: 'mask-composite',
        source: { nodeId: 'mask', portId: 'frame' },
        target: { nodeId: 'composite', portId: 'foreground' },
      },
      {
        id: 'composite-switch',
        source: { nodeId: 'composite', portId: 'frame' },
        target: { nodeId: 'switch', portId: 'a' },
      },
      {
        id: 'switch-display',
        source: { nodeId: 'switch', portId: 'frame' },
        target: { nodeId: 'display', portId: 'source' },
      },
    ],
  };
}

function createImageFrame(
  width: number,
  height: number,
  complete = true,
): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperties(image, {
    complete: { configurable: true, value: complete },
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  return image;
}

function wroteUniform(uniform1f: Mock, name: string, value: number): boolean {
  return uniform1f.mock.calls.some(
    ([location, writtenValue]) =>
      (location as unknown as { name?: string } | null)?.name === name &&
      writtenValue === value,
  );
}

function wroteUniform2f(
  uniform2f: Mock,
  name: string,
  x: number,
  y: number,
): boolean {
  return uniform2f.mock.calls.some(
    ([location, writtenX, writtenY]) =>
      (location as unknown as { name?: string } | null)?.name === name &&
      writtenX === x &&
      writtenY === y,
  );
}

function wroteUniform4f(
  uniform4f: Mock,
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
): boolean {
  return uniform4f.mock.calls.some(
    ([location, writtenX, writtenY, writtenZ, writtenW]) =>
      (location as unknown as { name?: string } | null)?.name === name &&
      writtenX === x &&
      writtenY === y &&
      writtenZ === z &&
      writtenW === w,
  );
}

function lastUniformValue(uniform1f: Mock, name: string): number | undefined {
  for (let index = uniform1f.mock.calls.length - 1; index >= 0; index -= 1) {
    const call = uniform1f.mock.calls[index] as unknown[] | undefined;
    const location = call?.[0] as { name?: string } | null | undefined;
    const value = call?.[1];
    if (location?.name === name && typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

function createRendererHarness(): {
  bindTexture: Mock;
  canvas: HTMLCanvasElement;
  clearColor: Mock;
  createTexture: Mock;
  gl: WebGL2RenderingContext;
  deleteTexture: Mock;
  drawArrays: Mock;
  pixelStorei: Mock;
  renderer: WebGLRenderer;
  texImage2D: Mock;
  uniform1f: Mock;
  uniform2f: Mock;
  uniform4f: Mock;
} {
  const canvas = document.createElement('canvas');
  const {
    gl,
    bindTexture,
    clearColor,
    createTexture,
    deleteTexture,
    drawArrays,
    pixelStorei,
    texImage2D,
    uniform1f,
    uniform2f,
    uniform4f,
  } =
    createFakeWebGLContext();
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value: vi.fn(() => gl),
  });
  const renderer = new WebGLRenderer(canvas, {
    width: 640,
    height: 360,
    pixelRatio: 1,
  });
  renderer.setGraph(createVideoGraph());
  return {
    bindTexture,
    canvas,
    clearColor,
    createTexture,
    gl,
    deleteTexture,
    drawArrays,
    pixelStorei,
    renderer,
    texImage2D,
    uniform1f,
    uniform2f,
    uniform4f,
  };
}

describe('renderer size constraints', () => {
  it('keeps ordinary responsive dimensions and pixel density', () => {
    expect(constrainRenderSize(640, 360, 1.5, 1.5)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('scales large surfaces proportionally into dimension and pixel caps', () => {
    const result = constrainRenderSize(3_840, 2_160, 2);

    expect(result).toEqual({ width: 1_920, height: 1_080 });
    expect(result.width).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it('does not allow callers to raise the application caps', () => {
    const result = constrainRenderSize(
      8_000,
      8_000,
      4,
      20,
      MAX_RENDER_DIMENSION * 10,
      MAX_RENDER_PIXELS * 10,
    );

    expect(result.width).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it('normalizes invalid and non-positive dimensions safely', () => {
    expect(
      constrainRenderSize(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN),
    ).toEqual({ width: 1, height: 1 });
    expect(constrainRenderSize(-10, 0, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe('presentation frame-rate measurement', () => {
  it('counts paced presentations without including manual redraws', () => {
    const { renderer } = createRendererHarness();

    expect(renderer.render(0, 0, undefined, 0).fps).toBe(0);
    expect(renderer.render(1 / 60, 0, undefined, 1000 / 60).fps).toBeCloseTo(
      60,
      5,
    );
    expect(renderer.render(1 / 60).fps).toBeCloseTo(60, 5);
    renderer.dispose();
  });
});

describe('control-node evaluation', () => {
  it('routes a fixed Constant value to a control input', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'constant',
            { x: 0, y: 0 },
            { value: 0.73 },
            'constant',
          ),
        ],
        [],
        { nodeId: 'constant', portId: 'value' },
      ),
    );

    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 3 });
    expect(wroteUniform(uniform1f, 'uSaturation', 0.73)).toBe(true);
    renderer.dispose();
  });

  it.each([
    ['add', 0.8],
    ['subtract', 0.4],
    ['multiply', 0.12],
    ['divide', 3],
    ['min', 0.2],
    ['max', 0.6],
  ] as const)('evaluates the Math %s operation', (operation, expected) => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'math',
            { x: 0, y: 0 },
            { a: 0.6, b: 0.2, operation },
            'math',
          ),
        ],
        [],
        { nodeId: 'math', portId: 'value' },
      ),
    );

    expect(renderer.render(0)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(expected);
    renderer.dispose();
  });

  it('uses connected Math inputs and returns zero for division by zero', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'constant',
            { x: 0, y: 0 },
            { value: 0.9 },
            'constant',
          ),
          createGraphNode(
            'math',
            { x: 100, y: 0 },
            { a: 0.2, b: 0, operation: 'divide' },
            'math',
          ),
        ],
        [
          {
            id: 'constant-math-a',
            source: { nodeId: 'constant', portId: 'value' },
            target: { nodeId: 'math', portId: 'a' },
          },
        ],
        { nodeId: 'math', portId: 'value' },
      ),
    );

    expect(renderer.render(0)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(0);
    renderer.dispose();
  });

  it.each([
    ['none', 1.25],
    ['clamp', 1],
    ['wrap', 0.25],
    ['fold', 0.75],
  ] as const)('applies the Map Range %s boundary', (boundary, expected) => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'constant',
            { x: 0, y: 0 },
            { value: 1.25 },
            'constant',
          ),
          createGraphNode(
            'mapRange',
            { x: 100, y: 0 },
            { boundary },
            'map',
          ),
        ],
        [
          {
            id: 'constant-map',
            source: { nodeId: 'constant', portId: 'value' },
            target: { nodeId: 'map', portId: 'value' },
          },
        ],
        { nodeId: 'map', portId: 'value' },
      ),
    );

    expect(renderer.render(0)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(expected);
    renderer.dispose();
  });

  it('supports reversed Map Range inputs and safely handles a zero input span', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const mapGraph = (params: Record<string, number | string>) =>
      createControlOutputGraph(
        [
          createGraphNode(
            'constant',
            { x: 0, y: 0 },
            { value: 0.25 },
            'constant',
          ),
          createGraphNode('mapRange', { x: 100, y: 0 }, params, 'map'),
        ],
        [
          {
            id: 'constant-map',
            source: { nodeId: 'constant', portId: 'value' },
            target: { nodeId: 'map', portId: 'value' },
          },
        ],
        { nodeId: 'map', portId: 'value' },
      );

    renderer.setGraph(
      mapGraph({
        inMin: 1,
        inMax: 0,
        outMin: 0,
        outMax: 1,
        boundary: 'none',
      }),
    );
    expect(renderer.render(0)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.75);

    uniform1f.mockClear();
    renderer.setGraph(
      mapGraph({
        inMin: 1,
        inMax: 1,
        outMin: 0.4,
        outMax: 1,
        boundary: 'none',
      }),
    );
    expect(renderer.render(0)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.4);
    renderer.dispose();
  });

  it('routes each analyzed audio band through Audio Spectrum', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const spectrumGraph = (portId: string) =>
      createControlOutputGraph(
        [
          createGraphNode(
            'audioSpectrum',
            { x: 0, y: 0 },
            { gain: 1, floor: 0 },
            'spectrum',
          ),
        ],
        [],
        { nodeId: 'spectrum', portId },
      );
    const frame = { level: 0.5, bass: 0.9, mid: 0.4, treble: 0.2 };

    for (const [portId, expected] of Object.entries(frame)) {
      uniform1f.mockClear();
      renderer.setGraph(spectrumGraph(portId));
      expect(renderer.render(0, frame)).toMatchObject({ rendered: true });
      expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(expected);
    }
    renderer.dispose();
  });

  it('reads the patched audio source instead of the session default', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const patched = createControlOutputGraph(
      [
        createGraphNode('file', { x: -200, y: 0 }, {}, 'clip'),
        createGraphNode(
          'audioSpectrum',
          { x: 0, y: 0 },
          { gain: 1, floor: 0 },
          'spectrum',
        ),
      ],
      [
        {
          id: 'clip-spectrum',
          source: { nodeId: 'clip', portId: 'audio' },
          target: { nodeId: 'spectrum', portId: 'audio' },
        },
      ],
      { nodeId: 'spectrum', portId: 'bass' },
    );
    renderer.setGraph(patched);

    renderer.render(0, {
      frame: { level: 0.1, bass: 0.1, mid: 0.1, treble: 0.1 },
      sources: { clip: { level: 0.8, bass: 0.75, mid: 0.2, treble: 0.1 } },
    });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.75);

    // A patched source with no running audio reads silence, never the microphone.
    uniform1f.mockClear();
    renderer.render(0, {
      frame: { level: 0.9, bass: 0.9, mid: 0.9, treble: 0.9 },
      sources: {},
    });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0);
    renderer.dispose();
  });

  it('follows an Audio Level pass-through to the session microphone', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode('audioLevel', { x: -200, y: 0 }, {}, 'mic'),
          createGraphNode(
            'audioSpectrum',
            { x: 0, y: 0 },
            { gain: 1, floor: 0 },
            'spectrum',
          ),
        ],
        [
          {
            id: 'mic-spectrum',
            source: { nodeId: 'mic', portId: 'audio' },
            target: { nodeId: 'spectrum', portId: 'audio' },
          },
        ],
        { nodeId: 'spectrum', portId: 'treble' },
      ),
    );

    renderer.render(0, {
      frame: { level: 0.5, bass: 0.2, mid: 0.3, treble: 0.62 },
      sources: {},
    });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.62);
    renderer.dispose();
  });

  it('falls back to the overall level when Audio Trigger has no connected value', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'audioTrigger',
            { x: 0, y: 0 },
            { threshold: 0.2, sensitivity: 1, hold: 0.1, decay: 0.2 },
            'trigger',
          ),
        ],
        [],
        { nodeId: 'trigger', portId: 'envelope' },
      ),
    );

    renderer.render(0, { level: 0.9, bass: 0, mid: 0, treble: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(1);

    uniform1f.mockClear();
    renderer.render(1, { level: 0.02, bass: 0, mid: 0, treble: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeLessThan(0.01);
    renderer.dispose();
  });

  it('holds the resting tempo on Audio Beat Clock until triggers arrive', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'audioBeat',
            { x: 0, y: 0 },
            { restingBpm: 60, minBpm: 40, maxBpm: 240 },
            'beat',
          ),
        ],
        [],
        { nodeId: 'beat', portId: 'phase' },
      ),
    );

    renderer.render(0.5);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.5);

    uniform1f.mockClear();
    renderer.render(1.25);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.25);
    renderer.dispose();
  });

  it('smooths rising and falling values by elapsed transport time', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const graph = createControlOutputGraph(
      [
        createGraphNode('pointer', { x: 0, y: 0 }, {}, 'pointer'),
        createGraphNode(
          'smooth',
          { x: 100, y: 0 },
          { rise: 0.25, fall: 0.25, initial: 0 },
          'smooth',
        ),
      ],
      [
        {
          id: 'pointer-smooth',
          source: { nodeId: 'pointer', portId: 'x' },
          target: { nodeId: 'smooth', portId: 'value' },
        },
      ],
      { nodeId: 'smooth', portId: 'value' },
    );
    renderer.setGraph(graph);

    expect(renderer.render(0, 0, { x: 1, y: 0, down: 0, press: 0, release: 0 }))
      .toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(0);

    uniform1f.mockClear();
    renderer.render(0.25, 0, {
      x: 1,
      y: 0,
      down: 0,
      press: 0,
      release: 0,
    });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(
      1 - Math.exp(-1),
    );

    uniform1f.mockClear();
    renderer.render(0.5, 0, {
      x: 0,
      y: 0,
      down: 0,
      press: 0,
      release: 0,
    });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(
      (1 - Math.exp(-1)) * Math.exp(-1),
    );
    renderer.dispose();
  });

  it('preserves Smooth state when an upstream control parameter changes', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const graph = createControlOutputGraph(
      [
        createGraphNode(
          'constant',
          { x: 0, y: 0 },
          { value: 1 },
          'constant',
        ),
        createGraphNode(
          'smooth',
          { x: 100, y: 0 },
          { rise: 1, fall: 1, initial: 0 },
          'smooth',
        ),
      ],
      [
        {
          id: 'constant-smooth',
          source: { nodeId: 'constant', portId: 'value' },
          target: { nodeId: 'smooth', portId: 'value' },
        },
      ],
      { nodeId: 'smooth', portId: 'value' },
    );
    renderer.setGraph(graph);
    renderer.render(0);
    renderer.render(1);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(
      1 - Math.exp(-1),
    );

    const updatedGraph = cloneGraphDocument(graph);
    const constant = updatedGraph.nodes.find(({ id }) => id === 'constant');
    if (!constant) {
      throw new Error('Expected the Constant test node.');
    }
    constant.params.value = 0;
    renderer.setGraph(updatedGraph);
    uniform1f.mockClear();
    renderer.render(2);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(
      (1 - Math.exp(-1)) * Math.exp(-1),
    );
    renderer.dispose();
  });

  it('preserves Smooth state across position-only graph synchronization', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const graph = createControlOutputGraph(
      [
        createGraphNode(
          'constant',
          { x: 0, y: 0 },
          { value: 1 },
          'constant',
        ),
        createGraphNode(
          'smooth',
          { x: 100, y: 0 },
          { rise: 1, fall: 1, initial: 0 },
          'smooth',
        ),
      ],
      [
        {
          id: 'constant-smooth',
          source: { nodeId: 'constant', portId: 'value' },
          target: { nodeId: 'smooth', portId: 'value' },
        },
      ],
      { nodeId: 'smooth', portId: 'value' },
    );
    renderer.setGraph(graph);
    renderer.render(0);
    renderer.render(1);

    const movedGraph = cloneGraphDocument(graph);
    const smooth = movedGraph.nodes.find(({ id }) => id === 'smooth');
    if (!smooth) {
      throw new Error('Expected the Smooth test node.');
    }
    smooth.position.x += 80;
    renderer.setGraph(movedGraph);
    uniform1f.mockClear();
    renderer.render(2);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(
      1 - Math.exp(-2),
    );
    renderer.dispose();
  });

  it('drops Smooth state when its node is removed before its ID is reused', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const graph = createControlOutputGraph(
      [
        createGraphNode(
          'constant',
          { x: 0, y: 0 },
          { value: 1 },
          'constant',
        ),
        createGraphNode(
          'smooth',
          { x: 100, y: 0 },
          { rise: 1, fall: 1, initial: 0 },
          'smooth',
        ),
      ],
      [
        {
          id: 'constant-smooth',
          source: { nodeId: 'constant', portId: 'value' },
          target: { nodeId: 'smooth', portId: 'value' },
        },
      ],
      { nodeId: 'smooth', portId: 'value' },
    );
    renderer.setGraph(graph);
    renderer.render(0);
    renderer.render(1);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeGreaterThan(0);

    renderer.setGraph(
      createControlOutputGraph(
        [
          createGraphNode(
            'constant',
            { x: 0, y: 0 },
            { value: 1 },
            'constant',
          ),
        ],
        [],
        { nodeId: 'constant', portId: 'value' },
      ),
    );
    renderer.setGraph(graph);
    uniform1f.mockClear();
    renderer.render(2);
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(0);
    renderer.dispose();
  });

  it('snaps zero-duration smoothing and resets state deterministically', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const graph = createControlOutputGraph(
      [
        createGraphNode('pointer', { x: 0, y: 0 }, {}, 'pointer'),
        createGraphNode(
          'smooth',
          { x: 100, y: 0 },
          { rise: 0, fall: 0, initial: 0.2 },
          'smooth',
        ),
      ],
      [
        {
          id: 'pointer-smooth',
          source: { nodeId: 'pointer', portId: 'x' },
          target: { nodeId: 'smooth', portId: 'value' },
        },
      ],
      { nodeId: 'smooth', portId: 'value' },
    );
    renderer.setGraph(graph);

    renderer.render(0, 0, { x: 1, y: 0, down: 0, press: 0, release: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.2);
    uniform1f.mockClear();
    renderer.render(0.1, 0, { x: 1, y: 0, down: 0, press: 0, release: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(1);

    renderer.reset();
    uniform1f.mockClear();
    renderer.render(2, 0, { x: 1, y: 0, down: 0, press: 0, release: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.2);

    uniform1f.mockClear();
    renderer.render(2.1, 0, { x: 1, y: 0, down: 0, press: 0, release: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(1);
    uniform1f.mockClear();
    renderer.render(1, 0, { x: 0, y: 0, down: 0, press: 0, release: 0 });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBeCloseTo(0.2);
    renderer.dispose();
  });

  it('routes both XY Pad parameters through their control outputs', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createXYControlGraph());

    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 3 });
    expect(wroteUniform(uniform1f, 'uHue', 0.23)).toBe(true);
    expect(wroteUniform(uniform1f, 'uExposure', 0.77)).toBe(true);
    renderer.dispose();
  });

  it('evaluates tempo phase, beat pulse, and bar phase deterministically', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createBeatClockGraph());

    expect(renderer.render(2.5)).toMatchObject({ rendered: true, passCount: 3 });
    expect(wroteUniform(uniform1f, 'uHue', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uExposure', 1)).toBe(true);
    expect(wroteUniform(uniform1f, 'uSaturation', 0.25)).toBe(true);

    uniform1f.mockClear();
    expect(renderer.render(2.625)).toMatchObject({ rendered: true, passCount: 3 });
    expect(wroteUniform(uniform1f, 'uHue', 0.25)).toBe(true);
    expect(wroteUniform(uniform1f, 'uExposure', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uSaturation', 0.3125)).toBe(true);
    renderer.dispose();
  });

  it('lets a bound position deterministically drive Auto Selector index and phase', () => {
    const selectorNodes = () => [
      createGraphNode(
        'constant',
        { x: 0, y: 0 },
        { value: -0.25 },
        'selector-position',
      ),
      createGraphNode(
        'autoSelector',
        { x: 120, y: 0 },
        { interval: 1, count: 4, order: 'forward', seed: 23 },
        'selector',
      ),
    ];
    const selectorEdges = () => [
      {
        id: 'position-selector',
        source: { nodeId: 'selector-position', portId: 'value' },
        target: { nodeId: 'selector', portId: 'position' },
      },
    ];
    const { renderer, uniform1f } = createRendererHarness();

    renderer.setGraph(
      createControlOutputGraph(
        selectorNodes(),
        selectorEdges(),
        { nodeId: 'selector', portId: 'index' },
      ),
    );
    expect(renderer.render(100)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(3);

    uniform1f.mockClear();
    renderer.setGraph(
      createControlOutputGraph(
        selectorNodes(),
        selectorEdges(),
        { nodeId: 'selector', portId: 'phase' },
      ),
    );
    expect(renderer.render(100)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uSaturation')).toBe(0.75);
    renderer.dispose();
  });

  it('routes pointer position, held, press, and release independently', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createPointerControlGraph());

    expect(
      renderer.render(0, 0, {
        x: 0.2,
        y: 0.3,
        down: 0.4,
        press: 0.5,
        release: 0.6,
      }),
    ).toMatchObject({ rendered: true, passCount: 4 });
    expect(wroteUniform(uniform1f, 'uEnergy', 0.2)).toBe(true);
    expect(wroteUniform(uniform1f, 'uAmount', 0.3)).toBe(true);
    expect(wroteUniform(uniform1f, 'uHue', 0.4)).toBe(true);
    expect(wroteUniform(uniform1f, 'uExposure', 0.5)).toBe(true);
    expect(wroteUniform(uniform1f, 'uSaturation', 0.6)).toBe(true);
    renderer.dispose();
  });
});

describe('frame-node evaluation', () => {
  it('renders Transform 2D in one aspect-aware pass with deterministic uniforms', () => {
    const { renderer, uniform1f, uniform2f } = createRendererHarness();
    renderer.setGraph(createTransform2dGraph());

    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 3 });
    expect(wroteUniform2f(uniform2f, 'uResolution', 640, 360)).toBe(true);
    expect(wroteUniform2f(uniform2f, 'uTranslate', 0.25, -0.3)).toBe(true);
    expect(wroteUniform(uniform1f, 'uScale', 2)).toBe(true);
    expect(lastUniformValue(uniform1f, 'uRotation')).toBeCloseTo(Math.PI / 2);
    expect(wroteUniform2f(uniform2f, 'uPivot', 0.2, 0.8)).toBe(true);
    expect(wroteUniform(uniform1f, 'uEdgeMode', 3)).toBe(true);
    renderer.dispose();
  });

  it('advances Spiral Feedback from elapsed visual time and freezes at zero delta', () => {
    const { bindTexture, renderer, uniform1f, uniform2f } =
      createRendererHarness();
    renderer.setGraph(createFeedbackSpiralGraph());
    bindTexture.mockClear();
    uniform1f.mockClear();
    uniform2f.mockClear();

    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 3 });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uDeltaTime', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uRetention', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uRotationStep', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uZoomStep', 1)).toBe(true);
    expect(wroteUniform2f(uniform2f, 'uCenter', 0.25, 0.75)).toBe(true);

    bindTexture.mockClear();
    uniform1f.mockClear();
    expect(renderer.render(0.5)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 1)).toBe(true);
    expect(lastUniformValue(uniform1f, 'uDeltaTime')).toBe(0.5);
    expect(lastUniformValue(uniform1f, 'uRetention')).toBeCloseTo(0.8);
    expect(lastUniformValue(uniform1f, 'uRotationStep')).toBeCloseTo(
      Math.PI / 6,
    );
    expect(lastUniformValue(uniform1f, 'uZoomStep')).toBeCloseTo(1.1);

    bindTexture.mockClear();
    uniform1f.mockClear();
    expect(renderer.render(0.5)).toMatchObject({ rendered: true });
    const pausedPreviousTexture = bindTexture.mock.calls[1]?.[1] as unknown;
    expect(pausedPreviousTexture).toBeDefined();
    expect(lastUniformValue(uniform1f, 'uDeltaTime')).toBe(0);
    expect(lastUniformValue(uniform1f, 'uRetention')).toBe(1);
    expect(lastUniformValue(uniform1f, 'uRotationStep')).toBe(0);
    expect(lastUniformValue(uniform1f, 'uZoomStep')).toBe(1);

    bindTexture.mockClear();
    uniform1f.mockClear();
    expect(renderer.render(1)).toMatchObject({ rendered: true });
    expect(bindTexture.mock.calls[1]?.[1]).toBe(pausedPreviousTexture);
    expect(lastUniformValue(uniform1f, 'uDeltaTime')).toBe(0.5);
    expect(lastUniformValue(uniform1f, 'uRetention')).toBeCloseTo(0.8);

    uniform1f.mockClear();
    expect(renderer.render(0.25)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uRetention', 0)).toBe(true);
    renderer.dispose();
  });

  it('commits Spiral Feedback history only after the complete frame succeeds', () => {
    const { bindTexture, drawArrays, renderer, uniform1f } =
      createRendererHarness();
    renderer.setGraph(createFeedbackSpiralGraph());
    expect(renderer.render(0)).toMatchObject({ rendered: true });

    bindTexture.mockClear();
    let drawIndex = 0;
    drawArrays.mockImplementation(() => {
      drawIndex += 1;
      if (drawIndex === 3) {
        throw new Error('Display draw failed');
      }
    });
    expect(renderer.render(1)).toMatchObject({ rendered: false });
    const committedPreviousTexture = bindTexture.mock.calls[1]?.[1] as unknown;
    expect(committedPreviousTexture).toBeDefined();

    bindTexture.mockClear();
    uniform1f.mockClear();
    drawArrays.mockReset();
    expect(renderer.render(2)).toMatchObject({ rendered: true });
    expect(bindTexture.mock.calls[1]?.[1]).toBe(committedPreviousTexture);
    expect(lastUniformValue(uniform1f, 'uDeltaTime')).toBe(2);
    expect(lastUniformValue(uniform1f, 'uRetention')).toBeCloseTo(0.64 ** 2);
    renderer.dispose();
  });

  it('keeps zero feedback frozen at zero delta and clears it once time advances', () => {
    const { renderer, uniform1f } = createRendererHarness();
    const graph = createFeedbackSpiralGraph();
    renderer.setGraph(graph);
    expect(renderer.render(0)).toMatchObject({ rendered: true });

    const spiral = graph.nodes.find(({ id }) => id === 'spiral');
    expect(spiral).toBeDefined();
    if (!spiral) {
      throw new Error('The Spiral Feedback fixture is missing.');
    }
    spiral.params.feedback = 0;
    renderer.setGraph(graph);

    uniform1f.mockClear();
    expect(renderer.render(0)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 1)).toBe(true);
    expect(lastUniformValue(uniform1f, 'uRetention')).toBe(1);

    uniform1f.mockClear();
    expect(renderer.render(1)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uRetention')).toBe(0);
    renderer.dispose();
  });

  it('resets Spiral Feedback after reset or an inactive interval', () => {
    const { canvas, renderer, uniform1f } = createRendererHarness();
    const active = createFeedbackSpiralGraph();
    renderer.setGraph(active);
    expect(renderer.render(0)).toMatchObject({ rendered: true });

    renderer.reset();
    uniform1f.mockClear();
    expect(renderer.render(5)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 0)).toBe(true);

    const inactive = cloneGraphDocument(active);
    inactive.edges = inactive.edges.filter(
      ({ id }) => id !== 'spiral-feedback-display',
    );
    renderer.setGraph(inactive);
    expect(renderer.render(6)).toMatchObject({ rendered: true, passCount: 1 });

    renderer.setGraph(active);
    uniform1f.mockClear();
    expect(renderer.render(7)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 0)).toBe(true);

    renderer.resize(320, 180, 1);
    uniform1f.mockClear();
    expect(renderer.render(8)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 0)).toBe(true);

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    uniform1f.mockClear();
    expect(renderer.render(9)).toMatchObject({ rendered: true });
    expect(wroteUniform(uniform1f, 'uHistoryReady', 0)).toBe(true);
    renderer.dispose();
  });

  it('decays retained Spiral Feedback over the standard black source fallback', () => {
    const { bindTexture, createTexture, renderer, uniform1f } =
      createRendererHarness();
    renderer.setGraph(createFeedbackSpiralGraph());
    expect(renderer.render(0)).toMatchObject({ rendered: true });

    renderer.setGraph(createFeedbackSpiralGraph(false));
    bindTexture.mockClear();
    uniform1f.mockClear();
    expect(renderer.render(1)).toMatchObject({ rendered: true, passCount: 2 });
    const blackTexture = createTexture.mock.results[0]?.value as unknown;
    expect(bindTexture.mock.calls[0]?.[1]).toBe(blackTexture);
    expect(wroteUniform(uniform1f, 'uHistoryReady', 1)).toBe(true);
    expect(lastUniformValue(uniform1f, 'uRetention')).toBeCloseTo(0.64);
    renderer.dispose();
  });

  it('normalizes connected Strobe phase and lets bound amount override its parameter', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createStrobeGraph());

    expect(renderer.render(100)).toMatchObject({
      rendered: true,
      passCount: 3,
    });
    expect(lastUniformValue(uniform1f, 'uPhase')).toBe(0.75);
    expect(lastUniformValue(uniform1f, 'uDuty')).toBe(0.6);
    expect(lastUniformValue(uniform1f, 'uAmount')).toBe(1);
    expect(lastUniformValue(uniform1f, 'uClosedMode')).toBe(3);
    renderer.dispose();
  });

  it('uses the bounded internal Strobe rate with positive negative-time phase', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createStrobeGraph(false));

    expect(renderer.render(-0.25)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uPhase')).toBe(0.25);

    uniform1f.mockClear();
    expect(renderer.render(0.75)).toMatchObject({ rendered: true });
    expect(lastUniformValue(uniform1f, 'uPhase')).toBe(0.25);
    expect(lastUniformValue(uniform1f, 'uAmount')).toBe(1);
    renderer.dispose();
  });

  it('initializes and resets offscreen frames as transparent', () => {
    const { clearColor, renderer } = createRendererHarness();

    expect(clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
    clearColor.mockClear();
    renderer.reset();
    expect(clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(clearColor).toHaveBeenLastCalledWith(0.008, 0.01, 0.016, 1);
    renderer.dispose();
  });

  it('routes compositing parameters through bounded shader uniforms', () => {
    const { bindTexture, createTexture, gl, renderer, uniform1f, uniform4f } =
      createRendererHarness();
    const transparentTexture = createTexture.mock.results[1]?.value as unknown as
      | WebGLTexture
      | undefined;
    renderer.setGraph(createCompositingGraph());
    bindTexture.mockClear();

    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 9 });
    expect(wroteUniform4f(uniform4f, 'uColor', 0.2, 0.4, 0.6, 0.8)).toBe(true);
    expect(wroteUniform(uniform1f, 'uRadius', 12)).toBe(true);
    expect(wroteUniform(uniform1f, 'uChannel', 3)).toBe(true);
    expect(wroteUniform(uniform1f, 'uLevel', 0.35)).toBe(true);
    expect(wroteUniform(uniform1f, 'uSoftness', 0.12)).toBe(true);
    expect(wroteUniform(uniform1f, 'uChannel', 4)).toBe(true);
    expect(wroteUniform(uniform1f, 'uAmount', 0.7)).toBe(true);
    expect(wroteUniform(uniform1f, 'uOpacity', 0.65)).toBe(true);
    expect(wroteUniform(uniform1f, 'uOperation', 4)).toBe(true);
    expect(wroteUniform(uniform1f, 'uIndex', 2)).toBe(true);
    expect(
      bindTexture.mock.calls.filter(
        ([target, texture]) =>
          target === gl.TEXTURE_2D && texture === transparentTexture,
      ),
    ).toHaveLength(3);
    renderer.dispose();
  });
});

describe('model frame validation', () => {
  it('accepts complete images within the texture budget', () => {
    expect(readImageFrameSize(createImageFrame(1_920, 1_080))).toEqual({
      width: 1_920,
      height: 1_080,
    });
  });

  it('waits for complete images and rejects invalid dimensions', () => {
    expect(readImageFrameSize(createImageFrame(640, 480, false))).toBeNull();
    expect(readImageFrameSize(createImageFrame(0, 480))).toBeNull();
    expect(readImageFrameSize(createImageFrame(640.5, 480))).toBeNull();
    expect(
      readImageFrameSize(createImageFrame(MAX_RENDER_DIMENSION + 1, 1)),
    ).toBeNull();
    expect(
      readImageFrameSize(createImageFrame(1_001, 1_000), 2_000, 1_000_000),
    ).toBeNull();
  });
});

describe('model frame texture lifecycle', () => {
  it('renders the built-in preview when no generated frame is available', () => {
    const { renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createVideoModelGraph());

    expect(renderer.render(1.25)).toMatchObject({ rendered: true, passCount: 2 });
    expect(wroteUniform(uniform1f, 'uHasSource', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uHasGenerated', 0)).toBe(true);
    expect(wroteUniform(uniform1f, 'uStrength', 0.7)).toBe(true);
    expect(wroteUniform(uniform1f, 'uGuidance', 1.2)).toBe(true);
    expect(wroteUniform(uniform1f, 'uSeed', 42)).toBe(true);
    renderer.dispose();
  });

  it('uploads each generated image once and releases it when disconnected', () => {
    const { deleteTexture, renderer, texImage2D, uniform1f } =
      createRendererHarness();
    renderer.setGraph(createVideoModelGraph());
    const first = createImageFrame(640, 360);
    renderer.setVideoModelSources(new Map([['model', first]]));

    renderer.render(0);
    renderer.render(1 / 60);
    expect(
      texImage2D.mock.calls.filter(
        (call) => call.length === 6 && call[5] === first,
      ),
    ).toHaveLength(1);
    expect(wroteUniform(uniform1f, 'uHasGenerated', 1)).toBe(true);

    const replacement = createImageFrame(320, 180);
    renderer.setVideoModelSources(new Map([['model', replacement]]));
    renderer.render(2 / 60);
    expect(
      texImage2D.mock.calls.filter(
        (call) => call.length === 6 && call[5] === replacement,
      ),
    ).toHaveLength(1);

    const deletesBeforeDisconnect = deleteTexture.mock.calls.length;
    renderer.setVideoModelSources(new Map());
    expect(deleteTexture).toHaveBeenCalledTimes(deletesBeforeDisconnect + 1);
    renderer.dispose();
  });

  it('keeps the previous model source when a new texture cannot be allocated', () => {
    const { createTexture, renderer, uniform1f } = createRendererHarness();
    renderer.setGraph(createVideoModelGraph());
    createTexture.mockReturnValueOnce(null);

    expect(() =>
      renderer.setVideoModelSources(
        new Map([['model', createImageFrame(640, 360)]]),
      ),
    ).toThrow(/allocate a model frame texture/i);

    uniform1f.mockClear();
    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 2 });
    expect(wroteUniform(uniform1f, 'uHasGenerated', 0)).toBe(true);
    renderer.dispose();
  });

  it('rebuilds the previous GPU plan when a new graph cannot be applied', () => {
    const { createTexture, renderer } = createRendererHarness();
    renderer.setVideoModelSources(
      new Map([['model', createImageFrame(640, 360)]]),
    );
    createTexture
      .mockReturnValueOnce({ id: 'new-render-target' })
      .mockReturnValueOnce(null);

    expect(() => renderer.setGraph(createVideoModelGraph())).toThrow(
      /allocate a model frame texture/i,
    );
    expect(renderer.render(0)).toMatchObject({ rendered: true, passCount: 2 });
    renderer.dispose();
  });
});

describe('live video frame validation', () => {
  it('accepts a ready frame within the texture budget', () => {
    expect(
      readVideoFrameSize({
        readyState: 2,
        videoWidth: 1_920,
        videoHeight: 1_080,
      }),
    ).toEqual({ width: 1_920, height: 1_080 });
  });

  it('waits for current frame data and positive integral dimensions', () => {
    expect(
      readVideoFrameSize({ readyState: 1, videoWidth: 640, videoHeight: 480 }),
    ).toBeNull();
    expect(
      readVideoFrameSize({ readyState: 4, videoWidth: 0, videoHeight: 480 }),
    ).toBeNull();
    expect(
      readVideoFrameSize({
        readyState: 4,
        videoWidth: 640.5,
        videoHeight: 480,
      }),
    ).toBeNull();
  });

  it('rejects frames beyond either dimension or total-pixel cap', () => {
    expect(
      readVideoFrameSize({
        readyState: 4,
        videoWidth: MAX_RENDER_DIMENSION + 1,
        videoHeight: 1,
      }),
    ).toBeNull();
    expect(
      readVideoFrameSize(
        { readyState: 4, videoWidth: 1_001, videoHeight: 1_000 },
        2_000,
        1_000_000,
      ),
    ).toBeNull();
  });
});

describe('live video texture lifecycle', () => {
  it('uploads only ready frames and clears the texture when stopped', () => {
    const { deleteTexture, gl, pixelStorei, renderer, texImage2D } =
      createRendererHarness();
    const video = {
      readyState: 1,
      videoWidth: 640,
      videoHeight: 480,
    } as HTMLVideoElement;
    renderer.setVideoSource(video);

    const beforeWaitingRender = texImage2D.mock.calls.length;
    expect(renderer.render(0).rendered).toBe(true);
    expect(texImage2D).toHaveBeenCalledTimes(beforeWaitingRender);

    Object.defineProperty(video, 'readyState', { value: 2 });
    const result = renderer.render(1 / 60);
    expect(result).toMatchObject({ rendered: true, passCount: 2 });
    expect(
      texImage2D.mock.calls.some(
        (call) => call.length === 6 && call[5] === video,
      ),
    ).toBe(true);
    expect(pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, 1);
    expect(pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, 0);

    renderer.setVideoSource(null);
    const resetCall = texImage2D.mock.calls.at(-1);
    expect(resetCall).toHaveLength(9);
    expect(resetCall?.[8]).toBeInstanceOf(Uint8Array);
    renderer.dispose();
    expect(deleteTexture).toHaveBeenCalled();
  });

  it('retains the source element and resumes upload after context restore', () => {
    const { canvas, renderer, texImage2D } = createRendererHarness();
    const video = {
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
    } as HTMLVideoElement;
    renderer.setVideoSource(video);
    renderer.render(0);

    const lostEvent = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lostEvent);
    expect(lostEvent.defaultPrevented).toBe(true);
    expect(renderer.isContextLost).toBe(true);
    expect(renderer.render(1).rendered).toBe(false);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(renderer.isContextLost).toBe(false);
    expect(renderer.render(2).rendered).toBe(true);
    expect(
      texImage2D.mock.calls.filter(
        (call) => call.length === 6 && call[5] === video,
      ),
    ).toHaveLength(2);
    renderer.dispose();
  });
});
