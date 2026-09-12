import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GRAPH_SCHEMA_VERSION,
  createGraphNode,
  type GraphDocument,
  type GraphEdge,
} from '../graph';
import {
  assertVideoModelTransportSecurity,
  createVideoModelRequest,
  normalizeVideoModelImageUrl,
  parseVideoModelEndpoint,
  resolveVideoModelConfig,
  useVideoModel,
} from './useVideoModel';

function edge(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): GraphEdge {
  return {
    id,
    source: { nodeId: sourceNodeId, portId: sourcePortId },
    target: { nodeId: targetNodeId, portId: targetPortId },
  };
}

function modelGraph(
  params: Record<string, number | string | boolean> = {},
  includeCamera = false,
): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode(
        'aiPrompt',
        { x: 0, y: 0 },
        {
          text: 'Turn the live scene into moving stained glass',
          negative: 'flicker',
        },
        'prompt',
      ),
      ...(includeCamera
        ? [createGraphNode('videoInput', { x: 0, y: 0 }, {}, 'camera')]
        : []),
      createGraphNode('videoModel', { x: 0, y: 0 }, params, 'model'),
      createGraphNode('display', { x: 0, y: 0 }, {}, 'display'),
    ],
    edges: [
      edge('prompt-model', 'prompt', 'prompt', 'model', 'prompt'),
      ...(includeCamera
        ? [edge('camera-model', 'camera', 'frame', 'model', 'source')]
        : []),
      edge('model-display', 'model', 'frame', 'display', 'source'),
    ],
  };
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = FakeWebSocket.CONNECTING;
  readonly send = vi.fn();
  readonly close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
}

