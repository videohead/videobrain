import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import {
  analyzeAnalyser,
  createAnalyserBuffers,
  type AnalyserBuffers,
  type AudioAnalysisFrame,
} from '../engine/audioAnalysis';

export type FileInputSource = HTMLMediaElement | HTMLImageElement;

export interface AudioMixerConfig {
  sourceCount: number;
  gains: readonly number[];
  low: number;
  mid: number;
  high: number;
}

export interface FileInputController {
  inputRef?: RefObject<HTMLInputElement | null>;
  source: FileInputSource | null;
  frameSource: HTMLVideoElement | HTMLImageElement | null;
  name: string | null;
  errorMessage: string | null;
  isVideo: boolean;
  isAudio: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  audioEnabled: boolean;
  audioAvailable: boolean;
  audioRouteConnected?: boolean;
  audioError: string | null;
  meterLevel: number;
  meterDecibels: number;
  choose: () => void;
  clear: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  enableAudio: () => Promise<void>;
  disableAudio: () => void;
  sampleAudio?: () => AudioAnalysisFrame | null;
  handleChange?: (file: File | undefined) => void;
}

const fileControllers = new Map<string, FileInputController>();
let fileSnapshot: ReadonlyMap<string, FileInputController> = new Map();
const fileListeners = new Set<() => void>();

function notifyFileControllers(): void {
  fileSnapshot = new Map(fileControllers);
  fileListeners.forEach((listener) => listener());
}

export function getFileInputController(nodeId: string): FileInputController | null {
  return fileControllers.get(nodeId) ?? null;
}

export function getFileInputControllers(): ReadonlyMap<string, FileInputController> {
  return fileSnapshot;
}

export function subscribeFileInputs(listener: () => void): () => void {
  fileListeners.add(listener);
  return () => fileListeners.delete(listener);
}

