# VideoBrain Current State

This is the implemented source baseline, not a deployment manifest. Future
scope lives in [Planned Development](PLANNED_DEVELOPMENT.md). The operator and
preset registries remain authoritative; a feature in the workspace is not
necessarily present on the running site.

## Implemented capabilities

| Area | Source implementation |
| --- | --- |
| Editor | Typed connections, node creation/movement/rewiring/deletion/duplication, parameter controls, undo/redo, command palette, collapsible library, JSON import/export, and autosave |
| Runtime | Output-root scheduling, ordinary cycle rejection, resource budgets, WebGL2 multipass rendering, visual transport, frame pacing, diagnostics, and fullscreen preview |
| Signals | `control.f32`, `text.utf8`, `frame.rgba`, `audio.block`, `data.json`, `data.table`, explicit `control.vec2/vec3/vec4`, `geometry.mesh`, `geometry.points`, `material.pbr`, `scene.camera`, and `scene.light` |
| Control | Transport Time, Beat Clock, Auto Selector, Oscillator, Pointer, XY Pad, Constant, Math, Map Range, and Smooth |
| Events/sequencing | Explicit `control.bool` and `event.trigger`, Control to Bool, Bool to Control, Compare, Logic, Trigger, Event to Control, Gate, Hold/Latch, Sample & Hold, Counter, Random, Timer, Envelope, Timed Transition, Step Sequencer, and Cue Scheduler; see [Events](EVENTS.md) |
| Inputs | Opt-in Video Input; session-local File image/video/audio; Network Video HLS/DASH/WHEP receiving |
| Generators | Solid Color, multi-stop Gradient, Shape, Vector Shape/static SVG, Text/embedded fonts, seeded Noise, constrained Shader Source, Flow Field, and Cells |
| Frame effects | Transform 2D, Warp, Blur, Threshold, Color Grade, Levels, HSV/HSL, Edge, Pixelate, Tile/Kaleidoscope, Channel Shuffle, and Displace |
| Composition | Blend, Mask, Composite, Frame Switch, Source Selector, Luma Key, Chroma Key, and control-driven Crossfade |
| Temporal effects | Trails, Spiral Feedback, and Strobe with their specialized state/clock contracts |
| Projection | Projector Mapping: four-corner planar warp, movement, scale, rotation, and edge modes |
| 3D foundation | Vector 2/3/4 and Split Vector nodes, Primitive 3D, Grid / Line 3D, Transform 3D, Camera 3D, Light 3D, PBR Material, and shared-context Three.js Render 3D; see [3D contracts](SCENE_3D.md) |
| Audio | Audio Level, File audio, Audio Mixer, opt-in Audio Output, Audio Spectrum scalar bands, Audio Trigger, and Audio Beat Clock |
| Models | AI Chat and Video Model built-in preview or optional compatible adapter; session-only credentials |
| Controllers | Web MIDI notes/7-bit CC Learn, browser-local parameter/source/transport mappings, and optional authenticated Bitfocus Companion bridge |
| Data/text | Text Source, Text Format, Number to Text, Text to Number, JSON Parse, JSON Select, JSON to Text, CSV Parse, Table to CSV, Table Transform, Table Cell, and Table Join |
| Browser data I/O | Explicit Fetch, WebSocket, Server Events, namespaced Storage, and Inspect as a data demand root |
| Signal troubleshooting | Signal Number, Signal Text, Signal Edge, and Signal Bang: typed zero-pass demand roots, pass-through outputs, labeled readouts, edge/event counts, and manual bangs; see [Signal tests](SIGNAL_TESTS.md) |
| Education/inspection | Registry-derived catalog and graph inspection, teaching presets, production-component stories, Help, and shared test fixtures |

## Scope boundaries

- Timed Transition drives Crossfade and scalar parameters; Step Sequencer and
  Cue Scheduler emit graph values/events. Transactional show-command scheduling,
  historical seek reconstruction, and show recording remain planned. Legacy
  scalar triggers and controller actions require explicit event conversion.
- Trails/Spiral Feedback do not implement general Frame Delay/Feedback.
- Projector Mapping is corner pinning, not named multi-display layouts, mesh
  warping, venue edge blending, or lighting output mapping.
- Shape/Vector Shape remain 2D. The separate typed 3D foundation renders one
  mesh and one point/line stream per Render 3D. Instancing, particles, imported
  assets, general scene hierarchies, and public depth output remain planned.
- File is session-local. Durable media assets, relinking, screen capture,
  dedicated Crop/Fit, Resize, and Test Card remain unfinished.
- Audio analysis exposes scalars, not public spectrum wires or sample-critical
  processing. Explicit device/channel selection remains unfinished.
- Network Video receives streams; publishing and generic peer/data channels
  are separate work. JSON parsing does not implement a show scheduler.
- Inspect is a bounded latest-value view, not a recorder. Data-node I/O requires
  explicit actions; remote services and storage contents are not bundled assets.
- OSC, Art-Net, and sACN gateways are planned. MIDI feedback, clock, pickup,
  relative encoders, and portable mappings are not part of basic controller support.

## Verification and release status

The P0 3D foundation has thirteen nodes, two complete teaching patches,
individual operator stories, serialization/compiler/descriptor tests, catalog
budgets, and GPU checks for textures, alpha, camera modes, points/lines,
animation/reset, desktop/mobile rendering, context restoration, and return to
2D rendering. Render 3D additionally supports three independently wired lights.

The recent stateless effects have runtime/registry integration, four teaching
patches, individual stories, unit coverage, and GPU browser checks. Controller
tests cover actions, simulated MIDI/Companion, and a local HTTP/WebSocket relay;
physical controllers and a live Companion installation still need testing.

The data batch has 17 registered nodes, four teaching patches, individual
stories, parser/session tests, and focused browser checks. Shared JSON/CSV
fixtures exercise quoting, joins, pointers, malformed input, and exact limits.
Its node stories are included in the current catalog build; detailed data-node
contract documentation and release close-out remain separate follow-up work.

The latest validation passes `npm run verify`: lint, typechecking, 677 tests,
and production build. Storybook build and its 140-entry artifact check also
pass. The event foundation includes three complete teaching patches, individual
node stories, serialization/type tests, timing-state tests, and two focused
browser workflows for transitions/reset and teaching-patch rendering.

The earlier lint blockers are resolved. Existing non-failing test `act(...)`
warnings and bundle-size warnings remain visible. Physical GPU/controller tests
and live Companion validation are separate from simulated/browser fixtures.
The web deployment was rebuilt before the latest lint/event/third-light changes;
these newer changes require a separate deployment. No Git commit is implied.

## References

- [Architecture](ARCHITECTURE.md): runtime ownership, types, budgets, and contracts.
- [Events](EVENTS.md): implemented boolean/event, transition, and sequencing semantics.
- [3D Scene Foundation](SCENE_3D.md): geometry, three-light rendering, and GPU ownership.
- [Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md): compatibility, inspection, and commands.
- [Design System](DESIGN_SYSTEM.md): production UI and Storybook conventions.
- [Controllers](CONTROLLERS.md): MIDI, Bitfocus Companion, and Stream Deck setup.
- [Model Connectors](MODEL_CONNECTORS.md): adapters and data-transfer boundaries.
- [Data fixtures](../public/test-data/README.md): reusable inputs and expected results.
- [README](../README.md): setup and existing application usage.