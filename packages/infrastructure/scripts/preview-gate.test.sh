#!/usr/bin/env bash
set -euo pipefail

# Unit tests for the D1/R2 source preview gate parser. Exercises
# preview-gate.py against fixture pulumi preview --json documents without
# needing Pulumi or Cloudflare credentials.

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
	'{"steps":[{"op":"update","type":"cloudflare:index/workersCustomDomain:WorkersCustomDomain","urn":"urn:pulumi:prod::web-domain"}]}'

# 3. A D1 create is rejected.
assert_exit 1 'D1 create rejected' \
	'{"steps":[{"op":"create","type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::d1"}]}'

# 4. An R2 replace is rejected.
assert_exit 1 'R2 replace rejected' \
	'{"steps":[{"op":"replace","type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}]}'

# 5. An R2 delete-replaced is rejected.
assert_exit 1 'R2 delete-replaced rejected' \
	'{"steps":[{"op":"delete-replaced","type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}]}'

# 6. A D1 delete is rejected.
assert_exit 1 'D1 delete rejected' \
	'{"steps":[{"op":"delete","type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::d1"}]}'

# 7. A D1 in-place update is rejected (D1/R2 must never change in automation).
assert_exit 1 'D1 update rejected' \
	'{"steps":[{"op":"update","type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::d1"}]}'

# 8. A D1 refresh step is allowed (not stateful).
assert_exit 0 'D1 refresh allowed' \
	'{"steps":[{"op":"refresh","type":"cloudflare:index/d1Database:D1Database","urn":"urn:pulumi:prod::d1"}]}'

# 9. Mixed steps: a domain update plus an R2 create is rejected.
assert_exit 1 'mixed steps with R2 create rejected' \
	'{"steps":[{"op":"update","type":"cloudflare:index/workersCustomDomain:WorkersCustomDomain","urn":"urn:pulumi:prod::web-domain"},{"op":"create","type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}]}'

# 10. Malformed JSON exits non-zero (fail closed).
assert_exit 2 'malformed JSON fails closed' 'not-json'

# 11. Flat-array step shape (older pulumi shape) is handled.
assert_exit 1 'flat-array R2 create rejected' \
	'[{"op":"create","type":"cloudflare:index/r2Bucket:R2Bucket","urn":"urn:pulumi:prod::r2"}]'

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
