import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeParameterControls } from '../src/components/NodeParameterControls';
import {
  getDefaultParams,
  getOperatorDefinition,
  type GraphParamValue,
} from '../src/graph';
import './catalog.css';

type ParameterProps = Parameters<typeof NodeParameterControls>[0];

function StatefulParameters({ definition, nodeId, params }: ParameterProps) {
  const [values, setValues] = useState<Record<string, GraphParamValue>>(() => ({ ...params }));
  const [gesture, setGesture] = useState('Ready for input');

  return (
    <section className="vb-story vb-story--narrow">
      <div>
        <h1>{definition.title} parameters</h1>
        <p className="vb-story-intro">
          This is the same metadata-driven control surface rendered inside a graph node.
          Numeric values are sliders, finite choices are compact selects, and text
          instructions remain editable in place.
        </p>
      </div>
      <div
        className="vb-inline-control-frame"
        style={{ '--node-accent': definition.domain === 'control' ? 'var(--acid)' : 'var(--cyan)' } as React.CSSProperties}
      >
        <NodeParameterControls
          nodeId={nodeId}
          definition={definition}
          params={values}
          onParamChange={(_changedNodeId, paramId, value) => {
            setValues((current) => ({ ...current, [paramId]: value }));
            setGesture(`${paramId} = ${String(value)}`);
          }}
          onGestureStart={() => setGesture('Editing one undo gesture')}
          onGestureEnd={() => setGesture('Gesture committed')}
        />
      </div>
      <output className="vb-story-event" aria-live="polite">{gesture}</output>
    </section>
  );
}

const flowDefinition = getOperatorDefinition('plasma');

const meta = {
  title: 'Controls/Inline Node Parameters',
  component: NodeParameterControls,
  tags: ['autodocs'],
  render: (args) => <StatefulParameters {...args} />,
  args: {
    nodeId: 'field-story',
    definition: flowDefinition,
    params: getDefaultParams('plasma'),
    onParamChange: () => undefined,
    onGestureStart: () => undefined,
    onGestureEnd: () => undefined,
  },
  argTypes: {
    nodeId: { control: false },
    definition: { control: false },
    onParamChange: { table: { disable: true } },
    onGestureStart: { table: { disable: true } },
    onGestureEnd: { table: { disable: true } },
    onSelect: { table: { disable: true } },
  },
  parameters: {
    docs: {
      description: {
        component: 'The production inline parameter renderer used by graph nodes. It derives every control from the operator registry and never owns graph state.',
      },
    },
  },
} satisfies Meta<typeof NodeParameterControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NumericSliders: Story = {};

export const MixedParameters: Story = {
  args: {
    nodeId: 'oscillator-story',
    definition: getOperatorDefinition('oscillator'),
    params: getDefaultParams('oscillator'),
  },
};

export const TwoAxisPad: Story = {
  args: {
    nodeId: 'xy-pad-story',
    definition: getOperatorDefinition('xyPad'),
    params: getDefaultParams('xyPad'),
  },
  parameters: {
    docs: {
      description: {
        story: 'Drag anywhere in the pad to edit X and Y together, or use the native axis sliders for precise independent changes. The pad supports arrow keys, with Shift for coarser steps.',
      },
    },
  },
};

export const SourceSelectorButtons: Story = {
  args: {
    nodeId: 'source-selector-story',
    definition: getOperatorDefinition('sourceSelector'),
    params: {
      ...getDefaultParams('sourceSelector'),
      index: 1,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Four colored A/B/C/D buttons select the active frame source. The buttons are a radio group, so arrow keys move the selection and the value readout follows the node accent.',
      },
    },
  },
};

export const BeatClockTiming: Story = {
  args: {
    nodeId: 'beat-clock-story',
    definition: getOperatorDefinition('beatClock'),
    params: {
      ...getDefaultParams('beatClock'),
      bpm: 124,
      beatsPerBar: 4,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'BPM, meter, pulse width, and phase offset are all immediately adjustable on the node.',
      },
    },
  },
};

export const AIChatText: Story = {
  args: {
    nodeId: 'prompt-story',
    definition: getOperatorDefinition('aiPrompt'),
    params: {
      text: 'Bioluminescent ribbons moving slowly through deep blue water',
      negative: 'flicker, lettering, hard cuts',
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Prompt and avoidance text are editable directly in the node and publish through the typed text output.',
      },
    },
  },
};

export const VideoModelControls: Story = {
  args: {
    nodeId: 'model-story',
    definition: getOperatorDefinition('videoModel'),
    params: {
      ...getDefaultParams('videoModel'),
      runtime: 'local',
      strength: 0.82,
      inputFps: 16,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Runtime, transport, endpoint, model ID, image controls, seed, and input cadence are visible before a worker is connected.',
      },
    },
  },
};

export const EnumeratedParameters: Story = {
  args: {
    nodeId: 'camera-story',
    definition: getOperatorDefinition('videoInput'),
    params: getDefaultParams('videoInput'),
  },
  parameters: {
    docs: {
      description: {
        story: 'Changing these presentation choices only updates local story state; no camera permission is requested.',
      },
    },
  },
};

export const BoundaryValues: Story = {
  args: {
    nodeId: 'warp-story',
    definition: getOperatorDefinition('warp'),
    params: {
      amount: 0,
      frequency: 20,
      speed: -3,
    },
  },
};
