import { expect, test, type Locator, type Page } from '@playwright/test';
import { createGraphNode, GRAPH_PRESETS, GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphParams, type NodeKind } from '../src/graph';

async function screenPointAtPathMidpoint(pathLocator: Locator) {
  return pathLocator.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) {
      throw new Error('Link does not have a screen transform.');
    }
    const point = path
      .getPointAtLength(path.getTotalLength() / 2)
      .matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
}

async function selectLink(page: Page, link: Locator) {
  const clickPoint = await screenPointAtPathMidpoint(
    link.locator('.react-flow__edge-interaction'),
  );
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(link).toHaveClass(/selected/);
}

async function cameraRequestCount(page: Page) {
  return page.evaluate(() =>
    Number(Reflect.get(window, '__videoBrainCameraRequestCount') ?? 0),
  );
}

async function connectHandles(source: Locator, target: Locator, page: Page) {
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();

  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2,
    sourceBounds!.y + sourceBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBounds!.x + targetBounds!.width / 2,
    targetBounds!.y + targetBounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

async function renderedColorSignal(page: Page) {
  return page.locator('canvas.preview-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl || canvas.width < 1 || canvas.height < 1) {
      return 0;
    }

    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }),
    );

    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let maximumRgb = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      maximumRgb = Math.max(
        maximumRgb,
        pixels[index] ?? 0,
        pixels[index + 1] ?? 0,
        pixels[index + 2] ?? 0,
      );
    }
    return maximumRgb;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices?.getUserMedia.bind(mediaDevices);
    Reflect.set(window, '__videoBrainCameraRequestCount', 0);
    if (!mediaDevices || !originalGetUserMedia) {
      return;
    }
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: (constraints: MediaStreamConstraints) => {
        if (constraints.video) {
          const current = Number(
            Reflect.get(window, '__videoBrainCameraRequestCount') ?? 0,
          );
          Reflect.set(window, '__videoBrainCameraRequestCount', current + 1);
        }
        return originalGetUserMedia(constraints);
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Graph healthy')).toBeVisible();
});

async function sourceFrameStats(page: Page) {
  return page.locator('canvas.preview-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 0;
    let minimum = 255;
    let maximum = 0;
    let visible = 0;
    let maxAlpha = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      hash = Math.imul(hash, 31) + (pixels[index] ?? 0) + (pixels[index + 1] ?? 0) * 3 + (pixels[index + 2] ?? 0) * 7 + (pixels[index + 3] ?? 0) * 11 | 0;
      minimum = Math.min(minimum, pixels[index] ?? 0);
      maximum = Math.max(maximum, pixels[index] ?? 0);
      maxAlpha = Math.max(maxAlpha, pixels[index + 3] ?? 0);
      if ((pixels[index + 3] ?? 0) > 0) visible++;
    }
    return { hash, minimum, maximum, visible, maxAlpha, pixelCount: canvas.width * canvas.height };
  });
}

async function installEffectGraph(page: Page, kind: NodeKind, params: GraphParams = {}, sourceKind: NodeKind = 'solid', connectMap = false) {
  const document: GraphDocument = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode(sourceKind, { x: 0, y: 0 }, sourceKind === 'solid' ? { red: 0.25, green: 0.5, blue: 0.75, alpha: 0.5 } : {}, 'effect-source'),
      createGraphNode(kind, { x: 340, y: 0 }, params, 'effect'),
      createGraphNode('display', { x: 680, y: 0 }, {}, 'effect-output'),
    ],
    edges: [
      { id: 'source', source: { nodeId: 'effect-source', portId: 'frame' }, target: { nodeId: 'effect', portId: kind === 'sourceSelector' ? 'a' : 'source' } },
      { id: 'output', source: { nodeId: 'effect', portId: 'frame' }, target: { nodeId: 'effect-output', portId: 'source' } },
    ],
  };
  if (connectMap) document.edges.push({ id: 'map', source: { nodeId: 'effect-source', portId: 'frame' }, target: { nodeId: 'effect', portId: 'map' } });
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}

async function centerPixel(page: Page) {
  return page.locator('canvas.preview-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  });
}

const effectPixelCases: { kind: NodeKind; params?: GraphParams; expected: number[] }[] = [
  { kind: 'levels', expected: [64, 128, 191, 128] },
  { kind: 'levels', params: { gamma: 2 }, expected: [128, 181, 221, 128] },
  { kind: 'levels', params: { black: 0.5, white: 0.5 }, expected: [0, 255, 255, 128] },
  { kind: 'hsv', expected: [64, 128, 191, 128] },
  { kind: 'hsv', params: { saturation: 0 }, expected: [191, 191, 191, 128] },
  { kind: 'hsv', params: { mode: 'hsl' }, expected: [64, 128, 191, 128] },
  { kind: 'hsv', params: { mode: 'hsl', saturation: 0 }, expected: [128, 128, 128, 128] },
  { kind: 'lumaKey', params: { threshold: 0, softness: 0 }, expected: [64, 128, 191, 128] },
  { kind: 'lumaKey', params: { threshold: 1, softness: 0 }, expected: [64, 128, 191, 0] },
  { kind: 'lumaKey', params: { threshold: 1, softness: 0, invert: 'on' }, expected: [64, 128, 191, 128] },
  { kind: 'chromaKey', params: { red: 0.25, green: 0.5, blue: 0.75 }, expected: [64, 128, 191, 0] },
  { kind: 'crossfade', params: { mix: 0.5 }, expected: [64, 128, 191, 64] },
  { kind: 'crossfade', params: { mix: 0 }, expected: [64, 128, 191, 128] },
  { kind: 'crossfade', params: { mix: 1 }, expected: [0, 0, 0, 0] },
  { kind: 'crossfade', params: { mix: 0.5, curve: 'easeIn' }, expected: [64, 128, 191, 96] },
  { kind: 'crossfade', params: { mix: 0.5, curve: 'easeOut' }, expected: [64, 128, 191, 32] },
  { kind: 'displace', params: { center: 0 }, expected: [64, 128, 191, 128] },
  { kind: 'edge', expected: [0, 0, 0, 128] },
  { kind: 'pixelate', expected: [64, 128, 191, 128] },
  { kind: 'kaleidoscope', expected: [64, 128, 191, 128] },
  { kind: 'channelShuffle', params: { red: 'blue', blue: 'red', alpha: 'one' }, expected: [191, 128, 64, 255] },
];

for (const { kind, params, expected } of effectPixelCases) {
  test(`P1 effect GPU contract: ${kind} ${JSON.stringify(params ?? {})}`, async ({ page }) => {
    await installEffectGraph(page, kind, params);
    await expect.poll(async () => {
      const actual = await centerPixel(page);
      return expected.every((value, index) => expected[3] === 0 && index < 3 || Math.abs((actual[index] ?? -999) - value) <= 2);
    }).toBe(true);
  });
}

for (const { kind, title, parameter, value } of [
  { kind: 'pixelate' as const, title: 'Pixelate', parameter: 'Block size (px)', value: '128' },
  { kind: 'displace' as const, title: 'Displace', parameter: 'X amount (UV)', value: '0.9' },
  { kind: 'edge' as const, title: 'Edge', parameter: 'Strength', value: '8' },
]) {
  test(`P1 effect spatial sampling: ${kind}`, async ({ page }) => {
    await installEffectGraph(page, kind, {}, 'gradient', kind === 'displace');
    const before = await sourceFrameStats(page);
    await page.locator(`article[aria-label="${title} node"]`).getByRole('slider', { name: `${title} ${parameter}`, exact: true }).fill(value);
    await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(before.hash);
  });
}

test('P1 effect teaching presets render with separated nodes and no permissions', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('dialog', (dialog) => void dialog.accept());
  for (const title of ['Color & Channel Lab', 'Keyed Camera', 'Displacement Map Lab', 'Pattern & Mix Lab', 'Prism & Glow Lab', 'Liquid Surface Lab', 'Particle Transition Lab', 'Infinity Mirror Lab']) {
    await page.getByRole('button', { name: 'New patch', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
    await expect(page.getByText('Graph healthy')).toBeVisible();
    await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.count()) await pause.click();
    await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(20);
    expect(await cameraRequestCount(page)).toBe(0);
    const overlaps = await page.locator('.react-flow__node').evaluateAll((nodes) => {
      const bounds = nodes.map((node) => ({ id: node.getAttribute('data-id'), rect: node.getBoundingClientRect() }));
      return bounds.flatMap((node, index) => bounds.slice(index + 1).filter((other) =>
        Math.min(node.rect.right, other.rect.right) > Math.max(node.rect.left, other.rect.left) + 1 &&
        Math.min(node.rect.bottom, other.rect.bottom) > Math.max(node.rect.top, other.rect.top) + 1,
      ).map((other) => `${node.id}/${other.id}`));
    });
    expect(overlaps, title).toEqual([]);
  }
});

test('P1 effect spatial controls change GPU output and persist on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installEffectGraph(page, 'kaleidoscope', { mode: 'repeat' }, 'gradient');
  const node = page.locator('article[aria-label="Tile / Kaleidoscope node"]');
  const before = await sourceFrameStats(page);
  await node.getByRole('combobox', { name: 'Tile / Kaleidoscope Mode', exact: true }).selectOption('kaleidoscope');
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(before.hash);
  const rotation = node.getByRole('slider', { name: 'Tile / Kaleidoscope Rotation (deg)', exact: true });
  await rotation.focus();
  await rotation.fill('45');
  await rotation.blur();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rotation).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(rotation).toHaveValue('45');
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('videobrain.project') ?? '{}') as { document?: GraphDocument };
    return stored.document?.nodes.find(({ id }) => id === 'effect')?.params.rotation;
  })).toBe(45);
  await page.screenshot({ path: 'test-results/p1-effects-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(node).toBeVisible();
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.screenshot({ path: 'test-results/p1-effects-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('controllers learn MIDI, scale CC, restore momentary values and persist disarmed', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    const input = { id: 'test-midi', name: 'Test MIDI', state: 'connected', onmidimessage: null as ((event: { data: Uint8Array }) => void) | null, close: () => Promise.resolve() };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: () => Promise.resolve({ inputs: new Map([['test-midi', input]]), onstatechange: null }) });
    Reflect.set(window, 'sendTestMidi', (bytes: number[]) => input.onmidimessage?.({ data: new Uint8Array(bytes) }));
  });
  await installEffectGraph(page, 'crossfade');
  await page.getByRole('button', { name: 'Controllers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Controllers', exact: true });
  await dialog.getByLabel('Mapping ID', { exact: true }).fill('mix-knob');
  await dialog.getByLabel('Name', { exact: true }).fill('Mix knob');
  await dialog.getByRole('combobox', { name: 'Target node', exact: true }).selectOption('effect');
  await dialog.getByRole('combobox', { name: 'Parameter', exact: true }).selectOption('mix');
  await dialog.getByRole('button', { name: 'Save mapping' }).click();
  await dialog.getByRole('button', { name: 'Enable MIDI' }).click();
  await expect(dialog.getByText('Test MIDI', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Learn', exact: true }).click();
  const send = (bytes: number[]) => page.evaluate((bytes) => {
    const callback: unknown = Reflect.get(window, 'sendTestMidi');
    if (typeof callback === 'function') (callback as (bytes: number[]) => void)(bytes);
  }, bytes);
  await send([0xb0, 7, 100]);
  await expect(dialog.getByText(/Ch 1 · CC 7/)).toBeVisible();
  await dialog.getByLabel('Armed', { exact: true }).check();
  await send([0xb0, 7, 127]);
  const savedMix = () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('videobrain.project') ?? '{}') as { document?: GraphDocument };
    return stored.document?.nodes.find(({ id }) => id === 'effect')?.params.mix;
  });
  await expect.poll(savedMix).toBe(1);
  await dialog.getByLabel('Mapping ID', { exact: true }).fill('mix-hold');
  await dialog.getByLabel('Name', { exact: true }).fill('Mix hold');
  await dialog.getByRole('combobox', { name: 'Behavior', exact: true }).selectOption('momentary');
  await dialog.getByLabel('High / on', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Save mapping' }).click();
  await dialog.locator('.controller-mapping').filter({ hasText: 'Mix hold' }).getByRole('button', { name: 'Learn', exact: true }).click();
  await send([0x90, 60, 127]);
  await dialog.getByLabel('Armed', { exact: true }).check();
  await send([0x90, 60, 127]);
  await expect.poll(savedMix).toBe(0);
  await send([0x90, 60, 0]);
  await expect.poll(savedMix).toBe(1);
  await send([0x90, 60, 127]);
  await expect.poll(savedMix).toBe(0);
  await dialog.getByRole('button', { name: 'Disable MIDI' }).click();
  await expect.poll(savedMix).toBe(1);
  await page.screenshot({ path: 'test-results/controllers-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/controllers-mobile.png' });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Controllers', exact: true }).click();
  await expect(dialog.getByLabel('Armed', { exact: true })).not.toBeChecked();
  await expect(dialog.locator('.controller-mapping')).toHaveCount(2);
});

