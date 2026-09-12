# Graph Protocol Strategy

Status: the read-only catalog and graph-inspection foundation is implemented.
Transport adapters, remote sessions, and graph mutation transactions are future
work.

## Why this exists

A graph tool becomes much easier to learn, automate, test, and extend when its
structure can be inspected as data. An integration should be able to discover
available node kinds, read their typed ports and parameter ranges, inspect a
specific patch, understand why a branch is inactive, and see the actual
execution order without scraping the editor or evaluating arbitrary code.

The protocol is therefore a view of the same registry and compiler that drive
the application. It is not a second graph model and it does not grant direct
access to browser internals.

## Research-informed design practice

The installed, manual-derived graph knowledge MCP is a high-value continuing
architecture reference, not a one-time source of node names. During planning,
consult it when it can clarify representative operator contracts, connection
patterns, graph templates, state behavior, or runtime APIs. Translate relevant
observations into product-neutral structural questions:

1. Which signal family enters and leaves the node?
2. Which ports are ordered, optional, or variadic, and what does a disconnected
   input mean?
3. Which parameters are saved literals and which inputs may override them?
4. What causes the node to execute, which clock owns it, and what work can be
   skipped?
5. Does it retain state, and exactly what do pause, reset, seek, reconnect, and
   project reload do to that state?
6. Which browser capability, permission, worker, GPU resource, or external
   adapter does it require?
7. Which small teaching graph proves that a new user can use it correctly?

These findings should be weighted heavily when they clarify a proposed
VideoBrain contract or priority, but they do not import another application's
project format, names, UI, or arbitrary command execution. Browser constraints,
the existing registry, real user patches, and product goals remain authoritative
inputs. When the research source shows several possible operators, prefer the
smallest composable primitives that unlock a complete source → transform/analyze
→ route → output path.

This research is architectural evidence, not a mandatory release gate. If the
MCP's live graph bridge is available, read-only inspection can strengthen a
design. If only the indexed knowledge layer is available, its catalog, manual,
and templates still provide useful structural context; lack of a live bridge
must not encourage an unsafe mutation shortcut.

## Implemented read-only foundation

`src/graph/protocol.ts` currently exposes two in-process functions:

- `getOperatorCatalog()` returns the complete operator registry, typed inputs
  and outputs with explicit indexes, parameter definitions, supported port
  types, optional parameter-layout hints, per-kind execution metadata, graph
  limits, and independent protocol, project-schema, and catalog versions.
- `inspectGraph(document)` compiles a project snapshot and returns validation
  issues, bound inputs with source and target port indexes, output roots,
  reachable and inactive nodes, the complete, control, and frame execution
  orders, per-node execution metadata, aggregate visual passes/render targets,
  and reachable stateful node IDs.

Both functions return detached data rather than mutable registry objects. They
are useful now for tests, developer tools, and future adapters. No HTTP,
WebSocket, command-line, or MCP server is exposed by the application yet.

## Governing graph invariants

The research above is encoded as mandatory design rules rather than informal
inspiration:

| Concern | Required VideoBrain decision |
| --- | --- |
| Signal families | Frames, controls, text, events, sampled channels, audio buffers, records, geometry, and resources are distinct typed families. A node declares its family and runtime domain before implementation begins. |
| Connections | Ports have stable serialized IDs and explicit catalog indexes. Multi-input meaning never depends on edge-array order or canvas position. Required, optional, and future variadic input cardinality is declared. |
| Parameters | Every saved parameter has a stable ID, units, validation, and deterministic default. A compatible connected signal overrides the literal at runtime; disconnecting restores the saved literal unchanged. |
| Conversion | Cross-family or unit conversion is a visible conversion node. The compiler must not insert hidden coercion merely to make an edge connect. |
| Execution | Output nodes are demand roots. Planning walks upstream and schedules only reachable dependencies; disconnected experiments remain editable but inactive. |
| State | Feedback, delay, smoothing, accumulation, counters, and similar behavior cross an explicit previous-tick boundary with documented initialization, read/commit order, pause, and reset semantics. Ordinary zero-delay cycles remain invalid. |
| Time | Visual, audio, media, transport, wall, network, and show clocks stay distinct. A node declares its clock and resampling behavior; sample-rate audio never masquerades as one visual-frame scalar. |
| Reuse | Nested components expose versioned public typed ports and parameters. External tools connect to that interface and do not reach through it to private internal nodes. |
| Compatibility | Project schema, operator catalog, and protocol versions advance independently. Serialized kind, port, parameter, and option IDs change only through an explicit project migration; protocol-visible presentation IDs use additive catalog changes or aliases. |
| Introspection | Catalog and inspection data are derived from the production registry and compiler. A transport adapter may expose that truth but may not maintain a competing graph model. |
| Mutation safety | Future mutations use bounded typed commands, expected revisions, request IDs, atomic validation, authorization, and idempotency. Arbitrary source-code or command-string evaluation is not a graph API. |

