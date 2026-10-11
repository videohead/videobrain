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
| Frame effects | Transform 2D, Warp, Blur, Threshold, Color Grade, Levels, HSV/HSL, Edge, Pixelate, Tile/Kaleidoscope, Channel Shuffle, Displace, Chromatic Aberration, Bloom / Glow, and Scanlines |
| Composition | Blend, Mask, Composite, Frame Switch, Source Selector, Luma Key, Chroma Key, Crossfade, Liquid Morph, and instanced Particle Transition |
| Liquid physics | Liquid Metaballs: up to 32 colliding Matter.js bodies with pointer attraction and WebGL2 refraction/masking; see [effect contracts](ARCHITECTURE.md#extended-webgl2-frame-effects) |
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

## Experimental WebGPU foundation

WebGL2 remains the supported production renderer. The native WebGPU implementation
is isolated experimental groundwork, not a production hybrid runtime, selectable
fallback, or completed replacement. Full migration is deferred to
[P3](PLANNED_DEVELOPMENT.md#p3-webgpu-only-runtime-migration); feature-specific
integration stays with the feature that needs it. No operator capability label
has been enabled on account of this groundwork.

- `WebGPUDevice` owns secure-context checks, adapter/device acquisition,
  declared features/limits, cancellation cleanup, device-loss reporting, and
  idempotent disposal. Unsupported systems fail without backend downgrade.
- `WebGPUFrameRuntime` explicitly constructs the pinned Three.js 0.180.0
  WebGPU backend with no fallback factory. Three.js scene textures, native WGSL
  frame passes, bounded image/canvas/video uploads, and presentation share one
  device. Scene output converts to the existing straight-alpha RGBA8 contract.
- The original ten stateless effects have native WGSL ports with
  registry-driven defaults/options/bounds. They preserve the graph's upward
  positive Y convention despite WebGPU's top-down texture coordinates.
- Frame handles are runtime-owned, dimension/budget checked, and rejected after
  release. Scene operations are serialized. Current byte counters describe
  reserved graph color/depth targets, not total driver or Three.js memory.

Foundation validation passed `npm run verify` with 697 unit tests and the
production build before the later WebGL2 additions. Two native browser tests pass in the Playwright 1.62.1 Linux
container using Chromium's SwiftShader/Vulkan software GPU configuration. One
prohibits all WebGL context requests while exercising opaque/translucent Three.js
scenes, frame processing, readback, presentation, and allocation cleanup. The
other compares 21 WGSL effect cases against separate legacy GLSL reference
renders with a maximum tolerance of three RGBA8 channel values, and checks
missing inputs, upload-size rejection, self-read rejection, and released handles.
The reference renderer exists only in the parity test, not as a runtime fallback.
Software-adapter validation is not hardware performance or browser certification.

Remaining for a full replacement: backend-neutral CPU scheduling extraction, complete graph
execution and preview integration, remaining generators/processors/compositors,
retained-frame clocks/reset, production media/text/SVG integration, projection,
versioned custom-shader migration, and full device-recovery/replacement gates.
Compute particles remain P1, with the end-to-end GPU integration, capability UI,
and lifecycle handling needed to ship that feature. The native source is not
deployed; deferring universal migration does not mark these requirements complete.

## Scope boundaries

- Timed Transition drives Crossfade and scalar parameters; Step Sequencer and
  Cue Scheduler emit graph values/events. Transactional show-command scheduling,
  historical seek reconstruction, and show recording remain planned. Legacy
  scalar triggers and controller actions require explicit event conversion.
- Trails/Spiral Feedback do not implement general Frame Delay/Feedback.
- Projector Mapping is corner pinning, not named multi-display layouts, mesh
  warping, venue edge blending, or lighting output mapping.
- Shape/Vector Shape remain 2D. The separate typed 3D foundation renders one
  mesh and one point/line stream per Render 3D. General 3D instancing, GPU particle
  simulation, imported assets, scene hierarchies, and public depth output remain
  planned. The implemented 2D Particle Transition uses instanced textured quads;
  Liquid Metaballs uses bounded CPU physics, not WebGPU compute or a fluid solver.
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

Six additional WebGL2 operators have registry controls, serialization checks,
individual stories, and four complete patches: Prism & Glow Lab, Liquid Surface
Lab, Particle Transition Lab, and Infinity Mirror Lab. Infinity Mirror reuses
Tile / Kaleidoscope and retained Spiral Feedback; it is not a new portal-scene
renderer. The new operators have no WebGPU capability claim.

Focused browser checks exercise neutral filters, morph/transition alpha endpoints,
10,000-instance draws, visible filter changes, liquid motion/pause/reset, nonblank
patches, and forced WebGL context recovery. Screenshots were captured at desktop
and mobile sizes; visual review and hardware performance certification remain
separate. These source additions are not deployed.

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

The latest validation passes `npm run verify`: lint, typechecking, 734 tests,
and production build. Storybook build and its 155-entry artifact check also
pass. The event foundation includes three complete teaching patches, individual
node stories, serialization/type tests, timing-state tests, and two focused
browser workflows for transitions/reset and teaching-patch rendering.

The latest focused browser run passes the WebGL2 effects/lifecycle test and both
experimental WebGPU tests. The editor smoke test also passes for all eight
effect teaching patches, checking nonblank output, separated nodes, and no camera
permission requests. Native GPU execution in browser fixtures is not a hardware
performance guarantee. The dependency installation reports three high-severity
audit findings; those have not been investigated as part of this effect work.

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