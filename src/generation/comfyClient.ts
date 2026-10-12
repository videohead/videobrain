/**
 * G4 — ComfyUI transport and capability discovery.
 *
 * Talks to a user-run ComfyUI server (local, LAN, or reverse-proxied) over its
 * documented HTTP routes. Nothing here executes an arbitrary imported workflow:
 * callers submit API-format prompts built from the allowlisted templates in
 * comfyWorkflows.ts, and this module only moves bytes.
 *
 * Every request omits ambient credentials, sends no referrer, refuses redirects
 * so prompt text cannot be forwarded to another origin, and is both time- and
 * size-bounded. Keys stay in memory for the session and are never serialized.
 */

/** Maximum bytes accepted for a discovery or history JSON response. */
export const MAX_COMFY_JSON_BYTES = 8 * 1024 * 1024;

/** Maximum bytes accepted for one downloaded generation output. */
export const MAX_COMFY_OUTPUT_BYTES = 20 * 1024 * 1024;

/** Discovery and submission request timeout. */
export const COMFY_REQUEST_TIMEOUT_MS = 30_000;

/** Output download timeout. */
export const COMFY_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface ComfyDevice {
  name: string;
  type: string;
  vramTotal: number;
  vramFree: number;
}

/**
 * What one reachable ComfyUI server can actually do right now.
 * Workflow templates are validated against this before anything is submitted.
 */
export interface ComfyCapabilities {
  baseUrl: string;
  comfyVersion: string;
  pythonVersion: string;
  devices: readonly ComfyDevice[];
  /** Installed node class names, e.g. `KSampler`. */
  nodeClasses: ReadonlySet<string>;
  /** Model folder name to installed filenames, e.g. `checkpoints` -> [...]. */
  models: ReadonlyMap<string, readonly string[]>;
  maxUploadBytes: number;
  queueRemaining: number;
  discoveredAt: number;
}

