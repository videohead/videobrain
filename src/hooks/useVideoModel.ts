import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MAX_RENDER_DIMENSION,
  MAX_RENDER_PIXELS,
  tryCompileGraph,
  type GraphDocument,
  type GraphNode,
} from '../graph';

const MAX_FRAME_BYTES = 20 * 1024 * 1024;
const MAX_SOCKET_BACKLOG_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_EDGE = 768;
const HTTP_REQUEST_TIMEOUT_MS = 120_000;
const SOCKET_FRAME_TIMEOUT_MS = 15_000;

export type VideoModelSessionState =
  | 'preview'
  | 'idle'
  | 'connecting'
  | 'live'
  | 'generating'
  | 'ready'
  | 'error';

export interface VideoModelConfig {
  nodeId: string;
  runtime: 'preview' | 'local' | 'api';
  transport: 'websocket' | 'http';
  endpoint: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  strength: number;
  guidance: number;
  seed: number;
  inputFps: number;
  hasSource: boolean;
  acceptsCameraFrames: boolean;
}

export interface VideoModelSessionView {
  state: VideoModelSessionState;
  error: string | null;
  hasCredential: boolean;
  lastFrameAt: number | null;
}

export interface VideoModelRuntime {
  frames: ReadonlyMap<string, HTMLImageElement>;
  getSession: (nodeId: string) => VideoModelSessionView;
  setCredential: (nodeId: string, credential: string) => void;
  connect: (nodeId: string) => void;
  disconnect: (nodeId: string) => void;
  resetAll: () => void;
  generate: (nodeId: string) => Promise<void>;
}

function stopSessionWork(session: MutableSession, reason: string): void {
  session.request?.abort();
  session.decodeRequest?.abort();
  if (session.configurationTimer !== undefined) {
    window.clearTimeout(session.configurationTimer);
  }
  clearSocketGeneration(session);
  session.request = undefined;
  session.requestSignature = undefined;
  session.decodeRequest = undefined;
  session.configurationTimer = undefined;
  session.pendingFrame = undefined;
  session.encodingInput = false;
  session.frameSequence += 1;
  const socket = session.socket;
  session.socket = undefined;
  session.connectedEndpoint = undefined;
  session.configurationSignature = undefined;
  socket?.close(1000, reason);
}

interface MutableSession {
  credential: string;
  credentialEndpoint?: string;
  socket?: WebSocket;
  request?: AbortController;
  requestSignature?: string;
  objectUrl?: string;
  encodingInput: boolean;
  lastInputAt: number;
  inputCanvas?: HTMLCanvasElement;
  connectedEndpoint?: string;
  configurationSignature?: string;
  pendingGenerate: boolean;
  generationSent: boolean;
  generationTimer?: number;
  frameSequence: number;
  decodingFrame: boolean;
  pendingFrame?: { source: Blob | string; sequence: number };
  decodeRequest?: AbortController;
  configurationTimer?: number;
}

function clearSocketGeneration(session: MutableSession): boolean {
  const wasPending =
    session.pendingGenerate || session.generationTimer !== undefined;
  if (session.generationTimer !== undefined) {
    window.clearTimeout(session.generationTimer);
  }
  session.pendingGenerate = false;
  session.generationSent = false;
  session.generationTimer = undefined;
  return wasPending;
}

interface ModelRequest {
  type: 'configure' | 'generate';
  protocol: 'videobrain.frames.v1';
  nodeId: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  settings: {
    strength: number;
    guidance: number;
    seed: number;
    inputFps: number;
  };
  input?: {
    type: 'jpeg';
    delivery: 'binary-websocket-message';
  };
  auth?: {
    type: 'bearer';
    token: string;
  };
}

function stringParam(node: GraphNode, id: string, fallback: string): string {
  const value = node.params[id];
  return typeof value === 'string' ? value : fallback;
}

