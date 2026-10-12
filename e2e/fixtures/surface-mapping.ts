import type { SurfaceLayout } from '../../src/store/contracts';
import { createMeshWarp, validateOutputLayouts } from '../../src/engine/surfaceLayout';
import { createMaskPath, rectangleMaskNodes } from '../../src/engine/surfaceMask';
import { drawSurface } from '../../src/engine/surfaceRaster';

const WIDTH = 96;
const HEIGHT = 64;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function run() {
  const target = document.querySelector('canvas');
  if (!target) throw new Error('Missing fixture canvas.');
  const context = target.getContext('2d');
  const maskCanvas = makeCanvas(WIDTH, HEIGHT);
  const maskContext = maskCanvas.getContext('2d');
  if (!context || !maskContext) throw new Error('2D canvas is required.');

  // Opaque red source frame, so any sampled pixel is unambiguous.
  const sourceCanvas = makeCanvas(WIDTH, HEIGHT);
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('2D canvas is required.');
  sourceContext.fillStyle = '#ff0000';
  sourceContext.fillRect(0, 0, WIDTH, HEIGHT);

  const surface = (overrides: Partial<SurfaceLayout> = {}): SurfaceLayout => ({
    id: 'surface-1',
    sourceNodeId: 'pattern',
    sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
    warp: null,
    maskPaths: [],
    outputId: 'output-1',
    layerIndex: 0,
    visible: true,
    blend: 'normal',
    opacity: 1,
    ...overrides,
  });

  const paint = (entry: SurfaceLayout) => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawSurface(context, entry, {
      source: sourceCanvas,
      sourceSize: { width: WIDTH, height: HEIGHT },
      destinationSize: { width: WIDTH, height: HEIGHT },
      mask: { context: maskContext, canvas: maskCanvas },
    });
  };

  /** Samples one pixel addressed in screen fractions (y-down). */
  const sample = (screenX: number, screenY: number): number[] => {
    const data = context.getImageData(
      Math.min(WIDTH - 1, Math.floor(screenX * WIDTH)),
      Math.min(HEIGHT - 1, Math.floor(screenY * HEIGHT)),
      1,
      1,
    ).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
  };

  // 1. An unmapped surface is a straight blit.
  paint(surface());
  const identity = {
    centre: sample(0.5, 0.5),
    corner: sample(0.95, 0.95),
  };

  // 2. A mesh that pulls the frame into the top-left screen quadrant.
  const quadrantWarp = {
    ...createMeshWarp(1, 1),
    displacements: [
      { x: 0, y: 0 },
      { x: -0.5, y: 0 },
      { x: 0, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ],
  };
  const warped = surface({ warp: quadrantWarp });
  paint(warped);
  const quadrants = {
    topLeft: sample(0.25, 0.25),
    topRight: sample(0.75, 0.25),
    bottomRight: sample(0.75, 0.75),
    bottomLeft: sample(0.25, 0.75),
    accepted: validateOutputLayouts([
      {
        id: 'output-1',
        name: 'Main Display',
        width: 1920,
        height: 1080,
        layoutX: 0,
        layoutY: 0,
        surfaces: [warped],
      },
    ]).valid,
  };

  // 3. A hard-edged mask keeps only its interior.
  paint(
    surface({
      maskPaths: [
        createMaskPath(rectangleMaskNodes(0.25, 0.25, 0.75, 0.75), true, 0),
      ],
    }),
  );
  const masked = {
    centre: sample(0.5, 0.5),
    outside: sample(0.05, 0.05),
  };

  // 4. Feathering produces a partial alpha ramp rather than a hard cut.
  paint(
    surface({
      maskPaths: [
        createMaskPath(rectangleMaskNodes(0.25, 0.25, 0.75, 0.75), true, 0.3),
      ],
    }),
  );
  const feathered = {
    centre: sample(0.5, 0.5),
    edge: sample(0.25, 0.5),
    outside: sample(0.02, 0.5),
  };

  // 5. A warped and masked surface together, left on screen for the shot.
  // The mask spans surface y 0.55..0.95, which is screen y 0.05..0.45, so it
  // sits inside the warped quadrant and its right edge cuts through it.
  paint(
    surface({
      warp: quadrantWarp,
      maskPaths: [
        createMaskPath(rectangleMaskNodes(0.05, 0.55, 0.4, 0.95), true, 0),
      ],
    }),
  );
  const combined = {
    insideBoth: sample(0.25, 0.25),
    // Inside the warped quadrant but past the mask edge.
    outsideMask: sample(0.46, 0.25),
  };

  return { identity, quadrants, masked, feathered, combined };
}

Reflect.set(globalThis, 'runSurfaceMapping', run);
