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

**Contract draft-1 (2026-10-11):** [src/store/contracts.ts](../../src/store/contracts.ts)
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

**Delivered (2026-10-11):** [src/store/assetStore.ts](../../src/store/assetStore.ts),
[src/store/assetStore.test.ts](../../src/store/assetStore.test.ts) — 16 tests.
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

**Delivered (2026-10-11):** [src/store/projectEnvelope.ts](../../src/store/projectEnvelope.ts),
[src/store/projectEnvelope.test.ts](../../src/store/projectEnvelope.test.ts) — 12 tests.
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
status: review
owner: assistant
reviewer: user
depends_on: C2, C3
scope: src/engine/SceneAssetCache.ts and neighboring tests (proposed)
```

Outcome: pinned Three.js GLTFLoader with injectable asset resolver; static GLB
hierarchy/core PBR subset. Test resolver permits parallel progress before A1 lands.
Preflight container/accessor bounds, then decoded counts before GPU upload. Deny
implicit external requests; reject unsupported required extensions/skins/animation
according to the accepted subset. Preserve last good scene during replacement.

**Delivered (2026-10-11):** [src/engine/SceneAssetCache.ts](../../src/engine/SceneAssetCache.ts),
[src/engine/SceneAssetCache.test.ts](../../src/engine/SceneAssetCache.test.ts) — 20 tests.
- `preflightGlb`: GPU-free container/chunk/accessor/bufferView bounds, triangle budget,
  static-subset enforcement (reject skins/animation), required-extension allowlist, external-URI ban
- `SceneAssetCache`: injectable resolver + decoder (default pinned GLTFLoader with empty resource path),
  content-hash ref counting, per-slot last-good preservation, stale-load discard, dispose
- Real generated fixture (single-mesh.glb) passes preflight (12 triangles)
- No operator, registry, or global renderer change

Verify: lint + typecheck + 802 tests + build all pass.

Acceptance: valid textured hierarchy, corrupt lengths/accessors, missing resources,
over-budget input, stale load, partial cleanup and shared-cache lifetime tests.
No automatic flattening, material stripping or global renderer changes.

Handoff: review — decoded texture-dimension and GPU-upload count checks run in the
decoder (browser/GPU gate), deferred to D2 renderer integration and Playwright pixels.

## D2 - Integrate imported scene references with the graph

```task
id: D2
status: review
owner: assistant
reviewer: user
depends_on: A1, D1
scope: src/graph/scene3d*; src/engine/Scene3DEvaluator.ts and Scene3DRenderer.ts; graph registry/types/compiler and WebGLRenderer (shared)
```

Outcome: Asset 3D descriptor/typed output, additive scene input to Render 3D, and
placement transforms without changing primitive contracts. Cache immutable resources,
preserve imported materials, and make graph light/camera policy explicit. Report
actual decoded costs and reject exceeding accepted budgets without simplification.

**Delivered (2026-10-11) — full live wiring under shared-file lease:**
- `scene.asset` PortType + `asset3d` NodeKind added to authoritative types; catalog version 21→22
- `asset3d` operator (asset id/hash/format + placement params) → `scene.asset` output
- Additive `assetScene` input appended to Render 3D at index 8 (existing indexes preserved)
- `SceneAssetValue` added to `Scene3DValue`; `Scene3DEvaluator` produces it with bounded placement
- `Scene3DRenderer` renders the decoded asset with placement; `WebGLRenderer.loadSceneAsset`/`releaseSceneAsset` decode via pinned GLTFLoader and dispose GPU resources
- Data bridge: [sceneAssetResolver.ts](../../src/engine/sceneAssetResolver.ts) (12 tests)
- `imported-model-stage` preset (reachable; satisfies per-kind preset rule)
- Exact-count assertions updated: operators/protocol/scene3d tests; operatorMeta entry added
- **Playwright pixel test** [e2e/scene-asset.spec.ts](../../e2e/scene-asset.spec.ts): imported GLB → lights/camera → Render 3D → Display renders visible pixels (passed in pinned 1.62.1 container, SwiftShader)

Verify: lint + typecheck + 820 unit tests + build pass; e2e scene-asset passes.

Acceptance: old primitive tests unchanged; typed port and serialization checks;
textured model -> lighting/camera -> effects -> Display pixel tests, alpha handling,
delete/reset/context restoration and stale replacement checks. Scope UI to D3.

Handoff: review — asset bytes are supplied to the renderer via `loadSceneAsset`;
wiring the AssetStore→renderer preload into the live app + Inspector file-input UI
is D3. Context-restore cache rebuild and multi-instance batches remain D3/D5.

## D3 - Deliver the usable 3D import baseline

```task
id: D3
status: review
owner: assistant
reviewer: user
depends_on: D2, A2
scope: asset controls and tests; src/graph/scene3dPresets.ts; local glTF resolver; assigned stories/e2e; docs/SCENE_3D.md
```

Outcome: local GLB/glTF file-set import, independent static placement/duplication,
material preservation, relink/package workflow, Local GLB Stage preset and stories.
Reuse existing file-input/node/Inspector controls. Optional fitting is stored as
an explicit transform. Imported cameras/lights do not silently override graph inputs.

**Delivered (2026-10-11):**
- [useSceneAssets.ts](../../src/hooks/useSceneAssets.ts) (+4 tests): AssetStore-backed import (GLB preflight + ingest), bytes-by-hash resolution, ready/missing/none status; IndexedDB in browser, injectable memory in tests
- [SceneAssetControl.tsx](../../src/components/SceneAssetControl.tsx) (+5 tests): file import, relink affordance, remove, error surfacing
- Inspector renders the control for `asset3d` and hides raw id/hash params; placement params stay editable
- [WebGLRenderer.setSceneAssets](../../src/engine/WebGLRenderer.ts): reconciles resident scenes, fires `SCENE_ASSET_READY_EVENT`; App→PreviewPanel bridge preloads bytes and re-renders
- `local-glb-stage` preset (renamed); [scene-asset-control story](../../stories/scene-asset-control.stories.tsx); docs/SCENE_3D.md updated
- Duplication yields independent placement sharing the cached scene by content hash; save/reopen re-resolves bytes from IndexedDB

Verify: lint + typecheck + 829 unit tests + build pass; storybook catalog gate 159 entries; D2 e2e pixel test still passes.

Acceptance: import -> duplicate/place -> light/render -> save/reopen; missing-file
relink, denied network dependency, bounded costs, independent transforms, cleanup,
desktop/mobile pixels and usable controls. This is the 3D baseline, not all formats.

Handoff: review — unit + component + hook coverage and the D2 render pixel test
establish the path; a full UI click-through e2e (select node → import → pixels) and
desktop/mobile screenshots remain for independent baseline sign-off.

## D4 - Add remaining requested format adapters

```task
id: D4
status: review
owner: assistant
reviewer: user
depends_on: D3
scope: isolated scene import adapters/tests/fixtures; docs/SCENE_3D.md
```

Outcome: split into separately assigned child cards for OBJ/MTL, STL, FBX, 3MF,
3DS, and USD/USDZ. Audit pinned loaders/conversion needs before implementation.
Record scene/material/texture/unit/animation fidelity and incompatible features
per format. Conversion services require separate deployment and trust approval.

**Delivered (2026-10-12):**
- [sceneImport.ts](../../src/engine/sceneImport.ts) (+15 tests): one offline
  adapter pipeline for OBJ/MTL, STL, FBX, 3MF, 3DS and USD/USDZ. Each pinned
  Three.js loader decodes to a scene, a static-subset check rejects skins and
  morph targets, and the pinned GLTFExporter normalizes the result to a single
  self-contained GLB — storage, preflight, budgets and rendering stay GLB-only.
- [gltfPack.ts](../../src/engine/gltfPack.ts) (+9 tests): packs a `.gltf` JSON
  and its companion files (`.bin`, PNG/JPEG/WebP textures, data URIs) into one
  GLB. Fixes the user-reported "Not a GLB file" failure for `.gltf` imports.
- `useSceneAssets.importFile` now accepts a file set: the model file plus any
  companions selected in the same picker; the file control advertises all
  supported extensions and allows multi-select.
- Offline guarantee: an intercepting LoadingManager blocks any loader network
  fetch; companion texture references must be provided as selected files.
- Fixtures (CC0, hash-recorded in
  [d4-fixture-manifest.json](../../public/test-data/fixtures-3d/d4-fixture-manifest.json),
  generator [generate-d4-fixtures.mjs](../../scripts/generate-d4-fixtures.mjs)):
  `d4-quad.obj`+`d4-quad.mtl`, `d4-quad.stl`, `d4-triangle.fbx`,
  `d4-triangle.3mf`, `d4-quad.usdz`.
- e2e [scene-import.spec.ts](../../e2e/scene-import.spec.ts): all five formats
  convert to preflight-valid GLB in a real browser (pinned Playwright
  container, 5 passed); existing scene-asset/scene-instance pixel tests still
  pass.

**Format fidelity matrix (pinned loaders, Three.js r180):**

| Format | Loader path | Fidelity | Known limits |
|--------|-------------|----------|--------------|
| OBJ/MTL | OBJLoader + MTLLoader | Geometry, groups, basic materials | No smoothing-group preservation beyond loader defaults; MTL textures only from selected companion files |
| STL | STLLoader | Binary and ASCII geometry; a default standard material is assigned | No color/material in the format itself |
| FBX | FBXLoader | Binary/ASCII FBX ≥ 6.4 geometry and standard materials | Skins/animation rejected by the static subset; TGA and external textures blocked offline |
| 3MF | 3MFLoader (fflate) | Core spec meshes and materials | Beam-lattice and slice extensions unsupported |
| 3DS | TDSLoader | Mesh geometry and materials | Legacy texture references blocked offline |
| USD/USDZ | USDLoader | USDA text and USDC crate geometry | Material networks beyond the loader subset; `.usd` binary assumed USDC |

**Not implemented (explicit deferrals):** FBX < 6.4, Draco/meshopt-compressed
GLB, server-side conversion (assimp or OpenUSD) for files outside the pinned
loader subsets. Such files fail import with a surfaced parse error; no silent
simplification. A server converter would need separate deployment and trust
approval per this card.

Verify: lint + typecheck + 1156 unit tests + build pass; e2e scene-import
(5), scene-asset and scene-instance specs pass.

Acceptance: every requested format has fixture-backed support or an explicitly
approved deferral; feasibility notes alone do not complete format support. Preserve
source bytes, missing-dependency diagnostics, resource limits and cancellation.

Handoff: review — stored assets are the normalized GLB (source bytes are not
retained after conversion, by design of the single-format pipeline; original
filenames are recorded in the manifest). Unit/UI click-through for each format
remains manual; cancellation is not applicable (imports are synchronous local
parsing, no job lifecycle).

## D5 - Add compatible GPU instance batches

```task
id: D5
status: review
owner: unassigned
reviewer: unassigned
depends_on: D3
scope: scene instance descriptors/cache/rendering/tests; shared graph integration by lease
```

Outcome: explicit compatible static geometry/material batches with bounded
per-instance transforms. Distinguish scene duplication from GPU instancing.
Define animation/skinning/morph support or approved exclusions; independent
character animation is not implied by static instancing.

**Delivered (2026-10-11):**
- [sceneInstancing.ts](../../src/graph/sceneInstancing.ts) (+10 tests): grid/ring instance layout generation (64 max), aggregate batch budgets (65,536 triangles / 64 draws / 64 textures), incompatibility diagnostics without silent freezing
- `instance3d` node (catalog 22→23): expands one Asset 3D placement into a bounded batch; duplication of Asset 3D nodes remains independent scene duplication
- [Scene3DRenderer.ts](../../src/engine/Scene3DRenderer.ts): one `InstancedMesh` per static mesh so instance count does not multiply draw calls; batches cached per source scene + count; disposed on release/context teardown; duplicated-placement fallback with surfaced diagnostics
- `WebGLRenderer.getLastBatchReport()` for aggregate GPU draw/instance/triangle evidence; `instance-glb-stage` preset; docs/SCENE_3D.md instancing section
- e2e pixel test `scene-instance.spec.ts`: 8 placements render as 1 instanced draw call with visible, independently placed pixels

Verify: lint + typecheck + unit tests + build; e2e scene-instance pixel test.

Acceptance: visible independent placement, aggregate geometry/draw/memory budgets,
batch incompatibility diagnostics, shared-resource cleanup and performance evidence.
No general particle simulation or unlimited scene hierarchy scope.

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
status: review
owner: assistant
reviewer: user
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

**Delivered (2026-10-11, proof of concept):**
[comfyClient.ts](../../src/generation/comfyClient.ts),
[comfyWorkflows.ts](../../src/generation/comfyWorkflows.ts),
[comfyJob.ts](../../src/generation/comfyJob.ts),
[useComfyGenerate.ts](../../src/hooks/useComfyGenerate.ts) — 43 unit tests.
- New `comfyGenerate` node kind (catalog 23→24), operator definition, `comfy-generate` preset, node controls
- Capability discovery over `/system_stats`, `/object_info`, `/features`, `/models/{folder}`
- Two allowlisted templates (checkpoint image, Wan 2.2 t2v); no imported-workflow execution
- Readiness checks for missing node classes, unfilled slots, uninstalled models
- Submit/poll/download/ingest into the A1 asset store; request-marker reconciliation
- Cancellation prefers `/queue` delete; `/interrupt` only when `/queue` proves ownership
- Session-only Comfy Cloud key, HTTPS-gated, never serialized

Verify: lint + `tsc -b` + 888 unit tests + build all pass. Live on
`https://videohead.duckdns.org/comfy/` (ComfyUI 0.39.1, NVIDIA GB10): SDXL image
in ~12 s, Wan 2.2 480x320x13 clip in ~25 s, both ingested as durable assets.

