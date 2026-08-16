#!/usr/bin/env python3
"""
check_webhook_collisions.py — Ruins Untold pipeline safety check.

Exports every workflow from the live n8n container and fails loudly if two
ACTIVE workflows register the same (httpMethod, path) webhook route. n8n
resolves that kind of collision silently at request time by routing to
whichever workflow happens to own it — there is no error, no warning, just
a request landing on the wrong workflow.

Why this exists (2026-08-13): v2 (production) and v3 (split-pipeline,
under test) both registered POST /webhook/ruins-untold/phase2. Activating
v3 to test it sent a live test request straight into v2's old deprecated
Media Placement Agent monolith instead — 13+ minutes of an unwanted Sonnet
call, no error, no indication anything was wrong until the n8n execution
log was read by hand. v3's path was corrected to a unique
/ruins-untold/phase2-v3, but nothing stopped this from happening once and
nothing stops some *other* future workflow from doing the same thing.

Run this BEFORE activating any workflow, and ideally as a standing check
before any live n8n test:

    python3 check_webhook_collisions.py

Exit codes:
    0 — no collisions among active workflows
    1 — collision(s) found (details printed)
    2 — could not reach the n8n container / export failed
"""

import json
import os
import subprocess
import sys
import tempfile

CONTAINER = os.environ.get("RU_N8N_CONTAINER", "n8n-n8n-1")


def docker_exec(*args):
    return subprocess.run(
        ["docker", "exec", CONTAINER, *args],
        capture_output=True, text=True, timeout=60,
    )


def main():
    with tempfile.TemporaryDirectory() as tmp_host:
        container_dir = "/tmp/webhook_collision_check"
        docker_exec("rm", "-rf", container_dir)
        docker_exec("mkdir", "-p", container_dir)

        result = docker_exec(
            "n8n", "export:workflow", "--all", "--separate",
            f"--output={container_dir}/",
        )
        if result.returncode != 0:
            print("ERROR: n8n export:workflow failed:")
            print(result.stdout)
            print(result.stderr)
            sys.exit(2)

        # Pull the exported files to the host via `docker cp` for parsing.
        cp = subprocess.run(
            ["docker", "cp", f"{CONTAINER}:{container_dir}", tmp_host + "/wf"],
            capture_output=True, text=True, timeout=60,
        )
        if cp.returncode != 0:
            print("ERROR: docker cp failed:", cp.stderr)
            sys.exit(2)

        wf_dir = os.path.join(tmp_host, "wf")
        files = [f for f in os.listdir(wf_dir) if f.endswith(".json")]
        if not files:
            print("ERROR: no workflow files exported — nothing to check.")
            sys.exit(2)

        # route key -> list of (workflow_name, workflow_id)
        routes = {}
        total_active = 0

        for fname in files:
            path = os.path.join(wf_dir, fname)
            try:
                with open(path) as fh:
                    wf = json.load(fh)
            except (json.JSONDecodeError, OSError) as e:
                print(f"WARNING: could not parse {fname}: {e}")
                continue

            if isinstance(wf, list):
                wf = wf[0] if wf else {}

            if not wf.get("active"):
                continue
            total_active += 1

            name = wf.get("name", "?")
            wf_id = wf.get("id", "?")

            for node in wf.get("nodes", []):
                if node.get("type") != "n8n-nodes-base.webhook":
                    continue
                params = node.get("parameters", {})
                method = params.get("httpMethod", "GET")
                webhook_path = params.get("path", "")
                key = (method, webhook_path)
                routes.setdefault(key, []).append((name, wf_id, node.get("name")))

        print(f"Checked {total_active} active workflow(s), "
              f"{sum(len(v) for v in routes.values())} webhook node(s).\n")

        collisions = {k: v for k, v in routes.items() if len(v) > 1}

        if not collisions:
            print("OK — no webhook route collisions among active workflows.")
            sys.exit(0)

        print("COLLISION(S) FOUND — these active workflows share a route:\n")
        for (method, webhook_path), owners in collisions.items():
            print(f"  {method} /webhook/{webhook_path}")
            for name, wf_id, node_name in owners:
                print(f"    - \"{name}\" (id={wf_id}, node=\"{node_name}\")")
            print()
        print("A request to this path will silently route to only one of "
              "these workflows. Deactivate all but the intended owner, or "
              "give the others a distinct path, before relying on this route.")
        sys.exit(1)


if __name__ == "__main__":
    main()
