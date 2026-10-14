#!/usr/bin/env python3
"""Checks the VideoBrain MCP authoring tools against the generated pack.

Run inside the MCP container (or any environment with the repo mounted):

    python3 mcp/test_server.py

Exits non-zero on the first failure. Graph validation is exercised separately
because it shells out to Node; pass --skip-node to omit it.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402


FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        FAILURES.append(message)


def call(tool, /, **kwargs):
    """Invoke a FastMCP-decorated tool's underlying function."""
    target = getattr(tool, "fn", tool)
    return target(**kwargs)


def test_pack() -> None:
    print("knowledge pack")
    summary = call(server.get_catalog_summary)
    check(summary["operatorCount"] > 100, f"catalog has {summary['operatorCount']} operators")
    check(summary["exampleCount"] > 20, f"catalog has {summary['exampleCount']} examples")
    check(
        summary["kindsWithoutExample"] == [],
        f"every node kind appears in an example (missing: {summary['kindsWithoutExample']})",
    )
    check("frame.rgba" in summary["portTypes"], "port types include frame.rgba")
    check(summary["limits"]["graphNodes"] > 0, "node budget is reported")


def test_guide() -> None:
    print("authoring guide")
    guide = call(server.authoring_guide)
    check("display" in guide, "guide explains the display root")
    check("demand-rooted" in guide, "guide explains demand-rooted evaluation")
    check("validate_graph" in guide, "guide tells the agent to validate")


def test_search_and_describe() -> None:
    print("search and describe")
    results = call(server.search_operators, query="blur the image", limit=8)
    check(any(entry["kind"] == "blur" for entry in results), "search finds blur")

    audio = call(server.search_operators, query="audio reactive", limit=12)
    check(len(audio) > 0, f"search finds audio nodes ({len(audio)} hits)")

    warp = call(server.describe_operator, kind="warp")
    check(warp["kind"] == "warp", "describe returns the requested kind")
    check("amount" in warp["params"], "describe exposes parameters")
    check(
        any(port["id"] == "source" for port in warp["inputs"]),
        "describe exposes input ports",
    )
    check(len(warp["usedInExamples"]) > 0, "describe links to worked examples")

    try:
        call(server.describe_operator, kind="not-a-real-node")
        check(False, "unknown kind raises")
    except ValueError:
        check(True, "unknown kind raises")


def test_connections() -> None:
    print("connection suggestions")
    sources = call(server.suggest_sources, kind="warp", port_id="source")
    producers = sources["inputs"][0]["producers"]
    check(sources["inputs"][0]["type"] == "frame.rgba", "warp source takes frame.rgba")
    check(
        any(entry["kind"] == "plasma" for entry in producers),
        "plasma is offered as a frame source",
    )
    check(
        all(entry["kind"] != "time" for entry in producers),
        "a control-only node is not offered for a frame port",
    )

    amount = call(server.suggest_sources, kind="warp", port_id="amount")
    check(
        any(entry["kind"] == "oscillator" for entry in amount["inputs"][0]["producers"]),
        "oscillator is offered for a control port",
    )

    targets = call(server.suggest_targets, kind="plasma", port_id="frame")
    check(
        any(entry["kind"] == "display" for entry in targets["outputs"][0]["consumers"]),
        "display is offered as a frame consumer",
    )


def _populated_example() -> dict:
    """The first example that actually contains nodes.

    `blank` is a legitimate preset with zero nodes, so it is not a useful
    fixture for chain assertions.
    """
    for entry in call(server.list_examples):
        if entry["nodeCount"] > 0:
            return call(server.get_example, example_id=entry["id"])
    raise AssertionError("no populated example in the pack")


def test_examples() -> None:
    print("worked examples")
    examples = call(server.list_examples)
    check(all(entry["compiles"] for entry in examples), "every example compiles")

    document = _populated_example()["document"]
    check(document["schemaVersion"] == 1, "example document carries a schema version")
    check(len(document["nodes"]) > 0, "example document has nodes")

    try:
        call(server.get_example, example_id="nope")
        check(False, "unknown example raises")
    except ValueError:
        check(True, "unknown example raises")


