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

Use the existing production style and state contracts first. Add a shared
component when it represents an application-wide behavior or has multiple real
consumers. Add stories beside the corresponding catalog layer and include the
states a contributor needs to understand it without running a complete patch.

When adding a node parameter, define it once in the operator registry. The
Inspector, inline node controls, validation, defaults, persistence, and stories
should all consume that definition rather than maintaining separate ranges.
