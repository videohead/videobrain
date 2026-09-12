import { useEffect, useRef } from 'react';
import { ExternalLink, GitFork, Keyboard, X } from 'lucide-react';
import { GRAPH_PRESETS, OPERATOR_DEFINITIONS } from '../graph';
import { DOMAIN_LABELS } from './operatorMeta';

const REPOSITORY_URL = 'https://github.com/blechdom/videobrain';
const ROADMAP_URL = `${REPOSITORY_URL}/blob/main/docs/FUTURE_DEVELOPMENT.md`;
const MODEL_CONNECTORS_URL = `${REPOSITORY_URL}/blob/main/docs/MODEL_CONNECTORS.md`;
const COMPONENT_CATALOG_URL = 'https://videobrain.org/storybook/';

const plannedAreas = [
  {
    title: 'Control and mapping',
    items:
      'Compare, logic, gates, triggers, envelopes, counters, timers, sequencing, vectors, and automation curves',
  },
  {
    title: 'Media and compositing',
    items:
      'Image/video files, screen capture, shapes, text, color keying, displacement, transitions, and deeper image analysis',
  },
  {
    title: 'Audio',
    items:
      'Audio Device In, pitch and transient analysis, spectral visualization, explicit Audio Output/Monitor, effects, and recording',
  },
  {
    title: 'Devices and networking',
    items:
      'MIDI, gamepad, sensors, OSC and lighting bridges, WebRTC, peer control, publishing, and broadcast gateways',
  },
  {
    title: 'Vision and spatial media',
    items:
      'Motion analysis, contours, face/hand/body tracking, segmentation, depth/IR workflows, point clouds, and zones',
  },
  {
    title: 'Creation and show control',
    items:
      'Reusable subgraphs, launch grids, cue and effect scenes, presets, macro panels, assets, 3D, particles, projection mapping, multi-display, collaboration, and extension packages',
  },
] as const;

interface HelpDialogProps {
  onClose: () => void;
}

