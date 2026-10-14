# R1 — P0 Coverage and Release Readiness Audit

**Date:** 2026-10-11 · **Status:** draft for user review · **Not a release approval.**

This audits every original P0 requirement in
[Planned Development](../PLANNED_DEVELOPMENT.md) against delivered evidence.

## Verdict

**Full original P0 coverage is NOT achieved.** All three P0 tracks are partially
delivered. R1's acceptance rule allows either full coverage or an explicitly
approved revised release scope; this document proposes the latter and **awaits
the user's decision**. Deferrals below are recorded as outstanding work, not as
features.

A second blocker is procedural: apart from C1, **no card has been accepted**.
Every delivered card sits in `review` awaiting independent sign-off, and R1
cannot close over unaccepted dependencies.

## Gates on the integrated snapshot

Re-run 2026-10-11 on the current working tree, Docker `node:22-alpine`:

| Gate | Result |
| --- | --- |
| Lint (`eslint . --max-warnings 0`) | Pass |
| Typecheck (`tsc -b`) | Pass |
| Unit tests | **1124 passed**, 2 skipped, 66 files (734 at C0) |
| Build (`tsc -b && vite build`) | Pass |
| Playwright (full suite) | 67 passed, 1 skipped, **2 pre-existing failures** |
| Catalog | Not re-run in this pass — see Outstanding gates |

