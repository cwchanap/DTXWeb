#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DETECTOR="$SCRIPT_DIR/ci-affected-scope.sh"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ci-affected-scope.XXXXXX")"
REAL_GIT="$(command -v git)"
ORIGINAL_PATH="$PATH"

cleanup() {
	rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

assert_equals() {
	local expected="$1"
	local actual="$2"
	local description="$3"

	if [[ "$actual" != "$expected" ]]; then
		fail "$description (expected '$expected', got '$actual')"
	fi
}

create_fake_bunx() {
	local fake_bunx="$1"

	cat >"$fake_bunx" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 4 || "$1" != "turbo@2.10.9" || "$2" != "ls" || "$3" != "--affected" || "$4" != "--output=json" ]]; then
	echo "fake bunx received an unexpected command: $*" >&2
	exit 91
fi

if [[ "${FAKE_BUNX_FAIL:-false}" == "true" ]]; then
	echo "fake turbo failed" >&2
	exit 92
fi

if [[ -n "${FAKE_BUNX_EXPECTED_CHANGED_PATH:-}" ]]; then
	actual_changed_paths="$("$REAL_GIT" diff --name-only --merge-base "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD")"
	if [[ "$actual_changed_paths" != "$FAKE_BUNX_EXPECTED_CHANGED_PATH" ]]; then
		echo "merge-base changed paths were unexpected: $actual_changed_paths" >&2
		exit 93
	fi
fi

cat "$FAKE_TURBO_FIXTURE"
EOF
	chmod +x "$fake_bunx"
}

create_fake_git() {
	local fake_git="$1"

	cat >"$fake_git" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ge 1 && "$1" == "diff" ]]; then
	if [[ "$#" -ne 5 || "$1" != "diff" || "$2" != "--name-only" || "$3" != "--merge-base" || "$4" != "$TURBO_SCM_BASE" || "$5" != "$TURBO_SCM_HEAD" ]]; then
		echo "detector did not use the required merge-base diff command: $*" >&2
		exit 94
	fi

	actual_changed_paths="$("$REAL_GIT" "$@")"
	if [[ -n "${FAKE_GIT_EXPECTED_CHANGED_PATH:-}" && "$actual_changed_paths" != "$FAKE_GIT_EXPECTED_CHANGED_PATH" ]]; then
		echo "merge-base changed paths were unexpected: $actual_changed_paths" >&2
		exit 95
	fi
fi

exec "$REAL_GIT" "$@"
EOF
	chmod +x "$fake_git"
}

create_repo() {
	local repo="$1"
	local change_path="$2"
	local change_contents="$3"

	mkdir -p "$(dirname -- "$repo/$change_path")" "$repo/bin"
	"$REAL_GIT" -C "$repo" init -q
	"$REAL_GIT" -C "$repo" config user.email ci-affected-scope@example.invalid
	"$REAL_GIT" -C "$repo" config user.name ci-affected-scope-test
	printf 'base\n' >"$repo/README.md"
	"$REAL_GIT" -C "$repo" add README.md
	"$REAL_GIT" -C "$repo" commit -q -m base
	"$REAL_GIT" -C "$repo" branch -M main
	"$REAL_GIT" -C "$repo" switch -q -c feature
	printf '%s\n' "$change_contents" >"$repo/$change_path"
	"$REAL_GIT" -C "$repo" add "$change_path"
	"$REAL_GIT" -C "$repo" commit -q -m change

	create_fake_bunx "$repo/bin/bunx"
	create_fake_git "$repo/bin/git"
}

run_detector() {
	local repo="$1"
	local mode="$2"
	local fixture="$3"
	local base="$4"
	local head="$5"
	local stderr_file="$repo/stderr.log"

	(
		cd "$repo"
		PATH="$repo/bin:$ORIGINAL_PATH" \
		REAL_GIT="$REAL_GIT" \
		FAKE_TURBO_FIXTURE="$FIXTURES_DIR/$fixture" \
		TURBO_SCM_BASE="$base" \
		TURBO_SCM_HEAD="$head" \
		"$DETECTOR" "$mode" 2>"$stderr_file"
	)
}

run_expected() {
	local test_name="$1"
	local mode="$2"
	local fixture="$3"
	local expected="$4"
	local change_path="$5"
	local change_contents="$6"
	local repo="$TEST_ROOT/$test_name"

	create_repo "$repo" "$change_path" "$change_contents"
	local output
	output="$(run_detector "$repo" "$mode" "$fixture" main feature)" || fail "$test_name unexpectedly failed: $(<"$repo/stderr.log")"
	assert_equals "$expected" "$output" "$test_name"
	echo "PASS: $test_name"
}

run_expected web-unit unit turbo-web.json true packages/dtx-web/src/change.ts web

run_expected empty-unit unit turbo-empty.json false docs/change.md docs
run_expected empty-lint lint turbo-empty.json false docs/change.md docs

run_expected e2e-only-unit unit turbo-e2e-web.json false packages/e2e-web/tests/change.ts e2e
run_expected e2e-only-lint lint turbo-e2e-web.json true packages/e2e-web/tests/change.ts e2e

