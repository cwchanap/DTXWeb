#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARE_LOCATION_RE='^https://([[:alnum:]-]+\.)+cloudflareaccess\.com(:[0-9]+)?([/?#]|$)'

HTTP_HEADERS=''
HTTP_FINAL_HEADERS=''
HTTP_STATUS_LINE=''
HTTP_STATUS=''
HTTP_LOCATION=''
HTTP_HAS_ACCESS_AUD=0
HTTP_HAS_ACCESS_DOMAIN=0

http_headers() {
	local url="$1"
	local headers

	if ! headers="$(curl -sS --max-time 15 -o /dev/null -D - "$url")"; then
		printf 'curl transport failure for %s\n' "$url" >&2
		return 1
	fi

	HTTP_HEADERS="$(printf '%s\n' "$headers" | sed 's/\r$//')"
	HTTP_FINAL_HEADERS="$(printf '%s\n' "$HTTP_HEADERS" | awk '
		/^HTTP\/[0-9]/ {
			if (in_block) {
				final = block
			}
			block = $0 ORS
			in_block = 1
			next
		}
		in_block {
			block = block $0 ORS
		}
		END {
			if (in_block) {
				final = block
			}
			printf "%s", final
		}')"
	HTTP_STATUS_LINE="$(printf '%s\n' "$HTTP_FINAL_HEADERS" | grep -Ei '^HTTP/[0-9]+(\.[0-9]+)?[[:space:]]+[0-9]{3}([[:space:]]|$)' | tail -n 1 || true)"
	if [[ -z "$HTTP_STATUS_LINE" ]]; then
		printf 'response contained no HTTP status for %s\n' "$url" >&2
		return 1
	fi

	HTTP_STATUS="${HTTP_STATUS_LINE#* }"
	HTTP_STATUS="${HTTP_STATUS%% *}"
	HTTP_LOCATION="$(printf '%s\n' "$HTTP_FINAL_HEADERS" | grep -Ei '^Location:[[:space:]]*' | tail -n 1 || true)"
	HTTP_LOCATION="${HTTP_LOCATION#*:}"
	HTTP_LOCATION="${HTTP_LOCATION#${HTTP_LOCATION%%[![:space:]]*}}"
	HTTP_HAS_ACCESS_AUD=0
	HTTP_HAS_ACCESS_DOMAIN=0
	if grep -Eiq '^cf-access-aud:' <<< "$HTTP_FINAL_HEADERS"; then
		HTTP_HAS_ACCESS_AUD=1
	fi
	if grep -Eiq '^cf-access-domain:' <<< "$HTTP_FINAL_HEADERS"; then
		HTTP_HAS_ACCESS_DOMAIN=1
	fi
}

has_access_interception() {
	if [[ "$HTTP_STATUS" =~ ^3[0-9][0-9]$ ]] && grep -Eiq "$CLOUDFLARE_LOCATION_RE" <<< "$HTTP_LOCATION"; then
		return 0
	fi

	[[ "$HTTP_STATUS" == '403' && "$HTTP_HAS_ACCESS_AUD" -eq 1 && "$HTTP_HAS_ACCESS_DOMAIN" -eq 1 ]]
}

print_response_summary() {
	printf '%s\n' "$HTTP_STATUS_LINE"
	if [[ -n "$HTTP_LOCATION" ]]; then
		printf 'Location: [redacted]\n'
	fi
	if [[ "$HTTP_HAS_ACCESS_AUD" -eq 1 ]]; then
		printf 'cf-access-aud: [redacted]\n'
	fi
	if [[ "$HTTP_HAS_ACCESS_DOMAIN" -eq 1 ]]; then
		printf 'cf-access-domain: [redacted]\n'
	fi
}

assert_access_intercepted() {
	local url="$1"

	if ! http_headers "$url"; then
		return 1
	fi
	print_response_summary
	if ! has_access_interception; then
		printf 'expected Access interception for %s\n' "$url" >&2
		return 1
	fi
}

assert_public() {
	local url="$1"

	if ! http_headers "$url"; then
		return 1
	fi
	print_response_summary
	if has_access_interception ||
		[[ "$HTTP_HAS_ACCESS_AUD" -eq 1 || "$HTTP_HAS_ACCESS_DOMAIN" -eq 1 ]]; then
		printf 'unexpected Access interception for public URL %s\n' "$url" >&2
		return 1
	fi
}

assert_health() {
	local url="$1"

	if ! curl --fail --silent --show-error --max-time 15 -o /dev/null "$url"; then
		printf 'health check failed for %s\n' "$url" >&2
		return 1
	fi
}

verify_pre_prod() {
	local base_url='https://pre-prod.dtx.hapadona.com'
	local path
	local protected_paths=(
		'/'
		'/login'
		'/auth/callback'
		'/blog'
		'/preview/1'
		'/editor'
		'/tool/dtx-to-midi'
		'/game'
		'/app'
		'/app/'
		'/app/score'
		'/app/__data.json'
	)

	for path in "${protected_paths[@]}"; do
		assert_access_intercepted "$base_url$path" || return 1
	done
	assert_public 'https://api.pre-prod.dtx.hapadona.com/'
	assert_health 'https://api.pre-prod.dtx.hapadona.com/healthz'
}

verify_production() {
	local base_url='https://dtx.hapadona.com'
	local path
	local protected_paths=(
		'/app'
		'/app/'
		'/app/score'
	)
	local public_paths=(
		'/'
		'/login'
		'/auth/callback'
		'/blog'
		'/preview/1'
		'/editor'
		'/tool/dtx-to-midi'
		'/game'
	)

	for path in "${protected_paths[@]}"; do
		assert_access_intercepted "$base_url$path" || return 1
	done
	for path in "${public_paths[@]}"; do
		assert_public "$base_url$path" || return 1
	done
	assert_public 'https://api.dtx.hapadona.com/'
	assert_health 'https://api.dtx.hapadona.com/healthz'
}

if [[ "$#" -ne 1 ]]; then
	printf 'usage: %s <pre-prod|production>\n' "$0" >&2
	exit 1
fi

case "$1" in
	pre-prod)
		verify_pre_prod
		;;
	production)
		verify_production
		;;
	*)
		printf 'unsupported environment: %s\n' "$1" >&2
		exit 1
		;;
esac
