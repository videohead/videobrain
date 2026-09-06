import { createContext } from 'react';
import type { AudioInputState } from '../hooks/useAudioLevel';
import type {
  VideoFacingMode,
  VideoInputState,
} from '../hooks/useVideoInput';
import type { FileInputController } from '../hooks/useFileInput';

export interface OperatorInputRuntime {
  mixerConfig?: import('../hooks/useFileInput').AudioMixerConfig | null;
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
