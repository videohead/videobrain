#!/usr/bin/env python3
"""Basic FastMCP server exposing read-only VideoBrain repository tools.

Runs over streamable-http so it can be reached from a container or a local
MCP client. See videobrain/Dockerfile.mcp and docker-compose.mcp.yml.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from fastmcp import FastMCP

REPO_ROOT = Path(os.environ.get("VIDEOBRAIN_ROOT", "/app")).resolve()

# Only these npm scripts may be invoked; arbitrary script names are rejected
# to avoid turning this into a general command-execution tool.
ALLOWED_NPM_SCRIPTS = {"lint", "typecheck", "test", "build", "verify"}
NPM_TIMEOUT_SECONDS = 300

# Reaches the sibling videobrain-control container over the shared compose
# network (see docker-compose.control.yml).
CONTROL_API_URL = os.environ.get("VIDEOBRAIN_CONTROL_URL", "http://videobrain-control:8933").rstrip("/")
CONTROL_API_KEY = os.environ.get("VIDEOBRAIN_CONTROL_API_KEY", "")
CONTROL_TIMEOUT_SECONDS = 10.0

mcp = FastMCP(
    "videobrain",
    instructions=(
        "Read-only helpers for the VideoBrain Signal Graph editor. Use "
        "list_operators to find graph node kinds, read_repo_file to inspect "
        "source, git_status for the working tree state, and run_npm_script "
        "for lint/typecheck/test/build/verify. Use get_videobrain_graph and "
        "apply_videobrain_graph to read or replace the live GraphDocument in "
        "an open tab through the control API."
    ),
)


def _resolve_repo_path(relative_path: str) -> Path:
    candidate = (REPO_ROOT / relative_path).resolve()
    if candidate != REPO_ROOT and REPO_ROOT not in candidate.parents:
        raise ValueError(f"Path escapes repository root: {relative_path}")
    return candidate


@mcp.tool
def list_operators() -> list[str]:
    """List node kind identifiers declared in src/graph/operators.ts."""
    path = REPO_ROOT / "src" / "graph" / "operators.ts"
    if not path.is_file():
        return []
    kinds = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith("kind:"):
            kinds.append(stripped.removeprefix("kind:").strip().strip(",").strip('"\''))
    return sorted(set(kinds))


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
