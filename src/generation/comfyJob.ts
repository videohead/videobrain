/**
 * G4 — ComfyUI job lifecycle.
 *
 * Drives one generation request through the GenerationJobState machine defined
 * in contracts.ts: submit, poll history, download the output, and hand the
 * bytes to the asset store. Polling is explicit, never driven from the render
 * loop, and a job that loses its submission response reconciles by request id
 * rather than resubmitting work that may already be running.
 */
import {
  MAX_GENERATION_OUTPUT_BYTES,
  type GenerationJob,
  type GenerationJobState,
  type GenerationRequest,
} from '../store/contracts';
import type { AssetIngestResult, AssetStore } from '../store/assetStore';
import {
  cancelComfyPrompt,
  fetchComfyHistory,
  fetchComfyOutput,
  findComfyPromptByRequestId,
  submitComfyPrompt,
  type ComfyOutputFile,
  type ComfyRequestOptions,
} from './comfyClient';
import type { ComfyPromptGraph } from './comfyWorkflows';

export const COMFY_POLL_INTERVAL_MS = 1_500;
export const COMFY_JOB_TIMEOUT_MS = 20 * 60 * 1_000;

const VIDEO_CHANNELS = new Set(['gifs', 'videos']);

export interface ComfyJobOptions extends ComfyRequestOptions {
  clientId: string;
  assetStore: AssetStore;
  base: URL;
  prompt: ComfyPromptGraph;
  request: GenerationRequest;
  onStateChange?: (job: GenerationJob) => void;
  /** Injected for tests; defaults to wall-clock polling. */
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ComfyJobResult {
  job: GenerationJob;
  /** Decodable object URL for the ingested output, when one was produced. */
  objectUrl: string | null;
  mimeType: string | null;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The generation was cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The ComfyUI request failed.';
}

function mimeForOutput(file: ComfyOutputFile, blobType: string): string {
  if (blobType) return blobType;
  const extension = file.filename.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    webm: 'video/webm',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
  };
  return known[extension] ?? 'application/octet-stream';
}

/**
 * Choose which output file becomes the node's frame source. A workflow can
 * emit several files; the one matching the requested output kind wins so a
 * video workflow is not represented by its first preview still.
 */
export function selectComfyOutput(
  outputs: readonly ComfyOutputFile[],
  outputKind: GenerationRequest['outputKind'],
): ComfyOutputFile | null {
  if (outputs.length === 0) return null;
  const wantsVideo = outputKind !== 'image';
  const matching = outputs.filter((file) =>
    wantsVideo ? VIDEO_CHANNELS.has(file.channel) : file.channel === 'images',
  );
  return matching[matching.length - 1] ?? outputs[outputs.length - 1] ?? null;
}

/**
 * Run one ComfyUI generation to completion.
 *
 * Resolves with a terminal job (`ready`, `failed`, `cancelled`, or `unknown`)
 * rather than throwing, so callers always receive a job record they can show.
 */
