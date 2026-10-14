# MCP Show-Time Tools: Implementation Plan

Status: proposed. This extends the existing MCP graph-authoring tools with
live performance control. The authoring surface (`plan_show`, `validate_graph`,
`apply_videobrain_graph`, etc.) is already strong; what is missing is the
ability for an agent to manipulate a running show without replacing the entire
graph.

## Decision: API, Browser Automation, or File-Based?

Three approaches exist. The right answer depends on what the user is doing.

| Approach | Good for | Limitation |
|---|---|---|
| **MCP tools over the control bridge** | Real-time agent co-piloting during a live VJ set; parameter tweaks, cue triggers, source switching at performance speed | Requires the control server running and a browser tab connected via WebSocket |
| **Browser automation** (Playwright/puppeteer) | An agent that can see and click the UI; good for exploratory use, screenshots, visual verification | Too slow for real-time control (~100ms+ per action); fragile against UI changes; cannot run headless for a production show |
| **File-based import/export** | Offline graph design; versioning looks as JSON files; sharing presets between users | No live parameter control; requires a manual import click or page reload to apply |

**Recommendation: all three, layered.** They serve different moments.

1. **File-based** is already done. `exportProject()` produces JSON;
   `importProject()` accepts it. An agent can author a graph JSON using the
   MCP's `plan_show` / `validate_graph` workflow, write it to disk, and the
   user imports it. No new code needed.

2. **Browser automation** is already possible. An agent with Playwright can
   open `https://videohead.duckdns.org/videobrain`, click Import, and upload a
   JSON file. Useful for demos and testing. No new code needed.

3. **MCP show-time tools** are the gap worth filling. They let an agent say
   "turn blur to 0.8" or "fire the strobe cue" at wire speed. This is the only
   approach that works during a live performance.

The implementation below covers (3) only, since (1) and (2) already work.

## Architecture

All new MCP tools in `mcp/server.py` forward to the existing control server
(`server/control-server.mjs`) over its HTTP API. The browser-side code
(`src/controlBridge.ts`, `src/control/controller.ts`, `src/control/actions.ts`)
already handles the execution. No browser-side changes are needed for Tasks 1-3.

```
Agent (MCP client)
  --> mcp/server.py (new tools)
    --> control-server.mjs (:8933 HTTP API)
      --> browser tab (WebSocket bridge)
        --> zustand store / controller actions
```

## Prerequisites

- The control server must be running: `docker compose -f docker-compose.control.yml up -d`
- `VIDEOBRAIN_CONTROL_API_KEY` must be set in both the MCP and control containers
- The browser tab must be connected to the control WebSocket (configured via
  `VITE_CONTROL_BRIDGE_URL` or the Controllers dialog)

These are existing requirements for `get_videobrain_graph` /
`apply_videobrain_graph`; no new infrastructure is needed.

## Task 1: `trigger_control` MCP tool

The companion-control API (`/api/control`) already accepts press/release/value
events addressed by mapping ID. Wrap it as an MCP tool.

**File:** `mcp/server.py`

**Add after `apply_videobrain_graph`:**

```python
@mcp.tool
def trigger_control(mapping_id: str, event_type: str, value: float = 0.0) -> dict:
    """Send a control event to a saved controller mapping in the live tab.

    This forwards to the Companion control API. The mapping must already exist
    in the browser's controller settings (created via the Controllers dialog).

    Args:
        mapping_id: The stable mapping ID (e.g. "next-source", "mix", "strobe").
        event_type: One of "press", "release", or "value".
        value: Normalized 0..1 value, required when event_type is "value".
    """
    if event_type not in ("press", "release", "value"):
        raise ValueError('event_type must be "press", "release", or "value".')
    if event_type == "value" and not (0.0 <= value <= 1.0):
        raise ValueError("value must be between 0 and 1.")
    import uuid
    event = {"type": event_type}
    if event_type == "value":
        event["value"] = value
    return _control_request("POST", "/api/control", {
        "requestId": str(uuid.uuid4()),
        "mappingId": mapping_id,
        "event": event,
    })
```

**Test:** Call `trigger_control("mix", "value", 0.5)` with a mapping named
"mix" saved in the browser. Verify the parameter changes in the live tab.
Verify that invalid mapping IDs return a 422 error from the browser.

**Verification:** Add a test case to `mcp/test_server.py` that mocks the
control API response and confirms the tool forwards correctly.

## Task 2: `get_control_status` MCP tool

The control server already has `GET /api/control/status`. Expose it so an agent
can check whether a browser tab is connected before trying to control anything.

**File:** `mcp/server.py`

