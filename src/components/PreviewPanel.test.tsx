import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import { createDefaultGraph, type GraphDocument } from '../graph';
import type * as EngineModule from '../engine';
import type { RenderResult } from '../engine';
import { PreviewPanel } from './PreviewPanel';

interface MockRendererInstance {
  setGraph: Mock;
  setVideoSource: Mock;
  setVideoModelSources: Mock;
  resize: Mock;
  reset: Mock;
  resetFrameRate: Mock;
  render: Mock;
  dispose: Mock;
}

const rendererHarness = vi.hoisted(() => ({
  instances: [] as MockRendererInstance[],
  modelSourceFailures: 0,
  resizeFailures: 0,
}));

vi.mock('../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof EngineModule>();

  class MockWebGLRenderer {
    private frame = 0;
    private contextLost = false;

    readonly setGraph = vi.fn();
    readonly setVideoSource = vi.fn();
    readonly setVideoModelSources = vi.fn(() => {
      if (rendererHarness.modelSourceFailures > 0) {
        rendererHarness.modelSourceFailures -= 1;
        throw new Error('Generated frame exceeds the current budget.');
      }
    });
    readonly resize = vi.fn(() => {
      if (rendererHarness.resizeFailures > 0) {
        rendererHarness.resizeFailures -= 1;
        throw new Error('Monitor size exceeds the current budget.');
      }
    });
    readonly reset = vi.fn(() => {
      this.frame = 0;
    });
    readonly resetFrameRate = vi.fn();
    readonly render = vi.fn((): RenderResult => {
      if (this.contextLost) {
        return {
          rendered: false,
          frame: this.frame,
          fps: 0,
          passCount: 0,
          width: 640,
          height: 360,
          error: 'The graphics context was lost.',
        };
      }
      this.frame += 1;
      return {
        rendered: true,
        frame: this.frame,
        fps: 60,
        passCount: 2,
        width: 640,
        height: 360,
        error: null,
      };
    });
    readonly dispose = vi.fn(() => {
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.removeEventListener(
        'webglcontextrestored',
        this.handleContextRestored,
      );
    });

    private readonly handleContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
    };

    private readonly handleContextRestored = () => {
      this.contextLost = false;
    };

    constructor(private readonly canvas: HTMLCanvasElement) {
      canvas.addEventListener('webglcontextlost', this.handleContextLost);
      canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
      rendererHarness.instances.push(this);
    }
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

let resizeCallbacks: ResizeObserverCallback[];
let animationCallbacks: Map<number, FrameRequestCallback>;
let nextAnimationId: number;

function currentRenderer(): MockRendererInstance {
  const instance = rendererHarness.instances.at(-1);
  if (!instance) {
    throw new Error('The preview renderer was not created.');
  }
  return instance;
}

function runAnimationFrame(timestamp: number): void {
  const callbacks = [...animationCallbacks.values()];
  animationCallbacks.clear();
  act(() => {
    callbacks.forEach((callback) => callback(timestamp));
  });
}

function reportCanvasSize(width: number, height: number): void {
  const callback = resizeCallbacks.at(-1);
  if (!callback) {
    throw new Error('The preview resize observer was not created.');
  }
  const entry = {
    contentRect: { width, height },
  } as ResizeObserverEntry;
  act(() => callback([entry], {} as ResizeObserver));
}

function previewProps(document: GraphDocument, playing: boolean) {
  return {
    document,
    playing,
    resetToken: 0,
    audioInputState: 'demo' as const,
    videoInputState: 'idle' as const,
    videoSource: null,
    videoModelSources: new Map<string, HTMLImageElement>(),
    meterLevel: 0.25,
    sampleAudio: vi.fn(() => ({
      level: 0.25,
      bass: 0.4,
      mid: 0.2,
      treble: 0.1,
    })),
    onRuntimeUpdate: vi.fn(),
    onNotify: vi.fn(),
  };
}

beforeEach(() => {
  rendererHarness.instances.length = 0;
  rendererHarness.modelSourceFailures = 0;
  rendererHarness.resizeFailures = 0;
  resizeCallbacks = [];
  animationCallbacks = new Map();
  nextAnimationId = 1;

  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationId;
      nextAnimationId += 1;
      animationCallbacks.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => animationCallbacks.delete(id)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PreviewPanel monitor lifecycle', () => {
  it('surfaces context loss while held and redraws after restoration', async () => {
    const props = previewProps(createDefaultGraph(), false);
    render(<PreviewPanel {...props} />);
    const canvas = screen.getByLabelText(/Rendered visual output/);
    const renderer = currentRenderer();
    renderer.render.mockClear();

    act(() => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The graphics context was lost.',
    );

    act(() => {
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    });

    expect(renderer.render).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(canvas).toHaveAttribute('data-rendered', 'true');
    expect(animationCallbacks).toHaveLength(0);
  });

  it('renders time zero on the first fixed-rate frame after reset', () => {
    const document = createDefaultGraph();
    const props = previewProps(document, true);
    const { rerender, unmount } = render(<PreviewPanel {...props} />);
    const renderer = currentRenderer();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Monitor frame pacing' }),
      { target: { value: '30-fps' } },
    );
    runAnimationFrame(0);
    expect(animationCallbacks).toHaveLength(1);
    renderer.render.mockClear();

    rerender(<PreviewPanel {...props} resetToken={1} />);
    runAnimationFrame(16);

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenLastCalledWith(
      0,
      { level: 0.25, bass: 0.4, mid: 0.2, treble: 0.1 },
      expect.any(Object),
      16,
    );
    expect(animationCallbacks).toHaveLength(1);

    unmount();
    expect(animationCallbacks).toHaveLength(0);
  });

  it('retries rejected model sources and canvas size after graph replacement', async () => {
    rendererHarness.modelSourceFailures = 1;
    rendererHarness.resizeFailures = 1;
    const document = createDefaultGraph();
    const props = previewProps(document, false);
    const { rerender } = render(<PreviewPanel {...props} />);
    const renderer = currentRenderer();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Generated frame exceeds the current budget.',
      ),
    );
    reportCanvasSize(1280, 720);
    expect(props.onNotify).toHaveBeenCalledWith(
      'Monitor size exceeds the current budget.',
      'error',
    );

    rerender(
      <PreviewPanel
        {...props}
        document={{
          ...document,
          nodes: [...document.nodes],
          edges: [...document.edges],
        }}
      />,
    );

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(renderer.setVideoModelSources).toHaveBeenCalledTimes(2);
    expect(renderer.resize).toHaveBeenCalledTimes(2);
    expect(renderer.resize).toHaveBeenLastCalledWith(
      1280,
      720,
      window.devicePixelRatio,
    );
  });
});
