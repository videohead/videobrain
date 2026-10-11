# VideoBrain Planned Development

Two workstreams define the remaining scope for this version:

1. **Show orchestration:** apply, record, and replay patch, parameter, source,
  and output-layout commands on top of the implemented event/transition nodes.
2. **Particles and richer 3D creation:** instancing, simulation, imported assets,
  and environments on top of the implemented geometry/material/rendering foundation.

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

This document contains remaining work only. Implemented graph foundations and
their verification status are in [Current State](CURRENT_STATE.md), with exact
contracts in [Events](EVENTS.md) and [3D Scene Foundation](SCENE_3D.md).
A gateway requirement is a deployment constraint, not a completion mark.

## P0: Ordered show-command scheduler

Build a transactional scheduler for patch, parameter, source, and output-layout
commands, with one authoritative show clock, stable equal-time ordering,
bounded late-event processing, and explicit live override/resume policy.

The existing Cue Scheduler emits bounded graph values/events; it does not
mutate projects, reconstruct past show state, activate layouts, or record shows.
Reuse its ordering principles and the validated event/transition foundation,
but do not treat graph-value scheduling as completed show orchestration.

Acceptance: permission-free command fixtures proving atomic rejection, target
scope across patch replacement, seek reconstruction, duplicate handling,
equal-time ordering, pause/reset, and live override. Historical external commands
must not be retransmitted during scrubbing. This foundation supports the P1 show
workflows below.

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

1. Keep the implemented baseline verified; deploy deliberately and complete
  physical browser/GPU/controller usability testing separately.
2. Deliver the remaining P0 show-command scheduler using the existing graph
  event/transition and 3D foundations.
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