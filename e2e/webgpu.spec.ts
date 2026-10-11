import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] } });

let fixtureScript: string;

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    build: { write: false, minify: false, lib: { entry: resolve('e2e/fixtures/webgpu.ts'), formats: ['iife'], name: 'WebGPUFixture' } },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');
  fixtureScript = chunk.code;
});

test('native WebGPU renders a scene through a frame pass without requesting WebGL', async ({ page }) => {
  await page.route('**/__webgpu-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><canvas width="64" height="48"></canvas></body></html>' }));
  await page.goto('/__webgpu-fixture');
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as HTMLCanvasElement['getContext'];
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, writable: true, value: function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes('webgl')) throw new Error('WebGL fallback is prohibited.');
      return original.apply(this, args);
    } });
  });
  await page.addScriptTag({ content: fixtureScript });
  const result = await page.evaluate(async () => {
    const run = Reflect.get(globalThis, 'runWebGPUFixture') as () => Promise<{
      flat: number[]; visible: number; center: number[]; translucent: number[]; concurrentRejected: boolean;
      before: { backend: string; allocatedBytes: number }; after: { allocatedBytes: number; frames: number }; errors: string[];
    }>;
    return run();
  });
  expect(result.errors).toEqual([]);
  expect(result.concurrentRejected).toBe(true);
  expect(result.before.backend).toBe('webgpu');
  expect(result.flat).toEqual([64, 128, 191, 128]);
  expect(result.visible).toBeGreaterThan(50);
  expect(result.visible).toBeLessThan(64 * 48);
  expect(Math.max(...result.center.slice(0, 3))).toBeGreaterThan(30);
  expect(result.translucent[3]).toBeGreaterThan(100);
  expect(result.translucent[3]).toBeLessThan(230);
  for (let channel = 0; channel < 3; channel++) expect(Math.abs(result.center[channel] - result.translucent[channel])).toBeLessThanOrEqual(3);
  expect(result.before.allocatedBytes).toBe(64 * 48 * 16);
  expect(result.after).toMatchObject({ allocatedBytes: 0, frames: 0 });
});

test('native WGSL effects match reference GLSL pixels', async ({ page }) => {
  await page.route('**/__webgpu-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><canvas></canvas></body></html>' }));
  await page.goto('/__webgpu-fixture');
  await page.addScriptTag({ content: fixtureScript });
  const result = await page.evaluate(async () => {
    const run = Reflect.get(globalThis, 'runWebGPUParity') as () => Promise<{
      results: { kind: string; values: Record<string, unknown>; maxDifference: number }[]; errors: string[];
      missing: number[]; faded: number[]; uploadRejected: boolean; selfReadRejected: boolean; releasedRejected: boolean;
    }>;
    return run();
  });
  expect(result.errors).toEqual([]);
  for (const entry of result.results) expect(entry.maxDifference, JSON.stringify(entry)).toBeLessThanOrEqual(3);
  expect(result.missing).toEqual([0, 0, 0, 0]);
  expect(result.faded).toEqual([255, 0, 0, 64]);
  expect(result.uploadRejected).toBe(true);
  expect(result.selfReadRejected).toBe(true);
  expect(result.releasedRejected).toBe(true);
});