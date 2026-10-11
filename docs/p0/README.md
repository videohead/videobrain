# VideoBrain P0 Agent Handoff

Version: 1.0. Date: 2026-10-11. Status: planning package; no tasks dispatched.

## Start here

This package turns the three P0 tracks in [Planned Development](../PLANNED_DEVELOPMENT.md)
into assignable work. It works with a human, a local coding agent, or a multiagent
executor using the host's LiteLLM/Metis tools. Markdown is the source of truth;
no framework, agent deployment, or MCP registration is installed by these files.

1. Read [AGENTS.md](../../AGENTS.md), the
   [repository instructions](../../.github/instructions/instructions.md), and
   [Current State](../CURRENT_STATE.md).
2. Read [Contracts](CONTRACTS.md) and the selected card in [Tasks](TASKS.md).
3. The coordinator claims an eligible card, records its source snapshot and exact
   writable paths, and supplies the assignment below to a worker.
4. The worker implements only that card, runs its checks, and returns evidence.
5. An independent reviewer checks it; the coordinator integrates and accepts it.

Start with **C0**, then **C1**, then **C2/C3**. **A1** is the first implementation
ticket; **D1** is the first 3D loader ticket. **O0** is the user's parallel router
investigation and does not block product development.

## Outcomes and scope

| Track | Proposed first usable baseline | Full P0 follow-through |
| --- | --- | --- |
| 3D import | D3: static GLB/glTF scenes, materials/textures, independent placement and duplication, lights/camera, save/reopen | D4/D5: other requested formats, animation policy, compatible GPU instance batches |
| Generators | G2: fixture-backed image/clip jobs and durable results; G3/G4: one hosted adapter and ComfyUI verified separately | G5: Scope live streaming and remaining named providers/modalities |
| Mapping | M3: mesh warp, editable masks, persisted named surfaces/outputs and clean presentation | M4/M5: physical overlap blending and 3D calibration |

These are staged proposals, not an approved reduction of the user's requested
formats, providers, or mapping features. C1 obtains scope approval. A baseline
can be accepted independently while full P0 remains incomplete. FreeDraw's first
interpretation (editable masks/boundaries versus painted content) is a C1 decision.
Full universal WebGPU replacement stays P3; WebGL2 remains production-supported.

## Dependency waves

| Wave | Eligible work after dependencies are accepted |
| --- | --- |
| 0 | C0 source snapshot; O0 router discovery independently |
| 1 | C1 milestone/scope decisions |
| 2 | C2 contracts and C3 fixtures/budget measurements in parallel |
| 3 | A1 asset storage, D1 loader, G1 job state machine, M1 surface geometry |
| 4 | A2 persistence/packaging; D2 scene integration; M2 editor; then G2/M3/D3 as their dependencies finish |
| 5 | I1 combined baseline, real provider gates, D4/D5 formats/instancing, M4 blending, M5 calibration |
| Release | R1 audits the coverage matrix and evidence; deployment remains a separate approval |

Task cards, rather than this illustrative wave table, define exact dependencies.
Limit parallel implementation to three workers initially. C2/C3 must agree on
concrete budgets before downstream runtime tasks become eligible.

## Assignment and concurrency

Roles are functional, not model names: coordinator/integrator, asset/3D worker,
generator worker, mapping worker, reviewer, and user/infra operator. Any suitable
agent can fill a role; models and tools must be verified before assignment.

- Only the coordinator edits task metadata and accepts work. Workers return a
  completion report; they do not self-accept or rewrite other cards.
- Each card's `scope` is a candidate ownership boundary. The assignment grants
  exact file paths. Names for new files are proposals; reuse existing modules
  when appropriate. Reading neighboring code is allowed; writing outside the
  assignment requires a coordinator-approved scope amendment.
- Shared files require an exclusive lease: graph types/model/compiler/registry/
  protocol/limits, projectStore/persistence, WebGLRenderer, PreviewPanel, App,
  package manifests/lockfile, global styles, and common story/test files.
- The coordinator may delegate a shared-file lease to one worker. Other workers
  supply integration patches against their own snapshots, not simultaneous writes
  to those files. A prompt is not a filesystem permission boundary; enforce
  isolation and tool permissions in the executor.
- Parallel workers need authorized isolated copies or worktrees, with separate
  node_modules, dist, test-results and temporary ports. They must include approved
  uncommitted baseline changes: HEAD alone is not necessarily the baseline.
- Without workspace isolation, use one writer at a time. Serialize shared GPU
  tests and application/catalog builds. A failed task must not revert user edits.
- No commits, branches/worktrees, live graph replacement, service restarts,
  deployment, provider billing or infrastructure changes are authorized by a
  card alone. Obtain the relevant approval first.

## Task state protocol

Cards in TASKS.md have one canonical metadata block. IDs never change. `depends_on`
is a comma-separated ID list or `none`. `scope` lists candidate paths relative to
the repository; paths marked shared need a lease. Owners/reviewers are `unassigned`
until the coordinator grants a lease.

States: `waiting`, `ready`, `running`, `blocked`, `review`, `accepted`, `failed`.

1. `waiting -> ready`: dependencies accepted and required decisions resolved.
2. `ready -> running`: owner, reviewer, snapshot, contract version, lease ID and
   expiry, exact paths, and execution budget recorded by coordinator.
3. `running -> review`: patch/artifact and reproducible evidence submitted.
4. `review -> accepted`: independent review and integration checks pass.
5. Any active task may become `blocked` or `failed`, with reason and checkpoint.
   Resumption requires explicit coordinator reassignment; an expired lease is
   not permission for a second worker to write over a still-running first worker.

