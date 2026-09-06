import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphEditor } from '../src/components/GraphEditor';
import type { OperatorInputRuntime } from '../src/components/operatorInputRuntime';
import {
  GRAPH_SCHEMA_VERSION,
  createGraphPreset,
  createGraphNode,
  validateConnection,
  type GraphDocument,
  type GraphEdge,
  type GraphEndpoint,
  type GraphParamValue,
  type GraphPosition,
  type GraphPresetId,
} from '../src/graph';
import './catalog.css';

const STORY_INPUT_RUNTIME: OperatorInputRuntime = {
  audio: {
    inputState: 'demo',
    meterLevel: 0.28,
    enable: () => Promise.resolve(),
    disable: () => undefined,
  },
  video: {
    inputState: 'idle',
    errorMessage: null,
    facingMode: 'user',
    enable: () => Promise.resolve(),
    disable: () => undefined,
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
    choose: () => undefined,
    clear: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    stop: () => undefined,
    seek: () => undefined,
    enableAudio: () => Promise.resolve(),
    disableAudio: () => undefined,
  },
};

const edge = (
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): GraphEdge => ({
  id,
  source: { nodeId: sourceNodeId, portId: sourcePortId },
  target: { nodeId: targetNodeId, portId: targetPortId },
});

function createStoryGraph(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('time', { x: 0, y: 30 }, {}, 'clock-story'),
      createGraphNode('plasma', { x: 285, y: 0 }, {}, 'field-story'),
      createGraphNode('colorGrade', { x: 585, y: 0 }, {}, 'grade-story'),
      createGraphNode('display', { x: 900, y: 80 }, {}, 'display-story'),
      createGraphNode('oscillator', { x: 0, y: 390 }, {}, 'idle-story'),
    ],
    edges: [
      edge('clock-field-story', 'clock-story', 'value', 'field-story', 'time'),
      edge('field-grade-story', 'field-story', 'frame', 'grade-story', 'source'),
      edge('grade-display-story', 'grade-story', 'frame', 'display-story', 'source'),
    ],
  };
}

interface GraphFixtureProps {
  playing: boolean;
  presetId: GraphPresetId | 'fixture';
}

function GraphFixture({ playing, presetId }: GraphFixtureProps) {
  const [document, setDocument] = useState(() =>
    presetId === 'fixture' ? createStoryGraph() : createGraphPreset(presetId),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    presetId === 'fixture' ? 'field-story' : null,
  );
  const [event, setEvent] = useState('Tune a node, move it, or reconnect a compatible port.');
  const nextEdgeId = useRef(1);

  const moveNode = (nodeId: string, position: GraphPosition) => {
    setDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, position } : node),
    }));
  };

  const deleteNode = (nodeId: string) => {
    setDocument((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter(
        (candidate) => candidate.source.nodeId !== nodeId && candidate.target.nodeId !== nodeId,
      ),
    }));
    setSelectedNodeId((current) => current === nodeId ? null : current);
  };

  const disconnect = (edgeId: string) => {
    setDocument((current) => ({
      ...current,
      edges: current.edges.filter((candidate) => candidate.id !== edgeId),
    }));
  };

  const connect = (source: GraphEndpoint, target: GraphEndpoint) => {
    const validation = validateConnection(document, source, target);
    if (validation.valid) {
      setDocument((current) => ({
        ...current,
        edges: [
          ...current.edges,
          { id: `story-edge-${nextEdgeId.current++}`, source, target },
        ],
      }));
      setEvent(`Connected ${source.nodeId} to ${target.nodeId}`);
    }
    return validation;
  };

  const changeParam = (nodeId: string, paramId: string, value: GraphParamValue) => {
    setDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId
        ? { ...node, params: { ...node.params, [paramId]: value } }
        : node),
    }));
    setEvent(`${nodeId} · ${paramId} = ${String(value)}`);
  };

  return (
    <section className="vb-story">
      <div className="vb-graph-canvas">
        <GraphEditor
          document={document}
          selectedNodeId={selectedNodeId}
          playing={playing}
          inputRuntime={STORY_INPUT_RUNTIME}
          onMoveNode={moveNode}
          onDeleteNode={deleteNode}
          onDisconnect={disconnect}
          onConnect={connect}
          onSelectNode={setSelectedNodeId}
          onParamChange={changeParam}
          onGestureStart={() => setEvent('Editing one undo gesture')}
          onGestureEnd={() => setEvent('Gesture committed')}
          onConnectionRejected={(message) => setEvent(message)}
        />
      </div>
      <output className="vb-story-event" aria-live="polite">{event}</output>
    </section>
  );
}

