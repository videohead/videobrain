import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAudioLevel } from './useAudioLevel';

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
    addEventListener,
    removeEventListener,
    stop,
  } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return {
    addEventListener,
    end: () => {
      [...listeners].forEach((listener) => listener());
    },
    removeEventListener,
    stop,
    stream,
  };
}

function stubWorkingAudioContext(
  state: AudioContextState = 'running',
  resumeResult: Promise<void> = Promise.resolve(),
) {
  const connect = vi.fn();
  const disconnectAnalyser = vi.fn();
  const disconnectSource = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn().mockReturnValue(resumeResult);
  const analyser = {
    disconnect: disconnectAnalyser,
    fftSize: 2048,
    getFloatTimeDomainData: vi.fn(),
    smoothingTimeConstant: 0,
  };

  class WorkingAudioContext {
    state = state;
    close = close;
    resume = resume;

    createMediaStreamSource() {
      return { connect, disconnect: disconnectSource };
    }

    createAnalyser() {
      return analyser;
    }
  }

  vi.stubGlobal('AudioContext', WorkingAudioContext);
  return {
    close,
    connect,
    disconnectAnalyser,
    disconnectSource,
    resume,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

describe('microphone lifecycle', () => {
  it('resumes a suspended audio context before reporting the microphone live', async () => {
    const { stream } = makeStream();
    const { resume } = stubWorkingAudioContext('suspended');
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const { result } = renderHook(() => useAudioLevel());

    await act(async () => {
      await result.current.enableMicrophone();
    });

    expect(resume).toHaveBeenCalledOnce();
    expect(result.current.inputState).toBe('live');
  });

  it('cleans up when a suspended audio context cannot resume', async () => {
    const { removeEventListener, stop, stream } = makeStream();
    const { close, disconnectAnalyser, disconnectSource } =
      stubWorkingAudioContext(
        'suspended',
        Promise.reject(new Error('resume failed')),
      );
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const { result } = renderHook(() => useAudioLevel());

    await act(async () => {
      await result.current.enableMicrophone();
    });

    expect(result.current.inputState).toBe('unavailable');
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(disconnectAnalyser).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('releases the session and leaves live state when the microphone track ends', async () => {
    const { end, removeEventListener, stop, stream } = makeStream();
    const { close, disconnectAnalyser, disconnectSource } =
      stubWorkingAudioContext();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const { result } = renderHook(() => useAudioLevel());

    await act(async () => {
      await result.current.enableMicrophone();
    });
    expect(result.current.inputState).toBe('live');

    act(() => end());

    expect(result.current.inputState).toBe('unavailable');
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(disconnectAnalyser).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    act(() => end());
    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases an acquired stream when audio setup fails partway through', async () => {
    const { stop, stream } = makeStream();
    const disconnectSource = vi.fn();
    const closeContext = vi.fn().mockResolvedValue(undefined);

    class PartiallyWorkingAudioContext {
      close = closeContext;

      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: disconnectSource,
        };
      }

      createAnalyser(): never {
        throw new Error('analyser initialization failed');
      }
    }

    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    vi.stubGlobal('AudioContext', PartiallyWorkingAudioContext);
    const { result } = renderHook(() => useAudioLevel());

    await act(async () => {
      await result.current.enableMicrophone();
    });

    expect(result.current.inputState).toBe('unavailable');
    expect(stop).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it('stops a stream that arrives after the hook has unmounted', async () => {
    const { stop, stream } = makeStream();
    let resolveStream: ((value: MediaStream) => void) | undefined;
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    setGetUserMedia(vi.fn().mockReturnValue(pendingStream));
    const { result, unmount } = renderHook(() => useAudioLevel());
    let enablePromise = Promise.resolve();

    act(() => {
      enablePromise = result.current.enableMicrophone();
    });
    unmount();
    resolveStream?.(stream);
    await act(async () => {
      await enablePromise;
    });

    expect(stop).toHaveBeenCalledOnce();
  });
});