export interface ComfyRequestOptions {
  signal?: AbortSignal;
  /** Session-only Comfy Cloud key, forwarded only to API-node workflows. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Normalize a user-entered ComfyUI address into a base URL with a trailing
 * slash, so route joining stays predictable behind path-prefixed proxies.
 */
export function parseComfyEndpoint(endpoint: string): URL {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error('Enter the ComfyUI server address.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a complete ComfyUI URL, including http:// or https://.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('A ComfyUI endpoint must start with http:// or https://.');
  }
  if (url.username || url.password) {
    throw new Error('Put credentials in the session key field, not the URL.');
  }
  if (url.search || url.hash) {
    throw new Error('A ComfyUI endpoint cannot include a query string or fragment.');
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

/**
 * Reject plain-HTTP servers that a secure page cannot reach anyway, and keep
 * session keys off cleartext transports.
 */
export function assertComfyTransportSecurity(base: URL, apiKey = ''): void {
  if (base.protocol === 'https:') {
    return;
  }
  const isLoopback =
    base.hostname === 'localhost' ||
    base.hostname === '127.0.0.1' ||
    base.hostname === '[::1]';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    throw new Error('This secure page requires an https:// ComfyUI endpoint.');
  }
  if (!isLoopback) {
    throw new Error('Plain HTTP ComfyUI endpoints are limited to loopback.');
  }
  if (apiKey) {
    throw new Error('A Comfy Cloud key requires an https:// ComfyUI endpoint.');
  }
}

export function comfyRoute(base: URL, route: string): URL {
  return new URL(route.replace(/^\/+/, ''), base);
}

function linkTimeout(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The ComfyUI request timed out.', 'TimeoutError'));
  }, timeoutMs);
  const forward = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      forward();
    } else {
      signal.addEventListener('abort', forward, { once: true });
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

/**
 * Read a response body while enforcing a hard size ceiling, using the declared
 * length when present and streaming otherwise so an unbounded body cannot be
 * buffered into memory.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Blob> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`The ComfyUI response exceeds the ${formatMb(maxBytes)} limit.`);
  }
  const body = response.body;
  if (!body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) {
      throw new Error(`The ComfyUI response exceeds the ${formatMb(maxBytes)} limit.`);
    }
    return blob;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`The ComfyUI response exceeds the ${formatMb(maxBytes)} limit.`);
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], {
    type: response.headers.get('content-type') ?? '',
  });
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

async function comfyFetch(
  base: URL,
  route: string,
  init: RequestInit,
  options: ComfyRequestOptions,
  timeoutMs: number,
): Promise<Response> {
  const run = options.fetchImpl ?? fetch;
  const { signal, dispose } = linkTimeout(timeoutMs, options.signal);
  try {
    const response = await run(comfyRoute(base, route), {
      ...init,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      mode: 'cors',
    });
    if (!response.ok) {
      throw new Error(
        `ComfyUI answered HTTP ${response.status} for ${route}.`,
      );
    }
    return response;
  } finally {
    dispose();
  }
}

async function comfyJson<T>(
  base: URL,
  route: string,
  options: ComfyRequestOptions,
  init: RequestInit = { method: 'GET' },
): Promise<T> {
  const response = await comfyFetch(
    base,
    route,
    init,
    options,
    options.timeoutMs ?? COMFY_REQUEST_TIMEOUT_MS,
  );
  const blob = await readBoundedBody(response, MAX_COMFY_JSON_BYTES);
  const text = await blob.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`ComfyUI returned an unreadable response for ${route}.`);
  }
}

function readDevices(value: unknown): ComfyDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    return [
      {
        name: typeof record.name === 'string' ? record.name : 'unknown',
        type: typeof record.type === 'string' ? record.type : 'unknown',
        vramTotal: Number(record.vram_total) || 0,
        vramFree: Number(record.vram_free) || 0,
      },
    ];
  });
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Ask a ComfyUI server what it is and what it has installed. Model folders are
 * fetched only for the folders a caller cares about, because a full sweep of
 * every folder is slow on large installs.
 */
export async function discoverComfyCapabilities(
  base: URL,
  modelFolders: readonly string[],
  options: ComfyRequestOptions = {},
): Promise<ComfyCapabilities> {
  const stats = await comfyJson<Record<string, unknown>>(base, 'system_stats', options);
  const system = (stats.system ?? {}) as Record<string, unknown>;

  const objectInfo = await comfyJson<Record<string, unknown>>(base, 'object_info', options);
  const nodeClasses = new Set(Object.keys(objectInfo));

  const empty = (): Record<string, unknown> => ({});
  const features = await comfyJson<Record<string, unknown>>(
    base,
    'features',
    options,
  ).catch(empty);
  const queue = await comfyJson<Record<string, unknown>>(
    base,
    'prompt',
    options,
  ).catch(empty);

  const models = new Map<string, readonly string[]>();
  for (const folder of modelFolders) {
    const files = await comfyJson<unknown>(
      base,
      `models/${encodeURIComponent(folder)}`,
      options,
    ).catch(() => []);
    models.set(folder, readStringArray(files));
  }

  const execInfo = (queue.exec_info ?? {}) as Record<string, unknown>;
  return {
    baseUrl: base.href,
    comfyVersion:
      typeof system.comfyui_version === 'string' ? system.comfyui_version : 'unknown',
    pythonVersion:
      typeof system.python_version === 'string' ? system.python_version : 'unknown',
    devices: readDevices(stats.devices),
    nodeClasses,
    models,
    maxUploadBytes: Number(features.max_upload_size) || 0,
    queueRemaining: Number(execInfo.queue_remaining) || 0,
    discoveredAt: Date.now(),
  };
}

export interface ComfySubmitResult {
  promptId: string;
  queuePosition: number | null;
}

/** Marker stored in extra_data so an uncertain submission can be reconciled. */
export const COMFY_REQUEST_MARKER = 'videobrain_request_id';

export interface ComfySubmitOptions extends ComfyRequestOptions {
  clientId: string;
  /** Local request identity, echoed back through ComfyUI history. */
  requestId: string;
}

/**
 * Queue one API-format prompt. `clientId` scopes the submission so later
 * cancellation can prove the running job is ours before touching a server-wide
 * endpoint, and `requestId` travels in extra_data so a submission whose
 * response was lost can be reconciled instead of blindly resubmitted.
 * A Comfy Cloud key is attached only when the caller supplies one.
 */
export async function submitComfyPrompt(
  base: URL,
  prompt: Readonly<Record<string, unknown>>,
  options: ComfySubmitOptions,
): Promise<ComfySubmitResult> {
  const extraData: Record<string, unknown> = {
    [COMFY_REQUEST_MARKER]: options.requestId,
  };
  if (options.apiKey) {
    extraData.api_key_comfy_org = options.apiKey;
  }
  const body: Record<string, unknown> = {
    prompt,
    client_id: options.clientId,
    extra_data: extraData,
  };
  const result = await comfyJson<Record<string, unknown>>(base, 'prompt', options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (result.error) {
    throw new Error(describePromptError(result));
  }
  const promptId = result.prompt_id;
  if (typeof promptId !== 'string' || !promptId) {
    throw new Error('ComfyUI accepted the prompt without returning a prompt id.');
  }
  return {
    promptId,
    queuePosition: typeof result.number === 'number' ? result.number : null,
  };
}

function describePromptError(result: Record<string, unknown>): string {
  const error = result.error as Record<string, unknown> | undefined;
  const headline =
    error && typeof error.message === 'string'
      ? error.message
      : 'ComfyUI rejected the workflow.';
  const nodeErrors = result.node_errors as Record<string, unknown> | undefined;
  if (!nodeErrors || typeof nodeErrors !== 'object') {
    return headline;
  }
  const details = Object.entries(nodeErrors)
    .slice(0, 3)
    .map(([nodeId, detail]) => {
      const record = detail as Record<string, unknown>;
      const errors = Array.isArray(record?.errors) ? record.errors : [];
      const first = errors[0] as Record<string, unknown> | undefined;
      const message =
        first && typeof first.message === 'string' ? first.message : 'invalid input';
      return `node ${nodeId}: ${message}`;
    });
  return details.length ? `${headline} (${details.join('; ')})` : headline;
}

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string;
  /** `images`, `gifs`, `videos`, … — the history key the file came from. */
  channel: string;
}

export interface ComfyHistoryStatus {
  completed: boolean;
  /** `success`, `error`, or null while still running. */
  status: string | null;
  error: string | null;
  outputs: readonly ComfyOutputFile[];
}

const OUTPUT_CHANNELS = ['images', 'gifs', 'videos', 'audio'] as const;

/**
 * Read one prompt's history entry. A missing entry is not an error: ComfyUI
 * only records history once execution finishes, so an absent entry means the
 * job is still queued or running.
 */
export async function fetchComfyHistory(
  base: URL,
  promptId: string,
  options: ComfyRequestOptions = {},
): Promise<ComfyHistoryStatus | null> {
  const history = await comfyJson<Record<string, unknown>>(
    base,
    `history/${encodeURIComponent(promptId)}`,
    options,
  );
  const entry = history[promptId] as Record<string, unknown> | undefined;
  if (!entry) {
    return null;
  }
  const status = (entry.status ?? {}) as Record<string, unknown>;
  const statusString =
    typeof status.status_str === 'string' ? status.status_str : null;
  const outputs: ComfyOutputFile[] = [];
  const outputRecord = (entry.outputs ?? {}) as Record<string, unknown>;
  for (const nodeOutput of Object.values(outputRecord)) {
    if (!nodeOutput || typeof nodeOutput !== 'object') continue;
    const record = nodeOutput as Record<string, unknown>;
    for (const channel of OUTPUT_CHANNELS) {
      const files = record[channel];
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        if (!file || typeof file !== 'object') continue;
        const detail = file as Record<string, unknown>;
        if (typeof detail.filename !== 'string') continue;
        outputs.push({
          filename: detail.filename,
          subfolder: typeof detail.subfolder === 'string' ? detail.subfolder : '',
          type: typeof detail.type === 'string' ? detail.type : 'output',
          channel,
        });
      }
    }
  }
  return {
    completed: status.completed === true || statusString === 'success',
    status: statusString,
    error: statusString === 'error' ? readHistoryError(status) : null,
    outputs,
  };
}

