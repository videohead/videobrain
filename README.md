# VideoBrain

VideoBrain is a browser-native visual signal studio. Its **Signal Graph** combines typed control, text, frame, and audio paths with a multipass GPU renderer and browser audio runtime in one static web application.

The proof of concept opens into a working composition and runs locally without an account, backend, or device permission. Connect signal nodes to visual parameters, rewire frame processors, tune values directly in the nodes, and watch the result update live.

## What is included

- Typed `control.f32`, `text.utf8`, `frame.rgba`, and `audio.block` connections
- Local image, video, and audio files with browser playback controls
- Audio Mixer with 2/4/8 source routing, per-source gain, and three-band EQ
- Explicit Audio Output monitoring with relative dBFS metering
- Audio Spectrum FFT analysis of any patched block, with draggable per-band
  center frequency and Q, plus Audio Trigger envelopes and an implied beat clock
- Demand-rooted graph compilation with cycle rejection
- Procedural GPU sources, warp, blend, trails, spiral feedback, internally
  rate-capped strobe processing, color grading, and display
- Solid color, soft thresholding, alpha masks, Porter-Duff compositing,
  four-input frame switching, and control-driven blur
- Transport/beat clocks, deterministic automatic source selection, oscillator,
  pointer position/held/press/release, editable XY pad, and opt-in microphone
  controls
- Reusable Constant, Math, Map Range, and Smooth control building blocks
- Opt-in live camera frames with facing, fit, and mirror controls
- Transform 2D with translation, scale, rotation, pivot, and edge modes
- AI Chat prompt text and a Video Model node with a permission-free built-in
  visual preview plus compatible user-run local/API adapter modes
- Live WebGL2 output with play, pause, reset, fullscreen, and selectable
  display-synced/60/30 fps monitor pacing
