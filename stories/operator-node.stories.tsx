import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from '@xyflow/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  OperatorNode,
  type OperatorFlowNode,
} from '../src/components/OperatorNode';
import {
  OperatorInputRuntimeContext,
  type OperatorInputRuntime,
} from '../src/components/operatorInputRuntime';
import {
  NODE_KINDS,
  getDefaultParams,
  type GraphParamValue,
  type NodeKind,
} from '../src/graph';
import type { AudioInputState } from '../src/hooks/useAudioLevel';
import type { VideoInputState } from '../src/hooks/useVideoInput';
import './catalog.css';

const NODE_TYPES = { operator: OperatorNode };

interface NodeCanvasProps {
  kinds: readonly NodeKind[];
  selectedKind?: NodeKind;
  unreachableKinds?: readonly NodeKind[];
  compact?: boolean;
  audioState?: AudioInputState;
  audioMeterLevel?: number;
  videoState?: VideoInputState;
}

function NodeCanvas({
  kinds,
  selectedKind,
  unreachableKinds = [],
  compact = false,
  audioState: initialAudioState = 'demo',
  audioMeterLevel = 0.38,
  videoState: initialVideoState = 'idle',
}: NodeCanvasProps) {
  const initialSelectedId = selectedKind ? `${selectedKind}-0` : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [paramsByNode, setParamsByNode] = useState<Record<string, Record<string, GraphParamValue>>>(() =>
    Object.fromEntries(kinds.map((kind, index) => [`${kind}-${index}`, getDefaultParams(kind)])),
  );
  const [gesture, setGesture] = useState('Select a node or tune an inline value.');
  const [audioState, setAudioState] = useState(initialAudioState);
  const [videoState, setVideoState] = useState(initialVideoState);
  const [videoFacingMode, setVideoFacingMode] = useState<'user' | 'environment'>('user');

  const handleParamChange = useCallback(
    (nodeId: string, paramId: string, value: GraphParamValue) => {
      setParamsByNode((current) => ({
        ...current,
        [nodeId]: {
          ...current[nodeId],
          [paramId]: value,
        },
      }));
      setGesture(`${nodeId} · ${paramId} = ${String(value)}`);
    },
    [],
  );
  const inputRuntime = useMemo<OperatorInputRuntime>(
    () => ({
      audio: {
        inputState: audioState,
        meterLevel: audioMeterLevel,
        enable: () => {
          setAudioState('live');
          setGesture('Microphone simulation started');
          return Promise.resolve();
        },
        disable: () => {
          setAudioState('demo');
          setGesture('Microphone simulation stopped');
        },
      },
      video: {
        inputState: videoState,
        errorMessage: null,
        facingMode: videoFacingMode,
        enable: (facingMode) => {
          setVideoFacingMode(facingMode);
          setVideoState('live');
          setGesture(`${facingMode} camera simulation started`);
          return Promise.resolve();
        },
        disable: () => {
          setVideoState('idle');
          setGesture('Camera simulation stopped');
        },
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
        choose: () => setGesture('File picker simulation opened'),
        clear: () => setGesture('Local file simulation cleared'),
        play: () => setGesture('File playback started'),
        pause: () => setGesture('File playback paused'),
        stop: () => setGesture('File playback stopped'),
        seek: () => setGesture('File playback position changed'),
        enableAudio: () => Promise.resolve(),
        disableAudio: () => setGesture('File audio muted'),
      },
    }),
    [audioMeterLevel, audioState, videoFacingMode, videoState],
  );

  const nodes = useMemo<OperatorFlowNode[]>(
    () => kinds.map((kind, index) => {
      const id = `${kind}-${index}`;
      const columns = compact ? 1 : 4;
      return {
        id,
        type: 'operator',
        position: {
          x: (index % columns) * 285,
          y: Math.floor(index / columns) * 390,
        },
        selected: id === selectedId,
        data: {
          kind,
          params: paramsByNode[id] ?? getDefaultParams(kind),
          reachable: !unreachableKinds.includes(kind),
          onParamChange: handleParamChange,
          onGestureStart: () => setGesture('Editing one undo gesture'),
          onGestureEnd: () => setGesture('Gesture committed'),
          onSelect: () => setSelectedId(id),
        },
      };
    }),
    [
      compact,
      handleParamChange,
      kinds,
      paramsByNode,
      selectedId,
      unreachableKinds,
    ],
  );

  return (
    <section className="vb-story">
      <div className={`vb-node-canvas ${compact ? 'vb-node-canvas--compact' : ''}`}>
        <OperatorInputRuntimeContext.Provider value={inputRuntime}>
          <ReactFlow<OperatorFlowNode>
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            fitView
            fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
            minZoom={0.18}
            maxZoom={1.8}
            snapToGrid
            snapGrid={[12, 12]}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </OperatorInputRuntimeContext.Provider>
      </div>
      <output className="vb-story-event" aria-live="polite">{gesture}</output>
    </section>
  );
}

const meta = {
  title: 'Nodes/Operator Node',
  component: NodeCanvas,
  tags: ['autodocs'],
  args: {
    kinds: NODE_KINDS,
    unreachableKinds: [],
    compact: false,
    audioState: 'demo',
    audioMeterLevel: 0.38,
    videoState: 'idle',
  },
  argTypes: {
    kinds: { control: false },
    selectedKind: { control: false },
    unreachableKinds: { control: false },
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Real production OperatorNode instances hosted by React Flow. Ports, selection, reachability, selects, and inline sliders retain their live graph behavior.',
      },
    },
  },
} satisfies Meta<typeof NodeCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllNodeKinds: Story = {};

