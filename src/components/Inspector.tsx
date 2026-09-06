import { useState } from 'react';
import { Braces, Copy, Mic2, Trash2, Video } from 'lucide-react';
import {
  getOperatorDefinition,
  type GraphDocument,
  type GraphNode,
  type GraphParamValue,
} from '../graph';
import type { AudioInputState } from '../hooks/useAudioLevel';
import {
  resolveVideoModelConfig,
  type VideoModelRuntime,
  type VideoModelSessionState,
} from '../hooks/useVideoModel';
import type {
  VideoFacingMode,
  VideoInputState,
} from '../hooks/useVideoInput';
import { formatParameterNumber } from './parameterFormatting';
import { DOMAIN_LABELS, OPERATOR_META } from './operatorMeta';

interface InspectorProps {
  node: GraphNode | null;
  audioInputState: AudioInputState;
  videoInputState: VideoInputState;
  videoInputError: string | null;
  videoFacingMode: VideoFacingMode;
  onParamChange: (nodeId: string, paramId: string, value: GraphParamValue) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (node: GraphNode) => void;
  onEnableMicrophone: () => Promise<void>;
  onDisableMicrophone: () => void;
  onEnableCamera: (facingMode: VideoFacingMode) => Promise<void>;
  onDisableCamera: () => void;
  graphDocument: GraphDocument;
  videoModelRuntime: VideoModelRuntime;
}

