import { useContext } from 'react';
import {
  FileImage,
  Mic2,
  Pause,
  Play,
  Square,
  Video,
  Volume2,
} from 'lucide-react';
import type { GraphParamValue, NodeKind } from '../graph';
import type { AudioInputState } from '../hooks/useAudioLevel';
import type {
  VideoFacingMode,
  VideoInputState,
} from '../hooks/useVideoInput';
import {
  OperatorInputRuntimeContext,
  type OperatorInputRuntime,
} from './operatorInputRuntime';

export type { OperatorInputRuntime } from './operatorInputRuntime';

interface NodeMediaControlsProps {
  kind: NodeKind;
  params: Record<string, GraphParamValue>;
  runtime?: OperatorInputRuntime;
  onSelect: () => void;
}

function clampLevel(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function audioStatus(state: AudioInputState): string {
  switch (state) {
    case 'live':
      return 'MIC LIVE';
    case 'requesting':
      return 'REQUESTING';
    case 'unavailable':
      return 'UNAVAILABLE';
    default:
      return 'DEMO';
  }
}

function videoStatus(
  state: VideoInputState,
  facingMode: VideoFacingMode,
): string {
  switch (state) {
    case 'live':
      return facingMode === 'environment' ? 'rear live' : 'front live';
    case 'requesting':
      return 'requesting';
    case 'denied':
      return 'blocked';
    case 'unavailable':
      return 'unavailable';
    case 'error':
      return 'input error';
    default:
      return 'camera off';
  }
}

function formatMediaTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export function NodeMediaControls({
  kind,
  params,
  runtime: runtimeOverride,
  onSelect,
}: NodeMediaControlsProps) {
  const contextualRuntime = useContext(OperatorInputRuntimeContext);
  const runtime = runtimeOverride ?? contextualRuntime;

  if (!runtime) {
    return null;
  }

  if (kind === 'audioLevel') {
    const gain = typeof params.gain === 'number' ? params.gain : 1.5;
    const floor = typeof params.floor === 'number' ? params.floor : 0.02;
    const rawLevel = clampLevel(runtime.audio.meterLevel);
    const level = clampLevel((rawLevel - floor) * gain);
    const percentage = Math.round(level * 100);
    const live = runtime.audio.inputState === 'live';
    const requesting = runtime.audio.inputState === 'requesting';
    return (
      <section
        className="node-input-runtime nodrag nopan nowheel"
        aria-label="Audio input controls"
      >
        <div className="node-input-readout">
          <div className="node-input-label">
            <span
              className={`node-input-state ${live ? 'is-live' : ''}`}
              aria-live="polite"
            >
              <i aria-hidden="true" />
              {audioStatus(runtime.audio.inputState)}
            </span>
            <span>control out</span>
          </div>
          <div
            className="node-level-meter"
            role="meter"
            aria-label={`${live ? 'Microphone' : 'Demo'} control output level`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            aria-valuetext={`${percentage} percent`}
          >
            <i
              style={{ '--meter-level': `${percentage}%` } as React.CSSProperties}
            />
          </div>
        </div>
        <button
          type="button"
          className={`node-input-button ${live ? 'is-stop' : ''}`}
          disabled={requesting}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            if (live) {
              runtime.audio.disable();
            } else {
              void runtime.audio.enable();
            }
          }}
        >
          <Mic2 aria-hidden="true" />
          {live ? 'Stop mic' : requesting ? 'Requesting…' : 'Start mic'}
        </button>
        <p className="node-input-hint">
          {live
            ? 'Level → control, not speakers · Stop → demo'
            : 'Level → control · no speaker output'}
        </p>
      </section>
    );
  }

  if (kind === 'videoInput') {
    const live = runtime.video.inputState === 'live';
    const requesting = runtime.video.inputState === 'requesting';
    return (
      <section
        className="node-input-runtime nodrag nopan nowheel"
        aria-label="Camera input controls"
      >
        <span
          className={`node-input-state ${live ? 'is-live' : ''}`}
          aria-live="polite"
          aria-label={
            runtime.video.errorMessage ??
            videoStatus(runtime.video.inputState, runtime.video.facingMode)
          }
          title={runtime.video.errorMessage ?? undefined}
        >
          <i aria-hidden="true" />
          {videoStatus(runtime.video.inputState, runtime.video.facingMode)}
        </span>
        <button
          type="button"
          className={`node-input-button ${live ? 'is-stop' : ''}`}
          disabled={requesting}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            if (live) {
              runtime.video.disable();
            } else {
              void runtime.video.enable(
                params.facing === 'environment' ? 'environment' : 'user',
              );
            }
          }}
        >
          <Video aria-hidden="true" />
          {live ? 'Stop camera' : requesting ? 'Requesting…' : 'Start camera'}
        </button>
      </section>
    );
  }

  if (kind === 'file') {
    const selected = Boolean(runtime.file.source);
    return (
      <section
        className="node-input-runtime nodrag nopan nowheel"
        aria-label="Local file input controls"
      >
        <span
          className={`node-input-state ${selected ? 'is-live' : ''}`}
          aria-live="polite"
          title={runtime.file.errorMessage ?? undefined}
        >
          <i aria-hidden="true" />
          {runtime.file.errorMessage ?? (selected ? runtime.file.name : 'no file selected')}
        </span>
        <button
          type="button"
          className="node-input-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            runtime.file.choose();
          }}
        >
          <FileImage aria-hidden="true" />
          Choose file
        </button>
        {selected ? (
          runtime.file.isVideo || runtime.file.isAudio ? (
            <>
              <div className="node-file-progress">
                <input
                  type="range"
                  min={0}
                  max={runtime.file.duration || 0}
                  step={0.01}
                  value={Math.min(runtime.file.currentTime, runtime.file.duration || 0)}
                  aria-label="File playback position"
                  disabled={!runtime.file.duration}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => runtime.file.seek(Number(event.target.value))}
                />
                <span>
                  {formatMediaTime(runtime.file.currentTime)} / {formatMediaTime(runtime.file.duration)}
                </span>
              </div>
              <div className="node-file-actions">
                <button
                  type="button"
                  className="node-input-button"
                  aria-label={runtime.file.isPlaying ? 'Pause file' : 'Play file'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                    if (runtime.file.isPlaying) {
                      runtime.file.pause();
                    } else {
                      runtime.file.play();
                    }
                  }}
                >
                  {runtime.file.isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {runtime.file.isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  className="node-input-button"
                  aria-label="Stop file"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                    runtime.file.stop();
                  }}
                >
                  <Square aria-hidden="true" />
                  Stop
                </button>
              </div>
              {runtime.file.audioAvailable ? (
                <div className="node-file-meter">
                  <span>audio level</span>
                  <div
                    className="node-level-meter"
                    role="meter"
                    aria-label="File audio SPL meter (relative dBFS)"
                    aria-valuemin={-60}
                    aria-valuemax={0}
                    aria-valuenow={Math.round(runtime.file.meterDecibels)}
                    aria-valuetext={`${Math.round(runtime.file.meterDecibels)} dBFS`}
                  >
                    <i style={{ '--meter-level': `${runtime.file.meterLevel * 100}%` } as React.CSSProperties} />
                  </div>
                  <small>relative dBFS, not calibrated SPL</small>
                </div>
              ) : null}
            </>
          ) : null
        ) : null}
        {selected ? (
          <button
            type="button"
            className="node-input-button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
              runtime.file.clear();
            }}
          >
            Clear file
          </button>
        ) : null}
      </section>
    );
  }

  if (kind === 'audioOutput') {
    const enabled = runtime.file.audioEnabled;
    const available = runtime.file.audioAvailable && runtime.file.audioRouteConnected;
    return (
      <section
        className="node-input-runtime nodrag nopan nowheel"
        aria-label="Audio output controls"
      >
        <span
          className={`node-input-state ${enabled ? 'is-live' : ''}`}
          aria-live="polite"
          title={runtime.file.audioError ?? undefined}
        >
          <i aria-hidden="true" />
          {runtime.file.audioError ?? (enabled ? 'audio live' : available ? 'audio off' : 'no file audio')}
        </span>
        <button
          type="button"
          className={`node-input-button ${enabled ? 'is-stop' : ''}`}
          disabled={!available}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            if (enabled) {
              runtime.file.disableAudio();
            } else {
              void runtime.file.enableAudio();
            }
          }}
        >
          <Volume2 aria-hidden="true" />
          {enabled ? 'Mute audio' : 'Enable audio'}
        </button>
        {available ? (
          <div className="node-file-meter">
            <span>audio level</span>
            <div
              className="node-level-meter"
              role="meter"
              aria-label="Output audio SPL meter (relative dBFS)"
              aria-valuemin={-60}
              aria-valuemax={0}
              aria-valuenow={Math.round(runtime.file.meterDecibels)}
              aria-valuetext={`${Math.round(runtime.file.meterDecibels)} dBFS`}
            >
              <i style={{ '--meter-level': `${runtime.file.meterLevel * 100}%` } as React.CSSProperties} />
            </div>
            <small>relative dBFS, not calibrated SPL</small>
          </div>
        ) : null}
      </section>
    );
  }

  return null;
}
