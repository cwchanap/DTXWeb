#!/usr/bin/env bash

set -euo pipefail

die() {
	echo "ci-affected-scope: $*" >&2
	exit 1
}

if [[ "$#" -ne 1 ]]; then
	die 'usage: ci-affected-scope.sh <unit|lint|codeql>'
fi

mode="$1"
case "$mode" in
	unit | lint | codeql) ;;
	*) die "unsupported mode: $mode" ;;
esac

: "${TURBO_SCM_BASE:?TURBO_SCM_BASE is required}"
: "${TURBO_SCM_HEAD:?TURBO_SCM_HEAD is required}"

if ! changed_paths="$(git diff --name-only --merge-base "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD")"; then
	die 'could not determine changed paths'
fi

if [[ "$mode" == codeql ]]; then
	codeql_actions=false
	codeql_javascript_typescript=false
	codeql_python=false
	codeql_rust=false
	while IFS= read -r changed_path; do
		if [[ -z "$changed_path" ]]; then
			continue
		fi

		case "$changed_path" in
			.github/workflows/* | .github/actions/*)
				codeql_actions=true
				;;
			packages/dtx-desktop/src-tauri/*)
				if [[ "$changed_path" == *.rs ]]; then
					codeql_rust=true
				else
					die "uncertain CodeQL language mapping for native path: $changed_path"
				fi
				;;
			scripts/*.py)
				codeql_python=true
				;;
			scripts/requirements*.txt | scripts/*/requirements*.txt)
				codeql_python=true
				;;
			*.js | *.cjs | *.mjs | *.jsx | *.ts | *.tsx | *.svelte | package.json | */package.json | bun.lock | tsconfig.base.json)
				codeql_javascript_typescript=true
				;;
		esac
	done <<<"$changed_paths"

	codeql_output=()
	if [[ "$codeql_actions" == true ]]; then
		codeql_output+=('"actions"')
	fi
	if [[ "$codeql_javascript_typescript" == true ]]; then
		codeql_output+=('"javascript-typescript"')
	fi
	if [[ "$codeql_python" == true ]]; then
		codeql_output+=('"python"')
	fi
	if [[ "$codeql_rust" == true ]]; then
		codeql_output+=('"rust"')
	fi

	if [[ "${#codeql_output[@]}" -eq 0 ]]; then
		die 'CodeQL language selection was empty'
	fi

	(IFS=,; printf '[%s]\n' "${codeql_output[*]}")
	exit 0
fi

if ! turbo_json="$(bunx turbo@2.10.9 ls --affected --output=json)"; then
	die 'Turbo affected-package discovery failed'
fi

if ! turbo_json="$(jq -e -s 'if length == 1 then .[0] else error("expected exactly one JSON document") end' <<<"$turbo_json")"; then
	die 'Turbo returned more than one JSON document'
fi

if ! jq -e '
	.packageManager == "bun" and
	(.packages | type == "object") and
	(.packages.count | (type == "number" and floor == . and . >= 0)) and
	(.packages.items | type == "array") and
	(.packages.count == (.packages.items | length)) and
	all(.packages.items[]; type == "object" and (.name | type == "string") and (.path | type == "string")) and
	((.packages.items | map(.name) | length) == (.packages.items | map(.name) | unique | length))
' <<<"$turbo_json" >/dev/null; then
	die 'Turbo returned an unexpected JSON shape'
fi

if ! packages_affected="$(jq -er 'if .packages.count > 0 then "true" else "false" end' <<<"$turbo_json")"; then
	die 'could not read Turbo affected-package count'
fi

if [[ -z "$changed_paths" && "$packages_affected" == true ]]; then
	die 'Turbo reported affected packages without changed paths'
fi

if ! affected_items="$(jq -r '.packages.items[] | [.name, .path] | @tsv' <<<"$turbo_json")"; then
	die 'could not read Turbo affected packages'
fi

unit_affected=false
if [[ "$packages_affected" == true ]]; then
	while IFS=$'\t' read -r package_name package_path; do

		case "$package_name:$package_path" in
			'@dtx/common:packages/common' | \
			'@dtx/infrastructure:packages/infrastructure' | \
			'@dtx/ui-components:packages/ui-components' | \
			'dtx-api:packages/dtx-api' | \
			'dtx-desktop:packages/dtx-desktop' | \
			'dtx-web:packages/dtx-web' | \
			'dtx-e2e-web:packages/e2e-web' | \
			'dtx-e2e-desktop:packages/e2e-desktop') ;;
			*) die "Turbo returned an unknown package: $package_name ($package_path)" ;;
		esac

		case "$package_name" in
			'@dtx/common' | '@dtx/infrastructure' | '@dtx/ui-components' | dtx-api | dtx-desktop | dtx-web)
				unit_affected=true
				;;
		esac
	done <<<"$affected_items"
fi

if [[ "$mode" == unit ]]; then
	printf '%s\n' "$unit_affected"
	else
	printf '%s\n' "$packages_affected"
fi
