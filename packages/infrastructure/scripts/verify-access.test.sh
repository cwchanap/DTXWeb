#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VERIFIER="$SCRIPT_DIR/verify-access.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$TEMP_DIR/bin"
cat > "$TEMP_DIR/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

url="${!#}"
printf '%s\n' "$url" >> "$FAKE_CURL_LOG"

emit_cloudflare_redirect() {
	cat <<'RESPONSE'
HTTP/2 302
Location: https://login.cloudflareaccess.com/cdn-cgi/access/login
Set-Cookie: CF_Authorization=super-secret-cookie

RESPONSE
}

emit_generic_redirect() {
	cat <<'RESPONSE'
HTTP/2 302
Location: https://login.example.com/sign-in
Set-Cookie: session=super-secret-cookie

RESPONSE
}

emit_access_forbidden() {
	cat <<'RESPONSE'
HTTP/2 403
Cf-Access-Aud: super-secret-audience
cf-ACCESS-DOMAIN: super-secret-domain
Set-Cookie: CF_Authorization=super-secret-cookie

RESPONSE
}

emit_access_forbidden_missing_domain() {
	cat <<'RESPONSE'
HTTP/2 403
Cf-Access-Aud: super-secret-audience
Set-Cookie: CF_Authorization=super-secret-cookie

RESPONSE
}

emit_public_ok() {
	cat <<'RESPONSE'
HTTP/2 200
Content-Type: text/html

RESPONSE
}

emit_public_redirect() {
	cat <<'RESPONSE'
HTTP/2 303
Location: https://dtx.hapadona.com/login

RESPONSE
}

emit_public_not_found() {
	cat <<'RESPONSE'
HTTP/2 404
Content-Type: text/plain

RESPONSE
}

is_pre_prod_protected_url() {
	case "$url" in
		https://pre-prod.dtx.hapadona.com/|\
		https://pre-prod.dtx.hapadona.com/login|\
		https://pre-prod.dtx.hapadona.com/auth/callback|\
		https://pre-prod.dtx.hapadona.com/blog|\
		https://pre-prod.dtx.hapadona.com/preview/1|\
		https://pre-prod.dtx.hapadona.com/editor|\
		https://pre-prod.dtx.hapadona.com/tool/dtx-to-midi|\
		https://pre-prod.dtx.hapadona.com/game|\
		https://pre-prod.dtx.hapadona.com/app|\
		https://pre-prod.dtx.hapadona.com/app/|\
		https://pre-prod.dtx.hapadona.com/app/score|\
		https://pre-prod.dtx.hapadona.com/app/__data.json)
			return 0
			;;
		*)
			return 1
			;;
	esac
}

is_production_protected_url() {
	case "$url" in
		https://dtx.hapadona.com/app|\
		https://dtx.hapadona.com/app/|\
		https://dtx.hapadona.com/app/score)
			return 0
			;;
		*)
			return 1
			;;
	esac
}

case "${FAKE_CURL_SCENARIO:-}" in
	cloudflare-redirect)
		if [[ "$url" == https://pre-prod.dtx.hapadona.com/* || "$url" == https://dtx.hapadona.com/app* ]]; then
			emit_cloudflare_redirect
		else
			emit_public_ok
		fi
		;;
	generic-redirect)
		if is_pre_prod_protected_url || is_production_protected_url; then
			emit_generic_redirect
		else
			emit_public_ok
		fi
		;;
	access-403-both)
		if is_pre_prod_protected_url || is_production_protected_url; then
			emit_access_forbidden
		else
			emit_public_ok
		fi
		;;
	access-403-missing-domain)
		if is_pre_prod_protected_url || is_production_protected_url; then
			emit_access_forbidden_missing_domain
		else
			emit_public_ok
		fi
		;;
	public-matrix)
		if is_pre_prod_protected_url || is_production_protected_url; then
			emit_cloudflare_redirect
		else
			case "$url" in
				https://dtx.hapadona.com/login)
					emit_public_redirect
					;;
				https://dtx.hapadona.com/auth/callback)
					emit_public_not_found
					;;
				*)
					emit_public_ok
					;;
			esac
		fi
		;;
	public-intercepted)
		if [[ "$url" == https://api.pre-prod.dtx.hapadona.com/ || "$url" == https://api.dtx.hapadona.com/ ]]; then
			emit_access_forbidden
		elif is_pre_prod_protected_url || is_production_protected_url; then
			emit_cloudflare_redirect
		else
			emit_public_ok
		fi
		;;
	pre-prod-full-matrix)
		if is_pre_prod_protected_url; then
			emit_access_forbidden
		else
			emit_public_ok
		fi
		;;
	production-full-matrix)
		if is_production_protected_url; then
			emit_access_forbidden
		else
			case "$url" in
				https://dtx.hapadona.com/login)
					emit_public_redirect
					;;
				https://dtx.hapadona.com/auth/callback)
					emit_public_not_found
					;;
				*)
					emit_public_ok
					;;
			esac
		fi
		;;
	network-failure)
		exit 28
		;;
	*)
		exit 64
		;;
