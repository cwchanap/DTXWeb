#!/usr/bin/env bash
set -euo pipefail

build_environment="${1:?expected production or preproduction build environment}"
case "$build_environment" in
	production | preproduction) ;;
	*)
		echo "::error::Unsupported Google Drive build environment: $build_environment" >&2
		exit 1
		;;
esac

oauth_client_id="${GOOGLE_DRIVE_OAUTH_CLIENT_ID:-}"
if [[ -z "${oauth_client_id//[[:space:]]/}" ]]; then
	if [[ "$build_environment" == "preproduction" && "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
		echo "::notice::GOOGLE_DRIVE_OAUTH_CLIENT_ID is not configured; building this pull request with Google Drive disabled."
		exit 0
	fi
	echo "::error::GOOGLE_DRIVE_OAUTH_CLIENT_ID is required for $build_environment builds." >&2
	exit 1
fi

if [[ -z "${GITHUB_ENV:-}" ]]; then
	echo "::error::GITHUB_ENV is required to configure the Google Drive build." >&2
	exit 1
fi

{
	printf 'DTX_DESKTOP_BUILD_ENV=%s\n' "$build_environment"
	printf 'GOOGLE_DRIVE_OAUTH_CLIENT_ENV=%s\n' "$build_environment"
	printf 'GOOGLE_DRIVE_OAUTH_CLIENT_ID=%s\n' "$oauth_client_id"
} >> "$GITHUB_ENV"
