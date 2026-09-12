import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefCallback } from 'react';

export type VideoFacingMode = 'user' | 'environment';

export type VideoInputState =
  | 'idle'
  | 'requesting'
  | 'live'
  | 'denied'
  | 'unavailable'
  | 'error';

interface VideoInputController {
  inputState: VideoInputState;
  errorMessage: string | null;
  facingMode: VideoFacingMode;
  videoElement: HTMLVideoElement | null;
  videoRef: RefCallback<HTMLVideoElement>;
  enableCamera: (facingMode?: VideoFacingMode) => Promise<void>;
  disableCamera: () => void;
}

interface VideoSession {
  stream: MediaStream;
  video: HTMLVideoElement;
  endedHandlers: Array<{ track: MediaStreamTrack; handler: () => void }>;
  released: boolean;
}

function releaseStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

function releaseVideoSession(session: VideoSession): void {
  if (session.released) {
    return;
  }
  session.released = true;
  session.endedHandlers.forEach(({ track, handler }) => {
    track.removeEventListener('ended', handler);
  });
  session.endedHandlers = [];
  try {
    session.video.pause();
  } catch {
    // A detached media element may no longer accept playback commands.
  }
  if (session.video.srcObject === session.stream) {
    session.video.srcObject = null;
  }
  releaseStream(session.stream);
}

function describeCameraError(error: unknown): {
  state: Extract<VideoInputState, 'denied' | 'unavailable' | 'error'>;
  message: string;
} {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      state: 'denied',
      message: 'Camera access was blocked. Allow camera permission for this site, then try again.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      state: 'unavailable',
      message: 'No camera matching this input is available.',
    };
  }
  if (name === 'NotReadableError') {
    return {
      state: 'error',
      message: 'The camera is busy in another app or could not be started.',
    };
  }
  return {
    state: 'error',
    message: 'The camera could not be started. Check the device and browser permissions.',
  };
}

export function useVideoInput(): VideoInputController {
  const sessionRef = useRef<VideoSession | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const requestVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const facingModeRef = useRef<VideoFacingMode>('user');
  const [inputState, setInputState] = useState<VideoInputState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<VideoFacingMode>('user');
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const videoRef = useCallback<RefCallback<HTMLVideoElement>>((element) => {
    videoElementRef.current = element;
    setVideoElement(element);
  }, []);

  const releaseCurrentSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      releaseVideoSession(session);
    }
  }, []);

  const disableCamera = useCallback(() => {
    requestVersionRef.current += 1;
    releaseCurrentSession();
    if (mountedRef.current) {
      setInputState('idle');
      setErrorMessage(null);
    }
  }, [releaseCurrentSession]);

  const enableCamera = useCallback(
    async (nextFacingMode: VideoFacingMode = facingModeRef.current) => {
      facingModeRef.current = nextFacingMode;
      setFacingMode(nextFacingMode);

      if (!navigator.mediaDevices?.getUserMedia) {
        releaseCurrentSession();
        setInputState('unavailable');
        setErrorMessage('Live camera input is not supported in this browser.');
        return;
      }

      const video = videoElementRef.current;
      if (!video) {
        releaseCurrentSession();
        setInputState('error');
        setErrorMessage('The camera preview is still starting. Try again in a moment.');
        return;
      }

      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      releaseCurrentSession();
      setInputState('requesting');
      setErrorMessage(null);

      let stream: MediaStream | null = null;
      let session: VideoSession | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: nextFacingMode },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
        });

        if (!mountedRef.current || requestVersionRef.current !== requestVersion) {
          releaseStream(stream);
          return;
        }

        const activeSession: VideoSession = {
          stream,
          video,
          endedHandlers: [],
          released: false,
        };
        session = activeSession;
        stream = null;
        sessionRef.current = activeSession;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = activeSession.stream;
        const handleEnded = () => {
          if (sessionRef.current !== activeSession) {
            return;
          }
          releaseCurrentSession();
          if (mountedRef.current) {
            setInputState('error');
            setErrorMessage('The camera stream ended. Enable it again to reconnect.');
          }
        };
        activeSession.stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', handleEnded);
          activeSession.endedHandlers.push({ track, handler: handleEnded });
        });
        await video.play();

        if (
          !mountedRef.current ||
          requestVersionRef.current !== requestVersion ||
          sessionRef.current !== activeSession
        ) {
          releaseVideoSession(activeSession);
          return;
        }
        setInputState('live');
      } catch (error) {
        if (!mountedRef.current || requestVersionRef.current !== requestVersion) {
          if (session) {
            releaseVideoSession(session);
          } else if (stream) {
            releaseStream(stream);
          }
          return;
        }
        if (sessionRef.current === session) {
          sessionRef.current = null;
        }
        if (session) {
          releaseVideoSession(session);
        } else if (stream) {
          releaseStream(stream);
        }
        const cameraError = describeCameraError(error);
        setInputState(cameraError.state);
        setErrorMessage(cameraError.message);
      }
    },
    [releaseCurrentSession],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      releaseCurrentSession();
    };
  }, [releaseCurrentSession]);

  return {
    inputState,
    errorMessage,
    facingMode,
    videoElement,
    videoRef,
    enableCamera,
    disableCamera,
  };
}
