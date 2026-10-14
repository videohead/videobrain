#!/usr/bin/env python3
"""FastMCP server exposing VideoBrain Signal Graph authoring tools.

The authoring tools are backed by `mcp/graph-knowledge.json`, a pack generated
from the production operator registry, compiler and presets by
`scripts/export-graph-knowledge.mjs`. Graph validation shells out to
`scripts/inspect-graph.mjs`, which runs the real compiler.

Nothing here restates the graph rules in Python: this server is a view onto the
production model, so it cannot drift into being a second one.

Runs over streamable-http so it can be reached from a container or a local
MCP client. See videobrain/Dockerfile.mcp and docker-compose.mcp.yml.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastmcp import FastMCP

REPO_ROOT = Path(os.environ.get("VIDEOBRAIN_ROOT", "/app")).resolve()
KNOWLEDGE_PATH = Path(
    os.environ.get(
        "VIDEOBRAIN_KNOWLEDGE",
        str(Path(__file__).resolve().parent / "graph-knowledge.json"),
    )
)

# Only these npm scripts may be invoked; arbitrary script names are rejected
# to avoid turning this into a general command-execution tool.
ALLOWED_NPM_SCRIPTS = {"lint", "typecheck", "test", "build", "verify"}
NPM_TIMEOUT_SECONDS = 300
INSPECT_TIMEOUT_SECONDS = 180

# Reaches the sibling videobrain-control container over the shared compose
# network (see docker-compose.control.yml).
CONTROL_API_URL = os.environ.get("VIDEOBRAIN_CONTROL_URL", "http://videobrain-control:8933").rstrip("/")
CONTROL_API_KEY = os.environ.get("VIDEOBRAIN_CONTROL_API_KEY", "")
CONTROL_TIMEOUT_SECONDS = 10.0

mcp = FastMCP(
    "videobrain",
    instructions=(
        "Authoring and live-performance tools for the VideoBrain Signal Graph, "
        "a browser-native visual studio. To build a show from a plain-English "
        "description, start with authoring_guide(), then plan_show(description) "
        "for candidate node chains and worked examples. Use search_operators "
        "and describe_operator to pick exact node kinds and parameters, and "
        "suggest_sources/suggest_targets to find legal connections. ALWAYS "
        "call validate_graph before apply_videobrain_graph: it runs the real "
        "compiler and reports typed-port, cycle and budget errors. Use "
        "get_videobrain_graph and apply_videobrain_graph to read or replace "
        "the live GraphDocument in an open tab. For live performance control, "
        "use get_control_status to check tab connectivity, set_parameter to "
        "tweak a single value on a live node, and trigger_control to fire "
        "press/release/value events on saved controller mappings. Repository "
        "helpers (read_repo_file, list_docs, git_status, run_npm_script) "
        "remain available."
    ),
)


# ──────────────────────────────────────────────────────────────
# Graph knowledge pack
# ──────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _knowledge() -> dict[str, Any]:
    if not KNOWLEDGE_PATH.is_file():
        raise RuntimeError(
            f"Graph knowledge pack missing at {KNOWLEDGE_PATH}. "
            "Generate it with: node scripts/export-graph-knowledge.mjs"
        )
    return json.loads(KNOWLEDGE_PATH.read_text(encoding="utf-8"))


def _operators() -> list[dict[str, Any]]:
    return _knowledge()["operators"]


def _operator(kind: str) -> dict[str, Any]:
    for entry in _operators():
        if entry["kind"] == kind:
            return entry
    raise ValueError(f"Unknown node kind: {kind}")


def _summarize(entry: dict[str, Any]) -> dict[str, Any]:
    """Compact operator view: enough to choose a node, small enough to list."""
    return {
        "kind": entry["kind"],
        "title": entry["title"],
        "summary": entry["summary"],
        "domain": entry["domain"],
        "role": _role(entry),
        "category": entry["category"],
        "inputs": [f"{port['id']}:{port['type']}" for port in entry["inputs"]],
        "outputs": [f"{port['id']}:{port['type']}" for port in entry["outputs"]],
    }


def _role(entry: dict[str, Any]) -> str:
    """Classify a node by the role it plays when chaining a show.

    Derived from the real ports rather than assumed: the registry's `domain`
    is only audio/control/display/frame, so "generator" versus "effect" has to
    come from whether a frame node consumes a frame.
    """
    domain = entry["domain"]
    if domain == "display":
        return "display"
    if domain == "control":
        return "control"
    if domain == "audio":
        return "audio"
    if domain == "frame":
        takes_frame = any(port["type"] == "frame.rgba" for port in entry["inputs"])
        if not takes_frame:
            return "generator"
        frame_inputs = sum(
            1 for port in entry["inputs"] if port["type"] == "frame.rgba"
        )
        return "compositor" if frame_inputs > 1 else "effect"
    return domain


def _search_operators(query: str, limit: int) -> list[dict[str, Any]]:
    terms = [term for term in re.split(r"[^a-z0-9]+", query.lower()) if len(term) > 2]
    if not terms:
        return [_summarize(entry) for entry in _operators()[:limit]]

    scored: list[tuple[int, dict[str, Any]]] = []
    for entry in _operators():
        haystacks = (
            (entry["kind"].lower(), 5),
            (entry["title"].lower(), 4),
            (entry["category"].lower(), 2),
            (entry["summary"].lower(), 2),
            (
                " ".join(
                    port["label"].lower() for port in entry["inputs"] + entry["outputs"]
                ),
                1,
            ),
        )
        score = 0
        for term in terms:
            for text, weight in haystacks:
                if term in text:
                    score += weight
        if score > 0:
            scored.append((score, entry))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["kind"]))
    return [_summarize(entry) for _, entry in scored[:limit]]


@mcp.tool
def authoring_guide() -> str:
    """How the Signal Graph works and how to author a show. Read this first."""
    pack = _knowledge()
    limits = pack["limits"]
    return f"""# Authoring a VideoBrain show

