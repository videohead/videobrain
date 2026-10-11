# VideoBrain Planned Development

Two workstreams define the remaining scope for this version:

1. **Transitions between events and sequencing:** perform, schedule, record,
   and replay changes to patches, parameters, sources, and output mappings.
2. **Geometry, particles, materials, and rendering:** a complete typed 3D
   creation path feeding the existing frame effects and projection tools.

Implemented capabilities belong in [Current State](CURRENT_STATE.md), not in
this backlog. This plan replaces the broad future catalog. Former wave numbers
are historical references, not prerequisites for every new feature.

## Priorities

| Priority | Meaning |
| --- | --- |
| P0 | Required foundations of both remaining version goals; implement first |
| P1 | Complete usable workflows on those foundations within this version |
| P2 | Follow-on product development; not a blocker for these version goals |
| P3 | Advanced, experimental, or specialist work requiring separate justification |

Backlog deliverables below are planned unless explicitly identified as source-implemented. A gateway requirement is a
deployment constraint, not a completion mark. Release-blocking defects and
verification of existing work remain mandatory at every priority.

## P0: Transitions, events, and sequencing

| Deliverable | Required scope |
| --- | --- |
| Typed decisions/events | `control.bool`, `event.trigger`, explicit bool/scalar conversion, Compare, Logic, and Trigger; distinguish edges from sustained state |
| Event routing/state | Gate, Hold/Latch, Sample & Hold, Counter, and seeded Random with initialization, reset, and same-tick ordering |
| Timer and Envelope | Duration, progress, completion event, repeat, pause, retrigger/cancel policy, and bounded curves |
| Timed Transition | Event-driven progression and easing into existing Crossfade or parameter targets; start/end events, interruption, reversal/retrigger, and deterministic reset |
| Step Sequencer | Ordered values/events, step duration, loop range, tempo/free-time clock choice, deterministic selection, and transport |
| Ordered command scheduler | One authoritative show clock, stable equal-time ordering, bounded late-event processing, and live-control override policy |

Crossfade already supplies frame interpolation. The missing work is timing and
event orchestration, not another blend shader. MIDI/Companion and Audio Trigger
can feed explicit event/command adapters without redefining their current types.

Acceptance examples: **Cue Logic Basics**, **Timed Transition**, and **Step
Sequence Lab**. Verify zero duration, duplicate triggers, equal-time ordering,
pause/resume, reset, tempo changes, interruption, suspended tabs, and replay.
All foundation examples must work without devices or network permissions.

## P0: Geometry, materials, and rendering foundation

Source implementation is now recorded in [Current State](CURRENT_STATE.md) and
[3D Scene Foundation](SCENE_3D.md), rather than retained here as unbuilt work.
It includes explicit vector/mesh/point/material/camera/light types, bounded
primitives and grids/lines, transforms, cameras, lighting, and a shared-context
Three.js Render 3D path. **3D Primitive Lab** and **Vector & Grid Lab** exercise
the foundation through existing frame outputs.

Release close-out still includes resolving the repository-wide verification
blockers and testing broader physical GPU/browser performance. Source and
automated GPU validation do not imply deployment. Public depth wires, general
scene hierarchies, particles, instancing, imported assets, and environment maps
are not part of this completed implementation scope; the P1 work below remains.

## P1: Show playback and recording

| Deliverable | Required scope |
| --- | --- |
| Cue List / Cue Stack | Named cues, GO/back/hold, guarded transitions, deterministic end events, and manual override |
| Curve / Keyframes | Bounded parameter automation, explicit interpolation, loops, and event-safe evaluation |
| Scene / Bank and Effect Scene | Parameter/processor snapshots, source routing, transitions, dry/wet/bypass, and no duplicated sources |
| Launch Grid / Auto Advance | Quantized launch, normal/toggle/momentary controls, slot overrides, and explicit next/previous/random/stop/end policies |
| Show JSON / Player | Versioned initial patch and timestamped patch, parameter, source, and output-layout commands |
| Show Recorder | Record applied UI/controller/gateway commands into the same JSON format, with bounded continuous-value sampling |
| Frame Hold / Delay / Feedback | Capture/release and previous-tick read/commit boundaries required by transitions; pause/seek/reset and inactive-branch behavior |
| Named output layouts | Named screens/projectors, stable routes, layout presets, and timestamped activation beyond the existing single Display |
| OSC, Art-Net, and sACN gateway | Bidirectional controls and explicitly armed venue output, integrated with logical show routes and recording |