function readHistoryError(status: Record<string, unknown>): string {
  const messages = status.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!Array.isArray(message) || message[0] !== 'execution_error') continue;
      const detail = message[1] as Record<string, unknown> | undefined;
      const text = detail?.exception_message;
      const node = detail?.node_type;
      if (typeof text === 'string') {
        return typeof node === 'string' ? `${node}: ${text}` : text;
      }
    }
  }
  return 'The ComfyUI workflow failed during execution.';
}

function markerOf(entry: unknown): string | null {
  if (!Array.isArray(entry)) return null;
  const extraData: unknown = (entry as unknown[])[3];
  if (!extraData || typeof extraData !== 'object') return null;
  const marker = (extraData as Record<string, unknown>)[COMFY_REQUEST_MARKER];
  return typeof marker === 'string' ? marker : null;
}

/**
 * Recover the prompt id for a submission whose HTTP response never arrived.
 *
 * Checks the live queue first, then recent history. Returning null means the
 * server has no record of the request, so resubmitting cannot duplicate work.
 */
export async function findComfyPromptByRequestId(
  base: URL,
  requestId: string,
  options: ComfyRequestOptions = {},
  historyLimit = 64,
): Promise<string | null> {
  const queue = await comfyJson<Record<string, unknown>>(base, 'queue', options);
  for (const key of ['queue_running', 'queue_pending'] as const) {
    const entries = Array.isArray(queue[key]) ? (queue[key] as unknown[]) : [];
    for (const entry of entries) {
      if (markerOf(entry) === requestId && Array.isArray(entry)) {
        const promptId: unknown = (entry as unknown[])[1];
        if (typeof promptId === 'string') return promptId;
      }
    }
  }
  const history = await comfyJson<Record<string, unknown>>(
    base,
    `history?max_items=${encodeURIComponent(String(historyLimit))}`,
    options,
  );
  for (const [promptId, entry] of Object.entries(history)) {
    if (!entry || typeof entry !== 'object') continue;
    if (markerOf((entry as Record<string, unknown>).prompt) === requestId) {
      return promptId;
    }
  }
  return null;
}