```python
@mcp.tool
def get_control_status() -> dict:
    """Check whether a browser tab is connected to the control bridge.

    Returns {"connected": true/false}. Call this before trigger_control or
    apply_videobrain_graph to give a clear error message if no tab is open.
    """
    return _control_request("GET", "/api/control/status")
```

**Verification:** Call with and without a connected tab; confirm the boolean
response matches reality.

## Task 3: `set_parameter` via graph read-modify-write

There is no existing HTTP endpoint for setting a single parameter. The cheapest
correct implementation reads the current graph, patches one parameter, and
applies the result. This is atomic from the browser's perspective because
`importProject` is a single zustand transaction.

**File:** `mcp/server.py`

```python
@mcp.tool
def set_parameter(node_id: str, param_id: str, value: float | int | bool | str) -> dict:
    """Set one parameter on a node in the live graph.

    Reads the current graph, patches the parameter, validates, and applies.
    This is a read-modify-write cycle, not a dedicated endpoint, so it is
    safe but not suitable for high-frequency automation (use trigger_control
    with a saved mapping for that).

    Args:
        node_id: The node's id in the graph (e.g. "blur1").
        param_id: The parameter's id (e.g. "radius").
        value: The new value, matching the parameter's type and range.
    """
    response = _control_request("GET", "/api/graph")
    graph = response.get("graph")
    if not graph:
        raise RuntimeError("Could not read the live graph.")
    node = next((n for n in graph.get("nodes", []) if n["id"] == node_id), None)
    if not node:
        raise ValueError(f"No node with id '{node_id}' in the live graph.")
    operator = _operator(node["kind"])
    param_def = next((p for p in operator["params"] if p["id"] == param_id), None)
    if not param_def:
        raise ValueError(
            f"Node kind '{node['kind']}' has no parameter '{param_id}'. "
            f"Valid: {[p['id'] for p in operator['params']]}"
        )
    node.setdefault("params", {})[param_id] = value
    return _control_request("POST", "/api/graph", graph)
```

**Verification:** Read a live graph, call `set_parameter` on a known node,
read again, confirm the value changed. Confirm that invalid node/param IDs
produce clear errors from the MCP (not from the browser).

## Task 4: `list_controller_mappings` (browser-side change needed)

This requires a new message type in the control bridge to read the controller
state from the browser. The controller store is not currently exposed over the
WebSocket bridge.

**Deferred.** Tasks 1-3 cover the immediate need. An agent can ask the user
"what mappings do you have set up?" and the user can check the Controllers
dialog. If this becomes a real friction point, add a `request-mappings`
message type to `controlBridge.ts` and a `GET /api/mappings` endpoint to
`control-server.mjs`.

## Task 5: `list_presets` / `load_preset` MCP tools

The preset system is already in the MCP as `list_examples()` / `get_example()`.
Loading a preset is `apply_videobrain_graph(get_example(id)["document"])`. An
agent can already do this with existing tools.

**No new code needed.** Update the `authoring_guide` to mention this workflow
explicitly:

> To switch between looks during a performance, use `get_example(id)` to
> retrieve a verified graph, then `apply_videobrain_graph(document)` to load
> it into the live tab. This replaces the entire graph instantly.

## Summary of changes

| Task | Files changed | Browser changes? | Priority |
|---|---|---|---|
| 1. `trigger_control` | `mcp/server.py`, `mcp/test_server.py` | None | High |
| 2. `get_control_status` | `mcp/server.py` | None | High |
| 3. `set_parameter` | `mcp/server.py`, `mcp/test_server.py` | None | High |
| 4. `list_controller_mappings` | deferred | Would need `controlBridge.ts`, `control-server.mjs` | Low |
| 5. `list_presets` / `load_preset` | None (already works) | None | None |

## What an agent can do after Tasks 1-3

```
# Check the tab is connected
get_control_status()

# Design a show
plan_show("audio-reactive neon tunnel with beat-synced strobe")
get_example("neon-tunnel")
validate_graph(modified_graph)
apply_videobrain_graph(modified_graph)

# During the performance
set_parameter("blur1", "radius", 0.8)
set_parameter("warp1", "frequency", 3.0)
trigger_control("strobe", "press")
trigger_control("strobe", "release")
trigger_control("mix", "value", 0.75)

# Switch to a different look
apply_videobrain_graph(get_example("minimal-cells")["document"])
```

## What stays file-based

Graph design, preset sharing, and offline preparation remain file-based. An
agent can write a validated GraphDocument JSON to disk and the user can import
it from the toolbar. The MCP's `validate_graph` ensures it will compile before
the user ever sees it. No API needed for this path.