export function useFileInput(
  nodeId: string,
  mixerConfig: AudioMixerConfig | null = null,
): FileInputController {
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const sourceRef = useRef<FileInputSource | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const mixerNodesRef = useRef<GainNode[]>([]);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserBuffersRef = useRef<AnalyserBuffers | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const [source, setSource] = useState<FileInputSource | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isAudio, setIsAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [meterLevel, setMeterLevel] = useState(0);
  const [meterDecibels, setMeterDecibels] = useState(-60);
  const registeredControllerRef = useRef<FileInputController | null>(null);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    setMeterLevel(0);
    setMeterDecibels(-60);
  }, []);

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) {
      return;
    }
    const samples = new Float32Array(analyser.fftSize);
    const update = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      const decibels = 20 * Math.log10(Math.max(rms, 0.001));
      setMeterDecibels(decibels);
      setMeterLevel(Math.min(1, Math.max(0, (decibels + 60) / 60)));
      meterFrameRef.current = requestAnimationFrame(update);
    };
    update();
  }, []);

  const disableAudio = useCallback(() => {
    stopMeter();
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    analyserBuffersRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    mixerNodesRef.current.forEach((node) => node.disconnect());
    mixerNodesRef.current = [];
    eqNodesRef.current.forEach((node) => node.disconnect());
    eqNodesRef.current = [];
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (sourceRef.current instanceof HTMLMediaElement) {
      sourceRef.current.muted = true;
    }
    setAudioEnabled(false);
  }, []);

  const clear = useCallback(() => {
    disableAudio();
    if (sourceRef.current instanceof HTMLMediaElement) {
      sourceRef.current.pause();
      sourceRef.current.removeAttribute('src');
      sourceRef.current.load();
    }
    sourceRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setSource(null);
    setName(null);
    setErrorMessage(null);
    setIsVideo(false);
    setIsAudio(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setMeterLevel(0);
    setMeterDecibels(-60);
  }, [disableAudio]);

  const handleChange = useCallback((file: File | undefined) => {
    if (!file) {
      return;
    }
    if (
      !file.type.startsWith('image/') &&
      !file.type.startsWith('video/') &&
      !file.type.startsWith('audio/')
    ) {
      setErrorMessage('Choose an image, video, or audio file.');
      return;
    }
    disableAudio();
    if (sourceRef.current instanceof HTMLMediaElement) {
      sourceRef.current.pause();
    }
    sourceRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
    }
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setErrorMessage(null);
    setName(file.name);
    setIsVideo(file.type.startsWith('video/'));
    setIsAudio(file.type.startsWith('audio/'));
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioError(null);
    if (file.type.startsWith('image/')) {
      const image = new Image();
      image.onload = () => setSource(image);
      image.onerror = () => setErrorMessage('The image could not be loaded.');
      image.src = url;
      return;
    }
    const media = file.type.startsWith('audio/')
      ? document.createElement('audio')
      : document.createElement('video');
    media.muted = true;
    media.loop = true;
    if (media instanceof HTMLVideoElement) {
      media.playsInline = true;
    }
    media.onloadeddata = () => {
      sourceRef.current = media;
      setSource(media);
      void media.play().catch(() => setErrorMessage('The file could not be played.'));
    };
    media.onerror = () => setErrorMessage('The media file could not be loaded.');
    media.src = url;
    media.load();
  }, [disableAudio]);

  const choose = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const play = useCallback(() => {
    const media = sourceRef.current;
    if (media instanceof HTMLMediaElement) {
      void media.play().catch(() => setErrorMessage('The file could not be played.'));
    }
  }, []);

  const pause = useCallback(() => {
    const media = sourceRef.current;
    if (media instanceof HTMLMediaElement) {
      media.pause();
    }
  }, []);

  const stop = useCallback(() => {
    const media = sourceRef.current;
    if (media instanceof HTMLMediaElement) {
      media.pause();
      media.currentTime = 0;
      setCurrentTime(0);
    }
  }, []);

  const seek = useCallback((time: number) => {
    const media = sourceRef.current;
    if (media instanceof HTMLMediaElement && Number.isFinite(time)) {
      media.currentTime = Math.min(Math.max(0, time), media.duration || 0);
      setCurrentTime(media.currentTime);
    }
  }, []);

  const enableAudio = useCallback(async () => {
    const media = sourceRef.current;
    if (!(media instanceof HTMLMediaElement)) {
      setAudioError('Select a media file with an audio track first.');
      return;
    }
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (!audioSourceRef.current) {
        audioSourceRef.current = context.createMediaElementSource(media);
        analyserRef.current = context.createAnalyser();
        // Wide enough to resolve the bass, mid, and treble analysis bands.
        analyserRef.current.fftSize = 1_024;
        analyserBuffersRef.current = createAnalyserBuffers(analyserRef.current);
        const mixer = mixerConfig;
        if (mixer) {
          const low = context.createBiquadFilter();
          low.type = 'lowshelf';
          low.frequency.value = 180;
          low.gain.value = mixer.low;
          const mid = context.createBiquadFilter();
          mid.type = 'peaking';
          mid.frequency.value = 1_000;
          mid.Q.value = 0.8;
          mid.gain.value = mixer.mid;
          const high = context.createBiquadFilter();
          high.type = 'highshelf';
          high.frequency.value = 4_000;
          high.gain.value = mixer.high;
          eqNodesRef.current = [low, mid, high];
          low.connect(mid);
          mid.connect(high);
          high.connect(analyserRef.current);
          const count = Math.min(8, Math.max(2, Math.floor(mixer.sourceCount)));
          mixerNodesRef.current = Array.from({ length: count }, (_, index) => {
            const gain = context.createGain();
            gain.gain.value = mixer.gains[index] ?? 1;
            gain.connect(low);
            return gain;
          });
          mixerNodesRef.current.forEach((node) => audioSourceRef.current?.connect(node));
        } else {
          audioSourceRef.current.connect(analyserRef.current);
        }
        analyserRef.current.connect(context.destination);
      }
      media.muted = false;
      await context.resume();
      startMeter();
      setAudioError(null);
      setAudioEnabled(true);
    } catch {
      media.muted = true;
      setAudioError('Audio output could not be enabled in this browser.');
      setAudioEnabled(false);
    }
  }, [mixerConfig, startMeter]);

  useEffect(() => {
    const [low, mid, high] = eqNodesRef.current;
    if (low && mid && high && mixerConfig) {
      low.gain.value = mixerConfig.low;
      mid.gain.value = mixerConfig.mid;
      high.gain.value = mixerConfig.high;
    }
    mixerNodesRef.current.forEach((node, index) => {
      node.gain.value = mixerConfig?.gains[index] ?? 1;
    });
  }, [mixerConfig]);

  useEffect(() => {
    const media = source;
    if (!(media instanceof HTMLMediaElement)) {
      return;
    }
    const update = () => {
      setCurrentTime(media.currentTime);
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
      setIsPlaying(!media.paused && !media.ended);
    };
    media.addEventListener('timeupdate', update);
    media.addEventListener('durationchange', update);
    media.addEventListener('play', update);
    media.addEventListener('pause', update);
    media.addEventListener('ended', update);
    update();
    return () => {
      media.removeEventListener('timeupdate', update);
      media.removeEventListener('durationchange', update);
      media.removeEventListener('play', update);
      media.removeEventListener('pause', update);
      media.removeEventListener('ended', update);
    };
  }, [source]);

  useEffect(() => () => clear(), [clear]);

  const sampleAudio = useCallback((): AudioAnalysisFrame | null => {
    const analyser = analyserRef.current;
    const buffers = analyserBuffersRef.current;
    if (!analyser || !buffers) {
      return null;
    }
    return analyzeAnalyser(
      analyser,
      buffers,
      audioContextRef.current?.sampleRate,
    );
  }, []);

  const audioAvailable = (isVideo || isAudio) && Boolean(source);
  const frameSource = source instanceof HTMLImageElement || source instanceof HTMLVideoElement
    ? source
    : null;

  const controller = {
    inputRef,
    source,
    frameSource,
    name,
    errorMessage,
    isVideo,
    isAudio,
    isPlaying,
    currentTime,
    duration,
    audioEnabled,
    audioAvailable,
    audioError,
    meterLevel,
    meterDecibels,
    choose,
    clear,
    play,
    pause,
    stop,
    seek,
    enableAudio,
    disableAudio,
    sampleAudio,
    handleChange,
  };

  const registeredController = registeredControllerRef.current ?? controller;
  if (!registeredControllerRef.current) {
    registeredControllerRef.current = registeredController;
  } else {
    Object.assign(registeredController, controller);
  }

  useEffect(() => {
    fileControllers.set(nodeId, registeredController);
    notifyFileControllers();
    return () => {
      if (fileControllers.get(nodeId) === registeredController) {
        fileControllers.delete(nodeId);
        notifyFileControllers();
      }
    };
  }, [nodeId, registeredController]);

  useEffect(() => {
    if (fileControllers.get(nodeId) === registeredController) {
      notifyFileControllers();
    }
  }, [
    audioAvailable,
    audioEnabled,
    errorMessage,
    source,
    name,
    nodeId,
    registeredController,
  ]);

  return controller;
}