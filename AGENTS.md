# VideoBrain agent guide

These instructions apply to the entire repository. A more deeply nested
`AGENTS.md`, if one is added later, may refine them for that subtree.

## Start with the existing contracts

Read the relevant source before changing behavior:

- `README.md` for the current product, commands, examples, and deployment flow.
- `docs/ARCHITECTURE.md` for runtime ownership, clocks, security, and resource
  limits.
- `docs/GRAPH_PROTOCOL_STRATEGY.md` for stable identities, compatibility,
  inspection, state boundaries, and the module-development gate.
- `docs/DESIGN_SYSTEM.md` for inline controls and Storybook organization.
- `docs/FUTURE_DEVELOPMENT.md` for priorities, unbuilt modules, I/O boundaries,
  and example-patch plans.
- `docs/MODEL_CONNECTORS.md` before changing model or network behavior.
- `.github/workflows/verify.yml` before CI or build verification work.

Do not maintain a second graph model in UI, Storybook, tests, or an adapter. The
production registry and compiler are the source of truth.

## Product and repository rules

- Use **VideoBrain** for the product and **Signal Graph** for its primary
  workspace.
- Retired product and workspace names from earlier exploration must not appear
  in source, comments, tests, stories, or documentation.
- Research other tools for architectural evidence, then express the result as a
  product-neutral contract. Do not copy their naming, layout, saved format, or
  implementation.
- Keep the default experience browser-native, local-first, useful without an
  account, and permission-free. Optional devices and services must extend that
  baseline rather than replace it.
- Preserve unrelated user changes in a dirty worktree. Do not use destructive
  Git commands or rewrite history unless the user explicitly requests it.
- Never commit credentials, generated `dist/`, Playwright output, local media,
  or runtime/device handles.

## Architecture invariants

- Projects are declarative `GraphDocument` data. The editor mutates project
  state; the compiler validates and plans it; runtimes consume plans; the
  renderer never edits the project.
- Connections are explicitly typed. Do not add hidden coercion between signal
  families merely to make an edge connect.
- Node kinds, parameter IDs, port IDs, and select-option values are serialized
  compatibility contracts. Public catalog port indexes are automation
  compatibility contracts. Labels may improve without changing those IDs or
  indexes.
- Append compatible optional ports rather than reordering existing ports. Any
  incompatible semantic change needs a migration decision.
- A parameter always retains its saved literal. A compatible connected signal
  may override the resolved runtime value; disconnecting restores the literal.
- Display is the current demand root. Only reachable upstream work should cook,
  and canvas position must never determine execution. A future output kind
  requires an explicit compiler/root-planning change, not just the `output`
  category label.
- Ordinary graph cycles remain invalid. Feedback, delay, smoothing, counters,
  and accumulation need an explicit previous-tick/state boundary with defined
  initialization, update order, pause, rewind/seek, reset, and disposal.
- Visual, audio, media, transport, wall, network, and show clocks are distinct.
  Do not present a visual-frame scalar as sample-accurate audio.
- Runtime costs must be bounded and inspectable. Keep operator pass, render
  target, and state metadata accurate when behavior changes.

## Definition of done for a node or module

A node is not complete after only adding a card or shader. Ship the smallest
coherent vertical slice below.

### 1. Define the contract

Before implementation, decide and document:

- library category, runtime domain, and signal family;
- stable kind, port IDs and order, required/optional inputs, and outputs;
- stable parameter IDs, labels, units, defaults, bounds, steps, and choices;
- disconnected-input fallback and parameter-versus-wire precedence;
- clock, evaluation trigger, deterministic behavior, and non-finite handling;
- state, initialization, pause, rewind/seek, reset, and cleanup behavior;
- browser capability, permission, adapter, and unavailable/fallback behavior;
- visual-pass, render-target, memory, and latency budget;
- compatibility/migration impact and at least one named teaching graph.

Use the research-informed practice in `docs/GRAPH_PROTOCOL_STRATEGY.md`. A
manual-derived graph MCP or read-only live inspection is high-value evidence
when available, but it is not a release gate and may not become a competing
registry. Arbitrary command-string or source-code execution is not a graph API.

### 2. Add graph and catalog support

- Add the serialized kind to `src/graph/types.ts`. Keep `NODE_KINDS` and the
  definitions exported by `src/graph/operators.ts` in the same order.
