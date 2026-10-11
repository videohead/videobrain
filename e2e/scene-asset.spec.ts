import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect } from '@playwright/test';
import { build } from 'vite';

let fixtureScript: string;

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    build: { write: false, minify: false, lib: { entry: resolve('e2e/fixtures/scene-asset.ts'), formats: ['iife'], name: 'SceneAssetFixture' } },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');
  fixtureScript = chunk.code;
});

test('Asset 3D renders an imported GLB scene to the Display', async ({ page }) => {
  await page.route('**/__scene-asset-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><canvas></canvas></body></html>' }),
  );
  await page.goto('/__scene-asset-fixture');
  await page.addScriptTag({ content: fixtureScript });

  const glbBytes = Array.from(
    new Uint8Array(readFileSync(resolve('public/test-data/fixtures-3d/single-mesh.glb'))),
  );

  const result = await page.evaluate(async (bytes) => {
    const run = Reflect.get(globalThis, 'runSceneAssetFixture') as (
      input: number[],
    ) => Promise<{ visible: number; center: number[]; loaded: boolean; error: string | null }>;
    return run(bytes);
  }, glbBytes);

  expect(result.error).toBeNull();
  expect(result.loaded).toBe(true);
  // The imported box should cover a meaningful portion of the 128x128 frame.
  expect(result.visible).toBeGreaterThan(200);
  expect(result.visible).toBeLessThan(128 * 128);
  // The lit model is visible at the center with non-zero alpha.
  expect(result.center[3]).toBeGreaterThan(16);
});
