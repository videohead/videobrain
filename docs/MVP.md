# VideoBrain Browser MVP

Status: implementation decision for the first end-to-end proof of concept.

## Product question

The MVP must answer one question: can a user build and manipulate a live, convincing visual system entirely in a browser through a node graph?

The demo succeeds when editing the graph feels immediate, control signals visibly animate image parameters, the project survives a reload, and no native helper or rendering service is required.

## Decision

Build a static TypeScript application whose editing and baseline rendering stay client-only, with:

- React and `@xyflow/react` for the editor;
- Zustand for project and session commands;
- WebGL2 for frame generation and processing;
- a small CPU evaluator for scalar timing and interaction controls;
- bounded text parameters/ports for prompt routing;
- an optional session connector for compatible user-run model adapters;
- one visible output canvas driven by the browser display clock;
- versioned JSON plus local storage for persistence.

WebGL2 is the only rendering backend required for the MVP. The runtime will hide it behind a renderer interface so WebGPU can be added without changing graph semantics.

This decision tests the actual product architecture while retaining broad browser reach and static hosting. The built-in visual path avoids remote-renderer latency, cost, authentication, and lifecycle complexity; optional model connections must remain an explicit extension rather than a startup dependency. Browser-local media playback and audio routing are session-owned and require explicit user activation.

## Options considered

| Option | Strengths | Costs and limitations | Decision |
| --- | --- | --- | --- |
| Canvas 2D | Very fast to prototype; simple debugging | Limited shader composition and poor fit for multi-pass visual processing | Use only for editor decoration or fallback messaging |
| WebGL2 visual graph | Broad support; direct texture-to-texture passes; enough capability for rich 2D effects | Manual GPU resource management and shader plumbing | Selected |
| WebGPU visual graph | Modern compute and resource model; strong path to points and simulation | More implementation surface and greater device variance than the POC needs | Add behind the renderer interface later |
| CPU processing in WebAssembly | Portable for algorithms with mature native libraries | Moving full image frames between CPU and GPU undermines the live pipeline | Add selectively, not as the visual backbone |
| Remote desktop runtime | Can expose mature effects quickly | Not standalone; setup and connection failure become part of every demo | Rejected |
| Cloud rendering streamed to the browser | Centralized high-end compute | Persistent cost, latency, media transport, accounts, and operations | Revisit only for workloads that cannot run locally |

## Demo experience

The application opens directly into a working project. The user can:

1. see the animated result immediately;
2. pan, zoom, select, and move nodes;
3. add a node from a searchable palette;
4. replace the graph from New patch with Blank Canvas or one of sixteen complete starters;
5. connect compatible ports and receive clear feedback for invalid connections;
6. edit a node from its visible inline controls or the selected-node inspector;
7. connect a control output to a visual parameter and see it animate;
8. route AI Chat text into Video Model and see its permission-free built-in visual preview;
9. optionally connect Video Model to a compatible local/API adapter;
10. play, pause, reset, choose display/60/30 monitor pacing, and enter a focused output view;
11. undo and redo graph edits;
12. reload the page and recover the saved project;
13. import or export the project as JSON.

The built-in **Signal Graph** is attractive without media permissions or network access. Procedural patterns pass through warp, blend, trails, color, and the Video Model preview into Display, with transport, beat, oscillator, pointer, XY, and audio controls driving the result. Camera and microphone inputs remain optional and activate only after an explicit user action.

## MVP scope

### Editor

- Infinite graph canvas with pan and zoom.
- Select, move, connect, disconnect, create, duplicate, and delete.
- Searchable node palette.
- Accessible New patch menu with Blank Canvas and sixteen validated starter graphs.
- Custom node cards with category, name, typed ports, reachability state, and always-visible parameter controls.
- Inspector with parameter sliders and operator details.
- Distinct visual treatment for `frame.rgba`, `control.f32`, and `text.utf8` connections.
- Toolbar for transport, undo, redo, reset project, import, export, and focused output.
- Keyboard deletion and escape-to-cancel for core interactions.

### Implemented frame nodes

- Video Input with explicit opt-in camera access from its node or Inspector, facing preference, fit, and mirror controls. Adding or wiring the node never starts the device.
- Video Model with a built-in procedural visual preview and compatible WebSocket/HTTP adapter modes.
- Solid Color, Flow Field, and Cells frame producers.
- Warp, Blur, Threshold, Transform 2D, and Color Grade single-frame processors.
- Mask, two-input Blend, Porter-Duff Composite, and four-input Frame Switch
  compositing/routing processors.
- Trails with internally managed previous-frame state.
- Spiral Feedback with bounded per-second retention plus rotation, zoom, and
  center controls applied to its internally retained prior output.
- Strobe with a 0–3 Hz internal clock, externally bindable phase, open fraction,
  mix amount, and black/white/transparent/invert closed-frame modes.
- Display output.

### Implemented control nodes

