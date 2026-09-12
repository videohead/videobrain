import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandPalette as CommandPaletteComponent } from '../src/components/CommandPalette';
import { HelpDialog } from '../src/components/HelpDialog';
import { Inspector } from '../src/components/Inspector';
import { NewPatchMenu } from '../src/components/NewPatchMenu';
import { OperatorLibrary } from '../src/components/OperatorLibrary';
import {
  GRAPH_SCHEMA_VERSION,
  createGraphNode,
  getGraphPreset,
  type GraphDocument,
  type GraphNode,
  type GraphParams,
  type GraphParamValue,
  type NodeKind,
} from '../src/graph';
import type { AudioInputState } from '../src/hooks/useAudioLevel';
import type {
  VideoModelRuntime,
  VideoModelSessionState,
} from '../src/hooks/useVideoModel';
import type {
  VideoFacingMode,
  VideoInputState,
} from '../src/hooks/useVideoInput';
import './catalog.css';

interface InspectorFixtureProps {
  kind?: NodeKind;
  audioState?: AudioInputState;
  videoState?: VideoInputState;
  videoError?: string | null;
  facingMode?: VideoFacingMode;
  params?: GraphParams;
  modelState?: VideoModelSessionState;
  modelError?: string | null;
  modelHasCredential?: boolean;
}

function InspectorFixture({
  kind,
  audioState = 'idle',
  videoState = 'idle',
  videoError = null,
  facingMode = 'user',
  params = {},
  modelState,
  modelError = null,
  modelHasCredential = false,
}: InspectorFixtureProps) {
  const [node, setNode] = useState<GraphNode | null>(() =>
    kind ? createGraphNode(kind, { x: 0, y: 0 }, params, `${kind}-inspector`) : null,
  );
  const [currentAudioState, setCurrentAudioState] = useState(audioState);
  const [currentVideoState, setCurrentVideoState] = useState(videoState);
  const [currentFacingMode, setCurrentFacingMode] = useState(facingMode);
  const [currentModelState, setCurrentModelState] =
    useState<VideoModelSessionState>(
      modelState ?? (params.runtime === 'preview' ? 'preview' : 'idle'),
    );
  const [hasModelCredential, setHasModelCredential] =
    useState(modelHasCredential);

  const updateParam = (nodeId: string, paramId: string, value: GraphParamValue) => {
    if (
      paramId === 'facing' &&
      (value === 'user' || value === 'environment')
    ) {
      setCurrentFacingMode(value);
    }
    setNode((current) => current?.id === nodeId
      ? { ...current, params: { ...current.params, [paramId]: value } }
      : current);
  };

  const promptNode = createGraphNode(
    'aiPrompt',
    { x: 0, y: 0 },
    { text: 'A softly evolving field of spectral light' },
    'prompt-fixture',
  );
  const graphDocument: GraphDocument = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes:
      node?.kind === 'videoModel'
        ? [promptNode, node]
        : node
          ? [node]
          : [],
    edges:
      node?.kind === 'videoModel'
        ? [
            {
              id: 'prompt-model-fixture',
              source: { nodeId: promptNode.id, portId: 'prompt' },
              target: { nodeId: node.id, portId: 'prompt' },
            },
          ]
        : [],
  };
  const videoModelRuntime: VideoModelRuntime = {
    frames: new Map(),
    getSession: () => ({
      state: currentModelState,
      error: modelError,
      hasCredential: hasModelCredential,
      lastFrameAt: currentModelState === 'ready' ? 1 : null,
    }),
    setCredential: (_nodeId, credential) =>
      setHasModelCredential(credential.length > 0),
    connect: () => setCurrentModelState('live'),
    disconnect: () => setCurrentModelState('idle'),
    generate: () => {
      setCurrentModelState('ready');
      return Promise.resolve();
    },
    resetAll: () => {
      setCurrentModelState('idle');
      setHasModelCredential(false);
    },
  };

  return (
    <div className="vb-panel-frame">
      <Inspector
        node={node}
        audioInputState={currentAudioState}
        videoInputState={currentVideoState}
        videoInputError={videoError}
        videoFacingMode={currentFacingMode}
        onParamChange={updateParam}
        onGestureStart={() => undefined}
        onGestureEnd={() => undefined}
        onDelete={() => setNode(null)}
        onDuplicate={(source) => setNode({ ...source, id: `${source.id}-copy` })}
        onEnableMicrophone={() => {
          setCurrentAudioState('live');
          return Promise.resolve();
        }}
        onDisableMicrophone={() => setCurrentAudioState('idle')}
        onEnableCamera={(nextFacingMode) => {
          setCurrentFacingMode(nextFacingMode);
          setCurrentVideoState('live');
          return Promise.resolve();
        }}
        onDisableCamera={() => setCurrentVideoState('idle')}
        graphDocument={graphDocument}
        videoModelRuntime={videoModelRuntime}
      />
    </div>
  );
}