Catalog version {pack['catalogVersion']}, graph schema {pack['graphSchemaVersion']},
{len(pack['operators'])} node kinds, {len(pack['examples'])} verified examples.

## The model

A graph is a GraphDocument: `{{ schemaVersion, nodes[], edges[] }}`.
- A node is `{{ id, kind, position: {{ x, y }}, params: {{}} }}`.
- An edge is `{{ id, source: {{ nodeId, portId }}, target: {{ nodeId, portId }} }}`.

Evaluation is **demand-rooted**: nothing runs unless it reaches a root. The
usual root is a `display` node, so **every visual chain must end at `display`**
or it will not render. Data chains root at data-output nodes, and signal-test
nodes are their own roots.

Ports are typed. An edge is legal only when the source output type matches the
target input type. Use `suggest_sources`/`suggest_targets` instead of guessing.
Port types: {', '.join(pack['portTypes'])}.

Cycles are rejected by the compiler. Feedback looks (Trails, Spiral Feedback)
are produced inside those nodes, not by wiring an output back to an input.

## Node roles

The registry's `domain` is only `frame`, `control`, `audio` or `display`, so
every tool here also reports a derived **role**, which is what you chain by:

- `generator` — a `frame` node with no frame input: `plasma`, `cells`,
  `noise`, `gradient`, `shape`, `text`, `solid`, `vectorShape`,
  `shaderSource`, plus inputs (`videoInput`, `networkVideo`, `file`) and
  generated media (`comfyGenerate`).
- `effect` — a `frame` node taking exactly one frame: `warp`, `blur`,
  `colorGrade`, `bloom`, `trails`, `projectorMapping` and others.
- `compositor` — a `frame` node taking several frames: `blend`, `composite`,
  `mask`, `crossfade`, `frameSwitch`.
- `control` — produces `control.f32` and friends: `time`, `beatClock`,
  `oscillator`, `pointer`, `xyPad`.
- `audio` — `audioLevel`, `audioSpectrum` and the audio chain.
- `display` — the render root.

## Typical shape of a show

1. A **generator** makes something to look at.
2. One or more **effects** shape it.
3. **Compositors** combine several chains.
4. **Controls** animate parameters. **This is what makes a show feel alive** —
   patch control outputs into effect inputs rather than leaving every value
   static.
5. The chain terminates at **display**.