export function Inspector({
  node,
  audioInputState,
  videoInputState,
  videoInputError,
  videoFacingMode,
  onParamChange,
  onGestureStart,
  onGestureEnd,
  onDelete,
  onDuplicate,
  onEnableMicrophone,
  onDisableMicrophone,
  onEnableCamera,
  onDisableCamera,
  graphDocument,
  videoModelRuntime,
}: InspectorProps) {
  if (!node) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-empty">
          <div className="inspector-empty-icon" aria-hidden="true">
            <Braces size={20} />
          </div>
          <h2>Nothing selected</h2>
          <p>Select a node to tune its parameters and inspect its signal contract.</p>
        </div>
      </aside>
    );
  }

  const definition = getOperatorDefinition(node.kind);
  const meta = OPERATOR_META[node.kind];
  const Icon = meta.icon;
  const selectedFacingMode: VideoFacingMode =
    node.params.facing === 'environment' ? 'environment' : 'user';
  const videoModelConfig =
    node.kind === 'videoModel'
      ? resolveVideoModelConfig(graphDocument, node.id)
      : null;
  const videoModelSession =
    node.kind === 'videoModel' ? videoModelRuntime.getSession(node.id) : null;
  const videoModelSocketActive =
    videoModelSession?.state === 'live' ||
    videoModelSession?.state === 'connecting' ||
    videoModelSession?.state === 'generating';

  return (
    <aside
      className="inspector"
      aria-label={`${definition.title} inspector`}
      style={{ '--node-accent': meta.accent } as React.CSSProperties}
    >
      <header className="inspector-header">
        <span className="inspector-kind-icon" aria-hidden="true">
          <Icon size={17} />
        </span>
        <div>
          <h2 className="inspector-name">{definition.title}</h2>
          <div className="inspector-kind">{DOMAIN_LABELS[definition.domain]} / {node.id}</div>
        </div>
      </header>

      <section className="inspector-section">
        <div className="section-label">About</div>
        <p className="inspector-description">{definition.summary}</p>
        <div className="signal-readout">
          <div className="readout-cell">
            <span>Inputs</span>
            <strong>{definition.inputs.length}</strong>
          </div>
          <div className="readout-cell">
            <span>Outputs</span>
            <strong>{definition.outputs.length}</strong>
          </div>
          <div className="readout-cell">
            <span>Domain</span>
            <strong>{definition.domain}</strong>
          </div>
        </div>
      </section>

      {Object.keys(definition.params).length > 0 ? (
        <section className="inspector-section">
          <div className="section-label">Parameters</div>
          <div className="parameter-list">
            {Object.entries(definition.params).map(([paramId, parameter]) => {
              const value = node.params[paramId] ?? parameter.defaultValue;
              if (parameter.type === 'text') {
                const textValue =
                  typeof value === 'string' ? value : parameter.defaultValue;
                const inputId = `inspector-${node.id}-${paramId}`;
                const countId = `${inputId}-count`;
                const commonProps = {
                  id: inputId,
                  value: textValue,
                  maxLength: parameter.maxLength,
                  placeholder: parameter.placeholder,
                  'aria-describedby': countId,
                  onFocus: onGestureStart,
                  onBlur: onGestureEnd,
                  onChange: (
                    event: React.ChangeEvent<
                      HTMLInputElement | HTMLTextAreaElement
                    >,
                  ) => onParamChange(node.id, paramId, event.target.value),
                };
                return (
                  <div className="parameter-row parameter-row-text" key={paramId}>
                    <span className="parameter-label-row">
                      <label className="parameter-label" htmlFor={inputId}>
                        {parameter.label}
                      </label>
                      <output className="parameter-value" id={countId}>
                        {textValue.length}/{parameter.maxLength}
                      </output>
                    </span>
                    {parameter.multiline ? (
                      <textarea {...commonProps} rows={5} />
                    ) : (
                      <input {...commonProps} type="text" />
                    )}
                  </div>
                );
              }
              if (parameter.type === 'select') {
                return (
                  <label className="parameter-row" key={paramId}>
                    <span className="parameter-label">{parameter.label}</span>
                    <select
                      value={String(value)}
                      onChange={(event) =>
                        onParamChange(node.id, paramId, event.target.value)
                      }
                    >
                      {parameter.options.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                );
              }
              if (parameter.type === 'boolean') {
                const checked = typeof value === 'boolean' ? value : parameter.defaultValue;
                return (
                  <div className="parameter-row" key={paramId}>
                    <span className="parameter-label">{parameter.label}</span>
                    <button
                      type="button"
                      className="text-button"
                      aria-pressed={checked}
                      aria-label={`${definition.title} ${parameter.label}`}
                      onClick={() => onParamChange(node.id, paramId, !checked)}
                    >
                      {checked ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              }

              const numericValue = typeof value === 'number' ? value : parameter.defaultValue;
              const progress = ((numericValue - parameter.min) / (parameter.max - parameter.min)) * 100;
              return (
                <label className="parameter-row" key={paramId}>
                  <span className="parameter-label-row">
                    <span className="parameter-label">{parameter.label}</span>
                    <output className="parameter-value">
                      {formatParameterNumber(numericValue, parameter.step)}
                    </output>
                  </span>
                  <input
                    type="range"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.step}
                    value={numericValue}
                    style={{ '--range-progress': `${progress}%` } as React.CSSProperties}
                    onPointerDown={onGestureStart}
                    onPointerUp={onGestureEnd}
                    onPointerCancel={onGestureEnd}
                    onChange={(event) => onParamChange(node.id, paramId, Number(event.target.value))}
                  />
                  <span className="parameter-help">{parameter.min} — {parameter.max}</span>
                </label>
              );
            })}
          </div>
        </section>
      ) : null}

      {node.kind === 'audioLevel' ? (
        <section className="inspector-section">
          <div className="section-label">Input source</div>
          <p className="inspector-description">
            {audioStateDescription(audioInputState)}
          </p>
          <button
            type="button"
            className={audioInputState === 'live' ? 'danger-button' : 'primary-button'}
            onClick={() => {
              if (audioInputState === 'live') {
                onDisableMicrophone();
              } else {
                void onEnableMicrophone();
              }
            }}
            disabled={audioInputState === 'requesting'}
          >
            <Mic2 size={13} />
            {audioInputState === 'live'
              ? 'Stop microphone'
              : audioInputState === 'requesting'
                ? 'Requesting…'
                : 'Enable microphone'}
          </button>
          <p className="input-privacy-note">
            <strong>Control only — no sound output.</strong> Audio Level measures
            microphone loudness and emits a normalized 0–1 Level signal. It does
            not play, monitor, mix, record, or pass through the microphone. This
            feedback-safe default prevents the mic from feeding the speakers.
          </p>
          <p className="input-privacy-note">
            Drag <strong>Level</strong> to Flow Field <strong>Energy</strong>, Warp
            <strong> Amount</strong>, Blend <strong>Mix</strong>, Trails
            <strong> Feedback</strong>, or Color Grade <strong>Hue</strong>,
            <strong> Exposure</strong>, or <strong>Saturation</strong>. A connected
            signal drives that input instead of its slider value. Gain applies
            <code> clamp((input − Floor) × Gain, 0, 1)</code>; it changes analysis
            sensitivity, not speaker volume.
          </p>
        </section>
      ) : null}

      {node.kind === 'videoInput' ? (
        <section className="inspector-section camera-input-section">
          <div className="section-label">Input source</div>
          <div className={`input-state input-state-${videoInputState}`} aria-live="polite">
            <i aria-hidden="true" />
            <strong>{videoStateLabel(videoInputState)}</strong>
            {videoInputState === 'live' ? (
              <span>{videoFacingMode === 'environment' ? 'rear' : 'front'}</span>
            ) : null}
          </div>
          <p
            className="inspector-description"
            role={videoInputError ? 'alert' : undefined}
          >
            {videoInputError ?? videoStateDescription(videoInputState)}
          </p>
          <button
            type="button"
            className={videoInputState === 'live' ? 'danger-button' : 'primary-button'}
            onClick={() => {
              if (videoInputState === 'live') {
                onDisableCamera();
              } else {
                void onEnableCamera(selectedFacingMode);
              }
            }}
            disabled={videoInputState === 'requesting'}
          >
            <Video size={13} />
            {videoInputState === 'live'
              ? 'Stop camera'
              : videoInputState === 'requesting'
                ? 'Requesting…'
                : videoInputState === 'idle'
                  ? 'Enable camera'
                  : 'Try camera again'}
          </button>
          <p className="input-privacy-note">
            Permission is requested only when you press Start camera in the node
            or Enable camera here; adding or wiring Video Input does not start the
            device. For a direct check, connect <strong>Frame</strong> to Display
            <strong> Source</strong>. Frames stay in this tab unless you explicitly
            connect this node to a networked Video Model.
          </p>
        </section>
      ) : null}

      {node.kind === 'videoModel' && videoModelConfig && videoModelSession ? (
        <section className="inspector-section model-runtime-section">
          <div className="section-label">Model connection</div>
          <div
            className={`input-state input-state-${videoModelSession.state}`}
            aria-live="polite"
          >
            <i aria-hidden="true" />
            <strong>{modelStateLabel(videoModelSession.state)}</strong>
            <span>{videoModelConfig.transport}</span>
          </div>
          <p
            className="inspector-description"
            role={videoModelSession.error ? 'alert' : undefined}
          >
            {videoModelSession.error ??
              modelStateDescription(
                videoModelSession.state,
                videoModelConfig.acceptsCameraFrames,
              )}
          </p>
          {videoModelConfig.runtime === 'preview' ? (
            <p className="input-privacy-note">
              Preview mode is a local procedural stand-in. Choose Local or API,
              set an endpoint above, and connect to receive generated frames.
            </p>
          ) : (
            <>
              {videoModelConfig.hasSource &&
              !videoModelConfig.acceptsCameraFrames ? (
                <p className="input-privacy-note">
                  <strong>Source is graph-local.</strong> Source pixels are sent
                  to a model worker only when a Video Input is connected directly
                  in WebSocket mode.
                </p>
              ) : null}
              <SessionKeyField
                key={`${node.id}-${videoModelConfig.endpoint}`}
                hasCredential={videoModelSession.hasCredential}
                onCommit={(credential) =>
                  videoModelRuntime.setCredential(node.id, credential)
                }
              />
              <div className="model-runtime-actions">
                {videoModelConfig.transport === 'websocket' ? (
                  <button
                    type="button"
                    className={
                      videoModelSocketActive
                        ? 'danger-button'
                        : 'primary-button'
                    }
                    onClick={() => {
                      if (videoModelSocketActive) {
                        videoModelRuntime.disconnect(node.id);
                      } else {
                        videoModelRuntime.connect(node.id);
                      }
                    }}
                  >
                    {videoModelSocketActive
                      ? 'Disconnect'
                      : 'Connect stream'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    videoModelSession.state === 'connecting' ||
                    videoModelSession.state === 'generating'
                  }
                  onClick={() => void videoModelRuntime.generate(node.id)}
                >
                  {videoModelSession.state === 'generating'
                    ? 'Generating…'
                    : videoModelConfig.transport === 'websocket'
                      ? 'Request frame'
                      : 'Generate'}
                </button>
              </div>
              <p className="input-privacy-note">
                Keys stay in memory and are never saved in the graph. Prompts,
                keys, and directly streamed camera frames are sent only to the
                endpoint you enter.
              </p>
            </>
          )}
        </section>
      ) : null}

      <div className="inspector-actions">
        <button type="button" className="text-button" onClick={() => onDuplicate(node)}>
          <Copy size={13} /> Duplicate
        </button>
        <button type="button" className="danger-button" onClick={() => onDelete(node.id)}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </aside>
  );
}

function SessionKeyField({
  hasCredential,
  onCommit,
}: {
  hasCredential: boolean;
  onCommit: (credential: string) => void;
}) {
  const [credential, setCredential] = useState('');
  const canSubmit = credential.length > 0 || hasCredential;
  return (
    <form
      className="model-key-field"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) {
          return;
        }
        onCommit(credential);
        setCredential('');
      }}
    >
      <label>
        <span>Session API key</span>
        <input
          type="password"
          autoComplete="off"
          value={credential}
          placeholder={
            hasCredential
              ? 'Key set for this endpoint'
              : 'Optional bearer token'
          }
          onChange={(event) => setCredential(event.currentTarget.value)}
        />
      </label>
      <button type="submit" className="text-button" disabled={!canSubmit}>
        {credential ? 'Apply key' : hasCredential ? 'Clear key' : 'Apply key'}
      </button>
    </form>
  );
}

