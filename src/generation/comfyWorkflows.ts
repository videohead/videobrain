/**
 * G4 — Allowlisted ComfyUI workflow templates.
 *
 * VideoBrain never executes an imported or user-pasted workflow. Each template
 * here is a reviewed API-format graph with declared requirements: the node
 * classes it needs and the model slots it must fill. Requirements are checked
 * against a discovered ComfyCapabilities snapshot before submission, so a
 * missing custom node or uninstalled checkpoint fails with a readable message
 * instead of a server-side stack trace.
 */
import type { ComfyCapabilities } from './comfyClient';

/** One API-format node: a class name plus resolved inputs. */
export interface ComfyPromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type ComfyPromptGraph = Record<string, ComfyPromptNode>;

/** A model file the template must be pointed at before it can run. */
export interface ComfyModelSlot {
  id: string;
  label: string;
  /** ComfyUI model folder, e.g. `checkpoints` or `diffusion_models`. */
  folder: string;
  /** Preferred filename pattern used when auto-selecting a default. */
  prefer?: RegExp;
}

/** Numeric controls a template actually honors; the UI shows only these. */
export type ComfyControlId =
  | 'width'
  | 'height'
  | 'steps'
  | 'cfg'
  | 'seed'
  | 'frames'
  | 'fps';

export interface ComfyWorkflowInput {
  prompt: string;
  negativePrompt: string;
  /** Slot id to chosen model filename. */
  models: Readonly<Record<string, string>>;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  frames: number;
  fps: number;
}

export interface ComfyWorkflowTemplate {
  id: string;
  title: string;
  summary: string;
  outputKind: 'image' | 'video';
  requiredNodeClasses: readonly string[];
  modelSlots: readonly ComfyModelSlot[];
  controls: readonly ComfyControlId[];
  /** Hard ceilings, enforced before a prompt is built. */
  limits: {
    maxWidth: number;
    maxHeight: number;
    maxSteps: number;
    maxFrames: number;
  };
  build(input: ComfyWorkflowInput): ComfyPromptGraph;
}

const FILENAME_PREFIX = 'videobrain';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function snapTo(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

/**
 * Classic latent-diffusion checkpoint workflow. Works with any SD/SDXL-style
 * checkpoint that bundles its own CLIP and VAE.
 */
const checkpointImage: ComfyWorkflowTemplate = {
  id: 'checkpoint-image',
  title: 'Checkpoint image',
  summary: 'Text to image using one self-contained SD or SDXL checkpoint.',
  outputKind: 'image',
  requiredNodeClasses: [
    'CheckpointLoaderSimple',
    'CLIPTextEncode',
    'EmptyLatentImage',
    'KSampler',
    'VAEDecode',
    'SaveImage',
  ],
  modelSlots: [
    {
      id: 'checkpoint',
      label: 'Checkpoint',
      folder: 'checkpoints',
      prefer: /xl_base|sd_xl|v1-5/i,
    },
  ],
  controls: ['width', 'height', 'steps', 'cfg', 'seed'],
  limits: { maxWidth: 2048, maxHeight: 2048, maxSteps: 60, maxFrames: 1 },
  build(input) {
    const width = snapTo(clampInt(input.width, 64, this.limits.maxWidth), 8);
    const height = snapTo(clampInt(input.height, 64, this.limits.maxHeight), 8);
    return {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: input.models.checkpoint },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: input.prompt, clip: ['1', 1] },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: input.negativePrompt, clip: ['1', 1] },
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: { width, height, batch_size: 1 },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: clampInt(input.seed, 0, 0xffff_ffff),
          steps: clampInt(input.steps, 1, this.limits.maxSteps),
          cfg: input.cfg,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '6': {
        class_type: 'VAEDecode',
        inputs: { samples: ['5', 0], vae: ['1', 2] },
      },
      '7': {
        class_type: 'SaveImage',
        inputs: { images: ['6', 0], filename_prefix: FILENAME_PREFIX },
      },
    };
  },
};

