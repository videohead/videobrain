import { describe, expect, it } from 'vitest';

import type { ComfyCapabilities } from './comfyClient';
import {
  COMFY_MODEL_FOLDERS,
  autoSelectComfyModels,
  checkComfyWorkflowReadiness,
  describeComfyWorkflowReadiness,
  findComfyWorkflowTemplate,
  type ComfyWorkflowInput,
} from './comfyWorkflows';

function capabilities(
  nodeClasses: readonly string[],
  models: Record<string, readonly string[]> = {},
): ComfyCapabilities {
  return {
    baseUrl: 'https://host.example/comfy/',
    comfyVersion: '0.39.1',
    pythonVersion: '3.11.17',
    devices: [],
    nodeClasses: new Set(nodeClasses),
    models: new Map(Object.entries(models)),
    maxUploadBytes: 1024,
    queueRemaining: 0,
    discoveredAt: 0,
  };
}

const IMAGE_NODES = [
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'EmptyLatentImage',
  'KSampler',
  'VAEDecode',
  'SaveImage',
];

const VIDEO_NODES = [
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'CLIPTextEncode',
  'EmptyHunyuanLatentVideo',
  'KSamplerAdvanced',
  'VAEDecode',
  'SaveWEBM',
];

function input(overrides: Partial<ComfyWorkflowInput> = {}): ComfyWorkflowInput {
  return {
    prompt: 'a lantern in fog',
    negativePrompt: 'blurry',
    models: {},
    width: 1024,
    height: 1024,
    steps: 20,
    cfg: 7,
    seed: 42,
    frames: 49,
    fps: 16,
    ...overrides,
  };
}

describe('checkpoint-image template', () => {
  const template = findComfyWorkflowTemplate('checkpoint-image');

  it('builds a prompt graph terminating in SaveImage', () => {
    expect(template).toBeDefined();
    if (!template) return;
    const prompt = template.build(
      input({ models: { checkpoint: 'sd_xl_base_1.0.safetensors' } }),
    );
    expect(prompt['1']?.inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
    expect(prompt['2']?.inputs.text).toBe('a lantern in fog');
    expect(prompt['3']?.inputs.text).toBe('blurry');
    expect(prompt['7']?.class_type).toBe('SaveImage');
    expect(prompt['5']?.inputs.latent_image).toEqual(['4', 0]);
  });

  it('clamps out-of-range dimensions and steps to the declared limits', () => {
    if (!template) return;
    const prompt = template.build(
      input({ width: 99_999, height: 3, steps: 5_000, models: { checkpoint: 'a' } }),
    );
    expect(prompt['4']?.inputs.width).toBe(2048);
    expect(prompt['4']?.inputs.height).toBe(64);
    expect(prompt['5']?.inputs.steps).toBe(60);
  });
});

describe('wan-text-to-video template', () => {
  const template = findComfyWorkflowTemplate('wan-text-to-video');

  it('splits sampling across the high and low noise experts', () => {
    expect(template).toBeDefined();
    if (!template) return;
    const prompt = template.build(
      input({
        steps: 20,
        models: {
          highNoise: 'high.safetensors',
          lowNoise: 'low.safetensors',
          textEncoder: 'umt5.safetensors',
          vae: 'wan_2.1_vae.safetensors',
        },
      }),
    );
    expect(prompt['1']?.inputs.unet_name).toBe('high.safetensors');
    expect(prompt['2']?.inputs.unet_name).toBe('low.safetensors');
    expect(prompt['8']?.inputs.end_at_step).toBe(10);
    expect(prompt['9']?.inputs.start_at_step).toBe(10);
    expect(prompt['9']?.inputs.model).toEqual(['2', 0]);
    expect(prompt['11']?.class_type).toBe('SaveWEBM');
  });

  it('snaps frame count onto the 4n+1 latent stride', () => {
    if (!template) return;
    const prompt = template.build(input({ frames: 50, models: {} }));
    expect(prompt['7']?.inputs.length).toBe(49);
  });
});

describe('workflow readiness', () => {
  const template = findComfyWorkflowTemplate('checkpoint-image');

  it('reports missing node classes before anything is submitted', () => {
    if (!template) return;
    const readiness = checkComfyWorkflowReadiness(
      template,
      capabilities(['KSampler']),
      { checkpoint: 'a.safetensors' },
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.missingNodeClasses).toContain('SaveImage');
    expect(describeComfyWorkflowReadiness(readiness)).toMatch(/missing required nodes/);
  });

  it('reports a model that is not installed on this server', () => {
    if (!template) return;
    const readiness = checkComfyWorkflowReadiness(
      template,
      capabilities(IMAGE_NODES, { checkpoints: ['other.safetensors'] }),
      { checkpoint: 'missing.safetensors' },
    );
    expect(readiness.missingModels[0]?.filename).toBe('missing.safetensors');
    expect(describeComfyWorkflowReadiness(readiness)).toMatch(/not installed/);
  });

  it('asks for an unfilled slot and passes once every slot resolves', () => {
    if (!template) return;
    const server = capabilities(IMAGE_NODES, {
      checkpoints: ['sd_xl_base_1.0.safetensors'],
    });
    expect(
      describeComfyWorkflowReadiness(checkComfyWorkflowReadiness(template, server)),
    ).toMatch(/Choose a checkpoint/);
    const ready = checkComfyWorkflowReadiness(template, server, {
      checkpoint: 'sd_xl_base_1.0.safetensors',
    });
    expect(ready.ready).toBe(true);
    expect(describeComfyWorkflowReadiness(ready)).toBeNull();
  });
});

describe('autoSelectComfyModels', () => {
  const template = findComfyWorkflowTemplate('wan-text-to-video');

  it('prefers the matching expert per slot', () => {
    if (!template) return;
    const selection = autoSelectComfyModels(
      template,
      capabilities(VIDEO_NODES, {
        diffusion_models: [
          'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
          'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
          'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
        ],
        text_encoders: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
        vae: ['wan_2.1_vae.safetensors'],
      }),
    );
    expect(selection.highNoise).toBe('wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors');
    expect(selection.lowNoise).toBe('wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors');
    expect(selection.textEncoder).toBe('umt5_xxl_fp8_e4m3fn_scaled.safetensors');
  });

  it('keeps a still-installed user choice instead of overriding it', () => {
    if (!template) return;
    const selection = autoSelectComfyModels(
      template,
      capabilities(VIDEO_NODES, {
        diffusion_models: ['a.safetensors', 'wan2.2_t2v_high_noise.safetensors'],
      }),
      { highNoise: 'a.safetensors' },
    );
    expect(selection.highNoise).toBe('a.safetensors');
  });
});

describe('COMFY_MODEL_FOLDERS', () => {
  it('lists each referenced folder once', () => {
    expect(new Set(COMFY_MODEL_FOLDERS).size).toBe(COMFY_MODEL_FOLDERS.length);
    expect(COMFY_MODEL_FOLDERS).toContain('checkpoints');
    expect(COMFY_MODEL_FOLDERS).toContain('diffusion_models');
  });
});
