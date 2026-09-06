import { useCallback, useEffect, useRef, useState } from 'react';

import {
  analyzeSpectrumBands,
  type AudioAnalysisFrame,
  type AudioBands,
} from '../engine/audioAnalysis';

const DEFAULT_SAMPLE_RATE = 48_000;

export type AudioInputState = 'demo' | 'requesting' | 'live' | 'unavailable';

interface AudioLevelController {
  inputState: AudioInputState;
  meterLevel: number;
  enableMicrophone: () => Promise<void>;
  disableMicrophone: () => void;
  sampleAudio: (timeSeconds: number) => AudioAnalysisFrame;
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

function readSpectrumBands(
  analyser: AnalyserNode,
  spectrum: Float32Array<ArrayBuffer> | null,
  context: AudioContext | null | undefined,
): AudioBands {
  if (!spectrum || typeof analyser.getFloatFrequencyData !== 'function') {
    return { bass: 0, mid: 0, treble: 0 };
  }
  analyser.getFloatFrequencyData(spectrum);
  return analyzeSpectrumBands(
    spectrum,
    context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
    analyser.minDecibels,
    analyser.maxDecibels,
  );
}

function sampleDemoAudio(timeSeconds: number): AudioAnalysisFrame {
  const low = Math.sin(timeSeconds * 2.15) * 0.5 + 0.5;
  const pulse = Math.pow(Math.sin(timeSeconds * 4.2) * 0.5 + 0.5, 7);
  const kick = Math.pow(Math.sin(timeSeconds * Math.PI * 4) * 0.5 + 0.5, 12);
  const hats = Math.pow(Math.sin(timeSeconds * Math.PI * 8 + 1.6) * 0.5 + 0.5, 6);
  return {
    level: 0.16 + low * 0.16 + pulse * 0.36,
    bass: 0.08 + kick * 0.82,
    mid: 0.12 + low * 0.34,
    treble: 0.06 + hats * 0.52,
  };
}

export function useAudioLevel(): AudioLevelController {
  const sessionRef = useRef<AudioSession | null>(null);
  const requestVersionRef = useRef(0);
  const samplesRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const spectrumRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const smoothedRef = useRef(0);
  const meterUpdateRef = useRef(0);
  const [inputState, setInputState] = useState<AudioInputState>('demo');
  const [meterLevel, setMeterLevel] = useState(0.24);

  const releaseCurrentSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    samplesRef.current = null;
    spectrumRef.current = null;
    if (session) {
      releaseAudioSession(session);
    }
    smoothedRef.current = 0;
  }, []);

  const disableMicrophone = useCallback(() => {
    requestVersionRef.current += 1;
    releaseCurrentSession();
    setInputState('demo');
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

      samplesRef.current = new Float32Array(analyser.fftSize);
      spectrumRef.current = new Float32Array(
        Math.max(1, Math.floor(analyser.fftSize / 2)),
      );
      setInputState('live');
    } catch {
      if (requestVersionRef.current === requestVersion) {
        releaseCurrentSession();
        setInputState('unavailable');
      }
    }
  }, [releaseCurrentSession]);

  const sampleAudio = useCallback(
    (timeSeconds: number): AudioAnalysisFrame => {
      let frame: AudioAnalysisFrame;
      const session = sessionRef.current;
      const analyser = session?.analyser;
      const samples = samplesRef.current;

      if (analyser && samples) {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          energy += sample * sample;
        }
        const rms = Math.sqrt(energy / samples.length);
        const boosted = Math.min(1, rms * 4.5);
        smoothedRef.current += (boosted - smoothedRef.current) * 0.22;
        frame = {
          level: smoothedRef.current,
          ...readSpectrumBands(analyser, spectrumRef.current, session?.context),
        };
      } else {
        frame = sampleDemoAudio(timeSeconds);
      }

      const now = performance.now();
      if (now - meterUpdateRef.current > 90) {
        meterUpdateRef.current = now;
        setMeterLevel(frame.level);
      }
      return frame;
    },
    [],
  );

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