/**
 * Wan 2.2 text-to-video. The released weights are a two-expert pair: the
 * high-noise transformer handles the first half of the sampling schedule and
 * the low-noise transformer finishes it, so both slots must be filled.
 */
const wanTextToVideo: ComfyWorkflowTemplate = {
  id: 'wan-text-to-video',
  title: 'Wan 2.2 text to video',
  summary: 'Text to a short clip using the paired Wan 2.2 high/low noise experts.',
  outputKind: 'video',
  requiredNodeClasses: [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'CLIPTextEncode',
    'EmptyHunyuanLatentVideo',
    'KSamplerAdvanced',
    'VAEDecode',
    'SaveWEBM',
  ],
  modelSlots: [
    {
      id: 'highNoise',
      label: 'High-noise transformer',
      folder: 'diffusion_models',
      prefer: /t2v_high_noise/i,
    },
    {
      id: 'lowNoise',
      label: 'Low-noise transformer',
      folder: 'diffusion_models',
      prefer: /t2v_low_noise/i,
    },
    {
      id: 'textEncoder',
      label: 'Text encoder',
      folder: 'text_encoders',
      prefer: /umt5/i,
    },
    { id: 'vae', label: 'VAE', folder: 'vae', prefer: /wan_2\.1_vae/i },
  ],
  controls: ['width', 'height', 'steps', 'cfg', 'seed', 'frames', 'fps'],
  limits: { maxWidth: 1280, maxHeight: 720, maxSteps: 40, maxFrames: 121 },
  build(input) {
    const width = snapTo(clampInt(input.width, 128, this.limits.maxWidth), 16);
    const height = snapTo(clampInt(input.height, 128, this.limits.maxHeight), 16);
    const steps = clampInt(input.steps, 2, this.limits.maxSteps);
    // Wan latents advance in groups of four frames plus one key frame.
    const frames =
      clampInt(
        Math.round((clampInt(input.frames, 5, this.limits.maxFrames) - 1) / 4) * 4 + 1,
        5,
        this.limits.maxFrames,
      );
    const handoff = Math.max(1, Math.floor(steps / 2));
    const seed = clampInt(input.seed, 0, 0xffff_ffff);
    return {
      '1': {
        class_type: 'UNETLoader',
        inputs: { unet_name: input.models.highNoise, weight_dtype: 'default' },
      },
      '2': {
        class_type: 'UNETLoader',
        inputs: { unet_name: input.models.lowNoise, weight_dtype: 'default' },
      },
      '3': {
        class_type: 'CLIPLoader',
        inputs: { clip_name: input.models.textEncoder, type: 'wan' },
      },
      '4': { class_type: 'VAELoader', inputs: { vae_name: input.models.vae } },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: { text: input.prompt, clip: ['3', 0] },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: input.negativePrompt, clip: ['3', 0] },
      },
      '7': {
        class_type: 'EmptyHunyuanLatentVideo',
        inputs: { width, height, length: frames, batch_size: 1 },
      },
      '8': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          add_noise: 'enable',
          noise_seed: seed,
          steps,
          cfg: input.cfg,
          sampler_name: 'euler',
          scheduler: 'simple',
          start_at_step: 0,
          end_at_step: handoff,
          return_with_leftover_noise: 'enable',
          model: ['1', 0],
          positive: ['5', 0],
          negative: ['6', 0],
          latent_image: ['7', 0],
        },
      },
      '9': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          add_noise: 'disable',
          noise_seed: seed,
          steps,
          cfg: input.cfg,
          sampler_name: 'euler',
          scheduler: 'simple',
          start_at_step: handoff,
          end_at_step: 10_000,
          return_with_leftover_noise: 'disable',
          model: ['2', 0],
          positive: ['5', 0],
          negative: ['6', 0],
          latent_image: ['8', 0],
        },
      },
      '10': {
        class_type: 'VAEDecode',
        inputs: { samples: ['9', 0], vae: ['4', 0] },
      },
      '11': {
        class_type: 'SaveWEBM',
        inputs: {
          images: ['10', 0],
          filename_prefix: FILENAME_PREFIX,
          codec: 'vp9',
          fps: Math.min(60, Math.max(1, Math.round(input.fps))),
          crf: 32,
        },
      },
    };
  },
};