Any proposal that cannot state how it satisfies these rules is not ready for
implementation, regardless of how attractive the isolated effect appears.

## Identity and typing rules

Three identities must remain stable after a project is saved:

1. A node instance has a UUID-like `id`. Moving or renaming a node never changes
   it.
2. A node implementation has a serialized `kind`, such as `blur`. A cosmetic
   title is not its identity.
3. Every input and output has a serialized port ID. Labels may improve, but a
   port ID changes only through an explicit project migration.

An edge contains source node/port identity and target node/port identity. The
registry declares the type on each endpoint, and the compiler accepts the edge
only when those types are compatible. Parameters follow the same rule: their
serialized IDs and units are contracts; labels and layout are presentation.
Explicit catalog indexes preserve multi-input ordering without depending on
edge-array order or the node's current position on the canvas; IDs remain the
durable connection identity.

The current types are:

| Type | Runtime representation | Typical use |
| --- | --- | --- |
| `control.f32` | One bounded CPU number per visual tick | timing, sliders, analysis summaries, modulation |
| `text.utf8` | Bounded text | prompts and future labels or formatting |
| `frame.rgba` | GPU-backed two-dimensional color image | generation, compositing, effects, display |

Connections do not silently convert between types. A future conversion appears
as an explicit node so its cost, range, and behavior remain visible.

## Operator-library categories

Library categories make a growing catalog scannable, but they are deliberately
orthogonal to signal type and runtime domain. The ordered category IDs are:

| ID | Label | Current responsibility |
| --- | --- | --- |
| `timing` | Timing | Transport, beat, deterministic selection, and periodic sources |
| `control` | Control | Constants, arithmetic, range mapping, and smoothing |
| `interaction-ai` | Interaction & AI | Pointer/XY authoring and model-oriented prompt/frame interaction |
| `inputs` | Inputs | Permissioned camera and microphone-derived inputs |
| `generators` | Generators | Permission-free frame creation |
| `image-processing` | Image Processing | One-frame transforms, filters, grading, gating, and retained image effects |
| `compositing` | Compositing | Masks, layers, blends, and frame routing |
| `output` | Output | Display and future recording or transmission roots |

A category answers “where should I find this?”; a port type answers “what can I
connect?”, and a runtime domain answers “where and when does it execute?” Those
questions must not be collapsed. Category IDs and each operator's membership
are shared registry metadata and are already returned by the in-process catalog,
so the editor and future transport adapters read the same source of truth.
Reclassifying a node may be an additive catalog presentation change, but it must
never rewrite saved graphs. Additions require catalog-version review, and
existing IDs remain stable.

## Output-root execution

Display and future recording or streaming outputs are demand roots. Compilation
walks backward from those roots, validates bindings, rejects zero-delay cycles,
and topologically orders only the required dependencies. An unconnected node is
valid project content, but it is inactive runtime work.

`inspectGraph()` exposes this distinction directly through `reachable`,
`inactiveNodeIds`, `displayNodeIds`, and the execution-order arrays. That makes
the following questions answerable without rendering a frame today:

