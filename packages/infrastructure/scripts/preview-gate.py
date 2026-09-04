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

`pulumi preview --json` (default, non-streaming mode) emits a single JSON
document shaped as `{"steps": [...], "diagnostics": [...], "changeSummary": ...}`
(see Pulumi's `display.PreviewDigest` / `ShowPreviewDigest` in
`pkg/backend/display/json.go`). Each step is a `display.PreviewStep` with
top-level `op` and `urn`; the resource `type` is nested under `newState.type`
(for create/update/replace) or `oldState.type` (for delete) -- there is no
top-level `type` field. Streaming JSONL output
(`PULUMI_ENABLE_STREAMING_JSON_PREVIEW`) is NOT used by `preview-gate.sh`; if it
were enabled, `json.loads` would fail and the gate exits non-zero (fail closed).

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
# delete, replace, create-replacement, delete-replaced, discard, import, ...)
# is stateful and rejected for D1/R2. This is an allowlist: anything not listed
# is rejected, so new op types added by future Pulumi versions fail closed.
NON_STATEFUL_OPS = {"same", "refresh", "read"}


def _step_type(step: dict) -> str:
	# `display.PreviewStep` has no top-level `type`; the resource type lives
	# inside `newState` (create/update/replace) or `oldState` (delete). Prefer
	# newState, fall back to oldState, then to a top-level `type` for
	# robustness against older/alternate shapes.
	new_state = step.get("newState")
	if isinstance(new_state, dict) and new_state.get("type"):
		return new_state["type"]
	old_state = step.get("oldState")
	if isinstance(old_state, dict) and old_state.get("type"):
		return old_state["type"]
	return step.get("type", "")


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
		rtype = _step_type(step)
		op = step.get("op", "")
		if rtype in D1_R2_TYPES and op not in NON_STATEFUL_OPS:
			violations.append(f"{op}: {rtype} ({step.get('urn', '')})")
	return violations


def _step_count(doc: object) -> int:
	if isinstance(doc, dict) and "steps" in doc:
		return len(doc["steps"])
	if isinstance(doc, list):
		return len(doc)
	return 0


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

	print(f"preview-gate: no D1/R2 stateful operations in {_step_count(doc)} preview steps")
	return 0


if __name__ == "__main__":
	sys.exit(main())