run_expected tsconfig-global-invalidation unit turbo-tsconfig.json true tsconfig.base.json tsconfig
run_expected tsconfig-global-invalidation-lint lint turbo-tsconfig.json true tsconfig.base.json tsconfig

malformed_repo="$TEST_ROOT/malformed-json"
create_repo "$malformed_repo" packages/dtx-web/src/change.ts web
printf '{ malformed json\n' >"$TEST_ROOT/malformed-json.json"
if (cd "$malformed_repo" && PATH="$malformed_repo/bin:$ORIGINAL_PATH" REAL_GIT="$REAL_GIT" FAKE_TURBO_FIXTURE="$TEST_ROOT/malformed-json.json" TURBO_SCM_BASE=main TURBO_SCM_HEAD=feature "$DETECTOR" unit >/dev/null 2>"$malformed_repo/stderr.log"); then
	fail 'malformed JSON unexpectedly passed'
fi
echo 'PASS: malformed JSON fails'

turbo_failure_repo="$TEST_ROOT/turbo-failure"
create_repo "$turbo_failure_repo" packages/dtx-web/src/change.ts web
if (cd "$turbo_failure_repo" && PATH="$turbo_failure_repo/bin:$ORIGINAL_PATH" REAL_GIT="$REAL_GIT" FAKE_TURBO_FIXTURE="$FIXTURES_DIR/turbo-web.json" FAKE_BUNX_FAIL=true TURBO_SCM_BASE=main TURBO_SCM_HEAD=feature "$DETECTOR" unit >/dev/null 2>"$turbo_failure_repo/stderr.log"); then
	fail 'Turbo failure unexpectedly passed'
fi
echo 'PASS: Turbo failure fails'

unknown_repo="$TEST_ROOT/unknown-package"
create_repo "$unknown_repo" packages/unknown/src/change.ts unknown
printf '%s\n' '{"packageManager":"bun","packages":{"count":1,"items":[{"name":"future-package","path":"packages/unknown"}]}}' >"$TEST_ROOT/unknown-package.json"
if (cd "$unknown_repo" && PATH="$unknown_repo/bin:$ORIGINAL_PATH" REAL_GIT="$REAL_GIT" FAKE_TURBO_FIXTURE="$TEST_ROOT/unknown-package.json" TURBO_SCM_BASE=main TURBO_SCM_HEAD=feature "$DETECTOR" unit >/dev/null 2>"$unknown_repo/stderr.log"); then
	fail 'unknown package unexpectedly passed'
fi
echo 'PASS: unknown package fails closed'

invalid_refs_repo="$TEST_ROOT/invalid-refs"
create_repo "$invalid_refs_repo" packages/dtx-web/src/change.ts web
if run_detector "$invalid_refs_repo" unit turbo-web.json missing-ref feature >/dev/null; then
	fail 'invalid refs unexpectedly passed'
fi
echo 'PASS: invalid refs fail'

merge_base_repo="$TEST_ROOT/merge-base"
create_repo "$merge_base_repo" packages/dtx-web/src/change.ts web
"$REAL_GIT" -C "$merge_base_repo" switch -q main
mkdir -p "$merge_base_repo/packages/dtx-api/src"
printf 'base-only\n' >"$merge_base_repo/packages/dtx-api/src/base-only.ts"
"$REAL_GIT" -C "$merge_base_repo" add packages/dtx-api/src/base-only.ts
"$REAL_GIT" -C "$merge_base_repo" commit -q -m 'unrelated base change'
"$REAL_GIT" -C "$merge_base_repo" switch -q feature
expected_feature_path='packages/dtx-web/src/change.ts'
if output="$(cd "$merge_base_repo" && PATH="$merge_base_repo/bin:$ORIGINAL_PATH" REAL_GIT="$REAL_GIT" FAKE_TURBO_FIXTURE="$FIXTURES_DIR/turbo-web.json" FAKE_GIT_EXPECTED_CHANGED_PATH="$expected_feature_path" FAKE_BUNX_EXPECTED_CHANGED_PATH="$expected_feature_path" TURBO_SCM_BASE=main TURBO_SCM_HEAD=feature "$DETECTOR" unit 2>"$merge_base_repo/stderr.log")"; then
	assert_equals true "$output" 'merge-base comparison'
else
	fail "merge-base comparison failed: $(<"$merge_base_repo/stderr.log")"
fi
echo 'PASS: merge-base excludes unrelated base commits'

missing_env_repo="$TEST_ROOT/missing-env"
create_repo "$missing_env_repo" packages/dtx-web/src/change.ts web
if (cd "$missing_env_repo" && PATH="$missing_env_repo/bin:$ORIGINAL_PATH" REAL_GIT="$REAL_GIT" FAKE_TURBO_FIXTURE="$FIXTURES_DIR/turbo-web.json" env -u TURBO_SCM_BASE -u TURBO_SCM_HEAD "$DETECTOR" unit >/dev/null 2>"$missing_env_repo/stderr.log"); then
	fail 'missing SCM variables unexpectedly passed'
fi
echo 'PASS: missing SCM variables fail'

echo 'All affected-scope detector tests passed.'