- Define title, summary, domain, category, ports, parameters, layout metadata,
  and execution cost once in `src/graph/operators.ts`.
- Current wires are exactly `frame.rgba`, `control.f32`, and `text.utf8`. Do not
  disguise a boolean, event, vector, audio buffer, table, or geometry signal as
  one of them; introduce a real type across validation, compiler, UI, catalog,
  runtime, and tests first.
- Reuse the ordered categories in `src/components/operatorCategories.ts`.
  Introduce a category only for a durable discovery boundary.
- Add icon/accent/short-label presentation in
  `src/components/operatorMeta.ts`.
- Update catalog and inspection tests. Advance `OPERATOR_CATALOG_VERSION` when
  the public catalog changes; do not bump `GRAPH_SCHEMA_VERSION` merely because
  old documents remain valid under an additive node kind.
- Export a helper through `src/graph/index.ts` or `src/engine/index.ts` when it
  is part of that layer's supported public surface.
- Keep validation, defaults, import/export, the editor, and future adapters
  derived from the registry.

### 3. Implement runtime behavior

- Prefer a small pure helper for control/timing math and test it directly.
- Add frame shaders to `src/engine/shaders.ts` and renderer bindings to
  `src/engine/WebGLRenderer.ts`; export reusable runtime helpers from
  `src/engine/index.ts`.
- Preserve transparent pixels through processors. Perform interpolation and
  compositing in premultiplied form where needed, then honor the current output
  alpha contract.
- Allocate, reset, resize, and dispose GPU/device resources deliberately.
- Verify parameter clamping and connected-control precedence at the runtime
  boundary, not only in the UI.
- Keep compiler reachability and resource accounting honest. Do not hide an
  expensive branch or stateful dependency from inspection.

### 4. Expose controls in the node

`src/components/NodeParameterControls.tsx` is metadata-driven:

- Every numeric parameter must appear as a labeled inline slider using the
  registry's exact `min`, `max`, and `step`.
- Enumerated parameters use the existing inline select; bounded text uses the
  existing text control.
- Add an XY surface only when the operator explicitly declares semantic
  two-axis layout metadata. Do not infer XY behavior from nearby parameters.
- Inline controls and Inspector controls must edit the same saved value and
  create sensible single undo gestures.
- Controls remain keyboard-operable, labeled, and isolated from canvas drag,
  pan, and wheel gestures.
- A live device node must include its explicit start/stop action and useful
  readiness or level feedback inside the node, not only in the Inspector.

### 5. Add a complete teaching preset

- Add stable preset metadata and a factory in `src/graph/presets.ts`.
- Add the new kind to `NODE_EXAMPLES` when it is taught by that preset.
- Every teaching node and every supporting branch must be reachable from one
  connected Display. Do not ship disconnected sample nodes.
- Prefer permission-free sources or a deterministic fallback. Explain the exact
  user action for camera, microphone, hardware, or network activation.
- Give nodes stable readable IDs and lay the graph out legibly at normal zoom.
- Name the learning goal and make the output visibly demonstrate it.
- Mark flashing imagery, permissions, network use, or other important behavior
  in starter metadata before the user loads it.
- Update preset counts and lists in tests, Help, README, and planning docs.

`src/graph/presets.test.ts` enforces valid presets, one Display path, complete
reachability, unique IDs, and a reachable bundled example for every node kind.

### 6. Use Storybook as part of implementation

Storybook is the catalog of production components, not a mock design system.

- Add the node to the relevant production-node story in
  `stories/operator-node.stories.tsx`. Use a standalone story when behavior or
  states merit focused treatment. Show inline controls and important selected,
  inactive, unavailable, boundary, or error states.
- Add the complete teaching graph to `stories/graph-editor.stories.tsx`.
- Put lower-level reusable UI in the existing `Foundations/`, `Controls/`,
  `Nodes/`, `Panels/`, or `Workspace/` hierarchy described in
  `docs/DESIGN_SYSTEM.md`.
- Import production components and styles. Story-only CSS may arrange a fixture
  but must not reimplement application appearance.
- Inject deterministic camera, microphone, model, or hardware lifecycle state.
  A story must never request a real permission or depend on a public service.
- Graph stories intentionally do not run the GPU renderer. Test rendered pixels
  in renderer/browser coverage instead.
