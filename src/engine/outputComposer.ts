/**
 * M3 (named outputs and persisted mapping baseline) — output composition.
 *
 * Draws every surface of one logical output in layer order. Each surface is
 * composited through its own scratch layer because masking uses
 * `destination-in`, which would otherwise erase surfaces drawn earlier.
 *
 * Upstream frames are resolved at most once per source node, even when
 * several surfaces share that source or slice different regions of it. The
 * returned report carries the actual resolve count so the "evaluate once"
 * requirement is observable rather than assumed.
 *
 * This module composes; it does not own a renderer, a window, or a clock.
 */
import type { OutputLayout, SurfaceBlendMode } from '../store/contracts';
import { orderedSurfaces, validateOutputLayouts } from './surfaceLayout';
import { drawSurface, type MaskTarget, type RasterSize } from './surfaceRaster';

/** One resolved upstream frame. */
export interface OutputSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

type ComposerContext = Parameters<typeof drawSurface>[0] & {
  globalAlpha?: number;
};

/** Scratch surface for one composited layer. */
export interface LayerTarget {
  context: ComposerContext;
  canvas: CanvasImageSource;
}

export interface ComposeOptions {
  /** Called at most once per distinct source node id. */
  resolveSource: (sourceNodeId: string) => OutputSource | undefined;
  /** Scratch layer every surface is drawn into before compositing. */
  layer: LayerTarget;
  /** Scratch surface for mask coverage. Omitted skips masking. */
  mask?: MaskTarget;
  size: RasterSize;
}

export interface ComposeReport {
  /** Surfaces actually composited into the output. */
  drawn: number;
  /** Surfaces skipped because they are hidden or fully transparent. */
  skipped: number;
  /** Distinct source nodes resolved. Never exceeds the surface count. */
  sourceEvaluations: number;
  /** Source node ids that could not be resolved, in encounter order. */
  missingSources: readonly string[];
  /** Triangles rasterized across every surface. */
  triangles: number;
}

const BLEND_OPERATIONS: Record<SurfaceBlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  add: 'lighter',
  multiply: 'multiply',
  screen: 'screen',
};

export const blendOperation = (
  blend: SurfaceBlendMode,
): GlobalCompositeOperation => BLEND_OPERATIONS[blend] ?? 'source-over';

/**
 * Composites one output. The destination is cleared first, so a frame never
 * inherits the previous one, and every surface is drawn in `layerIndex`
 * order with its blend mode and opacity applied at composite time.
 */
export function composeOutput(
  context: ComposerContext,
  output: OutputLayout,
  options: ComposeOptions,
): ComposeReport {
  const { size, layer } = options;
  const resolved = new Map<string, OutputSource | undefined>();
  const missingSources: string[] = [];
  let drawn = 0;
  let skipped = 0;
  let triangles = 0;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.clearRect(0, 0, size.width, size.height);
  context.restore();

  for (const surface of orderedSurfaces(output)) {
    if (!surface.visible || surface.opacity <= 0) {
      skipped += 1;
      continue;
    }

    // Memoized so two surfaces sharing one source resolve it a single time.
    if (!resolved.has(surface.sourceNodeId)) {
      const source = options.resolveSource(surface.sourceNodeId);
      resolved.set(surface.sourceNodeId, source);
      if (!source) {
        missingSources.push(surface.sourceNodeId);
      }
    }
    const source = resolved.get(surface.sourceNodeId);
    if (!source) {
      skipped += 1;
      continue;
    }

    layer.context.save();
    layer.context.setTransform(1, 0, 0, 1, 0, 0);
    layer.context.globalCompositeOperation = 'source-over';
    layer.context.globalAlpha = 1;
    layer.context.clearRect(0, 0, size.width, size.height);
    layer.context.restore();

    triangles += drawSurface(layer.context, surface, {
      source: source.image,
      sourceSize: { width: source.width, height: source.height },
      destinationSize: size,
      ...(options.mask ? { mask: options.mask } : {}),
    });

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = Math.min(1, Math.max(0, surface.opacity));
    context.globalCompositeOperation = blendOperation(surface.blend);
    context.drawImage(layer.canvas, 0, 0, size.width, size.height);
    context.restore();
    drawn += 1;
  }

  return {
    drawn,
    skipped,
    sourceEvaluations: resolved.size,
    missingSources,
    triangles,
  };
}

export interface OutputPlanIssue {
  outputId: string;
  message: string;
}

export interface OutputPlan {
  outputs: readonly OutputLayout[];
  /** Distinct source node ids across every output. */
  sourceNodeIds: readonly string[];
  issues: readonly OutputPlanIssue[];
  valid: boolean;
}

/**
 * Validates a set of outputs and reports which source nodes they need, so a
 * caller can evaluate exactly those once per frame and route the results.
 */
export function planOutputs(outputs: readonly OutputLayout[]): OutputPlan {
  const validation = validateOutputLayouts(outputs);
  const issues: OutputPlanIssue[] = validation.errors.map((message) => ({
    outputId: '',
    message,
  }));
  const sourceNodeIds: string[] = [];
  for (const output of outputs) {
    for (const surface of output.surfaces) {
      if (!sourceNodeIds.includes(surface.sourceNodeId)) {
        sourceNodeIds.push(surface.sourceNodeId);
      }
    }
    if (output.surfaces.length === 0) {
      issues.push({
        outputId: output.id,
        message: `Output "${output.name}" has no surfaces.`,
      });
    }
  }
  return {
    outputs,
    sourceNodeIds,
    issues,
    valid: validation.valid,
  };
}