const meta = {
  title: 'Workspace/Graph Editor',
  component: GraphFixture,
  tags: ['autodocs'],
  args: {
    playing: true,
    presetId: 'fixture',
  },
  argTypes: {
    presetId: { control: false },
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The production graph editor with a deterministic five-node fixture. It exercises typed ports, reachability, selection, movement, reconnection, and inline parameters without starting the GPU or any device.',
      },
    },
  },
} satisfies Meta<typeof GraphFixture>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunningPatch: Story = {};

export const PausedPatch: Story = {
  args: { playing: false },
};

export const ControlMathExample: Story = {
  args: { presetId: 'control-math' },
  parameters: {
    docs: {
      description: {
        story: 'A complete Constant → Math → Map Range control chain crossfades two animated sources before Display.',
      },
    },
  },
};

export const SmoothPointerExample: Story = {
  args: { presetId: 'smooth-pointer' },
  parameters: {
    docs: {
      description: {
        story: 'Pointer X is remapped, smoothed with separate rise and fall times, then routed into Transform 2D translation.',
      },
    },
  },
};

export const TransformPlaygroundExample: Story = {
  args: { presetId: 'transform-playground' },
  parameters: {
    docs: {
      description: {
        story: 'XY Pad controls mapped X/Y translation, an oscillator controls mapped rotation, and Constant holds scale on a complete frame path.',
      },
    },
  },
};

export const MaskAndCompositeLabExample: Story = {
  args: { presetId: 'mask-composite-lab' },
  parameters: {
    docs: {
      description: {
        story: 'An animated Threshold frame becomes a matte for Mask, then Composite layers the cutout over a Solid background on a complete Display path.',
      },
    },
  },
};

export const BeatSwitcherExample: Story = {
  args: { presetId: 'beat-switcher' },
  parameters: {
    docs: {
      description: {
        story: 'Beat Clock bar phase is mapped to indices 0–3 so Frame Switch selects each of four animated sources in tempo.',
      },
    },
  },
};

export const LiveCutLabExample: Story = {
  args: { presetId: 'live-cut-lab' },
  parameters: {
    docs: {
      description: {
        story: 'A seeded Auto Selector visits four permission-free sources in shuffle-bag order. Its Index chooses Frame Switch while its 1.5-second Phase drives a softened invert Strobe at about 0.67 cycles per second before Color Grade and Display. This story contains flashing imagery.',
      },
    },
  },
};

export const AudioSoftFocusExample: Story = {
  args: { presetId: 'audio-soft-focus' },
  parameters: {
    docs: {
      description: {
        story: 'Audio Level stays a scalar control: Map Range converts its deterministic demo pulse or live microphone level into a 0–18 pixel Blur radius.',
      },
    },
  },
};

export const SpiralFeedbackLabExample: Story = {
  args: { presetId: 'spiral-feedback-lab' },
  parameters: {
    docs: {
      description: {
        story: 'A moving Cells frame feeds Spiral Feedback, where the retained prior output is rotated and zoomed before it is blended with the live source. XY Pad moves the center, Feedback stays bounded below full retention, and returning to frame zero deterministically discards and re-seeds the history.',
      },
    },
  },
};
