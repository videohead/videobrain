import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect } from '@playwright/test';
import { build } from 'vite';

let fixtureScript: string;

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    build: { write: false, minify: false, lib: { entry: resolve('e2e/fixtures/scene-instance.ts'), formats: ['iife'], name: 'SceneInstanceFixture' } },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');
  fixtureScript = chunk.code;
});

test('Instance 3D renders a bounded GPU instance batch to the Display', async ({ page }) => {
  await page.route('**/__scene-instance-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><canvas></canvas></body></html>' }),
  );
  await page.goto('/__scene-instance-fixture');
  await page.addScriptTag({ content: fixtureScript });

  const glbBytes = Array.from(
    new Uint8Array(readFileSync(resolve('public/test-data/fixtures-3d/single-mesh.glb'))),
  );

  const result = await page.evaluate(async (bytes) => {
    const run = Reflect.get(globalThis, 'runSceneInstanceFixture') as (
      input: number[],
    ) => Promise<{
      visible: number;
      instancedDrawCalls: number;
      instances: number;
      diagnostics: string[];
      error: string | null;
    }>;
    return run(bytes);
  }, glbBytes);

  expect(result.error).toBeNull();
  // The batch is instanced: 8 placements collapse into one draw call.
  expect(result.instances).toBe(8);
  expect(result.instancedDrawCalls).toBe(1);
  expect(result.diagnostics).toEqual([]);
  // Six visible boxes cover more pixels than a single placement would.
  expect(result.visible).toBeGreaterThan(200);
  expect(result.visible).toBeLessThan(128 * 128);
});
