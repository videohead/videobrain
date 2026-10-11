import { useEffect, useRef, useState } from 'react';
import {
  Canvas,
  Circle as FabricCircle,
  Rect,
  Triangle as FabricTriangle,
  Polygon,
  PencilBrush,
  Color,
  loadSVGFromString,
  type FabricObject,
} from 'fabric';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  Download,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Star,
  Trash2,
  Triangle,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  MAX_VECTOR_BYTES,
  validateVectorArtwork,
} from '../graph/vectorArtwork';

interface Props {
  value: string;
  onApply: (artwork: string) => void;
  onCancel: () => void;
}

export default function VectorShapeEditor({ value, onApply, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasElement = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const restoring = useRef(false);
  const [historyState, setHistoryState] = useState({ index: -1, length: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [fill, setFill] = useState('#ff795c');
  const [stroke, setStroke] = useState('#f4f5f6');
  const [filled, setFilled] = useState(true);
  const [strokeWidth, setStrokeWidth] = useState(3);

  function snapshot() {
    const canvas = canvasRef.current;
    if (!canvas || restoring.current) return;
    const next = JSON.stringify(canvas.toJSON());
    if (history.current[historyIndex.current] === next) return;
    history.current = [
      ...history.current.slice(0, historyIndex.current + 1),
      next,
    ].slice(-30);
    historyIndex.current = history.current.length - 1;
    setHistoryState({
      index: historyIndex.current,
      length: history.current.length,
    });
  }

  useEffect(() => {
    const element = canvasElement.current;
    if (!element) return;
    dialogRef.current?.showModal();
    const canvas = new Canvas(element, {
      width: 512,
      height: 512,
      preserveObjectStacking: true,
    });
    canvasRef.current = canvas;
    let cancelled = false;
    const selectionChanged = () => {
      setSelectionCount(canvas.getActiveObjects().length);
      const object = canvas.getActiveObject();
      if (object && typeof object.fill === 'string' && object.fill)
        setFill(`#${new Color(object.fill).toHex()}`);
      if (object && typeof object.stroke === 'string' && object.stroke)
        setStroke(`#${new Color(object.stroke).toHex()}`);
      if (object) {
        setFilled(Boolean(object.fill));
        setStrokeWidth(object.strokeWidth);
      }
    };
    canvas.on('selection:created', selectionChanged);
    canvas.on('selection:updated', selectionChanged);
    canvas.on('selection:cleared', selectionChanged);
    canvas.on('object:modified', snapshot);
    canvas.on('path:created', snapshot);
    void Promise.resolve()
      .then(() => loadSVGFromString(validateVectorArtwork(value)))
      .then(({ objects }) => {
        if (cancelled) return;
        canvas.add(
          ...objects.filter(
            (object): object is FabricObject => object !== null,
          ),
        );
        canvas.requestRenderAll();
        snapshot();
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : 'The artwork could not be opened.',
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      canvasRef.current = null;
      void canvas.dispose();
    };
  }, [value]);

  function setMode(next: boolean) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = next;
    const brush = new PencilBrush(canvas);
    brush.color = stroke;
    brush.width = strokeWidth || 1;
    brush.decimate = 2;
    canvas.freeDrawingBrush = brush;
    setDrawing(next);
  }

  function changeStyle(style: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects()) object.set(style);
    if (canvas.freeDrawingBrush) {
      if (style.stroke !== undefined)
        canvas.freeDrawingBrush.color = style.stroke;
      if (style.strokeWidth !== undefined)
        canvas.freeDrawingBrush.width = style.strokeWidth || 1;
    }
    canvas.requestRenderAll();
    snapshot();
  }

  function add(kind: 'rectangle' | 'ellipse' | 'triangle' | 'star') {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.getObjects().length >= 128) {
      setError('Artwork is limited to 128 objects.');
      return;
    }
    setMode(false);
    const options = {
      left: 256,
      top: 256,
      originX: 'center' as const,
      originY: 'center' as const,
      fill: filled ? fill : '',
      stroke,
      strokeWidth,
    };
    const object =
      kind === 'rectangle'
        ? new Rect({ ...options, width: 180, height: 140 })
        : kind === 'ellipse'
          ? new FabricCircle({ ...options, radius: 90 })
          : kind === 'triangle'
            ? new FabricTriangle({ ...options, width: 180, height: 180 })
            : new Polygon(
                Array.from({ length: 10 }, (_, index) => {
                  const angle = (index * Math.PI) / 5 - Math.PI / 2;
                  const radius = index % 2 ? 42 : 100;
                  return {
                    x: Math.cos(angle) * radius,
                    y: Math.sin(angle) * radius,
                  };
                }),
                options,
              );
    canvas.add(object);
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    snapshot();
  }

  function removeSelection() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.remove(...canvas.getActiveObjects());
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    snapshot();
  }

  async function restore(direction: number) {
    const canvas = canvasRef.current;
    const index = historyIndex.current + direction;
    const saved = history.current[index];
    if (!canvas || !saved || restoring.current) return;
    restoring.current = true;
    setBusy(true);
    try {
      await canvas.loadFromJSON(saved);
      canvas.requestRenderAll();
      historyIndex.current = index;
      setHistoryState({ index, length: history.current.length });
      setSelectionCount(0);
    } catch {
      setError('The previous artwork state could not be restored.');
    } finally {
      restoring.current = false;
      setBusy(false);
    }
  }

  function artwork() {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('The editor is not ready.');
    return validateVectorArtwork(
      canvas.toSVG({
        suppressPreamble: true,
        viewBox: { x: 0, y: 0, width: 512, height: 512 },
      }),
    );
  }

  function apply() {
    try {
      onApply(artwork());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The artwork could not be saved.',
      );
    }
  }

  async function importArtwork(file: File) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      if (file.size > MAX_VECTOR_BYTES)
        throw new Error('SVG artwork exceeds the 150 KB limit.');
      const { objects } = await loadSVGFromString(
        validateVectorArtwork(await file.text()),
      );
      if (canvasRef.current !== canvas) return;
      canvas.clear();
      canvas.add(
        ...objects.filter((object): object is FabricObject => object !== null),
      );
      canvas.requestRenderAll();
      snapshot();
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'SVG import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="vector-editor-dialog"
      aria-labelledby="vector-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          busy
        )
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z'
        ) {
          event.preventDefault();
          void restore(event.shiftKey ? 1 : -1);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          removeSelection();
        } else if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          const canvas = canvasRef.current;
          const object = canvas?.getActiveObject();
          if (canvas && object) {
            const step = event.shiftKey ? 10 : 1;
            object.set({
              left:
                object.left +
                (event.key === 'ArrowRight'
                  ? step
                  : event.key === 'ArrowLeft'
                    ? -step
                    : 0),
              top:
                object.top +
                (event.key === 'ArrowDown'
                  ? step
                  : event.key === 'ArrowUp'
                    ? -step
                    : 0),
            });
            object.setCoords();
            canvas.requestRenderAll();
            snapshot();
          }
        }
      }}
    >
      <header className="vector-editor-header">
        <h2 id="vector-editor-title">Vector Shape</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Cancel artwork editing"
          title="Cancel"
          onClick={onCancel}
        >
          <X size={18} />
        </button>
      </header>
      <div
        className="vector-editor-tools"
        role="toolbar"
        aria-label="Drawing tools"
      >
        <button
          type="button"
          className="icon-button"
          title="Select and transform"
          aria-label="Select and transform"
          aria-pressed={!drawing}
          disabled={busy}
          onClick={() => setMode(false)}
        >
          <MousePointer2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Freehand"
          aria-label="Freehand"
          aria-pressed={drawing}
          disabled={busy}
          onClick={() => setMode(true)}
        >
          <Pencil size={18} />
        </button>
        {(
          [
            { kind: 'rectangle', icon: Square },
            { kind: 'ellipse', icon: Circle },
            { kind: 'triangle', icon: Triangle },
            { kind: 'star', icon: Star },
          ] as const
        ).map(({ kind, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            className="icon-button"
            title={`Add ${kind}`}
            aria-label={`Add ${kind}`}
            disabled={busy}
            onClick={() => add(kind)}
          >
            <Icon size={18} />
          </button>
        ))}
        <button
          type="button"
          className="icon-button"
          title="Undo artwork edit"
          aria-label="Undo artwork edit"
          disabled={busy || historyState.index <= 0}
          onClick={() => void restore(-1)}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Redo artwork edit"
          aria-label="Redo artwork edit"
          disabled={busy || historyState.index >= historyState.length - 1}
          onClick={() => void restore(1)}
        >
          <Redo2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Delete selection"
          aria-label="Delete selection"
          disabled={busy || !selectionCount}
          onClick={removeSelection}
        >
          <Trash2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Bring forward"
          aria-label="Bring forward"
          disabled={busy || !selectionCount}
          onClick={() => {
            const canvas = canvasRef.current;
            canvas
              ?.getActiveObjects()
              .forEach((object) => canvas.bringObjectForward(object));
            canvas?.requestRenderAll();
            snapshot();
          }}
        >
          <ArrowUp size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Send backward"
          aria-label="Send backward"
          disabled={busy || !selectionCount}
          onClick={() => {
            const canvas = canvasRef.current;
            canvas
              ?.getActiveObjects()
              .forEach((object) => canvas.sendObjectBackwards(object));
            canvas?.requestRenderAll();
            snapshot();
          }}
        >
          <ArrowDown size={18} />
        </button>
      </div>
      <fieldset className="vector-editor-paint" disabled={busy}>
        <label>
          <input
            type="checkbox"
            checked={filled}
            onChange={(event) => {
              setFilled(event.target.checked);
              changeStyle({ fill: event.target.checked ? fill : '' });
            }}
          />{' '}
          Fill
        </label>
        <input
          type="color"
          aria-label="Fill color"
          value={fill}
          disabled={!filled}
          onChange={(event) => {
            setFill(event.target.value);
            changeStyle({ fill: event.target.value });
          }}
        />
        <label>
          Stroke{' '}
          <input
            type="color"
            aria-label="Stroke color"
            value={stroke}
            onChange={(event) => {
              setStroke(event.target.value);
              changeStyle({ stroke: event.target.value });
            }}
          />
        </label>
        <label>
          Width{' '}
          <input
            type="number"
            aria-label="Stroke width"
            min={0}
            max={64}
            step={1}
            value={strokeWidth}
            onChange={(event) => {
              const next = Math.max(
                0,
                Math.min(64, Number(event.target.value)),
              );
              setStrokeWidth(next);
              changeStyle({ strokeWidth: next });
            }}
          />
        </label>
      </fieldset>
      <div className="vector-editor-stage">
        <canvas ref={canvasElement} aria-label="Vector drawing canvas" />
      </div>
      {busy && <p role="status">Loading artwork...</p>}
      {error && (
        <p className="vector-error" role="alert">
          {error}
        </p>
      )}
      <footer className="vector-editor-footer">
        <button
          type="button"
          className="icon-button"
          title="Import SVG"
          aria-label="Import SVG into editor"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Export SVG"
          aria-label="Export SVG"
          disabled={busy}
          onClick={() => {
            try {
              const url = URL.createObjectURL(
                new Blob([artwork()], { type: 'image/svg+xml' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'videobrain-shape.svg';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : 'SVG export failed.',
              );
            }
          }}
        >
          <Download size={18} />
        </button>
        <span className="vector-editor-spacer" />
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={apply}
        >
          <Check size={16} /> Apply artwork
        </button>
      </footer>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="Editor SVG file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importArtwork(file);
        }}
      />
    </dialog>
  );
}