- Which nodes contribute to an output?
- What exact source supplies a parameter or frame input?
- In what order will control and frame nodes run?
- Which structural error prevented the new plan from replacing the last valid
  one?

Future capability-aware inspection should additionally distinguish a valid but
permission- or adapter-blocked node from an inactive or structurally invalid
one.

The next inspection revisions should add explicit clock dependencies, estimated
texture bytes and actual output resolution, last-cook reason, last duration,
dirty/static status, and capability readiness. Those fields are execution or
session metadata, not project data. Static visual-pass/render-target costs and
retained-state flags are already exposed from the operator contract; aggregate
plan totals are already exposed by `inspectGraph()`.

Current reachability is structural: every connected Frame Switch input is
scheduled even when one index is selected. Future conditional-demand planning
may skip an unselected branch only through an explicit router contract that
defines selector timing, state advancement, capability ownership, and the frame
used when selection changes. Canvas layout or an optimizer guess must never
silently decide whether a branch cooks.

Auto Selector does not change that rule. It is a pure control operator: a
Position divided by Interval selects an integer step and normalized Phase, then
forward, reverse, or seeded shuffle-bag ordering maps the step to a configured
index. Count does not inspect downstream sockets. This keeps reset, seek, reload,
and frame-rate changes deterministic while Frame Switch retains its existing
structural reachability.

Strobe demonstrates parameter/input precedence on a visual clock. With no Phase
wire, Rate drives an internal oscillator and is clamped to 0–3 Hz. A connected
Phase replaces that clock completely; its producer must be bounded separately.
Amount 0 is a visual bypass. Inspection should expose the binding but must not
claim that upstream frames are photosensitivity-safe.

## Project, catalog, and protocol compatibility

The three version numbers intentionally advance independently:

- `GRAPH_SCHEMA_VERSION` governs saved project JSON and migrations.
- `OPERATOR_CATALOG_VERSION` governs the discoverable node contract.
- `GRAPH_PROTOCOL_VERSION` governs inspection and command envelopes.

Compatibility rules:

- Add a new node kind, an optional input, or an optional response field without
  rewriting existing projects.
- Keep existing kind, port, and parameter IDs stable. Add a new ID and migrate
  at the document boundary when semantics genuinely change.
- Keep existing port indexes stable. Append an optional port rather than
  inserting it before existing ports; use a new kind/version when the semantic
  order itself must change.
- A new optional parameter must have a deterministic registry default so an old
  document behaves the same after normalization.
- Keep serialized select-option values stable even when their labels improve.
  Deprecate with an alias or migration instead of repurposing an old value.
- Never change a unit or range interpretation in place. Introduce a new
  parameter or node revision and preserve the old behavior during migration.
- Keep runtime handles, device permission, credentials, sockets, and generated
  frames out of project JSON.
- Reject an unsupported document transactionally. A failed import or mutation
  must leave the last valid project and execution plan intact.
- Preserve unknown newer nodes as bounded disabled placeholders once the
  migration layer supports them, so an older client cannot destroy information
  merely by opening and saving a project.
- Make migrations ordered, deterministic, idempotent at their target version,
  bounded, and covered by before/after fixtures. Never mutate the open project
  until the entire migration and validation chain succeeds.
- Treat optional response fields and new catalog entries as additive. A client
  ignores fields it does not understand; the host rejects a command whose
  required protocol or project semantics are newer than it supports.

A protocol client should send the versions it understands. The host should
reply with its versions, supported port types, operator kinds, graph/resource
limits, and runtime capabilities before either side attempts a mutation.

## Parameters and wires

A numeric parameter always has a saved literal. An optional `control.f32` input
may override that literal while connected. The current inspection response
exposes the source binding, while a future runtime-value response must expose
both the saved and resolved values without confusing ownership: the saved
literal belongs to the document, while the resolved value and its source belong
to runtime inspection. Disconnecting the wire restores the literal without
reconstructing it from runtime state.