test('Companion controls source and transport by mapping ID without persisting credentials', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const mappings = [
    { id: 'next', name: 'Next', action: { type: 'source', nodeId: 'effect', mode: 'advance', index: 0 } },
    { id: 'play', name: 'Play', action: { type: 'transport', command: 'play' } },
    { id: 'pause', name: 'Pause', action: { type: 'transport', command: 'pause' } },
    { id: 'reset', name: 'Reset', action: { type: 'transport', command: 'reset' } },
  ];
  await page.addInitScript((mappings) => localStorage.setItem('videobrain.controllers.v1', JSON.stringify({ version: 1, mappings })), mappings);
  const acknowledgements: { requestId: string; ok: boolean }[] = [];
  let send: ((message: string) => void) | undefined;
  await page.routeWebSocket('wss://bridge.test/control-ws', (socket) => {
    send = (message) => socket.send(message);
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string; requestId: string; ok: boolean };
      if (message.type === 'authenticate') socket.send(JSON.stringify({ type: 'ready' }));
      if (message.type === 'ack') acknowledgements.push(message);
    });
  });
  await installEffectGraph(page, 'sourceSelector');
  await page.getByRole('button', { name: 'Controllers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Controllers', exact: true });
  await dialog.getByLabel('Bridge URL').fill('wss://bridge.test/control-ws');
  await dialog.getByLabel('Bridge key').fill('fixture-key-not-a-real-secret');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.getByText(/Companion: Connected/)).toBeVisible();
  const command = async (mappingId: string, type: 'press' | 'release', requestId: string) => {
    if (!send) throw new Error('Mock bridge is not connected');
    send(JSON.stringify({ type: 'control', mappingId, event: { type }, requestId }));
    await expect.poll(() => acknowledgements.find((message) => message.requestId === requestId)).toBeDefined();
    return acknowledgements.find((message) => message.requestId === requestId)?.ok;
  };
  expect(await command('next', 'press', 'disarmed')).toBe(false);
  await dialog.getByLabel('Armed', { exact: true }).check();
  expect(await command('next', 'press', 'advance')).toBe(true);
  expect(await command('next', 'press', 'repeat')).toBe(true);
  await command('next', 'release', 'release');
  await command('next', 'press', 'advance-again');
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('videobrain.project') ?? '{}') as { document?: GraphDocument };
    return saved.document?.nodes.find(({ id }) => id === 'effect')?.params.index;
  })).toBe(2);
  await command('play', 'press', 'play');
  await command('pause', 'press', 'pause');
  await command('reset', 'press', 'reset');
  expect(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-key-not-a-real-secret'))).toBe(false);
  await dialog.getByRole('button', { name: 'Close controllers' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('data nodes parse JSON and CSV through complete teaching graphs', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('dialog', (dialog) => void dialog.accept());
  for (const title of ['JSON & Text Lab', 'CSV & Table Lab']) {
    await page.getByRole('button', { name: 'New patch', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
    await expect(page.getByText('Graph healthy')).toBeVisible();
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.count()) await pause.click();
    await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(50);
    await expect(page.getByLabel('Data inspection', { exact: true })).toContainText(title.startsWith('JSON') ? 'Signal' : 'Beta');
  }
});

test('data-only network nodes require explicit actions and update Inspect while paused', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  let fetches = 0;
  await page.route('https://data.test/value', async (route) => { fetches++; await route.fulfill({ body: '{"message":"received"}', contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }); });
  const document: GraphDocument = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [createGraphNode('httpFetch', { x: 0, y: 0 }, { url: 'https://data.test/value' }, 'fetch'), createGraphNode('dataInspect', { x: 360, y: 0 }, {}, 'inspect')],
    edges: [{ id: 'data', source: { nodeId: 'fetch', portId: 'text' }, target: { nodeId: 'inspect', portId: 'text' } }],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(fetches).toBe(0);
  await page.getByRole('button', { name: 'Fetch data', exact: true }).click();
  await expect(page.getByLabel('Data inspection', { exact: true })).toContainText('received');
  expect(fetches).toBe(1);
  await page.screenshot({ path: 'test-results/data-nodes-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Data inspection', { exact: true })).toContainText('received');
  await page.screenshot({ path: 'test-results/data-nodes-mobile.png' });
});

test('Storage node writes only on explicit action and leaves project storage separate', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New patch', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Storage & Text Lab/ }).click();
  expect(await page.evaluate(() => localStorage.getItem('videobrain.data.v1.teaching-text'))).toBeNull();
  await page.getByRole('button', { name: 'Write stored text', exact: true }).click();
  await expect(page.getByLabel('Data inspection', { exact: true })).toContainText('A saved signal');
  expect(await page.evaluate(() => localStorage.getItem('videobrain.data.v1.teaching-text'))).toBe('A saved signal');
});

test('WebSocket node receives text only after explicit connection', async ({ page }) => {
  let connections = 0;
  await page.routeWebSocket('wss://data.test/socket', (socket) => { connections++; socket.send('socket fixture'); });
  const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [createGraphNode('dataSocket', { x: 0, y: 0 }, { url: 'wss://data.test/socket' }, 'socket'), createGraphNode('dataInspect', { x: 360, y: 0 }, {}, 'inspect')],
    edges: [{ id: 'data', source: { nodeId: 'socket', portId: 'text' }, target: { nodeId: 'inspect', portId: 'text' } }],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  expect(connections).toBe(0);
  await page.getByRole('button', { name: 'Connect data', exact: true }).click();
  await expect(page.getByLabel('Data inspection', { exact: true })).toContainText('socket fixture');
  await page.locator('article[aria-label="WebSocket node"]').getByRole('button', { name: 'Stop data connection', exact: true }).click();
  await expect(page.locator('article[aria-label="WebSocket node"]').getByRole('button', { name: 'Connect data', exact: true })).toBeEnabled();
});

test('Server Events node receives bounded default messages and stops explicitly', async ({ page }) => {
  await page.route('https://data.test/events', async (route) => { await route.fulfill({ body: 'data: event fixture\n\n', contentType: 'text/event-stream', headers: { 'Access-Control-Allow-Origin': '*' } }); });
  const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [createGraphNode('serverEvents', { x: 0, y: 0 }, { url: 'https://data.test/events' }, 'events'), createGraphNode('dataInspect', { x: 360, y: 0 }, {}, 'inspect')],
    edges: [{ id: 'data', source: { nodeId: 'events', portId: 'text' }, target: { nodeId: 'inspect', portId: 'text' } }],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await page.getByRole('button', { name: 'Connect data', exact: true }).click();
  await expect(page.locator('article[aria-label="Server Events node"]')).toContainText('Reconnect explicitly');
  await expect(page.locator('article[aria-label="Server Events node"]').getByRole('button', { name: 'Connect data', exact: true })).toBeEnabled();
});

test('signal tests monitor values and chained bangs without a Display', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('constant', { x: 0, y: 0 }, { value: -0.5 }, 'constant'),
      createGraphNode('math', { x: 300, y: 0 }, { operation: 'multiply', b: 2 }, 'math'),
      createGraphNode('mapRange', { x: 600, y: 0 }, { inMin: -2, inMax: 2, outMin: -10, outMax: 10 }, 'range'),
      createGraphNode('smooth', { x: 900, y: 0 }, { rise: 0, fall: 0 }, 'smooth'),
      createGraphNode('signalNumber', { x: 1200, y: 0 }, { min: -10, max: 10 }, 'number'),
      createGraphNode('controlToBool', { x: 1500, y: 0 }, { threshold: 0 }, 'boolean'),
      createGraphNode('signalEdge', { x: 1800, y: 0 }, {}, 'edge'),
      createGraphNode('signalBang', { x: 0, y: 700 }, {}, 'bang'),
      createGraphNode('signalBang', { x: 300, y: 700 }, {}, 'chain'),
      createGraphNode('counter', { x: 600, y: 700 }, {}, 'counter'),
      createGraphNode('signalNumber', { x: 900, y: 700 }, {}, 'count'),
      createGraphNode('textSource', { x: 1200, y: 700 }, { text: 'Test <literal>\nSecond line' }, 'text'),
      createGraphNode('signalText', { x: 1500, y: 700 }, {}, 'text-monitor'),
    ], edges: [
      ...[['constant', 'math', 'a'], ['math', 'range', 'value'], ['range', 'smooth', 'value'], ['smooth', 'number', 'value'], ['number', 'boolean', 'value'], ['boolean', 'edge', 'value'], ['bang', 'chain', 'value'], ['chain', 'counter', 'increment'], ['counter', 'count', 'value']].map(([source, target, port], index) => ({ id: `edge${index}`, source: { nodeId: source, portId: 'value' }, target: { nodeId: target, portId: port } })),
      { id: 'text', source: { nodeId: 'text', portId: 'text' }, target: { nodeId: 'text-monitor', portId: 'value' } },
    ],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  const numeric = page.locator('[data-id="number"]');
  await expect(numeric.getByLabel('Numeric signal', { exact: true })).toHaveText('-5.000');
  await expect(page.locator('[data-id="edge"]').getByLabel('Boolean signal', { exact: true })).toHaveText('LOW');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const bang = page.locator('[data-id="bang"]');
  const chain = page.locator('[data-id="chain"]');
  await bang.getByRole('button', { name: 'Fire bang' }).click();
  await expect(chain.getByLabel('Bang count', { exact: true })).toHaveText('1');
  await expect(page.locator('[data-id="count"]').getByLabel('Numeric signal', { exact: true })).toHaveText('1.000');
  await expect(bang.getByRole('button', { name: 'Fire bang' })).not.toHaveClass(/is-lit/);
  await bang.getByRole('button', { name: 'Fire bang' }).press('Enter');
  await expect(chain.getByLabel('Bang count', { exact: true })).toHaveText('2');
  await page.locator('[data-id="constant"]').getByRole('slider', { name: 'Constant Value', exact: true }).fill('0.5');
  await expect(numeric.getByLabel('Numeric signal', { exact: true })).toHaveText('5.000');
  await expect(page.locator('[data-id="edge"]').getByLabel('Boolean signal', { exact: true })).toHaveText('HIGH');
  await expect(page.locator('[data-id="edge"]').getByLabel('Rising count', { exact: true })).toHaveText('1');
  await expect(page.locator('[data-id="text-monitor"]').getByLabel('Text signal', { exact: true })).toHaveText('Test <literal>\nSecond line');
  await page.screenshot({ path: 'test-results/signal-tests-desktop.png' });
  await page.getByRole('button', { name: 'Return to frame zero', exact: true }).click();
  await expect(chain.getByLabel('Bang count', { exact: true })).toHaveText('0');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/signal-tests-mobile.png' });
});