esac
FAKE_CURL
chmod +x "$TEMP_DIR/bin/curl"

export PATH="$TEMP_DIR/bin:$PATH"
export FAKE_CURL_LOG="$TEMP_DIR/curl.log"

run_case() {
	local name="$1"
	local expected_status="$2"
	local scenario="$3"
	local environment="$4"
	local output status

	: > "$FAKE_CURL_LOG"
	if output="$(FAKE_CURL_SCENARIO="$scenario" "$VERIFIER" "$environment" 2>&1)"; then
		status=0
	else
		status=$?
	fi

	if [[ "$status" -ne "$expected_status" ]]; then
		printf 'FAIL: %s (expected status %s, got %s)\n%s\n' "$name" "$expected_status" "$status" "$output" >&2
		exit 1
	fi
	if [[ "$output" == *super-secret* || "$output" == *Set-Cookie* ]]; then
		printf 'FAIL: %s leaked a sensitive header value\n%s\n' "$name" "$output" >&2
		exit 1
	fi
	printf 'PASS: %s\n' "$name"
}

assert_urls() {
	local name="$1"
	shift
	local expected_file="$TEMP_DIR/expected-${name// /-}.log"
	printf '%s\n' "$@" > "$expected_file"
	if ! diff -u "$expected_file" "$FAKE_CURL_LOG"; then
		printf 'FAIL: %s requested an unexpected URL matrix\n' "$name" >&2
		exit 1
	fi
}

run_case 'cloudflare-host redirect accepted' 0 cloudflare-redirect pre-prod
run_case 'generic redirect rejected for protected route' 1 generic-redirect pre-prod
run_case '403 with both Access headers accepted' 0 access-403-both pre-prod
run_case '403 missing either Access header rejected' 1 access-403-missing-domain pre-prod
run_case 'public 200, 303, and 404 accepted' 0 public-matrix production
run_case 'Access interception on a public route rejected' 1 public-intercepted pre-prod
run_case 'network failure rejected' 1 network-failure pre-prod
run_case 'unsupported environment rejected before curl' 1 cloudflare-redirect development
if [[ -s "$FAKE_CURL_LOG" ]]; then
	printf 'FAIL: unsupported environment called curl\n' >&2
	exit 1
fi

run_case 'pre-prod full matrix requests every specified URL' 0 pre-prod-full-matrix pre-prod
assert_urls 'pre-prod full matrix requests every specified URL' \
	'https://pre-prod.dtx.hapadona.com/' \
	'https://pre-prod.dtx.hapadona.com/login' \
	'https://pre-prod.dtx.hapadona.com/auth/callback' \
	'https://pre-prod.dtx.hapadona.com/blog' \
	'https://pre-prod.dtx.hapadona.com/preview/1' \
	'https://pre-prod.dtx.hapadona.com/editor' \
	'https://pre-prod.dtx.hapadona.com/tool/dtx-to-midi' \
	'https://pre-prod.dtx.hapadona.com/game' \
	'https://pre-prod.dtx.hapadona.com/app' \
	'https://pre-prod.dtx.hapadona.com/app/' \
	'https://pre-prod.dtx.hapadona.com/app/score' \
	'https://pre-prod.dtx.hapadona.com/app/__data.json' \
	'https://api.pre-prod.dtx.hapadona.com/'

run_case 'production full matrix requests every specified URL' 0 production-full-matrix production
assert_urls 'production full matrix requests every specified URL' \
	'https://dtx.hapadona.com/app' \
	'https://dtx.hapadona.com/app/' \
	'https://dtx.hapadona.com/app/score' \
	'https://dtx.hapadona.com/' \
	'https://dtx.hapadona.com/login' \
	'https://dtx.hapadona.com/auth/callback' \
	'https://dtx.hapadona.com/blog' \
	'https://dtx.hapadona.com/preview/1' \
	'https://dtx.hapadona.com/editor' \
	'https://dtx.hapadona.com/tool/dtx-to-midi' \
	'https://dtx.hapadona.com/game' \
	'https://api.dtx.hapadona.com/'
