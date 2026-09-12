import type { Meta, StoryObj } from '@storybook/react-vite';
import { DOMAIN_ACCENTS, OPERATOR_META } from '../src/components/operatorMeta';
import type { NodeKind } from '../src/graph';
import './catalog.css';

const SURFACE_TOKENS = [
  ['Canvas', '--bg', '#080a0f'],
  ['Panel', '--surface', '#10131a'],
  ['Raised panel', '--surface-raised', '#161a22'],
  ['Soft surface', '--surface-soft', '#1c2029'],
  ['Divider', '--line', '#292e39'],
  ['Primary ink', '--ink', '#f3f5ed'],
  ['Muted ink', '--muted', '#9299a7'],
  ['Dim ink', '--dim', '#656c78'],
] as const;

const SIGNAL_TOKENS = [
  ['Control signal', '--control', DOMAIN_ACCENTS.control],
  ['Frame signal', '--frame', DOMAIN_ACCENTS.frame],
  ['Output', '--coral', DOMAIN_ACCENTS.display],
  ['Primary action', '--acid', '#d8ff5f'],
  ['Danger', '--danger', '#ff6b73'],
  ['Violet', '--violet', '#a88cff'],
] as const;

const SPACING = [4, 8, 12, 16, 24, 32, 48, 64] as const;

function TokenGrid({ tokens }: { tokens: readonly (readonly [string, string, string])[] }) {
  return (
    <div className="vb-story-grid">
      {tokens.map(([label, token, fallback]) => (
        <article className="vb-token-card" key={token}>
          <div
            className="vb-token-swatch"
            style={{ '--vb-story-swatch': `var(${token}, ${fallback})` } as React.CSSProperties}
          />
          <div className="vb-token-copy">
            <strong>{label}</strong>
            <code>{token}</code>
          </div>
        </article>
      ))}
    </div>
  );
}

function ColorFoundations() {
  return (
    <section className="vb-story">
      <div>
        <h1>VideoBrain color system</h1>
        <p className="vb-story-intro">
          Neutral surfaces keep dense patches readable. Signal colors communicate
          compatibility, while each node family retains its own live accent.
        </p>
      </div>
      <div>
        <h2>Surfaces and text</h2>
        <TokenGrid tokens={SURFACE_TOKENS} />
      </div>
      <div>
        <h2>Signals and actions</h2>
        <TokenGrid tokens={SIGNAL_TOKENS} />
      </div>
    </section>
  );
}

function NodeAccents() {
  return (
    <section className="vb-story">
      <div>
        <h1>Node accents</h1>
        <p className="vb-story-intro">
          Every registered node receives one accent used for its header, live state,
          parameter tracks, focus, and graph overview.
        </p>
      </div>
      <div className="vb-story-grid">
        {(Object.entries(OPERATOR_META) as [NodeKind, (typeof OPERATOR_META)[NodeKind]][]).map(
          ([kind, meta]) => {
            const Icon = meta.icon;
            return (
              <article className="operator-tile" key={kind} style={{ '--node-accent': meta.accent } as React.CSSProperties}>
                <span className="operator-icon" aria-hidden="true"><Icon /></span>
                <span className="operator-copy">
                  <strong className="operator-name">{meta.shortLabel}</strong>
                  <span className="operator-description">{kind}</span>
                </span>
                <code className="operator-add">{meta.accent}</code>
              </article>
            );
          },
        )}
      </div>
    </section>
  );
}

function TypeAndRhythm() {
  return (
    <section className="vb-story">
      <div>
        <h1>Typography and rhythm</h1>
        <p className="vb-story-intro">
          Humanist interface text carries actions and descriptions; compact monospace
          labels carry machine state, identifiers, ports, and measurements.
        </p>
      </div>
      <div className="vb-story-surface vb-type-list">
        <div className="vb-type-role"><code>brand</code><span className="brand-name">VideoBrain</span></div>
        <div className="vb-type-role"><code>panel title</code><span className="panel-title">Live output</span></div>
        <div className="vb-type-role"><code>section label</code><span className="section-label">Parameters</span></div>
        <div className="vb-type-role"><code>node title</code><span className="node-title">Color Grade</span></div>
        <div className="vb-type-role"><code>port</code><span className="port-row">Frame · frame.rgba</span></div>
        <div className="vb-type-role"><code>runtime</code><span className="runtime-pill">running</span></div>
      </div>
      <div className="vb-story-surface vb-spacing-list">
        <h2>Fixture spacing scale</h2>
        {SPACING.map((space) => (
          <div className="vb-spacing-row" key={space}>
            <code>{space}px</code>
            <i style={{ '--vb-story-space': `${space}px` } as React.CSSProperties} />
          </div>
        ))}
      </div>
    </section>
  );
}

const meta = {
  title: 'Foundations/Visual Language',
  tags: ['autodocs'],
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component: 'The production color, type, signal, and spacing language used throughout the graph studio.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colors: Story = { render: () => <ColorFoundations /> };
export const OperatorAccents: Story = { render: () => <NodeAccents /> };
export const TypographyAndSpacing: Story = { render: () => <TypeAndRhythm /> };
