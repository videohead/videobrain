# VideoBrain interface system

VideoBrain's interface system is the production React UI, graph metadata, and CSS
used by the browser studio. Storybook renders those same components and styles;
it is a catalog of the application rather than a parallel implementation.

## Layers

- **Foundations** are the color, type, spacing, radius, focus, and motion values in
  `src/styles.css`.
- **Graph contracts** live in `src/graph/operators.ts`. A parameter definition is
  the source of truth for its label, type, default, bounds, step, and choices.
- **Controls** include toolbar actions, lifecycle indicators, Inspector fields,
  and the metadata-driven `NodeParameterControls` surface.
- **Nodes** combine a header, typed ports, reachability, inline controls, and a
  compact identity footer inside React Flow.
- **Panels** compose controls into the node library, Inspector, command palette,
  Help dialog, preview, and complete graph workspace.

Node accents communicate identity. Signal colors communicate compatibility:
lime ports carry scalar controls, cyan ports carry frames, and coral identifies
the display boundary.

## Planned GPU capability indicators

During the WebGPU-only migration, capability metadata will come from the
operator registry rather than a separate UI-maintained list. A compact chip
icon on a node card or library entry may identify validated WebGPU rendering
or compute support. Give it an accessible name and a hover/focus tooltip;
the Inspector provides text labels, required device features, and resource
limits. Color alone must not communicate support or failure.

Keep three concerns separate: implemented backend support, the node's declared
requirements, and whether the current device satisfies them. Graph reachability
and actual execution retain their own status. Do not label existing WebGL-only
implementations as WebGPU-capable or imply automatic backend fallback. Controls
and data processing remain CPU-domain unless their implementation says otherwise.

When all visual nodes use WebGPU, show the common backend globally and use
per-node indicators for compute or unusual requirements to avoid repetitive
badges. Stories and inspection/catalog responses must expose the same metadata.
This section defines planned behavior; the indicator UI is not implemented yet.

## Inline parameter contract

Every numeric node parameter is available as a slider in the node itself. The
slider uses the exact `min`, `max`, and `step` declared by the operator registry
and reports a formatted live value. Enumerated settings use a compact native
select because they do not form a continuous range.

Inline controls must:

1. Update the same graph state as the Inspector.
2. Use native labeled inputs and remain keyboard-operable.
3. Prevent pointer interaction from dragging or panning the graph.
4. Group a continuous pointer or keyboard edit into one undo gesture.
5. Inherit the node accent for tracks, focus, and value readouts.

Every editable control remains visible on its node, while the Inspector provides
the most spacious editing and explanatory surface. Explicit two-axis operators can
render a direct manipulation pad with labeled keyboard interaction, live X/Y
readouts, and native axis sliders; ordinary parameter pairs must not be guessed into
a two-axis control.

## Story organization

Multiline Text and AI Chat fields use a local draft with an explicit Apply
button in both the node and Inspector. Blur does not commit or discard the
draft. Apply saves one undoable change; external saved-value changes (including
undo/redo) replace the draft. Connected text inputs still override saved literals
at runtime. Network Video endpoint settings also use Apply; other single-line
model fields retain immediate editing. Shader Source uses the same draft/Apply
contract with a resizable monospace GLSL editor and spellcheck disabled. Compile
errors appear on the monitor while the last valid program remains active.

```text
Foundations/  color, type, spacing, signal and node accents
Controls/     buttons, status, numeric sliders, enumerated values
Nodes/        every registered node kind and important graph states
Panels/       Inspector, library, command palette, and Help
Workspace/    representative connected patches in the real graph editor
```

Interactive components should cover their normal, selected or active, disabled,
boundary, unavailable, and error states when applicable. Stories import
production components. Story-only CSS may size or arrange fixtures, but must not
reimplement component appearance.

Camera, microphone, and future hardware stories inject deterministic lifecycle
state. They never request device permission. Graph stories do not start the GPU
renderer; visual output behavior belongs to focused renderer and browser tests.

## Development

Run the component catalog locally:

```sh
npm run storybook
```

Build its static HTML, CSS, and JavaScript:

```sh
npm run build:storybook
```

The complete deployment build places the catalog at `dist/storybook/`, served as
`/storybook/` in production. The static artifact requires no server-side React or
runtime Node process.

Before publishing, lint and typecheck the catalog, build it, verify
`index.html`, `iframe.html`, and `index.json`, and smoke-test the manager and
preview routes. Keep the application protected against external framing while
allowing Storybook's preview frame on the same origin.

## Adding a component or node

### Controller mappings

The Controllers toolbar action remains accessible on desktop and mobile and
opens a native modal dialog. It uses an explicit Armed checkbox, MIDI enable/
disable and Learn commands, connection status, and a password field for the
Companion bridge key. Credentials never appear in mapping rows or project data.
Mapping rows expose the stable ID used by Companion and any learned MIDI
device/channel/message binding.

Target and parameter menus come from the live graph and operator registry.
Numeric bounds, select options, and boolean controls reuse registry definitions;
the dialog must not maintain a second catalog. Mapping settings are browser-local,
while parameter actions use the same project state as inline controls and the
Inspector. See [Controllers](CONTROLLERS.md) for behavior and setup.

### Component conventions

Use the existing production style and state contracts first. Add a shared
component when it represents an application-wide behavior or has multiple real
consumers. Add stories beside the corresponding catalog layer and include the
states a contributor needs to understand it without running a complete patch.

When adding a node parameter, define it once in the operator registry. The
Inspector, inline node controls, validation, defaults, persistence, and stories
should all consume that definition rather than maintaining separate ranges.
