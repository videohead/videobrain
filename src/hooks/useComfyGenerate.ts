/**
 * G4 — ComfyUI Generate node runtime.
 *
 * Owns one session per reachable `comfyGenerate` node: capability discovery,
 * workflow readiness, job execution, and the decoded media that becomes the
 * node's frame texture. Completed outputs are ingested into the asset store,
 * so a result survives as durable media rather than only as a live texture.
 *
 * Nothing here runs automatically. Discovery and generation both start from an
 * explicit user action, and reopening a project never resubmits a job.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { compileGraph, type GraphDocument, type GraphNode } from '../graph';
import type { GenerationJobState, GenerationRequest } from '../store/contracts';
import {
  createAssetStore,
  createIndexedDbBackend,
  createMemoryBackend,
  type AssetStore,
} from '../store/assetStore';
import {
  assertComfyTransportSecurity,
  discoverComfyCapabilities,
  parseComfyEndpoint,
  type ComfyCapabilities,
} from '../generation/comfyClient';
import {
  COMFY_MODEL_FOLDERS,
  autoSelectComfyModels,
  checkComfyWorkflowReadiness,
  describeComfyWorkflowReadiness,
  findComfyWorkflowTemplate,
  type ComfyWorkflowTemplate,
} from '../generation/comfyWorkflows';
import { runComfyJob } from '../generation/comfyJob';

export interface ComfyNodeStatus {
  state: GenerationJobState | 'connecting';
  error: string | null;
  capabilities: ComfyCapabilities | null;
  /** Readable blocker from capability/model checks, if any. */
  readiness: string | null;
  template: ComfyWorkflowTemplate | null;
  models: Readonly<Record<string, string>>;
  hasCredential: boolean;
  resultAssetId: string | null;
  lastResultAt: number | null;
}

export interface ComfyGenerateRuntime {
  sources: ReadonlyMap<string, HTMLImageElement | HTMLVideoElement>;
  getStatus: (nodeId: string) => ComfyNodeStatus;
  canGenerate: (nodeId: string) => boolean;
  discover: (nodeId: string) => Promise<void>;
  generate: (nodeId: string) => Promise<void>;
  cancel: (nodeId: string) => void;
  setCredential: (nodeId: string, credential: string) => void;
  selectModel: (nodeId: string, slotId: string, filename: string) => void;
  assetStore: AssetStore;
}

const IDLE_STATUS: ComfyNodeStatus = {
  state: 'idle',
  error: null,
  capabilities: null,
  readiness: null,
  template: null,
  models: {},
  hasCredential: false,
  resultAssetId: null,
  lastResultAt: null,
};

const ACTIVE_STATES = new Set<GenerationJobState | 'connecting'>([
  'connecting',
  'submitting',
  'queued',
  'running',
  'fetching',
  'cancel-requested',
]);

interface Session {
  controller: AbortController | null;
  credential: string;
  capabilities: ComfyCapabilities | null;
  models: Record<string, string>;
  media: HTMLImageElement | HTMLVideoElement | null;
  objectUrl: string | null;
}

function numberParam(node: GraphNode, id: string, fallback: number): number {
  const value = node.params[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function textParamValue(node: GraphNode, id: string): string {
  const value = node.params[id];
  return typeof value === 'string' ? value : '';
}

function makeRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `comfy-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(16)}`;
}

/** Decode output bytes into an element the renderer can upload as a texture. */
function loadMedia(
  objectUrl: string,
  mimeType: string,
): Promise<HTMLImageElement | HTMLVideoElement> {
  if (mimeType.startsWith('video/')) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.onloadeddata = () => {
        void video.play().catch(() => undefined);
        resolve(video);
      };
      video.onerror = () =>
        reject(new Error('The generated clip could not be decoded.'));
      video.src = objectUrl;
    });
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('The generated image could not be decoded.'));
    image.src = objectUrl;
  });
}

function defaultAssetStore(): AssetStore {
  const hasIndexedDb =
    typeof globalThis !== 'undefined' && Boolean(globalThis.indexedDB);
  return createAssetStore(
    hasIndexedDb ? createIndexedDbBackend() : createMemoryBackend(),
  );
}