- Include a short story description stating what the node controls and, where
  applicable, what a wire overrides and any permission or safety caveat.
- Update `scripts/check-storybook-artifact.mjs` only when a new story is a
  catalog-critical foundation whose stable presence should be enforced.

During development run `npm run storybook`. Before handoff run the static
catalog build and artifact check listed below.

### 7. Update user and architecture documentation

- Add a concise Help recipe and update `src/components/HelpDialog.test.tsx`.
- Update README feature/example guidance when behavior is user-visible.
- Update `docs/MVP.md` and `docs/ARCHITECTURE.md` when runtime or safety
  contracts change.
- Update `docs/GRAPH_PROTOCOL_STRATEGY.md` for typing, compatibility,
  inspection, state, or automation changes.
- Update `docs/FUTURE_DEVELOPMENT.md`: move an item to implemented only after
  code, education, and validation all ship. Record newly discovered gaps with
  primary sources and product-neutral conclusions.

### 8. Test at the right layers

At minimum, cover the layers affected by the node:

- registry shape, defaults, port requirements, ranges, and stable options;
- pure evaluation across boundaries, negative/large time, rewind, skipped
  ticks, invalid values, and seeded determinism where applicable;
- compiler validation, reachability, ordering, cycles, and resource limits;
- protocol catalog version, bindings, execution cost, and state metadata;
- shader contract, uniforms/textures, alpha behavior, reset, resize, and
  disposal for GPU nodes;
- inline controls, accessible names, gestures, Inspector synchronization, and
  device lifecycle UI;
- preset validity, all-node reachability, and `NODE_EXAMPLES` coverage;
- New patch discovery, inline preset values, visible output, Help guidance, and
  permission start controls in Playwright.

When shader behavior matters, also run a real headless WebGL visual check. A
fake GL unit harness proves bindings, not pixel correctness.

## Safety and capability rules

- Camera and microphone sessions begin only after an explicit user action.
  Stop tracks and pending work when a patch changes or a component unmounts.
- Device stories and CI use deterministic fakes. Physical hardware is never a
  test dependency.
- Keep API keys, sockets, decoded frames, and permission grants in session
  state. Never serialize or export them.
- Require HTTPS/WSS for credentials and non-loopback hosted connections. Keep
  browser-versus-gateway limitations explicit.
- A flashing processor needs conservative defaults, an immediate visible
  bypass, an explicit warning in its starter/story/Help, and separate warnings
  for externally driven timing and flashing source media. Do not describe a
  rate limit as a universal safety guarantee.
- Preserve hard graph, pixel, pass, target, message, and media limits. Fail with
  a useful diagnostic rather than silently exceeding them.

## Required validation before handoff

Use Node.js 22 or newer. When Node/npm is unavailable on the host, run the
application build and validation inside Docker using `Dockerfile.web` or
`docker-compose.web.yml`; do not stop at a host-tooling error. For a
release-sized node/module change, run all of these:

```sh
docker compose -f docker-compose.web.yml build --no-cache videobrain-web
```

Use a Node 22 container for checks that are not part of that production image
build, such as the full test suite or lint command.

```sh
npm run lint
npm run typecheck
npm test
npm run build:deploy
npm run check:storybook-dist
npm run test:e2e
git diff --check
```

Also scan the working tree for retired language. This split form keeps
the retired names themselves out of repository text:

```sh
legacy_a='touch'
legacy_b='designer'
legacy_c='signal'
legacy_d='garden'
rg --hidden -ni "${legacy_a}[[:space:]_-]*${legacy_b}|${legacy_c}[[:space:]_-]*${legacy_d}" . \
  --glob '!node_modules/**' --glob '!.git/**' --glob '!dist/**' \
  --glob '!storybook-static/**' --glob '!test-results/**'
```

No output and exit status 1 is the expected passing result. Inspect `git status`
before staging and make sure generated artifacts remain untracked.

## Commit and deployment discipline

- Do not commit, tag, push, publish, or change cloud infrastructure unless the
  user requested that scope.
- Before a requested commit, review the staged diff and keep it limited to the
  task. Use a descriptive imperative commit message.
- Bump package version and create an annotated tag only for an explicit release.
- A push to `main` invokes the provider-neutral verification workflow. It does
  not publish the site; publication is an explicit, separate operation.
