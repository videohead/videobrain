import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

test('WebGL2 filters, liquid physics, instanced transitions and feedback render correctly', async ({ page }) => {
  const bundle = await build({ configFile: false, build: { write: false, minify: false, lib: { entry: resolve('e2e/fixtures/frame-effects.ts'), formats: ['iife'], name: 'FrameEffectsFixture' } }, logLevel: 'error' });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !('output' in output)) throw new Error('Fixture bundle unavailable.');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Fixture script unavailable.');
  await page.route('**/__frame-effects', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><canvas width="96" height="64" style="width:100%;height:auto;image-rendering:pixelated"></canvas></body></html>' }));
  await page.goto('/__frame-effects');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() => {
    const run = Reflect.get(globalThis, 'runFrameEffects') as () => { samples: Record<string, number[]>; changes: Record<string, boolean>; liquid: Record<string, boolean>; presets: { id: string; visible: boolean }[] };
    return run();
  });
  for (const kind of ['chromaticAberration', 'scanlines', 'bloom', 'liquidMorph', 'particleTransition']) expect(result.samples[kind], kind).toEqual([255, 0, 0, 128]);
  expect(result.samples.morphEnd).toEqual([0, 0, 255, 191]);
  expect(result.samples.particleEnd).toEqual([0, 0, 255, 191]);
  expect(result.samples.particleMiddle).not.toEqual(result.samples.particleTransition);
  expect(Object.values(result.changes).every(Boolean)).toBe(true);
  expect(result.liquid).toEqual({ moves: true, holds: true, resets: true });
  for (const preset of result.presets) expect(preset.visible, preset.id).toBe(true);
  await page.screenshot({ path: 'test-results/frame-effects-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/frame-effects-mobile.png' });
  expect(await page.evaluate(async () => (Reflect.get(globalThis, 'recoverFrameEffects') as () => Promise<boolean>)())).toBe(true);
});