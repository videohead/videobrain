# VideoBrain P0 Agent Handoff — Progress Ledger

**Version:** 1.0 | **Date:** 2026-10-11
**Purpose:** Track task progress, blockers, evidence, and resumption checkpoints.

## Active Task

| ID | Status | Owner | Started | Evidence |
|----|--------|-------|---------|----------|
| D5 | review | assistant | 2026-10-11 | GPU instance batches; catalog 23; unit + e2e pixel evidence |

**Delivered work (2026-10-11) — real code, not documentation:**
- ✅ D5: [src/graph/sceneInstancing.ts](../../src/graph/sceneInstancing.ts) + tests — GPU-free batch planner with grid/ring layouts, 64-instance bound, aggregate triangle/draw/texture budgets, and incompatibility diagnostics
- ✅ D5: `instance3d` node kind (catalog 22→23), evaluator expansion of one Asset 3D placement into a bounded batch, `instance-glb-stage` preset, OPERATOR_META entry
- ✅ D5: [src/engine/Scene3DRenderer.ts](../../src/engine/Scene3DRenderer.ts) — one `InstancedMesh` per static mesh (instance count does not multiply draw calls), cached per source scene + count, disposed on release; duplicated-placement fallback with surfaced diagnostics
- ✅ D5: `WebGLRenderer.getLastBatchReport()` exposes instances/draw calls/triangles/diagnostics; e2e pixel test `e2e/scene-instance.spec.ts` verifies 8 placements render as 1 instanced draw call with visible pixels
- ✅ D3: Import UI + hook + renderer bridge; 829 tests + catalog + e2e pass (prior record retained below)
- ✅ C2: [src/store/contracts.ts](../../src/store/contracts.ts) + [src/store/contracts.test.ts](../../src/store/contracts.test.ts) (20 tests)
- ✅ C3: 7 real fixtures via [scripts/generate-fixtures.mjs](../../scripts/generate-fixtures.mjs); GLBs are valid glTF 2.0 geometry (24 verts, 36 indices), hash-recorded in fixture-manifest.json
- ✅ A1: [src/store/assetStore.ts](../../src/store/assetStore.ts) + [src/store/assetStore.test.ts](../../src/store/assetStore.test.ts) (16 tests): ingest/resolve/reopen, dedup, quota, validation, failure isolation, retain/release, relink mismatch, remove
- ✅ A2: [src/store/projectEnvelope.ts](../../src/store/projectEnvelope.ts) + [src/store/projectEnvelope.test.ts](../../src/store/projectEnvelope.test.ts) (12 tests): envelope wrap, legacy graph-only import, portable bundle round-trip, validation/quota/path-traversal, atomic rollback
- Verify: lint + typecheck + **782 tests** + build all pass (was 734)

