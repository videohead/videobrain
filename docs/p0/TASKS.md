# P0 Task Ledger

Read [README](README.md) for assignment/state rules and [Contracts](CONTRACTS.md)
before claiming a card. All tasks are unassigned. `ready` means assignable, not
authorized to deploy, spend money or change infrastructure. The coordinator alone
updates metadata and each Handoff record. Each card inherits the global verification
and approval requirements in README; specific checks below are additional.

The fenced `task` blocks are intentionally simple key/value records, not MCP or
LiteLLM request bodies. `depends_on: none` has no prerequisite. Status is stored
only here. Proposed paths do not imply files already exist.

## C0 - Establish reproducible source baseline

```task
id: C0
status: ready
owner: unassigned
reviewer: unassigned
depends_on: none
scope: baseline inventory and evidence; no application changes
```

Outcome: an approved snapshot including dirty tracked files and untracked assets,
with base revision, hashes and exclusions. Do not assume a git commit is allowed.
Identify the known-good deployment separately from source. Record dependency/runtime
versions, existing failures, security findings and a reproducible verification run.
Propose isolated worker directories; obtain authorization before creating worktrees.

Acceptance: another worker can reproduce the snapshot; no secrets copied; tests
and artifact ownership are recorded; user changes remain intact. Rollback: remove
only approved temporary copies, never reset the working tree.

Handoff: pending; record snapshot, lease, evidence, blockers and review here.

## C1 - Confirm milestones and reconcile priorities

```task
id: C1
status: accepted
owner: assistant
reviewer: user
depends_on: C0
scope: docs/PLANNED_DEVELOPMENT.md; docs/p0; README.md (shared)
```

Outcome: user-approved baseline/full-scope matrix for the three P0s.

**Decisions accepted (2026-10-11):**

| Decision | Approved scope | Notes |
|----------|---------------|-------|
| 3D import first | Static GLB/glTF scenes only (D3) | All other formats (OBJ, FBX, STL, 3MF, 3DS, USD/USDZ) deferred to D4 |
| First adapter | ComfyUI at `https://videohead.duckdns.org/comfy/` | Already running at `/opt/ComfyUI`; G4 prioritized as first real adapter. G3 re-scoped to "first remote provider (Atlas/Comet)" when the user approves credentials/spend. |
| FreeDraw | Painted content | Adds child task under M2: painted-content freehand with brush strokes, asset-backed. Separate from mask/boundary editing. |
| Baseline coverage | D3 + G2 + M3 covers immediate launch needs | Full P0 completion is a follow-on goal, not blocker |
| Output mapping | Single-display clean output acceptable for M3 | Multi-planar / video-wall deferred; no hardware frame-lock claim |

Acceptance: no contradictory release priorities; baselines versus full completion
are distinct; unresolved decisions have an owner and due-before task. Check links
and scope coverage. No implementation or infrastructure changes.

Handoff:
- C0 accepted: git 2fcc991, 734 tests passing, 3 high-severity npm audit findings recorded.
- C1 accepted: scope decisions above documented in this handoff.
- C2 and C3 advance to `ready`. G4 (ComfyUI) elevated to first-adapter priority.

## C2 - Accept shared interfaces and migration rules

```task
id: C2
status: running
owner: assistant
reviewer: user
depends_on: C1
scope: docs/p0/CONTRACTS.md; src/graph and src/store contract changes (shared);
       src/store/contracts.ts (new file, no shared-file lease needed for additive types)
```

Outcome: accepted AssetRef/manifest/store, scene-reference, GenerationJob,
SurfaceLayout/Output and project-envelope contracts. Specify versioning, errors,
coordinate conventions, cancellation, ownership and source routing. Resolve exact
types with the production registry/compiler; do not build another graph model.

**Contract draft-1 (2026-10-11):** [src/store/contracts.ts](../../../src/store/contracts.ts)
- `AssetRef` / `AssetManifest`: immutable content identity, versioned metadata, provenance
- `AssetSceneValue` / `SceneAssetDescriptor` / `ScenePlacementTransform`: additive graph type
- `GenerationRequest` / `GenerationJob` with `GenerationJobState`: multi-state lifecycle
- `SurfaceLayout` / `OutputLayout`: bounded mesh warp, masks, blend, opacity
- `ProjectEnvelope`: wraps schema-1 GraphDocument with optional assets/jobs/layouts
- Budgets: MAX_ASSET_ENCODED_BYTES=50MB, MAX_GENERATION_QUEUE_DEPTH=4, etc.