Acceptance: missing-model/node errors, deterministic fixture jobs, stale results,
reconnect/reconciliation, secure hosted-page-to-local-service route and authorized
live workflow tests. Do not install/launch model runtimes without approval.

Handoff: review — remaining for full acceptance: image/mask/clip *input* support,
workflow version/license records, MiniMax and LTX-2.5 templates, and Comfy Cloud
`api.comfy.org/v2` adapter (key verified against `/v2/models`; generation routes
need user spend approval).

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
status: review
owner: assistant
reviewer: user
depends_on: C2, C3
scope: isolated layout/warp geometry modules/tests; src/engine/projection.ts only if needed
```

Outcome: stable surface/output IDs, source endpoints and UVs, bounded mesh grids,
mask paths, layers and layout validation. Preserve old four-corner semantics.
Reject invalid/folded geometry and explicitly convert screen/UV coordinates.

**Delivered (2026-10-11):**
- [surfaceLayout.ts](../../src/engine/surfaceLayout.ts) (+44 tests): central
  `screenToFrameUv`/`frameUvToScreen` conversion, stable surface/output ids,
  bounded mesh grids, mask path and surface/output validation, deterministic
  layer ordering, validated edits, and strict serialize/parse round-trip
- Fold and degeneracy are rejected by a single cross-product sign test per cell
- New ceilings: `MAX_SURFACE_MESH_SPAN` 32/axis, `MAX_SURFACE_MASK_PATHS` 16,
  `MAX_OUTPUT_DIMENSION` 7680, `MAX_TOTAL_OUTPUT_PIXELS` 7680x4320
- Four-corner compatibility: `meshFromProjectionCorners` /
  `projectionCornersFromMesh` preserve the shipped screen-space corner order
  (top-left, top-right, bottom-right, bottom-left) exactly

**Defect found and fixed in the shipped Projector Mapping node.** It had no test
coverage. [projection.ts](../../src/engine/projection.ts) read the Gaussian
solution in the wrong order (`h[6]`/`h[7]` as `m02`/`m12`), so the identity quad
and the node's own default corners returned `null` and silently rendered an
unwarped frame; non-default quads mapped to the wrong place. The
`projectorMapping` shader also rebuilt the matrix with `mat3(row0,row1,row2)`,
which fills columns and transposed the map. Both are corrected, with
[projection.test.ts](../../src/engine/projection.test.ts) (10 tests) locking
corner order, move/scale/rotation and degeneracy, and
[e2e/projector-mapping.spec.ts](../../e2e/projector-mapping.spec.ts) asserting
the quad lands in the intended screen quadrant. The pixel test was confirmed
discriminating by re-running it against the pre-fix files.

Verify: lint + typecheck + 942 unit tests + build pass; projector-mapping e2e passes.

Acceptance: round-trip layouts, corner/order/orientation fixtures, degenerate cells,
maximum grid/path limits and invalid edits retaining old layout. No UI or physical
calibration claim. Procedural sources permit progress independently of A1/G work.

Handoff: review — the geometry module is standalone; `MAX_SURFACE_MESH_SPAN`,
`MAX_SURFACE_MASK_PATHS`, `MAX_OUTPUT_DIMENSION` and `MAX_TOTAL_OUTPUT_PIXELS`
are M1 proposals that still need C3 measurement sign-off.

## M2 - Build manual surface and mask editor

```task
id: M2
status: review
owner: assistant
reviewer: user
depends_on: M1
scope: mapping editor/controls/tests; assigned stories/e2e; renderer integration by shared-file lease
```

Outcome: mesh editing, cubic Bezier/freehand masks, bounded feathering/tessellation,
selection/lock/nudge/reset, undo/redo, calibration patterns and clean single-output
presentation. Reuse existing vector interaction conventions. FreeDraw must match
the C1 decision; painted content needs an approved asset-backed child task if chosen.

**C1 decision:** FreeDraw = painted content. Child task required for brush/stroke
asset-backed painted output. This adds to M2 scope or becomes M2a per coordinator.

**Delivered (2026-10-11):**
- [surfaceMask.ts](../../src/engine/surfaceMask.ts) (+24 tests): cubic Bezier
  nodes with handles, curvature-driven tessellation bounded to
  `MAX_SURFACE_MASK_POINTS`, rectangle/ellipse primitives, freehand capture
  (Ramer-Douglas-Peucker then Catmull-Rom handle fitting) and feathered
  coverage. A flat segment costs one point; a dense path loses detail rather
  than breaching the budget.
- [surfaceEditor.ts](../../src/engine/surfaceEditor.ts) (+29 tests): UI-free
  editor state. Every mutation is routed through the M1 validator, so a fold or
  an off-surface node leaves the previous layout untouched and is not recorded
  in history. Selection (additive), per-surface lock, fine/coarse nudge, mesh
  resolution, mask add/remove/feather, reset, and bounded undo/redo.
- [surfaceRaster.ts](../../src/engine/surfaceRaster.ts) (+16 tests): mesh
  triangulation, per-triangle affine solve, mask projection and feather radius.
  `drawSurface` composites a real frame through the mesh and masks on a 2D
  context, so no WebGLRenderer lease was consumed.
- [SurfaceMappingEditor.tsx](../../src/components/SurfaceMappingEditor.tsx)
  (+17 tests): pointer drag, keyboard nudge, Escape, tool switching, mask
  drawing, lock, calibration overlay, undo/redo, and a `cleanOutput` mode that
  renders the mapped frame with no toolbar, overlay or focusable control.
- [surface-mapping-editor story](../../stories/surface-mapping-editor.stories.tsx)
  with Editing and CleanOutput entries over a procedural test pattern.
- `SurfaceMaskNode` and an optional `nodes` field were added additively to
  `SurfaceMaskPath`; `points` stays the tessellated form renderers consume.

**Seam defect found and fixed.** Canvas clip paths are antialiased, so adjacent
mesh triangles each covered part of the shared boundary pixels and left a
translucent diagonal seam (alpha 198/255 at the centre of an unwarped surface).
`expandTriangle` now grows each clip so every edge moves a full pixel outward,
making neighbours overlap instead of abut. The affine still comes from the true
corners, so the overlap samples slightly beyond the cell without distorting it.

Verify: lint + typecheck + 1025 unit tests + build pass;
[e2e/surface-mapping.spec.ts](../../e2e/surface-mapping.spec.ts) asserts an
unmapped surface blits exactly, a mesh moves the frame into one quadrant and
leaves the rest clear, a hard mask keeps only its interior, feathering ramps
alpha, and warp plus mask compose. Desktop and mobile screenshots captured.

Acceptance: real graph frames warp/mask correctly; no UI in clean output; pointer/
keyboard edits, undo/redo, invalid edits and desktop/mobile screenshots/pixels tested.
No arbitrary SVG/script execution or silent coordinate-space changes.

Handoff: review — outstanding for full acceptance: (1) the editor is driven by a
2D-canvas compositor, not the production WebGL renderer, so routing live graph
frames through it needs the M3 shared-file lease; (2) the mask tool places a
rectangle and freehand fits a closed path, but there is no direct on-canvas
handle editing for Bezier tangents yet; (3) FreeDraw painted content remains the
separate C1 child task and is **not** implemented here.

## M3 - Deliver named outputs and persisted mapping baseline

```task
id: M3
status: review
owner: assistant
reviewer: user
depends_on: M2, A2
scope: output/layout runtime and tests; shared PreviewPanel/App/renderer/persistence by lease
```

Outcome: two or more logical surfaces routed to bounded named outputs, source
slicing/video-wall layout, clean manually placeable presentation window(s), saved
layouts and explicit screen binding. Optional Window Management capability detection.
Evaluate upstream frames/jobs once; measure any cross-context transfer path.

**Delivered (2026-10-11):**
- [outputComposer.ts](../../src/engine/outputComposer.ts) (+16 tests): draws an
  output's surfaces in `layerIndex` order, each through its own scratch layer
  so a later surface's mask cannot erase an earlier one. Blend mode and opacity
  are applied at composite time. **Upstream sources are resolved at most once
  per frame** even when several surfaces share one source or slice different
  regions of it, and `ComposeReport.sourceEvaluations` makes that observable
  rather than assumed. A missing source is reported and skipped while the other
  surfaces still draw. `planOutputs` reports the distinct source nodes a frame
  needs plus any layout issues.
- [presentationWindow.ts](../../src/engine/presentationWindow.ts) (+19 tests):
  chrome-free popup per output, Window Management capability detection,
  screen enumeration with generated labels for unnamed screens, screen-relative
  placement, and a registry that reuses a live window, reopens after the user
  closed one, and reconciles lost windows. A blocked popup and a refused
  permission are reported states, never thrown errors, so mapping never depends
  on a permission the user has not granted.
- Persistence gap closed: `parseEnvelope` previously passed `outputLayouts`
  through with a bare `Array.isArray` check. It now re-validates them through
  the M1 parser, so a corrupted or hand-edited file cannot install folded
  geometry or an unbounded output.
  [mappingPersistence.test.ts](../../src/store/mappingPersistence.test.ts)
  (+12 tests) covers two edited surfaces sharing one source through save and
  reopen, older projects with no layouts, bare graph-only import, and refusal
  of folded geometry, an over-ceiling pixel total and a malformed payload.
- Round-trip defect fixed: mirrored Bezier handles produced `-0`, which JSON
  normalizes to `0`, so a saved mask did not reopen byte-identical. Handle
  construction now normalizes negative zero.
- [docs/MAPPING.md](../MAPPING.md): coordinate conventions, geometry limits,
  editing rules, and output/presentation behaviour.

Verify: lint + typecheck + 1117 unit tests + build pass; mapping e2e specs pass.

Acceptance: procedural/image -> two edited surfaces -> clean output -> save/reopen;
output/window loss, permissions, resolution/total-pixel bounds and relink handling.
No physical frame-lock guarantee or dependency on the show scheduler.

Handoff: review — outstanding for full acceptance: (1) the composer and
presentation window are standalone modules; wiring them into the live
App/PreviewPanel and routing production WebGL frames into them still needs the
shared-file lease, so the end-to-end path is covered by module and pixel tests
rather than a UI click-through; (2) **no cross-context transfer measurement has
been taken** — the composer runs in one context today, so the measured transfer
path the card asks for is not yet evidence; (3) multi-planar / video-wall
slicing beyond the per-surface `sourceUvRegion` remains deferred per C1.

## M4 - Implement and physically validate overlap blending

```task
id: M4
status: review (software) / BLOCKED (physical gate)
owner: assistant
reviewer: user
depends_on: M3
scope: output blend controls/shaders/tests; mapping documentation and physical test report
```

Outcome: manual overlap widths/curves, brightness/gamma adjustment, black-level
limitations and calibration patterns. Save settings per output. Define test rig and
acceptance tolerances with the user before claiming seamless physical projection.

**Delivered (2026-10-11) — signal-domain only:**
- [edgeBlend.ts](../../src/engine/edgeBlend.ts) (+42 tests). The weight family
  `w(t) = t^p / (t^p + (1-t)^p)` satisfies `w(t) + w(1-t) = 1` for every
  exponent, so an operator can reshape the ramp without ever breaking the sum.
  Weights are computed in **linear light** and encoded with the display gamma
  only at the end, because adding encoded values would be physically
  meaningless.
- Encoding is multiplicative (`enc(a)·enc(b) = enc(ab)`), which is why the four
  edges can be applied as four independent `destination-in` gradient passes and
  a corner still receives the correct product. `applyEdgeBlend` does exactly
  that, then applies the brightness trim once.
- Per-output settings (`OutputBlendSettings`, additive and optional): per-edge
  overlap widths, curve exponent, gamma, brightness, black-level lift. Validated
  and persisted; opposing widths that would leave a zero-width full-brightness
  interior are rejected.
- `blackLevelReport` quantifies the limitation rather than implying a fix: a
  blend curve scales light down and can never remove a projector's black floor,
  so an overlap's black doubles. The only mitigation raises black everywhere
  else, costing contrast (2% floor: 50:1 becomes 25:1).
- Calibration patterns: `grid`, `blend-edges` (marks where each active overlap
  reaches full brightness), and `flat-field`.
- [docs/MAPPING.md](../MAPPING.md) records the blend maths, the black-level
  trade, what is verified, what is not, and the proposed physical rig.
- [e2e/edge-blend.spec.ts](../../e2e/edge-blend.spec.ts): two complementary
  blends rendered through the real canvas pipeline sum to one screen of light
  across the whole overlap (max error < 0.04, covering 8-bit alpha quantization
  and gradient interpolation). The check is discriminating — a unit test
  confirms mismatched curves open a measurable seam (> 0.05).

Verify: lint + typecheck + 1117 unit tests + build pass; edge-blend e2e passes.

**Physical gate: BLOCKED. Not accepted.** Nothing in this repository is evidence
of seamless physical projection, and canvas alpha is not calibrated light
output. Unverified: real projector gamma (assumed, not measured), colour
primaries and inter-projector match, output drift and uniformity, actual black
floor, and geometric stability over time and temperature.

Acceptance: mathematical coverage/alpha tests plus separate two-projector physical
alignment/blending evidence. Fixture success without hardware leaves physical gate
blocked, not accepted. Do not conflate canvas alpha with calibrated light output.

Handoff: software half in review. The physical half needs, in order: (1) user
approval of the rig and tolerances proposed in docs/MAPPING.md — two matched
projectors, matte screen, 15% overlap, calibrated luminance meter, ±5%
white-field tolerance across the seam — which are **a proposal, not agreed
numbers**; (2) hardware access and an authorized session; (3) recorded
measurements with instrument details; (4) independent reviewer sign-off. No
blend UI control surface was built yet; settings are set programmatically and
persisted, so a controls pass belongs with the M3 shared-file lease.


## I1 - Accept the combined fixture baseline

```task
id: I1
status: review (partial — generation leg not covered)
owner: assistant
reviewer: user
depends_on: D3, G2, M3
scope: cross-track integration tests/presets/stories; docs/CURRENT_STATE.md; shared fixes by lease
```

Outcome: generated fixture asset -> shared store -> imported scene and/or mapped
surfaces -> frame effects -> clean output -> save/reopen. Verify offline ordinary
editing, missing assets/providers/outputs, reset and GPU recovery. Integrate one
track at a time; review public contract differences before applying patches.

**Delivered (2026-10-11):**
[baselineIntegration.test.ts](../../src/store/baselineIntegration.test.ts) —
7 tests walking one project end to end: a durable asset enters the shared store,
two surfaces are mapped onto one named output and edited, the output composes
cleanly while evaluating its source exactly once, and the project saves,
reopens and round-trips as a portable bundle. Also covers a missing asset, a
deleted source node, undo leaving durable bytes untouched, refusal of a corrupt
saved mapping, and an older graph-only project.

**Two cross-track defects found and fixed.** Neither was visible from inside a
single track:
1. `importBundle` rejected the JSON string that `exportBundle` returns,
   reporting its own valid output as a malformed bundle. It now accepts either
   the string or an already-parsed object.
2. `importBundle` re-ingested assets under ids allocated by the target store
   but returned an envelope still keyed by the **source** ids, so every
   manifest referenced an id that could never resolve. The returned envelope is
   now rekeyed to the ingested ids; content hashes are unchanged, so
   hash-based resolution is unaffected.

Verify: lint + typecheck + 1124 unit tests + build pass.

Acceptance: all baseline criteria mapped to evidence, full repository/build/catalog
gates pass, old projects survive, no duplicate generation and no silent fallback.
Provider and physical tests remain separate; do not report full P0 completion.

Handoff: review, and **partial by construction**. (1) The baseline's asset is
ingested directly because G1/G2 are still `waiting` — **nothing here is evidence
that a generated result reaches the store through a job lifecycle**, so I1's
generation leg is not covered and the card cannot be fully accepted while its
G2 dependency is unmet. (2) The composer and presentation window are still
standalone modules, so the path is covered by module-level and pixel tests
rather than a live UI click-through. (3) GPU context-recovery across the
combined path was not re-exercised in this pass. (4) The catalog gate was not
re-run. See [RELEASE_AUDIT.md](RELEASE_AUDIT.md).

## R1 - Audit full P0 coverage and release readiness

```task
id: R1
status: review (audit drafted) / BLOCKED (release decision)
owner: assistant
reviewer: user
depends_on: I1, D4, D5, G3, G4, G5, M4
scope: release evidence and docs; no deployment without explicit user approval
```

Outcome: audit every original P0 requirement against accepted cards/children,
supported formats/providers, license/security findings, physical/provider evidence
and known limits. Re-run required gates on the integrated snapshot. Product release
does not depend on adopting a multiagent framework; O0 is not a release dependency.

**Note:** M5 (3D calibration) was withdrawn by the user on 2026-10-11 for later
revision and has been removed from this card's dependencies.

**Delivered (2026-10-11):** [RELEASE_AUDIT.md](RELEASE_AUDIT.md).

**Verdict: full original P0 coverage is NOT achieved.** All three tracks are
partial:
- **3D import:** GLB/glTF only. Six of seven requested format families
  (OBJ, FBX, STL, 3MF, 3ds, USD/USDZ) are unimplemented — D4 is `waiting`.
- **Generators:** ComfyUI text-to-image/clip against a user-run server. No
  image/mask/video inputs, no provider-neutral job contract (G1), no generation
  UI (G2), no Atlas/Comet (G3), no DayDreamScope (G5).
- **Mapping:** mesh warp, Bezier masks, named outputs, persistence and
  signal-domain blending. Physical blending BLOCKED, FreeDraw painted content
  not delivered, video wall deferred, 3D calibration withdrawn.

Gates re-run on the integrated snapshot: lint, typecheck, 1124 unit tests and
build all pass (734 at C0). The full Playwright suite is 67 passed / 1 skipped
with **2 pre-existing `studio.spec.ts` failures that remain untriaged** and must
not be assumed benign. The catalog gate was not re-run in this pass.

Security: the 3 high-severity npm advisories are all `undici` via `jsdom`, a
**test-only** dependency — `npm audit --omit=dev` reports 0 vulnerabilities, so
the shipped bundle is unaffected. No new runtime dependencies were added. A
third-party licence review / SBOM has **not** been performed.

A second, procedural blocker: apart from C1, **no card has been accepted** —
every delivered card sits in `review`, and R1 cannot close over unaccepted
dependencies.

Acceptance: either full original P0 coverage, or an explicitly approved revised
release scope with outstanding work retained in the roadmap. Deferrals must never
be presented as implemented features. Record rollback/deployment plan for the single
existing web service; do not deploy or create a second permanent server implicitly.

Handoff: BLOCKED on a user decision. The audit proposes a revised release scope
(GLB/glTF import with instancing, ComfyUI text generation, the mapping baseline,
all with limits stated) — **a proposal, not an approved scope**, and materially
narrower than the original P0 text. No deployment is authorized. Rollback
currently has a gap: **no image digest is recorded for the known-good
deployment**, so one must be captured before any deploy.