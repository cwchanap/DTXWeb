#!/usr/bin/env python3
"""Fail-closed source preview gate for the recurring Pulumi workflow.

Reads a `pulumi preview --json` document from stdin and exits non-zero if any
D1 or R2 resource has a stateful operation proposed by the checked-in program.

`protect: true` blocks D1/R2 delete/replace but does NOT block a
source-introduced create, and `pulumi/actions` runs `pulumi up --yes
--skip-preview`, so a source change that adds a new D1/R2 resource can pass the
live-drift refresh gate and apply immediately. This gate enforces the PR's
"any D1/R2 create, replacement, or delete is a hard stop" invariant before
`pulumi up` runs.

A D1/R2 step appears in `steps` only when the program proposes a change to it,
so any D1/R2 step that is not a pure refresh/read is rejected.
"""

import json
import sys

# Cloudflare resource types that own permanent data identity. Any proposed
# change to these in recurring automation is a hard stop.
D1_R2_TYPES = {
    "cloudflare:index/d1Database:D1Database",
    "cloudflare:index/r2Bucket:R2Bucket",
}

# Ops that do not mutate resource state. Everything else (create, update,
# delete, replace, create-replacement, delete-replaced, discard, ...) is
# stateful and rejected for D1/R2.
NON_STATEFUL_OPS = {"same", "refresh", "read"}


def find_violations(doc: object) -> list[str]:
    if isinstance(doc, dict) and "steps" in doc:
        steps = doc["steps"]
    elif isinstance(doc, list):
        steps = doc
    else:
        steps = []
    violations: list[str] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        rtype = step.get("type", "")
        op = step.get("op", "")
        if rtype in D1_R2_TYPES and op not in NON_STATEFUL_OPS:
            violations.append(f"{op}: {rtype} ({step.get('urn', '')})")
    return violations


def main() -> int:
    raw = sys.stdin.read()
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as err:
        print(f"preview-gate: could not parse pulumi preview JSON: {err}", file=sys.stderr)
        return 2

    violations = find_violations(doc)
    if violations:
        print(
            "preview-gate: D1/R2 stateful operation rejected before apply:",
            file=sys.stderr,
        )
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        return 1

    step_count = len(doc["steps"]) if isinstance(doc, dict) and "steps" in doc else len(doc) if isinstance(doc, list) else 0
    print(f"preview-gate: no D1/R2 stateful operations in {step_count} preview steps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