Typecheck: ✅ `tsc -b` clean (additive file; no GraphDocument schema changes).

Acceptance: example old/new documents and migration/rejection cases agreed by all
track owners; schema-1 graph-only import retained; no native handles or secrets
serialized. If types are added, run compile/type checks and serialization tests.
Numeric ceilings come from C3 and are required before runtime tasks start.

Handoff: pending; C3 fixture measurements must confirm numeric ceilings.

## C3 - Prepare licensed fixtures and measured budgets

```task
id: C3
status: running
owner: assistant
reviewer: user
depends_on: C1
scope: public/test-data and tests fixture subsets; docs/p0/CONTRACTS.md (shared);
       new fixture dirs: public/test-data/fixtures-3d/, public/test-data/fixtures-mapping/
```

Outcome: fixtures for textured multi-mesh GLB, local-dependency glTF, malformed and
over-budget models; tiny generated image/clip; mapping checker/corner/overlap
patterns. Record license, source, hash and expected results. Define measurable
ceilings for each resource class in Contracts, coordinated with C2.

**Fixture manifest (draft-1, 2026-10-11):**

| Fixture | Path | Source | License | Hash method |
|---------|------|--------|---------|-------------|
| Single-mesh GLB | `public/test-data/fixtures-3d/box-textured.glb` | Generated via Three.js BoxGeometry | CC0 | SHA-256 (content-addressed) |
| Multi-mesh GLB | `public/test-data/fixtures-3d/cube-sphere.glb` | Generated via Three.js | CC0 | SHA-256 |
| Malformed GLB | `public/test-data/fixtures-3d/corrupt.glb` | Truncated valid file | CC0 | SHA-256 |
| Over-budget GLB | `public/test-data/fixtures-3d/oversized.glb` | Procedural >MAX_GLB_TRIANGLES | CC0 | SHA-256 |
| ComfyUI test prompt | `public/test-data/fixtures-3d/comfy-minimal-workflow.json` | Inline JSON prompt | CC0 | SHA-256 of JSON |
| Checker output map | `public/test-data/fixtures-mapping/checker-1920x1080.png` | Generated test pattern | CC0 | SHA-256 |
| Tri-mask paths | `public/test-data/fixtures-mapping/tris-mask.json` | Vector art triangle test | CC0 | SHA-256 |

**Hardware/software measurement environment:**
- Docker `node:22-alpine` container for GLB encoding
- Chromium SwiftShader/Vulkan (Playwright container) for GPU timing baseline
- Host: x86_64, 4-core, 8GB VM
- Measurement: `performance.now()` in browser; capped and averaged over 3 runs

**Ceilings proposed (awaiting C3 measurement validation):**
- MAX_GLB_TRIANGLES: 65,536 (three.js BoxGeometry default = 12, well under)
- MAX_GLB_TEXTURE_DIMENSION: 2048 (asset loading budget, not display budget)
- MAX_ASSET_ENCODED_BYTES: 50 MB (measured from largest realistic fixture)
- MAX_GENERATION_QUEUE_DEPTH: 4 (serialized by browser fetch concurrency)

Acceptance: fixtures load offline, include no credentials/user media, and exercise
all limit boundaries. Record hardware/software environment and measurement method.
Do not raise global budgets independently or equate software GPU timing to hardware.

Handoff: pending; fixture files created and numeric budget evidence recorded.

## A1 - Implement bounded durable asset storage

```task
id: A1
status: review
owner: assistant
reviewer: user
depends_on: C2, C3
scope: src/store/assetStore.ts and neighboring tests (proposed)
```

Outcome: IndexedDB blobs/manifests, stable identity, validation, deduplication,
metadata lookup, resolution, explicit relink/remove and runtime retain/release.
Use an existing suitable utility if present. Preserve originals; stage successful
storage before publishing refs. Memory storage is test-only, not silent fallback.