const recipes = [
  {
    title: 'Animated color field',
    path: 'Time → Flow Field → Color Grade → Display',
    note: 'Connect Time to a visual time input, then tune hue and contrast.',
  },
  {
    title: 'Pointer-controlled distortion',
    path: 'Pointer X → Warp Amount; visual source → Warp → Display',
    note: 'Move over the output to modulate distortion. Held, Press, and Release support button-driven variations.',
  },
  {
    title: 'Beat-locked motion',
    path: 'Transport Time → Beat Clock → Oscillator Phase → Warp Amount',
    note: 'Set BPM and beats per bar, then use phase, beat pulse, or bar phase to drive a visual.',
  },
  {
    title: 'Two-axis color control',
    path: 'XY Pad X → Color Grade Hue; XY Pad Y → Color Grade Exposure',
    note: 'Drag inside the XY Pad node to shape two visual values at once.',
  },
  {
    title: 'Control arithmetic and mapping',
    path: 'Oscillator → Math A; Constant → Math B; Math → Map Range → Blend Mix',
    note: 'Open Control Math to see a wave scaled by a reusable value, remapped to 0–1, and used as a complete visual crossfade.',
  },
  {
    title: 'Smoothed pointer motion',
    path: 'Pointer X → Map Range → Smooth → Transform 2D X',
    note: 'Open Smooth Pointer, move across the monitor, and compare the separate Rise and Fall response times.',
  },
  {
    title: 'Two-dimensional transform controls',
    path: 'XY Pad → Map Range → Transform 2D X/Y; Oscillator → Map Range → Rotation',
    note: 'Open Transform Playground to move the frame, watch mapped rotation, and change its Constant-driven scale.',
  },
  {
    title: 'Mask and composite fundamentals',
    path: 'Cells → Threshold → Mask; Flow Field → Mask → Composite; Solid → Composite → Display',
    note: 'Open Mask & Composite Lab. Threshold makes a soft black-and-white matte, Mask applies it as alpha, and Composite layers that foreground over a Solid color.',
  },
  {
    title: 'Tempo-locked source switching',
    path: 'Beat Clock Bar → Map Range → Frame Switch Index; four frames → Frame Switch → Display',
    note: 'Open Beat Switcher. Each quarter of the bar selects one source; move Index manually after disconnecting its control wire.',
  },
  {
    title: 'Automatic live cuts (flashing imagery)',
    path: 'Transport Time → Auto Selector; Index → Frame Switch; Phase → Strobe; four frames → Frame Switch → Strobe → Display',
    note: 'Open Live Cut Lab. A seeded shuffle bag visits all four sources before reshuffling, while the shared 1.5-second phase drives a partial invert pulse at about 0.67 cycles per second. Replace any source with Video Input and press Start camera inside that node. See the photosensitivity warning below before raising the pulse rate or amount.',
  },
  {
    title: 'Audio-controlled soft focus',
    path: 'Audio Level → Map Range → Blur Radius; Flow Field → Blur → Display',
    note: 'Open Audio Soft Focus, then press Start mic inside Audio Level. Until a real source is running the node reads silence and the image holds still.',
  },
  {
    title: 'Audio-reactive trails',
    path: 'Flow Field → Trails → Color Grade → Display; Audio Level → Energy, Feedback, and Hue',
    note: 'Open Mic Pulse Trails, then start the microphone inside Audio Level. It emits a 0–1 loudness control; it does not play or pass through sound.',
  },
  {
    title: 'Bass impulses and an implied beat clock',
    path: 'Audio Level Audio → Audio Spectrum; Bass → Audio Trigger → Audio Beat Clock; Envelope → Energy, Beat → Warp Amount, Treble → Feedback',
    note: 'Open Audio Beat Pulse. Audio Level owns the microphone and passes its block to Audio Spectrum, which splits it into bass, mid, and treble; Audio Trigger fires when a band rises above its own recent average, so it stays responsive at any volume; Audio Beat Clock infers tempo from the spacing between those triggers and reports BPM, phase, bar, and confidence. Press Start mic inside Audio Level, or patch a file, to give the analyzer real sound — there is no synthetic beat.',
  },
  {
    title: 'Analyze any audio source, not just the microphone',
    path: 'File Audio → Audio Mixer → Audio Spectrum Audio; Bass → Warp Amount',
    note: 'Open Local File Preview and choose a video or audio file. Audio Spectrum analyzes whatever audio block is patched into its left edge — a file, a mixer, or Audio Level. It has no device controls of its own: the microphone starts from Audio Level. A patched file reads silence until you enable audio output for it, because the browser only starts playback after an explicit action.',
  },
  {
    title: 'Tune what each band listens to',
    path: 'Audio Spectrum band handles → Bass, Mid, and Treble outputs',
    note: 'Drag the three coloured handles on the Audio Spectrum curve. Left and right set each band’s center frequency on a logarithmic scale; up and down set its Q, which is how tightly the band rejects everything either side of that center. A low Q listens broadly, a high Q picks out one narrow region — useful for locking Bass onto a kick while Treble follows only the hats. The same values are on the Bass Hz, Bass Q, Mid Hz, Mid Q, Treble Hz, and Treble Q sliders, and the curve redraws as you move either one.',
  },
  {
    title: 'Spiralling recursive image',
    path: 'Cells → Spiral Feedback → Color Grade → Display; XY Pad → Center X/Y',
    note: 'Open Spiral Feedback Lab. The node rotates and zooms its retained prior output before blending it with the live Cells frame. Feedback is retention after one elapsed visual second and is capped below 1; pause does not advance it, and Return to frame zero discards and deterministically re-seeds history. This is internal state, not permission to wire an ordinary cycle. To spiral live video, replace Cells with Video Input and explicitly start the camera inside that node; the bundled lesson remains permission-free.',
  },
  {
    title: 'Live camera dream',
    path: 'Video Input + Flow Field → Blend → Warp → Color Grade → Display; Pointer X/Y → Warp/Hue',
    note: 'Open Camera Dream, start Video Input, then explore fit, mirror, pointer distortion, and color. The Flow Field keeps the patch visible before camera opt-in.',
  },
  {
    title: 'Model connector preview',
    path: 'AI Chat → Video Model Prompt; visual source → Video Model → Display',
    note: 'Preview is a built-in visual effect that does not interpret the prompt. Local/API adapters consume the text.',
  },
];

