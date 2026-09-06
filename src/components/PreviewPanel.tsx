import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Maximize2 } from 'lucide-react';
import type { GraphDocument } from '../graph';
import {
  FRAME_PACING_OPTIONS,
  FramePacer,
  WebGLRenderer,
  type AudioAnalysisFrame,
  type AudioAnalysisSnapshot,
  type FramePacingMode,
  type RenderPointer,
  type RenderResult,
} from '../engine';
import type { AudioInputState } from '../hooks/useAudioLevel';
import type { VideoInputState } from '../hooks/useVideoInput';

interface PreviewPanelProps {
  document: GraphDocument;
  playing: boolean;
  resetToken: number;
  audioInputState: AudioInputState;
  videoInputState: VideoInputState;
  videoSource: HTMLVideoElement | HTMLImageElement | null;
  videoModelSources: ReadonlyMap<string, HTMLImageElement>;
  meterLevel: number;
  sampleAudio: (
    timeSeconds: number,
  ) => AudioAnalysisFrame | AudioAnalysisSnapshot;
  onRuntimeUpdate: (result: RenderResult | null) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

interface MeasuredCanvasSize {
  width: number;
  height: number;
}

export function PreviewPanel({
  document,
  playing,
  resetToken,
  audioInputState,
  videoInputState,
  videoSource,
  videoModelSources,
  meterLevel,
  sampleAudio,
  onRuntimeUpdate,
  onNotify,
}: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const animationRef = useRef(0);
  const framePacerRef = useRef(new FramePacer('display'));
  const elapsedRef = useRef(0);
  const previousTimestampRef = useRef<number | null>(null);
  const pointerRef = useRef<RenderPointer>({
    x: 0.5,
    y: 0.5,
    down: 0,
    press: 0,
    release: 0,
  });
  const publishTimestampRef = useRef(0);
  const playingRef = useRef(playing);
  const videoModelSourcesRef = useRef(videoModelSources);
  const measuredCanvasSizeRef = useRef<MeasuredCanvasSize | null>(null);
  const modelSourceNeedsRetryRef = useRef(false);
  const resizeNeedsRetryRef = useRef(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [graphSyncError, setGraphSyncError] = useState<string | null>(null);
  const [videoSourceError, setVideoSourceError] = useState<string | null>(null);
  const [modelSourceError, setModelSourceError] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RenderResult | null>(null);
  const [framePacing, setFramePacing] =
    useState<FramePacingMode>('display');

  const publishResult = useCallback(
    (result: RenderResult, force = false) => {
      const now = performance.now();
      if (!force && now - publishTimestampRef.current < 180) {
        return;
      }
      publishTimestampRef.current = now;
      setRuntime(result);
      onRuntimeUpdate(result);
      setRenderError(result.error);
    },
    [onRuntimeUpdate],
  );

  const renderOnce = useCallback(
    (forcePublish = false, presentationTimestamp?: number) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      const audio = sampleAudio(elapsedRef.current);
      const result = renderer.render(
        elapsedRef.current,
        audio,
        pointerRef.current,
        presentationTimestamp,
      );
      pointerRef.current = {
        ...pointerRef.current,
        press: 0,
        release: 0,
      };
      publishResult(result, forcePublish);
    },
    [publishResult, sampleAudio],
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const renderIfHeld = useCallback(() => {
    if (!playingRef.current) {
      renderOnce(true);
    }
  }, [renderOnce]);

  useEffect(() => {
    videoModelSourcesRef.current = videoModelSources;
  }, [videoModelSources]);

  const applyVideoModelSources = useCallback(
    (renderer: WebGLRenderer) => {
      try {
        renderer.setVideoModelSources(videoModelSourcesRef.current);
        modelSourceNeedsRetryRef.current = false;
        queueMicrotask(() => setModelSourceError(null));
        return true;
      } catch (caught) {
        modelSourceNeedsRetryRef.current = true;
        const message =
          caught instanceof Error
            ? caught.message
            : 'The generated frame could not be loaded.';
        queueMicrotask(() => setModelSourceError(message));
        onNotify(message, 'error');
        return false;
      }
    },
    [onNotify],
  );

  const applyMeasuredCanvasSize = useCallback(
    (renderer: WebGLRenderer) => {
      const size = measuredCanvasSizeRef.current;
      if (!size) {
        return false;
      }
      try {
        renderer.resize(size.width, size.height, window.devicePixelRatio);
        resizeNeedsRetryRef.current = false;
        setResizeError(null);
        return true;
      } catch (caught) {
        resizeNeedsRetryRef.current = true;
        const message =
          caught instanceof Error
            ? caught.message
            : 'The monitor could not resize its GPU buffers.';
        setResizeError(message);
        onNotify(message, 'error');
        return false;
      }
    },
    [onNotify],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    try {
      const renderer = new WebGLRenderer(canvas, { maxPixelRatio: 1.5 });
      rendererRef.current = renderer;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to start the renderer.';
      queueMicrotask(() => {
        setRenderError(message);
        onRuntimeUpdate(null);
      });
    }

    return () => {
      cancelAnimationFrame(animationRef.current);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [onRuntimeUpdate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderHeldContextChange = () => renderIfHeld();
    canvas.addEventListener('webglcontextlost', renderHeldContextChange);
    canvas.addEventListener('webglcontextrestored', renderHeldContextChange);
    return () => {
      canvas.removeEventListener('webglcontextlost', renderHeldContextChange);
      canvas.removeEventListener('webglcontextrestored', renderHeldContextChange);
    };
  }, [renderIfHeld]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    try {
      renderer.setGraph(document);
      if (resizeNeedsRetryRef.current) {
        applyMeasuredCanvasSize(renderer);
      }
      if (modelSourceNeedsRetryRef.current) {
        applyVideoModelSources(renderer);
      }
      renderIfHeld();
      queueMicrotask(() => setGraphSyncError(null));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The graph could not be compiled.';
      queueMicrotask(() => setGraphSyncError(message));
      onNotify(message, 'error');
    }
  }, [
    applyMeasuredCanvasSize,
    applyVideoModelSources,
    document,
    onNotify,
    renderIfHeld,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    try {
      renderer.setVideoSource(videoSource);
      renderIfHeld();
      queueMicrotask(() => setVideoSourceError(null));
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'The live video source could not be loaded.';
      queueMicrotask(() => setVideoSourceError(message));
      onNotify(message, 'error');
    }
  }, [onNotify, renderIfHeld, videoSource]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    if (applyVideoModelSources(renderer)) {
      renderIfHeld();
    }
  }, [applyVideoModelSources, renderIfHeld, videoModelSources]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      measuredCanvasSizeRef.current = { width, height };
      if (applyMeasuredCanvasSize(renderer)) {
        renderIfHeld();
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [applyMeasuredCanvasSize, renderIfHeld]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    elapsedRef.current = 0;
    previousTimestampRef.current = null;
    framePacerRef.current.reset();
    renderer.reset();
    renderIfHeld();
  }, [renderIfHeld, resetToken]);

  useEffect(() => {
    framePacerRef.current.setMode(framePacing);
    rendererRef.current?.resetFrameRate();
  }, [framePacing]);

  useEffect(() => {
    cancelAnimationFrame(animationRef.current);
    previousTimestampRef.current = null;
    framePacerRef.current.reset();
    rendererRef.current?.resetFrameRate();

    if (!playing || !rendererRef.current) {
      renderOnce(true);
      return;
    }

    const tick = (timestamp: number) => {
      const previous = previousTimestampRef.current;
      previousTimestampRef.current = timestamp;
      if (previous !== null) {
        elapsedRef.current += Math.max(0, (timestamp - previous) / 1000);
      }
      if (framePacerRef.current.shouldRender(timestamp)) {
        renderOnce(false, timestamp);
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [playing, renderOnce]);

  const updatePointerPosition = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      ...pointerRef.current,
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const renderPointerChange = () => {
    if (!playing) {
      renderOnce(true);
    }
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    updatePointerPosition(event);
    if (event.button !== 0) {
      renderPointerChange();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      ...pointerRef.current,
      down: 1,
      press: 1,
    };
    renderPointerChange();
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    updatePointerPosition(event);
    if (pointerRef.current.down > 0) {
      pointerRef.current = {
        ...pointerRef.current,
        down: 0,
        release: 1,
      };
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    renderPointerChange();
  };

  const handlePointerCancel = () => {
    if (pointerRef.current.down > 0) {
      pointerRef.current = {
        ...pointerRef.current,
        down: 0,
        release: 1,
      };
    }
    renderPointerChange();
  };

  const saveFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        onNotify('The current frame could not be captured.', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `videobrain-frame-${new Date().toISOString().replaceAll(':', '-')}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      onNotify('Frame exported as PNG.', 'success');
    }, 'image/png');
  };

  const enterFullscreen = async () => {
    const canvas = canvasRef.current;
    if (!canvas?.requestFullscreen) {
      onNotify('Fullscreen is unavailable in this browser.', 'error');
      return;
    }
    try {
      await canvas.requestFullscreen();
    } catch {
      onNotify('Fullscreen could not be opened.', 'error');
    }
  };

  const error =
    graphSyncError ??
    videoSourceError ??
    modelSourceError ??
    resizeError ??
    renderError;

  return (
    <section className="preview-panel" aria-label="Live output">
      <header className="preview-header">
        <div>
          <div className="panel-eyebrow">Monitor</div>
          <div className="panel-title">Live output</div>
        </div>
        <div className="preview-meta">
          <AudioMeter value={meterLevel} />
          <span className="runtime-pill">{playing ? 'running' : 'held'}</span>
          <label
            className="preview-rate-control"
            title="Follow the display refresh or cap monitor rendering to a fixed cadence."
          >
            <span className="sr-only">Monitor frame pacing</span>
            <select
              aria-label="Monitor frame pacing"
              value={framePacing}
              onChange={(event) =>
                setFramePacing(event.currentTarget.value as FramePacingMode)
              }
            >
              {FRAME_PACING_OPTIONS.map((option) => (
                <option
                  value={option.value}
                  title={option.description}
                  key={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="icon-button" onClick={saveFrame} title="Export PNG">
            <Camera size={14} />
            <span className="sr-only">Export current frame</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void enterFullscreen()}
            title="Fullscreen output"
          >
            <Maximize2 size={14} />
            <span className="sr-only">Open output fullscreen</span>
          </button>
        </div>
      </header>
      <div className="preview-surface">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          data-rendered={runtime?.rendered ?? false}
          data-frame={runtime?.frame ?? 0}
          data-frame-pacing={framePacing}
          onPointerMove={(event) => {
            updatePointerPosition(event);
            renderPointerChange();
          }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label="Rendered visual output. Move, press, and release here to drive pointer signals."
        />
        {error ? (
          <div className="preview-error" role="alert">
            <strong>Output unavailable</strong>
            <span>{error}</span>
          </div>
        ) : null}
        {!runtime && !error ? <div className="preview-loading">Starting GPU runtime…</div> : null}
        {runtime ? (
          <div className="preview-hud">
            <span>{runtime.width}×{runtime.height}</span>
            <span>·</span>
            <span>{runtime.passCount} passes</span>
            <span>·</span>
            <span title="GPU frames rendered on the monitor clock">
              {Math.round(runtime.fps)} render fps
            </span>
            {audioInputState === 'live' ? <><span>·</span><span>mic</span></> : null}
            {videoInputState === 'live' ? <><span>·</span><span>camera</span></> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AudioMeter({ value }: { value: number }) {
  const activeBars = Math.round(Math.min(1, Math.max(0, value)) * 8);
  return (
    <span className="audio-meter" aria-label={`Audio level ${Math.round(value * 100)} percent`}>
      {Array.from({ length: 8 }, (_, index) => (
        <i
          className={index < activeBars ? 'active' : ''}
          style={{ height: `${5 + index * 1.25}px` }}
          key={index}
        />
      ))}
    </span>
  );
}