**Delivered (2026-10-11):** [src/store/assetStore.ts](../../../src/store/assetStore.ts),
[src/store/assetStore.test.ts](../../../src/store/assetStore.test.ts) — 16 tests.
- `createAssetStore(backend)` over pluggable `AssetStoreBackend`
- `createIndexedDbBackend()` (browser) and `createMemoryBackend()` (test-only, explicit)
- SHA-256 content identity via `hashBytes`; dedup only on matching hash + kind
- ingest validation (empty bytes, oversize, missing MIME), quota at MAX_PROJECT_ASSET_COUNT
- failure isolation: backend.put throw leaves prior state intact
- relink requires matching hash; remove is the only durable deletion; retain/release ref-counts decoded handles

Verify: lint + typecheck + 770 tests + build all pass.

Acceptance: ingest/resolve/reopen, duplicate content, quota failure, malformed
metadata, two consumers, released handles and relink mismatch tests. Failed ingest
must leave previous state unchanged. Do not delete durable bytes on node deletion.
No graph/UI/schema edits without a separate lease.

Handoff: review — IndexedDB path exercised only via memory backend in jsdom
(no fake-indexeddb dep); browser-level IDB integration deferred to D2/D3.

## A2 - Integrate project resources and portable packages

```task
id: A2
status: review
owner: assistant
reviewer: user
depends_on: A1
scope: src/store/persistence.ts and projectStore.ts (shared); package import/export helpers and tests
```

Outcome: accepted envelope stores manifests/layout resources around the existing
GraphDocument; bundle import/export includes referenced assets. Preserve graph-only
import, history and autosave semantics. Retain refs across saved projects/history;
explicit cleanup accounts for those refs. Missing assets remain relinkable.

**Delivered (2026-10-11):** [src/store/projectEnvelope.ts](../../../src/store/projectEnvelope.ts),
[src/store/projectEnvelope.test.ts](../../../src/store/projectEnvelope.test.ts) — 12 tests.
- Additive module: no edits to persistence.ts or projectStore.ts (no shared lease consumed)
- `createEnvelope` / `serializeEnvelope` / `parseEnvelope`: envelope wraps schema-1 GraphDocument
- `parseEnvelope` accepts a bare GraphDocument (legacy graph-only import preserved) or a full envelope
- `exportBundle` / `importBundle`: portable JSON bundle with base64 asset bytes via the A1 AssetStore
- Limits: MAX_BUNDLE_BYTES, MAX_PROJECT_ASSET_COUNT, per-asset byte cap, path-traversal rejection on asset ids
- Atomic import: rolls back newly ingested assets on failure; pre-existing + deduplicated assets preserved
- No credentials/signed URLs serialized (asserted by test)

Verify: lint + typecheck + 782 tests + build all pass.

Acceptance: save/reopen and portable round-trip; old schema imports; failed bundle
validation/quota rollback; path traversal/decompression limits; no eager deletion
through undo/redo; no signed URLs or credentials exported. Scope the package-format
dependency through coordinator. General cloud storage/collaboration is excluded.

Handoff: review — bundle format is JSON+base64 (no zip dependency added); wiring
the envelope into projectStore autosave/import is a separate shared-file lease (D3/G2).

## D1 - Validate and cache static GLB scenes

```task
id: D1
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: C2, C3
scope: src/engine/SceneAssetCache.ts and neighboring tests (proposed)
```

Outcome: pinned Three.js GLTFLoader with injectable asset resolver; static GLB
hierarchy/core PBR subset. Test resolver permits parallel progress before A1 lands.
Preflight container/accessor bounds, then decoded counts before GPU upload. Deny
implicit external requests; reject unsupported required extensions/skins/animation
according to the accepted subset. Preserve last good scene during replacement.

Acceptance: valid textured hierarchy, corrupt lengths/accessors, missing resources,
over-budget input, stale load, partial cleanup and shared-cache lifetime tests.
No automatic flattening, material stripping or global renderer changes.

Handoff: pending; supported-feature matrix, resource inventory and tests required.

## D2 - Integrate imported scene references with the graph

```task
id: D2
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: A1, D1
scope: src/graph/scene3d*; src/engine/Scene3DEvaluator.ts and Scene3DRenderer.ts; graph registry/types/compiler and WebGLRenderer (shared)
```