### Show format and clock contract

Imported and recorded shows share one versioned format: initial validated patch,
asset references, versioned output-layout resources, and bounded ordered events.
Events carry integer show-relative timestamps, stable IDs, and an explicit
equal-time sequence. Commands load patch snapshots, set parameters, select
sources, or activate mappings. No arbitrary code/property paths, live handles,
or credentials belong in the show file.

Validate the full timeline and target scopes before replacing a project. Patch
changes define new node-ID scopes and session lifecycle. Provide play, pause,
stop, seek, and reset; reconstruct state from snapshots/events when seeking.
Do not retransmit historical OSC triggers or lighting commands while scrubbing.
Declare interpolation, late-event behavior, and live override/resume policy.
Browser timestamps do not guarantee physical frame lock or sample accuracy.

Record successfully applied semantic commands, including momentary releases,
not every frame or raw device packet. Bound/coalesce continuous edits and
exclude playback-origin commands to prevent recursive recording. General
timestamped data Record/Replay can share this infrastructure, not invent a
second show format.

### Output mapping and gateway contract

Support all three requested mapping layers: Projector Mapping corners/transforms
and frame routing; named screens/projector layouts; and lighting universe/channel
assignments. Save logical route IDs; keep network interfaces, physical
destinations, and credentials in gateway/session configuration. OSC routes
declare allowlisted addresses and typed arguments.

Browsers cannot open UDP sockets for OSC, Art-Net, or sACN. A native/local gateway
handles receive and send with authentication, origin/capability checks, bounded
queues/rates, and unicast/multicast policy. Preserve protocol-specific universe
numbering, channel limits, sequence handling, sACN priority/source identity,
stream termination, and merge/source selection. Prevent OSC echo loops.

Incoming channels may drive mapped controls. Output requires explicit arming,
master dimmer, blackout, and gateway-enforced disconnect/watchdog policy.
Loading, recording, seeking, or replaying a show never grants permission or arms
venue output. Safety-critical interlocks remain outside the browser.

Acceptance examples: **JSON Show Lab**, **Cue Transition Rig**, **Output Layout
Lab**, and simulated bidirectional OSC/Art-Net/sACN fixtures. Verify seek
equivalence, recorder order, override, malformed imports, packet loss, arming,
blackout, and disconnect. Real venue tests precede live-use claims.

## P1: Particles and richer 3D creation

| Deliverable | Required scope |
| --- | --- |
| Merge | Combine compatible geometry with explicit attribute/topology rules |
| Scatter / Instance | Seeded bounded point distributions and instanced objects with per-instance attributes |
| Particle Source | Geometry/event/audio-driven emission, deterministic seeds, and capacity policy |
| Particle Update | Position/velocity, force, drag, curl, lifetime, defined collision scope, and kill; explicit simulation clock/reset |
| Image to Points | Budgeted image sampling into position/color attributes with disclosed readback costs |
| glTF Asset | Validated local scene/animation assets, bounded dependencies, missing-asset behavior, and cleanup |
| Environment Map | Bounded environment lighting/reflections, asset validation, and fallback |
| Text geometry / extended lights | Text meshes and additional lighting built on the core geometry/material path |

Depth-driven particles wait for real calibrated depth/vision contracts, but
must not block permission-free emission. General rigid/soft-body physics,
arbitrary mesh processing, and volumetrics remain P3.

Acceptance examples: **Particle Field Lab**, **Audio Instance Lab**, and
**Local glTF Stage**. Provide no-device/fixture paths, output-reachable nodes,
deterministic reset, and measured costs. Verify pause/seek policy, suspended-tab
recovery, capacity exhaustion, long-run resource stability, and context loss.

## P2: Follow-on development

These remain valuable but do not block the two version goals. Promote only the
smallest prerequisite a P0/P1 deliverable actually needs, not an entire family.

