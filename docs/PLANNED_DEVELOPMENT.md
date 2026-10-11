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

Execution handoff for the three P0 tracks is in the
[P0 Agent Handoff](p0/README.md), with [shared contracts](p0/CONTRACTS.md) and
[assignable task cards](p0/TASKS.md). Baseline milestones are staged proposals;
they do not mark the full P0 scope complete or authorize agent dispatch/deployment.

WebGL2 remains the supported production renderer. Retain the tested native
WebGPU foundation as experimental groundwork, not a production hybrid runtime.
The full WebGPU-only replacement is deferred to P3 and is not a prerequisite
for show orchestration or all 3D development. Feature-specific WebGPU integration
stays with the feature that needs it, justified by required capabilities or
measured workloads. A feature explicitly requiring WebGPU must report unavailable
capabilities rather than silently switching to WebGL or CPU simulation.

## P0: 3D File import

Import 3D files that are easily compatible with WebGL2 and WebGPU rendering and then instance them in the 3d Scene where lights and cameras can be applied = GLB / glTF, USD / USDZ, OBJ, FBX, STL / 3MF, 3ds

## P0: Connect to external video and image generators via API

Unified multimodal APIs — such as Atlas Cloud’s full‑modal API or CometAPI’s multimodal workflow layer, ComfyUI API support, and DayDreamScope (https://github.com/daydreamlive/scope)
Send text, image, and video to these models and retrieve generated assets from their APIs

## P0: Enhanced Projector Mapping tools

Mesh Warping for precise alignment on irregular surfaces, Bezier Masking for cutting, trimming, and shaping content, FreeDraw (canvas for drawing on for mapping), 3D Calibration to match virtual 3D models with real‑world objects, Video Wall Setup for multiplanar support and breaking a generation up among multiple canvasses, soft edge blending between overlapping canvasses.
See https://github.com/RosaErick/projmap
https://github.com/vitalyu/ProjectorVideoMappingWeb
https://mapshroom.dev/

## P1: Enhanced video post-processing with videos with alpha-channel

Provide playback of videos including HAP codec, codecs that support alpha-channel directly in the browser using WebGPU
https://deepwiki.com/webgpu/webgpufundamentals/5.2-transparency-and-blending
https://sachinsharma.dev/blogs/webgpu-realtime-video-processing-shaders
https://github.com/unfoundbox/webgpu-video-processor

## P1: WebRTC enhanced support

Enhance WebRTC I/O in order to provide features for users to share generated content with other users
https://sachinsharma.dev/blogs/av1-video-codec-rtp-packetization-webrtc-svc-2026

## P1: Particles and richer 3D creation

Use the existing WebGL2 renderer where it meets the feature's requirements;
complete only the WebGPU integration required by a concrete workload. The
compute-driven Particle Field Lab remains P1, including its native end-to-end
compute, rendering, frame processing, and presentation path. It does not require
porting every existing operator first. WebGPU buffers/textures cannot be directly
shared with WebGL; define supported graph boundaries and measure any explicit
transfer costs rather than assuming per-node backend switching is free.

Keep serialized geometry, materials, emission, and simulation behavior independent
of native GPU handles. WebGPU features must ship with capability reporting,
bounded resources, initialization/device-loss handling, and deterministic recovery;
they must not silently fall back to WebGL or CPU simulation. Select budgets from
measured workloads and device limits, not a universal particle-count threshold.

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
**Local glTF Stage**. Provide permission-free fixtures, explicit unsupported-device
states, output-reachable nodes, deterministic reset, and measured costs. Fixtures
are not a CPU fallback for GPU simulation. Verify pause/seek policy, suspended-tab
recovery, capacity exhaustion, long-run resource stability, and context/device loss.

## P2: Follow-on development

These remain valuable but do not block the two version goals. Promote only the
smallest prerequisite a P0/P1 deliverable actually needs, not an entire family.

| Area | Remaining work |
| --- | --- |
| Media/framing | Screen Capture, dedicated Crop/Fit, Resize, Checker/Grid, Test Card, durable assets, Media Prepare/Relink, proxies, and portable media collection |
| Clip workflows | Playlist/Clip Deck, advanced timeline/BPM/external-position transport, cue markers, beat-repeat/catch-up, and preparation extensions |
| Editor reuse | Group/Comment, named parameters, macros, subgraphs/public interfaces, favorites/recent, panel builder, and mobile control pages |
| Further control | Spring, advanced clocks, tap tempo, quantize extensions, state machines, schedules, gamepad/devices, MIDI pickup/feedback/relative controls, and portable mappings |
| Frame effects | Multiscale/HDR bloom, sharpen, LUT, tone mapping, extended lens/film/dither, time slice, layer taps, motion blur, optical-flow warp, and multi-view layouts |
| Projection/distribution | Projection meshes, venue edge-blend extensions, LED pixel mapping, snapshot/media recording, encoding, WebRTC publishing/data channels, and broadcast gateways |
| Audio | Device/channel selection, public spectrum/waveform wires, sample-critical processing, gain/pan, mixer mute/solo/meters, EQ, dynamics, delay/reverb, synthesis, recording, and stronger tempo tracking |
| Data/networking | Table grouping/pivot/aggregation/lookup, GeoJSON, MQTT, WebTransport, redacted log history, and broader record/replay tools |
| Vision/tracking | Grayscale/normalization extensions, frame difference, background models, morphology, blobs, QR/barcode, landmarks, segmentation, tracking/zones, markers, optical flow, detection, depth, and point clouds |
| Runtime/product | Capability center, diagnostics, measured adaptive resolution, asset preflight, kiosk/player modes, offline recovery, and deployment hardening |
| AI image generation and editing | Text-to-image, image-to-image, mask-based inpainting, outpainting, and super-resolution/upscaling through compatible local or remote model adapters |
| Model adapters | Conformance, model discovery, capability negotiation, input/mask contracts, bounded uploads and outputs, warmup, progress/queue status, cancellation, stale-result rejection, and actionable unavailable states |

AI image operations require explicit submissions and must preserve original
inputs. Keep credentials session-local and disclose remote transfers. Asynchronous
model jobs must not block frame rendering or let stale completions overwrite a
newer request. Validate capability mismatches, cancellation, malformed/oversized
results, and source/mask handling with deterministic adapter fixtures. These P2
workflows do not imply model training or advanced temporal stabilization.

Table filter/select/sort/join, basic MIDI/Companion, and corner-pin projection
already exist in source. Their broader extensions are not duplicate operators.
Refer to Current State rather than copying implemented catalogs into this plan.

Basic WebGL2 bloom/glow, chromatic distortion, scanlines, liquid morphing,
32-body liquid metaballs, and instanced 2D particle transitions are implemented.
They do not complete general 3D instancing, GPU particle simulation, or fluid
dynamics. Infinity Mirror Lab uses the existing retained Spiral Feedback path.

## P2: Ordered show-command scheduler

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

## P3: Show playback and recording

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

## P3: WebGPU-only runtime migration

Full replacement of the production WebGL2 runtime is deferred, not completed.
Revisit it when measured performance or required capabilities justify the
migration and maintenance costs. Preserve the tested native foundation;
see [experimental WebGPU status](CURRENT_STATE.md#experimental-webgpu-foundation).
Feature-specific WebGPU work remains at its feature's priority, including P1
compute particles. The following requirements are replacement gates if the full
migration is undertaken, not current-version release prerequisites.

| Deliverable | Required scope |
| --- | --- |
| Startup and capability checks | Require a secure context, `navigator.gpu`, successful adapter/device acquisition, and the features/limits required by the patch; API presence alone is insufficient |
| Unsupported and failed states | Clear unsupported-system, initialization-failed, device-lost, and resource-limit messages; preserve project data and never silently switch to WebGL or CPU simulation |
| GPU resource ownership | One WebGPU device/resource model for connected simulation, 3D, frame effects, and presentation; no implicit WebGPU-to-WebGL texture bridge |
| Three.js integration | WebGPU backend only, explicit asynchronous initialization, supported node materials/TSL, and verification against the pinned library version; reject Three.js automatic WebGL backend selection |
| Frame-pipeline migration | Port generators, processors, compositors, retained-frame effects, media uploads, text/SVG textures, and projection while preserving alpha/color and clock/reset contracts |
| Custom shader compatibility | Define a versioned WGSL/TSL-compatible authoring contract and migration strategy for saved GLSL Shader Source nodes; never reinterpret GLSL as WGSL or silently discard it |
| Compute and particles | Preserve the P1 GPU-resident particle contracts: bounded work, explicit simulation clocks, deterministic initialization, and device-loss recovery; CPU remains responsible for graph/control scheduling |
| Node capability indicators | Registry-backed WebGPU render/compute labels, optional compact chip icons in node cards and library listings, and Inspector details separating implementation support, required features/limits, and current device readiness |
| Validation and observability | Report required and available limits, buffer/texture bytes, dispatch/draw costs, and initialization/device errors; test actual WebGPU execution, not a renderer-class name |

Capability reporting is required when a WebGPU feature becomes user-facing; it
does not wait for universal migration. Add a WebGPU label only for a validated
implementation. Distinguish rendering from compute and list additional features
and limits in the Inspector. Implementation support, unavailable capabilities,
inactive graph branches, and active execution must remain distinct states.

Use a familiar chip icon with an accessible name and hover/focus tooltip; never
rely on color alone. Derive the library, node, Inspector, Storybook, and protocol
listing from the same registry metadata without changing port compatibility or
saved IDs. If WebGPU becomes universal for visual nodes, prefer a global backend
indicator and reserve per-node icons for compute or additional requirements.
CPU control/data nodes are not GPU nodes merely because they drive a renderer.

Choose budgets from measured workloads and device limits. Unsupported features
or excessive workloads produce actionable errors rather than silently reducing
saved counts, changing physics, or selecting another backend. Recovery recreates
resources and resets state according to the documented contract, not a fallback.

Acceptance: complete native graph execution, a 3D-to-frame-effect-to-Display path,
the compute-driven Particle Field Lab, representative frame-effect parity tests,
bounded asset uploads, and initialization/device-loss tests. Verify no WebGL
context is requested on the WebGPU path. Document tested browser/OS/GPU
requirements and preserve recoverable project state when they are unmet.

WebGL2 remains supported until a deliberately approved full replacement passes
these gates. Do not remove it prematurely or claim that changing a Three.js
constructor alone ports the graph. If the WebGPU-only replacement ships, retire
the legacy runtime rather than keeping it as an automatic fallback.

## P3: Advanced and research backlog

- General mesh processing, rigid/soft-body physics, signed-distance fields,
  generative architecture, volumetrics, and Gaussian splats.
- Reaction diffusion, fluid simulation, cellular automata, advanced depth
  compositing, and neural effects with latency/provenance contracts.
- Advanced compute workloads beyond feature-specific GPU requirements, offline render
  queues, XR, wide-color/10-bit negotiation, and specialist native video gateways.
- Pitch/spatial audio, DAW/plugin hosting, timecode/shared-tempo bridges, and
  specialist devices beyond the P1 OSC/lighting scope.
- Worker-sandbox scripting, broader shader processors, third-party packages,
  read-only database adapters, general automation APIs, and collaboration.
- Model training, trainable gestures, advanced ML sources, and advanced temporal
  stabilization with declared download, latency, and privacy constraints.
  Adapter-backed image generation and editing are P2, not part of this deferral.
- Laser output only under a separate safety design and native interlocks;
  it is not part of ordinary lighting output.

## Delivery and completion gates

1. Keep the implemented baseline verified; deploy deliberately and complete
  physical browser/GPU/controller usability testing separately.
2. Deliver the P0 ordered show-command scheduler, preserving the existing
  graph/event contracts. Universal WebGPU migration is not a release gate;
  WebGL2 remains the production baseline.
3. Complete P1 show/output/gateway workflows and P1 particles/assets, including
  feature-specific WebGPU integration where required. Test native protocols with
  controlled fixtures before real venue networks. WebGPU-required features must
  report unsupported systems without silent backend or CPU fallback.
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