export const SelectedNode: Story = {
  args: {
    kinds: ['colorGrade'],
    selectedKind: 'colorGrade',
    compact: true,
  },
};

export const InteractiveXYPad: Story = {
  args: {
    kinds: ['xyPad'],
    compact: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'The node keeps its two-axis performance surface live. Drag it or focus it and use the arrow keys, then connect X and Y independently.',
      },
    },
  },
};

export const TimingAndGenerationNodes: Story = {
  args: {
    kinds: ['beatClock', 'oscillator', 'aiPrompt', 'videoModel'],
  },
  parameters: {
    docs: {
      description: {
        story: 'Timing, modulation, text instruction, and model connection nodes shown with their production ports and live inline controls.',
      },
    },
  },
};

export const MappingAndTransformNodes: Story = {
  args: {
    kinds: ['constant', 'math', 'mapRange', 'smooth', 'transform2d'],
  },
  parameters: {
    docs: {
      description: {
        story: 'The five foundation nodes shown with their production ports and inline controls. Runnable graph examples are available in the Control Math, Smooth Pointer, and Transform Playground stories.',
      },
    },
  },
};

export const CompositingAndRoutingNodes: Story = {
  args: {
    kinds: ['solid', 'threshold', 'mask', 'composite', 'frameSwitch', 'blur'],
  },
  parameters: {
    docs: {
      description: {
        story: 'The core compositing set with production ports and inline controls. Runnable lessons live in Mask & Composite Lab, Beat Switcher, and Audio Soft Focus.',
      },
    },
  },
};

export const SpiralFeedbackNode: Story = {
  args: {
    kinds: ['feedbackSpiral'],
    selectedKind: 'feedbackSpiral',
    compact: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'The production Spiral Feedback card exposes bounded per-second retention, rotation, zoom, and a two-axis center. Its retained frame is internal state, so ordinary graph cycles remain invalid.',
      },
    },
  },
};

export const AutoSelectorNode: Story = {
  args: {
    kinds: ['autoSelector'],
    selectedKind: 'autoSelector',
    compact: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'A deterministic timed selector with interval, configured index count, forward/reverse/shuffle-bag order, and seed controls. Index drives a router while Phase can synchronize downstream effects.',
      },
    },
  },
};

export const StrobeNode: Story = {
  args: {
    kinds: ['strobe'],
    selectedKind: 'strobe',
    compact: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'A flashing-image processor with inline Rate, Open fraction, Amount, and Closed controls. Its internal clock is capped at 3 Hz; an external Phase overrides Rate and must be bounded separately.',
      },
    },
  },
};

export const InactiveNode: Story = {
  args: {
    kinds: ['warp'],
    unreachableKinds: ['warp'],
    compact: true,
  },
};

export const SourcesAndOutput: Story = {
  args: {
    kinds: ['pointer', 'videoInput', 'file', 'audioMixer', 'audioOutput', 'display'],
  },
  parameters: {
    docs: {
      description: {
        story: 'Source, local media, device-presentation, and terminal nodes shown together. Camera and file actions are deterministic simulations.',
      },
    },
  },
};

export const LiveDeviceInputs: Story = {
  args: {
    kinds: ['audioLevel', 'videoInput'],
    compact: false,
    audioState: 'live',
    audioMeterLevel: 0.72,
    videoState: 'live',
  },
  parameters: {
    docs: {
      description: {
        story: 'Live device states with node-local stop controls, a processed Audio Level control meter, and the existing Gain and Floor controls.',
      },
    },
  },
};

export const AudioAnalysisNodes: Story = {
  args: {
    kinds: ['audioSpectrum', 'audioTrigger', 'audioBeat'],
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Audio Spectrum publishes level, bass, mid, and treble controls from the Audio block patched into its left edge, and has no device controls of its own — the microphone starts from Audio Level. Audio Trigger converts a rise above a band’s own recent average into a Trigger gate and a decaying Envelope, and follows the overall level when Value is disconnected. Audio Beat Clock infers tempo from the spacing between triggers and free-runs at Resting BPM until triggers arrive.',
      },
    },
  },
};

export const AudioAnalysisLive: Story = {
  args: {
    kinds: ['audioLevel', 'audioSpectrum'],
    selectedKind: 'audioLevel',
    compact: true,
    audioState: 'live',
    audioMeterLevel: 0.66,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Audio Level in its live microphone state with the Stop mic action inside the node, beside the Audio Spectrum card it feeds. Audio Spectrum carries no device controls of its own; it only analyzes the block patched into its Audio input.',
      },
    },
  },
};

export const AudioAnalysisUnavailable: Story = {
  args: {
    kinds: ['audioLevel', 'audioTrigger'],
    unreachableKinds: ['audioTrigger'],
    compact: true,
    audioState: 'unavailable',
    audioMeterLevel: 0,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Audio Level with microphone capture unavailable, beside an Audio Trigger that no connected Display can reach. Neither state blocks editing.',
      },
    },
  },
};