/** Download one generated output, bounded by MAX_COMFY_OUTPUT_BYTES. */
export async function fetchComfyOutput(
  base: URL,
  file: ComfyOutputFile,
  options: ComfyRequestOptions = {},
): Promise<Blob> {
  const route = `view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder)}&type=${encodeURIComponent(file.type)}`;
  const response = await comfyFetch(
    base,
    route,
    { method: 'GET' },
    options,
    options.timeoutMs ?? COMFY_DOWNLOAD_TIMEOUT_MS,
  );
  return readBoundedBody(response, MAX_COMFY_OUTPUT_BYTES);
}

/**
 * Cancel one prompt without disturbing other users of a shared server.
 *
 * A queued prompt is removed by id. Interrupt is server-wide, so it is used
 * only after `/queue` confirms the running prompt is the one we submitted.
 */
export async function cancelComfyPrompt(
  base: URL,
  promptId: string,
  options: ComfyRequestOptions = {},
): Promise<'dequeued' | 'interrupted' | 'not-found'> {
  const queue = await comfyJson<Record<string, unknown>>(base, 'queue', options);
  const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending : [];
  const running = Array.isArray(queue.queue_running) ? queue.queue_running : [];

  const isEntryFor = (entry: unknown): boolean =>
    Array.isArray(entry) && entry[1] === promptId;

  if (pending.some(isEntryFor)) {
    await comfyJson(base, 'queue', options, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    }).catch(() => undefined);
    return 'dequeued';
  }
  if (running.some(isEntryFor)) {
    await comfyFetch(
      base,
      'interrupt',
      { method: 'POST' },
      options,
      options.timeoutMs ?? COMFY_REQUEST_TIMEOUT_MS,
    );
    return 'interrupted';
  }
  return 'not-found';
}
