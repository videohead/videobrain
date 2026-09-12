import { Camera, Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import './catalog.css';

function AudioMeter({ value }: { value: number }) {
  const activeBars = Math.round(Math.min(1, Math.max(0, value)) * 8);
  return (
    <span className="audio-meter" aria-label={`Audio level ${Math.round(value * 100)} percent`}>
      {Array.from({ length: 8 }, (_, index) => (
        <i
          className={index < activeBars ? 'active' : ''}
          style={{ height: `${5 + index * 1.25}px` }}
          key={index}
        />
      ))}
    </span>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="vb-control-row">
      <span className="vb-control-row-label">{label}</span>
      <div className="vb-control-row-content">{children}</div>
    </div>
  );
}

function ButtonGallery() {
  const [active, setActive] = useState(false);
  return (
    <section className="vb-story vb-story--narrow">
      <div>
        <h1>Action controls</h1>
        <p className="vb-story-intro">
          These are the native button contracts currently used by the toolbar,
          inspector, dialogs, and node library.
        </p>
      </div>
      <div className="vb-story-surface vb-control-list">
        <ControlRow label="Icon">
          <button type="button" className="icon-button" title="Add node">
            <Plus size={14} /><span className="sr-only">Add node</span>
          </button>
          <button
            type="button"
            className={`icon-button ${active ? 'active' : ''}`}
            aria-pressed={active}
            onClick={() => setActive((value) => !value)}
            title="Toggle preview"
          >
            <Camera size={14} /><span className="sr-only">Toggle preview</span>
          </button>
          <button type="button" className="icon-button" disabled title="Unavailable action">
            <Plus size={14} /><span className="sr-only">Unavailable action</span>
          </button>
        </ControlRow>
        <ControlRow label="Text">
          <button type="button" className="text-button"><Copy size={13} /> Duplicate</button>
          <button type="button" className="text-button" disabled>Unavailable</button>
        </ControlRow>
        <ControlRow label="Primary">
          <button type="button" className="primary-button"><Plus size={13} /> Add node</button>
        </ControlRow>
        <ControlRow label="Danger">
          <button type="button" className="danger-button"><Trash2 size={13} /> Delete</button>
        </ControlRow>
      </div>
    </section>
  );
}

function RuntimeGallery() {
  return (
    <section className="vb-story vb-story--narrow">
      <div>
        <h1>Runtime state</h1>
        <p className="vb-story-intro">
          Compact, readable state is shown without starting an engine, audio context,
          camera, or microphone.
        </p>
      </div>
      <div className="vb-story-surface vb-control-list">
        <ControlRow label="Transport">
          <span className="runtime-pill">running</span>
          <span className="runtime-pill">held</span>
        </ControlRow>
        <ControlRow label="Audio level">
          <AudioMeter value={0} />
          <AudioMeter value={0.38} />
          <AudioMeter value={0.86} />
        </ControlRow>
        <ControlRow label="Node status">
          <span className="node-status" aria-label="Active" style={{ '--node-accent': 'var(--acid)' } as React.CSSProperties} />
          <span className="node-status" aria-label="Frame active" style={{ '--node-accent': 'var(--cyan)' } as React.CSSProperties} />
          <span className="node-status" aria-label="Output active" style={{ '--node-accent': 'var(--coral)' } as React.CSSProperties} />
        </ControlRow>
      </div>
    </section>
  );
}

function InputStateGallery() {
  const states = [
    ['Off', 'idle', 'Camera off'],
    ['Requesting', 'requesting', 'Waiting for permission'],
    ['Live', 'live', 'Camera live'],
    ['Blocked', 'denied', 'Permission blocked'],
    ['Unavailable', 'unavailable', 'Camera unavailable'],
    ['Error', 'error', 'Camera error'],
  ] as const;

  return (
    <section className="vb-story vb-story--narrow">
      <div>
        <h1>Device lifecycle</h1>
        <p className="vb-story-intro">
          Static fixtures cover the complete input lifecycle without touching a browser device API.
        </p>
      </div>
      <div className="vb-story-surface vb-control-list">
        {states.map(([label, state, copy]) => (
          <ControlRow label={label} key={state}>
            <div className={`input-state input-state-${state}`} style={{ width: '100%', marginTop: 0 }}>
              <i aria-hidden="true" />
              <strong>{copy}</strong>
              {state === 'live' ? <span>front</span> : null}
            </div>
          </ControlRow>
        ))}
      </div>
    </section>
  );
}

const meta = {
  title: 'Controls/Buttons and Status',
  tags: ['autodocs'],
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component: 'Production button classes, meters, and lifecycle indicators shown as deterministic interface contracts.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActionButtons: Story = { render: () => <ButtonGallery /> };
export const RuntimeStates: Story = { render: () => <RuntimeGallery /> };
export const InputStates: Story = { render: () => <InputStateGallery /> };