export function HelpDialog({ onClose }: HelpDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const currentGroups = (['control', 'frame', 'display'] as const).map(
    (domain) => ({
      label: DOMAIN_LABELS[domain],
      definitions: OPERATOR_DEFINITIONS.filter(
        (definition) => definition.domain === domain,
      ),
    }),
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (document.activeElement === dialogRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop help-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
      >
        <header className="help-header">
          <div>
            <span className="panel-eyebrow">Help &amp; about</span>
            <h1 id="help-title">Explore the Signal Graph</h1>
            <p>
              Connect controls to parameters, text to model-aware nodes, and
              visual frames to processors, ending at Display.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close help"
            title="Close help"
          >
            <X size={17} />
          </button>
        </header>

        <nav className="help-jump-links" aria-label="Help sections">
          <a href="#help-start">Quick start</a>
          <a href="#help-starters">Starters</a>
          <a href="#help-concepts">Concepts</a>
          <a href="#help-nodes">Current nodes</a>
          <a href="#help-recipes">Recipes</a>
          <a href="#help-models">Models</a>
          <a href="#help-io">I/O</a>
          <a href="#help-roadmap">Roadmap</a>
        </nav>

        <div className="help-body">
          <section id="help-start" className="help-section help-callout">
            <span className="help-step">1</span>
            <div>
              <h2>Quick start</h2>
              <ol>
                <li>
                  Open <strong>New patch</strong> to choose a starter, or begin
                  with a blank canvas.
                </li>
                <li>Press <kbd>/</kbd> or choose <strong>Add node</strong>.</li>
                <li>Drag from an output dot to a matching input dot.</li>
                <li>
                  Tune every editable value directly inside its node. Select the
                  node when you also want its spacious Inspector.
                </li>
                <li>
                  Drag inside <strong>XY Pad</strong> to change its X and Y outputs
                  together.
                </li>
                <li>
                  Start protected inputs from the control inside their node.
                  Your browser will then ask for camera or microphone permission.
                </li>
                <li>End a visual path at <strong>Display</strong> to see it live.</li>
              </ol>
            </div>
          </section>

          <section id="help-starters" className="help-section">
            <h2>Starter patches</h2>
            <p className="help-intro">
              The New patch menu replaces the current graph with one of these
              examples. The replacement is undoable. Blank Canvas contains no
              nodes; every other starter has a complete path to Display. Across
              the collection, every current node appears on a reachable branch.
            </p>
            <div className="help-recipe-list">
              {GRAPH_PRESETS.map((preset) => (
                <article key={preset.id}>
                  <h3>{preset.title}</h3>
                  <p>{preset.description}</p>
                </article>
              ))}
            </div>
            <p className="help-note">
              Starting any new patch stops active camera and microphone
              sessions, closes model connections, and clears session-only
              model keys. Device-based starters still use their safe fallback
              until you select the input node and explicitly enable access.
            </p>
          </section>

          <section id="help-concepts" className="help-section">
            <h2>Four signal types, one graph</h2>
            <div className="help-concept-grid">
              <article>
                <i className="help-swatch control" />
                <h3>Control</h3>
                <p>
                  Lightweight numeric values animate speed, color, distortion,
                  feedback, and other parameters.
                </p>
              </article>
              <article>
                <i className="help-swatch frame" />
                <h3>Frame</h3>
                <p>
                  GPU-backed images flow through generators and effects. Frame and
                  control ports intentionally cannot be mixed.
                </p>
              </article>
              <article>
                <i className="help-swatch text" />
                <h3>Text</h3>
                <p>
                  Bounded UTF-8 text carries prompts today and can grow into
                  formatting, labels, and structured text workflows later.
                </p>
              </article>
              <article>
                <i className="help-swatch audio" />
                <h3>Audio</h3>
                <p>
                  Session-owned audio blocks flow from File through Audio Mixer
                  to an explicitly enabled Audio Output.
                </p>
              </article>
            </div>
            <p>
              A parameter is a saved literal value. A compatible wire can drive
              that parameter at runtime; while connected, the incoming signal
              replaces the inline value without erasing it. Disconnect the wire
              to return to the saved setting.
            </p>
            <p className="help-note">
              Display is an output root. The runtime follows its input wires
              backward, orders only those dependencies, and leaves disconnected
              branches inactive. Keep every branch you want to run connected to
              an output path.
            </p>
          </section>

          <section id="help-nodes" className="help-section">
            <h2>Nodes available now</h2>
            <p className="help-intro">
              This list comes directly from the running node registry, so it stays
              current as the studio grows.
            </p>
            <div className="help-node-groups">
              {currentGroups.map(({ label, definitions }) => (
                <article key={label}>
                  <h3>{label}</h3>
                  <ul>
                    {definitions.map((definition) => (
                      <li key={definition.kind}>
                        <strong>{definition.title}</strong>
                        <span>{definition.summary}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section id="help-recipes" className="help-section">
            <h2>Seventeen patches to try</h2>
            <div className="help-recipe-list">
              {recipes.map((recipe) => (
                <article key={recipe.title}>
                  <h3>{recipe.title}</h3>
                  <code>{recipe.path}</code>
                  <p>{recipe.note}</p>
                </article>
              ))}
            </div>
            <p className="help-note">
              <strong>Photosensitivity warning:</strong> Strobe produces flashing
              or rapidly changing imagery. Its internal <strong>Rate</strong> is
              hard-capped at 3 Hz, but a connected <strong>Phase</strong> signal
              overrides Rate and can change faster; keep externally driven phase
              at or below 3 cycles per second. Live Cut Lab runs at about 0.67
              cycles per second. This limit does not make flashing upstream media
              safe. To stop the generated pulse immediately, set{' '}
              <strong>Amount</strong> to 0, or delete Strobe and reconnect Frame
              Switch directly to Color Grade.
            </p>
          </section>

          <section id="help-models" className="help-section">
            <h2>AI Chat and Video Model</h2>
            <p>
              AI Chat emits a typed prompt. A Local/API Video Model adapter
              consumes that prompt and produces a frame. The default Preview
              runtime is a built-in procedural GPU effect: it can transform an
              optional visual source, but it does not interpret prompt text,
              perform model inference, or leave this tab.
            </p>
            <p>
              Local and API runtimes connect only to a trusted, user-run endpoint
              implementing <code>videobrain.frames.v1</code>. Most existing model
              services need a small adapter or gateway; entering an arbitrary
              vendor URL does not make it compatible. HTTP supports one-shot
              generated images, while WebSocket supports streamed responses and
              an explicitly connected live camera source. Other upstream visuals
              affect Preview locally but are not uploaded in this release. Keep
              the model on a path ending at Display to enable network work.
            </p>
            <p className="help-note">
              Endpoint URLs and prompts are saved with the graph. API keys stay
              only in memory for this tab. Camera pixels are sent only when Video
              Input is live, connected directly to Video Model, and its compatible
              WebSocket is open. API mode and session keys require HTTPS/WSS;
              plain transport is limited to a credential-free Local loopback
              adapter. The hosted HTTPS app rejects plaintext WebSocket and
              HTTP model endpoints.
            </p>
            <p>
              <a href={MODEL_CONNECTORS_URL} target="_blank" rel="noreferrer">
                Read the model adapter protocol <ExternalLink size={12} aria-hidden="true" />
              </a>
            </p>
          </section>

          <section id="help-io" className="help-section">
            <h2>Inputs, outputs, and device access</h2>
            <p>
              The current release supports transport and beat timing, the built-in
              XY pad, pointer position/held/press/release, AI prompt text, a
              compatible model adapter, local image/video/audio files, Audio
              Mixer, Audio Output, and opt-in camera and microphone access.
              Browser-native MIDI,
              gamepad, recording, and peer streaming are planned. OSC,
              lighting networks, specialist depth sensors, and native video-sharing
              protocols generally need a small local bridge because browsers cannot
              open arbitrary UDP sockets or native texture-sharing handles.
            </p>
            <p className="help-note">
              Camera and microphone access always require a secure page, an explicit
              action, and browser permission. Camera media stays local unless it
              is directly routed into an explicitly connected networked Video Model.
            </p>
            <h3>Using Audio Level</h3>
            <p>
              <strong>Audio Level owns the microphone.</strong>{' '}
              Press <strong>Start mic</strong> inside the node (or Enable
              microphone in its Inspector), approve the browser prompt, then speak
              or play sound near that input. Its meter and <strong>Level</strong>{' '}
              output show normalized loudness from 0 to 1, and its{' '}
              <strong>Audio</strong> output carries the block itself so Audio
              Spectrum and other analyzers can read it. Analysis never reaches the
              speakers on its own; routing that block into Audio Output monitors
              the microphone aloud and can cause howlround, so use headphones.
            </p>
            <ul>
              <li><strong>Flow Field · Energy</strong> — quiet to energetic motion and color.</li>
              <li><strong>Warp · Amount</strong> — quiet to strong distortion.</li>
              <li><strong>Blend · Mix</strong> — move from input A toward input B.</li>
              <li><strong>Trails · Feedback</strong> — short to long image persistence.</li>
              <li><strong>Blur · Radius</strong> — sharp to soft focus, measured in pixels.</li>
              <li><strong>Color Grade · Hue / Exposure / Saturation</strong> — animate the currently connectable color inputs.</li>
            </ul>
            <p>
              Drag from Audio Level's <strong>Level</strong> output dot to one of
              those control input dots. The cable supplies the target value while
              connected, replacing that target's inline slider value. Audio Level
              applies <code>clamp((input − Floor) × Gain, 0, 1)</code>: Floor rejects
              quiet background noise and Gain controls analysis sensitivity.
              Neither setting is speaker volume. Add Map Range after Level to
              change its output span, then add Smooth when you want slower attack
              or release motion.
            </p>
            <h3>Using Audio Spectrum</h3>
            <p>
              <strong>Audio Spectrum analyzes a patched block, not a device.</strong>{' '}
              Wire <strong>Audio Level · Audio</strong>, <strong>File · Audio</strong>,
              or <strong>Audio Mixer · Audio</strong> into its <strong>Audio</strong>{' '}
              input. It reads the frequency spectrum each visual frame and
              publishes <strong>Level</strong>, <strong>Bass</strong>,{' '}
              <strong>Mid</strong>, and <strong>Treble</strong> controls. An empty
              Audio input reads silence; nothing synthetic stands in for a real
              source.
            </p>
            <p>
              Each band is a resonant filter you can aim. Drag the three coloured
              handles on the response curve: left and right set that band's{' '}
              <strong>center frequency</strong> on a logarithmic scale, and up and
              down set its <strong>Q</strong>, which is how tightly the band
              rejects everything either side of that center. A low Q listens
              broadly; a high Q isolates one narrow region, so Bass can lock onto
              a kick drum while Treble follows only the hats. The Bass, Mid, and
              Treble Hz and Q sliders edit the same saved values, and the curve
              redraws as either changes.
            </p>
            <p>
              Feed a band into <strong>Audio Trigger</strong> to turn a rise above
              its own recent average into a <strong>Trigger</strong> gate and a
              decaying <strong>Envelope</strong>, then feed that trigger into{' '}
              <strong>Audio Beat Clock</strong> for inferred{' '}
              <strong>BPM</strong>, <strong>Phase</strong>, <strong>Beat</strong>,{' '}
              <strong>Bar</strong>, and <strong>Confidence</strong>. The clock
              free-runs at its Resting BPM until triggers arrive.
            </p>
            <h3>Using Video Input</h3>
            <p>
              Press <strong>Start camera</strong> inside the node (or Enable camera
              in its Inspector), approve the browser prompt, then connect
              <strong> Frame</strong> to Display <strong>Source</strong> for the
              simplest check. You can instead route it through Warp, Trails, Color
              Grade, Blend, or Video Model before Display. Selecting a camera node
              or connecting it does not start the device by itself.
            </p>
            <h3>Using File audio</h3>
            <p>
              Add File and choose an image, video, or audio file. Audio-only
              files use the same player controls but provide no Frame output.
              Connect File <strong>Audio</strong> to Audio Output, or place
              Audio Mixer between them for 2, 4, or 8 source ports, per-source
              gain, and Low/Mid/High EQ. Press <strong>Enable audio</strong> on
              Audio Output after connecting the route. Its meter is relative
              dBFS, not calibrated physical SPL.
            </p>
            <p className="help-note">
              <strong>Monitor pacing:</strong> Display sync follows the browser's
              display refresh. The 60 fps and 30 fps choices cap rendering on
              the same synchronized animation clock, and the readout reports a
              rolling measured render rate.
            </p>
          </section>

          <section id="help-roadmap" className="help-section">
            <h2>Not built yet</h2>
            <p className="help-intro">
              These are planned or exploratory areas, not features in the current
              release. The planning document contains the complete prioritized
              node catalog, browser/bridge I/O matrix, example patches, and delivery
              phases.
            </p>
            <div className="help-recipe-list">
              {plannedAreas.map((area) => (
                <article key={area.title}>
                  <h3>{area.title}</h3>
                  <p>{area.items}</p>
                </article>
              ))}
            </div>
            <p>
              <a href={ROADMAP_URL} target="_blank" rel="noreferrer">
                Read the comprehensive node and module plan{' '}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </p>
          </section>

          <section className="help-section help-shortcuts">
            <h2><Keyboard size={15} aria-hidden="true" /> Shortcuts</h2>
            <dl>
              <div><dt>Add/search</dt><dd><kbd>/</kbd></dd></div>
              <div><dt>Play/pause</dt><dd><kbd>Space</kbd></dd></div>
              <div><dt>Undo</dt><dd><kbd>Ctrl/Cmd Z</kbd></dd></div>
              <div><dt>Redo</dt><dd><kbd>Ctrl/Cmd Shift Z</kbd></dd></div>
              <div><dt>Delete selection</dt><dd><kbd>Delete</kbd></dd></div>
              <div><dt>Close a panel</dt><dd><kbd>Esc</kbd></dd></div>
            </dl>
          </section>
        </div>

        <footer className="help-footer">
          <div>
            <strong>VideoBrain</strong>
            <span>Browser-native visual signal studio · proof of concept</span>
          </div>
          <div className="help-footer-links">
            <a href={COMPONENT_CATALOG_URL} target="_blank" rel="noreferrer">
              Component catalog <ExternalLink size={12} aria-hidden="true" />
            </a>
            <a href={ROADMAP_URL} target="_blank" rel="noreferrer">
              Full roadmap <ExternalLink size={12} aria-hidden="true" />
            </a>
            <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              <GitFork size={13} aria-hidden="true" /> Contribute on GitHub
            </a>
          </div>
        </footer>
      </section>
    </div>
  );
}
