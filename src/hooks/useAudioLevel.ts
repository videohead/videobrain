import { useCallback, useEffect, useRef, useState } from 'react';

import {
  analyzeAnalyser,
  createAnalyserBuffers,
  SILENT_AUDIO_FRAME,
  type AnalyserBuffers,
  type AudioAnalysisFrame,
} from '../engine/audioAnalysis';

export type AudioInputState = 'idle' | 'requesting' | 'live' | 'unavailable';

interface AudioLevelController {
  inputState: AudioInputState;
  meterLevel: number;
  enableMicrophone: () => Promise<void>;
  disableMicrophone: () => void;
  sampleAudio: () => AudioAnalysisFrame;
}

interface AudioSession {
  stream: MediaStream;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  endedHandlers: Array<{ track: MediaStreamTrack; handler: () => void }>;
  released: boolean;
}

function releaseAudioSession(session: AudioSession): void {
  if (session.released) {
    return;
  }
  session.released = true;
  session.endedHandlers.forEach(({ track, handler }) => {
    track.removeEventListener('ended', handler);
  });
  session.endedHandlers = [];
  try {
    session.source?.disconnect();
  } catch {
    // The source may already have been disconnected by the browser.
  }
  try {
    session.analyser?.disconnect();
  } catch {
    // The analyser may already have been disconnected by the browser.
  }
  session.stream.getTracks().forEach((track) => track.stop());
  if (session.context) {
    try {
      void session.context.close().catch(() => undefined);
    } catch {
      // A partially initialized context may reject or throw while closing.
    }
  }
}

export function useAudioLevel(): AudioLevelController {
  const sessionRef = useRef<AudioSession | null>(null);
  const requestVersionRef = useRef(0);
  const buffersRef = useRef<AnalyserBuffers | null>(null);
  const smoothedRef = useRef(0);
  const meterUpdateRef = useRef(0);
  const meterLevelRef = useRef(0);
  const [inputState, setInputState] = useState<AudioInputState>('idle');
  const [meterLevel, setMeterLevel] = useState(0);

  const releaseCurrentSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    buffersRef.current = null;
    if (session) {
      releaseAudioSession(session);
    }
    smoothedRef.current = 0;
    setMeterLevel(0);
  }, []);

  const disableMicrophone = useCallback(() => {
    requestVersionRef.current += 1;
    releaseCurrentSession();
    setInputState('idle');
  }, [releaseCurrentSession]);

  const enableMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setInputState('unavailable');
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    releaseCurrentSession();
    setInputState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
        video: false,
      });

      if (requestVersionRef.current !== requestVersion) {
        releaseAudioSession({
          stream,
          context: null,
          source: null,
          analyser: null,
          endedHandlers: [],
          released: false,
        });
        return;
      }

      const session: AudioSession = {
        stream,
        context: null,
        source: null,
        analyser: null,
        endedHandlers: [],
        released: false,
      };
      sessionRef.current = session;

      const handleEnded = () => {
        if (sessionRef.current !== session) {
          return;
        }
        requestVersionRef.current += 1;
        releaseCurrentSession();
        setInputState('unavailable');
      };
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener('ended', handleEnded);
        session.endedHandlers.push({ track, handler: handleEnded });
      });

      const context = new AudioContext();
      session.context = context;
      const source = context.createMediaStreamSource(stream);
      session.source = source;
      const analyser = context.createAnalyser();
      session.analyser = analyser;
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      if (context.state === 'suspended') {
        await context.resume();
      }

      if (
        requestVersionRef.current !== requestVersion ||
        sessionRef.current !== session
      ) {
        releaseAudioSession(session);
        return;
      }

      buffersRef.current = createAnalyserBuffers(analyser);
      setInputState('live');
    } catch {
      if (requestVersionRef.current === requestVersion) {
        releaseCurrentSession();
        setInputState('unavailable');
      }
    }
  }, [releaseCurrentSession]);

  const sampleAudio = useCallback((): AudioAnalysisFrame => {
    const session = sessionRef.current;
    const analyser = session?.analyser;
    const buffers = buffersRef.current;
    if (!analyser || !buffers) {
      if (meterLevelRef.current !== 0) {
        meterLevelRef.current = 0;
        setMeterLevel(0);
      }
      return SILENT_AUDIO_FRAME;
    }

    const raw = analyzeAnalyser(analyser, buffers, session?.context?.sampleRate);
    smoothedRef.current += (raw.level - smoothedRef.current) * 0.22;
    const frame: AudioAnalysisFrame = { ...raw, level: smoothedRef.current };

    const now = performance.now();
    if (now - meterUpdateRef.current > 90) {
      meterUpdateRef.current = now;
      meterLevelRef.current = frame.level;
      setMeterLevel(frame.level);
    }
    return frame;
  }, []);

  useEffect(
    () => () => {
      requestVersionRef.current += 1;
      releaseCurrentSession();
    },
    [releaseCurrentSession],
  );

  return {
    inputState,
    meterLevel,
    enableMicrophone,
    disableMicrophone,
    sampleAudio,
  };
}