test('event timing drives a crossfade and reset restores the initial frame', async ({ page }) => {
  const document: GraphDocument = { schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('cueScheduler', { x: 0, y: 0 }, { cues: '[{"id":"go","at":500,"value":1}]' }, 'cue'),
      createGraphNode('timedTransition', { x: 350, y: 0 }, { duration: 1, curve: 'linear' }, 'transition'),
      createGraphNode('solid', { x: 0, y: 600 }, { red: 1, green: 0, blue: 0 }, 'red'),
      createGraphNode('solid', { x: 350, y: 600 }, { red: 0, green: 0, blue: 1 }, 'blue'),
      createGraphNode('crossfade', { x: 700, y: 0 }, {}, 'mix'),
      createGraphNode('display', { x: 1050, y: 0 }, {}, 'output'),
    ], edges: [
      { id: 'start', source: { nodeId: 'cue', portId: 'cue' }, target: { nodeId: 'transition', portId: 'start' } },
      { id: 'value', source: { nodeId: 'transition', portId: 'value' }, target: { nodeId: 'mix', portId: 'mix' } },
      { id: 'red', source: { nodeId: 'red', portId: 'frame' }, target: { nodeId: 'mix', portId: 'source' } },
      { id: 'blue', source: { nodeId: 'blue', portId: 'frame' }, target: { nodeId: 'mix', portId: 'map' } },
      { id: 'output', source: { nodeId: 'mix', portId: 'frame' }, target: { nodeId: 'output', portId: 'source' } },
    ],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  const waitForBlue = async () => {
    await expect.poll(async () => {
      const pause = page.getByRole('button', { name: 'Pause', exact: true });
      if (await pause.count()) await pause.click();
      const blue = (await centerPixel(page))[2] ?? 0;
      if (blue <= 245) await page.getByRole('button', { name: 'Play', exact: true }).click();
      return blue;
    }).toBeGreaterThan(245);
  };
  await waitForBlue();
  const held = await centerPixel(page);
  expect(await centerPixel(page)).toEqual(held);
  await page.getByRole('button', { name: 'Return to frame zero', exact: true }).click();
  await expect.poll(async () => (await centerPixel(page))[0]).toBeGreaterThan(245);
  expect((await centerPixel(page))[2]).toBeLessThan(5);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await waitForBlue();
});