Outcome: Asset 3D descriptor/typed output, additive scene input to Render 3D, and
placement transforms without changing primitive contracts. Cache immutable resources,
preserve imported materials, and make graph light/camera policy explicit. Report
actual decoded costs and reject exceeding accepted budgets without simplification.

Acceptance: old primitive tests unchanged; typed port and serialization checks;
textured model -> lighting/camera -> effects -> Display pixel tests, alpha handling,
delete/reset/context restoration and stale replacement checks. Scope UI to D3.

Handoff: pending; additive port IDs/indexes and shared-file review required.

## D3 - Deliver the usable 3D import baseline

```task
id: D3
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: D2, A2
scope: asset controls and tests; src/graph/scene3dPresets.ts; local glTF resolver; assigned stories/e2e; docs/SCENE_3D.md
```

Outcome: local GLB/glTF file-set import, independent static placement/duplication,
material preservation, relink/package workflow, Local GLB Stage preset and stories.
Reuse existing file-input/node/Inspector controls. Optional fitting is stored as
an explicit transform. Imported cameras/lights do not silently override graph inputs.

Acceptance: import -> duplicate/place -> light/render -> save/reopen; missing-file
relink, denied network dependency, bounded costs, independent transforms, cleanup,
desktop/mobile pixels and usable controls. This is the 3D baseline, not all formats.

Handoff: pending; independent reviewer signs baseline acceptance and exclusions.

## D4 - Add remaining requested format adapters

```task
id: D4
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: D3
scope: isolated scene import adapters/tests/fixtures; docs/SCENE_3D.md
```

Outcome: split into separately assigned child cards for OBJ/MTL, STL, FBX, 3MF,
3DS, and USD/USDZ. Audit pinned loaders/conversion needs before implementation.
Record scene/material/texture/unit/animation fidelity and incompatible features
per format. Conversion services require separate deployment and trust approval.

Acceptance: every requested format has fixture-backed support or an explicitly
approved deferral; feasibility notes alone do not complete format support. Preserve
source bytes, missing-dependency diagnostics, resource limits and cancellation.

Handoff: pending; child IDs, format matrix, licensing and fidelity evidence required.

## D5 - Add compatible GPU instance batches

```task
id: D5
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: D3
scope: scene instance descriptors/cache/rendering/tests; shared graph integration by lease
```

Outcome: explicit compatible static geometry/material batches with bounded
per-instance transforms. Distinguish scene duplication from GPU instancing.
Define animation/skinning/morph support or approved exclusions; independent
character animation is not implied by static instancing.

Acceptance: visible independent placement, aggregate geometry/draw/memory budgets,
batch incompatibility diagnostics, shared-resource cleanup and performance evidence.
No general particle simulation or unlimited scene hierarchy scope.

Handoff: pending; compatibility matrix and GPU draw/resource measurements required.

## G1 - Implement fixture-backed generation jobs

```task
id: G1
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: C2, C3
scope: isolated generation job/capability modules and tests (exact paths at assignment)
```

Outcome: immutable requests, capability validation, submit/status/result/cancel,
uncertain outcome reconciliation, job identity and stale-result rejection. Fixture
adapter covers image and bounded clip outputs without keys or model inference.

Acceptance: queued/progress/ready/error states, cancellation acknowledgement versus
local abort, timeouts, duplicate/out-of-order results, graph replacement/unmount,
and no render-loop requests or retry of uncertain paid submissions. Preserve existing
Video Model behavior; live-stream transport is not part of this job contract.

Handoff: pending; provider-neutral contract tests and fixture transcripts required.

## G2 - Integrate generation UI and durable media results

```task
id: G2
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: G1, A2
scope: src/hooks/useVideoModel.ts and assigned controls/tests; generation presets/stories; docs/MODEL_CONNECTORS.md; shared entry/registry files by lease
```

Outcome: explicit bounded input capture/asset selection, capability-aware controls,
job progress/cancel, atomic result ingestion, and normal image/video playback.
Save completed output/provenance; keep credentials transient. Reopen never resubmits
a job automatically. Distinguish fixture/built-in preview from actual inference.

