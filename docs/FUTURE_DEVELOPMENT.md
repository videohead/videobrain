# VideoBrain Future Development

This document is the working product map for a browser-native visual signal studio. It records what exists, what should come next, the larger node catalog worth exploring, useful demonstration patches, browser I/O boundaries, and engineering lessons that are cheapest to preserve while the codebase is still small.

It is intentionally broader than a release plan. Items marked "explore" are ideas, not commitments. Priorities should continue to be driven by real patches, measured performance, browser support, accessibility, and contributor interest.

## Status and priority legend

| Mark | Meaning |
| --- | --- |
| ✅ Implemented | Available in the current proof of concept |
| 🚧 Next | High-value work for the durable browser instrument |
| 🧭 Planned | Fits the architecture, but is not scheduled yet |
| 🔬 Explore | Valuable research or a capability with unresolved product/technical questions |
| 🧩 Bridge | Requires, or works best with, a local/native gateway |
| ⛔ Boundary | Not directly available to a normal web page |

Priority labels used below:

- **P0** — preserve and harden what already makes the demo work.
- **P1** — makes everyday browser patching useful.
- **P2** — enables live shows, installations, and richer media work.
- **P3** — advanced creation, extensibility, and research.

## Product direction

VideoBrain should become an approachable live-media instrument, not merely a large list of effects. Six principles should guide the catalog:

1. **Instantly open a useful patch.** The default project requires no login, server, asset download, or device permission.
2. **Signals have clear types.** Invalid connections are rejected before they enter project state, and conversion is always explicit.
3. **The graph describes what you are trying to do.** Cameras, microphones, sockets, GPU textures, and device handles are session state and never serialized into project JSON.
4. **Local-first remains the baseline.** Network and cloud features are extensions; they do not become prerequisites for editing or playback.
5. **Live reliability is a feature.** Preflight checks, deterministic reset, useful errors, stable timing, and graceful quality reduction matter as much as visual breadth.
6. **Structure comes before catalog size.** Prioritize missing graph roles and complete teaching paths over isolated effects. Every node must have an inspectable contract and an example that proves why it belongs.

The most common creative workflows seen across the real-time visual community are strong guideposts: audio-reactive imagery, multi-layer VJ systems, projection mapping, feedback, GPU particles, camera and depth interaction, hand/body/face tracking, LED pixel mapping, lighting control, remote audience input, multi-camera switching, generative 3D scenes, network video, and increasingly ML-assisted live performance.

### Research guidance

The installed, manual-derived graph knowledge MCP is a high-value architectural
input for future node-wave proposals. Consult its operator catalog, connection
rules, graph templates, runtime descriptions, and—when safely
available—read-only live graph inspection when they can clarify recurring
structures under the editor surface. Record useful findings as a product-neutral
contract: typed inputs/outputs, explicit port order, parameter fallback and
binding behavior, demand/cook trigger, clock, state/reset boundary, capability
needs, and the smallest useful example graph.

