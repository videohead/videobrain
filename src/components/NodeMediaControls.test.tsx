import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  NodeMediaControls,
  type OperatorInputRuntime,
} from './NodeMediaControls';

function createRuntime(
  overrides: {
    audioState?: OperatorInputRuntime['audio']['inputState'];
    meterLevel?: number;
    videoState?: OperatorInputRuntime['video']['inputState'];
    videoError?: string | null;
    facingMode?: OperatorInputRuntime['video']['facingMode'];
  } = {},
) {
  const runtime: OperatorInputRuntime = {
    audio: {
      inputState: overrides.audioState ?? 'idle',
      meterLevel: overrides.meterLevel ?? 0.42,
      enable: vi.fn(() => Promise.resolve()),
      disable: vi.fn(),
    },
    video: {
      inputState: overrides.videoState ?? 'idle',
      errorMessage: overrides.videoError ?? null,
      facingMode: overrides.facingMode ?? 'user',
      enable: vi.fn(() => Promise.resolve()),
      disable: vi.fn(),
    },
    file: {
      source: null,
      frameSource: null,
      name: null,
      errorMessage: null,
      isVideo: false,
      isAudio: false,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      audioEnabled: false,
      audioAvailable: false,
      audioRouteConnected: false,
      audioError: null,
      meterLevel: 0,
      meterDecibels: -60,
      choose: vi.fn(),
      clear: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      enableAudio: vi.fn(() => Promise.resolve()),
      disableAudio: vi.fn(),
    },
  };
  const onSelect = vi.fn();
  return { runtime, onSelect };
}

describe('NodeMediaControls', () => {
  it('shows the processed control meter and explains its silent output', () => {
    const props = createRuntime({ meterLevel: 0.42 });
    render(
      <NodeMediaControls
        kind="audioLevel"
        params={{ gain: 2, floor: 0.1 }}
        {...props}
      />,
    );

    expect(screen.getByText('IDLE')).toBeVisible();
    expect(screen.getByText('control out')).toBeVisible();
    expect(
      screen.getByText('Start the mic to drive Level and Audio'),
    ).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Idle control output level' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );
  });

  it('starts and stops the microphone while selecting the owning node', () => {
    const stopped = createRuntime();
    const { rerender } = render(
      <NodeMediaControls
        kind="audioLevel"
        params={{}}
        {...stopped}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start mic' }));
    expect(stopped.onSelect).toHaveBeenCalledOnce();
    expect(stopped.runtime.audio.enable).toHaveBeenCalledOnce();

    const live = createRuntime({ audioState: 'live' });
    rerender(
      <NodeMediaControls
        kind="audioLevel"
        params={{}}
        {...live}
      />,
    );
    expect(
      screen.getByText('Level → control, Audio → analyzers · Stop → demo'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop mic' }));
    expect(live.runtime.audio.disable).toHaveBeenCalledOnce();
  });

  it('leaves Audio Spectrum free of device controls so it only analyzes a patched block', () => {
    const props = createRuntime({ meterLevel: 0.42 });
    const { container } = render(
      <NodeMediaControls
        kind="audioSpectrum"
        params={{ gain: 2, floor: 0.1 }}
        {...props}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(props.runtime.audio.enable).not.toHaveBeenCalled();
  });

  it('disables the microphone action while permission is being requested', () => {
    const props = createRuntime({ audioState: 'requesting' });
    render(
      <NodeMediaControls
        kind="audioLevel"
        params={{}}
        {...props}
      />,
    );
    expect(screen.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
  });

  it('starts the camera with the facing mode selected in the node', () => {
    const props = createRuntime({
      videoState: 'denied',
      videoError: 'Camera permission was blocked.',
    });
    render(
      <NodeMediaControls
        kind="videoInput"
        params={{ facing: 'environment' }}
        {...props}
      />,
    );

    expect(screen.getByText('blocked')).toHaveAttribute(
      'title',
      'Camera permission was blocked.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(props.onSelect).toHaveBeenCalledOnce();
    expect(props.runtime.video.enable).toHaveBeenCalledWith('environment');
  });

  it('stops a live camera and reports the active device direction', () => {
    const props = createRuntime({
      videoState: 'live',
      facingMode: 'environment',
    });
    render(
      <NodeMediaControls
        kind="videoInput"
        params={{ facing: 'environment' }}
        {...props}
      />,
    );

    expect(screen.getByText('rear live')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    expect(props.runtime.video.disable).toHaveBeenCalledOnce();
  });

  it('opens and clears a local file without adding graph inputs', () => {
    const props = createRuntime();
    render(
      <NodeMediaControls kind="file" params={{}} {...props} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    expect(props.runtime.file.choose).toHaveBeenCalledOnce();
  });

  it('controls video playback and seeks through its progress', () => {
    const props = createRuntime();
    props.runtime.file.source = document.createElement('video');
    props.runtime.file.name = 'clip.mp4';
    props.runtime.file.isVideo = true;
    props.runtime.file.isPlaying = true;
    props.runtime.file.currentTime = 12.4;
    props.runtime.file.duration = 65;
    render(<NodeMediaControls kind="file" params={{}} {...props} />);

    expect(screen.getByText('0:12 / 1:05')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pause file' }));
    expect(props.runtime.file.pause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Stop file' }));
    expect(props.runtime.file.stop).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('slider', { name: 'File playback position' }), {
      target: { value: '30' },
    });
    expect(props.runtime.file.seek).toHaveBeenCalledWith(30);
  });

  it('uses the same player controls for an audio-only file', () => {
    const props = createRuntime();
    props.runtime.file.source = document.createElement('audio');
    props.runtime.file.name = 'track.mp3';
    props.runtime.file.isAudio = true;
    props.runtime.file.audioAvailable = true;
    props.runtime.file.currentTime = 8;
    props.runtime.file.duration = 120;
    props.runtime.file.meterDecibels = -12;
    props.runtime.file.meterLevel = 0.8;
    render(<NodeMediaControls kind="file" params={{}} {...props} />);

    expect(screen.getByText('0:08 / 2:00')).toBeVisible();
    expect(screen.getByRole('meter', { name: /File audio SPL meter/ })).toHaveAttribute(
      'aria-valuenow',
      '-12',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play file' }));
    expect(props.runtime.file.play).toHaveBeenCalledOnce();
  });
});
