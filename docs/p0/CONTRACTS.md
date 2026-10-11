# P0 Shared Contract Proposals

Version: draft-1. Status: proposed; C2 accepts/version-stamps contracts and C3
supplies measured budgets before implementation tickets become ready. This is
not a second graph schema or permission to change existing public contracts.
See [workflow](README.md) and [task ledger](TASKS.md).

## Existing boundaries

- [Graph types](../../src/graph/types.ts), registry and compiler remain authoritative.
- [Persistence](../../src/store/persistence.ts) stores schema-1 graph JSON in
  localStorage, currently capped at 1 MB. No binary assets in graph JSON.
- [Scene descriptors](../../src/graph/scene3d.ts) describe primitives; the current
  [scene renderer](../../src/engine/Scene3DRenderer.ts) is not an arbitrary scene loader.
- [Video Model](../../src/hooks/useVideoModel.ts) handles latest image frames;
  queued durable clip jobs and arbitrary input-frame uploads are new contracts.
- [Projection](../../src/engine/projection.ts) is a four-corner homography. New mesh
  warps/layouts must not change existing corner order, coordinates or saved results.

## Asset identity and persistence

Proposed AssetRef: immutable content identity and asset kind. Manifest: version,
stable ID, content hash, MIME, encoded bytes, validated dimensions/duration where
applicable, original filename, dependency identities, and bounded provenance.
Do not store native objects, object URLs, credentials or expiring signed URLs.
Content identity and editable scene placement identity are different.

AssetStore provides ingest, resolve, metadata lookup, explicit relink/remove, and
runtime handle retain/release. IndexedDB stores original blobs and manifests;
in-memory storage is injectable for tests, not a silent persistence fallback.
Stage validation/storage before publishing refs into the graph. Failures leave
the old graph and asset intact. Deduplication must not merge incompatible manifests
or allow unvalidated data to become trusted through an existing hash.

Runtime handle release frees decoded resources, not durable bytes. Undo/history,
saved projects, pending imports and active jobs can retain refs. Destructive asset
cleanup is explicit and reference-aware; no eager deletion when a node disappears.
Missing assets remain visible/relinkable. Hash mismatches require an explicit new
asset/replacement operation, not silently substituting different content.

The project resource envelope is separately versioned around the one GraphDocument.
C2 defines old graph-only import compatibility, layout/asset manifest inclusion,
and a portable bundle format. A2 implements staged bundle validation, traversal/
decompression limits, rollback, missing-resource reporting and recoverable quota
errors. No worker independently changes graph schema or exports.

## Scene asset contract

Propose an asset-scene descriptor referencing AssetRef plus ordered placement
transforms, with a typed scene signal separate from primitive Geometry3DValue.
Exact names and registry port IDs are C2 decisions. Append new inputs; preserve
existing Render 3D indexes and primitive semantics.

First supported subset: static GLB/glTF 2.0, hierarchy transforms, core PBR
materials and bounded textures. Explicitly define supported extensions and behavior
for skins, animation and morph targets; reject unsupported content, never silently
freeze or strip it. Validate container/accessor bounds before decode and decoded
resource counts before GPU upload. Local dependency resolution must deny implicit
network fetches and path escapes, including dependencies inside GLB containers.

Keep original units/Y-up data. Optional fitting/normalization is an explicit
placement transform. Graph camera/light controls remain authoritative; imported
cameras/lights are not activated automatically. Preserve imported materials unless
the user deliberately overrides them. Cache immutable geometry/textures with
reference counting and independent placement transforms. Multi-mesh duplication
is not automatically one GPU instance batch. Cancel stale loads, dispose partial
results, retain the last valid scene, and rebuild caches after context recovery.

## Generation jobs

Generation requests snapshot prompt, source image/mask/video AssetRefs, model and
adapter identity, settings, desired output kind and request identity. Expose
capabilities per model; an API accepting images does not imply video-to-video,
mask editing or live streaming support. Capture graph frames only on explicit
submission, within approved size/time budgets.

Proposed states: idle, submitting, queued, running, fetching, ready, failed,
cancel-requested, cancelled, unknown. `unknown` covers an uncertain submission
outcome; reconcile by request/job ID before any retry that could duplicate spend.
Record provider acknowledgement separately from local cancellation. Do not promise
that aborting a request cancels billing. Endpoint/model/node generation changes
invalidate stale results. No network job starts in the render loop or on import.