export const COMFY_WORKFLOW_TEMPLATES: readonly ComfyWorkflowTemplate[] = [
  checkpointImage,
  wanTextToVideo,
];

export function findComfyWorkflowTemplate(
  id: string,
): ComfyWorkflowTemplate | undefined {
  return COMFY_WORKFLOW_TEMPLATES.find((template) => template.id === id);
}

export interface ComfyWorkflowReadiness {
  ready: boolean;
  missingNodeClasses: readonly string[];
  unfilledSlots: readonly ComfyModelSlot[];
  /** Slots whose chosen file is no longer installed on the server. */
  missingModels: readonly { slot: ComfyModelSlot; filename: string }[];
}

/**
 * Check one template against a live server snapshot plus the caller's model
 * choices. Reported separately so the UI can distinguish "this server cannot
 * run this workflow at all" from "pick a checkpoint first".
 */
export function checkComfyWorkflowReadiness(
  template: ComfyWorkflowTemplate,
  capabilities: ComfyCapabilities,
  selection: Readonly<Record<string, string>> = {},
): ComfyWorkflowReadiness {
  const missingNodeClasses = template.requiredNodeClasses.filter(
    (name) => !capabilities.nodeClasses.has(name),
  );
  const unfilledSlots: ComfyModelSlot[] = [];
  const missingModels: { slot: ComfyModelSlot; filename: string }[] = [];
  for (const slot of template.modelSlots) {
    const chosen = selection[slot.id];
    if (!chosen) {
      unfilledSlots.push(slot);
      continue;
    }
    const installed = capabilities.models.get(slot.folder) ?? [];
    if (!installed.includes(chosen)) {
      missingModels.push({ slot, filename: chosen });
    }
  }
  return {
    ready:
      missingNodeClasses.length === 0 &&
      unfilledSlots.length === 0 &&
      missingModels.length === 0,
    missingNodeClasses,
    unfilledSlots,
    missingModels,
  };
}

export function describeComfyWorkflowReadiness(
  readiness: ComfyWorkflowReadiness,
): string | null {
  if (readiness.ready) return null;
  if (readiness.missingNodeClasses.length) {
    return `This server is missing required nodes: ${readiness.missingNodeClasses.join(', ')}.`;
  }
  if (readiness.missingModels.length) {
    const first = readiness.missingModels[0];
    if (first) {
      return `${first.filename} is not installed in ${first.slot.folder} on this server.`;
    }
  }
  const slot = readiness.unfilledSlots[0];
  return slot ? `Choose a ${slot.label.toLowerCase()} before generating.` : null;
}

/**
 * Pick a sensible model file per slot from what the server actually has,
 * honoring any choice the user already made.
 */
export function autoSelectComfyModels(
  template: ComfyWorkflowTemplate,
  capabilities: ComfyCapabilities,
  existing: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const selection: Record<string, string> = {};
  for (const slot of template.modelSlots) {
    const installed = capabilities.models.get(slot.folder) ?? [];
    const current = existing[slot.id];
    if (current && installed.includes(current)) {
      selection[slot.id] = current;
      continue;
    }
    const preferred = slot.prefer
      ? installed.find((name) => slot.prefer?.test(name))
      : undefined;
    const chosen = preferred ?? installed[0];
    if (chosen) {
      selection[slot.id] = chosen;
    }
  }
  return selection;
}

/** Model folders any allowlisted template can reference. */
export const COMFY_MODEL_FOLDERS: readonly string[] = Array.from(
  new Set(
    COMFY_WORKFLOW_TEMPLATES.flatMap((template) =>
      template.modelSlots.map((slot) => slot.folder),
    ),
  ),
);
