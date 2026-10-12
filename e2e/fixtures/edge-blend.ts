import type { OutputBlendSettings } from '../../src/store/contracts';
import {
  DEFAULT_BLEND_SETTINGS,
  applyEdgeBlend,
  blackLevelReport,
  decodeBlendWeight,
} from '../../src/engine/edgeBlend';

const WIDTH = 128;
const HEIGHT = 32;
const OVERLAP = 0.25;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

interface Projector {
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
}

/** Renders one projector's white field with its edge blend applied. */
function renderProjector(settings: OutputBlendSettings): Projector {
  const canvas = makeCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is required.');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  applyEdgeBlend(context, settings, { width: WIDTH, height: HEIGHT });
  return { canvas, pixels: context.getImageData(0, 0, WIDTH, HEIGHT).data };
}

/** Alpha at one column, mid-height, as a 0..1 signal. */
function alphaAt(pixels: Uint8ClampedArray, column: number): number {
  const row = Math.floor(HEIGHT / 2);
  return (pixels[(row * WIDTH + column) * 4 + 3] ?? 0) / 255;
}

function run() {
  const target = document.querySelector('canvas');
  if (!target) throw new Error('Missing fixture canvas.');

  const gamma = DEFAULT_BLEND_SETTINGS.gamma;
  const left: OutputBlendSettings = {
    ...DEFAULT_BLEND_SETTINGS,
    edges: { left: 0, right: OVERLAP, top: 0, bottom: 0 },
  };
  const right: OutputBlendSettings = {
    ...DEFAULT_BLEND_SETTINGS,
    edges: { left: OVERLAP, right: 0, top: 0, bottom: 0 },
  };

  const leftProjector = renderProjector(left);
  const rightProjector = renderProjector(right);
  const leftPixels = leftProjector.pixels;
  const rightPixels = rightProjector.pixels;

  // The two projectors are aligned, so column i of each is the same point on
  // the wall. Across the shared band their LIGHT must add to one screen.
  const band = Math.round(WIDTH * OVERLAP);
  const start = WIDTH - band;
  let maxError = 0;
  const samples: { column: number; sum: number }[] = [];
  for (let offset = 0; offset < band; offset += 1) {
    // Left projector fades out across its right edge; the right projector
    // fades in across its own left edge, which is its first `band` columns.
    const fading = decodeBlendWeight(alphaAt(leftPixels, start + offset), gamma);
    const rising = decodeBlendWeight(alphaAt(rightPixels, offset), gamma);
    const sum = fading + rising;
    maxError = Math.max(maxError, Math.abs(sum - 1));
    if (offset % 8 === 0) samples.push({ column: offset, sum });
  }

  // Outside the band each projector must stay at full brightness.
  const interior = {
    left: alphaAt(leftPixels, Math.floor(WIDTH * 0.25)),
    right: alphaAt(rightPixels, Math.floor(WIDTH * 0.75)),
  };

  // The ramp must actually ramp, not sit flat.
  const ramp = {
    outer: alphaAt(leftPixels, WIDTH - 1),
    middle: alphaAt(leftPixels, WIDTH - Math.round(band / 2)),
    inner: alphaAt(leftPixels, start),
  };

  // Brightness trim is a separate, uniform pass.
  const dimmed = renderProjector({
    ...DEFAULT_BLEND_SETTINGS,
    brightness: 0.5,
  });
  const brightness = alphaAt(dimmed.pixels, Math.floor(WIDTH / 2));

  // Paint the composite for the screenshot: both projectors on one surface.
  const context = target.getContext('2d');
  if (!context) throw new Error('2D canvas is required.');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, target.width, target.height);
  context.fillStyle = '#101319';
  context.fillRect(0, 0, target.width, target.height);
  const half = Math.round(target.width / 2);
  context.globalCompositeOperation = 'lighter';
  context.drawImage(leftProjector.canvas, 0, 0, half, target.height);
  context.drawImage(
    rightProjector.canvas,
    half - Math.round(half * OVERLAP),
    0,
    half,
    target.height,
  );

  return {
    maxError,
    samples,
    interior,
    ramp,
    brightness,
    // Reported, not corrected: the overlap's doubled black floor.
    blackLevel: blackLevelReport(0.02),
  };
}

Reflect.set(globalThis, 'runEdgeBlend', run);
