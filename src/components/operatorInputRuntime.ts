import { createContext } from 'react';
import type { AudioInputState } from '../hooks/useAudioLevel';
import type {
  VideoFacingMode,
  VideoInputState,
} from '../hooks/useVideoInput';
import type { AudioMixerConfig, FileInputController } from '../hooks/useFileInput';
import type { NetworkVideoRuntime } from '../hooks/useNetworkVideo';

export interface OperatorInputRuntime {
  networkVideo?: NetworkVideoRuntime;
  mixerConfig?: AudioMixerConfig | null;
  audioRouteConnected?: boolean;
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
  file: FileInputController;
  getFile?: (nodeId: string) => FileInputController | null;
}

export const OperatorInputRuntimeContext =
  createContext<OperatorInputRuntime | null>(null);
