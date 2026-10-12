import { describe, expect, it, vi } from 'vitest';

import {
  COMFY_REQUEST_MARKER,
  assertComfyTransportSecurity,
  cancelComfyPrompt,
  discoverComfyCapabilities,
  fetchComfyHistory,
  fetchComfyOutput,
  findComfyPromptByRequestId,
  parseComfyEndpoint,
  readBoundedBody,
  submitComfyPrompt,
} from './comfyClient';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Route a fake ComfyUI server from pathname suffixes. */
function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

function bodyText(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function fakeServer(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((route) => url.includes(route));
    if (key === undefined) {
      return Promise.resolve(new Response('missing', { status: 404 }));
    }
    const value = routes[key];
    return Promise.resolve(
      value instanceof Response ? value.clone() : jsonResponse(value),
    );
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const BASE = new URL('https://host.example/comfy/');

describe('parseComfyEndpoint', () => {
  it('normalizes a path-prefixed proxy address with a trailing slash', () => {
    expect(parseComfyEndpoint(' https://host.example/comfy ').href).toBe(
      'https://host.example/comfy/',
    );
  });

  it('rejects unusable or unsafe addresses', () => {
    expect(() => parseComfyEndpoint('')).toThrow(/Enter the ComfyUI server/);
    expect(() => parseComfyEndpoint('host.example')).toThrow(/complete ComfyUI URL/);
    expect(() => parseComfyEndpoint('ws://host.example')).toThrow(/http:\/\/ or https:\/\//);
    expect(() => parseComfyEndpoint('https://user:pw@host.example/')).toThrow(
      /session key field/,
    );
    expect(() => parseComfyEndpoint('https://host.example/#frag')).toThrow(/fragment/);
  });
});

describe('assertComfyTransportSecurity', () => {
  it('allows https and loopback http without a key', () => {
    expect(() => assertComfyTransportSecurity(BASE)).not.toThrow();
    expect(() =>
      assertComfyTransportSecurity(new URL('http://127.0.0.1:8188/')),
    ).not.toThrow();
  });

  it('refuses cleartext remote hosts and keys over cleartext', () => {
    expect(() =>
      assertComfyTransportSecurity(new URL('http://10.0.0.5:8188/')),
    ).toThrow(/limited to loopback/);
    expect(() =>
      assertComfyTransportSecurity(new URL('http://127.0.0.1:8188/'), 'secret'),
    ).toThrow(/requires an https/);
  });
});

describe('readBoundedBody', () => {
  it('rejects a body larger than the ceiling', async () => {
    const response = new Response(new Uint8Array(32));
    await expect(readBoundedBody(response, 8)).rejects.toThrow(/exceeds/);
  });

  it('rejects an oversized declared length before reading', async () => {
    const response = new Response('x', {
      headers: { 'content-length': '999999999' },
    });
    await expect(readBoundedBody(response, 1024)).rejects.toThrow(/exceeds/);
  });
});

describe('discoverComfyCapabilities', () => {
  it('reports version, nodes, and models for the requested folders', async () => {
    const { fetchImpl } = fakeServer({
      system_stats: {
        system: { comfyui_version: '0.39.1', python_version: '3.11.17' },
        devices: [{ name: 'cuda:0', type: 'cuda', vram_total: 10, vram_free: 5 }],
      },
      object_info: { KSampler: {}, SaveImage: {} },
      features: { max_upload_size: 104857600 },
      prompt: { exec_info: { queue_remaining: 2 } },
      'models/checkpoints': ['sd_xl_base_1.0.safetensors'],
    });

    const capabilities = await discoverComfyCapabilities(BASE, ['checkpoints'], {
      fetchImpl,
    });

    expect(capabilities.comfyVersion).toBe('0.39.1');
    expect(capabilities.nodeClasses.has('KSampler')).toBe(true);
    expect(capabilities.models.get('checkpoints')).toEqual([
      'sd_xl_base_1.0.safetensors',
    ]);
    expect(capabilities.devices[0]?.name).toBe('cuda:0');
    expect(capabilities.queueRemaining).toBe(2);
  });

  it('sends no ambient credentials and refuses redirects', async () => {
    const { fetchImpl, calls } = fakeServer({
      system_stats: { system: {} },
      object_info: {},
      features: {},
      prompt: {},
    });
    await discoverComfyCapabilities(BASE, [], { fetchImpl });
    expect(calls[0]?.init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });
});

describe('submitComfyPrompt', () => {
  it('returns the prompt id and tags the submission with a request marker', async () => {
    const { fetchImpl, calls } = fakeServer({
      prompt: { prompt_id: 'p-1', number: 3 },
    });
    const result = await submitComfyPrompt(
      BASE,
      { '1': { class_type: 'SaveImage', inputs: {} } },
      { fetchImpl, clientId: 'node-1', requestId: 'req-1' },
    );
    expect(result).toEqual({ promptId: 'p-1', queuePosition: 3 });
    const body = JSON.parse(bodyText(calls[0]?.init)) as Record<string, unknown>;
    expect(body.client_id).toBe('node-1');
    expect((body.extra_data as Record<string, unknown>)[COMFY_REQUEST_MARKER]).toBe(
      'req-1',
    );
    expect(body.extra_data).not.toHaveProperty('api_key_comfy_org');
  });

  it('attaches a cloud key only when one is supplied', async () => {
    const { fetchImpl, calls } = fakeServer({ prompt: { prompt_id: 'p-2' } });
    await submitComfyPrompt(BASE, {}, {
      fetchImpl,
      clientId: 'node-1',
      requestId: 'req-2',
      apiKey: 'cloud-key',
    });
    const body = JSON.parse(bodyText(calls[0]?.init)) as Record<string, unknown>;
    expect(body.extra_data).toMatchObject({ api_key_comfy_org: 'cloud-key' });
  });

  it('explains a validation rejection with node detail', async () => {
    const { fetchImpl } = fakeServer({
      prompt: {
        error: { message: 'Prompt outputs failed validation' },
        node_errors: {
          '1': { errors: [{ message: 'value not in list: ckpt_name' }] },
        },
      },
    });
    await expect(
      submitComfyPrompt(BASE, {}, { fetchImpl, clientId: 'n', requestId: 'r' }),
    ).rejects.toThrow(/node 1: value not in list/);
  });
});

describe('fetchComfyHistory', () => {
  it('returns null while the prompt has no history entry yet', async () => {
    const { fetchImpl } = fakeServer({ history: {} });
    expect(await fetchComfyHistory(BASE, 'p-1', { fetchImpl })).toBeNull();
  });

  it('collects image and video outputs from every node', async () => {
    const { fetchImpl } = fakeServer({
      history: {
        'p-1': {
          status: { completed: true, status_str: 'success' },
          outputs: {
            '7': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
            '11': { gifs: [{ filename: 'b.webm', subfolder: 'v', type: 'output' }] },
          },
        },
      },
    });
    const history = await fetchComfyHistory(BASE, 'p-1', { fetchImpl });
    expect(history?.completed).toBe(true);
    expect(history?.outputs).toHaveLength(2);
    expect(history?.outputs[1]).toMatchObject({ filename: 'b.webm', channel: 'gifs' });
  });

  it('surfaces the execution error message', async () => {
    const { fetchImpl } = fakeServer({
      history: {
        'p-1': {
          status: {
            status_str: 'error',
            messages: [
              [
                'execution_error',
                { node_type: 'KSampler', exception_message: 'out of memory' },
              ],
            ],
          },
        },
      },
    });
    const history = await fetchComfyHistory(BASE, 'p-1', { fetchImpl });
    expect(history?.error).toBe('KSampler: out of memory');
  });
});

describe('fetchComfyOutput', () => {
  it('downloads one bounded output file', async () => {
    const { fetchImpl, calls } = fakeServer({
      view: new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      }),
    });
    const blob = await fetchComfyOutput(
      BASE,
      { filename: 'a.png', subfolder: '', type: 'output', channel: 'images' },
      { fetchImpl },
    );
    expect(blob.size).toBe(3);
    expect(calls[0]?.url).toContain('filename=a.png');
  });
});

describe('cancelComfyPrompt', () => {
  it('deletes a queued prompt by id instead of interrupting the server', async () => {
    const { fetchImpl, calls } = fakeServer({
      queue: { queue_pending: [[0, 'p-1']], queue_running: [] },
    });
    expect(await cancelComfyPrompt(BASE, 'p-1', { fetchImpl })).toBe('dequeued');
    expect(calls.some(({ url }) => url.includes('interrupt'))).toBe(false);
  });

  it('interrupts only when our prompt is the running one', async () => {
    const { fetchImpl, calls } = fakeServer({
      queue: { queue_pending: [], queue_running: [[0, 'p-1']] },
      interrupt: {},
    });
    expect(await cancelComfyPrompt(BASE, 'p-1', { fetchImpl })).toBe('interrupted');
    expect(calls.some(({ url }) => url.includes('interrupt'))).toBe(true);
  });

  it('never interrupts when another client owns the running prompt', async () => {
    const { fetchImpl, calls } = fakeServer({
      queue: { queue_pending: [], queue_running: [[0, 'someone-else']] },
    });
    expect(await cancelComfyPrompt(BASE, 'p-1', { fetchImpl })).toBe('not-found');
    expect(calls.some(({ url }) => url.includes('interrupt'))).toBe(false);
  });
});

describe('findComfyPromptByRequestId', () => {
  it('recovers a prompt id from the queue after a lost response', async () => {
    const { fetchImpl } = fakeServer({
      queue: {
        queue_pending: [[0, 'p-9', {}, { [COMFY_REQUEST_MARKER]: 'req-9' }]],
        queue_running: [],
      },
    });
    expect(await findComfyPromptByRequestId(BASE, 'req-9', { fetchImpl })).toBe('p-9');
  });

  it('returns null when the server never saw the request', async () => {
    const { fetchImpl } = fakeServer({
      queue: { queue_pending: [], queue_running: [] },
      history: {},
    });
    expect(await findComfyPromptByRequestId(BASE, 'req-9', { fetchImpl })).toBeNull();
  });
});
