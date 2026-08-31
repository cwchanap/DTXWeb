#!/usr/bin/env bash
set -euo pipefail

# Fail-closed source preview gate for the recurring Pulumi workflow.
#
# Runs `pulumi preview --json` for a stack and rejects any D1/R2 stateful
# operation proposed by the checked-in program before `pulumi up` can apply it.
# The preceding `pulumi refresh --preview-only --expect-no-changes` only proves
# live provider state matches recorded Pulumi state; it says nothing about
# source-introduced changes. `pulumi/actions` runs `pulumi up --yes
# --skip-preview`, so without this gate a source change that creates a new
# D1/R2 resource can pass the drift gate and apply immediately. `protect: true`
# blocks D1/R2 delete/replace but not creates; this gate closes that gap and
# enforces the PR's "any D1/R2 create/replace/delete is a hard stop" invariant.
#
# Usage: preview-gate.sh <stack>

if [ "$#" -lt 1 ]; then
	printf 'usage: %s <stack>\n' "$0" >&2
	exit 2
fi

STACK="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# `pulumi preview` exits non-zero on preview failure; pipefail surfaces that
# through the pipe. `--suppress-outputs` avoids leaking stack outputs. We do
# NOT use `--expect-no-changes` here because legitimate non-D1/R2 changes
# (e.g. an alias -> permanent WorkersCustomDomain.service update) must be
# allowed to proceed to `pulumi up`; only D1/R2 stateful ops are rejected.
pulumi preview --json --suppress-outputs --stack "$STACK" | python3 "$SCRIPT_DIR/preview-gate.py"