function modelStateLabel(state: VideoModelSessionState): string {
  switch (state) {
    case 'preview':
      return 'Local preview';
    case 'connecting':
      return 'Connecting';
    case 'live':
      return 'Stream live';
    case 'generating':
      return 'Generating';
    case 'ready':
      return 'Frame ready';
    case 'error':
      return 'Connection error';
    default:
      return 'Not connected';
  }
}

function modelStateDescription(
  state: VideoModelSessionState,
  acceptsCameraFrames: boolean,
): string {
  if (state === 'live') {
    return acceptsCameraFrames
      ? 'Prompt updates and paced camera frames are streaming to the model worker.'
      : 'Prompt updates are live. The worker can stream generated image frames back.';
  }
  if (state === 'ready') {
    return 'The latest generated frame is now feeding this node output.';
  }
  if (state === 'generating') {
    return 'Waiting for a generated image response.';
  }
  return 'Connect a trusted worker, or use HTTP mode for request-and-response generation.';
}

function videoStateLabel(state: VideoInputState): string {
  switch (state) {
    case 'idle':
      return 'Camera off';
    case 'requesting':
      return 'Waiting for permission';
    case 'live':
      return 'Camera live';
    case 'denied':
      return 'Permission blocked';
    case 'unavailable':
      return 'Camera unavailable';
    case 'error':
      return 'Camera error';
  }
}

function audioStateDescription(state: AudioInputState): string {
  switch (state) {
    case 'idle':
      return 'No audio is being captured. Enable the microphone to analyze live sound.';
    case 'requesting':
      return 'Choose Allow in the browser prompt to begin microphone analysis.';
    case 'live':
      return 'Microphone loudness analysis is active in this tab.';
    case 'unavailable':
      return 'Microphone access is unavailable or blocked, so this node reads silence.';
  }
}

function videoStateDescription(state: VideoInputState): string {
  switch (state) {
    case 'idle':
      return 'The camera is off. Enable it to feed live frames into this node.';
    case 'requesting':
      return 'Choose Allow in the browser prompt to start the selected camera.';
    case 'live':
      return 'Live frames are available to every connected branch of this patch.';
    case 'denied':
      return 'Allow camera permission for this site, then try again.';
    case 'unavailable':
      return 'Connect a camera or choose another available input.';
    case 'error':
      return 'Check the camera and browser permissions, then try again.';
  }
}
