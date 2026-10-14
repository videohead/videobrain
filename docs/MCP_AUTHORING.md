# VideoBrain MCP — Graph Authoring for Agents

The MCP server at `mcp/server.py` lets an agent author VideoBrain shows from a
plain-English description: find the right nodes, wire them legally, validate
with the real compiler, and apply the result to a live tab.

## Why it cannot drift

The repository rule is that the production registry and compiler are the single
source of truth, and no second graph model may exist in an adapter. This server
follows that rule literally:

- **Schema** comes from `mcp/graph-knowledge.json`, generated from
  `getOperatorCatalog()`, the preset factories and the connection validator by
  [export-graph-knowledge.mjs](../scripts/export-graph-knowledge.mjs).
- **Validation** shells out to [inspect-graph.mjs](../scripts/inspect-graph.mjs),
  which runs the production `parseGraphDocument` and `inspectGraph`. The MCP
  reports real compiler issues; it never approximates the rules in Python.
- **Drift is a test failure.** [mcpKnowledge.test.ts](../src/graph/mcpKnowledge.test.ts)
  asserts the pack matches the live catalog version, covers every registered
  node kind, and ships only examples that compile.

Regenerate after any operator change:

```sh
npm run build:mcp-knowledge
```

## What the pack contains

Generated from catalog version 24: 114 operators and 47 worked examples, with
**every node kind appearing in at least one compiling example**.

| Field | Purpose |
| --- | --- |
| `operators` | Full schema per node: ports with types and indexes, parameters with ranges, defaults and options, execution cost |
| `portCompatibility` | Which source port types may feed each target type, derived by asking the production connection validator |
| `examples` | Every built-in preset as a verified `GraphDocument`, with its compile result and node kinds |
| `limits` | Node, edge, frame, GPU pass and render target budgets |
| `coverage` | Node kinds that lack a worked example (currently none) |

## Tools

### Authoring

| Tool | Use |
| --- | --- |
| `authoring_guide()` | The graph model, node roles, budgets and the workflow. Read first. |
| `plan_show(description)` | Plain English to candidate nodes by role, plus the closest worked examples |
| `search_operators(query)` | Find nodes by intent, ranked |
| `describe_operator(kind)` | Exact ports, parameters, ranges and which examples use the node |
| `suggest_sources(kind, port_id)` | Legal upstream nodes for an input |
| `suggest_targets(kind, port_id)` | Legal downstream nodes for an output |
| `list_examples()` / `get_example(id)` | Verified chains to copy and adapt |
| `validate_graph(document)` | **Real compilation.** Call before applying. |
| `get_catalog_summary()` | Versions, port types, categories and budgets |

### Live control

| Tool | Use |
| --- | --- |
| `get_videobrain_graph()` | Read the open tab's GraphDocument |
| `apply_videobrain_graph(graph)` | Replace the open tab's GraphDocument |
| `get_control_status()` | Check whether a browser tab is connected (`{"connected": true/false}`) |
| `set_parameter(node_id, param_id, value)` | Set one parameter on a live node (read-modify-write; validates against the operator schema) |
| `trigger_control(mapping_id, event_type, value)` | Fire a press/release/value event on a saved controller mapping |

All live-control tools require `VIDEOBRAIN_CONTROL_API_KEY` and a connected
browser tab. `set_parameter` is a read-modify-write cycle suitable for agent
co-piloting; for high-frequency automation, use `trigger_control` with a saved
mapping instead.

### Repository

`list_docs()`, `read_repo_file(path)`, `git_status()`, and `run_npm_script()`
for the allow-listed scripts.

## Node roles

The registry's `domain` is only `frame`, `control`, `audio` or `display`, which
is too coarse for chaining. Every tool therefore reports a derived **role**,
computed from the node's actual ports:

| Role | Rule | Examples |
| --- | --- | --- |
| `generator` | `frame` node with no `frame.rgba` input | `plasma`, `noise`, `cells`, `gradient`, `text`, `videoInput`, `comfyGenerate` |
| `effect` | `frame` node with exactly one `frame.rgba` input | `warp`, `blur`, `colorGrade`, `bloom`, `projectorMapping` |
| `compositor` | `frame` node with several `frame.rgba` inputs | `blend`, `composite`, `mask`, `crossfade` |
| `control` | `control` domain | `time`, `oscillator`, `beatClock`, `pointer` |
| `audio` | `audio` domain | `audioLevel`, `audioSpectrum` |
| `display` | render root | `display` |

## The authoring loop

```
plan_show(description)
  → get_example(id)            copy a verified chain
  → describe_operator(kind)    exact port ids and ranges
  → suggest_sources(...)       legal connections
  → validate_graph(document)   REAL compiler; fix reported issues
  → apply_videobrain_graph()   only once it validates
```

`validate_graph` is what makes this reliable rather than hopeful. A guessed
port id fails immediately with a precise message, for example:

```
{"code": "target-port-missing",
 "message": "Edge \"bad\" references missing input \"nonexistent\" on node \"b\"."}
```

It also warns when a graph compiles but has no `display` node (nothing will
render) or leaves nodes unreachable from a root (they are never evaluated).

## The performance loop

Once a show is live, an agent can co-pilot the performance without rebuilding
the graph:

```
get_control_status()                        is the tab connected?
set_parameter("blur1", "radius", 12.0)      tweak a single value
trigger_control("strobe", "press")          fire a mapping
trigger_control("strobe", "release")        release the hold
trigger_control("mix", "value", 0.75)       send a normalized value
apply_videobrain_graph(other_graph)         switch to a different look
```

`set_parameter` validates against the operator schema before applying, so an
invalid node ID, param ID, or out-of-range value fails with a clear message.
For rapid automation (e.g. continuous fader control), prefer `trigger_control`
with a saved mapping; `set_parameter` does a full graph read-modify-write.

## Multiple canvases

One `GraphDocument` may contain several independent chains, each terminating at
its own `display` node. A worked two-canvas example, authored purely from tool
output and compiler-verified:

- `audioLevel` → `audioSpectrum`; its `bass` drives `warp.amount`
- `plasma` → `warp` → `display`
- `time` → `oscillator`; its `value` drives `colorGrade.saturation`
- `noise` → `colorGrade` → `display`

`validate_graph` reports two display roots, five visual passes and four render
targets, all inside budget.

## Verification

`mcp/test_server.py` exercises every authoring tool against the generated pack
and the real compiler, including negative cases (unknown kinds, illegal edges,
a graph with no display root):

```sh
docker run --rm -v "$PWD":/app -w /app -e VIDEOBRAIN_ROOT=/app \
  videobrain-mcp python3 mcp/test_server.py
```

## Limits

- `validate_graph` bundles the graph modules on each call, so the first call
  takes a few seconds. It is a correctness tool, not a hot path.
- The pack is a static snapshot. If the registry changes without
  `npm run build:mcp-knowledge`, the drift test fails — rerun it.
- `plan_show` ranks by keyword overlap. It narrows the search; it does not
  understand the description, and it never emits a finished graph.
- The MCP can apply a graph to a live tab. It does not render, capture output,
  or verify what the user actually sees.