The two Playwright failures are in `e2e/studio.spec.ts` ("runs every teaching
node inside a visible starter graph" and "starts audio analysis from the node
and shows its control output"). Their result folders pre-date this work and
neither touches the asset, generation, or mapping tracks. They are **unexplained
and untriaged**, and must not be assumed benign at release time.

## Track coverage

### P0: 3D file import — PARTIAL

Required: GLB/glTF, USD/USDZ, OBJ, FBX, STL/3MF, 3ds; instanced in a 3D scene
with lights and cameras.

| Requirement | Status | Evidence |
| --- | --- | --- |
| GLB / glTF | Delivered (review) | D1 preflight, D2 graph wiring, D3 import UI; pixel test |
| Lights and cameras applied | Delivered (review) | D2 `assetScene` into Render 3D; pixel test |
| GPU instancing | Delivered (review) | D5: 8 placements, 1 instanced draw call |
| OBJ, FBX, STL, 3MF, 3ds, USD/USDZ | **Not delivered** | D4 `waiting`; no adapters, no fixtures |

Six of seven requested format families are unimplemented. The track is one
format family deep.

### P0: External generators — PARTIAL

Required: Atlas Cloud, CometAPI, ComfyUI, DayDreamScope; send text, image and
video; retrieve generated assets.

| Requirement | Status | Evidence |
| --- | --- | --- |
| ComfyUI, text input | Delivered (review) | G4: live SDXL image ~12 s, Wan 2.2 clip ~25 s |
| Retrieve generated assets | Delivered (review) | G4 ingests into the A1 store |
| Image / mask / video **inputs** | **Not delivered** | G4 handoff; text-only today |
| Provider-neutral job contract | **Not delivered** | G1 `waiting` |
| Generation UI and durable results | **Not delivered** | G2 `waiting` |
| Atlas Cloud, CometAPI | **Not delivered** | G3 `waiting`; needs credential/spend approval |
| DayDreamScope live sessions | **Not delivered** | G5 `waiting` |

G4 landed ahead of its stated `depends_on: G2`, so the ComfyUI job runtime is
adapter-specific and will need reconciling when G1 defines the shared contract.
Comfy Cloud authenticates against `api.comfy.org/v2` but **no generation route
has been exercised** — that needs spend approval.

### P0: Enhanced projector mapping — PARTIAL

Required: mesh warping, Bezier masking, FreeDraw, 3D calibration, video wall /
multiplanar, soft edge blending.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Mesh warping | Delivered (review) | M1 geometry, M2 editor, pixel test |
| Bezier masking | Delivered (review) | M2 cubic nodes, feathering, pixel test |
| Named outputs, persistence | Delivered (review) | M3 composer, save/reopen |
| Soft edge blending (signal) | Delivered (review) | M4 complementary ramps, pixel test |
| Soft edge blending (physical) | **BLOCKED** | No hardware evidence; rig unapproved |
| FreeDraw as painted content | **Not delivered** | C1 chose painted content; child task unstarted |
| Video wall / multiplanar | **Deferred** | C1 deferred; only per-surface `sourceUvRegion` exists |
| 3D calibration | **Removed** | M5 withdrawn by the user 2026-10-11 for later revision |

Two defects found and fixed in previously shipped code during this work: the
Projector Mapping homography was mis-indexed and its shader transposed the map
(M1), and canvas clip antialiasing left a translucent seam between mesh
triangles (M2). Both now have discriminating pixel tests.

## Cross-track baseline (I1)

[baselineIntegration.test.ts](../../src/store/baselineIntegration.test.ts)
walks asset → shared store → mapped surfaces → frame-effect node → composed
clean output → save/reopen → portable bundle, plus missing-asset, deleted-source,
undo, corrupt-mapping and legacy-project cases.

It found two real cross-track defects, both fixed:

1. `importBundle` rejected the JSON string `exportBundle` returns, reporting
   valid output as a malformed bundle.
2. `importBundle` re-ingested assets under new ids but returned an envelope
   still keyed by the old ones, so manifests referenced ids that could never
   resolve in the target store.

**Honest limit:** the baseline's asset is ingested directly. G1/G2 are `waiting`,
so nothing here is evidence that a generated result reaches the store through a
job lifecycle. The generation leg of I1's stated path is **not covered**.

## Security and licence findings

| Finding | Assessment |
| --- | --- |
| 3 high-severity npm advisories | All `undici` via `jsdom`. **Test-only**; `npm audit --omit=dev` reports 0 vulnerabilities, so the shipped bundle is unaffected. |
| New runtime dependencies | None added across A1–A2, D1–D5, G4, M1–M4, I1. |
| Credentials | Session-only Comfy key, never serialized; envelope and bundle export assert no credential-like fields. |
| Fixtures | All generated CC0; no user media, no credentials. |
| Third-party licences | **Not audited.** No SBOM or licence review was performed for the existing dependency tree. |

## Known limits that must not be presented as features

- Canvas alpha is not calibrated light output. **No seamless physical projection
  claim is supported.**
- Screen binding records an operator's choice; it is not a placement, refresh,
  or frame-lock guarantee.
- The mapping composer and presentation window are standalone modules, not yet
  wired into the live App/PreviewPanel; no UI click-through exists for them.
- No cross-context transfer measurement has been taken (M3 asked for one).
- A1's IndexedDB path is exercised only through the memory backend in jsdom.
- Geometry ceilings (`MAX_SURFACE_MESH_SPAN`, `MAX_OUTPUT_DIMENSION`,
  `MAX_TOTAL_OUTPUT_PIXELS`, blend ranges) are proposals awaiting C3 sign-off.
- No blend control surface exists; blend settings are set programmatically.

## Outstanding gates before any release claim

1. Independent acceptance of every card currently in `review`.
2. Triage of the two pre-existing `studio.spec.ts` failures.
3. Storybook catalog gate re-run on the integrated snapshot.
4. Third-party licence review / SBOM.
5. User approval of a revised release scope, or completion of D4, G1, G2, G3,
   G5, FreeDraw and video-wall work.
6. M4 physical gate: rig approval, hardware session, measurements, sign-off.

## Proposed revised release scope — AWAITING USER DECISION

A defensible release could cover: static GLB/glTF import with instancing,
ComfyUI text-to-image/clip generation against a user-run server, and the mapping
baseline (mesh warp, Bezier masks, named outputs, persistence, signal-domain
edge blending), with every item above listed as a known limit.

That is **a proposal, not an approved scope**, and it is materially narrower
than the original P0 text. The user decides whether to accept it, amend it, or
hold release until the deferred work lands.

## Deployment and rollback

No deployment is authorized by this audit. VideoBrain runs as a single web
service at `https://videohead.duckdns.org/videobrain/`; a second permanent
server must not be created.

- Deploy (only on explicit approval):
  `docker compose -f docker-compose.web.yml up -d --build videobrain-web`
  Production listens on `127.0.0.1:8936` with assets built for `/videobrain/`.
- Build order matters: application build first, then Storybook into
  `dist/storybook`, then `check:storybook-dist`.
- Rollback: redeploy the previous image. **No image digest has been recorded for
  the current known-good deployment**, so capture one before any deploy —
  otherwise rollback is not reliably available.
