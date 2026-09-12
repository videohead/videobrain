# VideoBrain Agent Instructions

VideoBrain is a browser-native visual signal studio. Its **Signal Graph**
combines typed `control.f32`, `text.utf8`, `frame.rgba`, and `audio.block`
paths with a multipass GPU (WebGL2) renderer and a browser audio runtime in
one static web application — no account, backend, or device permission needed
to open a working composition. It includes demand-rooted graph compilation
with cycle rejection, procedural GPU sources and effects, audio mixing/FFT/
trigger envelopes, transport and beat clocks, undo/redo, versioned autosave
with JSON import/export, and a Storybook component catalog.

## Tool execution rule

All tool calls that invoke `python`, `node`, `vite`, or `php` MUST run inside
Docker — never on the host. The host has no project runtimes installed.

- Repository scripts (dev server, Storybook, builds, verification) run via a
  bind-mounted Node container, e.g.
  `docker run --rm -v /opt/videobrain:/srv -w /srv node:22-alpine npm run build`
- Python tooling runs in the `videobrain-mcp` container or via
  `docker run --rm -v /opt/videobrain:/srv -w /srv python:3.12-alpine ...`
- Compose stacks live in `docker-compose.web.yml`, `docker-compose.mcp.yml`,
  and `docker-compose.control.yml`.

The repository-root `AGENTS.md` points here; this file is the primary agent
guide.

## Working guidance

- Read the existing contracts before changing behavior: `README.md`,
  `docs/ARCHITECTURE.md`, `docs/GRAPH_PROTOCOL_STRATEGY.md`,
  `docs/DESIGN_SYSTEM.md`, `docs/FUTURE_DEVELOPMENT.md`, and
  `docs/MODEL_CONNECTORS.md`.
- Do not maintain a second graph model in UI, Storybook, tests, or an adapter.
  The production registry and compiler are the source of truth.
- Use **VideoBrain** for the product and **Signal Graph** for its primary
  workspace; retired names must not appear in source, comments, tests,
  stories, or documentation.
- Keep the default experience browser-native, local-first, useful without an
  account, and permission-free.
- Preserve unrelated user changes in a dirty worktree; no destructive Git
  commands or history rewrites unless explicitly requested.