- Node creation, connection, deletion, movement, and parameter editing
- Searchable, collapsible node categories backed by the operator registry
- A New patch menu with Blank Canvas and sixteen complete starter graphs
- Always-visible inline sliders, selects, and XY controls synchronized with the inspector
- Undo and redo for project edits
- Versioned local autosave plus JSON import and export
- Transactional import validation with bounded graph and GPU resource budgets
- Responsive editor layout and keyboard shortcuts
- Built-in Help & About guide with quick-start recipes and contribution links
- A production component catalog at [videobrain.org/storybook](https://videobrain.org/storybook/)
- Static AWS deployment through private S3, CloudFront, ACM, Route 53, and GitHub OIDC

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open the URL printed by Vite. The production build is fully static:

```bash
npm run verify
npm run preview
```

Run the component catalog separately during UI development:

```bash
npm run storybook
```

Build the complete deployable site, including the catalog, with
`npm run build:deploy`.

## Controls

| Action | Shortcut |
| --- | --- |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` |
| Delete selected nodes or links | `Backspace` / `Delete` |
| Play or pause | `Space` while focus is outside a form control |
| Open node search | `/` |
| Dismiss a panel | `Escape` |

### Live camera and audio controls

Camera and microphone input are optional and begin only after pressing the
explicit start control inside the corresponding node (the same controls also
appear in the Inspector). Merely adding, selecting, or wiring a device node does
not start it. For a direct camera check, connect **Video Input · Frame** to
**Display · Source**, press **Start camera**, and approve the browser prompt.

**Audio Level owns the microphone session.** It emits a normalized `control.f32`
Level value calculated as `clamp((input - Floor) * Gain, 0, 1)`. Floor rejects
quiet background noise and Gain changes analysis sensitivity; neither setting is
speaker volume. Connect **Audio Level · Level** to any compatible control input,
including **Flow Field · Energy**, **Warp · Amount**, **Blend · Mix**, **Trails ·
Feedback**, or **Color Grade · Hue/Exposure/Saturation**. While connected, the
incoming control replaces that target's inline slider value. Audio Level also
publishes the captured **Audio** block so analyzers can read it. Analysis never
reaches the speakers by itself; routing that block into **Audio Output** monitors
the microphone aloud and can cause howlround, so use headphones. With no
microphone running, Audio Level reads silence — there is no synthetic fallback.

### Audio analysis: spectrum, triggers, and an implied beat clock

**Audio Spectrum** has no device controls of its own. Patch any `audio.block`
into its **Audio** input — **Audio Level · Audio**, **File · Audio**, or **Audio
Mixer · Audio** — and it publishes Level, Bass, Mid, and Treble controls. An
empty input reads silence.

Each band is a resonant filter with its own center frequency and Q. Drag the
three coloured handles on the node's response curve: left and right set the
center frequency on a logarithmic scale, up and down set Q, which is how tightly
the band rejects everything either side of that center. A low Q listens broadly;
a high Q isolates one narrow region, so Bass can lock onto a kick while Treble
follows only the hats. The same values are available on the Bass/Mid/Treble Hz
and Q sliders, and the curve redraws as either changes.

**Audio Trigger** turns a band's rise above its own rolling average into a
Trigger gate and a decaying Envelope, so it stays responsive at any volume
without re-tuning the threshold. **Audio Beat Clock** infers tempo from the
spacing between those triggers and reports Phase, Beat, Bar, BPM, and Confidence,
free-running at its Resting BPM until triggers arrive. Open the **Audio Beat
Pulse** starter for the complete path.

The built-in Signal Graph's Video Model starts in a procedural preview that
performs no model inference or network request, so the default project requests
neither device permission nor a server connection.

### Local file audio

File exposes **Frame** and **Audio** outputs. Connect **Audio** to **Audio
Output**, then press **Enable audio** in that node. Browser audio remains muted
until explicit activation. Image files provide no audio; audio-only files use
the same File player controls without a Frame signal. The meters show relative
dBFS and are not calibrated physical SPL measurements. Play, pause, stop, and
seek remain controlled by the File node.

Use **Audio Mixer** between File and Audio Output when combining sources. Set
Sources to 2, 4, or 8, connect the corresponding Audio ports, adjust each
source gain, and use Low EQ, Mid EQ, and High EQ for the shared three-band tone
shaping.

Use **New patch** to start from Blank Canvas, Full Studio, Beat-Synced
Color, Spiral Feedback Lab, Two-World Mixer, Control Math, Smooth Pointer,
Transform Playground, Mask & Composite Lab, Beat Switcher, Live Cut Lab, Audio
Soft Focus, Pointer Bend, Mic Pulse Trails, Camera Dream, or Prompted Visual
Preview, or Local File Preview. Local File Preview uses an explicit file picker
and keeps the selected image, video, or audio in this browser session. The graph
replacement is undoable, but it stops active camera and
microphone sessions, closes model connections, and clears session-only model
keys. Device-based starters remain in fallback mode until access is explicitly
enabled again.

### Teaching examples

| Starter | Nodes it teaches | Visible result |
| --- | --- | --- |
| Control Math | Constant, Math, Map Range | A scaled oscillator is remapped to crossfade two visual sources. |
| Smooth Pointer | Map Range, Smooth, Transform 2D | Pointer X becomes centered translation with separate rise and fall response. |
| Transform Playground | Constant, Map Range, Transform 2D | XY position, automatic rotation, scale, pivot, and edge behavior remain immediately editable. |
| Mask & Composite Lab | Solid, Threshold, Mask, Composite | An animated matte cuts out a frame before it is layered over a flat background. |
| Beat Switcher | Frame Switch | Bar phase selects four visibly different frame sources in tempo. |
| Live Cut Lab | Auto Selector, Strobe | A seeded shuffle bag cuts among four sources while shared phase drives a softened invert pulse. |
| Audio Soft Focus | Blur | Demo or microphone energy is mapped to a 0–18 pixel blur radius. |
| Spiral Feedback Lab | Spiral Feedback | The retained prior output rotates and zooms around an XY-controlled center before the live frame is blended in. |

Every teaching node in this set is connected to a reachable graph branch that
ends at Display; none of these starters contains a disconnected demonstration.

Live Cut Lab is permission-free and uses a 1.5-second interval, or about 0.67
pulse cycles per second. Auto Selector emits both the selected integer index and
normalized phase; its seeded shuffle-bag order visits each configured index once
before reshuffling. Replace any one source with **Video Input · Frame**, then
press **Start camera** inside Video Input to incorporate live video.

**Photosensitivity warning:** Strobe creates flashing or rapidly changing
imagery. Its internal Rate is hard-capped at 3 Hz, but a connected Phase input
overrides Rate and can change faster; keep external phase at or below 3 cycles
per second. This does not make flashing source footage safe. Set Amount to 0 for
an immediate visual bypass, or delete Strobe and reconnect its source directly
to the next processor.

Spiral Feedback is a purpose-built internally stateful image effect, not a
general graph-delay primitive. Feedback means the fraction retained after one
elapsed visual second and is bounded below full retention. Pause leaves its
history unchanged; **Return to frame zero** discards that history and
deterministically seeds it again from the frame-zero source. These rules keep
the result tunable while ordinary graph cycles remain invalid.

The bundled Spiral Feedback Lab stays permission-free. To spiral a live incoming
image instead, replace its Cells connection with **Video Input · Frame**, then
press **Start camera** inside Video Input and approve the browser prompt. Adding
or wiring the camera node alone never starts it.

Local/API model modes connect only to endpoints implementing the
`videobrain.frames.v1` adapter contract; arbitrary vendor endpoints are not
directly compatible. Endpoint URLs and prompts are project data, while API keys
remain in memory for the current tab and are never saved or exported. Camera
frames leave the tab only when Video Input is live, directly connected to a
Video Model, and its compatible WebSocket is connected. API mode and any
session key require HTTPS/WSS; credential-free plain transport is limited to a
Local loopback adapter. The hosted secure page rejects both `ws://` and
`http://` model endpoints, so use a local development page for a plaintext
loopback endpoint or give the adapter TLS.
Other visual inputs affect Preview mode locally but are not uploaded by this
release.

The monitor's frame-pacing menu defaults to **Display sync**, which renders once
per browser display callback. Choose **60 fps** or **30 fps** to cap GPU
work while keeping playback time synchronized. Fixed modes skip render slots on
the same animation-frame scheduler, so delayed callbacks do not accumulate timer
drift. The FPS readout is a rolling measurement of monitor renders.

## Planning and unbuilt modules

Read the [future-development catalog](docs/FUTURE_DEVELOPMENT.md) for the full
planning document. Its [quick unbuilt index](docs/FUTURE_DEVELOPMENT.md#quick-index-what-is-not-built-yet)
summarizes the next control/mapping, media, compositing, audio, device/network,
vision, 3D, show-control, and output modules. The detailed tables below that
index mark every item as implemented, next, planned, exploratory, bridge-backed,
or outside the direct browser boundary. The document also includes an I/O
matrix, dozens of example patches, delivery phases, security constraints, and a
contribution checklist.

## Project structure

```text
src/graph/       Serializable graph model, registry, validation, and planning
src/engine/      WebGL2 programs, texture passes, feedback state, and presentation
src/store/       Commands, history, persistence, and session state
src/components/  Editor, nodes, inspector, monitor, and application chrome
stories/         Production-component examples and state matrices
docs/            Architecture and MVP decision records
infra/           CloudFormation for the production static site
scripts/         Infrastructure bootstrap and manual deployment helpers
```

The editor never owns GPU resources, and the renderer never mutates the project. See [the architecture](docs/ARCHITECTURE.md), [the graph protocol strategy](docs/GRAPH_PROTOCOL_STRATEGY.md), [the MVP decision](docs/MVP.md), the [model connector protocol](docs/MODEL_CONNECTORS.md), and the comprehensive [future-development catalog](docs/FUTURE_DEVELOPMENT.md) for the reasoning, compatibility rules, node roadmap, I/O options, adapter boundary, and example patches.

Use the question-mark button in the app for a quick start, signal concepts, current nodes, starter recipes, device guidance, and direct contribution links.

## Deployment

Pull requests and pushes are verified by GitHub Actions. A push to `main` deploys only when the four AWS repository variables described in [the infrastructure guide](infra/README.md) are present. The workflow uses short-lived GitHub OIDC credentials; it does not require stored AWS access keys.

The infrastructure helper provisions the production stack for `videobrain.org` after checking the hosted zone and existing apex records. Review its preflight output before confirming any AWS change.

## Status

This is an intentionally focused proof of concept. The built-in Video Model preview is a visual stand-in, not an inference runtime. Three-dimensional scenes, arbitrary scripting, custom shaders, bundled model execution, cloud projects, collaboration, and sample-accurate audio processing remain outside the first release.