function numberParam(node: GraphNode, id: string, fallback: number): number {
  const value = node.params[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveVideoModelConfig(
  graph: GraphDocument,
  nodeId: string,
): VideoModelConfig | null {
  const node = graph.nodes.find(
    (candidate) => candidate.id === nodeId && candidate.kind === 'videoModel',
  );
  if (!node) {
    return null;
  }

  const promptEdge = graph.edges.find(
    (edge) =>
      edge.target.nodeId === nodeId && edge.target.portId === 'prompt',
  );
  const promptNode = promptEdge
    ? graph.nodes.find(
        (candidate) =>
          candidate.id === promptEdge.source.nodeId &&
          candidate.kind === 'aiPrompt',
      )
    : undefined;
  const sourceEdge = graph.edges.find(
    (edge) =>
      edge.target.nodeId === nodeId && edge.target.portId === 'source',
  );
  const sourceNode = sourceEdge
    ? graph.nodes.find((candidate) => candidate.id === sourceEdge.source.nodeId)
    : undefined;
  const runtimeValue = stringParam(node, 'runtime', 'preview');
  const transportValue = stringParam(node, 'transport', 'websocket');
  const transport = transportValue === 'http' ? 'http' : 'websocket';

  return {
    nodeId,
    runtime:
      runtimeValue === 'local' || runtimeValue === 'api'
        ? runtimeValue
        : 'preview',
    transport,
    endpoint: stringParam(node, 'endpoint', ''),
    model: stringParam(node, 'model', ''),
    prompt: promptNode ? stringParam(promptNode, 'text', '') : '',
    negativePrompt: promptNode ? stringParam(promptNode, 'negative', '') : '',
    strength: numberParam(node, 'strength', 0.7),
    guidance: numberParam(node, 'guidance', 1.2),
    seed: Math.round(numberParam(node, 'seed', 42)),
    inputFps: Math.max(1, numberParam(node, 'inputFps', 12)),
    hasSource: sourceEdge !== undefined,
    acceptsCameraFrames:
      sourceNode?.kind === 'videoInput' && transport === 'websocket',
  };
}

export function parseVideoModelEndpoint(
  endpoint: string,
  transport: VideoModelConfig['transport'],
): URL {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error('Enter a complete model endpoint URL.');
  }
  const allowed =
    transport === 'websocket'
      ? new Set(['ws:', 'wss:'])
      : new Set(['http:', 'https:']);
  if (!allowed.has(url.protocol)) {
    throw new Error(
      transport === 'websocket'
        ? 'A WebSocket endpoint must start with ws:// or wss://.'
        : 'An HTTP endpoint must start with http:// or https://.',
    );
  }
  if (url.username || url.password) {
    throw new Error('Put credentials in the session key field, not the URL.');
  }
  if (url.hash) {
    throw new Error('Model endpoint URLs cannot include a fragment.');
  }
  return url;
}

export function assertVideoModelTransportSecurity(
  config: VideoModelConfig,
  url: URL,
  credential = '',
): void {
  const insecure = url.protocol === 'http:' || url.protocol === 'ws:';
  if (!insecure) {
    return;
  }
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:'
  ) {
    throw new Error(
      'This secure page requires HTTPS or a secure WebSocket endpoint.',
    );
  }
  if (config.runtime === 'api') {
    throw new Error('API endpoints require HTTPS or a secure WebSocket.');
  }
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (!isLoopback) {
    throw new Error('Plain HTTP and WebSocket model endpoints are limited to loopback.');
  }
  if (credential) {
    throw new Error('Session keys require HTTPS or a secure WebSocket.');
  }
}

export function createVideoModelRequest(
  config: VideoModelConfig,
  type: ModelRequest['type'],
  credential = '',
): ModelRequest {
  return {
    type,
    protocol: 'videobrain.frames.v1',
    nodeId: config.nodeId,
    model: config.model,
    prompt: config.prompt,
    negativePrompt: config.negativePrompt,
    settings: {
      strength: config.strength,
      guidance: config.guidance,
      seed: config.seed,
      inputFps: config.inputFps,
    },
    ...(config.acceptsCameraFrames
      ? {
          input: {
            type: 'jpeg' as const,
            delivery: 'binary-websocket-message' as const,
          },
        }
      : {}),
    ...(credential
      ? { auth: { type: 'bearer' as const, token: credential } }
      : {}),
  };
}

function videoModelConfigurationSignature(config: VideoModelConfig): string {
  return JSON.stringify({
    runtime: config.runtime,
    transport: config.transport,
    endpoint: config.endpoint,
    request: createVideoModelRequest(config, 'generate'),
  });
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The model request failed.';
}

function remoteImageFromJson(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['image', 'frame', 'url', 'image_url']) {
    const candidate = record[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  const data = record.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    const first = data[0] as Record<string, unknown>;
    if (typeof first.url === 'string') {
      return first.url;
    }
  }
  return null;
}

