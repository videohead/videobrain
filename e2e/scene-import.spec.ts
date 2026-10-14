import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';

let fixtureScript: string;

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    build: { write: false, minify: false, lib: { entry: resolve('e2e/fixtures/scene-import.ts'), formats: ['iife'], name: 'SceneImportFixture' } },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');
  fixtureScript = chunk.code;
});

function fixturePayload(name: string, companions: string[] = []) {
  const dir = resolve('public/test-data/fixtures-3d');
  return {
    primary: { name, bytes: Array.from(new Uint8Array(readFileSync(resolve(dir, name)))) },
    companions: companions.map((entry) => ({
      name: entry,
      bytes: Array.from(new Uint8Array(readFileSync(resolve(dir, entry)))),
    })),
  };
}

test.describe('D4 import adapters in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/__scene-import-fixture', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
    );
    await page.goto('/__scene-import-fixture');
    await page.addScriptTag({ content: fixtureScript });
  });

  async function convert(page: Page, payload: ReturnType<typeof fixturePayload>) {
    return page.evaluate(async (input) => {
      const run = Reflect.get(globalThis, 'runSceneImportFixture') as (
        value: typeof input,
      ) => Promise<{ ok: boolean; error: string | null; triangles: number; meshCount: number }>;
      return run(input);
    }, payload);
  }

  for (const [name, companions, minTriangles] of [
    ['d4-quad.obj', ['d4-quad.mtl'], 2],
    ['d4-quad.stl', [], 2],
    ['d4-triangle.fbx', [], 1],
    ['d4-triangle.3mf', [], 1],
    ['d4-quad.usdz', [], 2],
  ] as const) {
    test(`imports ${name}`, async ({ page }) => {
      const result = await convert(page, fixturePayload(name, [...companions]));
      expect(result.error).toBeNull();
      expect(result.ok).toBe(true);
      expect(result.triangles).toBeGreaterThanOrEqual(minTriangles);
      expect(result.meshCount).toBeGreaterThanOrEqual(1);
    });
  }
});
