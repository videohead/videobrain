import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

interface EdgeBlendResult {
  maxError: number;
  samples: { column: number; sum: number }[];
  interior: { left: number; right: number };
  ramp: { outer: number; middle: number; inner: number };
  brightness: number;
  blackLevel: {
    overlapBlack: number;
    requiredLift: number;
    contrastBefore: number;
    contrastAfter: number;
    visibleWithoutLift: boolean;
  };
}

/**
 * Signal-domain verification only. This proves the canvas blend pipeline
 * produces complementary ramps; it is NOT evidence of seamless physical
 * projection. See docs/MAPPING.md — the physical gate stays blocked.
 */
test('overlapping edge blends sum to one screen of light', async ({ page }) => {
  const bundle = await build({
    configFile: false,
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/edge-blend.ts'),
        formats: ['iife'],
        name: 'EdgeBlendFixture',
      },
    },
    logLevel: 'error',
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');

  await page.route('**/__edge-blend', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#101319"><canvas width="256" height="64" style="width:100%;height:auto;image-rendering:pixelated"></canvas></body></html>',
    }),
  );
  await page.goto('/__edge-blend');
  await page.addScriptTag({ content: chunk.code });

  const result = await page.evaluate(() => {
    const run = Reflect.get(globalThis, 'runEdgeBlend') as () => unknown;
    return run() as EdgeBlendResult;
  });

  // The seam closes: across the whole overlap the two projectors' light adds
  // to a single screen. The tolerance covers 8-bit alpha quantization and the
  // canvas gradient's piecewise-linear interpolation between stops.
  expect(result.maxError).toBeLessThan(0.04);
  for (const sample of result.samples) {
    expect(Math.abs(sample.sum - 1), `column ${sample.column}`).toBeLessThan(0.04);
  }

  // Outside the overlap each projector stays at full brightness.
  expect(result.interior.left).toBe(1);
  expect(result.interior.right).toBe(1);

  // The ramp genuinely ramps rather than sitting flat. The outermost column
  // does not reach zero because its centre sits half a pixel inside the
  // border, and the gradient interpolates linearly between stops there.
  expect(result.ramp.outer).toBeLessThan(0.1);
  expect(result.ramp.inner).toBeGreaterThan(0.98);
  expect(result.ramp.middle).toBeGreaterThan(result.ramp.outer);
  expect(result.ramp.middle).toBeLessThan(result.ramp.inner);
  expect(result.ramp.middle).toBeCloseTo(0.5 ** (1 / 2.2), 1);

  // Brightness is a uniform trim applied once.
  expect(result.brightness).toBeCloseTo(0.5, 1);

  // The black-level limitation is reported, not silently "fixed".
  expect(result.blackLevel.overlapBlack).toBeCloseTo(0.04, 6);
  expect(result.blackLevel.visibleWithoutLift).toBe(true);
  expect(result.blackLevel.contrastAfter).toBeLessThan(
    result.blackLevel.contrastBefore,
  );

  await page.screenshot({ path: 'test-results/edge-blend-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/edge-blend-mobile.png' });
});