export function useComfyGenerate(
  document: GraphDocument,
  assetStoreOverride?: AssetStore,
): ComfyGenerateRuntime {
  const sessions = useRef(new Map<string, Session>());
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ComfyNodeStatus>>(
    new Map(),
  );
  const [sources, setSources] = useState<
    ReadonlyMap<string, HTMLImageElement | HTMLVideoElement>
  >(new Map());
  const [fallbackStore] = useState<AssetStore>(() => defaultAssetStore());
  const assetStore = assetStoreOverride ?? fallbackStore;

  // Only nodes that reach Display are live; a disconnected branch never
  // discovers capabilities or queues paid work.
  const activeNodes = useMemo(
    () =>
      new Map(
        compileGraph(document)
          .frameNodes.filter(({ node }) => node.kind === 'comfyGenerate')
          .map(({ node }) => [node.id, node] as const),
      ),
    [document],
  );

  const session = useCallback((nodeId: string): Session => {
    let entry = sessions.current.get(nodeId);
    if (!entry) {
      entry = {
        controller: null,
        credential: '',
        capabilities: null,
        models: {},
        media: null,
        objectUrl: null,
      };
      sessions.current.set(nodeId, entry);
    }
    return entry;
  }, []);

  const patch = useCallback(
    (nodeId: string, update: Partial<ComfyNodeStatus>) => {
      setStatuses((previous) => {
        const current = previous.get(nodeId) ?? IDLE_STATUS;
        return new Map(previous).set(nodeId, { ...current, ...update });
      });
    },
    [],
  );

  const releaseMedia = useCallback((entry: Session) => {
    if (entry.media instanceof HTMLVideoElement) {
      entry.media.pause();
      entry.media.src = '';
    }
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
    entry.media = null;
    entry.objectUrl = null;
  }, []);

  const discover = useCallback(
    async (nodeId: string) => {
      const node = activeNodes.get(nodeId);
      if (!node) return;
      const entry = session(nodeId);
      entry.controller?.abort();
      const controller = new AbortController();
      entry.controller = controller;
      patch(nodeId, { state: 'connecting', error: null });
      try {
        const base = parseComfyEndpoint(textParamValue(node, 'endpoint'));
        assertComfyTransportSecurity(base, entry.credential);
        const capabilities = await discoverComfyCapabilities(
          base,
          COMFY_MODEL_FOLDERS,
          { signal: controller.signal, apiKey: entry.credential || undefined },
        );
        const template = findComfyWorkflowTemplate(
          textParamValue(node, 'workflow'),
        );
        entry.capabilities = capabilities;
        if (template) {
          entry.models = autoSelectComfyModels(
            template,
            capabilities,
            entry.models,
          );
        }
        const readiness = template
          ? describeComfyWorkflowReadiness(
              checkComfyWorkflowReadiness(template, capabilities, entry.models),
            )
          : 'Select a workflow.';
        patch(nodeId, {
          state: 'idle',
          error: null,
          capabilities,
          template: template ?? null,
          models: { ...entry.models },
          readiness,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(nodeId, {
          state: 'failed',
          error: error instanceof Error ? error.message : 'Discovery failed.',
        });
      } finally {
        if (entry.controller === controller) {
          entry.controller = null;
        }
      }
    },
    [activeNodes, patch, session],
  );

  const canGenerate = useCallback(
    (nodeId: string) => {
      const status = statuses.get(nodeId) ?? IDLE_STATUS;
      return (
        activeNodes.has(nodeId) &&
        Boolean(status.capabilities) &&
        status.readiness === null &&
        !ACTIVE_STATES.has(status.state)
      );
    },
    [activeNodes, statuses],
  );

  const generate = useCallback(
    async (nodeId: string) => {
      const node = activeNodes.get(nodeId);
      if (!node) return;
      const entry = session(nodeId);
      const capabilities = entry.capabilities;
      const template = findComfyWorkflowTemplate(
        textParamValue(node, 'workflow'),
      );
      if (!capabilities || !template) {
        patch(nodeId, {
          state: 'failed',
          error: 'Connect to the ComfyUI server first.',
        });
        return;
      }
      const readiness = describeComfyWorkflowReadiness(
        checkComfyWorkflowReadiness(template, capabilities, entry.models),
      );
      if (readiness) {
        patch(nodeId, { state: 'failed', error: readiness, readiness });
        return;
      }

      entry.controller?.abort();
      const controller = new AbortController();
      entry.controller = controller;

      const request: GenerationRequest = {
        id: makeRequestId(),
        prompt: textParamValue(node, 'prompt'),
        model: Object.values(entry.models).join(' + '),
        adapter: 'comfyui',
        settings: {
          workflow: template.id,
          width: numberParam(node, 'width', 1024),
          height: numberParam(node, 'height', 1024),
          steps: numberParam(node, 'steps', 20),
          cfg: numberParam(node, 'cfg', 7),
          seed: numberParam(node, 'seed', 42),
          frames: numberParam(node, 'frames', 49),
          fps: numberParam(node, 'fps', 16),
        },
        outputKind: template.outputKind,
      };

      try {
        const base = parseComfyEndpoint(textParamValue(node, 'endpoint'));
        assertComfyTransportSecurity(base, entry.credential);
        const prompt = template.build({
          prompt: request.prompt,
          negativePrompt: textParamValue(node, 'negativePrompt'),
          models: entry.models,
          width: numberParam(node, 'width', 1024),
          height: numberParam(node, 'height', 1024),
          steps: numberParam(node, 'steps', 20),
          cfg: numberParam(node, 'cfg', 7),
          seed: numberParam(node, 'seed', 42),
          frames: numberParam(node, 'frames', 49),
          fps: numberParam(node, 'fps', 16),
        });
        const result = await runComfyJob({
          base,
          prompt,
          request,
          assetStore,
          clientId: nodeId,
          signal: controller.signal,
          apiKey: entry.credential || undefined,
          onStateChange: (job) =>
            patch(nodeId, { state: job.state, error: job.error }),
        });
        // A newer request may have replaced this one while it was running.
        if (entry.controller !== controller) {
          if (result.objectUrl) URL.revokeObjectURL(result.objectUrl);
          return;
        }
        if (result.job.state !== 'ready' || !result.objectUrl) {
          patch(nodeId, { state: result.job.state, error: result.job.error });
          return;
        }
        const media = await loadMedia(
          result.objectUrl,
          result.mimeType ?? 'image/png',
        );
        if (entry.controller !== controller) {
          URL.revokeObjectURL(result.objectUrl);
          return;
        }
        releaseMedia(entry);
        entry.media = media;
        entry.objectUrl = result.objectUrl;
        setSources((previous) => new Map(previous).set(nodeId, media));
        patch(nodeId, {
          state: 'ready',
          error: null,
          resultAssetId: result.job.resultRef?.id ?? null,
          lastResultAt: Date.now(),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(nodeId, {
          state: 'failed',
          error:
            error instanceof Error ? error.message : 'The generation failed.',
        });
      } finally {
        if (entry.controller === controller) {
          entry.controller = null;
        }
      }
    },
    [activeNodes, assetStore, patch, releaseMedia, session],
  );

  const cancel = useCallback(
    (nodeId: string) => {
      sessions.current.get(nodeId)?.controller?.abort();
      patch(nodeId, { state: 'cancel-requested' });
    },
    [patch],
  );

  const setCredential = useCallback(
    (nodeId: string, credential: string) => {
      session(nodeId).credential = credential;
      patch(nodeId, { hasCredential: credential.length > 0 });
    },
    [patch, session],
  );

  const selectModel = useCallback(
    (nodeId: string, slotId: string, filename: string) => {
      const entry = session(nodeId);
      entry.models = { ...entry.models, [slotId]: filename };
      const node = activeNodes.get(nodeId);
      const template = node
        ? findComfyWorkflowTemplate(textParamValue(node, 'workflow'))
        : null;
      const readiness =
        template && entry.capabilities
          ? describeComfyWorkflowReadiness(
              checkComfyWorkflowReadiness(
                template,
                entry.capabilities,
                entry.models,
              ),
            )
          : null;
      patch(nodeId, { models: { ...entry.models }, readiness });
    },
    [activeNodes, patch, session],
  );

  // Drop sessions for nodes that left the graph or the reachable set.
  useEffect(() => {
    for (const [nodeId, entry] of sessions.current) {
      if (activeNodes.has(nodeId)) continue;
      entry.controller?.abort();
      releaseMedia(entry);
      sessions.current.delete(nodeId);
      setSources((previous) => {
        if (!previous.has(nodeId)) return previous;
        const next = new Map(previous);
        next.delete(nodeId);
        return next;
      });
      setStatuses((previous) => {
        if (!previous.has(nodeId)) return previous;
        const next = new Map(previous);
        next.delete(nodeId);
        return next;
      });
    }
  }, [activeNodes, releaseMedia]);

  useEffect(() => {
    const current = sessions.current;
    return () => {
      for (const entry of current.values()) {
        entry.controller?.abort();
        releaseMedia(entry);
      }
      current.clear();
    };
  }, [releaseMedia]);

  const getStatus = useCallback(
    (nodeId: string): ComfyNodeStatus => statuses.get(nodeId) ?? IDLE_STATUS,
    [statuses],
  );

  return useMemo(
    () => ({
      sources,
      getStatus,
      canGenerate,
      discover,
      generate,
      cancel,
      setCredential,
      selectModel,
      assetStore,
    }),
    [
      assetStore,
      canGenerate,
      cancel,
      discover,
      generate,
      getStatus,
      selectModel,
      setCredential,
      sources,
    ],
  );
}
