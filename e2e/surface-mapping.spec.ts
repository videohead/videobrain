import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

interface SurfaceMappingResult {
  identity: { centre: number[]; corner: number[] };
  quadrants: {
    topLeft: number[];
    topRight: number[];
    bottomRight: number[];
    bottomLeft: number[];
    accepted: boolean;
  };
  masked: { centre: number[]; outside: number[] };
  feathered: { centre: number[]; edge: number[]; outside: number[] };
  combined: { insideBoth: number[]; outsideMask: number[] };
}

const OPAQUE_RED = [255, 0, 0, 255];
const CLEAR = [0, 0, 0, 0];

test('mesh warp and Bezier masks reshape a real frame', async ({ page }) => {
  const bundle = await build({
    configFile: false,
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/surface-mapping.ts'),
        formats: ['iife'],
        name: 'SurfaceMappingFixture',
      },
    },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');

  await page.route('**/__surface-mapping', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#101319"><canvas width="96" height="64" style="width:100%;height:auto;image-rendering:pixelated"></canvas></body></html>',
    }),
  );
  await page.goto('/__surface-mapping');
  await page.addScriptTag({ content: chunk.code });

  const result = await page.evaluate(() => {
    const run = Reflect.get(globalThis, 'runSurfaceMapping') as () => unknown;
    return run() as SurfaceMappingResult;
  });

  // An unmapped surface still fills the output exactly.
  expect(result.identity.centre).toEqual(OPAQUE_RED);
  expect(result.identity.corner).toEqual(OPAQUE_RED);

  // The mesh moves the whole frame into one quadrant and leaves the rest clear.
  expect(result.quadrants.accepted).toBe(true);
  expect(result.quadrants.topLeft).toEqual(OPAQUE_RED);
  expect(result.quadrants.topRight).toEqual(CLEAR);
  expect(result.quadrants.bottomRight).toEqual(CLEAR);
  expect(result.quadrants.bottomLeft).toEqual(CLEAR);

  // A hard mask keeps its interior and removes everything else.
  expect(result.masked.centre).toEqual(OPAQUE_RED);
  expect(result.masked.outside).toEqual(CLEAR);

  // Feathering ramps the alpha instead of cutting a hard edge. A wide
  // feather on a small mask legitimately keeps the centre below full
  // opacity, so this asserts the ramp rather than a saturated interior.
  const centreAlpha = result.feathered.centre[3] ?? 0;
  const edgeAlpha = result.feathered.edge[3] ?? 0;
  expect(centreAlpha).toBeGreaterThan(200);
  expect(edgeAlpha).toBeGreaterThan(0);
  expect(edgeAlpha).toBeLessThan(centreAlpha);
  // A wide blur leaves a faint tail far outside the path, so this allows a
  // couple of levels rather than demanding an exact zero.
  expect(result.feathered.outside[3] ?? 0).toBeLessThanOrEqual(4);

  // Warp and mask compose: content survives only where both agree.
  expect(result.combined.insideBoth[3]).toBeGreaterThan(0);
  expect(result.combined.outsideMask).toEqual(CLEAR);

  await page.screenshot({ path: 'test-results/surface-mapping-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/surface-mapping-mobile.png' });
});
