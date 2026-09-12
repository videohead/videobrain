import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoInput } from './useVideoInput';

const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  'mediaDevices',
);

function setGetUserMedia(
  getUserMedia: (constraints?: MediaStreamConstraints) => Promise<MediaStream>,
): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

function makeVideo() {
  const video = document.createElement('video');
  const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  return { pause, play, video };
}

function makeStream() {
  const stop = vi.fn();
  const listeners = new Set<() => void>();
  const addEventListener = vi.fn((event: string, listener: () => void) => {
    if (event === 'ended') {
      listeners.add(listener);
    }
  });
  const removeEventListener = vi.fn((event: string, listener: () => void) => {
    if (event === 'ended') {
      listeners.delete(listener);
    }
  });
  const track = {
    stop,
    addEventListener,
    removeEventListener,
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return {
    addEventListener,
    end: () => listeners.forEach((listener) => listener()),
    removeEventListener,
    stop,
    stream,
    track,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

describe('camera lifecycle', () => {
  it('does not ask for camera permission before explicit enablement', () => {
    const getUserMedia = vi.fn();
    setGetUserMedia(getUserMedia);

    const { result } = renderHook(() => useVideoInput());

    expect(result.current.inputState).toBe('idle');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('starts the selected camera and releases every resource on stop', async () => {
    const { addEventListener, removeEventListener, stop, stream } = makeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const { pause, play, video } = makeVideo();
    setGetUserMedia(getUserMedia);
    const { result } = renderHook(() => useVideoInput());

    act(() => {
      result.current.videoRef(video);
    });
    await act(async () => {
      await result.current.enableCamera('environment');
    });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
      },
    });
    expect(result.current.inputState).toBe('live');
    expect(result.current.facingMode).toBe('environment');
    expect(video.srcObject).toBe(stream);
    expect(play).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));

    act(() => result.current.disableCamera());

    expect(result.current.inputState).toBe('idle');
    expect(video.srcObject).toBeNull();
    expect(pause).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
  });

  it('releases a stream whose request resolves after a StrictMode unmount', async () => {
    const { stop, stream } = makeStream();
    const { video } = makeVideo();
    let resolveStream: ((value: MediaStream) => void) | undefined;
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    setGetUserMedia(vi.fn().mockReturnValue(pendingStream));
    const { result, unmount } = renderHook(() => useVideoInput(), {
      wrapper: StrictMode,
    });
    let enablePromise = Promise.resolve();

    act(() => {
      result.current.videoRef(video);
    });
    act(() => {
      enablePromise = result.current.enableCamera();
    });
    unmount();
    resolveStream?.(stream);
    await act(async () => {
      await enablePromise;
    });

    expect(stop).toHaveBeenCalledOnce();
  });

  it('cleans up a partially started session when video playback fails', async () => {
    const { stop, stream } = makeStream();
    const { pause, play, video } = makeVideo();
    play.mockRejectedValue(new DOMException('camera is busy', 'NotReadableError'));
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const { result } = renderHook(() => useVideoInput());

    act(() => {
      result.current.videoRef(video);
    });
    await act(async () => {
      await result.current.enableCamera();
    });

    expect(result.current.inputState).toBe('error');
    expect(result.current.errorMessage).toMatch(/busy/i);
    expect(video.srcObject).toBeNull();
    expect(pause).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('marks an ended device stream as disconnected and releases it', async () => {
    const { end, stop, stream } = makeStream();
    const { video } = makeVideo();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const { result } = renderHook(() => useVideoInput());

    act(() => {
      result.current.videoRef(video);
    });
    await act(async () => {
      await result.current.enableCamera();
    });
    act(() => end());

    expect(result.current.inputState).toBe('error');
    expect(result.current.errorMessage).toMatch(/stream ended/i);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports unsupported browsers without attempting a request', async () => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    const { result } = renderHook(() => useVideoInput());

    await act(async () => {
      await result.current.enableCamera();
    });

    expect(result.current.inputState).toBe('unavailable');
    expect(result.current.errorMessage).toMatch(/not supported/i);
  });
});