def test_plan() -> None:
    print("plan_show")
    plan = call(
        server.plan_show,
        description="a slow pulsing plasma that reacts to the music beat",
    )
    suggested = plan["suggested"]
    check(len(suggested["generators"]) > 0, "plan suggests something to look at")
    check(len(suggested["controls"]) > 0, "plan suggests controls to animate it")
    check(
        any(entry["kind"] == "plasma" for entry in suggested["generators"]),
        "plan picks up the named generator",
    )
    check(
        any("display" in reminder for reminder in plan["reminders"]),
        "plan reminds the agent about the display root",
    )
    check(len(plan["closestExamples"]) > 0, "plan finds related examples")

    # A description that names no node must still yield a usable starting point.
    vague = call(server.plan_show, description="something calm and atmospheric")
    check(
        len(vague["suggested"]["generators"]) > 0,
        "a vague description still suggests a generator",
    )


def test_validation() -> None:
    print("graph validation (runs the real compiler)")
    document = _populated_example()["document"]
    good = call(server.validate_graph, document=document)
    check(good["ok"], f"a preset document validates ({good.get('issues')})")
    check(len(good["displayNodeIds"]) > 0, "validation reports display roots")

    bad = call(
        server.validate_graph,
        document={
            "schemaVersion": 1,
            "nodes": [
                {"id": "a", "kind": "plasma", "position": {"x": 0, "y": 0}, "params": {}},
                {"id": "b", "kind": "display", "position": {"x": 300, "y": 0}, "params": {}},
            ],
            "edges": [
                {
                    "id": "bad",
                    "source": {"nodeId": "a", "portId": "frame"},
                    "target": {"nodeId": "b", "portId": "nonexistent"},
                }
            ],
        },
    )
    check(not bad["ok"], "an illegal edge is rejected")
    check(len(bad["issues"]) > 0, f"the rejection explains why: {bad['issues'][:1]}")

    orphan = call(
        server.validate_graph,
        document={
            "schemaVersion": 1,
            "nodes": [
                {"id": "a", "kind": "plasma", "position": {"x": 0, "y": 0}, "params": {}}
            ],
            "edges": [],
        },
    )
    check(
        orphan.get("warnings") and any("display" in w for w in orphan["warnings"]),
        "a graph with no display node is flagged",
    )


def test_trigger_control_validation() -> None:
    print("trigger_control input validation")
    try:
        call(server.trigger_control, mapping_id="test", event_type="invalid")
        check(False, "invalid event_type raises")
    except ValueError as exc:
        check("press" in str(exc), f"invalid event_type error is clear: {exc}")

    try:
        call(server.trigger_control, mapping_id="test", event_type="value", value=1.5)
        check(False, "out-of-range value raises")
    except ValueError as exc:
        check("0 and 1" in str(exc), f"out-of-range value error is clear: {exc}")

    try:
        call(server.trigger_control, mapping_id="test", event_type="value", value=-0.1)
        check(False, "negative value raises")
    except ValueError:
        check(True, "negative value raises")


def test_set_parameter_validation() -> None:
    print("set_parameter schema validation (offline, no control server)")
    # Verify that _operator lookup and param validation work correctly.
    # We cannot call set_parameter itself without a live control server,
    # but we can test the operator/param lookup that it relies on.
    operator = server._operator("blur")
    params = operator.get("params", {})
    check("radius" in params, "blur has a radius parameter")
    check(params["radius"]["type"] == "number", "radius is a number")
    check(params["radius"]["min"] == 0, "radius min is 0")
    check(params["radius"]["max"] == 24, "radius max is 24")

    try:
        server._operator("not-a-real-node")
        check(False, "unknown kind raises in _operator")
    except ValueError:
        check(True, "unknown kind raises in _operator")

    # Verify the describe_operator tool exposes params for set_parameter usage.
    warp = call(server.describe_operator, kind="warp")
    check(
        "amount" in warp["params"],
        "describe_operator exposes params dict for set_parameter",
    )


def test_get_control_status_exists() -> None:
    print("get_control_status tool exists")
    check(hasattr(server.get_control_status, "fn") or callable(server.get_control_status),
          "get_control_status is a callable tool")


def main() -> int:
    skip_node = "--skip-node" in sys.argv
    test_pack()
    test_guide()
    test_search_and_describe()
    test_connections()
    test_examples()
    test_plan()
    if skip_node:
        print("graph validation: skipped (--skip-node)")
    else:
        test_validation()
    test_trigger_control_validation()
    test_set_parameter_validation()
    test_get_control_status_exists()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
