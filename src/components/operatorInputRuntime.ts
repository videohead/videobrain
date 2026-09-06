import { createContext } from 'react';
import type { AudioInputState } from '../hooks/useAudioLevel';
import type {
  VideoFacingMode,
  VideoInputState,
} from '../hooks/useVideoInput';

export interface OperatorInputRuntime {
  audio: {
    inputState: AudioInputState;
    meterLevel: number;
    enable: () => Promise<void>;
    disable: () => void;
  };
  video: {
    inputState: VideoInputState;
    errorMessage: string | null;
    facingMode: VideoFacingMode;
    enable: (facingMode: VideoFacingMode) => Promise<void>;
    disable: () => void;
  };
  file: {
    source: HTMLMediaElement | HTMLImageElement | null;
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
    audioRouteConnected: boolean;
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
  };
}

export const OperatorInputRuntimeContext =
  createContext<OperatorInputRuntime | null>(null);
