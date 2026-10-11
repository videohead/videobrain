# VideoBrain Architecture

Status: proof-of-concept architecture. This document defines the product model and the boundaries that the first implementation should preserve as it grows.

## Purpose

VideoBrain is a browser-native environment for building live visual systems from connected nodes. Editing and playback happen at the same time: changing a value or connection should affect the output immediately, without a separate compile or export step.

The first release presents one **Signal Graph** with four typed paths:

- a GPU-backed `frame.rgba` path for generating, receiving, and processing images;
- a CPU-backed `control.f32` path for transport/beat timing, oscillation, editable XY values, pointer/audio input, and parameter modulation;
- a `text.utf8` path for model prompts and future text processing.
- an `audio.block` path for session-owned media playback routed to an explicit
  Audio Output node.
- Audio Mixer is an audio-domain processor with eight stable optional inputs;
  its source-count selector activates 2, 4, or 8 inputs and its low/mid/high
  parameters control a shared three-band EQ.

An optional session-owned connector can exchange prompts and bounded image frames with a compatible user-run model adapter. The default graph instead uses a built-in procedural preview, so it opens without a backend, network request, credential, or device permission.

The architecture deliberately separates the editor, the persistent project, and the real-time runtime. This lets the product change its renderer, move work to workers, add collaboration, or expose an automation API without replacing the graph editor.

Sections that name the POC describe current behavior. Features explicitly called future or target-state are preserved design boundaries, not claims about this release.

## System map

```text
Pointer / keyboard / clocks / media devices
                     |
                     v
             +-----------------+
             | Input adapters  |
             +--------+--------+
                      |
Text prompts -> Control/text plan -- resolved values ------+
                      |                                    |
                      v                                    v
Frame sources -> Frame processors -> Active Display -> Preview canvas
Audio files -> Audio Mixer -> Audio Output -> Browser speakers
      ^               |                                      |
      |               v                                      v
      |          GPU textures                         Runtime status
      |                                                      |
Compatible model adapter <-> session connector       Editor / inspector
                                                             |
                                                     validated commands
                                                             |
                                                             v
                                                    Serializable project
```

Display and Audio Output nodes are demand roots. Only nodes reachable from an output belong to the corresponding execution plan. Input events update controls or authoring state; they do not render directly.

## Core concepts

### Node

A node is a typed transformation with named input ports, output ports, and parameters. A node kind is registered once and describes:

- a stable kind identifier;
- category, label, and help text;
- port names, types, order, and connection limits;
- parameter types, defaults, ranges, and presentation hints;
- the runtime domain used to evaluate it.

Node instances contain only project data: identity, kind, position, parameter values, and presentation state. GPU handles, media streams, compiled programs, and timing samples are runtime data and must never be serialized into the project.