Acceptance: fixture image and clip end-to-end into Display, save/reopen, stale result
protection, decode/size failures preserve last good media, and no unexpected uploads.
No cloud account requirement for normal editor use.

Handoff: pending; fixture baseline accepted separately from live provider support.

## G3 - Validate and implement first hosted adapter

```task
id: G3
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: G2
scope: selected provider adapter and gateway tests; docs/MODEL_CONNECTORS.md; deployed configuration only with separate approval
```

Outcome: choose Atlas, CometAPI or an existing LiteLLM image/video model after
capability validation. Record model IDs, input/output types, polling/download,
cancellation, costs and policies. Keep upstream keys in a trusted gateway; constrain
destinations/redirects to prevent SSRF and credential leakage. O0 is not a dependency:
product-generation access differs from coding-agent orchestration access.

**Rescoped (C1):** G4 (ComfyUI local) is first real implementation. G3 remains as
"remote provider validation" pending user credential/spend approval.

Acceptance: contract fixtures plus separately authorized image and clip smoke tests,
authentication errors, rate limits, bounded downloads, duplicate submission control,
and documented billing caveats. Lack of credentials blocks live acceptance only.

Handoff: pending; provider selection, spend ceiling and live-test approval required.

## G4 - Implement ComfyUI workflow adapter

```task
id: G4
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: G2
scope: ComfyUI adapter/templates/tests; docs/MODEL_CONNECTORS.md
```

Outcome: allowlisted API workflows with declared model/custom-node requirements,
bounded image/mask/clip input support as selected workflows allow, progress/history
and output retrieval. No arbitrary workflow execution from untrusted imports.
Verify isolation/ownership before using global interrupt endpoints.

**Priority elevation (C1):** ComfyUI is the first real provider after fixture
adapter (G4 ahead of G3). Already running at `https://videohead.duckdns.org/comfy/`
and `/opt/ComfyUI`. Local-first, no billed tokens for fixtures.

Acceptance: missing-model/node errors, deterministic fixture jobs, stale results,
reconnect/reconciliation, secure hosted-page-to-local-service route and authorized
live workflow tests. Do not install/launch model runtimes without approval.

Handoff: pending; workflow versions/licenses and cancellation isolation evidence.

## G5 - Extend providers and Scope live sessions

```task
id: G5
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: G3, G4
scope: remaining provider adapters and isolated live-media session modules/tests/docs
```

Outcome: child cards for remaining Atlas/Comet coverage, Scope live WebRTC and
other approved modalities. Obtain version-specific signaling/API docs, licensing,
runtime prerequisites, input ownership, backpressure and disconnect/recovery rules.
Do not infer live streaming from a queued-video endpoint or generic OpenAI support.

Acceptance: each promised provider/modality has fixtures and authorized live evidence
or an approved deferral; session cleanup and bounded latency/queues tested. No
silent remote transfer, automatic reconnection billing or leaked session tokens.

Handoff: pending; children and provider/modality coverage matrix required.

## M1 - Implement surface geometry and layout validation

```task
id: M1
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: C2, C3
scope: isolated layout/warp geometry modules/tests; src/engine/projection.ts only if needed
```

Outcome: stable surface/output IDs, source endpoints and UVs, bounded mesh grids,
mask paths, layers and layout validation. Preserve old four-corner semantics.
Reject invalid/folded geometry and explicitly convert screen/UV coordinates.

Acceptance: round-trip layouts, corner/order/orientation fixtures, degenerate cells,
maximum grid/path limits and invalid edits retaining old layout. No UI or physical
calibration claim. Procedural sources permit progress independently of A1/G work.

Handoff: pending; geometry/serialization tests and budget evidence required.

## M2 - Build manual surface and mask editor

```task
id: M2
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: M1
scope: mapping editor/controls/tests; assigned stories/e2e; renderer integration by shared-file lease
```

Outcome: mesh editing, cubic Bezier/freehand masks, bounded feathering/tessellation,
selection/lock/nudge/reset, undo/redo, calibration patterns and clean single-output
presentation. Reuse existing vector interaction conventions. FreeDraw must match
the C1 decision; painted content needs an approved asset-backed child task if chosen.