export async function runComfyJob(options: ComfyJobOptions): Promise<ComfyJobResult> {
  const {
    base,
    prompt,
    request,
    assetStore,
    clientId,
    signal,
    onStateChange,
    pollIntervalMs = COMFY_POLL_INTERVAL_MS,
    timeoutMs = COMFY_JOB_TIMEOUT_MS,
    now = Date.now,
    sleep = defaultSleep,
  } = options;

  const transport: ComfyRequestOptions = {
    signal,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  };

  let job: GenerationJob = {
    request,
    state: 'submitting',
    resultRef: null,
    error: null,
    submittedAt: now(),
    resolvedAt: null,
    providerJobId: null,
  };

  const advance = (
    state: GenerationJobState,
    patch: Partial<GenerationJob> = {},
  ): GenerationJob => {
    job = { ...job, state, ...patch };
    onStateChange?.(job);
    return job;
  };

  advance('submitting');

  // Submission is the only step that can create remote work, so an uncertain
  // outcome is reconciled by request id instead of retried.
  let promptId: string;
  try {
    const submitted = await submitComfyPrompt(base, prompt, {
      ...transport,
      clientId,
      requestId: request.id,
    });
    promptId = submitted.promptId;
  } catch (error) {
    if (isAbort(error)) {
      return finish(advance('cancelled', { resolvedAt: now() }));
    }
    const recovered = await findComfyPromptByRequestId(base, request.id, transport).catch(
      () => null,
    );
    if (!recovered) {
      return finish(
        advance('failed', { error: messageFrom(error), resolvedAt: now() }),
      );
    }
    promptId = recovered;
  }

  advance('queued', { providerJobId: promptId });

  const deadline = now() + timeoutMs;
  let outputs: readonly ComfyOutputFile[];
  for (;;) {
    if (signal?.aborted) {
      return finish(await cancelAndFinish());
    }
    if (now() > deadline) {
      await cancelComfyPrompt(base, promptId, transport).catch(() => undefined);
      return finish(
        advance('failed', {
          error: 'The ComfyUI job exceeded its time budget.',
          resolvedAt: now(),
        }),
      );
    }
    let history;
    try {
      history = await fetchComfyHistory(base, promptId, transport);
    } catch (error) {
      if (isAbort(error)) {
        return finish(await cancelAndFinish());
      }
      // A transient read failure is not a failed generation; the job keeps
      // running on the server, so report uncertainty and keep polling.
      advance('unknown', { error: messageFrom(error) });
      history = null;
    }
    if (history?.completed) {
      outputs = history.outputs;
      break;
    }
    if (history?.status === 'error') {
      return finish(
        advance('failed', {
          error: history.error ?? 'The ComfyUI workflow failed.',
          resolvedAt: now(),
        }),
      );
    }
    if (history && job.state !== 'running') {
      advance('running', { error: null });
    }
    try {
      await sleep(pollIntervalMs, signal);
    } catch {
      return finish(await cancelAndFinish());
    }
  }

  const file = selectComfyOutput(outputs, request.outputKind);
  if (!file) {
    return finish(
      advance('failed', {
        error: 'The workflow finished without producing an output file.',
        resolvedAt: now(),
      }),
    );
  }

  advance('fetching');
  let blob: Blob;
  try {
    blob = await fetchComfyOutput(base, file, transport);
  } catch (error) {
    if (isAbort(error)) {
      return finish(advance('cancelled', { resolvedAt: now() }));
    }
    return finish(
      advance('failed', { error: messageFrom(error), resolvedAt: now() }),
    );
  }

  if (blob.size > MAX_GENERATION_OUTPUT_BYTES) {
    return finish(
      advance('failed', {
        error: 'The generated output exceeds the 20 MB result limit.',
        resolvedAt: now(),
      }),
    );
  }

  const mimeType = mimeForOutput(file, blob.type);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let ingest: AssetIngestResult;
  try {
    ingest = await assetStore.ingest({
      kind: mimeType.startsWith('video/') ? 'video' : 'image',
      bytes,
      mimeType,
      originalFilename: file.filename,
      provenance: `comfyui:${request.model}`,
    });
  } catch (error) {
    return finish(
      advance('failed', { error: messageFrom(error), resolvedAt: now() }),
    );
  }
  if (!ingest.ok) {
    return finish(
      advance('failed', { error: ingest.error, resolvedAt: now() }),
    );
  }

  const ready = advance('ready', {
    resultRef: ingest.ref,
    error: null,
    resolvedAt: now(),
  });
  return {
    job: ready,
    objectUrl: URL.createObjectURL(new Blob([bytes], { type: mimeType })),
    mimeType,
  };

  function finish(terminal: GenerationJob): ComfyJobResult {
    return { job: terminal, objectUrl: null, mimeType: null };
  }

  async function cancelAndFinish(): Promise<GenerationJob> {
    advance('cancel-requested');
    const outcome = await cancelComfyPrompt(base, promptId, {
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
    }).catch(() => 'not-found' as const);
    return advance('cancelled', {
      resolvedAt: now(),
      error:
        outcome === 'not-found'
          ? 'Cancelled locally; the server had no matching job.'
          : null,
    });
  }
}