test('event teaching patches render and sequence on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('dialog', (dialog) => void dialog.accept());
  for (const [title, nodeTitle] of [['Cue Logic Basics', 'Logic'], ['Timed Transition', 'Timed Transition'], ['Step Sequence Lab', 'Step Sequencer']]) {
    await page.getByRole('button', { name: 'New patch', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
    await expect(page.locator(`article[aria-label="${nodeTitle} node"]`)).toBeVisible();
    await expect(page.getByText('Graph healthy')).toBeVisible();
    await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Return to frame zero', exact: true }).click();
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(20);
  const before = (await sourceFrameStats(page)).hash;
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(before);
  await page.screenshot({ path: 'test-results/events-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.screenshot({ path: 'test-results/events-mobile.png' });
  expect(await cameraRequestCount(page)).toBe(0);
});

test('3D foundation renders textured geometry through frame effects and camera controls', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New patch', exact: true }).click();
  await page.getByRole('menuitem', { name: /^3D Primitive Lab/ }).click();
  await expect(page.locator('article[aria-label="Render 3D node"]')).toBeVisible();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(40);
  const moving = await sourceFrameStats(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(moving.hash);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Return to frame zero', exact: true }).click();
  const reset = await sourceFrameStats(page);
  await page.getByRole('button', { name: 'Return to frame zero', exact: true }).click();
  expect((await sourceFrameStats(page)).hash).toBe(reset.hash);
  const overlaps = await page.locator('.react-flow__node').evaluateAll((nodes) => {
    const rectangles = nodes.map((node) => ({ id: node.getAttribute('data-id'), bounds: node.getBoundingClientRect() }));
    return rectangles.flatMap((node, index) => rectangles.slice(index + 1).filter((other) => Math.min(node.bounds.right, other.bounds.right) > Math.max(node.bounds.left, other.bounds.left) + 1 && Math.min(node.bounds.bottom, other.bounds.bottom) > Math.max(node.bounds.top, other.bounds.top) + 1).map((other) => `${node.id}/${other.id}`));
  });
  expect(overlaps).toEqual([]);
  const original = await sourceFrameStats(page);
  expect(original.visible).toBeGreaterThan(100);
  expect(original.visible).toBeLessThan(original.pixelCount);
  const camera = page.locator('article[aria-label="Camera 3D node"]');
  await camera.getByRole('combobox', { name: 'Camera 3D Projection', exact: true }).selectOption('orthographic');
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(original.hash);
  const material = page.locator('article[aria-label="PBR Material node"]');
  await material.getByRole('slider', { name: 'PBR Material Opacity', exact: true }).fill('0.5');
  await expect.poll(async () => (await sourceFrameStats(page)).maxAlpha).toBeLessThan(255);
  await page.screenshot({ path: 'test-results/scene3d-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(40);
  await page.screenshot({ path: 'test-results/scene3d-mobile.png' });
  await page.locator('canvas.preview-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Context-loss test extension unavailable');
    Reflect.set(canvas, 'restoreTestContext', () => extension.restoreContext());
    extension.loseContext();
  });
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'false');
  await page.locator('canvas.preview-canvas').evaluate((canvas) => {
    const restore: unknown = Reflect.get(canvas, 'restoreTestContext');
    if (typeof restore === 'function') (restore as () => void)();
  });
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(40);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: 'New patch', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Beat-Synced Color/ }).click();
  await expect(page.locator('article[aria-label="Render 3D node"]')).toHaveCount(0);
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(40);
});

test('Render 3D uses a third light independently of the first two inputs', async ({ page }) => {
  const document: GraphDocument = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('primitive3d', { x: 0, y: 0 }, {}, 'mesh'),
      createGraphNode('light3d', { x: 0, y: 700 }, { mode: 'ambient', intensity: 0 }, 'third-light'),
      createGraphNode('render3d', { x: 360, y: 0 }, {}, 'render'),
      createGraphNode('display', { x: 720, y: 0 }, {}, 'output'),
    ],
    edges: [
      { id: 'mesh', source: { nodeId: 'mesh', portId: 'geometry' }, target: { nodeId: 'render', portId: 'geometry' } },
      { id: 'light', source: { nodeId: 'third-light', portId: 'light' }, target: { nodeId: 'render', portId: 'light3' } },
      { id: 'frame', source: { nodeId: 'render', portId: 'frame' }, target: { nodeId: 'output', portId: 'source' } },
    ],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => renderedColorSignal(page)).toBeLessThan(5);
  await page.locator('article[aria-label="Light 3D node"]').getByRole('slider', { name: 'Light 3D Intensity', exact: true }).fill('3');
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(40);
});

test('3D vector grid renders points and connected lines without device access', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New patch', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Vector & Grid Lab/ }).click();
  await expect(page.locator('article[aria-label="Grid / Line 3D node"]')).toBeVisible();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(40);
  const points = await sourceFrameStats(page);
  await page.locator('article[aria-label="Grid / Line 3D node"]').getByRole('combobox', { name: 'Grid / Line 3D Mode', exact: true }).selectOption('line');
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(points.hash);
  expect(await cameraRequestCount(page)).toBe(0);
});

test('Shader Source applies bounded GLSL with live uniforms and compile recovery', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: 'New patch', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: /^Shader Lab/ }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Return to frame zero' }).click();
  const node = page.locator('article[aria-label="Shader Source node"]');
  const editor = node.getByRole('textbox', { name: 'Shader Source GLSL body', exact: true });
  const apply = node.getByRole('button', { name: 'Apply Shader Source GLSL body', exact: true });
  await expect.poll(async () => (await sourceFrameStats(page)).maximum).toBeGreaterThan(100);
  const original = await editor.inputValue();
  const initial = (await sourceFrameStats(page)).hash;
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const frame = Number(await page.locator('canvas.preview-canvas').getAttribute('data-frame'));
  await expect.poll(async () => Number(await page.locator('canvas.preview-canvas').getAttribute('data-frame'))).toBeGreaterThan(frame + 5);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect((await sourceFrameStats(page)).hash).not.toBe(initial);
  const beforeEdit = (await sourceFrameStats(page)).hash;
  const body = 'outColor = vec4(uValue1, uValue2, 0.25, uValue4);';
  await editor.click();
  await editor.fill(body);
  await editor.blur();
  expect((await sourceFrameStats(page)).hash).toBe(beforeEdit);
  await apply.click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor).toHaveValue(body);
  await node.getByRole('slider', { name: 'Shader Source uValue4', exact: true }).fill('0.5');
  await expect.poll(async () => (await sourceFrameStats(page)).maxAlpha).toBe(128);
  const firstUniform = (await sourceFrameStats(page)).hash;
  await page.locator('article[aria-label="Constant node"]').getByRole('slider', { name: 'Constant Value', exact: true }).fill('0.8');
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(firstUniform);
  const lastGood = (await sourceFrameStats(page)).hash;
  for (const invalid of ['while (true) {}', 'outColor = missingVariable;']) {
    await editor.click();
    await editor.fill(invalid);
    await apply.click();
    await expect(page.getByText(/Shader Source \(shader-source\):/).first()).toBeVisible();
    expect((await sourceFrameStats(page)).hash).toBe(lastGood);
  }
  await editor.click();
  await editor.fill(body);
  await apply.click();
  await expect(page.getByText(/Shader Source \(shader-source\):/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/shader-desktop.png' });
  await page.reload();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(editor).toHaveValue(body);
  await expect.poll(async () => (await sourceFrameStats(page)).maxAlpha).toBe(128);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await sourceFrameStats(page)).maxAlpha).toBe(128);
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(195, 500);
  await page.mouse.down();
  await page.mouse.move(390 - bounds!.x - bounds!.width / 2, 500, { steps: 12 });
  await page.mouse.up();
  await expect(editor).toBeInViewport();
  await page.screenshot({ path: 'test-results/shader-mobile.png' });
});

test('Network Video plays an external HLS stream through WebGL2', async ({ page }) => {
  const url = process.env.TEST_HLS_URL;
  test.skip(!url, 'Set TEST_HLS_URL to run the live network check.');
  test.setTimeout(90_000);
  await page.goto('https://videohead.duckdns.org/videobrain/');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: 'New patch', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: /^Network Video/ }).click();
  const node = page.locator('article[aria-label="Network Video node"]');
  const endpoint = node.getByRole('textbox', { name: /URL/ });
  await endpoint.click();
  await endpoint.fill(url!);
  await endpoint.blur();
  await expect(endpoint).toHaveValue(url!);
  await node.getByRole('button', { name: 'Apply Network Video Stream URL', exact: true }).click();
  await node.getByRole('button', { name: 'Connect stream', exact: true }).click();
  await expect(node.locator('.node-input-state')).toHaveText('live', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await sourceFrameStats(page)).maximum, { timeout: 15_000 }).toBeGreaterThan(20);
  const first = await sourceFrameStats(page);
  await expect.poll(async () => (await sourceFrameStats(page)).hash, { timeout: 15_000 }).not.toBe(first.hash);
  await page.screenshot({ path: 'test-results/network-hls-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await sourceFrameStats(page)).maximum).toBeGreaterThan(20);
  await page.screenshot({ path: 'test-results/network-hls-mobile.png' });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await node.getByRole('button', { name: 'Disconnect stream', exact: true }).click();
  await expect(node.locator('.node-input-state')).toHaveText('idle');
  await expect.poll(async () => (await sourceFrameStats(page)).maximum).toBe(0);
  await page.reload();
  await expect(node.locator('.node-input-state')).toHaveText('idle');
  await expect(endpoint).toHaveValue(url!);
});

test('Noise renders every variant with deterministic seeds and animated time', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.getByTitle('Add Noise', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New patch' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: /Noise Lab/ }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Return to frame zero' }).click();
  const noise = page.locator('article[aria-label="Noise node"]');
  const hashes = new Set<number>();
  for (const mode of ['value', 'simplex', 'cellular', 'curl', 'fractal']) {
    await noise.getByRole('combobox', { name: 'Noise Mode', exact: true }).selectOption(mode);
    await expect.poll(async () => (await sourceFrameStats(page)).maximum - (await sourceFrameStats(page)).minimum).toBeGreaterThan(30);
    hashes.add((await sourceFrameStats(page)).hash);
  }
  expect(hashes.size).toBe(5);
  const fractals = new Set<number>();
  for (const mode of ['fbm', 'turbulence', 'ridged']) {
    await noise.getByRole('combobox', { name: 'Noise Fractal', exact: true }).selectOption(mode);
    fractals.add((await sourceFrameStats(page)).hash);
  }
  expect(fractals.size).toBe(3);
  const initial = (await sourceFrameStats(page)).hash;
  await noise.getByRole('slider', { name: 'Noise Seed', exact: true }).fill('124');
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(initial);
  await noise.getByRole('slider', { name: 'Noise Seed', exact: true }).fill('23');
  await expect.poll(async () => (await sourceFrameStats(page)).hash).toBe(initial);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const frame = Number(await page.locator('canvas.preview-canvas').getAttribute('data-frame'));
  await expect.poll(async () => Number(await page.locator('canvas.preview-canvas').getAttribute('data-frame'))).toBeGreaterThan(frame + 5);
  await page.getByRole('button', { name: 'Pause' }).click();
  expect((await sourceFrameStats(page)).hash).not.toBe(initial);
  await page.getByRole('button', { name: 'Return to frame zero' }).click();
  await expect.poll(async () => (await sourceFrameStats(page)).hash).toBe(initial);
  await page.screenshot({ path: 'test-results/noise-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await sourceFrameStats(page)).maximum).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/noise-mobile.png' });
});