This is also why a protocol transaction should use explicit operations such as
`setParameter` and `connect`, not a generic object patch that can blur project
and runtime ownership.

## Future channel and buffer signals

Audio spectra, automation curves, sensor landmarks, pixel histograms, and table
columns should not be disguised as one scalar or a color frame. Canonical
planned port IDs are additive and concrete:

- `control.bool` for sustained logic state;
- `event.trigger` for discrete occurrences with an optional timestamp and
  bounded payload;
- `control.vec2`, `control.vec3`, and `control.vec4` for short fixed-size values;
- `audio.block` for sample-rate audio buffers with channel and time metadata;
- `audio.spectrum` for bounded frequency bins with FFT/window metadata;
- `data.table` for typed named rows and columns;
- `data.json` for bounded structured messages;
- `frame.depth`, `geometry.points`, and `geometry.mesh` for later spatial data
  with explicit units and attribute schemas.

“Channel,” “buffer,” and “record” are useful conceptual family names, but they
are not reserved wire-type IDs. New concrete types use the namespace above (or
another deliberately versioned namespace) so a generic label cannot hide shape,
clock, or representation. A future multichannel automation type would therefore
receive its own explicit ID and descriptor rather than silently redefining
`control.f32`.

A channel or buffer descriptor should declare element type, shape, names,
sample rate or domain, units, capacity, and revision. Data transport can then
choose shared memory, transferable buffers, an audio worklet ring, or compact
JSON summaries without changing graph meaning.

The practical audio path is to keep Audio Level as an honest scalar analyzer,
then introduce a spectrum buffer producer plus explicit band-analysis/reduction
nodes. Low, mid, and high controls become visible conversions from the richer
signal instead of undocumented magic outputs.

Audio work must follow an explicit clock boundary: an audio worklet owns
sample-rate `audio.block` processing and bounded ring buffers; visual nodes read
timestamped summaries or explicitly resampled controls. Buffer descriptors must
make channel layout, sample rate, window length, timestamp basis, and overrun
policy inspectable. Pause, device loss, and reset must clear or retain buffered
state according to a documented node contract rather than incidental browser
behavior.

## Nested components and public boundaries

A reusable component is a versioned graph definition with declared public
inputs, outputs, parameters, capability needs, and reset behavior. External
edges terminate on those public port IDs. Internal node IDs remain stable for
the component's own migrations, but they are not an external connection API.

The planner may flatten a component for optimization only after validation; the
saved project and inspection response must preserve the component boundary and
be able to show both the public view and an authorized expanded view. Replacing
a component version is transactional. An incompatible public-port or parameter
change requires a migration or a new component version, never silent rewiring.

## Capability negotiation

Node availability and node readiness are separate. A catalog may advertise a
camera, MIDI, model, recording, or gateway node even when the current session
has not granted or connected the required capability.

A future capability response should distinguish:

- implemented by this build;
- supported by this browser and GPU;
- requires a secure context;
- requires explicit user permission;
- requires a connected local or hosted adapter;
- temporarily unavailable or denied;
- resource limit and preferred formats.

Capability state is session data. It must never be serialized as though a saved
project had granted permission on another computer.

## Query and transaction surface

The useful future read operations are deliberately small:

- get protocol/capability information;
- list or describe operators;
- inspect the whole graph or a node's upstream/downstream neighborhood;
- inspect diagnostics and execution metadata;
- read saved parameters and resolved runtime values;
- list outputs and capture a bounded preview.

Mutations should be atomic transactions made from typed commands:

- create, move, or delete a node;
- connect or disconnect exact ports;
- set one validated parameter;
- replace or import a bounded graph document;
- start/stop a named runtime capability only through an authorized user flow;
- compile and either commit the entire transaction or reject it with structured
  issues.

Every accepted transaction should carry a request ID and expected graph
revision. Repeating a request ID must be idempotent, and a stale expected
revision must fail cleanly rather than overwriting concurrent work. Undo/redo,
automation, collaboration, and UI gestures can then share the same command
boundary.

