#!/usr/bin/env bash
set -euo pipefail

# Unit tests for the D1/R2 source preview gate parser. Exercises
# preview-gate.py against fixture pulumi preview --json documents without
# needing Pulumi or Cloudflare credentials.
#
# Fixtures match the real `display.PreviewDigest` / `display.PreviewStep` shape
# emitted by `pulumi preview --json` (verified against Pulumi v3.258.0,
# pkg/backend/display/json.go): each step has top-level `op` and `urn`, with the
# resource `type` nested under `newState.type` (create/update/replace) or
# `oldState.type` (delete). There is no top-level `type` field on a step.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
GATE="$SCRIPT_DIR/preview-gate.py"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

PASS=0
FAIL=0

assert_exit() {
	local expected="$1"
	local label="$2"
	local input="$3"
	local got
	got="$(printf '%s' "$input" | python3 "$GATE" >/dev/null 2>&1; echo $?)"
	if [ "$got" -eq "$expected" ]; then
		PASS=$((PASS + 1))
		printf 'ok - %s (exit %s)\n' "$label" "$got"
	else
		FAIL=$((FAIL + 1))
		printf 'not ok - %s (expected exit %s, got %s)\n' "$label" "$expected" "$got" >&2
	fi
}

# 1. Empty preview (no steps) passes.
assert_exit 0 'empty preview passes' '{"steps":[]}'

# 2. A non-D1/R2 update (e.g. WorkersCustomDomain service change) passes.
assert_exit 0 'non-D1/R2 update passes' \
	'{"steps":[{"op":"update","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain","newState":{"type":"cloudflare:index/workersCustomDomain:WorkersCustomDomain","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain"}}]}'

# 3. A D1 create is rejected (type in newState).
assert_exit 1 'D1 create rejected' \
	'{"steps":[{"op":"create","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}}]}'

# 4. An R2 replace is rejected.
assert_exit 1 'R2 replace rejected' \
	'{"steps":[{"op":"replace","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx","newState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx"}}]}'

# 5. An R2 delete-replaced is rejected (type in oldState, no newState).
assert_exit 1 'R2 delete-replaced rejected' \
	'{"steps":[{"op":"delete-replaced","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx","oldState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx"}}]}'

# 6. A D1 delete is rejected (type in oldState only).
assert_exit 1 'D1 delete rejected' \
	'{"steps":[{"op":"delete","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","oldState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}}]}'

# 7. A D1 in-place update is rejected (D1/R2 must never change in automation).
assert_exit 1 'D1 update rejected' \
	'{"steps":[{"op":"update","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","oldState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"},"newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}}]}'

# 8. A D1 refresh step is allowed (not stateful).
assert_exit 0 'D1 refresh allowed' \
	'{"steps":[{"op":"refresh","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","oldState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"},"newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}}]}'

# 9. A D1 same step is allowed (no change).
assert_exit 0 'D1 same allowed' \
	'{"steps":[{"op":"same","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","oldState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"},"newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}}]}'

# 10. Mixed steps: a domain update plus an R2 create is rejected.
assert_exit 1 'mixed steps with R2 create rejected' \
	'{"steps":[{"op":"update","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain","newState":{"type":"cloudflare:index/workersCustomDomain:WorkersCustomDomain","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain"}},{"op":"create","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx","newState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx"}}]}'

# 11. Malformed JSON exits non-zero (fail closed).
assert_exit 2 'malformed JSON fails closed' 'not-json'

# 12. JSONL streaming input (PULUMI_ENABLE_STREAMING_JSON_PREVIEW) fails closed.
assert_exit 2 'JSONL stream fails closed' \
	'{"sequence":1,"timestamp":123,"resourcePreEvent":{"metadata":{"op":"create","type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}}}
{"sequence":2,"timestamp":124,"summaryEvent":{"resourceChanges":{"create":1}}}'

# 13. Full realistic 3.258.0 PreviewDigest fixture: a benign preview (same D1/R2
# plus a WorkersCustomDomain update) passes -- the gate must NOT false-positive
# on same-state D1/R2 steps that carry newState/oldState.
assert_exit 0 'realistic benign digest passes' \
	'{"config":{"cloudflare:apiToken":"[secret]"},"steps":[{"op":"same","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","oldState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","id":"abc","outputs":{"name":"dtx-web"}},"newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","id":"abc","outputs":{"name":"dtx-web"}}},{"op":"same","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx","oldState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx","id":"simfile-dtx"},"newState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx","id":"simfile-dtx"}},{"op":"update","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain","oldState":{"type":"cloudflare:index/workersCustomDomain:WorkersCustomDomain","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain"},"newState":{"type":"cloudflare:index/workersCustomDomain:WorkersCustomDomain","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::web-domain"},"diffReasons":["service"]}],"diagnostics":[],"changeSummary":{"same":2,"update":1,"create":0,"delete":0}}'

# 14. Full realistic 3.258.0 fixture with a source-introduced R2 create is
# rejected -- the original bug (type read from top-level, always "") would have
# let this through; the fix reads newState.type.
assert_exit 1 'realistic R2 create digest rejected' \
	'{"steps":[{"op":"same","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","oldState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"},"newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}},{"op":"create","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx-new","newState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::simfile-dtx-new","outputs":{"name":"simfile-dtx-new"}}}],"changeSummary":{"same":1,"create":1}}'

# 15. Legacy/alternate shape with top-level type still works (robustness).
assert_exit 1 'legacy top-level type R2 create rejected' \
	'{"steps":[{"op":"create","type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}]}'

# 16. Flat-array step shape (older pulumi shape) is handled.
assert_exit 1 'flat-array R2 create rejected' \
	'[{"op":"create","urn":"urn:pulumi:prod::r2","newState":{"type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}}]'

# 17. Unknown op type fails closed (allowlist semantics).
assert_exit 1 'unknown op on D1 fails closed' \
	'{"steps":[{"op":"some-future-op","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web","newState":{"type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtx-web"}}]}'

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