test('Text wraps live strings, imports fonts, preserves alpha, and reloads on mobile', async ({ page }) => {
  const document: GraphDocument = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('aiPrompt', { x: -350, y: 0 }, { text: 'LIVE WORDS', negative: '' }, 'copy'),
      createGraphNode('text', { x: 0, y: 0 }, { text: 'Saved fallback', fontSize: 64, alpha: 0.5 }, 'text'),
      createGraphNode('display', { x: 350, y: 0 }, {}, 'display'),
    ],
    edges: [
      { id: 'copy', source: { nodeId: 'copy', portId: 'prompt' }, target: { nodeId: 'text', portId: 'text' } },
      { id: 'output', source: { nodeId: 'text', portId: 'frame' }, target: { nodeId: 'display', portId: 'source' } },
    ],
  };
  await page.addInitScript((document) => {
    if (!sessionStorage.getItem('text-fixture')) {
      localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document }));
      sessionStorage.setItem('text-fixture', 'loaded');
    }
  }, document);
  await page.reload();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.getByTitle('Add Text', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  const text = page.locator('article[aria-label="Text node"]');
  const copy = page.locator('article[aria-label="AI Chat node"]').getByRole('textbox', { name: 'AI Chat Prompt', exact: true });
  await expect.poll(async () => (await sourceFrameStats(page)).visible).toBeGreaterThan(100);
  expect((await sourceFrameStats(page)).maxAlpha).toBe(128);
  expect((await sourceFrameStats(page)).visible).toBeLessThan((await sourceFrameStats(page)).pixelCount / 2);
  const initial = (await sourceFrameStats(page)).hash;
  await text.getByRole('textbox', { name: 'Text Text', exact: true }).click();
  await text.getByRole('textbox', { name: 'Text Text', exact: true }).fill('Saved edit');
  await text.getByRole('textbox', { name: 'Text Text', exact: true }).blur();
  await expect(text.getByRole('textbox', { name: 'Text Text', exact: true })).toHaveValue('Saved edit');
  await text.getByRole('button', { name: 'Apply Text Text', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(text.getByRole('textbox', { name: 'Text Text', exact: true })).toHaveValue('Saved fallback');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(text.getByRole('textbox', { name: 'Text Text', exact: true })).toHaveValue('Saved edit');
  expect((await sourceFrameStats(page)).hash).toBe(initial);
  await copy.click();
  await copy.fill('Words that wrap across several short lines');
  await copy.blur();
  await expect(copy).toHaveValue('Words that wrap across several short lines');
  expect((await sourceFrameStats(page)).hash).toBe(initial);
  await page.locator('article[aria-label="AI Chat node"]').getByRole('button', { name: 'Apply AI Chat Prompt', exact: true }).click();
  await expect.poll(async () => (await sourceFrameStats(page)).hash).not.toBe(initial);
  await text.getByRole('slider', { name: 'Text Box width', exact: true }).fill('0.4');
  const wrapped = (await sourceFrameStats(page)).hash;
  expect(wrapped).not.toBe(initial);
  await text.getByRole('combobox', { name: 'Text Wrapping', exact: true }).selectOption('none');
  expect((await sourceFrameStats(page)).hash).not.toBe(wrapped);
  await text.getByRole('combobox', { name: 'Text Wrapping', exact: true }).selectOption('word');
  await text.getByRole('combobox', { name: 'Text Align', exact: true }).selectOption('left');
  expect((await sourceFrameStats(page)).hash).not.toBe(wrapped);
  await text.getByLabel('Import font asset', { exact: true }).setInputFiles('node_modules/storybook/assets/browser/nunito-sans-regular.woff2');
  await expect(text.getByRole('combobox', { name: 'Text Font', exact: true })).toHaveValue('custom');
  await expect(text.getByRole('button', { name: 'Remove font', exact: true })).toBeEnabled();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect.poll(async () => (await sourceFrameStats(page)).visible).toBeGreaterThan(100);
  await text.getByLabel('Import font asset', { exact: true }).setInputFiles({ name: 'bad.woff2', mimeType: 'font/woff2', buffer: Buffer.from('not a font') });
  await expect(text.getByRole('alert')).toContainText('Choose a WOFF2');
  await expect(text.getByRole('combobox', { name: 'Text Font', exact: true })).toHaveValue('custom');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('videobrain.project'))).toContain('data:font/woff2;base64,');
  await page.screenshot({ path: 'test-results/text-desktop.png' });
  await page.reload();
  await expect(text.getByRole('combobox', { name: 'Text Font', exact: true })).toHaveValue('custom');
  await expect(text.getByRole('textbox', { name: 'Text Text', exact: true })).toHaveValue('Saved edit');
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(350, 650);
  await page.mouse.down();
  await page.mouse.move(30, 650, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await sourceFrameStats(page)).visible).toBeGreaterThan(0);
  expect(await text.locator('.font-asset-control').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/text-mobile.png' });
});

test('boots a live GPU composition without permissions', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Live output' })).toBeVisible();
  await expect(page.getByText('running', { exact: true })).toBeVisible();
  const canvas = page.locator('canvas.preview-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame')))
    .toBeGreaterThan(1);
});

test('gradient modes interpolate RGBA stops on the GPU', async ({ page }) => {
  const document = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('gradient', { x: 0, y: 0 }, { stop1Red: 1, stop1Green: 0, stop1Blue: 0, stop1Alpha: 0, stop2Red: 0, stop2Green: 0, stop2Blue: 1 }, 'gradient'),
      createGraphNode('display', { x: 350, y: 0 }, {}, 'display'),
    ],
    edges: [{ id: 'output', source: { nodeId: 'gradient', portId: 'frame' }, target: { nodeId: 'display', portId: 'source' } }],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  const gradient = page.locator('article[aria-label="Gradient node"]');
  await expect(gradient).toBeVisible();
  const sample = async (offsetX: number, offsetY: number) => page.locator('canvas.preview-canvas').evaluate((element, offsets) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
    const size = Math.min(canvas.width, canvas.height);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2 + offsets.offsetX * size), Math.floor(canvas.height / 2 + offsets.offsetY * size), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  }, { offsetX, offsetY });
  await expect.poll(async () => (await sample(0, 0))[2]).toBe(255);
  expect((await sample(0, 0))[0]).toBe(0);
  expect((await sample(0, 0))[3]).toBeGreaterThan(124);
  expect((await sample(0, 0))[3]).toBeLessThan(132);
  await gradient.getByRole('combobox', { name: 'Gradient Mode' }).selectOption('radial');
  await expect.poll(async () => (await sample(0, 0))[3]).toBeLessThan(4);
  expect((await sample(0.25, 0))[3]).toBeGreaterThan(124);
  expect((await sample(-0.25, 0))[3]).toBeLessThan(132);
  await gradient.getByRole('combobox', { name: 'Gradient Mode' }).selectOption('conic');
  await expect.poll(async () => (await sample(0, 0.25))[3]).toBeLessThan(68);
  expect((await sample(0, 0.25))[3]).toBeGreaterThan(60);
  expect((await sample(0, -0.25))[3]).toBeGreaterThan(187);
  expect((await sample(0, -0.25))[3]).toBeLessThan(195);
  await gradient.getByRole('combobox', { name: 'Gradient Mode' }).selectOption('linear');
  await gradient.getByRole('button', { name: 'Add color stop' }).click();
  await gradient.getByLabel('Gradient Stop 3 Color', { exact: true }).fill('#00ff00');
  await expect.poll(async () => (await sample(0, 0))[1]).toBeGreaterThan(250);
  await gradient.getByRole('slider', { name: 'Gradient Stop 3 Position' }).fill('0');
  await expect.poll(async () => (await sample(-0.49, 0))[1]).toBeGreaterThan(245);
  expect((await sample(-0.49, 0))[3]).toBe(255);
});