- Transport Time.
- Beat Clock with phase, beat pulse, and bar phase outputs.
- Auto Selector with deterministic interval, count, forward/reverse/seeded
  shuffle-bag order, plus index and normalized phase outputs.
- Oscillator with sine, triangle, saw, and square waveforms.
- Pointer X/Y position plus Held state and one-tick Press/Release pulses.
- XY Pad with normalized, independently connectable X and Y values.
- Audio Level with deterministic demo input and explicit opt-in microphone analysis. It emits only a normalized visual control, `clamp((input - floor) * gain, 0, 1)`; it intentionally provides no playback, speaker monitoring, recording, or audio pass-through.
- Constant for reusable numeric values.
- Math for add, subtract, multiply, divide, minimum, and maximum operations.
- Map Range for linear remapping with none, clamp, wrap, and fold boundaries.
- Smooth for frame-rate-independent rise/fall filtering with deterministic reset.

Every animatable numeric visual parameter uses the same typed control-port mechanism. The graph does not rely on node-specific animation wiring.

### Implemented text and model connection

- AI Chat provides bounded prompt and negative-prompt editing and emits `text.utf8`.
- Video Model consumes the prompt and emits the latest valid frame. Preview can transform any optional upstream visual; current external transport sends only a directly connected camera over WebSocket.
- Preview mode is an immediate built-in GPU stand-in, not model inference.
- Local/API modes require an endpoint implementing `videobrain.frames.v1`; they do not directly support arbitrary vendor APIs.
- Session API keys are memory-only and excluded from project JSON. API mode and keys require HTTPS/WSS. A directly connected camera is transmitted only over an explicitly connected Video Model WebSocket.

See [Model Connectors](MODEL_CONNECTORS.md) for the current wire contract and adapter architecture.

### Implemented media and audio nodes

- File accepts local image, video, and audio files. Image/video files can emit `frame.rgba`; media files emit `audio.block` through the session-owned player. Playback includes play, pause, stop, seek, current time, duration, and relative dBFS metering.
- Audio Mixer accepts eight stable optional `audio.block` inputs, activates 2, 4, or 8 source slots, applies per-source gain, and provides shared low/mid/high EQ.
- Audio Output is an explicit browser sink. Audio remains muted until the user enables it on a connected output route; media handles, object URLs, and Web Audio nodes are never serialized.

### Deferred node breadth

- Uploaded image/video, screen capture, crop/fit, resize, levels, channel
  shuffle, luma/chroma key, displacement, shape, gradient, and text processors.
- Compare, trigger, vector, envelope, and sample-and-hold controls.
- A general-purpose Delay node beyond the specialized retained state inside
  Trails and Spiral Feedback.
- Audio Device In, FFT/band analysis, calibrated SPL measurement, independent per-node media asset sessions, and recording.

### Runtime

- Typed port validation.
- Reachability from display and audio output roots, with the first connected display presented.
- Topological execution planning.
- Detection and rejection of zero-delay cycles.
- Stable elapsed-time behavior when frame rate changes.
- Display-synchronized, 60 fps, and 30 fps monitor pacing on one anchored browser animation clock.
- Pointer held state plus press/release pulses that last for one rendered tick.
- Latest-frame handoff from camera and compatible model sessions without blocking the render loop.
- Shader and renderer failures shown in the output monitor.
- WebGL context-loss messaging and recovery.
- Resolution and pixel-density caps.
- Throttled frames-per-second and GPU-pass counters.

### Persistence

- Versioned project schema.
- Debounced local autosave.
- JSON import/export.
- A known-good built-in project used when saved data is absent or invalid.
- Undoable graph replacement for blank and starter patches; replacement stops active device/model sessions and clears transient credentials.

## Explicitly out of scope

- Three-dimensional scenes and geometry processing.
- Sample-accurate audio generation or effects.
- Arbitrary JavaScript execution.
- User-authored shader code.
- Third-party node packages.
- Nested modules.
- Multi-user collaboration.
- Accounts or cloud project storage.
- Server-side rendering.
- A bundled/in-browser model inference runtime.
- Direct compatibility with arbitrary model-vendor endpoints; adapters own provider translation.
- Video recording and codec selection.
- Mobile-first graph editing.
- Compatibility with another product's files, node catalog, or terminology.

## Runtime budgets

The initial target is a current desktop browser on an integrated or discrete GPU.

| Budget | Target |
| --- | --- |
| Output resolution | Responsive canvas, capped to 1.5× device pixel ratio |
| Visual rate | Smooth 60 Hz where hardware permits; no correctness dependency on 60 Hz |
| UI response | Parameter changes visible by the next rendered frame |
| Default Signal Graph | 15 nodes and 8 GPU passes |
| Startup | Working default output without a network request after assets load |
| Persistence | Autosave without visible frame hitching |

Quality should degrade predictably. The monitor can follow the browser display
refresh or cap rendering at 60 fps or 30 fps without timer drift. The UI
reports a rolling measurement of monitor renders and does not alter
the project silently.

## Acceptance criteria

The POC is complete when all of the following are demonstrable in a production build:

- The built-in project renders immediately after page load.
- Every nonblank starter compiles to a Display path, while Blank Canvas is truly empty.
- Constant, Math, Map Range, Smooth, and Transform 2D each appear in at least
  one bundled starter where the node is reachable from Display.
- Solid Color, Threshold, Mask, Composite, Frame Switch, and Blur each appear
  in a bundled teaching starter where the node is reachable from Display.
- Spiral Feedback appears in a bundled lesson where its animated source,
  movable center, color treatment, and Display output are all reachable.
- Auto Selector and Strobe appear in Live Cut Lab, where four permission-free
  sources, router, phase binding, grade, and Display are all reachable.
- Adding, removing, and rewiring supported nodes changes the output correctly.
- At least one periodic control visibly modulates a transform parameter.
- Beat Clock phase drives a downstream oscillator, and Pointer exposes position, held, press, and release values.
- AI Chat connects to Video Model through a validated `text.utf8` edge.
- Video Model preview renders without a request, while Local/API modes remain disconnected until the user acts.
- One control can be rewired to a color or mix parameter without custom code.
- Incompatible connections are rejected before entering project state.
- A malformed project import leaves the current project intact and reports an error.
- Export followed by import reproduces node positions, parameters, and connections.
- Undo and redo cover node, edge, and parameter commands.
- Pausing freezes time-dependent output; reset produces a deterministic initial state.
- Shader and graphics-context failures are surfaced visibly, and context restoration rebuilds runtime resources.
- The build, unit tests, and a browser smoke test pass in CI.

## Main risks and mitigations

### Editor and renderer contend for the main thread

Keep editor state updates out of the frame loop, memoize node views, and throttle diagnostics. Preserve a renderer boundary that can move to an offscreen worker after profiling.

### GPU resources leak during graph edits

Make the renderer the sole owner of GPU objects and dispose resources when a plan is replaced. Texture pooling remains a measured follow-up optimization.

### Feedback creates unstable cycles

Reject all ordinary cycles. Trails and Spiral Feedback retain prior frames only
inside their renderer-owned state; Spiral Feedback bounds saved retention below
1 and interprets it per elapsed visual second. Pause must not advance that
state, while reset or rewind deterministically discards and seeds it again from
the current source. A future general Delay still needs an explicit read/commit
contract rather than exposing unrestricted cycles.

### Flashing effects can create a photosensitivity hazard

Strobe's internal Rate is limited to 3 Hz and defaults to a partial effect, but
an incoming Phase signal overrides that clock and upstream footage may flash on
its own. Label flashing examples before they load, keep bundled teaching
material below one cycle per second, document that external phase should stay
at or below 3 cycles per second, and retain an immediate Amount 0 bypass plus
ordinary node deletion/rewiring.

### Browser suspension causes large time jumps

Keep Transport Time aligned to monotonic active-play time, but do not replay every
missed visual frame after a tab resumes. Future fixed-step simulations should cap
their own catch-up work without changing the shared clock.

### Media permissions damage the first-run experience

The built-in project uses no protected device. Camera and microphone activation are optional, user initiated, and explain why permission is needed.

### Remote assets fail because of origin policy

Prefer uploads, packaged assets, and same-origin URLs. Validate remote responses and explain that a server must explicitly permit use as a visual input.

### Model integration implies compatibility or privacy that is not present

Label the built-in preview as a visual stand-in, not inference. Require the versioned adapter contract for Local/API modes, keep credentials out of saved projects, reveal the configured destination, and send camera frames only through a directly connected live Video Model WebSocket.

### Browser and GPU behavior differs

Perform capability checks before project startup, use conservative texture formats, keep shader variants small, and show an actionable unsupported-browser screen.

### Scope expands into a node-catalog race

Judge the MVP by graph fluency, modulation, visual quality, and reliability. Add node breadth only after the contracts for ports, parameters, diagnostics, and persistence are proven.

## Roadmap

### Phase 0: end-to-end POC

- Complete the graph editor and inspector.
- Implement the selected frame and control nodes.
- Ship the built-in composition, output view, local persistence, and core tests.
- Publish as a static application over HTTPS.

### Phase 1: durable browser instrument

- Add texture pooling, better GPU timing, adaptive resolution, and offscreen-worker evaluation.
- Harden camera and microphone inputs; add media upload and recording.
- Add richer control events, saved parameter snapshots, and reusable modules.
- Expand browser and accessibility testing.

### Phase 2: modern compute and extensibility

- Add a WebGPU backend with compute-oriented nodes.
- Add point and geometry data types.
- Define a signed, versioned node-package format with capability declarations.
- Add a constrained shader authoring experience.

### Phase 3: connected workflows

- Add cloud project storage and shareable links.
- Add collaborative command synchronization.
- Expose an authenticated automation gateway with schema discovery, transactional graph edits, diagnostics, and preview capture.
- Evaluate optional cloud execution separately from the local browser runtime.

Each phase should extend the same project schema and command model rather than introducing a parallel representation.