| Area | Remaining work |
| --- | --- |
| Media/framing | Screen Capture, dedicated Crop/Fit, Resize, Checker/Grid, Test Card, durable assets, Media Prepare/Relink, proxies, and portable media collection |
| Clip workflows | Playlist/Clip Deck, advanced timeline/BPM/external-position transport, cue markers, beat-repeat/catch-up, and preparation extensions |
| Editor reuse | Group/Comment, named parameters, macros, subgraphs/public interfaces, favorites/recent, panel builder, and mobile control pages |
| Further control | Spring, advanced clocks, tap tempo, quantize extensions, state machines, schedules, gamepad/devices, MIDI pickup/feedback/relative controls, and portable mappings |
| Frame effects | Bloom, sharpen, LUT, tone mapping, lens/film/dither, time slice, layer taps, motion blur, optical-flow warp, and multi-view layouts |
| Projection/distribution | Projection meshes, venue edge-blend extensions, LED pixel mapping, snapshot/media recording, encoding, WebRTC publishing/data channels, and broadcast gateways |
| Audio | Device/channel selection, public spectrum/waveform wires, sample-critical processing, gain/pan, mixer mute/solo/meters, EQ, dynamics, delay/reverb, synthesis, recording, and stronger tempo tracking |
| Data/networking | Table grouping/pivot/aggregation/lookup, GeoJSON, MQTT, WebTransport, redacted log history, and broader record/replay tools |
| Vision/tracking | Grayscale/normalization extensions, frame difference, background models, morphology, blobs, QR/barcode, landmarks, segmentation, tracking/zones, markers, optical flow, detection, depth, and point clouds |
| Runtime/product | Capability center, diagnostics, measured adaptive resolution, asset preflight, kiosk/player modes, offline recovery, and deployment hardening |
| Model adapters | Conformance, cancellation, capability negotiation, source-upload semantics, warmup/queue observability, and unavailable states |

Table filter/select/sort/join, basic MIDI/Companion, and corner-pin projection
already exist in source. Their broader extensions are not duplicate operators.
Refer to Current State rather than copying implemented catalogs into this plan.

## P3: Advanced and research backlog

- General mesh processing, rigid/soft-body physics, signed-distance fields,
  generative architecture, volumetrics, and Gaussian splats.
- Reaction diffusion, fluid simulation, cellular automata, advanced depth
  compositing, and neural effects with latency/provenance contracts.
- WebGPU compute justified by profiling, offline render queues, XR, wide-color/
  10-bit negotiation, and specialist native video gateways.
- Pitch/spatial audio, DAW/plugin hosting, timecode/shared-tempo bridges, and
  specialist devices beyond the P1 OSC/lighting scope.
- Worker-sandbox scripting, broader shader processors, third-party packages,
  read-only database adapters, general automation APIs, and collaboration.
- Trainable gestures, advanced ML sources, remote generation, and temporal
  stabilization with declared download, latency, and privacy constraints.
- Laser output only under a separate safety design and native interlocks;
  it is not part of ordinary lighting output.

## Delivery and completion gates

1. Close out existing data/controller work: documentation, catalog builds,
   tests, known verification blockers, and explicit deployment status.
2. Deliver both P0 foundations as independently testable groups, without waiting
   for the entire former module-wave sequence.
3. Complete P1 show/output/gateway workflows and P1 particles/assets. Test native
   protocols with controlled fixtures before real venue networks.
4. Release this version when both tracks meet their acceptance criteria;
   P2/P3 work is not an implicit release gate.

Each node group needs stable kind/port/parameter IDs, indexed ports, defaults,
units/bounds, disconnected-input and binding rules, clock/state/reset behavior,
migration decisions, capabilities, resource accounting, and cleanup. Advance
registry/compiler-derived inspection with each group.

Ship output-reachable teaching presets, operator and complete-graph stories,
Help, serialization/compiler/runtime tests, browser smoke/pixel checks, and
all-node example coverage. Run required repository verification and disclose
known failures. A parser, library dependency, or prototype alone is not an
implemented feature.

Preserve local-first behavior, permission-free teaching paths, explicit types,
bounded resources, and safe session lifecycle. Consult manual-derived graph
research when useful; it is evidence, not a second graph model or external
release prerequisite.

Engineering rules remain in [Architecture](ARCHITECTURE.md),
[Graph Protocol Strategy](GRAPH_PROTOCOL_STRATEGY.md), and
[Design System](DESIGN_SYSTEM.md). Existing usage belongs in
[Current State](CURRENT_STATE.md), [Controllers](CONTROLLERS.md), and the
[README](../README.md).