function LibraryFixture() {
  const [event, setEvent] = useState('No node added yet.');
  return (
    <section className="vb-story vb-story--narrow">
      <div className="vb-panel-frame">
        <OperatorLibrary onAdd={(kind) => setEvent(`Add ${kind}`)} />
      </div>
      <output className="vb-story-event" aria-live="polite">{event}</output>
    </section>
  );
}

function CommandPaletteFixture() {
  const [open, setOpen] = useState(true);
  const [event, setEvent] = useState('Search by node title, summary, or identifier.');
  return (
    <div className="vb-modal-story">
      <button type="button" className="primary-button vb-modal-reopen" onClick={() => setOpen(true)}>
        Open command palette
      </button>
      {open ? (
        <CommandPaletteComponent
          onAdd={(kind) => setEvent(`Selected ${kind}`)}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <output className="vb-story-event" aria-live="polite">{event}</output>
    </div>
  );
}

function HelpFixture() {
  const [open, setOpen] = useState(true);
  return (
    <div className="vb-modal-story">
      <button type="button" className="primary-button vb-modal-reopen" onClick={() => setOpen(true)}>
        Open help
      </button>
      {open ? <HelpDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function NewPatchMenuFixture() {
  const [event, setEvent] = useState('Choose a blank or example starter.');
  return (
    <section className="vb-story vb-story--narrow">
      <header
        className="topbar"
        style={{ gridTemplateColumns: 'auto 1fr auto', minHeight: 58 }}
      >
        <button type="button" className="text-button">
          Previous action
        </button>
        <span />
        <div className="topbar-actions">
          <NewPatchMenu
            onSelect={(presetId) =>
              setEvent('Selected ' + getGraphPreset(presetId).title)
            }
          />
          <button type="button" className="primary-button">
            Next action
          </button>
        </div>
      </header>
      <output className="vb-story-event" aria-live="polite">{event}</output>
    </section>
  );
}

const meta = {
  title: 'Panels/Studio Panels',
  tags: ['autodocs'],
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component: 'Production panels in deterministic local-state fixtures. Device buttons simulate lifecycle changes and never call browser permission APIs.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyInspector: Story = {
  render: () => <InspectorFixture />,
};

export const NumericInspector: Story = {
  render: () => <InspectorFixture kind="plasma" />,
};

export const BeatClockInspector: Story = {
  render: () => (
    <InspectorFixture
      kind="beatClock"
      params={{ bpm: 124, beatsPerBar: 4, pulseWidth: 0.18 }}
    />
  ),
};

export const AIChatInspector: Story = {
  render: () => (
    <InspectorFixture
      kind="aiPrompt"
      params={{
        text: 'A field of luminous ribbons responding to a steady pulse',
        negative: 'flicker, lettering, abrupt cuts',
      }}
    />
  ),
};

export const ModelPreview: Story = {
  render: () => (
    <InspectorFixture
      kind="videoModel"
      params={{ runtime: 'preview' }}
      modelState="preview"
    />
  ),
};

export const ModelApiReady: Story = {
  render: () => (
    <InspectorFixture
      kind="videoModel"
      params={{
        runtime: 'api',
        transport: 'http',
        endpoint: 'https://models.example.test/generate',
        model: 'studio-video-v1',
      }}
      modelState="ready"
      modelHasCredential
    />
  ),
};

export const ModelStreamLive: Story = {
  render: () => (
    <InspectorFixture
      kind="videoModel"
      params={{
        runtime: 'local',
        transport: 'websocket',
        endpoint: 'ws://127.0.0.1:8189/v1/stream',
      }}
      modelState="live"
    />
  ),
};

export const CameraOff: Story = {
  render: () => <InspectorFixture kind="videoInput" />,
};

export const CameraLive: Story = {
  render: () => <InspectorFixture kind="videoInput" videoState="live" />,
};

export const CameraBlocked: Story = {
  render: () => (
    <InspectorFixture
      kind="videoInput"
      videoState="denied"
      videoError="Camera access was blocked for this site."
    />
  ),
};

export const NodeLibrary: Story = {
  render: () => <LibraryFixture />,
};

export const CommandPalette: Story = {
  render: () => <CommandPaletteFixture />,
  parameters: { layout: 'fullscreen' },
};

export const NewPatchStarters: Story = {
  render: () => <NewPatchMenuFixture />,
};

export const HelpAndAbout: Story = {
  render: () => <HelpFixture />,
  parameters: { layout: 'fullscreen' },
};