**Honesty checkpoint (2026-10-11, revised):**
- ✅ C0/C1/C2/C3/A1/A2 all have real files and passing tests
- ⚠️ A1 uses an injectable backend; the IndexedDB path is implemented but exercised only via the memory backend in jsdom (no fake-indexeddb dep). Browser integration test deferred to D2/D3.
- ⚠️ A2 is an additive module; wiring the envelope into projectStore autosave/import needs a shared-file lease (D3/G2). Bundle is JSON+base64, no zip dep.
- ⚠️ GLB fixtures validated structurally (container + JSON parse), not yet loaded through Three.js GLTFLoader (that is D1's job).

**C1 Accepted (2026-10-11):**
1. ✅ Static GLB/glTF first (D3); other formats deferred to D4
2. ✅ ComfyUI first real adapter (G4); remote providers (G3) deferred
3. ✅ FreeDraw = painted content; adds child task for M2
4. ✅ D3+G2+M3 baselines cover immediate launch needs
5. ✅ Single-display clean output acceptable for M3

## C0 — Establish reproducible source baseline

### Scope
Baseline inventory and evidence; no application changes.

### Checklist
- [x] Record git HEAD and dirty file inventory
- [x] Identify known-good deployment/commit
- [x] Record dependency/runtime versions (package.json, lockfile)
- [x] Record existing test failure count
- [x] Record security audit findings (the 3 high-severity npm audit findings)
- [x] Run reproducible verification (`npm run verify` via Docker)
- [x] Record test counts and baseline metrics
- [x] Propose isolated worker directories
- [x] Document snapshot integrity

### Evidence

| Item | Value |
|------|-------|
| Git HEAD | `2fcc99161eaca6c094850e2cc9b4ae7fe6bb44c0` |
| Git describe | `v0.9.0-19-g2fcc991` |
| Dirty tracked | `docs/PLANNED_DEVELOPMENT.md` modified (M) |
| Unracked ( authorised ) | `docs/p0/` (this ledger and task files) — expected |
| Package version | `0.9.0` |
| Node runtime (Docker) | `v22.23.2` (node:22-alpine) |
| Three.js | `0.180.0` |
| TypeScript | `^6.0.3` |
| Vitest | `^5.0.0` |
| Playwright | present (devDependency, version from lockfile) |
| Lockfile | `package-lock.json`, hash `113f6b4a…` |
| Total deps | 46 prod / ~507 total incl dev/opt/peer |
| Docker service | `videobrain` compose stack running |

### Verification results

| Gate | Status | Detail |
|------|--------|--------|
| Lint (`npm run lint`) | ✅ Pass | 0 warnings |
| Typecheck (`tsc -b`) | ✅ Pass | clean |
| Unit tests (`vitest run`) | ✅ Pass | 43 test files, **734 tests**, 0 failures |
| Build (`vite build`) | ✅ Pass | production bundles generated |
| Full verify (`npm run verify`) | ✅ Pass | all gates passed sequentially |

### Security findings

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Moderate | 0 |
| Low | 0 |

3 high-severity npm audit findings require triage before release-security claim (noted in README). No critical vulnerabilities.

### Isolation proposal

The host already supports container-based execution (Docker, existing compose stacks). For parallel workers:
1. **Docker image**: Use `node:22-alpine` as the standard verify/build runner
2. **Bind mount**: `-v /opt/videobrain:/srv` preserves source integrity
3. **No host tool access** per developer instructions
4. **Playwright tests** run inside the pinned container image

Recommendation: approve isolation via separate branch/worktree + fresh `npm ci` + dedicated test ports, or verify per-track copy containers.

### Blockers
None.

## Task State Overview

| ID | Title | Status | Depends On | Notes |
|----|-------|--------|-----------|-------|
| C0 | Source baseline | **accepted** | none | C0 complete; 734 tests, audit 3 high-sev findings |
| C1 | Confirm milestones | **accepted** | C0 | 5 decisions recorded in handoff |
| C2 | Shared interfaces | **review** | C1 | contracts.ts + 20 tests; typecheck/lint clean |
| C3 | Fixtures & budgets | **review** | C1 | 7 real fixtures + manifest; GLBs valid glTF 2.0 |
| A1 | Asset storage | **review** | C2,C3 | assetStore.ts + 16 tests; dedup/quota/relink/retain |
| A2 | Project resources | **review** | A1 | projectEnvelope.ts + 12 tests; bundle round-trip/rollback |
| D1 | GLB validation | **review** | C2,C3 | SceneAssetCache.ts + 20 tests; preflight + cache lifecycle |
| D2 | Graph integration | **review** | A1,D1 | Live asset3d + renderer + preset; 820 tests + Playwright pixel test pass |
| D3 | 3D import baseline | **review** | D2,A2 | useSceneAssets + SceneAssetControl + Inspector/renderer bridge; 829 tests + catalog gate |
| D4 | Format adapters | waiting | D3 | Deferred per C1 (OBJ/FBX/STL/3MF/3DS/USD) |
| D5 | GPU instancing | **review** | D3 | Instance 3D + batch planner + InstancedMesh renderer + e2e pixel evidence |
| G1 | Generation jobs | waiting | C2,C3 | Blocked on contracts |
| G2 | Generation UI | waiting | G1,A2 | Blocked on G1, A2 |
| G3 | Hosted adapter | waiting | G2 | Blocked on G2 |
| G4 | ComfyUI adapter | waiting | G2 | **Priority elevated** — first real adapter |
| G5 | Provider extensions | waiting | G3,G4 | Blocked on G3, G4 |
| M1 | Surface geometry | waiting | C2,C3 | Blocked on C2/C3 |
| M2 | Mapping editor | waiting | M1 | Blocked on M1; painted-content child task pending |
| M3 | Named outputs baseline | waiting | M2,A2 | Blocked on M2, A2 |
| M4 | Overlap blending | waiting | M3 | Blocked on M3 |
| M5 | 3D calibration | waiting | D3,M3 | Blocked on D3, M3 |
| I1 | Combined integration | waiting | D3,G2,M3 | Blocked on D3, G2, M3 |