function stubWebSockets(): FakeWebSocket[] {
  const sockets: FakeWebSocket[] = [];
  class CapturingWebSocket extends FakeWebSocket {
    constructor(url: string | URL) {
      super(url);
      sockets.push(this);
    }
  }
  vi.stubGlobal('WebSocket', CapturingWebSocket);
  Object.assign(CapturingWebSocket, {
    CONNECTING: FakeWebSocket.CONNECTING,
    OPEN: FakeWebSocket.OPEN,
    CLOSING: FakeWebSocket.CLOSING,
    CLOSED: FakeWebSocket.CLOSED,
  });
  return sockets;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('video model configuration', () => {
  it('resolves prompt text and enables live camera input only for WebSocket mode', () => {
    const websocket = resolveVideoModelConfig(
      modelGraph(
        {
          runtime: 'local',
          transport: 'websocket',
          endpoint: 'ws://127.0.0.1:8189/v1/stream',
        },
        true,
      ),
      'model',
    );
    const http = resolveVideoModelConfig(
      modelGraph(
        {
          runtime: 'api',
          transport: 'http',
          endpoint: 'https://models.example/v1/frame',
        },
        true,
      ),
      'model',
    );

    expect(websocket).toMatchObject({
      prompt: 'Turn the live scene into moving stained glass',
      negativePrompt: 'flicker',
      hasSource: true,
      acceptsCameraFrames: true,
    });
    expect(http?.hasSource).toBe(true);
    expect(http?.acceptsCameraFrames).toBe(false);
  });

  it('normalizes supported image URLs and rejects unsafe URL forms', () => {
    expect(
      normalizeVideoModelImageUrl('  HTTPS://cdn.example/frame.png  ')?.href,
    ).toBe('https://cdn.example/frame.png');
    expect(
      normalizeVideoModelImageUrl('data:image/png;base64,AA==')?.protocol,
    ).toBe('data:');
    expect(normalizeVideoModelImageUrl('data:text/html,unsafe')).toBeNull();
    expect(
      normalizeVideoModelImageUrl('https://secret@cdn.example/frame.png'),
    ).toBeNull();
    expect(normalizeVideoModelImageUrl('javascript:alert(1)')).toBeNull();
  });

  it('accepts only transport-appropriate endpoints without embedded credentials', () => {
    expect(
      parseVideoModelEndpoint('wss://models.example/live', 'websocket').href,
    ).toBe('wss://models.example/live');
    expect(
      parseVideoModelEndpoint('https://models.example/frame', 'http').href,
    ).toBe('https://models.example/frame');
    expect(() =>
      parseVideoModelEndpoint('https://models.example/live', 'websocket'),
    ).toThrow(/WebSocket endpoint/);
    expect(() =>
      parseVideoModelEndpoint('https://secret@models.example/frame', 'http'),
    ).toThrow(/credentials/i);
    expect(() =>
      parseVideoModelEndpoint('https://models.example/frame#secret', 'http'),
    ).toThrow(/fragment/i);
  });

  it('requires secure transport for API mode and credentials', () => {
    const apiConfig = resolveVideoModelConfig(
      modelGraph({
        runtime: 'api',
        transport: 'http',
        endpoint: 'http://127.0.0.1:8189/frame',
      }),
      'model',
    );
    const localConfig = resolveVideoModelConfig(
      modelGraph({
        runtime: 'local',
        transport: 'websocket',
        endpoint: 'ws://127.0.0.1:8189/live',
      }),
      'model',
    );
    if (!apiConfig || !localConfig) {
      throw new Error('Expected model configurations.');
    }

    expect(() =>
      assertVideoModelTransportSecurity(
        apiConfig,
        new URL(apiConfig.endpoint),
      ),
    ).toThrow(/require HTTPS/i);
    expect(() =>
      assertVideoModelTransportSecurity(
        localConfig,
        new URL(localConfig.endpoint),
        'secret',
      ),
    ).toThrow(/session keys require/i);
    expect(() =>
      assertVideoModelTransportSecurity(
        localConfig,
        new URL('ws://192.168.1.40/live'),
      ),
    ).toThrow(/loopback/i);
  });

  it('rejects plaintext HTTP and WebSocket endpoints from a secure page', () => {
    const localHttp = resolveVideoModelConfig(
      modelGraph({
        runtime: 'local',
        transport: 'http',
        endpoint: 'http://127.0.0.1:8189/frame',
      }),
      'model',
    );
    const localSocket = resolveVideoModelConfig(
      modelGraph({
        runtime: 'local',
        transport: 'websocket',
        endpoint: 'ws://127.0.0.1:8189/live',
      }),
      'model',
    );
    if (!localHttp || !localSocket) {
      throw new Error('Expected local model configurations.');
    }
    vi.stubGlobal('window', { location: { protocol: 'https:' } });

    expect(() =>
      assertVideoModelTransportSecurity(
        localHttp,
        new URL(localHttp.endpoint),
      ),
    ).toThrow(/secure page requires HTTPS/i);
    expect(() =>
      assertVideoModelTransportSecurity(
        localSocket,
        new URL(localSocket.endpoint),
      ),
    ).toThrow(/secure page requires HTTPS/i);
  });

  it('adds credentials only when explicitly requested', () => {
    const config = resolveVideoModelConfig(modelGraph(), 'model');
    if (!config) {
      throw new Error('Expected model configuration.');
    }

    expect(createVideoModelRequest(config, 'generate')).not.toHaveProperty(
      'auth',
    );
    expect(
      createVideoModelRequest(config, 'configure', 'session-secret').auth,
    ).toEqual({ type: 'bearer', token: 'session-secret' });
  });
});

describe('video model session lifecycle', () => {
  it('does not start network work for a model outside a Display path', async () => {
    const socketConstructor = vi.fn();
    vi.stubGlobal('WebSocket', socketConstructor);
    const graph = modelGraph({
      runtime: 'local',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:8189/v1/stream',
    });
    graph.edges = graph.edges.filter(({ id }) => id !== 'model-display');
    const { result } = renderHook(() => useVideoModel(graph, null));

    await act(async () => result.current.generate('model'));

    expect(socketConstructor).not.toHaveBeenCalled();
    const session = result.current.getSession('model');
    expect(session.state).toBe('error');
    expect(session.error).toMatch(/connect this node to a Display/i);
  });

  it('rejects a session key before storing it for an insecure endpoint', () => {
    const graph = modelGraph({
      runtime: 'local',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:8189/v1/stream',
    });
    const { result } = renderHook(() => useVideoModel(graph, null));

    act(() => result.current.setCredential('model', 'session-secret'));

    const session = result.current.getSession('model');
    expect(session.state).toBe('error');
    expect(session.error).toMatch(/session keys require/i);
    expect(session.hasCredential).toBe(false);
  });

  it('allows one outstanding WebSocket generation and recovers from worker errors and timeouts', async () => {
    vi.useFakeTimers();
    const sockets = stubWebSockets();
    const graph = modelGraph({
      runtime: 'local',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:8189/v1/stream',
    });
    const { result } = renderHook(() => useVideoModel(graph, null));

    await act(async () => result.current.generate('model'));
    expect(sockets).toHaveLength(1);
    expect(result.current.getSession('model').state).toBe('generating');

    await act(async () => result.current.generate('model'));
    expect(sockets).toHaveLength(1);

    act(() => sockets[0]?.open());

    expect(result.current.getSession('model').state).toBe('generating');
    const messages = sockets[0]?.send.mock.calls.map(([payload]) =>
      JSON.parse(String(payload)) as { type: string },
    );
    expect(messages?.map(({ type }) => type)).toEqual([
      'configure',
      'generate',
    ]);

    await act(async () => result.current.generate('model'));
    expect(sockets[0]?.send).toHaveBeenCalledTimes(2);

    act(() => {
      sockets[0]?.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'error', message: 'Worker is busy.' }),
        }),
      );
    });
    expect(result.current.getSession('model')).toMatchObject({
      state: 'live',
      error: 'Worker is busy.',
    });
    expect(sockets[0]?.close).not.toHaveBeenCalled();

    if (sockets[0]) {
      sockets[0].bufferedAmount = 5 * 1024 * 1024;
    }
    await act(async () => result.current.generate('model'));
    const backloggedSession = result.current.getSession('model');
    expect(backloggedSession.state).toBe('live');
    expect(backloggedSession.error).toMatch(/backlogged/i);
    expect(sockets[0]?.send).toHaveBeenCalledTimes(2);
    if (sockets[0]) {
      sockets[0].bufferedAmount = 0;
    }

    await act(async () => result.current.generate('model'));
    expect(sockets[0]?.send).toHaveBeenCalledTimes(3);
    expect(result.current.getSession('model').state).toBe('generating');

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.getSession('model')).toMatchObject({
      state: 'live',
      error: 'The model frame request timed out after 120 seconds.',
    });
    expect(sockets[0]?.close).not.toHaveBeenCalled();

    await act(async () => result.current.generate('model'));
    expect(result.current.getSession('model').state).toBe('generating');
    act(() => result.current.disconnect('model'));
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.getSession('model')).toMatchObject({
      state: 'idle',
      error: null,
    });
  });

  it('bounds a queued generation while the WebSocket is still connecting', async () => {
    vi.useFakeTimers();
    const sockets = stubWebSockets();
    const graph = modelGraph({
      runtime: 'local',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:8189/v1/stream',
    });
    const { result } = renderHook(() => useVideoModel(graph, null));

    await act(async () => result.current.generate('model'));
    expect(sockets).toHaveLength(1);
    expect(result.current.getSession('model').state).toBe('generating');

    await act(async () => vi.advanceTimersByTimeAsync(120_000));

    expect(result.current.getSession('model')).toMatchObject({
      state: 'error',
      error: 'The model frame request timed out after 120 seconds.',
    });
    expect(sockets[0]?.send).not.toHaveBeenCalled();
    expect(sockets[0]?.close).toHaveBeenCalledOnce();

    act(() => sockets[0]?.open());
    expect(result.current.getSession('model').state).toBe('error');
  });

  it('hard-resets sockets, timers, credentials, and retained input canvases', async () => {
    vi.useFakeTimers();
    const sockets = stubWebSockets();
    let nextAnimationFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextAnimationFrame = callback;
      return 1;
    });
    const inputCanvas = document.createElement('canvas');
    const drawImage = vi.fn();
    Object.defineProperty(inputCanvas, 'getContext', {
      value: vi.fn(() => ({ drawImage })),
    });
    Object.defineProperty(inputCanvas, 'toBlob', { value: vi.fn() });
    const cameraSource = {
      readyState: 2,
      videoWidth: 640,
      videoHeight: 360,
    } as HTMLVideoElement;
    const graph = modelGraph(
      {
        runtime: 'local',
        transport: 'websocket',
        endpoint: 'wss://models.example/v1/stream',
      },
      true,
    );
    const { result } = renderHook(() => useVideoModel(graph, cameraSource));
    vi.spyOn(document, 'createElement').mockReturnValueOnce(inputCanvas);

    act(() => result.current.setCredential('model', 'session-secret'));
    await act(async () => result.current.generate('model'));
    act(() => sockets[0]?.open());
    act(() => nextAnimationFrame?.(1_000));

    expect(drawImage).toHaveBeenCalledOnce();
    expect(inputCanvas.width).toBe(640);
    expect(inputCanvas.height).toBe(360);
    expect(result.current.getSession('model').hasCredential).toBe(true);
    expect(result.current.getSession('model').state).toBe('generating');

    act(() => result.current.resetAll());

    expect(sockets[0]?.close).toHaveBeenCalledOnce();
    expect(inputCanvas.width).toBe(0);
    expect(inputCanvas.height).toBe(0);
    expect(result.current.frames.size).toBe(0);
    expect(result.current.getSession('model')).toMatchObject({
      state: 'idle',
      error: null,
      hasCredential: false,
      lastFrameAt: null,
    });

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.getSession('model').state).toBe('idle');

    await act(async () => result.current.generate('model'));
    act(() => sockets[1]?.open());
    const requests = sockets[1]?.send.mock.calls.map(([payload]) =>
      JSON.parse(String(payload)) as { auth?: unknown },
    );
    expect(requests).toHaveLength(2);
    expect(requests?.every(({ auth }) => auth === undefined)).toBe(true);
  });

  it('stops a live session and clears its status when the node becomes unreachable', async () => {
    const sockets = stubWebSockets();
    const initialGraph = modelGraph({
      runtime: 'local',
      transport: 'websocket',
      endpoint: 'wss://models.example/v1/stream',
    });
    const disconnectedGraph = {
      ...initialGraph,
      edges: initialGraph.edges.filter(({ id }) => id !== 'model-display'),
    };
    const { result, rerender } = renderHook(
      ({ graph }: { graph: GraphDocument }) => useVideoModel(graph, null),
      { initialProps: { graph: initialGraph } },
    );

    act(() => result.current.connect('model'));
    act(() => sockets[0]?.open());
    await waitFor(() => {
      expect(result.current.getSession('model').state).toBe('live');
    });

    rerender({ graph: disconnectedGraph });

    await waitFor(() => {
      expect(result.current.getSession('model')).toMatchObject({
        state: 'idle',
        error: null,
        hasCredential: false,
        lastFrameAt: null,
      });
    });
    expect(sockets[0]?.close).toHaveBeenCalled();
  });

  it('downloads returned HTTP image URLs with bounded anonymous fetch options', async () => {
    const modelResponse = new Response(
      JSON.stringify({ image_url: '  HTTPS://cdn.example/frame.png  ' }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
    const imageResponse = new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '4',
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(modelResponse)
      .mockResolvedValueOnce(imageResponse);
    vi.stubGlobal('fetch', fetchMock);

    const NativeUrl = URL;
    class ObjectUrl extends NativeUrl {
      static readonly createObjectURL = vi.fn(() => 'blob:generated-frame');
      static readonly revokeObjectURL = vi.fn();
    }
    class LoadedImage {
      decoding = 'auto';
      naturalWidth = 64;
      naturalHeight = 64;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private currentSource = '';

      get src(): string {
        return this.currentSource;
      }

      set src(value: string) {
        this.currentSource = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('URL', ObjectUrl);
    vi.stubGlobal('Image', LoadedImage);

    const graph = modelGraph({
      runtime: 'api',
      transport: 'http',
      endpoint: 'https://models.example/v1/frame',
    });
    const { result } = renderHook(() => useVideoModel(graph, null));

    await act(async () => result.current.generate('model'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(requestInit).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    const [frameUrl, frameInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(frameUrl.href).toBe('https://cdn.example/frame.png');
    expect(frameInit).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    expect(frameInit.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.frames.has('model')).toBe(true);
    expect(result.current.getSession('model').state).toBe('ready');

    act(() => result.current.resetAll());
    expect(ObjectUrl.revokeObjectURL).toHaveBeenCalledWith(
      'blob:generated-frame',
    );
    expect(result.current.frames.size).toBe(0);
    expect(result.current.getSession('model')).toMatchObject({
      state: 'idle',
      error: null,
      hasCredential: false,
      lastFrameAt: null,
    });
  });

  it('aborts an active HTTP generation during a hard reset', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const graph = modelGraph({
      runtime: 'api',
      transport: 'http',
      endpoint: 'https://models.example/v1/frame',
    });
    const { result } = renderHook(() => useVideoModel(graph, null));
    let generation: Promise<void> | undefined;

    act(() => {
      generation = result.current.generate('model');
    });
    await act(async () => Promise.resolve());
    expect(requestSignal?.aborted).toBe(false);
    expect(result.current.getSession('model').state).toBe('generating');

    act(() => result.current.resetAll());
    expect(requestSignal?.aborted).toBe(true);
    if (generation) {
      await act(async () => generation);
    }
    expect(result.current.getSession('model')).toMatchObject({
      state: 'idle',
      error: null,
      hasCredential: false,
      lastFrameAt: null,
    });
  });

  it('keeps an HTTP credential out of the JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 503,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const graph = modelGraph({
      runtime: 'api',
      transport: 'http',
      endpoint: 'https://models.example/v1/frame',
    });
    const { result } = renderHook(() => useVideoModel(graph, null));

    act(() => result.current.setCredential('model', 'session-secret'));
    await act(async () => result.current.generate('model'));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer session-secret',
    });
    expect(typeof init.body).toBe('string');
    expect(init.body as string).not.toContain('session-secret');
    expect(result.current.getSession('model').state).toBe('error');
  });
});
