import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

interface ProjectorMappingResult {
  identityMatchesSource: boolean;
  quadrants: Record<string, number[]>;
  defaults: {
    centre: number[];
    outsideTop: number[];
    outsideLeft: number[];
    differsFromSource: boolean;
  };
  degenerateIsFinite: boolean;
}

const OPAQUE_RED = [255, 0, 0, 255];
const TRANSPARENT = [0, 0, 0, 0];

test('Projector Mapping warps the frame onto its four screen corners', async ({ page }) => {
  const bundle = await build({
    configFile: false,
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/projector-mapping.ts'),
        formats: ['iife'],
        name: 'ProjectorMappingFixture',
      },
    },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');

  await page.route('**/__projector-mapping', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0"><canvas width="96" height="64" style="width:100%;height:auto;image-rendering:pixelated"></canvas></body></html>',
    }),
  );
  await page.goto('/__projector-mapping');
  await page.addScriptTag({ content: chunk.code });

  const result = await page.evaluate(() => {
    const run = Reflect.get(globalThis, 'runProjectorMapping') as () => unknown;
    return run() as ProjectorMappingResult;
  });

  // An identity quad is a no-op.
  expect(result.identityMatchesSource).toBe(true);

  // The quad lands in the top-left screen quadrant and nowhere else, which
  // fails if the inverse homography is transposed or mis-indexed.
  expect(result.quadrants.topLeft).toEqual(OPAQUE_RED);
  expect(result.quadrants.topRight).toEqual(TRANSPARENT);
  expect(result.quadrants.bottomRight).toEqual(TRANSPARENT);
  expect(result.quadrants.bottomLeft).toEqual(TRANSPARENT);

  // The shipped defaults inset the quad instead of passing the frame through.
  expect(result.defaults.differsFromSource).toBe(true);
  expect(result.defaults.centre).toEqual(OPAQUE_RED);
  expect(result.defaults.outsideTop).toEqual(TRANSPARENT);
  expect(result.defaults.outsideLeft).toEqual(TRANSPARENT);

  // A collapsed quad fails safe.
  expect(result.degenerateIsFinite).toBe(true);

  await page.screenshot({ path: 'test-results/projector-mapping-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/projector-mapping-mobile.png' });

  expect(
    await page.evaluate(() =>
      (Reflect.get(globalThis, 'disposeProjectorMapping') as () => boolean)(),
    ),
  ).toBe(true);
});