Acceptance refers to the integrated source snapshot, not an unmerged worker copy.
Record status history and evidence under the card's Handoff section. Do not keep
a second editable status board in another file. An external scheduler may mirror
the ledger but must reconcile through the coordinator before writing back.

## Worker assignment template

```text
Project: VideoBrain P0 Baseline Program, handoff version 1.0
Task: <ID and TASKS.md heading>
Role / owner / independent reviewer: <identities>
Source snapshot: <base revision plus approved patch/untracked-file manifest hashes>
Dependencies: <accepted IDs and evidence>
Contract: <accepted CONTRACTS.md version/hash>
Lease: <ID, exact paths, shared-file leases, UTC expiry>
Workspace: <isolated root; host/container path mapping>
Tools: <verified allowlist; test commands and network destinations>
Budget: <wall time, model/tool-call/spend ceilings, stop conditions>
Required outcome: <card acceptance checklist>
Approvals: <scope decisions; live tests/spend only when explicitly granted>
Read AGENTS.md and repository instructions before acting.
Preserve existing changes. Use the production registry/compiler and test helpers.
Do not widen scope, deploy, alter router configuration, or invoke paid services.
If a dependency/contract is wrong, return a blocker with a proposed amendment.
Return the completion report below. Do not mark the task accepted.
```

```text
Task / owner / lease / source snapshot:
Outcome: review | blocked | failed
Patch or artifact location and hash:
Changed files and shared-file amendments:
Acceptance criteria: criterion -> test/evidence -> pass/fail/unverified
Commands: working directory, container/runtime version, exit status, artifact path
Resource measurements and test environment:
Compatibility, migration and security notes:
Known limitations / unresolved decisions / approvals still needed:
Resume checkpoint and next action:
Rollback: how to remove this task's changes without reverting others
Reviewer findings and coordinator integration/acceptance: pending
```

## Verification and release

Run the cheapest touched-behavior check after each substantive edit. Follow the
repository's Docker-only runtime rule. Consult configured container CLI settings
before execution; the following are the repository npm scripts, not host commands.

| Gate | Required evidence |
| --- | --- |
| Focused tests | Neighboring Vitest tests; malformed/over-budget inputs; stale async work; deletion/reset/recovery |
| Integration | `npm run verify`: lint, typecheck, all unit tests, application build |
| Browser | Focused Playwright tests using the configured pinned image; UI workflow, pixel assertions, desktop/mobile screenshots and honest visual review |
| Catalog | Application build first, then `npm run build:storybook -- --output-dir dist/storybook`, then `npm run check:storybook-dist` |
| External | Authorized provider smoke and physical projector tests, each reported separately from fixtures |
| Release | Coverage matrix, license/security review, recoverable project data and explicit deployment approval |

Starting evidence is historical: the prior work reported 734 passing unit tests
and 155 catalog entries. C0 re-establishes checks on the actual snapshot; counts
are not acceptance targets. The known three high-severity npm audit findings
require triage before a release-security claim, not blind dependency upgrades.

## LiteLLM and Metis handoff

The user identifies the host service at <https://videohead.duckdns.org/litellm>.
Discovery on 2026-10-11 found a reachable prefixed OpenAPI schema advertising
LiteLLM API 1.100.1, MCP routes, agent routes and workflow records. Public MCP and
agent hubs returned empty arrays. Private Metis configuration, authentication,
model aliases, executor behavior and repository access remain unverified.

Advertised route candidates relative to that base: `/mcp`,
`/toolset/{toolset_name}/mcp`, `/v1/mcp/tools`, `/mcp-rest/tools/list`,
`/v1/agents`, `/v1/models`, and `/v1/workflows/runs`. Verify transport, prefix,
permissions and schemas rather than treating these as tested client settings.
Workflow record APIs alone do not establish a task scheduler or coding-agent loop.
The in-repository MCP server is not the host Metis Router and is not this plan's
orchestration dependency.

O0 establishes a least-privilege executor profile. Separate coding-agent keys
from product-generation credentials. Never put secrets in this package, prompts,
artifacts or task reports. No broad host filesystem, unrestricted shell, Docker
socket or production deployment access for track workers. Use a constrained test
runner when container access is required. Discover tools read-only first; any
write smoke test runs only in an approved disposable workspace.

## References

- Internal: [Architecture](../ARCHITECTURE.md), [Graph Protocol](../GRAPH_PROTOCOL_STRATEGY.md),
  [3D](../SCENE_3D.md), [Model Connectors](../MODEL_CONNECTORS.md), [Design System](../DESIGN_SYSTEM.md).
- 3D: [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html),
  [Validator](https://github.com/KhronosGroup/glTF-Validator),
  [sample assets](https://github.com/KhronosGroup/glTF-Sample-Assets).
- Generation: [ComfyUI routes](https://docs.comfy.org/development/comfyui-server/comms_routes),
  [Atlas Cloud](https://www.atlascloud.ai/docs), [CometAPI](https://apidoc.cometapi.com/),
  [Scope](https://github.com/daydreamlive/scope).
- Mapping: [Window Management API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API),
  [OpenCV pose estimation](https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html),
  [edge blending](https://paulbourke.net/miscellaneous/edgeblend/).
- Inspiration, not selected dependencies: [ProjMap](https://github.com/RosaErick/projmap),
  [ProjectorVideoMappingWeb](https://github.com/vitalyu/ProjectorVideoMappingWeb),
  [Mapshroom](https://mapshroom.dev/). ProjMap declares AGPL-3.0-only; Scope's
  README declares a non-commercial license. Check exact code/model/fixture terms
  before reuse, service deployment or redistribution. Scope's README-linked API
  reference returned 404 during review; G5 must obtain a version-specific contract.