import { describe, expect, it, vi } from 'vitest';

import { createAssetStore, createMemoryBackend } from '../store/assetStore';
import type { GenerationJobState, GenerationRequest } from '../store/contracts';
import { COMFY_REQUEST_MARKER } from './comfyClient';
import { runComfyJob, selectComfyOutput } from './comfyJob';

const BASE = new URL('https://host.example/comfy/');

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    id: 'req-1',
    prompt: 'a lantern in fog',
    model: 'sd_xl_base_1.0.safetensors',
    adapter: 'comfyui',
    settings: {},
    outputKind: 'image',
    ...overrides,
  };
}

/**
 * Fake ComfyUI that answers each route from a scripted queue, so the poll loop
 * can be walked deterministically.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

function server(script: {
  prompt?: unknown[];
  history?: unknown[];
  queue?: unknown[];
  view?: Response[];
  interrupt?: unknown[];
}) {
  const calls: string[] = [];
  const pick = (list: unknown[] | undefined): unknown =>
    list && list.length > 1 ? list.shift() : list?.[0];
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    calls.push(url);
    if (url.includes('/view')) {
      const next =
        script.view && script.view.length > 1 ? script.view.shift() : script.view?.[0];
      return Promise.resolve((next ?? new Response(new Uint8Array([1, 2, 3]))).clone());
    }
    const key = url.includes('/history')
      ? 'history'
      : url.includes('/queue')
        ? 'queue'
        : url.includes('/interrupt')
          ? 'interrupt'
          : 'prompt';
    const body = pick(script[key as keyof typeof script]);
    return Promise.resolve(
      new Response(JSON.stringify(body ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function completedHistory(filename = 'a.png', channel = 'images') {
  return {
    'p-1': {
      status: { completed: true, status_str: 'success' },
      outputs: { '7': { [channel]: [{ filename, subfolder: '', type: 'output' }] } },
    },
  };
}

const noSleep = () => Promise.resolve();

describe('selectComfyOutput', () => {
  const image = { filename: 'a.png', subfolder: '', type: 'output', channel: 'images' };
  const clip = { filename: 'b.webm', subfolder: '', type: 'output', channel: 'gifs' };

  it('prefers the file matching the requested output kind', () => {
    expect(selectComfyOutput([image, clip], 'video')).toBe(clip);
    expect(selectComfyOutput([image, clip], 'image')).toBe(image);
  });

  it('falls back to the last file when no channel matches', () => {
    expect(selectComfyOutput([image], 'video')).toBe(image);
    expect(selectComfyOutput([], 'image')).toBeNull();
  });
});

describe('runComfyJob', () => {
  it('runs submit, poll, download, and ingest to a ready job', async () => {
    const assetStore = createAssetStore(createMemoryBackend());
    const states: GenerationJobState[] = [];
    const { fetchImpl } = server({
      prompt: [{ prompt_id: 'p-1', number: 1 }],
      history: [{}, completedHistory()],
      view: [new Response(new Uint8Array([9, 9, 9]), { headers: { 'Content-Type': 'image/png' } })],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore,
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
      onStateChange: (job) => states.push(job.state),
    });

    expect(result.job.state).toBe('ready');
    expect(result.job.providerJobId).toBe('p-1');
    expect(result.job.resultRef).not.toBeNull();
    expect(states).toContain('queued');
    expect(states).toContain('fetching');

    const stored = result.job.resultRef
      ? await assetStore.getManifest(result.job.resultRef.id)
      : undefined;
    expect(stored?.mimeType).toBe('image/png');
    expect(stored?.provenance).toContain('comfyui:');
  });

  it('ingests a clip output as a video asset', async () => {
    const assetStore = createAssetStore(createMemoryBackend());
    const { fetchImpl } = server({
      prompt: [{ prompt_id: 'p-1' }],
      history: [completedHistory('clip.webm', 'gifs')],
      view: [new Response(new Uint8Array([4, 5]), { headers: { 'Content-Type': 'video/webm' } })],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request({ outputKind: 'video' }),
      assetStore,
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.job.state).toBe('ready');
    expect(result.mimeType).toBe('video/webm');
    const stored = result.job.resultRef
      ? await assetStore.getManifest(result.job.resultRef.id)
      : undefined;
    expect(stored?.ref.kind).toBe('video');
  });

  it('fails with the server execution error instead of hanging', async () => {
    const { fetchImpl } = server({
      prompt: [{ prompt_id: 'p-1' }],
      history: [
        {
          'p-1': {
            status: {
              status_str: 'error',
              messages: [
                ['execution_error', { node_type: 'KSampler', exception_message: 'oom' }],
              ],
            },
          },
        },
      ],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.job.state).toBe('failed');
    expect(result.job.error).toBe('KSampler: oom');
  });

  it('reconciles an uncertain submission instead of resubmitting it', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes('/prompt')) {
        throw new Error('network dropped');
      }
      if (url.includes('/queue')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              queue_running: [[0, 'p-7', {}, { [COMFY_REQUEST_MARKER]: 'req-1' }]],
              queue_pending: [],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('/history')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              'p-7': {
                status: { completed: true, status_str: 'success' },
                outputs: {
                  '7': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
                },
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    }) as unknown as typeof fetch;

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.job.providerJobId).toBe('p-7');
    expect(result.job.state).toBe('ready');
    expect(calls.filter((url) => url.endsWith('/prompt')).length).toBe(1);
  });

  it('fails without a prompt id when the server never saw the request', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/prompt')) throw new Error('network dropped');
      return Promise.resolve(
        new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.job.state).toBe('failed');
    expect(result.job.error).toBe('network dropped');
  });

  it('cancels a queued job through the queue, not a global interrupt', async () => {
    const controller = new AbortController();
    const states: GenerationJobState[] = [];
    const { fetchImpl, calls } = server({
      prompt: [{ prompt_id: 'p-1' }],
      history: [{}],
      queue: [{ queue_pending: [[0, 'p-1']], queue_running: [] }],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      signal: controller.signal,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
      onStateChange: (job) => states.push(job.state),
    });

    expect(result.job.state).toBe('cancelled');
    expect(states).toContain('cancel-requested');
    expect(calls.some((url) => url.includes('/interrupt'))).toBe(false);
  });

  it('stops at its time budget rather than polling forever', async () => {
    let clock = 0;
    const { fetchImpl } = server({
      prompt: [{ prompt_id: 'p-1' }],
      history: [{}],
      queue: [{ queue_pending: [], queue_running: [] }],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      timeoutMs: 10,
      now: () => (clock += 20),
      sleep: noSleep,
    });

    expect(result.job.state).toBe('failed');
    expect(result.job.error).toMatch(/time budget/);
  });

  it('rejects an output larger than the result ceiling', async () => {
    const { fetchImpl } = server({
      prompt: [{ prompt_id: 'p-1' }],
      history: [completedHistory()],
      view: [
        new Response(new Uint8Array(32), {
          headers: { 'Content-Type': 'image/png', 'content-length': '999999999' },
        }),
      ],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.job.state).toBe('failed');
    expect(result.job.error).toMatch(/exceeds/);
  });

  it('fails when a completed workflow produced no output file', async () => {
    const { fetchImpl } = server({
      prompt: [{ prompt_id: 'p-1' }],
      history: [{ 'p-1': { status: { completed: true, status_str: 'success' }, outputs: {} } }],
    });

    const result = await runComfyJob({
      base: BASE,
      prompt: {},
      request: request(),
      assetStore: createAssetStore(createMemoryBackend()),
      clientId: 'node-1',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.job.state).toBe('failed');
    expect(result.job.error).toMatch(/without producing an output/);
  });
});
