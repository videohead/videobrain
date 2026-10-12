/**
 * Opt-in live check against a real ComfyUI server.
 *
 * Skipped unless COMFY_LIVE_URL is set, so the default suite stays offline and
 * account-free. Run one image generation end to end:
 *   COMFY_LIVE_URL=https://host/comfy/ npx vitest run src/generation/comfyLive
 */
import { describe, expect, it } from 'vitest';

import { createAssetStore, createMemoryBackend } from '../store/assetStore';
import {
  discoverComfyCapabilities,
  parseComfyEndpoint,
} from './comfyClient';
import {
  COMFY_MODEL_FOLDERS,
  autoSelectComfyModels,
  checkComfyWorkflowReadiness,
  findComfyWorkflowTemplate,
} from './comfyWorkflows';
import { runComfyJob } from './comfyJob';

const liveUrl = process.env.COMFY_LIVE_URL;
/** Video weights are large; opt in separately. */
const liveVideo = process.env.COMFY_LIVE_VIDEO === '1';

describe.skipIf(!liveUrl)('live ComfyUI server', () => {
  it(
    'discovers capabilities and generates one image into the asset store',
    { timeout: 10 * 60 * 1000 },
    async () => {
      const base = parseComfyEndpoint(liveUrl ?? '');
      const capabilities = await discoverComfyCapabilities(
        base,
        COMFY_MODEL_FOLDERS,
      );
      expect(capabilities.nodeClasses.size).toBeGreaterThan(0);

      const template = findComfyWorkflowTemplate('checkpoint-image');
      expect(template).toBeDefined();
      if (!template) return;

      const models = autoSelectComfyModels(template, capabilities);
      expect(checkComfyWorkflowReadiness(template, capabilities, models).ready).toBe(
        true,
      );

      const assetStore = createAssetStore(createMemoryBackend());
      const result = await runComfyJob({
        base,
        prompt: template.build({
          prompt: 'a paper lantern in dense fog, cinematic',
          negativePrompt: 'text, watermark',
          models,
          width: 512,
          height: 512,
          steps: 8,
          cfg: 7,
          seed: 7,
          frames: 1,
          fps: 1,
        }),
        request: {
          id: `live-${Date.now()}`,
          prompt: 'a paper lantern in dense fog, cinematic',
          model: models.checkpoint ?? '',
          adapter: 'comfyui',
          settings: {},
          outputKind: 'image',
        },
        assetStore,
        clientId: 'live-test',
      });

      expect(result.job.error).toBeNull();
      expect(result.job.state).toBe('ready');
      const manifest = result.job.resultRef
        ? await assetStore.getManifest(result.job.resultRef.id)
        : undefined;
      expect(manifest?.mimeType).toMatch(/^image\//);
      expect(manifest?.encodedBytes).toBeGreaterThan(1024);
    },
  );

  it.skipIf(!liveVideo)(
    'generates one short clip with the paired Wan experts',
    { timeout: 30 * 60 * 1000 },
    async () => {
      const base = parseComfyEndpoint(liveUrl ?? '');
      const capabilities = await discoverComfyCapabilities(
        base,
        COMFY_MODEL_FOLDERS,
      );
      const template = findComfyWorkflowTemplate('wan-text-to-video');
      expect(template).toBeDefined();
      if (!template) return;

      const models = autoSelectComfyModels(template, capabilities);
      expect(checkComfyWorkflowReadiness(template, capabilities, models).ready).toBe(
        true,
      );

      const assetStore = createAssetStore(createMemoryBackend());
      const result = await runComfyJob({
        base,
        prompt: template.build({
          prompt: 'slow drifting fog over a still lake at dawn',
          negativePrompt: 'text, watermark',
          models,
          width: 480,
          height: 320,
          steps: 4,
          cfg: 3.5,
          seed: 11,
          frames: 13,
          fps: 12,
        }),
        request: {
          id: `live-video-${Date.now()}`,
          prompt: 'slow drifting fog over a still lake at dawn',
          model: Object.values(models).join(' + '),
          adapter: 'comfyui',
          settings: {},
          outputKind: 'video',
        },
        assetStore,
        clientId: 'live-test-video',
      });

      expect(result.job.error).toBeNull();
      expect(result.job.state).toBe('ready');
      const manifest = result.job.resultRef
        ? await assetStore.getManifest(result.job.resultRef.id)
        : undefined;
      expect(manifest?.ref.kind).toBe('video');
    },
  );
});