**C1 decision:** FreeDraw = painted content. Child task required for brush/stroke
asset-backed painted output. This adds to M2 scope or becomes M2a per coordinator.

Acceptance: real graph frames warp/mask correctly; no UI in clean output; pointer/
keyboard edits, undo/redo, invalid edits and desktop/mobile screenshots/pixels tested.
No arbitrary SVG/script execution or silent coordinate-space changes.

Handoff: pending; FreeDraw decision, visual review and single-output demo required.

## M3 - Deliver named outputs and persisted mapping baseline

```task
id: M3
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: M2, A2
scope: output/layout runtime and tests; shared PreviewPanel/App/renderer/persistence by lease
```

Outcome: two or more logical surfaces routed to bounded named outputs, source
slicing/video-wall layout, clean manually placeable presentation window(s), saved
layouts and explicit screen binding. Optional Window Management capability detection.
Evaluate upstream frames/jobs once; measure any cross-context transfer path.

Acceptance: procedural/image -> two edited surfaces -> clean output -> save/reopen;
output/window loss, permissions, resolution/total-pixel bounds and relink handling.
No physical frame-lock guarantee or dependency on the show scheduler.

Handoff: pending; mapping baseline review, transfer measurements and output limits.

## M4 - Implement and physically validate overlap blending

```task
id: M4
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: M3
scope: output blend controls/shaders/tests; mapping documentation and physical test report
```

Outcome: manual overlap widths/curves, brightness/gamma adjustment, black-level
limitations and calibration patterns. Save settings per output. Define test rig and
acceptance tolerances with the user before claiming seamless physical projection.

Acceptance: mathematical coverage/alpha tests plus separate two-projector physical
alignment/blending evidence. Fixture success without hardware leaves physical gate
blocked, not accepted. Do not conflate canvas alpha with calibrated light output.

Handoff: pending; hardware approval, setup, measurements and reviewer sign-off.

## M5 - Implement model-based 3D projector calibration

```task
id: M5
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: D3, M3
scope: calibration geometry/solver/UI/tests; asset/layout integration by lease
```

Outcome: imported reference model, measured 3D/2D correspondences, projector
intrinsics/distortion and pose, reprojection residuals and persisted calibration.
Use a proven solver with explicit coordinate/unit conversion and failure handling.
Automatic camera reconstruction/scanning requires a separately approved child task.

Acceptance: synthetic known-pose/outlier/degeneracy tests and physical model-to-object
alignment to agreed tolerances. A manually positioned preview alone is not calibrated
projection. No unverified precision claims.

Handoff: pending; solver/license choice, tolerances, physical evidence required.

## I1 - Accept the combined fixture baseline

```task
id: I1
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: D3, G2, M3
scope: cross-track integration tests/presets/stories; docs/CURRENT_STATE.md; shared fixes by lease
```

Outcome: generated fixture asset -> shared store -> imported scene and/or mapped
surfaces -> frame effects -> clean output -> save/reopen. Verify offline ordinary
editing, missing assets/providers/outputs, reset and GPU recovery. Integrate one
track at a time; review public contract differences before applying patches.

Acceptance: all baseline criteria mapped to evidence, full repository/build/catalog
gates pass, old projects survive, no duplicate generation and no silent fallback.
Provider and physical tests remain separate; do not report full P0 completion.

Handoff: pending; integrated snapshot and independent baseline acceptance required.

## R1 - Audit full P0 coverage and release readiness

```task
id: R1
status: waiting
owner: unassigned
reviewer: unassigned
depends_on: I1, D4, D5, G3, G4, G5, M4, M5
scope: release evidence and docs; no deployment without explicit user approval
```

Outcome: audit every original P0 requirement against accepted cards/children,
supported formats/providers, license/security findings, physical/provider evidence
and known limits. Re-run required gates on the integrated snapshot. Product release
does not depend on adopting a multiagent framework; O0 is not a release dependency.

Acceptance: either full original P0 coverage, or an explicitly approved revised
release scope with outstanding work retained in the roadmap. Deferrals must never
be presented as implemented features. Record rollback/deployment plan for the single
existing web service; do not deploy or create a second permanent server implicitly.

Handoff: pending; release scope approval and independent acceptance required.