A parameter can be set statically in `params` or driven by wiring a
`control.f32` edge into the matching optional input port.

## Budgets

At most {limits['graphNodes']} nodes and {limits['graphEdges']} edges;
{limits['reachableFrameNodes']} reachable frame nodes; {limits['gpuPasses']} GPU
passes and {limits['gpuTargets']} render targets. `validate_graph` reports the
actual cost, so check before applying a large graph.

## Multiple canvases

One GraphDocument can hold several independent chains, each ending at its own
`display` node. That is how to build a multi-canvas or multi-surface show.
Projection mapping onto real surfaces uses `projectorMapping` in the chain.

## Workflow

1. `plan_show(description)` — candidate kinds and the closest worked examples.
2. `get_example(id)` — copy a compiler-verified chain and adapt it.
3. `describe_operator(kind)` — exact port ids and parameter ranges.
4. `suggest_sources(kind, port_id)` — legal upstream nodes for a port.
5. `validate_graph(document)` — **always**, before applying.
6. `apply_videobrain_graph(document)` — replace the live graph.
"""


@mcp.tool
def get_catalog_summary() -> dict[str, Any]:
    """Catalog versions, port types, categories, budgets and node counts."""
    pack = _knowledge()
    by_domain: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for entry in pack["operators"]:
        by_domain[entry["domain"]] = by_domain.get(entry["domain"], 0) + 1
        by_category[entry["category"]] = by_category.get(entry["category"], 0) + 1
    return {
        "catalogVersion": pack["catalogVersion"],
        "graphSchemaVersion": pack["graphSchemaVersion"],
        "generatedAt": pack["generatedAt"],
        "operatorCount": len(pack["operators"]),
        "exampleCount": len(pack["examples"]),
        "portTypes": pack["portTypes"],
        "categories": pack["categories"],
        "limits": pack["limits"],
        "operatorsByDomain": by_domain,
        "operatorsByCategory": by_category,
        "kindsWithoutExample": pack["coverage"]["kindsWithoutExample"],
    }


@mcp.tool
def list_operators(domain: str = "", category: str = "") -> list[dict[str, Any]]:
    """List node kinds with their ports, optionally filtered by domain/category."""
    entries = _operators()
    if domain:
        entries = [entry for entry in entries if entry["domain"] == domain]
    if category:
        entries = [entry for entry in entries if entry["category"] == category]
    return [_summarize(entry) for entry in entries]


@mcp.tool
def search_operators(query: str, limit: int = 12) -> list[dict[str, Any]]:
    """Find node kinds by plain-English intent, ranked by relevance.

    Matches title, summary, kind, category and port labels, so a query like
    "audio reactive colour" or "blur the image" returns usable candidates.
    """
    return _search_operators(query, limit)


@mcp.tool
def describe_operator(kind: str) -> dict[str, Any]:
    """Full schema for one node kind: ports, parameters, ranges and defaults.

    Also reports which worked examples use this kind, so the node can be seen
    wired correctly rather than inferred from the schema alone.
    """
    entry = _operator(kind)
    used_in = [
        {"id": example["id"], "title": example["title"]}
        for example in _knowledge()["examples"]
        if kind in example["nodeKinds"]
    ]
    return {**entry, "usedInExamples": used_in[:8]}


@mcp.tool
def suggest_sources(kind: str, port_id: str = "") -> dict[str, Any]:
    """Node kinds and output ports that can legally feed an input on `kind`.

    Port compatibility is derived from the production connection validator.
    """
    entry = _operator(kind)
    compatibility = _knowledge()["portCompatibility"]
    inputs = entry["inputs"]
    if port_id:
        inputs = [port for port in inputs if port["id"] == port_id]
        if not inputs:
            raise ValueError(f'{kind} has no input port "{port_id}".')

    results = []
    for port in inputs:
        accepted = compatibility.get(port["type"], [port["type"]])
        producers = [
            {
                "kind": candidate["kind"],
                "title": candidate["title"],
                "portId": output["id"],
                "domain": candidate["domain"],
            }
            for candidate in _operators()
            for output in candidate["outputs"]
            if output["type"] in accepted
        ]
        results.append(
            {
                "inputPort": port["id"],
                "type": port["type"],
                "optional": port.get("optional", False),
                "acceptsTypes": accepted,
                "producers": producers,
            }
        )
    return {"kind": kind, "inputs": results}


@mcp.tool
def suggest_targets(kind: str, port_id: str = "") -> dict[str, Any]:
    """Node kinds and input ports that an output on `kind` can legally feed."""
    entry = _operator(kind)
    compatibility = _knowledge()["portCompatibility"]
    outputs = entry["outputs"]
    if port_id:
        outputs = [port for port in outputs if port["id"] == port_id]
        if not outputs:
            raise ValueError(f'{kind} has no output port "{port_id}".')

    results = []
    for port in outputs:
        consumers = [
            {
                "kind": candidate["kind"],
                "title": candidate["title"],
                "portId": target["id"],
                "domain": candidate["domain"],
                "optional": target.get("optional", False),
            }
            for candidate in _operators()
            for target in candidate["inputs"]
            if port["type"] in compatibility.get(target["type"], [target["type"]])
        ]
        results.append(
            {"outputPort": port["id"], "type": port["type"], "consumers": consumers}
        )
    return {"kind": kind, "outputs": results}


@mcp.tool
def list_examples() -> list[dict[str, Any]]:
    """List compiler-verified worked examples (the built-in graph presets)."""
    return [
        {
            "id": example["id"],
            "title": example["title"],
            "description": example["description"],
            "nodeKinds": example["nodeKinds"],
            "nodeCount": example["nodeCount"],
            "edgeCount": example["edgeCount"],
            "compiles": example["compiles"],
        }
        for example in _knowledge()["examples"]
    ]


@mcp.tool
def get_example(example_id: str) -> dict[str, Any]:
    """Get one worked example including its full, known-good GraphDocument.

    The document compiles as-is, so it is the safest starting point: copy it
    and adapt kinds and parameters rather than authoring from scratch.
    """
    for example in _knowledge()["examples"]:
        if example["id"] == example_id:
            return example
    raise ValueError(f"Unknown example: {example_id}")


@mcp.tool
def plan_show(description: str, limit: int = 8) -> dict[str, Any]:
    """Turn a plain-English visual description into candidate nodes and examples.

    Returns suggested node kinds per stage of a typical chain, the closest
    worked examples, and next steps. This is a starting point for authoring,
    not a finished graph: build the graph, then validate_graph it.
    """
    pack = _knowledge()
    matches = _search_operators(description, limit * 4)
    by_role: dict[str, list[dict[str, Any]]] = {}
    for entry in matches:
        by_role.setdefault(entry["role"], []).append(entry)

    # A show needs something to look at, so fall back to the default
    # generators when the description did not name one.
    if not by_role.get("generator"):
        by_role["generator"] = [
            _summarize(entry)
            for entry in _operators()
            if _role(entry) == "generator" and entry["category"] == "generators"
        ][:limit]

    terms = {
        term for term in re.split(r"[^a-z0-9]+", description.lower()) if len(term) > 2
    }
    scored_examples = []
    for example in pack["examples"]:
        text = (
            f"{example['title']} {example['description']} "
            f"{' '.join(example['nodeKinds'])}"
        ).lower()
        score = sum(1 for term in terms if term in text)
        if score:
            scored_examples.append((score, example))
    scored_examples.sort(key=lambda pair: (-pair[0], pair[1]["id"]))

    return {
        "description": description,
        "suggested": {
            "generators": by_role.get("generator", [])[:limit],
            "frameEffects": by_role.get("effect", [])[:limit],
            "compositors": by_role.get("compositor", [])[:limit],
            "controls": by_role.get("control", [])[:limit],
            "audio": by_role.get("audio", [])[:limit],
        },
        "closestExamples": [
            {
                "id": example["id"],
                "title": example["title"],
                "description": example["description"],
                "nodeKinds": example["nodeKinds"],
            }
            for _, example in scored_examples[:5]
        ],
        "reminders": [
            "Every visual chain must terminate at a `display` node or it will not render.",
            "Patch control.f32 outputs into effect inputs so the show animates.",
            "Use get_example(id) to copy a verified chain, then adapt it.",
            "Call validate_graph(document) before apply_videobrain_graph.",
        ],
        "nextSteps": [
            "get_example(<id>) for the closest match",
            "describe_operator(<kind>) for exact port ids and parameter ranges",
            "suggest_sources(<kind>, <port_id>) to find legal upstream nodes",
        ],
    }


@mcp.tool
def validate_graph(document: dict[str, Any]) -> dict[str, Any]:
    """Validate a GraphDocument with the PRODUCTION compiler.

    Reports schema errors, typed-port mismatches, cycles, unreachable nodes,
    execution order and GPU resource use. Call this before applying a graph;
    it is real compilation, not an approximation.
    """
    result = subprocess.run(
        ["node", "scripts/inspect-graph.mjs"],
        cwd=REPO_ROOT,
        input=json.dumps(document),
        capture_output=True,
        text=True,
        timeout=INSPECT_TIMEOUT_SECONDS,
    )
    if not result.stdout.strip():
        raise RuntimeError(
            f"Graph inspection produced no output. stderr: {result.stderr[:2000]}"
        )
    inspection = json.loads(result.stdout)

    summary: dict[str, Any] = {
        "ok": inspection.get("ok", False),
        "stage": inspection.get("stage"),
        "issues": inspection.get("issues", []),
        "nodeCount": inspection.get("nodeCount"),
        "edgeCount": inspection.get("edgeCount"),
        "displayNodeIds": inspection.get("displayNodeIds", []),
        "inactiveNodeIds": inspection.get("inactiveNodeIds", []),
        "executionOrder": inspection.get("executionOrder", []),
        "resources": inspection.get("resources", {}),
    }
    warnings: list[str] = []
    if summary["ok"] and not summary["displayNodeIds"]:
        warnings.append(
            "The graph compiles but has no display node, so nothing will render."
        )
    if summary["ok"] and summary["inactiveNodeIds"]:
        warnings.append(
            "Some nodes are unreachable from a root and will not be evaluated: "
            + ", ".join(summary["inactiveNodeIds"][:10])
        )
    if warnings:
        summary["warnings"] = warnings
    return summary


# ──────────────────────────────────────────────────────────────
# Repository helpers
# ──────────────────────────────────────────────────────────────


def _resolve_repo_path(relative_path: str) -> Path:
    candidate = (REPO_ROOT / relative_path).resolve()
    if candidate != REPO_ROOT and REPO_ROOT not in candidate.parents:
        raise ValueError(f"Path escapes repository root: {relative_path}")
    return candidate


@mcp.tool
def list_docs() -> list[dict[str, str]]:
    """List the repository design documents available to read_repo_file."""
    docs_root = REPO_ROOT / "docs"
    if not docs_root.is_dir():
        return []
    entries = []
    for path in sorted(docs_root.rglob("*.md")):
        heading = ""
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("# "):
                heading = line[2:].strip()
                break
        entries.append(
            {
                "path": path.relative_to(REPO_ROOT).as_posix(),
                "title": heading or path.stem,
            }
        )
    return entries


@mcp.tool
def read_repo_file(relative_path: str, max_bytes: int = 20000) -> str:
    """Read a UTF-8 text file from the repository, relative to the repo root."""
    path = _resolve_repo_path(relative_path)
    if not path.is_file():
        raise FileNotFoundError(relative_path)
    data = path.read_bytes()[:max_bytes]
    return data.decode("utf-8", errors="replace")


@mcp.tool
def git_status() -> str:
    """Return `git status --porcelain=v1` for the repository."""
    result = subprocess.run(
        ["git", "status", "--porcelain=v1"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result.stdout or result.stderr


@mcp.tool
def run_npm_script(script: str) -> str:
    """Run an allow-listed npm script (lint, typecheck, test, build, verify)."""
    if script not in ALLOWED_NPM_SCRIPTS:
        raise ValueError(f"Script not allowed: {script}. Allowed: {sorted(ALLOWED_NPM_SCRIPTS)}")
    result = subprocess.run(
        ["npm", "run", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=NPM_TIMEOUT_SECONDS,
    )
    output = f"exit_code={result.returncode}\n--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    return output


def _control_request(method: str, path: str, payload: dict | None = None) -> dict:
    if not CONTROL_API_KEY:
        raise RuntimeError("VIDEOBRAIN_CONTROL_API_KEY is not configured on the MCP server.")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{CONTROL_API_URL}{path}",
        data=body,
        method=method,
        headers={
            "X-Api-Key": CONTROL_API_KEY,
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=CONTROL_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Control API returned {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Control API request failed: {error.reason}") from error


@mcp.tool
def get_videobrain_graph() -> dict:
    """Get the live GraphDocument from an open VideoBrain tab via the control API."""
    return _control_request("GET", "/api/graph")


@mcp.tool
def apply_videobrain_graph(graph: dict) -> dict:
    """Replace the live GraphDocument in an open VideoBrain tab via the control API."""
    return _control_request("POST", "/api/graph", graph)


@mcp.tool
def get_control_status() -> dict:
    """Check whether a browser tab is connected to the control bridge.

    Returns {"connected": true/false}. Call this before trigger_control or
    apply_videobrain_graph to give a clear error instead of a connection
    failure.
    """
    return _control_request("GET", "/api/control/status")


@mcp.tool
def trigger_control(mapping_id: str, event_type: str, value: float = 0.0) -> dict:
    """Send a control event to a saved controller mapping in the live tab.

    The mapping must already exist in the browser's controller settings
    (created via the Controllers dialog or MIDI Learn). Use this for
    performance control: pressing buttons, releasing holds, and sending
    normalized parameter values.

    Args:
        mapping_id: The stable mapping ID (e.g. "next-source", "mix").
        event_type: One of "press", "release", or "value".
        value: Normalized 0..1 float, required when event_type is "value".
    """
    if event_type not in ("press", "release", "value"):
        raise ValueError('event_type must be "press", "release", or "value".')
    if event_type == "value" and not (0.0 <= value <= 1.0):
        raise ValueError("value must be between 0 and 1.")
    event: dict[str, Any] = {"type": event_type}
    if event_type == "value":
        event["value"] = value
    return _control_request(
        "POST",
        "/api/control",
        {
            "requestId": str(uuid.uuid4()),
            "mappingId": mapping_id,
            "event": event,
        },
    )


@mcp.tool
def set_parameter(node_id: str, param_id: str, value: float | int | bool | str) -> dict:
    """Set one parameter on a node in the live graph.

    Reads the current graph, validates the parameter against the operator
    schema, patches the value, and applies. This is a read-modify-write
    cycle so it is safe but not suitable for high-frequency automation (use
    trigger_control with a saved mapping for rapid parameter changes).

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
        raise ValueError(
            f"No node with id '{node_id}' in the live graph. "
            f"Available: {[n['id'] for n in graph.get('nodes', [])]}"
        )

    operator = _operator(node["kind"])
    params_schema = operator.get("params", {})
    if param_id not in params_schema:
        raise ValueError(
            f"Node kind '{node['kind']}' has no parameter '{param_id}'. "
            f"Valid: {list(params_schema.keys())}"
        )
    param_def = params_schema[param_id]

    if param_def["type"] == "number":
        if not isinstance(value, (int, float)):
            raise ValueError(f"Parameter '{param_id}' requires a number.")
        if value < param_def.get("min", float("-inf")):
            raise ValueError(
                f"Value {value} is below minimum {param_def['min']}."
            )
        if value > param_def.get("max", float("inf")):
            raise ValueError(
                f"Value {value} is above maximum {param_def['max']}."
            )
    elif param_def["type"] == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"Parameter '{param_id}' requires a boolean.")
    elif param_def["type"] == "select":
        options = [opt["value"] for opt in param_def.get("options", [])]
        if value not in options:
            raise ValueError(
                f"Parameter '{param_id}' must be one of {options}."
            )

    node.setdefault("params", {})[param_id] = value
    return _control_request("POST", "/api/graph", graph)


if __name__ == "__main__":
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if transport == "stdio":
        mcp.run()
    else:
        mcp.run(
            transport=transport,
            host=os.environ.get("MCP_HTTP_HOST", "127.0.0.1"),
            port=int(os.environ.get("MCP_HTTP_PORT", "8932")),
        )