test('gradient color pickers, alpha, undo, and persistence work on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.getByTitle('Add Gradient', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New patch' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: /Gradient Lab/ }).click();
  const gradient = page.locator('article[aria-label="Gradient node"]');
  const color = gradient.getByLabel('Gradient Stop 1 Color', { exact: true });
  const original = await color.inputValue();
  await color.focus();
  await color.fill('#c04080');
  await color.blur();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(color).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(color).toHaveValue('#c04080');
  const alpha = gradient.getByRole('slider', { name: 'Gradient Stop 1 Alpha', exact: true });
  await alpha.fill('0.35');
  await alpha.blur();
  await expect(page.getByRole('complementary', { name: 'Gradient inspector' }).getByRole('slider', { name: 'Gradient Stop 1 Alpha', exact: true })).toHaveValue('0.35');
  await page.screenshot({ path: 'test-results/gradient-desktop.png' });
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('videobrain.project') ?? '{}') as { document?: GraphDocument };
    return stored.document?.nodes.find((node) => node.kind === 'gradient')?.params.stop1Alpha;
  })).toBe(0.35);
  await page.reload();
  await expect(color).toHaveValue('#c04080');
  await expect(alpha).toHaveValue('0.35');
  await page.setViewportSize({ width: 390, height: 844 });
  await gradient.getByRole('button', { name: 'Add color stop' }).click();
  await expect(gradient.getByLabel('Gradient Stop 4 Color', { exact: true })).toBeVisible();
  await gradient.getByRole('button', { name: 'Remove last color stop' }).click();
  await expect(gradient.getByLabel('Gradient Stop 4 Color', { exact: true })).toHaveCount(0);
  const fits = await gradient.locator('.gradient-stops').evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/gradient-mobile.png' });
});

test('shape primitives render filled and outlined alpha on the GPU', async ({ page }) => {
  const document = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('shape', { x: 0, y: 0 }, { alpha: 0.5 }, 'shape'),
      createGraphNode('display', { x: 350, y: 0 }, {}, 'display'),
    ],
    edges: [{ id: 'output', source: { nodeId: 'shape', portId: 'frame' }, target: { nodeId: 'display', portId: 'source' } }],
  };
  await page.addInitScript((document) => localStorage.setItem('videobrain.project', JSON.stringify({ storageVersion: 1, document })), document);
  await page.reload();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  const shape = page.locator('article[aria-label="Shape node"]');
  const alphaAt = async (offset: number) => page.locator('canvas.preview-canvas').evaluate((element, offset) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2 + offset * Math.min(canvas.width, canvas.height)), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[3];
  }, offset);
  for (const primitive of ['ellipse', 'rectangle', 'triangle', 'polygon', 'star']) {
    await shape.getByRole('combobox', { name: 'Shape Primitive', exact: true }).selectOption(primitive);
    await expect.poll(() => alphaAt(0)).toBe(128);
    expect(await alphaAt(0.45)).toBe(0);
    await shape.getByRole('combobox', { name: 'Shape Style', exact: true }).selectOption('outline');
    await expect.poll(() => alphaAt(0)).toBe(0);
    await shape.getByRole('combobox', { name: 'Shape Style', exact: true }).selectOption('filled');
  }
  await shape.getByRole('combobox', { name: 'Shape Primitive', exact: true }).selectOption('ellipse');
  await shape.getByRole('combobox', { name: 'Shape Style', exact: true }).selectOption('outline');
  await expect.poll(() => alphaAt(0.3)).toBeGreaterThan(100);
});

test('catalog shape tools draw, import SVG, and persist artwork', async ({ page }) => {
  await expect(page.getByTitle('Add Shape', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Add Vector Shape', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New patch' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: /Shape Studio/ }).click();
  await expect(page.getByText('Shape Studio loaded.')).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(0);

  const shape = page.locator('article[aria-label="Shape node"]');
  const foregroundOpacity = page.locator('article[aria-label="Composite node"]').getByRole('slider', { name: 'Composite Opacity' });
  await foregroundOpacity.focus();
  await foregroundOpacity.press('Home');
  for (const primitive of ['ellipse', 'rectangle', 'triangle', 'polygon', 'star']) {
    await shape.getByRole('combobox', { name: 'Shape Primitive', exact: true }).selectOption(primitive);
    await expect(page.locator('canvas.preview-canvas')).toHaveAttribute('data-rendered', 'true');
    await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(0);
  }
  await foregroundOpacity.focus();
  await foregroundOpacity.press('End');
  const vector = page.locator('article[aria-label="Vector Shape node"]');
  const original = await vector.getByAltText('Vector artwork').getAttribute('src');
  await vector.getByRole('button', { name: 'Edit artwork' }).click();
  const editor = page.getByRole('dialog', { name: 'Vector Shape' });
  await expect(editor.getByRole('button', { name: 'Add rectangle' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Add rectangle' }).click();
  await editor.getByRole('button', { name: 'Undo artwork edit' }).click();
  await expect(editor.getByRole('button', { name: 'Redo artwork edit' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Redo artwork edit' }).click();
  await page.screenshot({ path: 'test-results/shape-editor-desktop.png' });
  await editor.getByRole('button', { name: 'Apply artwork' }).click();
  await expect(editor).not.toBeVisible();
  await expect(vector.getByAltText('Vector artwork')).not.toHaveAttribute('src', original ?? '');

  const file = { name: 'custom.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 50 Q50 5 90 50 L50 90Z" fill="#f52288"/></svg>') };
  await vector.getByLabel('Import SVG artwork', { exact: true }).setInputFiles(file);
  await expect(vector.getByAltText('Vector artwork')).toHaveAttribute('src', /f52288/);
  await expect.poll(() => renderedColorSignal(page)).toBeGreaterThan(0);
  await vector.getByLabel('Import SVG artwork', { exact: true }).setInputFiles({ ...file, buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(vector.getByRole('alert')).toContainText('Unsupported SVG element');
  await expect(vector.getByAltText('Vector artwork')).toHaveAttribute('src', /f52288/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('videobrain.project'))).toContain('f52288');
  await page.reload();
  await expect(page.locator('article[aria-label="Vector Shape node"]').getByAltText('Vector artwork')).toHaveAttribute('src', /f52288/);
  await expect(page.getByText('Graph healthy')).toBeVisible();
});

test('shape editor fits a mobile viewport and cancels without changing artwork', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'New patch' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: /Shape Studio/ }).click();
  const vector = page.locator('article[aria-label="Vector Shape node"]');
  const original = await vector.getByAltText('Vector artwork').getAttribute('src');
  await vector.getByRole('button', { name: 'Edit artwork' }).click();
  const editor = page.getByRole('dialog', { name: 'Vector Shape' });
  await expect(editor.getByRole('button', { name: 'Add star' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Add star' }).click();
  const bounds = await editor.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/shape-editor-mobile.png' });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(vector.getByAltText('Vector artwork')).toHaveAttribute('src', original ?? '');
});

test('starts blank and example graphs from the New patch menu', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'New patch' });
  await page
    .locator('article[aria-label="Flow Field node"] .operator-node-header')
    .click();
  await expect(
    page.getByRole('complementary', { name: 'Flow Field inspector' }),
  ).toBeVisible();

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'New patch starters' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(GRAPH_PRESETS.length);
  await expect(
    menu.getByRole('menuitem', { name: /Blank Canvas/ }),
  ).toBeFocused();
  await expect(
    menu.getByRole('menuitem', { name: /Beat-Synced Color/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Spiral Feedback Lab/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Control Math/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Smooth Pointer/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Transform Playground/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Mask & Composite Lab/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Beat Switcher/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Live Cut Lab/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Audio Soft Focus/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Audio Beat Pulse/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Camera Dream/ }),
  ).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Import project' }),
  ).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  await trigger.click();

  let confirmation = '';
  page.once('dialog', (dialog) => {
    confirmation = dialog.message();
    void dialog.dismiss();
  });
  await menu.getByRole('menuitem', { name: /Blank Canvas/ }).click();
  expect(confirmation).toContain('Blank Canvas');
  expect(confirmation).toContain(
    'live inputs and model connections will stop and must be restarted',
  );
  await expect(page.getByText(/15 nodes/).first()).toBeVisible();

  await trigger.click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page
    .getByRole('menuitem', { name: /Beat-Synced Color/ })
    .click();

  await expect(page.getByText(/7 nodes/).first()).toBeVisible();
  await expect(page.getByText(/8 links/).first()).toBeVisible();
  await expect(page.getByText('Nothing selected')).toBeVisible();
  await expect(page.getByText('Beat-Synced Color loaded.')).toBeVisible();
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute(
    'data-rendered',
    'true',
  );

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/15 nodes/).first()).toBeVisible();

  await trigger.click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('menuitem', { name: /Blank Canvas/ }).click();
  await expect(page.getByText(/0 nodes/).first()).toBeVisible();
  await expect(page.getByText(/0 links/).first()).toBeVisible();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('videobrain.project');
        if (!raw) {
          return -1;
        }
        const saved = JSON.parse(raw) as {
          document?: { nodes?: unknown[] };
        };
        return saved.document?.nodes?.length ?? -1;
      }),
    )
    .toBe(0);

  await page.reload();
  await expect(page.getByText(/0 nodes/).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const mobileMenuBounds = await menu.boundingBox();
  expect(mobileMenuBounds).not.toBeNull();
  expect(mobileMenuBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    (mobileMenuBounds?.x ?? 0) + (mobileMenuBounds?.width ?? 391),
  ).toBeLessThanOrEqual(390);
});