Arbitrary source-code evaluation is intentionally outside this interface. A
typed transaction is easier to validate, audit, rate-limit, reproduce, and keep
compatible.

## MCP and other adapters

MCP can be one adapter over this contract, alongside local developer tools,
tests, and a future authenticated network API. The adapter should translate
tool calls into catalog queries, graph inspection, and validated transactions;
it should not invent node definitions or bypass the compiler.

The in-process catalog and inspection layer comes first so every adapter reports
the same truth. A transport layer comes later, after authentication, origin
policy, transaction limits, user-presence requirements for devices, and preview
bandwidth limits are specified.

## Module-development gate

Every proposed node wave begins with a short structural design record, informed
by the research practice above when it is relevant and useful. It includes the
target library category, typed ports and explicit indexes, parameter/binding
precedence, runtime and clock, state/reset behavior, capability requirements,
resource budget, compatibility impact, and at least one named teaching graph.
Implementation begins when that product contract is coherent.

Each new node then ships as one small, inspectable contract:

1. stable kind, port, and parameter IDs with units and deterministic defaults;
2. compiler and runtime behavior with bounded resources;
3. documented clock, execution-trigger, retained-state, pause, and reset
   behavior where applicable; current machine-readable metadata identifies
   stateful nodes, while richer clock/reset fields remain a planned addition;
4. catalog and inspection coverage, including port indexes, bindings,
   reachability, and resource/state metadata as those fields become available;
5. a complete starter patch in which the node is reachable from an output;
6. an operator-card story and a full graph story;
7. concise Help guidance explaining what each signal controls, its fallback,
   and any capability or permission step;
8. serialization, migration, renderer/runtime, and browser tests appropriate to
   its risk.

A wave can use one preset to teach several related nodes only when every new
node is reachable from the output and the learning goal names each role. Every
wave must also add or update the automated all-node example coverage check. A
node is not “implemented” in planning tables until this gate is complete.

This gate keeps protocol discoverability, backward compatibility, and beginner
education aligned instead of treating them as cleanup after implementation.

## Priority ladder

Module priority follows graph leverage and missing structural roles, not the
length of an external operator catalog:

1. **Shipped foundation, live selection, and specialized effects:** control
   math/mapping/smoothing, 2D transform, solid, threshold, mask, composite,
   frame switch, blur, Auto Selector, Strobe, and Spiral Feedback, each
   exercised by an output-reachable starter. Spiral Feedback owns retained
   state internally; it does not replace the general Delay/Feedback boundary
   below.
2. **Local media and framing:** Image File, Video File, Screen Capture, Crop/Fit,
   Resize, and a Test Card. Teaching graphs: *Image Color Lab*, *Clip Framing*,
   and *Screen Layout & Test*.
3. **Explicit time and state:** a general frame Delay/Feedback boundary with
   initialization, commit, pause, reset, and inactive-branch inspection.
   Teaching graph: *Feedback Laboratory*.
4. **Decisions and events:** `control.bool`, `event.trigger`, Compare, Logic,
   Trigger, Gate, Hold, Frame Hold, Counter, Timer, and seeded Random. Teaching
   graphs: *Beat-cut Montage*, *Freeze & Release*, and *Cue Logic Basics*.
5. **Buffered audio:** `audio.block`, Audio Device In, Audio File, Spectrum,
   Band Energy, Envelope Follower, and Onset, separated from explicit Audio
   Monitor. Teaching graphs: *Spectrum Color Bands* and *Onset Switcher*.
6. **Reusable boundaries:** public Input/Output/Parameter nodes, nested
   components, instances, presets, and scene routing. Teaching graph:
   *Reusable Performance Rig*.
7. **Broader typed families:** tables/JSON, vision landmarks and depth, geometry,
   materials, and output/gateway nodes only after their types, clocks, and
   capability contracts are inspectable.

The read-only catalog/inspection protocol advances alongside every wave. An
authenticated transport and safe mutation API come after migrations,
capability negotiation, and atomic revision handling are proven locally; they
are an architecture track, not a shortcut around the node gate.