This research should be weighted strongly when it is relevant, but it is not a
mandatory release gate and does not define VideoBrain's names, UI, saved format,
or runtime. The local registry and compiler remain the single source of truth.
Any future MCP or network adapter must expose that same truth through versioned
inspection and validated commands rather than building a second graph model.
The complete guidance is in
[Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md#research-informed-design-practice).

### Live-performance workflow study (official manuals, reviewed 2026-09-04)

Arena and Avenue contribute a useful performance-centered layer above ordinary
frame effects: fast clip launch, timing-aware transport, reusable effect looks,
pre/post-fader routing, venue output maps, and deliberate media preparation.
These are evidence for VideoBrain's own typed contracts, not file-format,
terminology, UI, or behavioral compatibility requirements.

Official sources reviewed:

- [Clips](https://resolume.com/support/en/clips): launch quantization,
  normal/toggle/momentary triggers, persistent slots, and per-clip overrides.
- [Video](https://resolume.com/support/en/video): timeline/BPM transport, cue
  points, beat-repeat sections, and catch-up behavior.
- [Autopilot](https://resolume.com/support/en/autopilot): forward, reverse,
  random-any/random-other/shuffle-bag order; duration sources; and per-item
  advance actions.
- [Effects](https://resolume.com/support/en/effects) and
  [Sources and routing](https://resolume.com/support/en/sources): scoped,
  ordered effect stacks and pre/post-fader visual routing.
- [Advanced Output](https://resolume.com/support/en/advanced-output),
  [Input Selection](https://resolume.com/support/en/input-selection), and
  [Slice Routing](https://resolume.com/support/en/slice-routing): reusable
  output layouts, slices, masks, routes, and output transforms.
- [Preparing Media](https://resolume.com/support/en/preparing-media) and
  [Media Manager](https://resolume.com/support/en/media-manager): codec
  readiness, missing-asset replacement, and portable media collection.
- [10-bit Color Output](https://resolume.com/support/en/10-bit-color-output):
  end-to-end source, processing, GPU, connection, and display-depth checks.
- [Ableton Link](https://resolume.com/support/en/link),
  [SMPTE](https://resolume.com/support/en/smpte), and the
  [Arena/Avenue capability comparison](https://resolume.com/support/en/avenue-arena-difference):
  shared tempo/phase and bridge-backed show or DJ transport.
- [MCP Servers](https://resolume.com/support/en/mcp-servers): an automation
  coverage counterexample; that API cannot currently manipulate output
  slices/screens, controller mappings, cue points, presets, envelopes,
  dashboard controls, recording, or rendering.
- [W3C guidance on flashes](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html):
  the basis for treating three flashes per second as an upper boundary rather
  than a guarantee that arbitrary source imagery is safe.

This gap map distinguishes refinements of existing broad roadmap families from
genuinely new explicit contracts:

| Product-neutral contract | Relationship to earlier roadmap | VideoBrain direction |
| --- | --- | --- |
| ✅ Auto Selector | Newly explicit specialization of Random + sequencing | Shipped: deterministic interval/count, forward/reverse/seeded shuffle-bag order, Index, and normalized Phase |
| ✅ Strobe | Genuinely new explicit frame processor | Shipped: internal 0–3 Hz clock, external Phase override, open fraction, amount, and four closed-frame treatments; see photosensitivity guidance |
| 🧭 Launch Grid | Refines Playlist / Clip Deck, Quantize, and control mapping | Versioned rows/columns with per-launch quantization, normal/toggle/momentary behavior, persistent slots, and per-slot override inheritance |
| 🧭 Clip Transport / Phase Modes | Refines Video File, Advanced Clock, and Timecode | Free-running timeline, shared-tempo phase, and external-position modes with rate, direction, in/out, loop, seek, pickup/restart, and deterministic end events |
| 🧭 Cue Bank | Refines Cue List / Cue Stack but adds media-position markers | Named, colorable, inspectable seek markers with set/replace/jump commands and stable asset-relative time |
| 🧭 Beat Repeat with Catch-up | Genuinely new temporal-media contract | Loop a musical subdivision, then release at either the loop playhead or uninterrupted transport position |
| 🧭 Auto Advance | Refines Playlist / Clip Deck and Auto Selector | Next/previous/random/first/last/specific/stop actions plus seconds, beats, media-end, shortest/longest, top/bottom, and master-source duration hierarchy |
| 🧭 Effect Scene | Refines Preset, Scene / Bank, and Bypass / Mute | Launch an ordered processor-chain snapshot with scoped parameters, dry/wet or bypass, transition time, and no duplicated frame source |
| 🧭 Layer Tap | Genuinely new explicit routing role | Read a named visual bus pre/post-fader and optionally before/after bypass or solo, with cycle-safe scope rules |
| 🧭 Slice Layout / Route | Extends Projector Mapping, LED Output, and Multi Display | Store regions, masks, input selections, per-slice routes, transforms, and calibration as versioned project resources |
| 🧭 Output Layout Presets | Genuinely new separation of content and venue setup | Save, validate, share, and swap output layouts independently from a composition while preserving stable route IDs |
| 🧭 Media Prepare / Relink | Refines file nodes and Asset Bin | Inspect codec/profile/resolution/frame rate, build optional proxies, locate/replace missing assets, collect portable copies, and retain hash-backed identity |
| 🔬 Wide Color / 10-bit Negotiation | Refines Tone Map and output capability work | Declare source/working/output space and depth, verify every browser/GPU/display link, and expose fallbacks |
| 🧩 Shared Tempo / DJ Bridge | Refines Advanced Clock, DAW Bridge, MIDI/OSC, and Timecode | Exchange tempo, beat phase, transport, track metadata, and confidence through a capability-declared adapter with explicit authority |

The documented automation limitations are an architectural opportunity:
layouts, cue banks, mappings, presets, envelopes, and media preparation should
be inspectable, versioned resources from their first implementation and use the
same typed transactional command surface as nodes. External API coverage does
not define the product model; local project contracts remain primary, and
adapters expose only the capabilities they can honestly support.

## Current proof of concept

The app currently opens the permission-free **Signal Graph** with frame, control, text, and audio-block signal types, a demand-rooted execution plan, WebGL2 multipass renderer, editor history, bounded JSON persistence, live diagnostics, responsive UI, and an accessible New patch menu with Blank Canvas plus 29 complete starter graphs. Its model node defaults to a built-in visual preview; compatible external adapters are optional. File, Audio Mixer, and Audio Output provide browser-local media playback and explicit audio routing; media handles remain session state.

### Implemented node catalog

| Domain | Node | Current behavior |
| --- | --- | --- |
| Control | ✅ Transport Time | Monotonic playback time with speed and offset |
| Control | ✅ Beat Clock | Tempo-locked phase, configurable beat pulse, and bar phase |
| Control | ✅ Auto Selector | Deterministic interval-based index and phase with forward, reverse, or seeded shuffle-bag order |
| Control | ✅ Oscillator | Sine, triangle, saw, and square modulation with frequency, phase, amplitude, and offset |
| Control | ✅ Pointer | Normalized X/Y, held state, and one-tick press/release pulses from the output stage |
| Control | ✅ XY Pad | Editable normalized X and Y outputs with direct two-axis control inside the node |
| Control / audio input | ✅ Audio Level | Opt-in microphone or patched audio level with gain/floor controls and an audio-block output; monitoring requires explicit Audio Output routing |
| Audio analysis | ✅ Audio Spectrum, Audio Trigger, Audio Beat Clock | FFT-derived scalar bands, onset envelope/trigger controls, and inferred tempo/phase; no public spectrum wire |
| Control | ✅ Constant | Reusable numeric value with a typed control output |
| Control | ✅ Math | Add, subtract, multiply, divide, minimum, and maximum with input fallbacks |
| Control | ✅ Map Range | Linear remapping with none, clamp, wrap, and fold boundary modes |
| Control | ✅ Smooth | Frame-rate-independent rise/fall filtering with deterministic reset |
| Text | ✅ AI Chat | Bounded positive/negative prompt authoring with a `text.utf8` prompt output |
| Frame input | ✅ Video Input | Opt-in live camera frames with front/rear preference, cover/contain/stretch fit, and mirroring |
| Frame input | ✅ File | Browser-local image/video frames; audio shares the same File node, not a separate serialized kind |
| Frame input | ✅ Network Video | One node with HLS, MPEG-DASH, and WebRTC WHEP receiver modes |
| Audio input | ✅ File audio path | Local image, video, or audio selection; audio playback is session-only and exposes an `audio.block` path for explicit routing |
| Audio processing | ✅ Audio Mixer | Two, four, or eight connected audio sources with per-source gain and shared three-band EQ |
| Audio output | ✅ Audio Output | Explicit browser-tab monitoring with user activation, relative dBFS metering, and muted-by-default routing |
| Frame model | ✅ Video Model | Built-in procedural visual preview plus compatible user-run WebSocket/HTTP adapter modes |
| Frame source | ✅ Solid | Flat RGBA color with independently controllable channels |
| Frame source | ✅ Gradient | Linear, radial, and conic modes with 2–8 positioned RGBA stops and alpha-capable color controls |
| Frame source | ✅ Text | Embedded fonts, alignment, wrapping, RGBA, live string input, and Apply for drafts |
| Frame source | ✅ Noise | Seeded value, simplex, cellular, curl-field, and fractal modes with deterministic animation |
| Frame source | ✅ Shader Source | Bounded GLSL ES 3.00 bodies, declared time/resolution and four control uniforms, Apply, compile diagnostics, and last-valid-program fallback |
| Frame source | ✅ Shape | GPU ellipse, rectangle, triangle, polygon, and star primitives with fill/outline and modulated geometry/color |
| Frame source | ✅ Vector Shape | Layered freehand/object drawing, transforms, undo/redo, and bounded static SVG import/export saved in the graph |
| Frame source | ✅ Flow Field | Procedural animated color field with time and energy modulation |
| Frame source | ✅ Cells | Procedural animated cellular field |
| Frame process | ✅ Warp | Flowing coordinate distortion with a control input for amount |
| Frame process | ✅ Blend | Normal, screen, add, and multiply composition of two frames |
| Frame process | ✅ Threshold | Soft luminance or RGBA-channel threshold with optional inversion |
| Frame process | ✅ Mask | Applies luminance or an RGBA channel to source alpha with amount and inversion |
| Frame process | ✅ Composite | Six Porter-Duff operations with a controllable foreground opacity |
| Frame process | ✅ Frame Switch | Index-selects one of four frame inputs |
| Frame process | ✅ Source Selector | Four-source manual selection or rising-edge advancement from a scalar trigger input |
| Frame process | ✅ Blur | Bounded, control-driven soft focus radius |
| Frame process | ✅ Trails | Retained-frame accumulation with feedback control |
| Frame process | ✅ Spiral Feedback | Internally retained prior output transformed by per-second rotation and zoom around a movable center |
| Frame process | ✅ Strobe | Partial black, white, transparent, or invert gating with internal 0–3 Hz clock or externally bound phase |
| Frame process | ✅ Color Grade | Hue, exposure, contrast, and saturation adjustment |
| Frame process | ✅ Transform 2D | Translation, scale, rotation, pivot, and transparent/clamp/repeat/mirror edge behavior |
| Frame process | ✅ Projector Mapping | Editable four-corner planar warp with move, scale, rotation, and edge modes; no mesh or multi-output layout |
| Frame process | ✅ Levels, HSV / HSL, Channel Shuffle | Single-pass color remapping and explicit RGBA routing with preserved or deliberately reassigned alpha |
| Frame process | ✅ Luma Key, Chroma Key | Luminance or chosen-color keying with soft alpha and basic chroma spill suppression |
| Frame process | ✅ Displace, Edge, Pixelate, Tile / Kaleidoscope | Map-driven UV offsets, Sobel edges, pixel blocks, and repeated/mirrored/polar symmetry |
| Frame process | ✅ Crossfade | Alpha-correct interpolation with control-driven position and four curves; no internal timer |
| Output | ✅ Display | Marks a frame path for presentation on the output stage |

### Operator library taxonomy

The sidebar catalog is grouped by creative purpose so it can grow without
becoming one long list. Category is discovery metadata: it does not change a
node's serialized kind, signal type, port compatibility, or runtime domain.

| Stable ID | Library label | Current nodes | Growth boundary |
| --- | --- | --- | --- |
| `timing` | Timing | Transport Time, Beat Clock, Auto Selector, Oscillator, Audio Beat Clock | Transport, phase, rhythm, schedules, and synchronization sources |
| `control` | Control | Constant, Math, Map Range, Smooth, Audio Trigger | Numeric/boolean/event manipulation, conversion, sequencing, and state |
| `interaction-ai` | Interaction & AI | Pointer, XY Pad, AI Chat, Video Model | Direct human controls and model-oriented interaction |
| `inputs` | Inputs | Audio Level, Audio Spectrum, Video Input, File, Network Video | Browser media, files, sensors, devices, and gateway ingress |
| `generators` | Generators | Solid, Gradient, Shape, Vector Shape, Text, Noise, Shader Source, Flow Field, Cells | Permission-free visual creation and procedural sources |
| `image-processing` | Image Processing | Transform 2D, Projector Mapping, Warp, Blur, Threshold, Trails, Spiral Feedback, Strobe, Color Grade, Levels, HSV / HSL, Channel Shuffle, Luma Key, Chroma Key, Displace, Edge, Pixelate, Tile / Kaleidoscope | Spatial, color, filter, and temporal image work; Displace uses a second frame as a coordinate map |
| `compositing` | Compositing | Mask, Composite, Frame Switch, Source Selector, Blend, Crossfade, Audio Mixer | Multi-source masking, layering, mixing, and routing |
| `output` | Output | Display, Audio Output | Demand roots for display, monitoring, recording, streaming, and gateways |

The IDs and membership are already catalog-visible and share the operator
registry with the editor, so they remain stable. New categories require an
ordered taxonomy decision and catalog-version review. Search and accessibility
may change presentation, but saved projects must never depend on whether a
category is expanded, renamed, or reordered.

The current library presents these groups as accessible collapsible headings
with node counts. Inputs and Generators open initially; searching temporarily
reveals every matching group so a collapsed category never hides a result.

### Implemented application modules

- ✅ Searchable operator library and keyboard command palette.
- ✅ Pan, zoom, select, move, connect, rewire, disconnect, duplicate, and delete.
- ✅ Typed `control.f32`, `text.utf8`, and `frame.rgba` ports.
- ✅ Parameter inspector with gesture-aware undo history.
- ✅ Numeric, select, and bounded text parameters remain visible as compact controls inside their nodes.
- ✅ Direct two-axis XY control with independently connectable outputs, native axis sliders, keyboard interaction, and live axis values.
- ✅ Reusable constants, arithmetic, range mapping, and rise/fall smoothing.
- ✅ Transform 2D with independently connectable translation, scale, and rotation.
- ✅ Core image construction and routing with Solid, Threshold, Mask,
  Composite, Frame Switch, and Blur.
- ✅ Play, pause, deterministic reset, display-synced/60/30 fps monitor pacing,
  rolling FPS, and GPU-pass diagnostics.
- ✅ Beat/bar timing and pointer position/held/press/release signals.
- ✅ Deterministic automatic source selection with a reusable normalized
  interval phase, plus a visually bypassable Strobe processor.
- ✅ Explicit microphone and camera permission controls.
- ✅ AI Chat → Video Model text routing, built-in visual preview, session-only model credentials, and a bounded compatible adapter connector.
- ✅ Fullscreen output.
- ✅ Versioned local autosave and transactional JSON import/export.
- ✅ Graph size, file size, resolution, pixel count, render-target, and pass budgets.
- ✅ Cycle rejection except for state intentionally retained inside Trails and
  Spiral Feedback.
- ✅ Read-only operator catalog and graph inspection with stable IDs, explicit
  port indexes, parameter-layout hints, bindings, reachability, diagnostics,
  execution orders, per-kind execution metadata, aggregate visual-pass/target
  costs, and reachable stateful-node IDs.
- ✅ A reachable teaching preset and component-catalog story for every current
  node kind.
- ✅ Static HTTPS deployment design using private object storage and a CDN.

## Quick index: what is not built yet

Everything marked 🚧, 🧭, 🔬, or 🧩 in the detailed tables is unbuilt. This index
highlights the major gaps and links to the complete lists; it is a navigation
aid, not a separate commitment or priority system.

| Area | Representative unbuilt work | Complete list |
| --- | --- | --- |
| Control and mapping | Compare, logic, gates, triggers, envelopes, timers, sequencing, vectors, and automation | [Control, events, and timing](#control-events-and-timing) |
| Frame sources | Playlists and broader shader capabilities | [Frame sources and media](#frame-sources-and-media) |
| Image/video processing | Crop/resize, advanced matte refinement, bloom, timed transitions, and retained-frame effects | [Frame processing and compositing](#frame-processing-and-compositing) |
| Audio | effects, recording, and sample-accurate processing | [Audio analysis and processing](#audio-analysis-and-processing) |
| Data and networking | JSON/CSV/text tools, fetch, WebSocket, MQTT, WebRTC data, OSC and lighting gateways, and record/replay | [Data, text, and networking](#data-text-and-networking-nodes) |
| Vision and ML | Motion/blobs, face/hand/body tracking, segmentation, depth, point clouds, detection, and advanced model effects | [Computer vision, tracking, and ML](#computer-vision-tracking-and-ml) |
| 3D and particles | Geometry, materials, lighting, instancing, particles, physics, glTF, and 3D rendering | [Geometry, particles, materials, and rendering](#geometry-particles-materials-and-rendering) |
| Workflow and reuse | Groups, reusable subgraphs, named controls, presets, performance panels, asset bin, scenes, packages, and collaboration | [Components, UI, reuse, and show control](#components-ui-reuse-and-show-control) |
| Output and distribution | Snapshot, recorder, multi-display, WebRTC publishing, projection mesh/edge-blend extensions, LED mapping, encoding, broadcast gateways, and XR | [Outputs, recording, mapping, and distribution](#outputs-recording-mapping-and-distribution) |
| External control | Keyboard, MIDI, and device input | [Browser and bridge I/O matrix](#browser-and-bridge-io-matrix) |

For practical demonstrations that exercise these ideas, jump to the
[example patch and preset library](#example-patch-and-preset-library). For
hardware and protocol feasibility, use the
[browser and bridge I/O matrix](#browser-and-bridge-io-matrix).

### Priorities from graph-structure research

Inspection of a large documented operator catalog and repeated community patch
patterns showed that useful systems are built from recurring structural roles:
sources, filters, analyzers, explicit converters, routers, retained-state
boundaries, reusable public interfaces, and demand-root outputs. Repeated paths
and missing graph roles—not raw operator count—set priority.

Three filters order the work:

1. **Graph leverage:** how many useful end-to-end patches become possible?
2. **Semantic foundation:** does a type, clock, state boundary, or public
   interface need to exist before later nodes can be honest?
3. **Browser feasibility:** can the wave have a deterministic local fallback,
   bounded resources, and a useful unavailable state?

### Protocol-governed module waves

| Wave | Status | Required scope | Required teaching examples |
| --- | --- | --- | --- |
| Foundation A — controls and spatial mapping | ✅ | Constant, Math, Map Range, Smooth, and Transform 2D | *Control Math*, *Smooth Pointer*, and *Transform Playground* |
| Foundation B — compositing loop | ✅ | Solid, Threshold, Mask, Composite, Frame Switch, and Blur | *Mask & Composite Lab*, *Beat Switcher*, and *Audio Soft Focus* |
| Visual feedback study | ✅ | Purpose-built Spiral Feedback with bounded per-second retention, spatial transformation, pause behavior, and deterministic reset | *Spiral Feedback Lab* |
| Live performance study | ✅ | Deterministic Auto Selector plus internally rate-capped Strobe with external phase binding and explicit flashing-imagery guidance | *Live Cut Lab* |
| 1 — local media and framing | 🚧 Partial | Shipped: File image/video/audio selection and playback. Remaining: Screen Capture, dedicated Crop/Fit, Resize, Test Card, and durable asset records | Shipped: *Local File Preview*. Planned: *Image Color Lab*, *Clip Framing*, and *Screen Layout & Test* |
| 2 — explicit frame state | 🚧 Next | General Frame Delay/Feedback with visible initialization, read/commit, pause, seek, and reset rules | *Feedback Laboratory* |
| 3 — decisions and events | 🚧 Next | `control.bool`, `event.trigger`, explicit bool/control conversion, Compare, Logic, Trigger, Gate, Hold, Frame Hold, Counter, Timer, and seeded Random | *Cue Logic Basics*, *Freeze & Release*, *Beat-cut Montage*, *Timed Transition*, and *Triggered Variations* |
| 4 — buffered audio | 🚧 Partial | Shipped: `audio.block` file/microphone paths, Mixer, Audio Output, Audio Spectrum, Audio Trigger, and Audio Beat Clock. Remaining: device/channel selection, public `audio.spectrum` wires, and sample-critical processing | Shipped: *Local File Preview* and *Audio Beat Pulse*. Planned extensions: *Audio Patch 101*, *Spectrum Color Bands*, and *Onset Switcher* |
| 5 — stateless frame effects | ✅ | Ten single-pass processors: Levels, HSV/HSL, Channel Shuffle, Luma/Chroma Key, Displace, Edge, Pixelate, Tile/Kaleidoscope, and control-driven Crossfade; built on existing frame/control contracts | *Color & Channel Lab*, *Keyed Camera* with a procedural fallback, *Displacement Map Lab*, and *Pattern & Mix Lab*; every new node is output-reachable across the set |
| 6 — reusable boundaries | 🧭 | Public Input/Output/Parameter contracts, nested Module/Subgraph, instances, presets, and scene routing | *Reusable Performance Rig* and *Scene Bank Basics* |
| 7 — broader typed systems | 🔬 | Structured data, vision/depth, geometry/materials, and output/gateway families, introduced only after their types and clocks are inspectable | At least one permission-free or recorded-fixture tutorial per new family before live-device examples |

Wave numbers identify workstreams, not a strict delivery order. Wave 5's
stateless effects use existing frame/control types and GPU scheduling and can
ship before Waves 2 and 3. They do not require general feedback, event types,
new media capabilities, or per-node resolution changes. Event-triggered timed
transitions remain part of Wave 3; explicit frame retention remains in Waves
2 and 3. The node-wave completion gate below still applies to each batch.

The read-only catalog and inspection surface advance with every wave; protocol
work is not postponed until the catalog is “finished.” Authenticated transport
and mutation follow only after migrations, capability negotiation, atomic
revision handling, and idempotency are proven in-process.

### Definition of done for every node wave

A wave is complete only when all of the following land together:

- a structural design note covering typed families, explicit indexed ports,
  disconnected-input behavior, parameter/control precedence, clock, state/reset,
  capability needs, and representative graph patterns, informed by the
  manual-derived graph research when useful;
- stable serialized kind, port, parameter, select-option, and public-interface
  IDs, with defaults, units, bounds, and a migration decision;
- compiler/runtime implementation with demand-root scheduling, explicit
  conversions, resource limits, deterministic fallback, and cleanup;
- catalog and graph-inspection coverage derived from the real registry and
  compiler, including execution/state/resource metadata as it becomes available;
- one or more bundled teaching presets in which every new node is reachable
  from an output and its role is named in the learning goal;
- an operator-card story for each node, a complete-graph story for each teaching
  preset, concise Help guidance, and capability/permission instructions;
- serialization/migration tests, focused runtime tests, graph compile tests,
  browser smoke coverage, and the automated all-node example coverage check.

Do not mark a roadmap entry ✅ until the implementation and education pieces
both pass this gate. See
[Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md#module-development-gate)
for the compatibility and safe-automation contract.

## Signal types to grow toward

Adding a node should start with its data contract. The renderer can change from WebGL2 to WebGPU; a stable project should not have to.

| Signal type | Status | Purpose |
| --- | --- | --- |
| `control.f32` | ✅ | A scalar sampled once per visual frame |
| `frame.rgba` | ✅ | A color texture in the current working color space |
| `text.utf8` | ✅ | Bounded text, currently used for prompt routing |
| `control.bool` | 🚧 | Gates, toggles, comparisons, and device buttons |
| `event.trigger` | 🚧 | Discrete events that must not be confused with a sustained value |
| `control.vec2`, `control.vec3`, `control.vec4` | 🚧 | Coordinates, color, multi-axis sensors, and packed controls |
| `audio.block` | ✅ | Session-only audio routed between File, Mixer, Audio Level, Audio Output, and the analyzers |
| `audio.spectrum` | 🚧 | Frequency bins with sample rate, FFT size, and window metadata; analysis currently stays inside Audio Spectrum rather than crossing a wire |
| `data.table` | 🧭 | Rows/columns for CSV, device maps, cues, and structured transforms |
| `data.json` | 🧭 | Bounded structured messages and API responses |
| `frame.depth` | 🧭 | Calibrated depth texture with unit/range metadata |
| `geometry.points` | 🔬 | GPU point buffers for particles, point clouds, and instances |
| `geometry.mesh` | 🔬 | Indexed geometry plus attributes |
| `material.pbr` | 🔬 | Render-state/resource description, not an image |
| `resource.asset` | 🔬 | A safe reference to an imported media asset |

Conversions should be explicit nodes: scalar-to-vector, spectrum-band-to-scalar, image-to-points, depth-to-points, table-column-to-channels, and render-to-frame. Avoid hidden coercion; it makes a patch difficult to inspect and automate.

## Node and module catalog

Rows name shipped operators where possible. A capability implemented as a mode
or output of an existing operator is not a separate node proposal. Cross-domain
tables may reference that same capability, but planned rows describe only the
remaining work. In particular, File owns image/video/audio selection, Network
Video owns HLS/DASH/WHEP ingest, Audio Spectrum owns scalar band analysis, and
Projector Mapping owns four-corner planar warping. Their broader extensions
below remain distinct work, not duplicate implementations.

### Control, events, and timing

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ Transport Time, Beat Clock, Oscillator, Pointer, XY Pad, Audio Level | Existing timing, interaction, and modulation baseline |
| P1 | ✅ Auto Selector | Deterministic timed index plus normalized phase in forward, reverse, or seeded shuffle-bag order |
| P1 | ✅ Constant | Reusable numeric value with a typed output |
| P1 | ✅ Math | Add, subtract, multiply, divide, minimum, and maximum |
| P1 | ✅ Map Range | Linear remapping with none, clamp, wrap, and fold boundaries |
| P1 | ✅ Smooth / Slew | Frame-rate-independent rise/fall filtering for noisy controls |
| P1 | 🚧 Compare | Equal, greater, less, inside range, and changed |
| P1 | 🚧 Logic | AND, OR, XOR, NOT for boolean/event work |
| P1 | 🚧 Bool / Control Convert | Explicit conversion between sustained boolean state and numeric modulation |
| P1 | 🚧 Gate / Switch | Route one control from several sources |
| P1 | 🚧 Trigger | Convert thresholds and button edges into discrete events |
| P1 | 🚧 Hold / Latch | Retain a value until the next event |
| P1 | 🚧 Sample & Hold | Sample a signal on a trigger |
| P1 | 🚧 Random | Seeded values, impulses, walk, and noise |
| P1 | 🚧 Envelope | ADSR and multi-stage value curves |
| P1 | 🚧 Counter | Increment, decrement, wrap, and reset |
| P1 | 🚧 Timer | Duration, fraction, done event, repeat, and pause |
| P1 | 🚧 Vector | Compose/decompose 2D, 3D, 4D, and color values |
| P2 | 🧭 Step Sequencer | Rows of values/events clocked at a musical division |
| P2 | 🧭 Curve / Keyframes | Editable automation with interpolation and loop regions |
| P2 | 🧭 Spring | Position/velocity response for organic motion |
| P2 | 🧭 Advanced Clock | Phrase, subdivision, swing, external sync, and transport state |
| P2 | 🧭 Tap Tempo | Estimate tempo from user or device taps |
| P2 | 🧭 Quantize | Align events or values to rhythmic/time grids |
| P2 | 🧭 Cue List | Ordered show states with GO, back, hold, and notes |
| P2 | 🧭 State Machine | Explicit modes and guarded transitions for installations |
| P2 | 🧭 Date / Schedule | Wall clock, calendar rules, sunrise/sunset, opening hours |
| P3 | 🔬 Timecode | LTC/MTC parsing and frame-rate-aware position |
| P3 | 🔬 Expression | Safe, bounded expression language without arbitrary page access |

### Frame sources and media

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ Video Input | User-enabled camera texture for the current session |
| P0 | ✅ Flow Field, Cells | Permission-free procedural sources |
| P0 | ✅ Video Model | Built-in visual preview or latest bounded frame from a compatible user-run adapter |
| P1 | ✅ Solid | Flat RGBA color with optional control inputs for each channel |
| P1 | ✅ Gradient | Linear, radial, and conic gradients with 2–8 positionable color stops, RGB pickers, and independent alpha sliders |
| P1 | ✅ Shape | Rectangle, ellipse, triangle, polygon, and star; modulated geometry/color and fill/outline. Dedicated line and rounded primitives remain planned. |
| P1 | ✅ File (image / video / audio) | One browser-local file node with image/video frames, media playback controls, and an explicit audio output path; durable asset storage and richer clip transport remain planned |
| P1 | ✅ Vector Shape / SVG | Static paths, shapes, gradients, and clipping; 150 KB / 512-element limit, no scripts, animation, embedded images, or external references. Convert text and use instances to paths before import. |
| P1 | ✅ Text | Embedded font asset, alignment, word/character wrapping, live string input, and Apply-to-commit drafts |
| P1 | ✅ Noise | Seeded value, simplex, cellular, curl-field, and fractal variants; fBm, turbulence, and ridged fractals |
| P1 | ✅ Network Video (HLS / DASH / WebRTC WHEP) | One receiver node with three protocol modes, explicit connect/disconnect, fit, and mirror; generic peer signaling and publishing remain planned |
| P1 | ✅ Shader Source | GLSL ES 3.00 fragment bodies with four patchable float uniforms; 4096 characters, 512 AST nodes, 128 operations, and 32 nesting levels. No loops, custom functions, arrays, or textures; static limits are not GPU-time guarantees. |
| P2 | 🚧 Checker / Grid | Calibration, mapping, and debugging pattern |
| P2 | 🚧 Test Card | Resolution, color, frame number, and sync diagnostics |
| P2 | 🧭 Playlist / Clip Deck | Preload, cue, loop, transition, and asset-missing states |
| P2 | 🧭 Clip Transport / Phase Modes | Timeline, shared-tempo phase, or external position with loop, seek, direction, pickup/restart, and end events |
| P2 | 🧭 Media Prepare / Relink | Codec/profile inspection, proxy preparation, missing-asset locate/replace, and portable collection |
| P2 | 🧭 Canvas Input | Capture a safe in-app drawing surface or UI component |
| P2 | 🧭 Browser Capture | Render an allowlisted same-origin page/component to a frame |
| P3 | 🧩 Gateway Video | Frames delivered by a native gateway for specialist protocols |
| P3 | 🔬 Advanced ML Image Source | Multiple inputs, capability negotiation, async jobs, provenance, and queue policy beyond the current Video Model connector |

### Frame processing and compositing

Most P1 image effects are bounded, stateless fragment-shader work, not new
runtime architecture. Deliver them as a cohesive batch using existing
`frame.rgba` inputs, `control.f32` overrides, and demand-root scheduling.
Single-pass means one pass per effect, not that a chain of effects is fused
into one shader; sample count and resolution still determine GPU cost.

| Implementation class | Candidates | Delivery boundary |
| --- | --- | --- |
| Per-pixel color and channels | Levels, HSV/HSL, Luma Key, Channel Shuffle | Single-pass math with explicit alpha and color-space behavior |
| Coordinate mapping | Crop/Fit, Pixelate, Tile/Kaleidoscope | Single-pass UV mapping with defined aspect ratio, filtering, and edge behavior; no output-size change |
| Multiple frame inputs | Displace, control-driven Crossfade | Single pass sampling connected textures; explicit input order and disconnected-input fallback |
| Bounded filtering and keying | Edge, basic Chroma Key with spill suppression | Single pass with bounded sampling; advanced matte refinement may need separate passes |
| Resolution boundary | Resize | Simple sampling shader, but explicit target allocation, size propagation, and resource accounting |
| Retained frame state | Frame Delay/Feedback, Frame Hold | Initialization, capture/read/commit, pause, seek, reset, and resource lifecycle contracts |
| Timed orchestration | Event-triggered Transition | Timing and retrigger rules belong to the control/event path; frame interpolation itself remains stateless |

Wave 5 covers the stateless effects below, independently of the state/event
waves. Crop/Fit and Resize retain their Wave 1 framing ownership. Shared design
notes and teaching patches can cover several effects, but each node still
needs stable IDs, registry/inspection metadata, controls, an operator story,
and focused validation. No implementation status changes merely because an
effect is inexpensive to implement.

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ Warp, Blend, Trails, Color Grade | Existing multipass processing core |
| P1 | ✅ Transform 2D | Translate, scale, rotate, pivot, and transparent/clamp/repeat/mirror edge modes |
| P1 | ✅ Blur | Bounded control-driven soft focus |
| P1 | ✅ Threshold | Soft luminance or component threshold with inversion |
| P1 | ✅ Matte / Mask | Apply a selected mask channel to source alpha |
| P1 | ✅ Composite | Source/destination Over, source In/Out/Atop, and XOR Porter-Duff operations |
| P1 | ✅ Frame Switch | Select one of four frame inputs with an integer index |
| P1 | ✅ Source Selector | Four-input routing with manual buttons or scalar rising-edge advancement; not a general event-type implementation |
| P1 | ✅ Projector Mapping | Four-corner planar projection with editable quad, move, scale, rotation, and edge modes |
| P1 | ✅ Spiral Feedback | Rotate and zoom an internally retained prior output around a movable center, then blend in the live source |
| P1 | ✅ Strobe | Partially gate a frame to black, white, transparent, or invert from an internally capped clock or external phase |
| P1 | 🚧 Frame Delay / Feedback | Explicit previous-tick read/commit boundary with deterministic initialization and reset |
| P1 | 🚧 Frame Hold | Retain or release a frame from an explicit event/control input without creating an ordinary graph cycle |
| P1 | 🚧 Crop / Fit | Dedicated frame processor with explicit crop and safe-area guides; Video Input and Network Video already provide cover/contain/stretch fit |
| P1 | 🚧 Resize | Explicit resolution and filtering boundary |
| P1 | ✅ Levels | Black/white points, inverse gamma, lift, gain, and clamped output |
| P1 | ✅ HSV / HSL | Hue turns, saturation multiplier, and value/lightness offset with source alpha |
| P1 | ✅ Luma Key | Soft or hard luminance key multiplied into source alpha, with inversion |
| P1 | ✅ Chroma Key | Basic chrominance-distance key with soft alpha and transition-region spill suppression |
| P1 | ✅ Crossfade | Premultiplied interpolation from control-driven Mix with linear, smooth, ease-in, or ease-out curves |
| P1 | 🚧 Timed Transition | Event-triggered progression and retrigger rules; separate Wave 3 control work using stateless Crossfade |
| P1 | ✅ Displace | Map red/green UV displacement with neutral disconnected map and transparent/clamp/repeat/mirror edges |
| P1 | ✅ Edge | Bounded 3x3 Sobel luminance edges with strength, inversion, and source alpha |
| P1 | ✅ Pixelate | Square output-pixel blocks without changing render-target resolution |
| P1 | ✅ Tile / Kaleidoscope | Repeat, mirror, and aspect-correct polar symmetry with center, rotation, and repeats |
| P1 | ✅ Channel Shuffle | Independently route RGBA, luminance, zero, or one into each output channel |
| P2 | 🧭 Bloom / Glow | Multi-resolution highlight glow |
| P2 | 🧭 Sharpen | Controlled high-frequency enhancement |
| P2 | 🧭 LUT | 1D/3D color lookup with asset validation |
| P2 | 🧭 Tone Map | HDR-to-display mapping and exposure strategy |
| P2 | 🧭 Lens | Distortion, vignette, chromatic offset, and calibration profile |
| P2 | 🧭 Film | Grain, halation-like glow, dust, scratches, and weave |
| P2 | 🧭 Dither | Ordered, blue-noise, and error-diffusion-inspired output |
| P2 | 🧭 Time Slice | Delay, frame hold, stutter, echo, and time displacement |
| P2 | 🧭 Beat Repeat / Catch-up | Loop a beat subdivision, then resume from the loop point or uninterrupted transport position |
| P2 | 🧭 Layer Tap | Route a named visual bus before/after fader and optionally before/after bypass or solo |
| P2 | 🧭 Motion Blur | Frame- or velocity-assisted temporal blur |
| P2 | 🧭 Optical Flow Warp | Motion-aware feedback and interpolation |
| P2 | 🧭 Multi-view Layout | Grid, picture-in-picture, split, and monitor wall |
| P2 | 🧭 Projection mesh extensions | Extend Projector Mapping beyond its shipped four-corner warp to editable meshes; venue edge blending and calibration belong to Projection Output below |
| P2 | 🧭 LED Pixel Map | Sample a canvas into fixture/channel ordering |
| P3 | 🔬 Reaction Diffusion | Persistent compute simulation |
| P3 | 🔬 Fluid | GPU velocity/dye simulation with deterministic reset |
| P3 | 🔬 Cellular Automata | General stateful grid simulation |
| P3 | 🔬 Depth Composite | Occlusion and depth-aware focus/fog |
| P3 | 🔬 Neural Effect | Segmentation, depth, style, or generation with explicit latency |

Wave 5's stateless processors each use one pass and one output-sized target,
retain no history, and need no permissions. Numeric control inputs override
saved literals within the registry bounds; disconnecting restores the literal.
Crossfade's missing inputs are transparent, and a missing Displace map is
neutral. Levels clamps RGB; equal/reversed black/white points form a near-hard
cutoff. Chroma Key is basic keying, not advanced matte cleanup. See the exact
ports, defaults, units, formulas, fallback behavior, and additive schema decision
in [Architecture](ARCHITECTURE.md#stateless-frame-effects-wave-5).

Spiral Feedback is a specialized effect rather than the general Frame Delay /
Feedback primitive above. It owns one previous-output buffer pair internally,
reports one visual pass, two render targets, and stateful execution, and never
permits an ordinary graph cycle. Feedback is clamped to `0…0.99` and means the
fraction retained after one elapsed visual second; rotation and zoom use the
same elapsed-time basis. A paused frame has zero elapsed time and leaves history
unchanged. First evaluation, reset, or rewind discards the old history and
deterministically seeds from the current source. The general read/commit,
routing, seek, and initialization contract in Wave 2 remains unbuilt.

Auto Selector is a stateless control specialization: Position divided by
Interval yields a normalized Phase and an integer step. Forward, reverse, and
seeded shuffle-bag orders therefore remain deterministic across reset, seek,
reload, and frame-rate changes. Count describes configured indices; it does not
inspect whether a downstream router input is connected.

Strobe is a one-pass frame processor, not a claim that the whole input is safe
for photosensitive viewers. Its internal Rate is hard-capped at 3 Hz, but a
connected Phase overrides that oscillator and can switch faster; external phase
should remain at or below 3 cycles per second. Upstream media may contain its
own flashes. Amount 0 is the immediate visual bypass, and removing the node then
rewiring Source to its successor removes the processor entirely. Bundled
examples must disclose flashing imagery before load and stay below one cycle
per second.

### Audio analysis and processing

Visual-rate analysis and sample-rate audio are different runtimes. Audio Level
owns the opt-in microphone session, emits a normalized visual-rate control, and
exposes the captured block on an `audio.block` output so analyzers can read it.
Audio Spectrum has no device controls of its own: it analyzes whichever block is
patched into it and reads silence when that input is empty, so nothing synthetic
ever stands in for a real source. File audio has a separate session-only playback
path through File, Audio Mixer, and Audio Output, with monitoring muted until the
user explicitly enables it. Routing a microphone block into Audio Output monitors
it aloud and can cause howlround, so that path warns the performer. File meters
are relative dBFS readings, not calibrated sound-level measurements. An
`AudioWorklet` should own future sample-critical nodes; visual controls receive
downsampled analysis values.

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ Audio Level | Visual-frame energy control from an opt-in microphone; `clamp((input - floor) * gain, 0, 1)`, plus an `audio.block` output for analyzers |
| P0 | ✅ Audio File path | File selection and media-clock playback for local audio tracks; exposes `audio.block` without persisting media handles |
| P0 | ✅ Audio Output / Monitor | Explicit browser-tab destination with user activation, muted-by-default startup, and relative dBFS metering |
| P0 | ✅ Mixer | Two, four, or eight source inputs with per-source gain and shared low/mid/high EQ; routing is explicit and session-only |
| P1 | 🚧 Audio Device In | Select device and channels and expose an `audio.block`; monitoring remains off until routed explicitly |
| P1 | ✅ Audio Spectrum (FFT / Band Energy) | Reads patched audio FFT data and exposes scalar Level/Bass/Mid/Treble outputs with per-band frequency and Q; no standalone Band Energy node or spectrum wire |
| P1 | ✅ Audio Trigger (Onset / Envelope) | Scalar trigger and decaying envelope from a band's rolling average, with Hold and Decay; not a sample-accurate ADSR or general envelope follower |
| P1 | ✅ Audio Beat Clock (Tempo Estimate) | Infers BPM, phase, bar, and confidence from scalar trigger spacing |
| P1 | 🚧 Pitch | Fundamental estimate plus confidence |
| P1 | 🚧 Waveform | Time-domain block for scope and geometry conversion |
| P2 | 🧭 Gain / Pan | Audio-rate amplitude and stereo placement |
| P2 | 🧭 Mixer extensions | Multi-channel mute, solo, and independent metering beyond the shipped gain/EQ path |
| P2 | 🧭 Filter / EQ | Biquad filters and parametric bands |
| P2 | 🧭 Compressor / Limiter | Dynamics and output protection |
| P2 | 🧭 Delay / Reverb | Time effects with tail lifecycle |
| P2 | 🧭 Oscillator / Noise Audio | Sound generation distinct from visual-rate control |
| P2 | 🧭 Recorder | Audio buffer/file capture with clear duration limits |
| P2 | 🧭 Tempo analysis extensions | Direct audio-based tempo tracking beyond Audio Beat Clock's shipped trigger-spacing estimate |
| P3 | 🔬 Spatial Audio | Listener/source graph and multi-channel layouts |
| P3 | 🧩 DAW Bridge | Transport, tracks, parameters, and audio routing through a companion |
| P3 | 🧩 Plug-in Host | Native-only plug-in hosting exposed through a constrained bridge |

### Data, text, and networking nodes

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ AI Chat | Bounded positive/negative prompt authoring and `text.utf8` output |
| P0 | ✅ Model Adapter Connector | `videobrain.frames.v1` HTTP/WebSocket exchange with memory-only credentials and bounded returned images |
| P1 | 🚧 JSON Parse / Select | Convert bounded JSON into typed values |
| P1 | 🚧 CSV / Table | Import, edit, filter, sort, join, and select columns |
| P1 | 🚧 Text Format | Join, replace, number format, and templates |
| P1 | 🚧 Fetch | CORS-aware HTTP request with timeout and rate limit |
| P1 | 🚧 WebSocket | Client connection, reconnect policy, status, send, and receive |
| P1 | 🚧 Server Events | Receive one-way event streams |
| P1 | 🚧 Storage | Namespaced local settings with quota/error reporting |
| P2 | 🧭 Table Transform | Map, filter, group, pivot, aggregate, and lookup |
| P2 | 🧭 GeoJSON | Decode points/paths/polygons for maps and installations |
| P2 | 🧭 MQTT over WebSocket | Sensor/venue messaging through a browser-compatible broker |
| P2 | 🧭 WebRTC Data | Peer-to-peer control/events with ordering options |
| P2 | 🧭 WebTransport | Low-latency client/server data where infrastructure supports it |
| P2 | 🧭 QR / Barcode | Decode camera frames into text/events |
| P2 | 🧭 Log / Inspect | Bounded live data viewer with sampling and redaction |
| P2 | 🧭 Record / Replay | Capture timestamped control/data streams for deterministic tests |
| P3 | 🔬 Sandbox Script | Capability-limited worker code with time/memory quotas |
| P3 | 🔬 Database Query | Read-only, parameterized query through an authenticated service |
| P3 | 🧩 OSC Gateway | Typed OSC messages over authenticated WebSocket to UDP gateway |
| P3 | 🧩 Lighting Gateway | Art-Net/sACN/DMX frames through an allowlisted venue bridge |
| P3 | 🧩 Shared Tempo / DJ Bridge | Capability-declared tempo, beat phase, transport, track metadata, confidence, and authority exchange |

### Computer vision, tracking, and ML

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ Video Model | Safe procedural preview plus latest-frame handoff from a compatible local/API adapter |
| P1 | 🚧 Grayscale / Normalize | Predictable pre-processing for vision nodes |
| P1 | 🚧 Frame Difference | Motion regions without a large model |
| P1 | 🚧 Background Model | Foreground mask for fixed-camera installations |
| P1 | 🚧 Morphology | Erode, dilate, open, and close masks; the existing Blur already supplies basic denoising |
| P1 | 🚧 Contours / Blobs | Regions, centroids, area, bounds, and tracking IDs |
| P2 | 🧭 Optical Flow | Dense or sparse motion vectors |
| P2 | 🧭 Face Landmarks | Face pose and expression features |
| P2 | 🧭 Hand Landmarks | Multi-hand points, handedness, pinch, and gesture signals |
| P2 | 🧭 Body Pose | Skeleton joints, confidence, and derived angles |
| P2 | 🧭 Person Segmentation | Foreground alpha and confidence |
| P2 | 🧭 Tracking | Associate detections across frames with stable IDs |
| P2 | 🧭 Zones | Presence, entry/exit, dwell, direction, and occupancy |
| P2 | 🧭 Spatial Buttons | Trigger virtual controls from tracked body/hand regions |
| P2 | 🧭 Marker Tracking | QR, ArUco-like, AprilTag-like, and calibrated transforms |
| P2 | 🧭 Object Detection | Bounded local model with labels and confidence |
| P2 | 🧭 Monocular Depth | Estimated depth from a normal camera frame |
| P2 | 🧭 Depth Unproject | Calibrated depth image to 3D points |
| P2 | 🧭 Point-cloud Filter | Crop, decimate, denoise, colorize, and transform points |
| P3 | 🔬 Gesture Classifier | User-trainable sequences over landmarks |
| P3 | 🔬 Style / Image Transform | Local model effect with explicit frame queue and fallback |
| P3 | 🔬 Generative Model | Remote/local generation with cancellation, seed, and provenance |
| P3 | 🔬 Gaussian Splat Viewer | Stream and render captured volumetric scenes |

ML nodes must expose model download size, warmup status, execution provider, latency, and whether any frame leaves the device. They must drop stale work rather than building an unbounded queue.

### Geometry, particles, materials, and rendering

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P2 | 🧭 Primitive | Plane, box, sphere, cylinder, line, and text geometry |
| P2 | 🧭 Transform 3D | Translation, rotation, scale, pivot, and hierarchy |
| P2 | 🧭 Merge | Combine compatible geometry streams |
| P2 | 🧭 Scatter | Seeded point distribution over geometry/images |
| P2 | 🧭 Grid / Line | Structured points useful for displacement and scopes |
| P2 | 🧭 Image to Points | Convert pixels into positioned/colorized points |
| P2 | 🧭 Instance | Draw many objects from point/control attributes |
| P2 | 🧭 Particle Source | Emit by shape, image, depth, event, or audio band |
| P2 | 🧭 Particle Update | Force, drag, curl, attractor, collision, age, and kill |
| P2 | 🧭 Camera 3D | Perspective/orthographic camera with control inputs |
| P2 | 🧭 Light | Directional, point, spot, area-like approximation, and environment |
| P2 | 🧭 PBR Material | Base color, metallic, roughness, normal, emission, and alpha |
| P2 | 🧭 Render 3D | Geometry/material/camera/lights to `frame.rgba` and depth |
| P2 | 🧭 glTF Asset | Browser-friendly scene/animation import |
| P2 | 🧭 Environment Map | HDR environment and reflections |
| P3 | 🔬 Mesh Operators | Normals, subdivision, deform, skin, and attribute transforms |
| P3 | 🔬 Physics | Bounded rigid/soft-body or particle constraints in a worker/WASM |
| P3 | 🔬 Signed Distance Field | Raymarched shapes and compositing |
| P3 | 🔬 Generative Architecture | Rule, repeat, scatter, facade, and instancing tools |
| P3 | 🔬 Volumetric Render | Raymarching for fields, fog, and depth volumes |

### Components, UI, reuse, and show control

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P1 | 🚧 Group / Comment | Visual organization without runtime semantics |
| P1 | 🚧 Named Parameter | Expose a patch value with label, range, unit, and default |
| P1 | 🚧 Preset | Capture and recall named parameter snapshots |
| P1 | 🚧 Macro Controls | Curated performance surface separate from editing UI |
| P1 | 🚧 Module / Subgraph | Reusable nested patch with declared typed interface |
| P1 | 🚧 Bypass / Mute | Compare or disable an operator predictably |
| P1 | 🚧 Favorites / Recent | Faster node creation for live work |
| P1 | 🚧 Asset Bin | See ownership, type, missing state, and memory estimate |
| P2 | 🧭 Preset Morph | Interpolate compatible preset parameters over time |
| P2 | 🧭 Scene / Bank | Organize patches into live-performance scenes |
| P2 | 🧭 Launch Grid | Quantized normal/toggle/momentary slots with persistence and per-slot override inheritance |
| P2 | 🧭 Cue Bank | Named inspectable media-position markers with set, replace, and jump commands |
| P2 | 🧭 Auto Advance | Hierarchical action and duration rules for unattended or rehearsed sequences |
| P2 | 🧭 Effect Scene | Launchable processor-chain snapshot with transition, dry/wet, and bypass behavior |
| P2 | 🧭 Router | Switch whole visual/control buses atomically |
| P2 | 🧭 Cue Stack | Rehearsable transitions and go/back show controls |
| P2 | 🧭 Panel Builder | Buttons, sliders, XY pads, text, meters, and color controls |
| P2 | 🧭 Mobile Control Page | Share a constrained touch UI by QR code |
| P2 | 🧭 Clone / Instance | Reuse one definition with per-instance parameters |
| P2 | 🧭 Template Project | Versioned starter patch plus assets and required capabilities |
| P2 | 🧭 Snapshot / Compare | Visual diff and rollback for patch state |
| P3 | 🔬 Package | Signed/versioned third-party node bundle with capability manifest |
| P3 | 🔬 Automation Gateway | Schema discovery and transactional graph commands over authentication |
| P3 | 🔬 Collaboration | Shared command log, presence, conflict policy, and role controls |

Automation should use a typed command protocol—create node, connect ports, set parameter, compile, inspect diagnostics, capture preview—rather than evaluating arbitrary command strings inside the page.

### Outputs, recording, mapping, and distribution

| Priority | Node/module | Purpose |
| --- | --- | --- |
| P0 | ✅ Display | Present one connected frame in the app/fullscreen canvas |
| P1 | 🚧 Snapshot | Download a still with size, alpha, and color metadata |
| P1 | 🚧 Recorder | Capture canvas/audio through supported browser codecs |
| P1 | 🚧 Multi Display | Named program, preview, confidence, and utility outputs |
| P2 | 🧭 Projection Output | Venue output orchestration, edge-blend masks, test patterns, and per-output calibration; reuse Projector Mapping and future mesh extensions rather than another corner-pin processor |
| P2 | 🧭 Slice Layout / Route | Versioned input regions, masks, source routes, transforms, and calibration |
| P2 | 🧭 Output Layout Presets | Venue layouts saved and swapped independently from composition content |
| P2 | 🔬 Wide Color / 10-bit Negotiation | Source/working/output color metadata, capability probing, fallback, and end-to-end verification |
| P2 | 🧭 LED Output | Pixel map preview, fixture mapping, gamma, dimmer, and channel packing |
| P2 | 🧭 Stream Encoder | Browser-supported encode feeding a service/gateway |
| P2 | 🧩 Broadcast Gateway | RTMP/SRT/RTSP/SDI output through an authenticated process |
| P2 | 🧩 Lighting Output | Art-Net, sACN, or USB-DMX through a venue gateway |
| P3 | 🔬 XR Output | Immersive WebXR scene/view layers |
| P3 | 🔬 Laser Gateway | Calibrated point output with mandatory safety interlocks and venue operator control |
| P3 | 🔬 Render Queue | Deterministic offline/high-quality export, locally or remotely |

## Browser and bridge I/O matrix

"Direct" means a web page can implement the path with a standard browser API. It does not mean every browser, codec, device, or operating system supports it. Every integration needs feature detection and a useful unavailable state.

| I/O family | Examples | Path | Status / important constraints |
| --- | --- | --- | --- |
| Pointer, keyboard, touch | Mouse, pen, multitouch, keys | Direct, stable | Pointer is ✅; keyboard/touch nodes are 🚧. Do not hijack assistive/browser shortcuts. |
| Camera | Webcam, phone cameras, UVC capture card | Direct, stable | ✅ HTTPS + explicit `getUserMedia` permission. Device labels often appear only after grant. |
| Microphone | Built-in, USB interface input | Direct, stable | ✅ level analysis. HTTPS + explicit permission; echo/noise processing constraints must be visible. |
| Screen/window/tab | Screen, app window, browser tab | Direct, stable | 🚧 Explicit chooser every session; system-audio capture varies by browser/OS. |
| Local media | Image, video, audio, font, 3D asset | Direct, stable | ✅ File image/video/audio selection and embedded Text fonts. 🚧 Durable media asset records, portable media collection, and 3D assets; object URLs remain session-only. |
| Game controller | Gamepad, joystick, some wheels | Direct, stable | 🚧 Usually requires a user interaction before data is exposed; mappings vary. |
| Device motion/orientation | Phone rotation, acceleration | Direct with platform variance | 🧭 Permission/user-gesture requirements differ; sensor access may be unavailable in embedded contexts. |
| MIDI | Notes, CC, clock, MTC, surfaces | Direct but limited | 🧭 Web MIDI support/permissions vary. SysEx needs stronger permission; always learn/map by stable user choice. |
| Serial | Arduino, Teensy, microcontroller sensors | Direct but limited | 🧭 Web Serial is chiefly available in Chromium-family desktop environments and requires a chooser. |
| USB | Custom control devices | Direct but limited | 🧭 WebUSB requires compatible device/driver policy, filters, chooser, and protocol implementation. |
| HID | Button decks, custom controllers | Direct but limited | 🧭 WebHID support is limited; protected device classes remain unavailable. |
| Bluetooth LE | Heart rate, EEG, environmental sensors | Direct but limited | 🧭 Web Bluetooth support is limited and GATT-oriented; discovery requires user choice. |
| XR | Headsets, controllers, immersive sessions | Direct but limited | 🔬 WebXR varies by device/browser; immersive mode requires explicit session start. |
| Infrared/depth camera | Structured light, time-of-flight, skeletal sensor | Mixed | 🧩 A sensor exposed as ordinary UVC video may be direct. Calibrated depth/skeleton/vendor SDK paths generally need a companion. |
| Phone LiDAR/depth | Mobile depth camera | Mixed | 🧩 Stream processed depth/points through WebRTC/WebSocket, or use an installable capture companion. |
| EEG/biometric | Brainwave band powers, heart rate, GSR | Mixed | 🧭 Standard BLE/Serial devices may be direct; proprietary dongles/SDKs need a bridge. Treat as sensitive data. |
| HTTP APIs | REST, JSON, images | Direct, stable | 🧭 `fetch`; remote server must allow CORS. Use timeouts, quotas, and secret-safe backend proxies. |
| WebSocket/SSE | Live controls, telemetry, show state | Direct, stable | 🧭 Browser client only. Authenticate, bound message size/rate, and define reconnect semantics. |
| Model adapters | Local inference worker, hosted generation gateway | Direct to compatible adapter | ✅ Video Model supports a built-in no-network preview plus `videobrain.frames.v1` WebSocket/HTTP endpoints. Existing vendor APIs normally require translation; keys stay session-only. |
| MQTT | Venue/IoT messages | Direct through WebSocket | 🧭 Requires a broker WebSocket endpoint and appropriate authentication. |
| OSC | UDP messages from music/control tools | Gateway | 🧩 Browsers cannot open arbitrary UDP sockets. Translate OSC ↔ authenticated WebSocket/WebTransport locally. |
| Raw TCP/UDP | Device protocols | Not direct | ⛔ Use a narrowly scoped bridge; never expose a general network socket proxy to untrusted patches. |
| WebRTC media/data | Peer camera, screen, program video, controls | Direct, stable foundation | ✅ Network Video WHEP receiving. 🧭 Publishing, generic peer signaling, data channels, and TURN configuration; connection state remains session-only. |
| HLS/DASH playback | CDN live/VOD streams | Direct where codecs/player permit | ✅ Network Video HLS/DASH modes. Codec support, latency, CORS, and media autoplay rules still apply. |
| MediaRecorder | Canvas, camera, audio capture | Direct, stable foundation | 🧭 Container/codec combinations vary; test capabilities and memory duration before recording. |
| WebCodecs | Low-level encode/decode | Direct but platform-dependent | 🔬 Powerful for worker pipelines, but codec availability and hardware paths vary. It is not a network protocol. |
| WebTransport | HTTP/3 low-latency data | Direct to a compatible server | 🔬 Not arbitrary UDP and not universally available; requires purpose-built infrastructure. |
| RTMP/SRT/RTSP | Broadcast ingest/output, contribution links | Gateway | 🧩 No direct browser socket/media path. Terminate, transcode, and monitor in a service or companion. |
| Network video | NDI-style production feeds | Gateway | 🧩 Discovery, codecs, multicast, and native SDKs require a local/native gateway. WebRTC is the browser-facing leg. |
| Shared GPU textures | Spout/Syphon-style zero-copy sharing | Gateway | 🧩 Browser sandboxes do not expose native cross-process texture handles. Use a native capture/publish companion. |
| SDI | Capture/output cards | Mixed/gateway | 🧩 A card exposing UVC may appear as a camera; professional format, key/fill, and output control need native APIs. |
| DAW/plug-in APIs | Transport, tracks, VST/AU parameters | Gateway | 🧩 MIDI/WebSocket can carry controls; native plug-in hosting and deep DAW APIs require a companion/plugin. |
| Lighting | USB-DMX, Art-Net, sACN | Gateway or limited device path | 🧩 USB hardware may be reachable in some browsers, but UDP lighting protocols and reliable show output belong in a venue gateway. |
| Time sync | MIDI clock, MTC, LTC, NTP-like service | Mixed | 🧭 MIDI may be direct; LTC can be decoded from audio; genlock/frame-lock and authoritative venue time need native hardware/service support. |
| Recording/download | PNG, WebM/MP4 where supported, project archive | Direct | 🚧 Use streaming writes where available, report codec support, and warn before memory-heavy captures. |

### Internal and external streaming model

Keep these paths distinct in product language and implementation:

1. **Inside one graph:** pass GPU resource references between frame nodes. Do not read pixels back to the CPU unless a node explicitly requires it.
2. **Between tabs/workers:** use transferable data, `ImageBitmap`, `VideoFrame`, or shared memory only after profiling. An `OffscreenCanvas` worker is a likely scaling path.
3. **Browser to browser:** use WebRTC media/data. A real deployment needs a signaling service, TURN credentials, peer lifecycle, bitrate policy, and observability.
4. **Browser to server/CDN:** encode with supported browser facilities, then hand off to a service designed for distribution and archival.
5. **Browser to venue protocols:** terminate WebSocket/WebRTC at a local authenticated gateway that owns UDP, lighting, native video, SDI, or GPU-sharing APIs.
6. **Browser to a model runtime:** connect only to a compatible, trusted adapter. Keep provider secrets behind that adapter, drop stale input, bound every returned image, and make camera transmission explicit. See [Model Connectors](MODEL_CONNECTORS.md).

## Example patch and preset library

Arrows show the primary signal path. A semicolon separates modulation. Nodes not yet shipped are marked with their roadmap status. The New patch menu ships Blank Canvas plus 29 starter graphs; the registry-backed menu is the authoritative inventory. Recipes below distinguish bundled starters, manual recipes using existing nodes, and future demonstrations. Choosing a starter is an undoable, validated graph replacement; it stops device/model sessions and clears transient credentials. A future gallery should add thumbnails, learning goals, required capabilities, expected GPU cost, output aspect, and a "restore original" action.

### Beginner: learn one idea at a time

1. **Full Studio — available in New patch**

   `Transport Time → Beat Clock → Oscillator; Flow Field + Cells/Warp → Blend → Trails → Color Grade → Video Model → Display; AI Chat → Video Model.Prompt`

   Tour control, text, and frame routing; audio-block routing has separate File and audio examples. Video Model begins in its built-in procedural preview and needs no model service.

2. **Beat-Synced Color — available in New patch**

   `Transport Time → Beat Clock → Oscillator; Flow Field → Warp → Trails → Display`

   Change waveform and frequency to see one control signal clearly.

3. **Pointer Bend — available in New patch**

   `Flow Field → Warp → Color Grade → Display; Pointer.X → Warp.Amount; Pointer.Y/Held → Color Grade`

   Introduces direct interaction without a permission prompt.

4. **Two-axis Color Ride — available as a manual recipe**

   `Flow Field → Color Grade → Display; XY Pad.X → Color Grade.Hue; XY Pad.Y → Color Grade.Exposure`

   Drag inside one node to perform two independently patchable values at once.

5. **Camera Dream — available in New patch**

   `Video Input + Flow Field → Blend → Warp → Color Grade → Display; Pointer.X → Warp.Amount; Pointer.Y → Color Grade.Hue`

   Demonstrates explicit camera start, live texture upload, a procedural
   fallback layer, mirroring, and hands-on distortion/color control.

6. **Mic Pulse Trails — available in New patch**

   `Flow Field → Trails → Color Grade → Display; Audio Level → Flow Field.Energy, Trails.Feedback, Color Grade.Hue`

   Shows one audio-level control driving three visible roles. The procedural
   visual works without a microphone; audio-driven modulation reads silence
   until the microphone is explicitly enabled.

7. **Two-World Mixer — available in New patch**

   `Flow Field → Blend.A; Cells → Blend.B → Display; Oscillator → Blend.Mix`

   Compare blend modes and slow automatic crossfades.

8. **Prompted Visual Preview — available in New patch**

   `AI Chat → Video Model.Prompt; Flow Field → Video Model.Source → Display`

   Edit bounded prompt text and explore strength, guidance, and seed while the safe built-in preview makes no network request.

9. **Control Math — available in New patch**

   `Oscillator → Math.A; Constant → Math.B; Math → Map Range → Blend.Mix; Flow Field + Cells → Blend → Display`

   Teaches reusable values, arithmetic, and explicit conversion from a scaled
   wave to the normalized range expected by a visual mix.

10. **Smooth Pointer — available in New patch**

    `Pointer.X → Map Range → Smooth → Transform 2D.X; Flow Field → Transform 2D → Color Grade → Display`

    Centers normalized pointer input and adds separate rise/fall response before
    it moves a frame. Every teaching node is on the Display-reachable path.

11. **Transform Playground — available in New patch**

    `XY Pad.X/Y → Map Range → Transform 2D.X/Y; Oscillator → Map Range → Transform 2D.Rotation; Constant → Transform 2D.Scale`

    Provides hands-on translation, mapped automatic rotation, reusable scale,
    pivot controls, and visible edge modes in one complete graph.

12. **Mask & Composite Lab — available in New patch**

    `Cells → Threshold → Mask.Mask; Flow Field → Mask.Source → Composite.Foreground; Solid → Composite.Background → Display`

    Separates three distinct operations: making a soft matte, applying it to
    alpha, and layering the cutout over a background.

13. **Beat Switcher — available in New patch**

    `Beat Clock.Bar → Map Range → Frame Switch.Index; four animated sources → Frame Switch → Display`

    Divides a tempo-locked bar across four visibly different visual sources.
    Every source and the control chain remain reachable from Display.

14. **Live Cut Lab — available in New patch (flashing imagery)**

    `Transport Time → Auto Selector; four sources → Frame Switch → Strobe → Color Grade → Display; Auto Selector.Index → Frame Switch.Index; Auto Selector.Phase → Strobe.Phase`

    Visits all four configured sources in a repeatable shuffle bag while one
    normalized interval phase coordinates the cut and a softened invert pulse.
    The bundled 1.5-second interval is about 0.67 cycles per second and requires
    no permission. Replace one source with Video Input and explicitly start the
    camera for a live cut. See the photosensitivity guidance before changing
    timing or intensity.

15. **Audio Soft Focus — available in New patch**

    `Audio Level → Map Range 0–18 → Blur.Radius; Flow Field → Blur → Display`

   Demonstrates that audio analysis remains a control signal rather than an
   audio frame. Before microphone opt-in the source still renders, but the
   audio control reads silence rather than a synthetic demo pulse.

16. **Spiral Feedback Lab — available in New patch**

    `Transport Time → Cells → Spiral Feedback → Color Grade → Display; XY Pad.X/Y → Spiral Feedback.Center X/Y`

    Learning goal: see how a purpose-built retained-frame boundary differs from
    an ordinary graph cycle. The prior output rotates and zooms before the live
    Cells frame is blended in; XY Pad moves the center. Feedback is bounded and
    measured per elapsed visual second, pause preserves history, and Return to
    frame zero deterministically discards and seeds that history again.

17. **Poster Maker — available in New patch**

   `AI Chat → Text; Text + Gradient → Composite → Display`

   Apply a text draft, compare alignment and wrapping, import a local font, and
   composite transparent lettering over a gradient. A connected string overrides
   Text's saved fallback without discarding it.

18. **Feedback Basics — available as a manual recipe**

   `Cells → Warp → Trails → Display; Oscillator → Trails.Feedback`

   Explains why retained state differs from a normal graph cycle.

19. **Shape Studio — available in New patch**

   `Shape + Vector Shape → Composite → Display`

   Compare filled and outlined GPU primitives, then draw, transform, and layer
   vector objects over them. Import or export bounded static SVG, and use Apply
   artwork to commit one undoable project edit or Cancel to keep the original.

20. **Image Remix — available as a manual recipe**

   `File → Tile / Kaleidoscope → Color Grade → Display`

    Teaches local assets and non-destructive image processing.

### Live visuals and performance

**Projection Mapping Lab — available in New patch**

`Procedural source → Projector Mapping → Display`

Edit the four quad corners, move, scale, and rotate a planar projection. This
already covers corner-pin warping without devices or permissions. Editable
meshes, projector edge blending, and named venue output layouts are separate
extensions, not additional names for this shipped processor.

**Color & Channel Lab — available in New patch**

`Gradient → Levels → HSV / HSL → Channel Shuffle → Luma Key → Composite → Display; Solid → Composite.Background`

Remap tones, switch color models, route channels, and reveal a background
through keyed alpha. Every new processor is reachable and permission-free.

**Keyed Camera — available in New patch**

`Shape over green Solid → Frame Switch.A; Video Input → Frame Switch.B; Frame Switch → Chroma Key → Composite → Display; Flow Field → Composite.Background`

Start with the procedural green-screen fixture at Index 0. For a real camera,
explicitly Start camera and select Index 1; adjust the key RGB, tolerance,
softness, and spill suppression. Loading the patch never requests a camera.

**Displacement Map Lab — available in New patch**

`Gradient → Displace → Edge → Display; Noise (curl) → Displace.Map`

Use red/green map channels as UV offsets, compare border modes, and extract
Sobel edges. Disconnecting Map restores neutral displacement.

**Pattern & Mix Lab — available in New patch**

`Flow Field → Pixelate → Tile / Kaleidoscope → Crossfade.A; Cells → Crossfade.B; Oscillator → Crossfade.Mix; Crossfade → Display`

Compare pixel blocks, repeat/mirror/polar symmetry, and alpha-correct mix
curves. The slow oscillator provides position; Crossfade has no internal clock.
Disconnect Mix to return to its saved slider value.

**Shader Lab — available in New patch**

`Constant → Shader Source.uValue2; Shader Source → Display`

Edit the fragment body and Apply it as one undoable change. The host declares
`vUv`, `uResolution`, `uTime`, and `uValue1` through `uValue4`; assign `outColor`.
Compare the saved uniform slider with a connected control. Compile errors keep
the last valid program running; invalid imported source starts transparent.
The supported subset and static budgets are documented in
[Architecture](ARCHITECTURE.md#constrained-glsl-source).

**Noise Lab — available in New patch**

`Transport Time → Noise → Display`

Compare five noise modes and three fractal styles. Seed and resolved time make
reset repeatable; curl encodes XY in red/green channels. All work is local and
bounded to one GPU pass, with at most six fractal octaves.

**Gradient Lab — available in New patch**

`Gradient + Solid Color → Composite → Display`

Learning goal: compare linear, radial, and conic coordinates, place multiple
color stops, and reveal a background through per-stop alpha. All modes support
2–8 stops and need no permissions. Stops interpolate with premultiplied alpha;
angle, center, and radius accept control overrides. See the Gradient contract
in [Architecture](ARCHITECTURE.md#architecture-review-gate).

1. **A/B Clip Deck — P1/P2**

   `Playlist A 🧭 + Playlist B 🧭 → Crossfade → Color Grade → Display; MIDI 🧭 → Crossfade.Mix`.

2. **Audio Spectrum City — P1/P2**

   `Audio Level.Audio → Audio Spectrum.Bass/Mid/Treble → Instance 🧭 → Render 3D 🧭 → Bloom 🧭 → Display`.

3. **Camera Feedback Tunnel — available as a manual recipe**

   `Video Input → Transform 2D → Trails → Color Grade → Display; Audio Level → Map Range → Transform 2D.Scale`.

4. **Four-camera Switcher — P2**

   `Video Input ×4 → Frame Switch → Grade → Display; MIDI/Gamepad 🧭 → Frame Switch.Index`.

5. **Lyric Overlay — P1**

   `Video/File source → Composite; Text → Composite → Display; WebSocket 🧭 → Text.Text`.

6. **Beat-cut Montage — P1/P2**

   `Playlist 🧭 → Frame Switch → Display; Audio Spectrum.Bass → Audio Trigger → Counter 🚧 → Frame Switch.Index`. Existing Source Selector can already advance from Audio Trigger's scalar rising edges; a general typed-event Counter remains future work.

7. **MIDI Performance Rack — P1/P2**

   `Macro Controls 🚧 → visual parameters; MIDI In 🧭 → Map Range → Macro Controls` with learn, takeover, and feedback.

8. **Phrase-synced Scene Bank — P2**

   `Clock 🧭 → Quantize 🧭 → Scene Bank 🧭 → Router 🧭 → Program Display`.

9. **Network FOH Feed — P2**

   `Program → WebRTC Publisher 🧭 → receiver browser at front of house`; include bitrate and reconnect controls.

10. **Broadcast Companion — P2**

    `Program → Broadcast Gateway 🧩 → SRT/RTMP`; browser shows gateway health and return preview.

11. **LED Color Conductor — P2**

    `Program → Downsample 🚧 → LED Pixel Map 🧭 → Lighting Gateway 🧩`; add master dimmer and blackout.

12. **Touring Show Preflight — P2**

   `Cue Stack 🧭 + Asset Bin 🚧 + Device Status 🧭 → Preflight panel`; verifies assets, devices, permissions, resolution, and network before GO.

13. **Compatible Model Adapter Lab — available connector / external adapter**

    `AI Chat → Video Model.Prompt; optional Video Input → Video Model.Source → Display`

    Start in Preview, then connect a trusted user-run `videobrain.frames.v1` adapter. Compare HTTP one-shot output with WebSocket frames, verify the visible destination, and demonstrate that the API key is not persisted.

### Interactive installation and spatial work

1. **Silhouette Garden — P1/P2**

   `Video Input → Person Segmentation 🧭 → Mask; Flow Field → Composite → Projection Output 🧭`.

2. **Motion History Mirror — P1/P2**

   `Video Input → Frame Difference 🚧 → Trails → Color Grade → Display`.

3. **Air-drawing Ribbons — P2**

   `Video Input → Hand Landmarks 🧭 → Gesture 🧭 → Particle Source 🧭 → Render 3D → Display`.

4. **Depth Point-cloud Portrait — P2/bridge**

   `Depth Gateway 🧩 → Depth Unproject 🧭 → Point Filter 🧭 → Render 3D → Display`.

5. **Spatial Buttons — P2**

   `Body Pose 🧭 or Depth Zones 🧭 → Spatial Buttons 🧭 → State Machine 🧭 → Scene Bank`.

6. **Projection-mapped Memory Wall — P2**

   `Video Input → Frame Difference 🚧 → Zones 🧭 → particle scene 🧭 → Projector Mapping → Display`. Four-corner mapping is available; motion analysis, particles, and venue calibration remain future work.

7. **Interactive Floor — P2/bridge**

   `Ceiling depth sensor 🧩 → Zones/Blobs 🧭 → GPU particles 🧭 → Projector output`.

8. **Audience Phone Constellation — P2**

   `Mobile Control Page 🧭 → authenticated WebSocket → point positions/colors → Render 3D` with rate limits.

9. **EEG Aura — P2/bridge**

   `BLE EEG 🧭 or gateway 🧩 → Smooth → Flow Field/particles → Display`; never store biometric data by default.

10. **Environmental Data Sculpture — P2**

    `Serial/BLE sensors 🧭 → Map Range → geometry/material controls → Display` with record/replay for testing.

11. **Generative Escape Room — P2**

    `Device inputs → State Machine → Cue Stack → visuals + lighting gateway`; provide watchdog and manual override.

12. **24/7 Gallery Kiosk — P2**

    `Schedule → Scene Bank → Display`; health dashboard, automatic recovery, cached assets, and remote read-only status.

### Network, remote, and collaborative patches

1. **Remote Director:** mobile macro panel → WebSocket → performer browser.
2. **Peer Camera Quilt:** multiple WebRTC receivers → Multi-view Layout → Program.
3. **Control Relay:** OSC Gateway 🧩 → typed controls → visual patch; expose only mapped addresses.
4. **Venue Lighting Mirror:** sACN/Art-Net gateway 🧩 → fixture state preview; no output until armed.
5. **Distributed Render Wall:** one authoritative clock/state service → several browser outputs, with drift diagnostics rather than pretending to provide hardware genlock.
6. **Rehearsal Replay:** record control/network events → replay without devices at deterministic time.
7. **Audience Vote Visual:** QR control page → rate-limited votes → aggregate → palette/scene selection.
8. **Shared Patch Review:** read-only share link + captured preview + graph comments before real-time co-editing.

### Advanced and research demos

1. **Reaction-Diffusion Canvas:** persistent compute texture → grade → projection.
2. **Audio Nebula:** spectrum → GPU particle forces → PBR render → bloom.
3. **Hand-tracked Chaotic Attractor:** hand landmarks → attractor parameters → ribbon/particle render.
4. **Monocular Parallax Portrait:** image/video → estimated depth → depth warp → grade.
5. **Pose-to-Art:** body pose → local/remote generative model → temporal stabilizer → display.
6. **Neural Style Camera:** camera → bounded ML transform → queue/drop-late → fallback composite.
7. **Gaussian Splat Flythrough:** splat asset → camera controls → render → tone map.
8. **Generative Architecture:** rules/scatter/instances → PBR material → multi-camera render.
9. **XR Light Sculpture:** particle/geometry graph → immersive WebXR output.
10. **Shader processor extensions:** texture inputs and broader validated GLSL beyond the shipped Shader Lab source/uniform workflow.
11. **Hybrid Venue Router:** browser composition + gateway video ingest + lighting + remote control, all with capability status.
12. **Deterministic Render Study:** fixed-step clock + seeded random + render queue; compare live and offline frames.

## Preset packaging requirements

Every bundled example should ship with:

- a stable ID and preset schema version;
- title, one-sentence goal, difficulty, tags, and thumbnail;
- declared device, permission, network, and bridge requirements;
- expected resolution, frame rate, render-pass count, and memory class;
- bundled/remote asset inventory with licenses and hashes;
- a no-device fallback whenever it can still teach the concept;
- saved node positions and a short guided-tour sequence;
- one-click restore that never overwrites the user's saved patch without confirmation;
- automated load/compile/render smoke coverage.

A useful initial gallery is 15 excellent, legible examples rather than 100 fragile patches.

## Architecture lessons worth preserving

### Graph evaluation

- Continue compiling backward from connected outputs. Disconnected experiments should not consume GPU time or request devices.
- Keep the serialized graph declarative and immutable from the renderer's perspective.
- Keep ordinary graphs acyclic. Stateful time nodes need an explicit delay contract with separate read/update phases and deterministic reset.
- Give every port and parameter a stable ID. Titles can change; serialized IDs cannot change casually.
- Preserve explicit port indexes in catalog/inspection data so multi-input order
  never depends on edge-array order or canvas position.
- Preserve every parameter's saved literal while a compatible connected signal
  overrides its resolved runtime value; disconnecting restores the literal.
- Keep signal conversion explicit and inspectable instead of silently coercing
  a type, unit, rate, or shape at connection time.
- Treat current router reachability as structural. Add conditional branch
  cooking only with explicit rules for selector timing, retained state,
  capability sessions, and switch-over frames.
- Return structured diagnostics with node/port IDs so the editor, automation clients, and tests see the same errors.
- Define behavior for multiple Displays early: selected program, preview, named output, or explicit output routing.

### Inspection and automation

- Keep project-schema, operator-catalog, and protocol versions independent.
- Derive catalog and inspection responses from the real registry and compiler;
  do not maintain a second list of graph semantics for integrations.
- Preserve the implemented per-kind pass/target/state metadata and aggregate
  plan costs; expand inspection with clock dependencies, actual texture bytes
  and resolution, capability readiness, dirty/static state, last duration, and
  last-cook reason.
- Add runtime capability negotiation before exposing device, network, audio,
  model, or gateway commands.
- Make future mutations typed, atomic, revision-checked, idempotent, and subject
  to the same validation and budgets as UI commands.
- Keep arbitrary command-string evaluation outside the browser automation
  boundary. See [Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md).

### Runtime boundaries

- The editor owns commands and project state; the compiler owns validation/planning; runtimes own GPU, audio, media, network, and device resources.
- Upload a camera/video frame once per source per display frame, then reuse its GPU texture throughout the plan.
- Evaluate audio on its own sample clock and expose analysis snapshots to the visual clock.
- Prefer workers for expensive parsing, ML, geometry, and codec work. Move the visual renderer off-main-thread only after measuring browser/GPU behavior.
- Keep WebGL2 as a reliable baseline while introducing WebGPU behind a capability-neutral renderer interface.
- Make loss and recovery normal states: WebGL context, camera track, audio device, Bluetooth device, WebSocket, WebRTC peer, and bridge can all disappear.

### Project and asset model

- Store capability wishes, not live handles: for example, preferred camera facing mode rather than a `MediaStreamTrack` or browser device ID.
- Add migrations before changing the schema version. Import remains all-or-nothing and bounded.
- Treat assets as first-class records with type, byte size, hash, origin, license/note, and missing state.
- Decide deliberately whether assets live in browser storage, an exported project archive, or cloud storage. A temporary object URL is never durable project state.
- Preserve deterministic seeds, clock mode, and reset semantics so examples and tests reproduce.

### Modules and extensibility

- A module should declare typed public inputs, outputs, parameters, capability needs, and version.
- Start with first-party modules serialized using the same internal graph; delay third-party execution until a real permissions/package design exists.
- Future packages need signing or trust UI, exact API versions, a capability manifest, CSP-compatible loading, resource budgets, and revocation.
- Custom shader nodes must validate source, cap texture/pass sizes, surface line-mapped compile errors, and display a safe fallback.
- Automation and AI-assisted building should call the same transactional command model as the UI and must never bypass validation or budgets.

### Time and synchronization

- Separate wall clock, visual elapsed time, audio time, media time, show timecode, and network-authoritative time.
- Pause/reset behavior must be defined for every stateful node.
- Clamp or deliberately catch up after a suspended tab; never let a long sleep create an accidental simulation explosion.
- Browser outputs can synchronize state and estimate drift, but hardware frame lock/genlock is a native-system feature.
- For performance presets, support a fixed-step rehearsal/render mode in addition to live display-clock mode.

## Permissions, privacy, and security

Device and network nodes are capabilities, not ordinary values.

| Concern | Product rule |
| --- | --- |
| Camera/microphone/screen | Start only from a clear user action. Show requesting/live/denied/ended states and a visible stop control. |
| Device selection | Remember a preference only when useful; tolerate changed IDs and missing hardware. |
| Media privacy | Process locally by default. Label every node that transmits frames/audio and show its destination/connection state. |
| Biometrics | Treat face, body, voice, EEG, heart rate, and presence as sensitive. Do not retain or transmit by default. |
| Remote assets | Enforce size/type/time limits and explain CORS failures. Avoid leaking credentials in project files. |
| Network inputs | Authenticate where appropriate; cap message bytes/rate/queue depth; validate shape before graph state. |
| Model connector | State clearly that Preview is not inference; require a compatible adapter; keep keys in memory; show the destination; send a camera only through an explicit live connection; require HTTPS/WSS for API mode and credentials, with plain transport limited to credential-free Local loopback use. |
| Bridge | Bind locally by default, use short-lived pairing, origin checks, capability allowlists, and visible armed/output states. |
| Lighting/laser/show control | Include master dimmer/blackout/manual override and explicit arming. Safety-critical interlocks stay outside the browser. |
| Scripts/shaders/packages | Sandbox, declare capabilities, enforce resource budgets, and never silently fall back to unrestricted evaluation. |
| Shared projects | Strip secrets/tokens/device identifiers and ask before including media assets or captured data. |

The app should include a capability center listing which nodes want camera, microphone, MIDI, devices, network, or bridge access; current grant/connection state; and one place to stop/revoke live sessions.

## Performance and reliability plan

### Budgets and observability

- Preserve hard import and graph limits; add per-node estimates before raising them.
- Track CPU frame time, GPU time where reliably available, frame queue depth, dropped media frames, render-target bytes, asset bytes, and audio underruns.
- Make resolution an explicit output/runtime choice. Add adaptive resolution as an opt-in policy, never a silent project mutation.
- Pool compatible render targets only after lifetime analysis proves reuse is safe.
- Precompile shaders and warm media/ML nodes before a live cue becomes program output.
- Drop stale video/ML/network work. A live system should prefer the newest result over an ever-growing queue.
- Keep model adapters capability/version negotiated, preserve a no-network fallback, and report warmup, queue depth, latency, and dropped inputs before expanding the protocol.

### Graceful degradation

- Missing camera: show a diagnostic/test frame and keep the graph editable.
- Unsupported API: explain the browser/platform boundary and suggest a compatible input or gateway.
- Lost network: retain last safe frame or switch to a configured fallback scene.
- Lost graphics context: stop issuing commands, report recovery, rebuild resources, and reset state predictably.
- Over budget: reject or bypass the responsible operation with a specific message; never crash the whole patch silently.
- Background tab: communicate throttling and provide a dedicated-display/window recommendation for shows.

### Deployment modes to plan for

1. **Creator:** full editor, local autosave, devices on demand.
2. **Performer:** curated controls, preview/program, presets, preflight, recording.
3. **Player/kiosk:** locked patch, auto-start after allowable user gesture, watchdog, cached assets, remote status.
4. **Gateway-connected venue:** paired local service for specialist I/O with explicit health and arm state.
5. **Viewer:** read-only program stream or shared patch with no editing capabilities.

## Testing strategy

### Every node

- Registry/default parameter test.
- Port type and required-input test.
- Import validation and migration coverage.
- Deterministic evaluation test where applicable.
- Runtime resource create/update/dispose test.
- Lost/unavailable capability path.
- Budget boundary and malformed input test.
- At least one representative graph compile/render test.

### Browser and device features

- Use fake camera/microphone devices in browser automation for the normal path.
- Unit-test late permission resolution and ensure tracks are stopped after cancellation/unmount.
- Test denied, missing API, ended track, device change, and context restoration.
- Maintain a small real-device matrix for camera, audio interface, MIDI, gamepad, and each gateway release.
- Do not make CI depend on a physical device or public network service.

### Visual and performance coverage

- Keep deterministic reference patches at fixed size/time/seed for pixel-tolerance snapshots.
- Run long-lived feedback/media smoke tests to catch resource growth.
- Record startup, steady-state, graph-edit, resize, and context-restore performance traces.
- Exercise low-power/integrated GPUs and high-DPI displays before increasing default quality.
- Validate keyboard navigation, modal focus, contrast, reduced motion, and screen-reader names.

### Deployment coverage

- Build from a clean install.
- Scan committed product code/docs for prohibited names and unintended secrets.
- Validate infrastructure templates and security headers.
- Smoke the deployed HTTPS origin, asset caching, camera/microphone permission policy, SPA fallback, and stale HTML behavior.
- Keep deployment credentials short-lived through CI identity federation.

## Suggested delivery sequence

The phases describe product packaging. Within a phase, the explicit dependencies and
acceptance criteria in [Protocol-governed module waves](#protocol-governed-module-waves)
are authoritative; wave numbering does not impose a sequential release order.

### Phase 1 — durable browser instrument (P1)

- Complete Wave 1 beyond the shipped File node: screen capture, dedicated
   Crop/Fit, Resize, Test Card, and a first-class durable media asset record.
- Wave 5's independent stateless frame-effects batch is implemented with four
   teaching patches, individual operator stories, registry/serialization tests,
   and GPU pixel checks. It did not require Waves 2 or 3.
- Deliver Wave 2 explicit frame state: general Delay/Feedback with deterministic
  initialization, read/commit, pause/reset/seek, and inactive-branch behavior.
- Deliver Wave 3 typed decisions and events: `control.bool`, `event.trigger`,
  explicit converters, Compare, Logic, Trigger, Gate, Hold, Frame Hold, Counter,
  Timer, and seeded Random.
- Complete Wave 4 with device/channel selection, public spectrum wires, and
   sample-critical processing. File, Mixer, Audio Output, and scalar
   spectrum/band/onset/tempo analysis are already shipped.
- Add event-triggered timed transitions through Wave 3's control/event path,
   reusing stateless frame interpolation rather than coupling it to a new clock.
- Harden the current model adapter contract with conformance fixtures, cancellation, capability negotiation, and explicit source-upload semantics.
- Add grouping, named parameters, presets, macro controls, the teaching-preset
  gallery, snapshot/recording, capability center, improved diagnostics, and
  adaptive-resolution experiments.
- Extend the read-only catalog and inspection contract in every wave; add
  migrations before any incompatible schema change.

### Phase 2 — performance and installations (P2)

- Deliver Wave 6 reusable public boundaries, then scene banks, cue stack,
  preview/program, and preflight.
- Add MIDI/gamepad/device mapping, general data WebSocket I/O, and WebRTC
   publishing/data channels beyond the shipped Network Video receiver.
- Add CV landmarks/segmentation/zones and first GPU particle/3D render pipeline.
- Extend Projector Mapping with mesh warping; add multi-output layouts,
  venue edge blending/calibration, LED pixel mapping, and a paired gateway protocol.
- Add player/kiosk mode, offline asset caching, watchdog behavior, and remote health.

### Phase 3 — advanced creation (P3)

- Add WebGPU compute backend where it materially improves nodes.
- Add geometry/material/point types, simulations, depth pipelines, and advanced ML nodes.
- Define secure custom shader and package systems.
- Add typed automation gateway and optional AI-assisted patch authoring.
- Explore collaboration and cloud assets without weakening local-first use.

## Contribution guide

The project lives at [github.com/blechdom/videobrain](https://github.com/blechdom/videobrain). Issues, focused pull requests, example patches, browser/device reports, design feedback, and documentation improvements are welcome.

### Good first contributions

- A small control node with unit tests.
- A deterministic procedural visual or single-pass frame effect.
- A polished example patch using only existing nodes.
- An unavailable/permission error-state improvement.
- Accessibility, keyboard, responsive layout, or documentation work.
- A real browser/GPU/device compatibility report with exact versions and reproduction steps.

### Before implementing a node

Open an issue or discussion describing:

1. the creative use case and at least one example patch;
2. proposed typed inputs, outputs, parameters, defaults, and units;
3. runtime domain: UI, visual-frame CPU, GPU, audio, worker/WASM, device, network, or bridge;
4. permissions/capabilities and a no-device fallback;
5. expected memory/pass/latency cost and failure behavior;
6. serialized schema impact and migration needs;
7. test plan and browser support assumptions.

### Pull request checklist

- Use stable IDs and the existing registry/command model.
- Keep runtime handles out of project state.
- Add validation, cleanup, and actionable errors.
- Add focused unit tests plus an end-to-end path when user interaction changes.
- Verify `npm run verify` and browser smoke tests.
- Update Help/About and this roadmap when current behavior changes.
- Include a bundled example where every new node is reachable from Display;
  extend the all-node preset coverage test so this remains true over time.
- Document any remote data transfer, permission, experimental API, or gateway requirement.

## Browser API reading list

These references define the capabilities and constraints behind the I/O plan:

- [Media capture and `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Screen capture and `getDisplayMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
- [Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API)
- [WebHID API](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API)
- [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
- [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)

## Decisions to revisit with real users

- Whether the primary metaphor is a project, patch, scene, composition, or show—and how those nest.
- Whether control ports should appear for every numeric parameter or be added on demand.
- How multiple displays/program outputs are selected and routed.
- Whether media assets are embedded in exported archives by default.
- How much audio generation belongs in the product versus analysis/control only.
- Which first gateway platform and protocols unlock the most installations.
- Whether modules can contain device permissions or must receive devices through explicit outer ports.
- How custom shaders and third-party nodes earn trust.
- Which next examples best expand the current teaching set without
  sacrificing clarity or coverage.

This document should stay honest: move a line to ✅ only when it is usable, cleaned up, tested, and documented in the shipping app.
