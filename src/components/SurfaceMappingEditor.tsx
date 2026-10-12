import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Grid3x3,
  Lock,
  LockOpen,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCcw,
  Scissors,
  Spline,
  Trash2,
  Undo2,
} from 'lucide-react';

import type { OutputLayout, SurfaceLayout } from '../store/contracts';
import { MAX_SURFACE_MESH_SPAN, meshVertexUv } from '../engine/surfaceLayout';
import {
  createMaskPath,
  fitFreehandNodes,
  rectangleMaskNodes,
} from '../engine/surfaceMask';
import { drawSurface } from '../engine/surfaceRaster';
import {
  addMaskPath,
  canRedo,
  canUndo,
  clearSelection,
  isLocked,
  moveSelection,
  nudgeSelection,
  redo,
  removeMaskPath,
  resetSurfaceMasks,
  resetSurfaceMesh,
  sameSelection,
  selectElement,
  setMaskFeather,
  setMeshResolution,
  toggleSurfaceLock,
  undo,
  type EditorSelection,
  type SurfaceEditorState,
} from '../engine/surfaceEditor';

export type MappingTool = 'select' | 'mask' | 'freehand';

export interface MappingSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

interface Props {
  state: SurfaceEditorState;
  surfaceId: string;
  onChange: (state: SurfaceEditorState) => void;
  /** Frame sampled by the surface. Omitted renders geometry only. */
  source?: MappingSource;
  /** Hides every editing affordance, leaving the mapped frame alone. */
  cleanOutput?: boolean;
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 270;

const findSurface = (
  outputs: readonly OutputLayout[],
  surfaceId: string,
): SurfaceLayout | undefined => {
  for (const output of outputs) {
    const match = output.surfaces.find(({ id }) => id === surfaceId);
    if (match) return match;
  }
  return undefined;
};

/** Surface UV (y-up) to overlay pixels (y-down). */
const toOverlay = (
  uv: { u: number; v: number },
  width: number,
  height: number,
) => ({ x: uv.u * width, y: (1 - uv.v) * height });

export function SurfaceMappingEditor({
  state,
  surfaceId,
  onChange,
  source,
  cleanOutput = false,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ pointerId: number; u: number; v: number } | null>(
    null,
  );
  const stroke = useRef<{ x: number; y: number }[]>([]);
  const drawn = useRef(false);
  const [tool, setTool] = useState<MappingTool>('select');
  const [calibration, setCalibration] = useState(false);
  const [strokePreview, setStrokePreview] = useState('');

  const surface = findSurface(state.outputs, surfaceId);
  const locked = isLocked(state, surfaceId);
  const warp = surface?.warp ?? null;

  // Redraw the mapped frame whenever the geometry or the source changes.
  // The context is only acquired once there is something to draw, so a
  // headless environment is never asked for one it cannot provide.
  useEffect(() => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !surface || (!source && !drawn.current)) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawn.current = false;
    if (!source) return;
    drawn.current = true;
    const maskContext = maskCanvas?.getContext('2d') ?? null;
    drawSurface(context, surface, {
      source: source.image,
      sourceSize: { width: source.width, height: source.height },
      destinationSize: { width: canvas.width, height: canvas.height },
      ...(maskCanvas && maskContext
        ? { mask: { context: maskContext, canvas: maskCanvas } }
        : {}),
    });
  }, [surface, source, width, height]);

  const pointerToUv = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = surfaceRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        u: (clientX - bounds.left) / bounds.width,
        v: 1 - (clientY - bounds.top) / bounds.height,
      };
    },
    [],
  );

  const isSelected = (selection: EditorSelection): boolean =>
    state.selection.some((entry) => sameSelection(entry, selection));

  const meshVertices = useMemo(() => {
    if (!warp) return [];
    const vertices: {
      row: number;
      col: number;
      x: number;
      y: number;
    }[] = [];
    for (let row = 0; row <= warp.rows; row += 1) {
      for (let col = 0; col <= warp.cols; col += 1) {
        const point = toOverlay(meshVertexUv(warp, row, col), width, height);
        vertices.push({ row, col, x: point.x, y: point.y });
      }
    }
    return vertices;
  }, [warp, width, height]);

  const meshEdges = useMemo(() => {
    if (!warp) return [] as string[];
    const lines: string[] = [];
    for (let row = 0; row <= warp.rows; row += 1) {
      const points = Array.from({ length: warp.cols + 1 }, (_, col) => {
        const point = toOverlay(meshVertexUv(warp, row, col), width, height);
        return `${point.x},${point.y}`;
      });
      lines.push(points.join(' '));
    }
    for (let col = 0; col <= warp.cols; col += 1) {
      const points = Array.from({ length: warp.rows + 1 }, (_, row) => {
        const point = toOverlay(meshVertexUv(warp, row, col), width, height);
        return `${point.x},${point.y}`;
      });
      lines.push(points.join(' '));
    }
    return lines;
  }, [warp, width, height]);

  // Handles only start a drag. Move and release are owned by the overlay so
  // one gesture is never applied twice from two stale closures of `state`.
  function beginDrag(
    event: React.PointerEvent,
    selection: EditorSelection,
  ): void {
    if (locked || cleanOutput) return;
    event.stopPropagation();
    const uv = pointerToUv(event.clientX, event.clientY);
    if (!uv) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = { pointerId: event.pointerId, ...uv };
    onChange(selectElement(state, selection, event.shiftKey));
  }

  function continueDrag(event: React.PointerEvent): void {
    const active = dragging.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const uv = pointerToUv(event.clientX, event.clientY);
    if (!uv) return;
    const next = moveSelection(state, uv.u - active.u, uv.v - active.v);
    // A refused move keeps the anchor so the handle can return to a valid spot.
    if (next.outputs !== state.outputs) {
      dragging.current = { pointerId: event.pointerId, ...uv };
    }
    onChange(next);
  }

  function endDrag(event: React.PointerEvent): void {
    if (dragging.current?.pointerId === event.pointerId) {
      dragging.current = null;
    }
    if (stroke.current.length > 0) {
      commitStroke();
    }
  }

  function commitStroke(): void {
    const samples = stroke.current;
    stroke.current = [];
    setStrokePreview('');
    if (samples.length < 3 || !surface) return;
    const nodes = fitFreehandNodes(samples, { closed: true, tolerance: 0.008 });
    if (nodes.length < 3) return;
    onChange(addMaskPath(state, surfaceId, createMaskPath(nodes, true, 0.05)));
  }

  function onSurfacePointerDown(event: React.PointerEvent): void {
    if (cleanOutput || locked) return;
    if (tool === 'select') {
      onChange(clearSelection(state));
      return;
    }
    if (tool === 'mask') {
      onChange(
        addMaskPath(
          state,
          surfaceId,
          createMaskPath(rectangleMaskNodes(0.3, 0.3, 0.7, 0.7), true, 0.05),
        ),
      );
      setTool('select');
      return;
    }
    const uv = pointerToUv(event.clientX, event.clientY);
    if (!uv) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = { pointerId: event.pointerId, ...uv };
    stroke.current = [{ x: uv.u, y: uv.v }];
  }

  function onSurfacePointerMove(event: React.PointerEvent): void {
    if (tool === 'freehand' && dragging.current) {
      const uv = pointerToUv(event.clientX, event.clientY);
      if (!uv) return;
      stroke.current = [...stroke.current, { x: uv.u, y: uv.v }];
      setStrokePreview(
        stroke.current
          .map((point) => {
            const overlay = toOverlay(
              { u: point.x, v: point.y },
              width,
              height,
            );
            return `${overlay.x},${overlay.y}`;
          })
          .join(' '),
      );
      return;
    }
    continueDrag(event);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (cleanOutput) return;
    const directions: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      onChange(nudgeSelection(state, direction, event.shiftKey));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onChange(clearSelection(state));
    }
  }

  if (!surface) {
    return (
      <p className="surface-mapping-empty" role="status">
        No surface selected
      </p>
    );
  }

  const maskPaths = surface.maskPaths;
  const selectedMask = state.selection.find(
    (entry): entry is Extract<EditorSelection, { kind: 'mask-node' }> =>
      entry.kind === 'mask-node',
  );
  const activeMaskIndex = selectedMask?.maskIndex ?? (maskPaths.length - 1);
  const activeMask = maskPaths[activeMaskIndex];

  return (
    <div
      className="surface-mapping-editor nodrag nopan nowheel"
      data-clean={cleanOutput ? 'true' : 'false'}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!cleanOutput && (
        <div className="surface-mapping-toolbar" role="toolbar" aria-label="Mapping tools">
          <div className="surface-mapping-group" role="group" aria-label="Tool">
            {(
              [
                ['select', 'Select and warp', MousePointer2],
                ['mask', 'Add mask', Scissors],
                ['freehand', 'Draw mask', Pencil],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className="icon-button"
                title={label}
                aria-label={label}
                aria-pressed={tool === id}
                disabled={locked}
                onClick={() => setTool(id)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          <label className="surface-mapping-field">
            <span>Mesh</span>
            <input
              type="number"
              min={1}
              max={MAX_SURFACE_MESH_SPAN}
              step={1}
              value={warp?.rows ?? 1}
              aria-label="Mesh resolution"
              disabled={locked}
              onChange={(event) => {
                const span = Number(event.target.value);
                if (!Number.isFinite(span)) return;
                onChange(setMeshResolution(state, surfaceId, span, span));
              }}
            />
          </label>

          <label className="surface-mapping-field">
            <span>Feather</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={activeMask?.feather ?? 0}
              aria-label="Mask feather"
              disabled={locked || !activeMask}
              onChange={(event) =>
                onChange(
                  setMaskFeather(
                    state,
                    surfaceId,
                    activeMaskIndex,
                    Number(event.target.value),
                  ),
                )
              }
            />
          </label>

          <div className="surface-mapping-group" role="group" aria-label="Layout">
            <button
              type="button"
              className="icon-button"
              title={locked ? 'Unlock surface' : 'Lock surface'}
              aria-label={locked ? 'Unlock surface' : 'Lock surface'}
              aria-pressed={locked}
              onClick={() => onChange(toggleSurfaceLock(state, surfaceId))}
            >
              {locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button
              type="button"
              className="icon-button"
              title="Calibration pattern"
              aria-label="Calibration pattern"
              aria-pressed={calibration}
              onClick={() => setCalibration((value) => !value)}
            >
              <Grid3x3 size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Reset mesh"
              aria-label="Reset mesh"
              disabled={locked || !warp}
              onClick={() => onChange(resetSurfaceMesh(state, surfaceId))}
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Remove masks"
              aria-label="Remove masks"
              disabled={locked || maskPaths.length === 0}
              onClick={() => onChange(resetSurfaceMasks(state, surfaceId))}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="surface-mapping-group" role="group" aria-label="History">
            <button
              type="button"
              className="icon-button"
              title="Undo"
              aria-label="Undo"
              disabled={!canUndo(state)}
              onClick={() => onChange(undo(state))}
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Redo"
              aria-label="Redo"
              disabled={!canRedo(state)}
              onClick={() => onChange(redo(state))}
            >
              <Redo2 size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="surface-mapping-stage" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          className="surface-mapping-frame"
          width={width}
          height={height}
          aria-label="Mapped frame"
        />
        <canvas
          ref={maskCanvasRef}
          className="sr-only"
          width={width}
          height={height}
          aria-hidden="true"
        />
        {!cleanOutput && (
          <svg
            ref={surfaceRef}
            className="surface-mapping-overlay"
            viewBox={`0 0 ${width} ${height}`}
            role="application"
            aria-label="Surface mapping editor"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onSurfacePointerDown}
            onPointerMove={onSurfacePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {calibration && (
              <g className="surface-mapping-calibration" aria-hidden="true">
                {Array.from({ length: 9 }, (_, index) => (
                  <line
                    key={`v${index}`}
                    x1={((index + 1) * width) / 10}
                    y1={0}
                    x2={((index + 1) * width) / 10}
                    y2={height}
                  />
                ))}
                {Array.from({ length: 5 }, (_, index) => (
                  <line
                    key={`h${index}`}
                    x1={0}
                    y1={((index + 1) * height) / 6}
                    x2={width}
                    y2={((index + 1) * height) / 6}
                  />
                ))}
                <rect x={1} y={1} width={width - 2} height={height - 2} />
              </g>
            )}

            {meshEdges.map((points, index) => (
              <polyline
                key={`edge-${index}`}
                className="surface-mapping-mesh"
                points={points}
              />
            ))}

            {maskPaths.map((path, maskIndex) => (
              <polygon
                key={`mask-${maskIndex}`}
                className="surface-mapping-mask"
                points={path.points
                  .map((point) => {
                    const overlay = toOverlay(
                      { u: point.x, v: point.y },
                      width,
                      height,
                    );
                    return `${overlay.x},${overlay.y}`;
                  })
                  .join(' ')}
              />
            ))}

            {strokePreview && (
              <polyline
                className="surface-mapping-stroke"
                points={strokePreview}
              />
            )}

            {meshVertices.map((vertex) => {
              const selection: EditorSelection = {
                kind: 'mesh-vertex',
                surfaceId,
                row: vertex.row,
                col: vertex.col,
              };
              return (
                <circle
                  key={`vertex-${vertex.row}-${vertex.col}`}
                  className="surface-mapping-handle"
                  data-selected={isSelected(selection) ? 'true' : 'false'}
                  cx={vertex.x}
                  cy={vertex.y}
                  r={6}
                  role="button"
                  tabIndex={-1}
                  aria-label={`Mesh vertex ${vertex.row}, ${vertex.col}`}
                  onPointerDown={(event) => beginDrag(event, selection)}
                />
              );
            })}

            {maskPaths.map((path, maskIndex) =>
              (path.nodes ?? []).map((node, nodeIndex) => {
                const selection: EditorSelection = {
                  kind: 'mask-node',
                  surfaceId,
                  maskIndex,
                  nodeIndex,
                };
                const overlay = toOverlay(
                  { u: node.point.x, v: node.point.y },
                  width,
                  height,
                );
                return (
                  <rect
                    key={`node-${maskIndex}-${nodeIndex}`}
                    className="surface-mapping-node"
                    data-selected={isSelected(selection) ? 'true' : 'false'}
                    x={overlay.x - 5}
                    y={overlay.y - 5}
                    width={10}
                    height={10}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Mask ${maskIndex + 1} node ${nodeIndex + 1}`}
                    onPointerDown={(event) => beginDrag(event, selection)}
                  />
                );
              }),
            )}
          </svg>
        )}
      </div>

      {!cleanOutput && (
        <div className="surface-mapping-status">
          <span role="status">
            {locked
              ? 'Surface locked'
              : `${meshVertices.length} points, ${maskPaths.length} masks`}
          </span>
          {maskPaths.length > 0 && (
            <button
              type="button"
              className="text-button"
              disabled={locked}
              onClick={() =>
                onChange(removeMaskPath(state, surfaceId, activeMaskIndex))
              }
            >
              <Spline size={12} /> Remove mask {activeMaskIndex + 1}
            </button>
          )}
          {state.errors.length > 0 && (
            <p className="surface-mapping-error" role="alert">
              {state.errors[0]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