Completed outputs enter AssetStore atomically with provenance; normal media runtime
handles playback. Reopening a project may reconcile an authorized existing job but
never silently resubmits it. Credentials are runtime/gateway state, not export data.
Trusted gateways allowlist upstream operations and returned download destinations,
validate redirects/resolved addresses, bound streaming downloads and redact errors.
Avoid SSRF, signed-URL persistence and credential forwarding to result hosts.

ComfyUI runs approved API-format workflows with declared model/custom-node
dependencies. Its server-wide interrupt must not cancel unrelated users' work;
isolation or verified job-scoped semantics is a release gate. Scope's live media
session is a separate signaling/backpressure/recovery contract, not a polling job.

## Mapping surfaces and outputs

Surface identity references a graph frame endpoint, source UV region, bounded
warp mesh, ordered mask paths, output ID, layer order, visibility and blend settings.
An output has a stable logical name, dimensions and layout coordinates; physical
screen bindings belong to the session. Generated content is computed once and
routed to surfaces; multiple outputs must not create duplicate model jobs.

Define screen Y-down versus frame UV Y-up conversions centrally. State explicitly
whether masks live in source, surface or output coordinates. Bound tessellation,
path points and feathering. Reject degenerate/folded cells; invalid edits preserve
the last valid layout. Freehand input produces editable bounded paths unless C1
selects painted content, which requires an additional approved task.

Mesh alignment, clean presentation, output routing and calibration are separate
from show playback. A composite atlas is a candidate first output implementation,
not a requirement to render every monitor into an unbounded texture. C2/C3 select
a measured architecture within GPU limits. Window Management API is optional;
manual placement remains usable. Handle popup/fullscreen permission and screen
loss. No cross-context zero-copy or hardware frame-lock claim without evidence.

Blending requires overlap curves plus brightness/gamma calibration and explicit
black-level limitations; canvas alpha alone is insufficient. 3D calibration stores
model transforms, intrinsics/distortion, correspondences, pose, residual error and
units. Manual alignment is not automatic camera-assisted calibration. Physical
acceptance must name the projector rig, surface, resolution and error tolerance.

## Budgets and decision record

C3 fills concrete ceilings and a measurement method for encoded/decoded asset
bytes, dependencies, scene nodes/materials/triangles/draws/textures, instances,
job concurrency/duration/output size, mask/mesh complexity, logical outputs and
aggregate output pixels. Existing graph/frame limits remain enforced; no automatic
increase or silent downsampling. Distinguish application caps from device limits.

C1 records approval of staged baselines, FreeDraw interpretation, static-scene
subset, provider selection method, and which full-scope features remain later.
Provider/model selection and spend approval may stay pending until G3; physical
rig details until M4/M5; router credentials until O0. These do not block fixture work.

Every accepted change records version, owner, reviewer, date, affected tasks,
compatibility/migration rules, tests and budget evidence here. If a contract changes,
pause affected tasks and amend assignments; do not let workers fork the contracts.

## Contract decisions

## Contract decisions — draft-1 accepted 2026-10-11

| Version | Date | Owner | Reviewer | Affected |
|---------|------|-------|----------|----------|
| draft-1 | 2026-10-11 | assistant | user | C2, C3; all downstream A/D/G/M tasks |

**Source:** [src/store/contracts.ts](../../src/store/contracts.ts) — additive file;
no graph schema or persistence contract changes required for this version.

**Compatibility:** old schema-1 graph-only imports are retained by treating
`assetManifests`, `outputLayouts`, and `generationJobs` as optional when absent
in `ProjectEnvelope`.

**Migration:** if implementing tasks require shared-file changes to
`src/graph/types.ts`, `src/store/persistence.ts`, or the operator registry,
a separate shared-file lease is required per the C2 assignment rules.

**Budgets:** C3 fixture manifest recorded in [TASKS.md](TASKS.md) C3 block.
Ceilings provisional until fixture measurement evidence completes.

The existing repository instructions and implemented contracts remain in force.
Further amendments pause affected tasks and amend assignments.