The operator library's category is discovery metadata, not graph semantics. Its
ordered groups are Timing, Control, Interaction & AI, Inputs, Generators, Image
Processing, Compositing, and Output. A category can change where a node is found
without changing its serialized kind, port types, or runtime domain. Category
IDs and their intended growth boundaries are defined in
[Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md#operator-library-categories).

### Port and edge

Every port has a data type. An edge is valid only when the source and destination types are compatible and the destination has capacity. Cross-type behavior is represented by an explicit adapter node rather than an implicit conversion.

Ports also have explicit indexes in their operator contract. Stable port IDs
remain the serialized connection identity; indexes express semantic input order
for inspection, multi-input processing, and future variadic ports. Edge-array
order and canvas position never determine which input is A, B, foreground, mask,
or selector.

Current and canonical planned data types are:

| Type | Meaning | MVP |
| --- | --- | --- |
| `frame.rgba` | A two-dimensional GPU color image | Yes |
| `control.f32` | A scalar evaluated on the CPU | Yes |
| `text.utf8` | Bounded UTF-8 authoring text, currently used for model prompts | Yes |
| `control.bool` | Sustained logic state | Future |
| `event.trigger` | A discrete occurrence with an optional timestamp and bounded payload | Future |
| `control.vec2`, `control.vec3`, `control.vec4` | Short fixed-size coordinates, colors, or sensor values | Future |
| `audio.block` | Timestamped sample-rate audio with channel metadata | Yes |
| `audio.spectrum` | Bounded FFT bins with sample-rate/window metadata | Future |
| `data.table` | Typed named rows and columns | Future |
| `data.json` | Bounded structured messages | Future |
| `frame.depth` | A depth image with units and calibration metadata | Future |
| `geometry.points` / `geometry.mesh` | GPU spatial data with explicit attributes | Future |

Parameter modulation is part of the dependency graph. Numeric parameters may expose a `control.f32` input. The saved literal is always retained; a compatible connected value overrides it only for runtime evaluation, and disconnecting restores the literal unchanged. Map Range makes scaling, offsetting, clamping, wrapping, and folding explicit in the graph; richer per-port mapping policies remain a future extension. Units and ranges are part of the parameter contract and never change in place without migration.

### Producer, processor, and output

- A producer creates data without a graph input, such as a pattern, clock, or the current opt-in camera source; uploads are a future producer.
- A processor transforms one or more compatible inputs, such as transform, grade, blur, mix, arithmetic, or smoothing.
- An output is a demand root that presents, records, or transmits data.

These roles describe execution behavior; they are not separate object types.

### Module

A module is a reusable nested graph with declared public ports, parameters,
capability needs, reset behavior, and a contract version. Modules are outside
the MVP, but project identifiers and paths must allow hierarchy later. External
edges and automation terminate on stable public port IDs; runtime code and
clients must not reach through that boundary to depend on private internal
nodes. Internal IDs are preserved for module migrations, while incompatible
public changes require a new version or an explicit migration. A planner may
flatten a module internally only when inspection can still explain the public
boundary.

## Stateless frame effects (Wave 5)

The additive kinds `levels`, `hsv`, `lumaKey`, `chromaKey`, `crossfade`,
`displace`, `edge`, `pixelate`, `kaleidoscope`, and `channelShuffle` use the
existing visual-frame clock and straight-alpha RGBA8 working textures. Each
costs one visual pass and one output-sized render target. They retain no
history: pause, reset, seek, and reload reproduce the result for the same
inputs. Disconnected nodes do not cook; ordinary cycles remain rejected.
No device, asset, network, worker, or additional capability is required.

Input index 0 is `source` (`frame.rgba`). Displace and Crossfade additionally
have `map` at index 1, labeled Map and B respectively; Crossfade labels source
A. Both Crossfade frames and Displace's map are optional. Numeric parameters
follow frame inputs in registry order as optional `control.f32` inputs.
Output index 0 is `frame`. Missing frames sample transparent black; a missing
displacement map explicitly produces zero offset regardless of Map neutral.
Required-source diagnostics remain visible while editing incomplete graphs.
Channel Shuffle can intentionally synthesize opaque output from zero/one.

Numeric literals, defaults, bounds, and select IDs live in the registry.
Connected numeric values override, clamp to those same bounds, and never
replace saved literals. Select values map to shader modes in their declared
order. The catalog advances additively to version 15; project schema 1 and
existing kinds/ports remain unchanged, so existing projects need no migration.
Older applications reject the new kinds rather than silently dropping them.

| Kind | Parameter contract (default; range) | Pixel semantics |
| --- | --- | --- |
| `levels` | black 0, white 1 (0..1); gamma 1 (0.01..5); lift 0 (-1..1); gain 1 (0..4) | Normalize by max(white-black, 0.0001), clamp, inverse gamma, gain then lift, clamp RGB; preserve alpha. Reversed/equal points form a near-hard cutoff, not inversion. |
| `hsv` | mode hsv/hsl; hue 0 (-1..1 turns); saturation 1 (0..3); brightness 0 (-1..1) | Hue wraps, saturation multiplies, value/lightness offsets and clamps; preserve alpha. |
| `lumaKey` | threshold 0.5 (0..1); softness 0.1 (0..0.5); invert off/on | Weighted RGB luminance, symmetric soft threshold or hard step at zero softness; multiply source alpha. |
| `chromaKey` | red 0, green 1, blue 0 (0..1); tolerance 0.15 (0..2); softness 0.1 (0..1); spill 0.5 (0..1) | Compare B-luma/R-luma chrominance distance; fade alpha from tolerance to tolerance+softness, suppress projected key chroma in transition pixels. Basic keying, no matte morphology. |
| `crossfade` | mix 0.5 (0..1); curve linear/smooth/easeIn/easeOut | Shape Mix, interpolate premultiplied RGB and alpha, unpremultiply with zero-alpha guard. No internal timer or trigger. |
| `displace` | amountX/amountY 0.1 (-1..1 UV); center 0.5 (0..1); edgeMode transparent/clamp/repeat/mirror, default clamp | Sample source at UV + (map.rg-center)*amount; positive Y samples upward. Map alpha does not scale displacement. |
| `edge` | strength 1 (0..8); invert off/on | Nine bounded samples: 3x3 Sobel of alpha-weighted luminance, clamped borders, grayscale magnitude, center alpha. |
| `pixelate` | size 12 (1..256 output pixels) | Sample centers of square blocks, including truncated border blocks; preserve sampled RGBA, no resolution boundary. |
| `kaleidoscope` | mode repeat/mirror/kaleidoscope (default kaleidoscope); repeatX/Y 1 (0.1..16); segments 6 (2..24, floored); rotation 0 (-180..180 degrees); centerX/Y 0.5 (0..1) | Aspect-correct clockwise rotation around center, optional polar folding, repeat or mirrored UV sampling; Y increases upward. |
| `channelShuffle` | red/green/blue/alpha default to corresponding source channel; each selects red/green/blue/alpha/luma/zero/one | Independently route channels or constants without implicit premultiplication. |

Color arithmetic and luminance weights (0.2126, 0.7152, 0.0722) operate in
the existing working RGB values, not a newly introduced linear-light pipeline.
Sampling uses the existing linear-filtered textures. Single pass is not shader
fusion or a constant-time cost claim; graph pass/target/pixel budgets still
apply. GPU programs and targets use the existing cleanup and context-recovery
path. Teaching presets are Color & Channel Lab, Keyed Camera (procedural A,
opt-in camera B), Displacement Map Lab, and Pattern & Mix Lab.

## Extended WebGL2 frame effects

Catalog 21 adds six kinds without changing schema 1 or existing port IDs.
All use the production WebGL2 runtime and straight-alpha RGBA8 working values,
not a new color-managed or HDR pipeline. Numeric inputs override and clamp to
registry bounds without replacing saved literals. Missing frames are transparent;
the two-input transitions accept either frame disconnected. Other effects retain
the normal required-source diagnostic. Ordinary graph cycles remain invalid.

| Kind | Contract | Cost per output-sized node |
| --- | --- | --- |
| `chromaticAberration` | Radial red/blue offsets around Center X/Y plus signed lens distortion; transparent/clamp/repeat/mirror borders. Split 0 and Distortion 0 are neutral. Output alpha is the maximum sampled channel coverage and RGB is reconstructed from alpha-weighted channels. | One pass/target, three samples |
| `liquidMorph` | A/B transition with a bounded sinusoidal UV field, patchable Mix, Phase, center, scale, and displacement. Mix 0/1 returns exact A/B; interpolates premultiplied color and alpha before returning straight alpha. No internal clock or physics. | One pass/target, two samples |
| `bloom` | Thresholded alpha-weighted luminance with a fixed 5x5 weighted kernel, Radius 0..64 output pixels, Strength 0..4, optional Glow only. Adds bounded glow and expands coverage, clamping working RGB; not multiscale/HDR bloom. Strength 0 with Glow only off is neutral. | One pass/target, 25 kernel samples plus source |
| `scanlines` | Pixel-spaced horizontal cosine modulation and optional three-column RGB phosphor pattern; patchable Phase. Preserves alpha. Amount 0 and Phosphor 0 are neutral. No internal animation. | One pass/target, one sample |
| `liquidMetaballs` | Actual colliding Matter.js 0.20.0 bodies with pointer attraction/repulsion drive an inverse-square metaball field that refracts and masks the source. Bodies 1..32; Seed 0..65535; Radius 0.01..0.1 normalized units; Softness 0.01..0.5. | One pass/target, at most 32 field contributions per pixel; bounded CPU physics |
| `particleTransition` | WebGL2 instanced quads sample tiles of A, shrink/fade and scatter along deterministic seeded trajectories as B appears. Mix 0/1 returns A/B. Grid side 2..100 is floored, giving 4..10,000 instances; no per-particle GPU buffers or readback. This is a scrubbed transition, not free-running particle dynamics. | Three draws, two targets; six vertices per instance |

Particle Transition first renders premultiplied B into its intermediate target,
blends instanced premultiplied A tiles over it, then converts once to straight
alpha. It shares the graph context, restores blend/vertex-array state, and releases
its program/VAO when unused or disposed. Counts are bounded parameters, not
performance promises. Compiler pass/target budgets include all three draws and
both textures. Existing total frame-node and pixel budgets remain in force.

Liquid physics runs in a 1000-by-1000 normalized world with static boundary walls,
zero gravity, drag, restitution, and mutual collision response. The renderer
uploads at most 32 position pairs per tick. This world stretches with output
aspect ratio; it is not a physical fluid solver and does not collide with image
contours. Text, shapes, and other frames can feed its source texture.

The simulation steps at 120 Hz with an accumulator, at most 30 steps per frame.
Equal visual timestamps do not advance it. Backward seeks, time gaps over 250 ms,
and changes to count/seed/radius reinitialize the seeded bodies at the current
timestamp. This bounded policy does not reconstruct skipped physical history.
Reset, branch removal, disposal, and context loss clear the simulation. Restored
contexts recreate GPU resources and seeded initial state. Pointer forces require
explicit Pointer X/Y connections; there is no hidden pointer event listener.

Prism & Glow Lab, Liquid Surface Lab, Particle Transition Lab, and Infinity Mirror
Lab teach these contracts. The last composes mirrored tiling with existing
two-target Spiral Feedback, retaining its per-second rotation/zoom/decay and
read/commit boundaries; it is a real feedback loop, not arbitrary graph cycles
or recursive 3D portal rendering. These effects require no WebGPU device, network,
or permissions. Their WebGL2 implementations are not automatic fallback backends.

## Project and state ownership

The implemented [3D Scene Foundation](SCENE_3D.md) uses typed plain descriptors
on the CPU and a lazy Three.js renderer sharing the frame renderer's WebGL2
context. That contract defines world units, binding precedence, GPU copies,
straight-alpha conversion, conservative resource reservations, and cleanup.
Runtime Three.js objects never enter the serialized graph.

VideoBrain has three kinds of state:

1. **Project state** is deterministic and serializable. The POC contains nodes, edges, and a document schema version; settings, asset references, and output selection can extend that document later.
2. **Session state** belongs to the editor and capability adapters. It contains selection, open panels, viewport position, drag state, temporary menus, permission state, and endpoint-scoped credentials.
3. **Runtime state** is ephemeral. It contains execution plans, GPU resources, media handles, sockets, requests, decoded model frames, previous-frame buffers, resolved controls, errors, and performance counters.

Project changes go through commands in a central store. Commands are the unit of validation, undo, redo, persistence, collaboration, and future automation. Rendering code reads immutable project snapshots and publishes runtime status through a separate, throttled channel. It must not write frame-by-frame values into the authoring store.

The project file is versioned JSON. The POC rejects unsupported schemas or node kinds without replacing the open project. A future migration layer can preserve unknown node kinds as disabled placeholders so opening a newer project does not destroy data.

### Read-only graph protocol

The application now exposes an in-process operator catalog and graph inspection
surface from the same registry and compiler used at runtime. Catalog inspection
reports typed/indexed ports, parameter contracts and layout hints, static
execution costs, graph limits, and versions. Graph inspection reports input
bindings, validation issues, output-root reachability, inactive nodes, execution
order, aggregate visual-pass/render-target cost, and reachable stateful nodes
without rendering or mutating a project.

Project schema, operator catalog, and inspection protocol versions are separate
compatibility axes. Stable node UUIDs plus serialized kind, port, and parameter
IDs are the durable identity layer. Titles, labels, editor position, and other
presentation can evolve without changing an edge contract. See
[Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md) for additive-change rules,
future channel/buffer signals, capability negotiation, and the planned query and
transaction surface.

The installed manual-derived graph knowledge MCP is a high-value architectural
reference for future node waves. When relevant, it helps compare typed
contracts, port ordering, execution/state patterns, and representative graph
structures. It is not a mandatory gate, runtime dependency, or second source of
graph truth. The VideoBrain registry, compiler, browser capability model,
product goals, and documented invariants remain authoritative.

Future protocol mutation is allowed only through bounded typed commands that
use an expected graph revision and idempotent request ID, validate the whole
transaction, and either commit it atomically or preserve the last valid graph.
Transport adapters must not expose arbitrary source-code or command-string
evaluation.

### MIDI and Companion action mappings

The Controllers dialog owns versioned browser-local mappings, separate from
project schema 1. Each mapping has a stable ID and targets a registry parameter,
a frame router, or visual transport. MIDI Learn stores input device ID, channel,
note/CC type, and message number; it does not introduce a MIDI graph wire.
Mapping settings do not travel in project JSON exports.

Web MIDI notes and 7-bit CC and the optional Bitfocus Companion bridge share
the same action dispatcher. Parameter writes use the existing validated project
store and undo/persistence path. Absolute numeric values scale and snap to
registry bounds; set, toggle, and momentary modes also support boolean/select
parameters. Graph-bound targets are rejected. Source actions select or advance
Frame Switch/Source Selector, while transport actions call play/pause/reset.
No controller action starts a capability session or replaces a project.

The Companion service accepts authenticated `POST /api/control` requests and
relays mapping IDs and press/release/value events to one explicitly connected
browser over `/control-ws`. HTTP keys, WebSocket authentication, origin checks,
bounded queues, acknowledgements, and a bounded request-ID cache protect this
limited surface. It is not the planned revision-checked graph transaction API.
The browser resolves mappings locally and requires explicit arming; credentials
remain in memory. Reload, focus loss, and graph replacement disarm controls.
Disconnection releases held values, with a ten-second safety timeout for lost
releases. MIDI CC changes are coalesced at about 30 Hz.

See [Controllers](CONTROLLERS.md) for setup, protocol examples, HTTPS and
Permissions-Policy requirements, persistence, safety behavior, and unsupported
MIDI messages. Physical MIDI/Stream Deck and live Companion validation remain
separate from the automated simulated-input tests.

### Architecture review gate

Gradient (`gradient`, catalog 11) is a stateless, permission-free visual-frame
GPU source: one pass, one render target, output index 0 `frame.rgba`. Optional
`control.f32` inputs are indexed 0 `angle`, 1 `x`, 2 `y`, 3 `radius`; connected
signals replace bounded runtime values without altering saved literals.
It executes only on an output-reachable path and owns no history, clock, or
external resource. Pause, seek, reset, and reload produce the same frame for
the same resolved parameters. Existing renderer disposal and context recovery
own its program and target.

Modes `linear`, `radial`, and `conic` all use 2–8 stops. Stable numeric parameters
`stop1Position` through `stop8Position` and each stop's `Red`, `Green`, `Blue`,
and `Alpha` channels are bounded to 0–1 by the registry. `stopCount` selects
the first numbered slots, rounded to the nearest integer; hidden slots remain
saved. Defaults are two opaque cyan/pink endpoints. Rendering sorts active
stops by position, breaking ties by slot order; the last coincident stop wins
at the boundary, and endpoint colors extend beyond the stop range. Interpolation
uses premultiplied RGBA and converts back to straight alpha for composition.

Coordinates use the shorter output dimension: radius defaults to 0.5, linear
spans twice that radius, radial runs from center to radius, and conic wraps
counterclockwise from the angle ray. Center defaults to (0.5, 0.5), Y increases
upward, and angle is in degrees. The exact conic center resolves to position 0.
The `gradient` parameter-layout hint supplies the shared color-stop editor;
catalog and validation still expose every numeric channel. Schema 1 and the
protocol envelope remain unchanged because this is an additive kind with no
existing projects to migrate. Gradient Lab teaches stop alpha over Solid Color
through Composite to Display.

Every node proposal must identify its typed signal family, explicit indexed
ports, stable IDs and defaults, parameter/input precedence, runtime domain and
clock, demand-root behavior, resource budget, state/reset contract, capability
needs, compatibility impact, and an output-reachable teaching patch. Each
implemented wave also updates catalog/inspection coverage, Help, an operator
story, a complete graph story, and the automated all-node example check. The
full checklist and priority ladder live in
[Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md#module-development-gate).

## Execution model

### POC planning

A structural edit creates a new graph revision. The planner then:

1. verifies node identities and port compatibility;
2. enforces input connection limits;
3. finds nodes reachable from each active output;
4. rejects zero-delay cycles;
5. creates a topological order for control evaluation and frame passes;
6. reports actionable errors before the runtime replaces its last valid plan.

The renderer compares incoming project snapshots with its installed runtime
graph. Position-only edits and equivalent snapshots reuse the existing plan
without compilation or GPU resource reconciliation, preserving control and
feedback state. Parameter, node, and connection changes compile once before
the validated plan is installed; externally supplied compiled graphs are still
revalidated. A renderer error disables the fast path so resubmitting a graph
can retry installation. A later planner can distinguish structural and
parameter-only revisions and add resource-lifetime planning without changing
graph semantics.

Display, recording, streaming, and future gateway outputs are demand roots.
Disconnected branches remain valid authoring material but do not execute,
request permissions, open connections, or allocate runtime resources. Current
inspection distinguishes inactive, invalid, and actively scheduled nodes;
future capability-aware inspection must add a separate permission- or
adapter-blocked state.

### Visual tick

The browser display clock initiates a visual tick:

1. sample monotonic time and the elapsed interval;
2. snapshot current user and device inputs, including pointer held state and one-tick press/release pulses;
3. evaluate reachable timing and control nodes;
4. resolve text bindings and modulated parameters;
5. sample the latest available camera or generated-model images;
6. evaluate reachable frame nodes in plan order;
7. present the selected result to the output canvas;
8. publish throttled diagnostics to the editor.

The POC evaluates every reachable frame node once per scheduled visual tick. Model requests and media capture are asynchronous producers: they publish the latest complete frame without bypassing or blocking the display clock. A future dirty-revision layer can retain static results and skip a node unless an input, resolved parameter, clock dependency, or retained state requires another step.

### Feedback and retained state

An ordinary cycle is invalid. Trails and Spiral Feedback are the POC's explicit,
internally stateful frame processors; neither exposes an edge that bypasses
cycle rejection. A future general Delay node still needs a broader public
read/commit, routing, initialization, and seek contract.

Both current effects use two transparent-initialized textures. Their read phase
samples only the output retained from the prior successful tick, and their
commit is deferred until every reachable frame node and Display complete. Only
then does the renderer swap buffer roles. A failed or cancelled tick therefore
cannot expose or retain a partially written state.

Spiral Feedback makes the detailed clock contract explicit:

- its first successful active evaluation outputs the current source exactly and
  commits that source, so transparent allocation does not create a visible
  pre-roll frame;
- on an advancing visual tick, it rotates and zooms the retained output around
  the resolved center, then blends in the current source;
- Feedback is bounded to `0…0.99` and specifies the retained fraction after one
  elapsed visual second; Rotation uses degrees per second and Zoom a multiplier
  per second, so none of the three assumes a fixed display rate;
- a zero-elapsed render displays the retained output without advancing its
  history index or timestamp;
- reset, backward visual time, resize, context restoration, and reactivation
  after being inactive all make the next successful render seed exactly from
  its then-current source;
- retaining the same active node ID and kind across ordinary parameter or edge
  edits preserves history, while full deactivation releases it. Removing only
  the source edge uses the standard opaque-black fallback as new input, so old
  content decays over black while visual time advances.

Every retained-state node must eventually declare its initial value, owning
clock, pause behavior, reset/seek behavior, and whether a disconnected or
inactive interval advances state. Current inspection identifies which reachable
nodes retain state; future execution metadata should expose the fuller contract
instead of leaving it as an accidental consequence of renderer lifetime.

### Time domains

Visual rendering and audio processing have different clocks.

- The MVP control graph produces scalar values once per scheduled visual tick.
- Transport Time is monotonic playback time. Beat Clock derives tempo-locked phase, a configurable-width beat pulse, and bar phase from transport or an optional time input.
- Pointer X/Y and Held are sampled state. Press and Release are one-tick pulses cleared immediately after the next render so a held button is not mistaken for repeated clicks.
- Camera and microphone analysis provide the most recent available snapshot.
- Model connections run on network/request time and publish only complete decoded frames.
- Future sample-accurate audio runs in an audio worklet and exchanges bounded control summaries with the visual runtime.

Future audio nodes exchange timestamped `audio.block` or spectrum buffers with
declared sample rate, channel layout, window size, and overflow policy. An
explicit resampler/analyzer converts those signals into visual-rate controls.
The visual scheduler must never directly drive sample-critical audio work, and
an amplitude control must never be presented as though it were monitorable
audio.

Node behavior uses monotonic elapsed time rather than assuming a fixed frame rate. Stateful simulations may use a fixed internal step with a capped catch-up count so a suspended tab cannot cause an unbounded burst of work.

## GPU frame path

### Shape generators

Shape and Vector Shape are permission-free frame generators. Each exposes
one `frame.rgba` output at index 0. Shape's optional scalar inputs follow
registry order and override stored literals without changing them. Geometry
uses the shorter output dimension for size and outline units, normalized
centers, and degrees for rotation. It costs one pass and one render target.
Vector Shape stores bounded SVG artwork as project text, uses no external
resources, and rasterizes only when artwork or output dimensions change.
Its frame pass adds one source texture to one render target. Both are
stateless: pause and reset preserve artwork, while context restoration rebuilds
GPU resources. The Shape Studio starter connects both to a Composite and Display.
New kinds are additive catalog changes; existing project contracts stay intact.

The MVP renderer uses WebGL2. Each frame processor renders a full-screen primitive into a texture attached to an offscreen framebuffer. Upstream textures become shader inputs; resolved parameters become uniforms. The final texture is drawn to the visible canvas.

The POC renderer owns:

- context creation, capability checks, and context-loss recovery;
- shader compilation and caching by node kind;
- texture and framebuffer allocation;
- live camera frame texture upload, fit/mirror presentation, and a safe fallback when no frame is available;
- latest-frame upload for compatible model-adapter responses, with the built-in procedural preview used until a generated frame is available;
- per-node textures and framebuffer lifetimes;
- a neutral fallback texture for missing or failed inputs;
- presentation and runtime diagnostics.

The current frame set includes procedural and solid producers; transform, warp,
blur, threshold, mask, blend, Porter-Duff composite, color-grade, strobe,
retained-trail, and spiral-feedback processors; a four-input frame switch;
camera/model producers; and Display.
Threshold intentionally produces a visible frame, while Mask is the explicit
step that applies a selected channel to source alpha.

Resolution is inherited from the primary frame input unless a node explicitly overrides it. The output owns the default project resolution. GPU readback is excluded from the normal frame path because it stalls the pipeline; previews and exports must use bounded, intentional paths.

A renderer interface isolates graph semantics from WebGL2 details. A future WebGPU implementation should consume the same execution plan and node contracts.

## Control path

The CPU control runtime evaluates small values rather than image-sized buffers.
POC control nodes include monotonic Transport Time, tempo-locked Beat Clock,
deterministic interval-based Auto Selector, periodic waves, reusable constants,
arithmetic, range mapping, rise/fall smoothing, an editable normalized XY
source, pointer position/held/press/release, and optional media level analysis.
Auto Selector derives a discrete index and normalized interval phase from a
position input. Forward, reverse, and seeded shuffle-bag orders are pure
functions of position, so reset, seek, frame pacing, and reload do not depend on
hidden random state.

The monitor owns one `requestAnimationFrame` scheduler. Display-sync mode renders
on every callback; fixed 60 fps and 30 fps modes select slots from an anchored
cadence and skip missed slots without moving the next deadline. Playback time is
updated from the browser animation clock even on skipped callbacks, so lowering
the render rate caps GPU work without slowing the composition. Diagnostics
report a rolling average of monitor renders and restart the sample
window after pauses or long browser stalls.

Control evaluation follows the same reachability and revision rules as the frame graph. A control chain runs only when it contributes to an exposed parameter or output. Non-finite values are contained at the node boundary and reported as diagnostics rather than allowed to poison the GPU pass.

## Text and Noise generators

Catalog 12 adds `text` and `noise` without changing schema 1 or the protocol
envelope. Both are output-demanded, permission-free generators with `frame.rgba`
at output index 0. Registry defaults, bounds, and select IDs are authoritative;
existing projects require no migration.

Text inputs are indexed 0 `text` (`text.utf8`), then scalar 1 `x`, 2 `y`,
3 `fontSize`, and 4 `alpha`. Disconnected inputs use saved parameters; connected
values override the resolved frame without modifying those literals. Multiline
Text and AI Chat editors keep local drafts until Apply commits one undoable
change. Blur never commits; undo/redo or another saved-value change refreshes
the editor. Drafts are not serialized or sent to live model adapters.

Text uses Canvas2D rasterization cached by resolved parameters and output size,
with one GPU pass and two targets. Strings are capped at 4,000 UTF-16 units and
128 laid-out lines. Word/character wrapping respects grapheme boundaries and
overflow is clipped to a normalized box. Y increases upward; font size is
relative to a 512-pixel shorter output dimension. Local WOFF2, WOFF, TTF, and
OTF fonts are bounded to 384 KB and embedded as validated data URLs. FontFace
handles are session-only, released with inactive nodes, and stale loads are
ignored. A built-in font renders during loading; decode failures report an
error with replacement guidance. Platform font rasterization can vary. Pause
preserves the image and reset reuploads pixels without temporal history.

Noise inputs are indexed 0 `time`, 1 `scale`, and 2 `alpha`, all optional
`control.f32`. Missing time uses transport seconds, multiplied by Speed. Value,
simplex, cellular, curl-field, and fractal modes share bounded scale, seed,
contrast, brightness, and alpha. Fractal selects fBm, turbulence, or ridged
accumulation with at most six octaves. Curl encodes XY in frame channels, not a
new signal family. The simplex kernel comes from `glsl-noise`. One GPU pass and
one target produce deterministic output for the same seed and resolved time;
pause freezes time and reset returns to the initial sample. Neither generator
permits ordinary graph cycles or owns network/device resources. Poster Maker
and Noise Lab provide complete output-reachable teaching paths.

## Constrained GLSL source

Catalog 14 adds `shaderSource`; schema 1 and the protocol envelope are unchanged.
Its output at index 0 is `frame.rgba`. Optional `control.f32` inputs are indexed
0 `time`, then 1-4 `value1` through `value4`. The host declares `uTime` (transport
seconds unless connected), `uResolution` (physical output pixels), and float
uniforms `uValue1` through `uValue4`. Connected values override saved parameters
without replacing them. `vUv` covers normalized coordinates with Y increasing
upward. The editable GLSL ES 3.00 fragment body assigns straight-alpha
`outColor`; the host supplies `main`, precision, declarations, non-finite output
containment, and final RGBA clamping to 0-1.

The ShaderFrog parser validates an allowlisted syntax tree before GPU compilation.
Source is limited to 4096 UTF-16 units, 512 AST nodes, 128 expression operations,
and 32 structural nesting levels. Local scalar/vector declarations, arithmetic,
swizzles, ternaries, and allowlisted GLSL math calls are supported. Loops, branch
statements, recursion, user functions, arrays, structs, matrices, textures,
preprocessor directives, extra uniforms, and `gl_` variables are unavailable.
Supported calls are scalar/vector constructors, radians/degrees, trigonometric,
exponential/logarithmic and square-root functions, abs/sign, rounding/fract/mod,
min/max/clamp/mix/step/smoothstep, and length/distance/dot/cross/normalize/reflect/
refract. See `src/graph/shaderSource.ts` for the exact allowlist.

One visual pass and one render target use the existing graph-wide resolution,
pixel, target, and pass budgets. These are static complexity limits, not a GPU
wall-clock guarantee or driver-isolation boundary. Only output-reachable shaders
are compiled. Each node caches its attempted source, last valid program, and
bounded diagnostic; rejected source is not retried every frame. A failed edit
keeps the prior program while reporting its error, or renders transparent when
no valid program exists. Replacement and node removal delete GPU programs;
context loss drops handles and restoration recompiles saved source. The fallback
program is session-only, so an invalid saved shader is transparent after reload.

The code editor uses local drafts and one undoable Apply action. Source and
uniform literals are project data; drafts and GPU programs are not serialized.
Pause holds transport time; reset returns it to zero. There is no temporal frame
history, permission request, or network activity. Shader Lab connects Constant
to `uValue2` and Shader Source to Display, with node and graph catalog stories.

## Text and model connector path

AI Chat stores bounded positive and negative prompt text in project state and exposes the positive prompt as `text.utf8`. The compiler validates that typed edge; the current connector resolves an AI Chat source directly, while general text evaluation, transforms, and rendering remain future work.

Video Model has two deliberately separate behaviors:

1. **Preview** is a built-in procedural GPU effect. It is available immediately, can incorporate an optional upstream frame visually, and performs no inference or network request.
2. **Local/API** uses HTTP or WebSocket to communicate with a compatible user-run adapter. The browser sends the prompt, portable settings, and—only for a directly connected, live camera over WebSocket—paced JPEG input frames. Other upstream frame nodes remain a local preview input in this release; general GPU-frame upload is deferred to avoid synchronous readback. The adapter returns bounded browser-decodable images; the newest valid image becomes the node's GPU source.

The browser does not host or launch the model and does not translate arbitrary vendor APIs. A provider-specific runtime normally needs a local adapter or trusted API gateway implementing `videobrain.frames.v1`. Endpoint URLs, prompt text, and model/workflow identifiers are project data. Credentials, sockets, requests, camera encoders, and decoded image handles remain session/runtime data. See [Model Connectors](MODEL_CONNECTORS.md) for the wire contract and trust boundary.

## System boundaries

| Boundary | Responsibility | Must not own |
| --- | --- | --- |
| Editor | Graph gestures, node views, inspector, commands | GPU resources or evaluation rules |
| Project store | Serializable graph and command history | Per-frame values |
| Node registry | Schemas and defaults | Project instances |
| Planner | Validation, reachability, and ordering | DOM rendering |
| Control runtime | CPU values, input snapshots, modulation | Authoring UI state |
| Frame renderer | GPU programs, textures, passes, presentation | Persistent project mutations |
| Input adapters | Permissioned browser and device APIs | Graph structure |
| Model connector | Compatible HTTP/WebSocket sessions, bounded images, transient credentials | Vendor-specific assumptions or saved secrets |
| Persistence | Load, validate, save, autosave | Live GPU objects |
| Diagnostics | Errors, evaluation counts, timing summaries | Unthrottled project writes |
| Protocol inspection | Catalog contracts, bindings, reachability, execution order | A second graph model or unvalidated mutations |

Dependency direction should remain one-way: the editor issues commands to the project store; the planner consumes project snapshots; runtimes consume plans; diagnostics flow back as read-only observations.

## POC safety envelope

The current implementation enforces these limits before replacing a valid plan:

- project JSON up to 1,000,000 UTF-8 bytes;
- up to 128 nodes and 512 edges;
- up to 16 reachable frame processors, 17 GPU passes, and 20 offscreen targets;
- output capped to 2,048 pixels per dimension, 2,073,600 pixels total (a 1080p-sized area), and 1.5× device pixel ratio;
- generated model images capped to 20 MiB before decode and to the same dimension/pixel limits afterward;
- outbound model-camera frames capped to a 768-pixel longest edge and 30 fps, with transmission paused above a 4 MiB socket backlog.

Parameter keys, types, numeric ranges, select options, and text lengths are validated against the registry. Missing registered parameters receive their defaults; unknown data is rejected transactionally.

Strobe's own Rate parameter is clamped to 0…3 Hz; its Amount provides an
immediate visual bypass at 0. A connected Phase input deliberately overrides
the internal oscillator, so the graph author remains responsible for keeping
that source at or below 3 cycles per second. This renderer limit cannot detect
or make safe flashes already present in an upstream frame.

## Security and resource safety

- Project loading never evaluates JavaScript strings.
- Automation uses validated graph commands, not arbitrary code execution.
- Camera and microphone access starts only after an explicit user action and has a visible active state.
- The built-in model preview is local visual processing, not inference, and opens no network connection.
- Local/API model modes accept only a compatible HTTP/WebSocket adapter contract; they do not make arbitrary third-party APIs directly compatible.
- Model credentials remain in memory, are scoped to the configured endpoint, and are never serialized or exported.
- Camera frames leave the tab only while the camera is live, directly connected to Video Model, and its compatible WebSocket is open.
- API adapters and every credential-bearing connection require HTTPS/WSS. Plain HTTP/WS is limited to credential-free Local loopback use, and the hosted HTTPS page rejects both plaintext transports.
- Remote media must be same-origin or explicitly permit cross-origin use. Arbitrary webpages are not frame sources.
- Project size, output resolution, node count, GPU pass count, and retained-frame memory receive hard limits.
- Flashing examples are identified before loading and document an Amount 0
  bypass, removal/rewiring path, and the separate risk of externally driven
  phase or flashing source media.
- User-authored shaders are deferred until they can be compiled in an isolated, cancellable workflow with clear diagnostics.
- Imported projects are schema-versioned and validated before replacing the current graph.

## Future extensions

The preserved boundaries support the following additions:

- WebGPU render and compute backends;
- worker-hosted rendering through an offscreen canvas;
- sample-accurate audio processing;
- geometry, point, record, and event graphs;
- reusable modules and a versioned node package system;
- recording and live-stream outputs;
- collaborative editing with revisioned commands;
- capability-negotiated model adapters, in-browser model runtimes, and richer conditioning types;
- an authenticated automation gateway that can inspect, patch, validate, and preview graphs;
- optional cloud execution for workloads that exceed local browser capabilities.

None of these extensions should require a different persistent graph model or couple the editor to a particular renderer.