test('runs every teaching node inside a visible starter graph', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'New patch' });
  const canvas = page.locator('canvas.preview-canvas');

  const loadStarter = async (title: string) => {
    await trigger.click();
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.getByRole('menuitem', { name: new RegExp(title) }).click();
    await expect(page.getByText(`${title} loaded.`)).toBeVisible();
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('held', { exact: true })).toBeVisible();
    await expect
      .poll(() => renderedColorSignal(page), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('running', { exact: true })).toBeVisible();
  };

  await loadStarter('Control Math');
  await expect(
    page
      .locator('article[aria-label="Constant node"]')
      .getByRole('slider', { name: 'Constant Value' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Math node"]')
      .getByRole('slider', { name: 'Math A' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Map Range node"]')
      .getByRole('slider', { name: 'Map Range Output max' }),
  ).toBeVisible();

  await loadStarter('Smooth Pointer');
  await expect(
    page
      .locator('article[aria-label="Smooth node"]')
      .getByRole('slider', { name: 'Smooth Rise (s)' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Transform 2D node"]')
      .getByRole('slider', { name: 'Transform 2D X' }),
  ).toBeVisible();

  await loadStarter('Transform Playground');
  await expect(
    page
      .locator('article[aria-label="Transform 2D node"]')
      .getByRole('slider', { name: 'Transform 2D Rotation' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="XY Pad node"]')
      .getByRole('button', { name: 'XY Pad Position' }),
  ).toBeVisible();

  await loadStarter('Mask & Composite Lab');
  await expect(
    page
      .locator('article[aria-label="Solid Color node"]')
      .getByRole('slider', { name: 'Solid Color Red' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Threshold node"]')
      .getByRole('slider', { name: 'Threshold Level' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Mask node"]')
      .getByRole('slider', { name: 'Mask Amount' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Composite node"]')
      .getByRole('slider', { name: 'Composite Opacity' }),
  ).toBeVisible();

  await loadStarter('Beat Switcher');
  await expect(
    page
      .locator('article[aria-label="Frame Switch node"]')
      .getByRole('slider', { name: 'Frame Switch Index' }),
  ).toBeVisible();

  await loadStarter('Audio Soft Focus');
  await expect(
    page
      .locator('article[aria-label="Blur node"]')
      .getByRole('slider', { name: 'Blur Radius (px)' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Audio Level node"]')
      .getByRole('button', { name: 'Start mic' }),
  ).toBeVisible();

  await loadStarter('Audio Beat Pulse');
  const spectrum = page.locator('article[aria-label="Audio Spectrum node"]');
  const audioTrigger = page.locator('article[aria-label="Audio Trigger node"]');
  const audioBeat = page.locator('article[aria-label="Audio Beat Clock node"]');
  await expect(
    spectrum.getByRole('slider', { name: 'Audio Spectrum Gain' }),
  ).toHaveValue('2.4');
  await expect(
    spectrum.getByRole('button', { name: 'Start mic' }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('article[aria-label="Audio Level node"]')
      .getByRole('button', { name: 'Start mic' }),
  ).toBeVisible();
  await expect(
    audioTrigger.getByRole('slider', { name: 'Audio Trigger Threshold' }),
  ).toHaveValue('0.14');
  await expect(
    audioTrigger.getByRole('slider', { name: 'Audio Trigger Hold (s)' }),
  ).toHaveValue('0.14');
  await expect(
    audioBeat.getByRole('slider', { name: 'Audio Beat Clock Resting BPM' }),
  ).toHaveValue('120');
  await expect(
    audioBeat.getByRole('slider', { name: 'Audio Beat Clock Max BPM' }),
  ).toHaveValue('170');

  await loadStarter('Live Cut Lab');
  const selector = page.locator('article[aria-label="Auto Selector node"]');
  const strobe = page.locator('article[aria-label="Strobe node"]');
  await expect(
    selector.getByRole('slider', {
      name: 'Auto Selector Interval (s)',
    }),
  ).toHaveValue('1.5');
  await expect(
    selector.getByRole('slider', { name: 'Auto Selector Count' }),
  ).toHaveValue('4');
  await expect(
    selector.getByRole('combobox', { name: 'Auto Selector Order' }),
  ).toHaveValue('shuffleBag');
  await expect(
    selector.getByRole('slider', { name: 'Auto Selector Seed' }),
  ).toHaveValue('23');
  await expect(
    strobe.getByRole('slider', { name: 'Strobe Rate (Hz)' }),
  ).toHaveValue('0.67');
  await expect(
    strobe.getByRole('slider', { name: 'Strobe Open fraction' }),
  ).toHaveValue('0.82');
  await expect(
    strobe.getByRole('slider', { name: 'Strobe Amount' }),
  ).toHaveValue('0.55');
  await expect(
    strobe.getByRole('combobox', { name: 'Strobe Closed' }),
  ).toHaveValue('invert');

  await loadStarter('Spiral Feedback Lab');
  const spiral = page.locator('article[aria-label="Spiral Feedback node"]');
  await expect(
    spiral.getByRole('slider', {
      name: 'Spiral Feedback Feedback (1 s)',
    }),
  ).toHaveValue('0.82');
  await expect(
    spiral.getByRole('slider', {
      name: 'Spiral Feedback Rotation (°/s)',
    }),
  ).toHaveValue('42');
  await expect(
    spiral.getByRole('slider', { name: 'Spiral Feedback Zoom (×/s)' }),
  ).toHaveValue('1.16');
  await expect(
    spiral.getByRole('button', { name: 'Spiral Feedback Center' }),
  ).toBeVisible();
  await expect(spiral).toContainText('X 0.46 · Y 0.54');

  await page.getByTitle('Return to frame zero').click();
  await expect(page.getByText('Playback returned to frame zero.')).toBeVisible();
});

test('stops active device sessions before replacing a patch', async ({
  page,
}) => {
  await page
    .locator('article[aria-label="Audio Level node"] .operator-node-header')
    .click();
  let inspector = page.getByRole('complementary', {
    name: 'Audio Level inspector',
  });
  await inspector.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(
    inspector.getByRole('button', { name: 'Stop microphone' }),
  ).toBeVisible();

  await page.getByTitle('Add Video Input').click();
  inspector = page.getByRole('complementary', {
    name: 'Video Input inspector',
  });
  await inspector.getByRole('button', { name: 'Enable camera' }).click();
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'New patch' }).click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('menuitem', { name: /Camera Dream/ }).click();
  await expect(page.getByText(/8 nodes/).first()).toBeVisible();
  await expect
    .poll(() =>
      page.locator('video.video-input-element').evaluate(
        (video) => (video as HTMLVideoElement).srcObject === null,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Undo' }).click();
  await page
    .locator('article[aria-label="Audio Level node"] .operator-node-header')
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Audio Level inspector' })
      .getByRole('button', { name: 'Enable microphone' }),
  ).toBeVisible();

  await page
    .locator('article[aria-label="Video Input node"] .operator-node-header')
    .last()
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Video Input inspector' })
      .getByText('Camera off', { exact: true }),
  ).toBeVisible();
});

test('switches monitor output between display sync and fixed frame rates', async ({
  page,
}) => {
  const monitor = page.getByRole('region', { name: 'Live output' });
  const pacing = monitor.getByRole('combobox', {
    name: 'Monitor frame pacing',
  });
  const canvas = monitor.locator('canvas.preview-canvas');

  await expect(pacing).toHaveValue('display');
  await expect(pacing.getByRole('option', { name: 'Display sync' })).toBeAttached();
  await expect(pacing.getByRole('option', { name: '60 fps' })).toBeAttached();
  await expect(pacing.getByRole('option', { name: '30 fps' })).toBeAttached();
  await expect(canvas).toHaveAttribute('data-frame-pacing', 'display');

  const frameBeforeFixedRate = Number(await canvas.getAttribute('data-frame'));
  await pacing.selectOption('30-fps');
  await expect(pacing).toHaveValue('30-fps');
  await expect(canvas).toHaveAttribute('data-frame-pacing', '30-fps');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame')))
    .toBeGreaterThan(frameBeforeFixedRate);

  await pacing.selectOption('60-fps');
  await expect(canvas).toHaveAttribute('data-frame-pacing', '60-fps');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pacing).toBeVisible();
  const newPatchTrigger = page.getByRole('button', { name: 'New patch' });
  await expect(newPatchTrigger).toBeVisible();
  await newPatchTrigger.click();
  const newPatchMenu = page.getByRole('menu', { name: 'New patch starters' });
  await expect(newPatchMenu).toBeVisible();
  expect(
    await newPatchMenu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= window.innerWidth &&
        bounds.bottom <= window.innerHeight
      );
    }),
  ).toBe(true);
  await page.keyboard.press('Escape');
  expect(
    await monitor.locator('.preview-header').evaluate(
      (header) => header.scrollWidth <= header.clientWidth,
    ),
  ).toBe(true);
});

test('keeps inline values visible and edits the XY pad as one undo gesture', async ({
  page,
}) => {
  const timeNode = page.locator(
    'article[aria-label="Transport Time node"]',
  );
  await expect(timeNode).not.toHaveClass(/selected/);
  await expect(
    timeNode.getByRole('slider', { name: 'Transport Time Speed' }),
  ).toBeVisible();
  await expect(
    timeNode.getByRole('slider', { name: 'Transport Time Offset' }),
  ).toBeVisible();

  const xyNode = page.locator('article[aria-label="XY Pad node"]');
  const pad = xyNode.getByRole('button', { name: 'XY Pad Position' });
  await expect(pad).toBeVisible();
  await expect(xyNode).toContainText('X 0.50 · Y 0.50');
  const bounds = await pad.boundingBox();
  expect(bounds).not.toBeNull();

  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.8,
    bounds!.y + bounds!.height * 0.2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(xyNode).toContainText('X 0.80 · Y 0.80');
  await expect(
    page.getByRole('complementary', { name: 'XY Pad inspector' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(xyNode).toContainText('X 0.50 · Y 0.50');
});

test('starts camera input only after opt-in and renders its live frame', async ({
  page,
}) => {
  await expect.poll(() => cameraRequestCount(page)).toBe(0);

  await page.getByTitle('Add Video Input').click();
  await expect(page.getByText(/16 nodes/).first()).toBeVisible();
  const inspector = page.getByRole('complementary', {
    name: 'Video Input inspector',
  });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('Camera off', { exact: true })).toBeVisible();
  await expect.poll(() => cameraRequestCount(page)).toBe(0);

  const videoInputNode = page
    .locator('article[aria-label="Video Input node"]')
    .last();
  const inlineCamera = videoInputNode.getByRole('combobox', {
    name: 'Video Input Camera',
  });
  await inlineCamera.selectOption('environment');
  await expect(inspector.getByLabel('Camera')).toHaveValue('environment');
  await expect.poll(() => cameraRequestCount(page)).toBe(0);

  await videoInputNode.getByRole('button', { name: 'Start camera' }).click();
  await expect.poll(() => cameraRequestCount(page)).toBe(1);
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();
  await expect(
    videoInputNode.getByRole('button', { name: 'Stop camera' }),
  ).toBeVisible();
  await expect(
    page.locator('.preview-hud').getByText('camera', { exact: true }),
  ).toBeVisible();

  await inlineCamera.selectOption('user');
  await expect.poll(() => cameraRequestCount(page)).toBe(2);
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();
  await expect(inspector.getByLabel('Camera')).toHaveValue('user');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inlineCamera).toHaveValue('environment');
  await expect(inspector.getByLabel('Camera')).toHaveValue('environment');
  await expect.poll(() => cameraRequestCount(page)).toBe(3);
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();

  const links = page.locator('[data-testid^="rf__edge-"]');
  await expect(links).toHaveCount(18);
  const initialLinkCount = await links.count();
  const previousDisplayLink = page.getByTestId('rf__edge-model-display');
  await selectLink(page, previousDisplayLink);
  await page.keyboard.press('Delete');
  await expect(previousDisplayLink).toHaveCount(0);

  const source = videoInputNode.getByLabel('Frame output, frame.rgba');
  const target = page
    .locator('article[aria-label="Display node"]')
    .getByLabel('Source input, frame.rgba');
  await connectHandles(source, target, page);
  await expect(links).toHaveCount(initialLinkCount);
  await expect(page.locator('.preview-hud')).toContainText('2 passes');
  await expect(page.getByText('Graph healthy')).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('held', { exact: true })).toBeVisible();
  await expect
    .poll(() => renderedColorSignal(page), { timeout: 10_000 })
    .toBeGreaterThan(8);

  await videoInputNode.locator('.operator-node-header').click();
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Stop camera' }).click();
  await expect(inspector.getByText('Camera off', { exact: true })).toBeVisible();
  await expect(
    page.locator('.preview-hud').getByText('camera', { exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => cameraRequestCount(page)).toBe(3);
  await expect
    .poll(() =>
      page.locator('video.video-input-element').evaluate(
        (video) => (video as HTMLVideoElement).srcObject === null,
      ),
    )
    .toBe(true);
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute(
    'data-rendered',
    'true',
  );
});

test('starts audio analysis from the node and shows its control output', async ({
  page,
}) => {
  const audioNode = page.locator('article[aria-label="Audio Level node"]');
  const meter = audioNode.getByRole('meter', {
    name: 'Idle control output level',
  });

  await expect(audioNode.getByText('IDLE', { exact: true })).toBeVisible();
  await expect(meter).toBeVisible();
  await audioNode.getByRole('button', { name: 'Start mic' }).click();

  await expect(audioNode.getByText('MIC LIVE', { exact: true })).toBeVisible();
  await expect(
    audioNode.getByRole('meter', { name: 'Microphone control output level' }),
  ).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Audio Level inspector' }),
  ).toContainText('Control only — no sound output.');

  await audioNode.getByRole('button', { name: 'Stop mic' }).click();
  await expect(audioNode.getByText('DEMO', { exact: true })).toBeVisible();
});

test('opens in-app help with current nodes, I/O guidance, and contribution link', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Help & about' }).click();
  const dialog = page.getByRole('dialog', { name: 'Explore the Signal Graph' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Four signal types, one graph')).toBeVisible();
  await expect(dialog.getByText('Video Input', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('heading', {
      name: 'Inputs, outputs, and device access',
    }),
  ).toBeVisible();
  await expect(dialog).toContainText('MIDI');
  await expect(dialog).toContainText('OSC');
  await expect(dialog).toContainText('explicit action');
  await expect(dialog).toContainText('Photosensitivity warning');
  await expect(dialog).toContainText('connected Phase signal overrides Rate');
  await expect(dialog).toContainText('about 0.67 cycles per second');
  await expect(
    dialog.getByRole('link', { name: /Contribute on GitHub/ }),
  ).toHaveAttribute('href', 'https://github.com/blechdom/videobrain');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('adds, inspects, edits, and undoes a node', async ({ page }) => {
  await page.getByTitle('Add Flow Field').click();
  await expect(page.getByText(/16 nodes/).first()).toBeVisible();

  const addedNode = page.locator('article[aria-label="Flow Field node"]').last();
  await expect(page.getByRole('complementary', { name: 'Flow Field inspector' })).toBeVisible();

  const inlineScale = addedNode.getByRole('slider', { name: 'Flow Field Scale' });
  const inspectorScale = page
    .locator('.parameter-row')
    .filter({ hasText: 'Scale' })
    .locator('input');
  const before = Number(await inlineScale.inputValue());
  const nodePosition = await addedNode.evaluate(
    (element) => element.parentElement?.getAttribute('style'),
  );
  await inlineScale.focus();
  await inlineScale.press('ArrowRight');
  await expect
    .poll(async () => Number(await inlineScale.inputValue()))
    .toBeGreaterThan(before);
  await expect(inspectorScale).toHaveValue(await inlineScale.inputValue());
  await expect
    .poll(() =>
      addedNode.evaluate((element) => element.parentElement?.getAttribute('style')),
    )
    .toBe(nodePosition);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inlineScale).toHaveValue(String(before));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/15 nodes/).first()).toBeVisible();
});

test('opens searchable node creation from the keyboard', async ({ page }) => {
  await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: 'Add a node' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search nodes' }).fill('trail');
  await expect(dialog.getByRole('button', { name: /Trails/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('selects and deletes a link from the graph', async ({ page }) => {
  const links = page.locator('[data-testid^="rf__edge-"]');
  const initialLinkCount = await links.count();
  expect(initialLinkCount).toBeGreaterThan(0);

  const link = page.getByTestId('rf__edge-model-display');
  await selectLink(page, link);

  await page.keyboard.press('Delete');
  await expect(links).toHaveCount(initialLinkCount - 1);
  await expect(page.locator('.graph-overlay')).toContainText(
    `${initialLinkCount - 1} links`,
  );
});

test('rewires a selected link to a compatible output', async ({ page }) => {
  const initialLinkCount = await page.locator('[data-testid^="rf__edge-"]').count();
  const link = page.getByTestId('rf__edge-field-blend');
  await selectLink(page, link);

  const updater = link.locator('.react-flow__edgeupdater-source');
  const destination = page
    .locator('article[aria-label="Cells node"]')
    .getByLabel('Frame output, frame.rgba');
  const updaterBounds = await updater.boundingBox();
  const destinationBounds = await destination.boundingBox();
  expect(updaterBounds).not.toBeNull();
  expect(destinationBounds).not.toBeNull();

  await page.mouse.move(
    updaterBounds!.x + updaterBounds!.width / 2,
    updaterBounds!.y + updaterBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    destinationBounds!.x + destinationBounds!.width / 2,
    destinationBounds!.y + destinationBounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect(link).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Edge from cells to blend', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="rf__edge-"]')).toHaveCount(initialLinkCount);
  await expect(page.getByText('Graph healthy')).toBeVisible();
});

test('explains why an incompatible link drop was rejected', async ({ page }) => {
  const source = page
    .locator('article[aria-label="Transport Time node"]')
    .getByLabel('Time output, control.f32');
  const target = page
    .locator('article[aria-label="Warp node"]')
    .getByLabel('Source input, frame.rgba');
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();

  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2,
    sourceBounds!.y + sourceBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBounds!.x + targetBounds!.width / 2,
    targetBounds!.y + targetBounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect(page.getByRole('alert')).toContainText(
    'Cannot connect control.f32 to frame.rgba.',
  );
});

test('autosaves project changes across reloads', async ({ page }) => {
  await page.getByTitle('Add Audio Level').click();
  await page.reload();
  await expect(page.getByText(/16 nodes/).first()).toBeVisible();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect(page.getByText('Signal Graph / saved')).toBeVisible();
});