export function normalizeVideoModelImageUrl(source: string): URL | null {
  const normalizedSource = source.trim();
  const isDataImage = /^data:image\//i.test(normalizedSource);
  if (
    isDataImage &&
    normalizedSource.length > Math.ceil((MAX_FRAME_BYTES * 4) / 3) + 256
  ) {
    return null;
  }
  try {
    const url = new URL(normalizedSource);
    if (url.username || url.password) {
      return null;
    }
    if (url.protocol === 'data:') {
      return isDataImage ? url : null;
    }
    return new Set(['http:', 'https:', 'blob:']).has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function modelAbortError(): DOMException {
  return new DOMException('The model request was cancelled.', 'AbortError');
}

async function loadImage(
  source: Blob | string,
  signal?: AbortSignal,
): Promise<{ image: HTMLImageElement; objectUrl?: string }> {
  if (signal?.aborted) {
    throw modelAbortError();
  }
  const normalizedUrl =
    typeof source === 'string' ? normalizeVideoModelImageUrl(source) : null;
  if (
    normalizedUrl?.protocol === 'http:' ||
    normalizedUrl?.protocol === 'https:'
  ) {
    const response = await fetch(normalizedUrl, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Generated frame download failed with HTTP ${response.status}.`);
    }
    return loadImage(await readBoundedBlob(response), signal);
  }
  if (source instanceof Blob) {
    if (source.size > MAX_FRAME_BYTES) {
      throw new Error('The generated frame exceeds the 20 MB safety limit.');
    }
    if (source.type && !source.type.startsWith('image/')) {
      throw new Error('The model returned a non-image binary message.');
    }
  } else if (!normalizedUrl) {
    throw new Error('The model returned an unsupported image URL.');
  }

  const objectUrl =
    source instanceof Blob ? URL.createObjectURL(source) : undefined;
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
      image.onload = null;
      image.onerror = null;
    };
    const handleAbort = () => {
      cleanup();
      image.src = '';
      reject(modelAbortError());
    };
    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('The generated frame could not be decoded.'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    image.src =
      source instanceof Blob ? (objectUrl as string) : (normalizedUrl as URL).href;
  });
  try {
    await loaded;
  } catch (error) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    throw error;
  }
  if (
    image.naturalWidth < 1 ||
    image.naturalHeight < 1 ||
    image.naturalWidth > MAX_RENDER_DIMENSION ||
    image.naturalHeight > MAX_RENDER_DIMENSION ||
    image.naturalWidth * image.naturalHeight > MAX_RENDER_PIXELS
  ) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    throw new Error('The generated frame exceeds the GPU dimension limit.');
  }
  return { image, ...(objectUrl ? { objectUrl } : {}) };
}

function reachableVideoModelNodeIds(graph: GraphDocument): Set<string> {
  const compiled = tryCompileGraph(graph);
  if (!compiled.ok) {
    return new Set();
  }
  return new Set(
    compiled.graph.frameNodes
      .filter(({ node }) => node.kind === 'videoModel')
      .map(({ node }) => node.id),
  );
}

async function readBoundedBlob(response: Response): Promise<Blob> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FRAME_BYTES) {
    throw new Error('The generated frame exceeds the 20 MB safety limit.');
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_FRAME_BYTES) {
      throw new Error('The generated frame exceeds the 20 MB safety limit.');
    }
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      received += result.value.byteLength;
      if (received > MAX_FRAME_BYTES) {
        await reader.cancel();
        throw new Error('The generated frame exceeds the 20 MB safety limit.');
      }
      const copy = new Uint8Array(result.value.byteLength);
      copy.set(result.value);
      chunks.push(copy.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, {
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  });
}

export function useVideoModel(
  graph: GraphDocument,
  cameraSource: HTMLVideoElement | null,
): VideoModelRuntime {
  const graphRef = useRef(graph);
  const sessionsRef = useRef(new Map<string, MutableSession>());
  const mountedRef = useRef(true);
  const [views, setViews] = useState<Record<string, VideoModelSessionView>>({});
  const [frames, setFrames] = useState<ReadonlyMap<string, HTMLImageElement>>(
    () => new Map(),
  );
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sessionFor = useCallback((nodeId: string): MutableSession => {
    const existing = sessionsRef.current.get(nodeId);
    if (existing) {
      return existing;
    }
    const session: MutableSession = {
      credential: '',
      encodingInput: false,
      lastInputAt: 0,
      pendingGenerate: false,
      generationSent: false,
      frameSequence: 0,
      decodingFrame: false,
    };
    sessionsRef.current.set(nodeId, session);
    return session;
  }, []);

  const updateView = useCallback(
    (
      nodeId: string,
      update: Partial<VideoModelSessionView>,
      fallbackState: VideoModelSessionState = 'idle',
    ) => {
      if (!mountedRef.current) {
        return;
      }
      setViews((current) => ({
        ...current,
        [nodeId]: {
          state: fallbackState,
          error: null,
          hasCredential:
            (sessionsRef.current.get(nodeId)?.credential.length ?? 0) !== 0,
          lastFrameAt: null,
          ...current[nodeId],
          ...update,
        },
      }));
    },
    [],
  );

  const publishFrame = useCallback(
    async (
      nodeId: string,
      source: Blob | string,
      sequence: number,
      signal?: AbortSignal,
    ) => {
      const loaded = await loadImage(source, signal);
      const session = sessionsRef.current.get(nodeId);
      if (
        !mountedRef.current ||
        !session ||
        session.frameSequence !== sequence
      ) {
        if (loaded.objectUrl) {
          URL.revokeObjectURL(loaded.objectUrl);
        }
        return;
      }
      if (session.objectUrl) {
        URL.revokeObjectURL(session.objectUrl);
      }
      session.objectUrl = loaded.objectUrl;
      setFrames((current) => {
        const next = new Map(current);
        next.set(nodeId, loaded.image);
        return next;
      });
      const socketLive = session.socket?.readyState === WebSocket.OPEN;
      updateView(nodeId, {
        state: socketLive ? 'live' : 'ready',
        error: null,
        lastFrameAt: Date.now(),
      });
    },
    [updateView],
  );

  const enqueueSocketFrame = useCallback(
    (nodeId: string, source: Blob | string) => {
      const session = sessionFor(nodeId);
      const completedGeneration = clearSocketGeneration(session);
      if (
        completedGeneration &&
        session.socket?.readyState === WebSocket.OPEN
      ) {
        updateView(nodeId, { state: 'live', error: null });
      }
      session.frameSequence += 1;
      session.pendingFrame = {
        source,
        sequence: session.frameSequence,
      };
      if (session.decodingFrame) {
        return;
      }
      session.decodingFrame = true;
      void (async () => {
        try {
          while (
            session.pendingFrame !== undefined &&
            sessionsRef.current.get(nodeId) === session
          ) {
            const nextFrame = session.pendingFrame;
            session.pendingFrame = undefined;
            const decodeRequest = new AbortController();
            session.decodeRequest = decodeRequest;
            let timedOut = false;
            const timeout = window.setTimeout(() => {
              timedOut = true;
              decodeRequest.abort();
            }, SOCKET_FRAME_TIMEOUT_MS);
            try {
              await publishFrame(
                nodeId,
                nextFrame.source,
                nextFrame.sequence,
                decodeRequest.signal,
              );
            } catch (error) {
              const isCurrentSession =
                sessionsRef.current.get(nodeId) === session;
              if (timedOut && isCurrentSession) {
                updateView(nodeId, {
                  state:
                    session.socket?.readyState === WebSocket.OPEN
                      ? 'live'
                      : 'error',
                  error: 'A streamed model frame timed out while loading.',
                });
              } else if (
                isCurrentSession &&
                !(
                  error instanceof DOMException &&
                  error.name === 'AbortError'
                )
              ) {
                updateView(nodeId, {
                  state:
                    session.socket?.readyState === WebSocket.OPEN
                      ? 'live'
                      : 'error',
                  error: messageFrom(error),
                });
              }
            } finally {
              window.clearTimeout(timeout);
              if (session.decodeRequest === decodeRequest) {
                session.decodeRequest = undefined;
              }
            }
          }
        } finally {
          session.decodingFrame = false;
        }
      })();
    },
    [publishFrame, sessionFor, updateView],
  );

  const handleSocketMessage = useCallback(
    (nodeId: string, data: unknown) => {
      if (data instanceof Blob) {
        enqueueSocketFrame(nodeId, data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        if (data.byteLength > MAX_FRAME_BYTES) {
          throw new Error('The generated frame exceeds the 20 MB safety limit.');
        }
        enqueueSocketFrame(
          nodeId,
          new Blob([data], { type: 'image/jpeg' }),
        );
        return;
      }
      if (typeof data !== 'string') {
        return;
      }
      if (data.length > Math.ceil((MAX_FRAME_BYTES * 4) / 3) + 256) {
        throw new Error('The generated frame message exceeds the safety limit.');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(data) as unknown;
      } catch {
        if (data.startsWith('data:image/')) {
          enqueueSocketFrame(nodeId, data);
        }
        return;
      }
      if (decoded && typeof decoded === 'object') {
        const record = decoded as Record<string, unknown>;
        if (record.type === 'error') {
          throw new Error(
            typeof record.message === 'string'
              ? record.message
              : 'The model worker reported an error.',
          );
        }
      }
      const source = remoteImageFromJson(decoded);
      if (source) {
        enqueueSocketFrame(nodeId, source);
      }
    },
    [enqueueSocketFrame],
  );

  const sendConfiguration = useCallback(
    (nodeId: string, force = false) => {
      const config = resolveVideoModelConfig(graphRef.current, nodeId);
      const session = sessionsRef.current.get(nodeId);
      if (
        !config ||
        !session?.socket ||
        session.socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      const credential =
        session.credentialEndpoint === config.endpoint
          ? session.credential
          : '';
      try {
        const url = parseVideoModelEndpoint(config.endpoint, 'websocket');
        assertVideoModelTransportSecurity(config, url, credential);
      } catch (error) {
        stopSessionWork(session, 'Secure transport required');
        updateView(nodeId, { state: 'error', error: messageFrom(error) });
        return;
      }
      const serialized = JSON.stringify(
        createVideoModelRequest(config, 'configure', credential),
      );
      if (!force && session.configurationSignature === serialized) {
        return;
      }
      session.configurationSignature = serialized;
      try {
        session.socket.send(serialized);
      } catch (error) {
        stopSessionWork(session, 'Send failed');
        updateView(nodeId, { state: 'error', error: messageFrom(error) });
      }
    },
    [updateView],
  );

  const scheduleConfiguration = useCallback(
    (nodeId: string) => {
      const session = sessionsRef.current.get(nodeId);
      if (!session?.socket) {
        return;
      }
      if (session.configurationTimer !== undefined) {
        window.clearTimeout(session.configurationTimer);
      }
      session.configurationTimer = window.setTimeout(() => {
        session.configurationTimer = undefined;
        sendConfiguration(nodeId);
      }, 120);
    },
    [sendConfiguration],
  );

  const beginSocketGeneration = useCallback(
    (nodeId: string, session: MutableSession, socket: WebSocket): boolean => {
      if (session.pendingGenerate) {
        return false;
      }
      session.pendingGenerate = true;
      session.generationSent = false;
      const generationTimer = window.setTimeout(() => {
        if (
          sessionsRef.current.get(nodeId) !== session ||
          session.socket !== socket ||
          session.generationTimer !== generationTimer ||
          !session.pendingGenerate
        ) {
          return;
        }
        if (socket.readyState === WebSocket.OPEN) {
          clearSocketGeneration(session);
          updateView(nodeId, {
            state: 'live',
            error: 'The model frame request timed out after 120 seconds.',
          });
          return;
        }
        stopSessionWork(session, 'Generation timed out');
        updateView(nodeId, {
          state: 'error',
          error: 'The model frame request timed out after 120 seconds.',
        });
      }, HTTP_REQUEST_TIMEOUT_MS);
      session.generationTimer = generationTimer;
      updateView(nodeId, { state: 'generating', error: null });
      return true;
    },
    [updateView],
  );

  const sendSocketGeneration = useCallback(
    (nodeId: string, session: MutableSession, socket: WebSocket) => {
      if (
        session.socket !== socket ||
        socket.readyState !== WebSocket.OPEN ||
        !session.pendingGenerate ||
        session.generationSent
      ) {
        return;
      }

      const config = resolveVideoModelConfig(graphRef.current, nodeId);
      if (
        !config ||
        config.runtime === 'preview' ||
        config.transport !== 'websocket'
      ) {
        clearSocketGeneration(session);
        updateView(nodeId, {
          state: config?.runtime === 'preview' ? 'preview' : 'idle',
          error: null,
        });
        return;
      }
      const credential =
        session.credentialEndpoint === config.endpoint
          ? session.credential
          : '';
      try {
        const url = parseVideoModelEndpoint(config.endpoint, 'websocket');
        assertVideoModelTransportSecurity(config, url, credential);
      } catch (error) {
        stopSessionWork(session, 'Secure transport required');
        updateView(nodeId, { state: 'error', error: messageFrom(error) });
        return;
      }
      if (socket.bufferedAmount > MAX_SOCKET_BACKLOG_BYTES) {
        clearSocketGeneration(session);
        updateView(nodeId, {
          state: 'live',
          error:
            'The model connection is backlogged. Wait before requesting another frame.',
        });
        return;
      }

      session.generationSent = true;
      updateView(nodeId, { state: 'generating', error: null });
      try {
        socket.send(
          JSON.stringify(
            createVideoModelRequest(config, 'generate', credential),
          ),
        );
      } catch (error) {
        stopSessionWork(session, 'Send failed');
        updateView(nodeId, { state: 'error', error: messageFrom(error) });
      }
    },
    [updateView],
  );

  const disconnect = useCallback(
    (nodeId: string) => {
      const session = sessionsRef.current.get(nodeId);
      if (session) {
        stopSessionWork(session, 'Disconnected');
      }
      const config = resolveVideoModelConfig(graphRef.current, nodeId);
      updateView(
        nodeId,
        {
          state: config?.runtime === 'preview' ? 'preview' : 'idle',
          error: null,
        },
        config?.runtime === 'preview' ? 'preview' : 'idle',
      );
    },
    [updateView],
  );

  const resetAll = useCallback(() => {
    for (const session of sessionsRef.current.values()) {
      stopSessionWork(session, 'Project reset');
      if (session.objectUrl) {
        URL.revokeObjectURL(session.objectUrl);
        session.objectUrl = undefined;
      }
      session.credential = '';
      session.credentialEndpoint = undefined;
      if (session.inputCanvas) {
        session.inputCanvas.width = 0;
        session.inputCanvas.height = 0;
        session.inputCanvas = undefined;
      }
    }
    sessionsRef.current.clear();
    setFrames(new Map());
    setViews({});
  }, []);

  const connect = useCallback(
    (nodeId: string) => {
      const config = resolveVideoModelConfig(graphRef.current, nodeId);
      if (!config || config.runtime === 'preview') {
        updateView(nodeId, { state: 'preview', error: null }, 'preview');
        return;
      }
      if (!reachableVideoModelNodeIds(graphRef.current).has(nodeId)) {
        updateView(nodeId, {
          state: 'error',
          error: 'Connect this node to a Display before starting the model.',
        });
        return;
      }
      if (config.transport !== 'websocket') {
        updateView(nodeId, {
          state: 'idle',
          error: 'HTTP mode uses Generate instead of a persistent connection.',
        });
        return;
      }

      let url: URL;
      try {
        url = parseVideoModelEndpoint(config.endpoint, 'websocket');
        const session = sessionsRef.current.get(nodeId);
        const credential =
          session?.credentialEndpoint === config.endpoint
            ? session.credential
            : '';
        assertVideoModelTransportSecurity(config, url, credential);
      } catch (error) {
        updateView(nodeId, { state: 'error', error: messageFrom(error) });
        return;
      }

      disconnect(nodeId);
      const session = sessionFor(nodeId);
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        updateView(nodeId, { state: 'error', error: messageFrom(error) });
        return;
      }
      socket.binaryType = 'arraybuffer';
      session.socket = socket;
      session.connectedEndpoint = url.href;
      session.configurationSignature = undefined;
      updateView(nodeId, { state: 'connecting', error: null });

      socket.addEventListener('open', () => {
        if (session.socket !== socket) {
          return;
        }
        updateView(nodeId, { state: 'live', error: null });
        sendConfiguration(nodeId, true);
        if (session.pendingGenerate) {
          sendSocketGeneration(nodeId, session, socket);
        }
      });
      socket.addEventListener('message', (event) => {
        if (session.socket !== socket) {
          return;
        }
        try {
          handleSocketMessage(nodeId, event.data);
        } catch (error) {
          clearSocketGeneration(session);
          updateView(nodeId, { state: 'live', error: messageFrom(error) });
        }
      });
      socket.addEventListener('error', () => {
        if (session.socket === socket) {
          stopSessionWork(session, 'Connection error');
          updateView(nodeId, {
            state: 'error',
            error: 'The model WebSocket could not connect.',
          });
        }
      });
      socket.addEventListener('close', (event) => {
        if (session.socket !== socket) {
          return;
        }
        session.socket = undefined;
        stopSessionWork(session, 'Connection closed');
        updateView(nodeId, {
          state: event.wasClean ? 'idle' : 'error',
          error: event.wasClean
            ? null
            : 'The model WebSocket closed unexpectedly.',
        });
      });
    },
    [
      disconnect,
      handleSocketMessage,
      sendConfiguration,
      sendSocketGeneration,
      sessionFor,
      updateView,
    ],
  );

  const setCredential = useCallback(
    (nodeId: string, credential: string) => {
      const session = sessionFor(nodeId);
      const config = resolveVideoModelConfig(graphRef.current, nodeId);
      if (credential && config) {
        try {
          const url = parseVideoModelEndpoint(
            config.endpoint,
            config.transport,
          );
          assertVideoModelTransportSecurity(config, url, credential);
        } catch (error) {
          stopSessionWork(session, 'Secure transport required');
          session.credential = '';
          session.credentialEndpoint = undefined;
          updateView(nodeId, {
            hasCredential: false,
            state: 'error',
            error: messageFrom(error),
          });
          return;
        }
      }
      const cancelledRequest = session.request !== undefined;
      if (cancelledRequest) {
        session.request?.abort();
        session.request = undefined;
        session.requestSignature = undefined;
        session.frameSequence += 1;
      }
      session.credential = credential;
      session.credentialEndpoint = config?.endpoint;
      updateView(nodeId, {
        hasCredential: credential.length > 0,
        error: null,
        ...(cancelledRequest ? { state: 'idle' as const } : {}),
      });
      sendConfiguration(nodeId, true);
    },
    [sendConfiguration, sessionFor, updateView],
  );

  const generate = useCallback(
    async (nodeId: string) => {
      const config = resolveVideoModelConfig(graphRef.current, nodeId);
      if (!config || config.runtime === 'preview') {
        updateView(nodeId, { state: 'preview', error: null }, 'preview');
        return;
      }
      if (!reachableVideoModelNodeIds(graphRef.current).has(nodeId)) {
        updateView(nodeId, {
          state: 'error',
          error: 'Connect this node to a Display before starting the model.',
        });
        return;
      }
      if (config.transport === 'websocket') {
        const session = sessionFor(nodeId);
        const credential =
          session.credentialEndpoint === config.endpoint
            ? session.credential
            : '';
        try {
          const url = parseVideoModelEndpoint(config.endpoint, 'websocket');
          assertVideoModelTransportSecurity(config, url, credential);
        } catch (error) {
          stopSessionWork(session, 'Secure transport required');
          updateView(nodeId, { state: 'error', error: messageFrom(error) });
          return;
        }
        if (session.pendingGenerate) {
          return;
        }
        if (session.socket?.readyState === WebSocket.CONNECTING) {
          beginSocketGeneration(nodeId, session, session.socket);
          return;
        }
        if (session.socket?.readyState !== WebSocket.OPEN) {
          connect(nodeId);
          const connectingSession = sessionsRef.current.get(nodeId);
          if (connectingSession?.socket) {
            beginSocketGeneration(
              nodeId,
              connectingSession,
              connectingSession.socket,
            );
          }
          return;
        }
        if (beginSocketGeneration(nodeId, session, session.socket)) {
          sendSocketGeneration(nodeId, session, session.socket);
        }
        return;
      }

      const session = sessionFor(nodeId);
      session.request?.abort();
      const request = new AbortController();
      session.request = request;
      session.requestSignature = videoModelConfigurationSignature(config);
      session.frameSequence += 1;
      const sequence = session.frameSequence;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        request.abort();
      }, HTTP_REQUEST_TIMEOUT_MS);
      updateView(nodeId, { state: 'generating', error: null });
      try {
        const url = parseVideoModelEndpoint(config.endpoint, 'http');
        const credential =
          session.credentialEndpoint === config.endpoint
            ? session.credential
            : '';
        assertVideoModelTransportSecurity(config, url, credential);
        const response = await fetch(url, {
          method: 'POST',
          signal: request.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            ...(credential
              ? { Authorization: `Bearer ${credential}` }
              : {}),
          },
          body: JSON.stringify(
            createVideoModelRequest(config, 'generate'),
          ),
        });
        if (!response.ok) {
          throw new Error(`Model request failed with HTTP ${response.status}.`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        const responseBlob = await readBoundedBlob(response);
        if (contentType.startsWith('image/')) {
          await publishFrame(nodeId, responseBlob, sequence, request.signal);
        } else {
          const source = remoteImageFromJson(
            JSON.parse(await responseBlob.text()) as unknown,
          );
          if (!source) {
            throw new Error('The model response did not include an image.');
          }
          await publishFrame(nodeId, source, sequence, request.signal);
        }
      } catch (error) {
        const isCurrentRequest =
          sessionsRef.current.get(nodeId) === session &&
          session.frameSequence === sequence;
        if (timedOut && isCurrentRequest) {
          updateView(nodeId, {
            state: 'error',
            error: 'The model request timed out after 120 seconds.',
          });
        } else if (
          isCurrentRequest &&
          !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          updateView(nodeId, { state: 'error', error: messageFrom(error) });
        }
      } finally {
        window.clearTimeout(timeout);
        if (session.request === request) {
          session.request = undefined;
          session.requestSignature = undefined;
        }
      }
    },
    [
      beginSocketGeneration,
      connect,
      publishFrame,
      sendSocketGeneration,
      sessionFor,
      updateView,
    ],
  );

  useEffect(() => {
    const modelNodeIds = reachableVideoModelNodeIds(graph);
    for (const [nodeId, session] of sessionsRef.current) {
      if (modelNodeIds.has(nodeId)) {
        continue;
      }
      stopSessionWork(session, 'Node inactive');
      if (session.objectUrl) {
        URL.revokeObjectURL(session.objectUrl);
      }
      sessionsRef.current.delete(nodeId);
      const inactiveConfig = resolveVideoModelConfig(graph, nodeId);
      if (inactiveConfig) {
        const inactiveState =
          inactiveConfig.runtime === 'preview' ? 'preview' : 'idle';
        updateView(
          nodeId,
          {
            state: inactiveState,
            error: null,
            hasCredential: false,
            lastFrameAt: null,
          },
          inactiveState,
        );
      }
    }
    queueMicrotask(() => {
      if (!mountedRef.current) {
        return;
      }
      const latestModelNodeIds = reachableVideoModelNodeIds(graphRef.current);
      const existingModelNodeIds = new Set(
        graphRef.current.nodes
          .filter(({ kind }) => kind === 'videoModel')
          .map(({ id }) => id),
      );
      setFrames((current) => {
        const next = new Map(
          [...current].filter(([nodeId]) => latestModelNodeIds.has(nodeId)),
        );
        return next.size === current.size ? current : next;
      });
      setViews((current) => {
        const entries = Object.entries(current).filter(([nodeId]) =>
          existingModelNodeIds.has(nodeId),
        );
        return entries.length === Object.keys(current).length
          ? current
          : Object.fromEntries(entries);
      });
    });
    for (const nodeId of modelNodeIds) {
      const config = resolveVideoModelConfig(graph, nodeId);
      if (!config) {
        continue;
      }
      if (config.runtime === 'preview') {
        const session = sessionsRef.current.get(nodeId);
        if (session) {
          stopSessionWork(session, 'Preview selected');
          if (session.objectUrl) {
            URL.revokeObjectURL(session.objectUrl);
          }
          session.objectUrl = undefined;
        }
        queueMicrotask(() => {
          if (!mountedRef.current) {
            return;
          }
          if (
            resolveVideoModelConfig(graphRef.current, nodeId)?.runtime !==
            'preview'
          ) {
            return;
          }
          setFrames((current) => {
            if (!current.has(nodeId)) {
              return current;
            }
            const next = new Map(current);
            next.delete(nodeId);
            return next;
          });
        });
        updateView(nodeId, { state: 'preview', error: null }, 'preview');
      } else {
        const session = sessionsRef.current.get(nodeId);
        if (
          session?.request &&
          session.requestSignature !== videoModelConfigurationSignature(config)
        ) {
          session.request.abort();
          session.request = undefined;
          session.requestSignature = undefined;
          session.frameSequence += 1;
          updateView(nodeId, { state: 'idle', error: null });
        }
        let parsedEndpoint: string | undefined;
        try {
          parsedEndpoint = parseVideoModelEndpoint(
            config.endpoint,
            config.transport,
          ).href;
        } catch {
          parsedEndpoint = undefined;
        }
        if (
          session?.socket &&
          (config.transport !== 'websocket' ||
            session.connectedEndpoint !== parsedEndpoint)
        ) {
          disconnect(nodeId);
        } else {
          scheduleConfiguration(nodeId);
        }
        if (
          session?.credentialEndpoint &&
          session.credentialEndpoint !== config.endpoint
        ) {
          session.credential = '';
          session.credentialEndpoint = undefined;
          updateView(nodeId, { hasCredential: false });
        }
      }
    }
  }, [disconnect, graph, scheduleConfiguration, updateView]);

  useEffect(() => {
    if (!cameraSource) {
      return;
    }
    let animationFrame = 0;
    let active = true;
    const modelNodeIds = reachableVideoModelNodeIds(graph);
    const sendInputFrames = (timestamp: number) => {
      try {
        for (const nodeId of modelNodeIds) {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) {
            continue;
          }
          const config = resolveVideoModelConfig(graph, nodeId);
          const session = sessionsRef.current.get(nodeId);
          const socket = session?.socket;
          if (
            !config?.acceptsCameraFrames ||
            !session ||
            !socket ||
            socket.readyState !== WebSocket.OPEN ||
            socket.bufferedAmount > MAX_SOCKET_BACKLOG_BYTES ||
            session.encodingInput ||
            cameraSource.readyState < 2 ||
            timestamp - session.lastInputAt < 1_000 / config.inputFps
          ) {
            continue;
          }

          const sourceWidth = cameraSource.videoWidth;
          const sourceHeight = cameraSource.videoHeight;
          if (sourceWidth < 1 || sourceHeight < 1) {
            continue;
          }
          const scale = Math.min(
            1,
            MAX_INPUT_EDGE / Math.max(sourceWidth, sourceHeight),
          );
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          const canvas =
            session.inputCanvas ?? window.document.createElement('canvas');
          session.inputCanvas = canvas;
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) {
            continue;
          }
          try {
            context.drawImage(cameraSource, 0, 0, width, height);
            session.encodingInput = true;
            session.lastInputAt = timestamp;
            canvas.toBlob(
              (blob) => {
                session.encodingInput = false;
                const latestConfig = resolveVideoModelConfig(
                  graphRef.current,
                  nodeId,
                );
                if (
                  active &&
                  blob &&
                  graphRef.current === graph &&
                  latestConfig?.acceptsCameraFrames &&
                  session.socket === socket &&
                  socket.readyState === WebSocket.OPEN &&
                  socket.bufferedAmount <= MAX_SOCKET_BACKLOG_BYTES
                ) {
                  try {
                    socket.send(blob);
                  } catch {
                    stopSessionWork(session, 'Camera send failed');
                    updateView(nodeId, {
                      state: 'error',
                      error: 'The camera frame could not be sent.',
                    });
                  }
                }
              },
              'image/jpeg',
              0.82,
            );
          } catch {
            session.encodingInput = false;
          }
        }
      } finally {
        if (active) {
          animationFrame = window.requestAnimationFrame(sendInputFrames);
        }
      }
    };
    animationFrame = window.requestAnimationFrame(sendInputFrames);
    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [cameraSource, graph, updateView]);

  useEffect(
    () => {
      const sessions = sessionsRef.current;
      return () => {
        for (const session of sessions.values()) {
          stopSessionWork(session, 'Page closed');
          if (session.objectUrl) {
            URL.revokeObjectURL(session.objectUrl);
          }
        }
        sessions.clear();
      };
    },
    [],
  );

  const getSession = useCallback(
    (nodeId: string): VideoModelSessionView => {
      const config = resolveVideoModelConfig(graph, nodeId);
      return (
        views[nodeId] ?? {
          state: config?.runtime === 'preview' ? 'preview' : 'idle',
          error: null,
          hasCredential:
            (sessionsRef.current.get(nodeId)?.credential.length ?? 0) !== 0,
          lastFrameAt: null,
        }
      );
    },
    [graph, views],
  );

  return useMemo(
    () => ({
      frames,
      getSession,
      setCredential,
      connect,
      disconnect,
      resetAll,
      generate,
    }),
    [
      connect,
      disconnect,
      frames,
      generate,
      getSession,
      resetAll,
      setCredential,
    ],
  );
}
