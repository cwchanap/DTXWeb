# Cloudflare Zero Trust Web Access Runbook

## Scope And Invariants

DTXWeb uses manually managed Cloudflare Zero Trust Access for two web surfaces:

| Application | Protected destination |
| --- | --- |
| `DTXWeb Pre-prod` | entire `pre-prod.dtx.hapadona.com` hostname |
| `DTXWeb Production App` | `dtx.hapadona.com/app` |
| `DTXWeb Production App` | `dtx.hapadona.com/app/*` |

Production `/app` and production desktop login are intentionally operator-only. The Access identity and trusted-device posture are an outer gate; Supabase remains the inner application-authentication gate.

Production Access covers the intended private route family: exact `/app` and descendants under `/app/`. New private production pages MUST live under `/app`; a new private sibling such as `/studio` or `/admin` would be publicly reachable until this Access design is updated. `hooks.server.ts` currently uses the slightly broader `pathname.startsWith('/app')`; do not rely on that string-prefix quirk for new routes.

A normal Supabase user may reach public `/login`, authenticate successfully, and then be denied when returning to `/app`. If they now hold a Supabase session, the server redirects `/login` back to `/app` and the only current sign-out UI is inside the protected `(app)` layout. The current recovery is to clear the Drumery/Supabase cookies for `dtx.hapadona.com`. A public `/logout` route or changing the authenticated `/login` redirect is a deferred product decision, not part of this dashboard-only slice.

Standalone desktop development (`bun run dev:desktop`) loads `VITE_DTX_SERVER_URL` from the ignored root `.env`. In the current operator setup that points to production, so the ordinary standalone `tauri dev` login is operator-only after this rollout. Pointing it at pre-production does not help a non-operator because pre-production is hostname-wide Access-protected. Non-operator contributors must use the full local stack (`bun run dev`, which uses `dtx-desktop#dev:local-web`) or a separately designed ungated development environment.

The web E2E harness can override `PLAYWRIGHT_BASE_URL`, but this slice provides no non-interactive Access credential. Unattended E2E/CI against `pre-prod.dtx.hapadona.com` is therefore unsupported until a separate Access-authentication design is approved.

This runbook is the durable Zero Trust source of truth. `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md` is precedent for human-executed Cloudflare operations but remains a historical API-migration checklist.

## Required Policy

Both Access applications use the same policy semantics:

- Action: `Allow`
- Include: the intended operator identity/email used for Perseus access
- Require: the trusted-device serial-number posture check used for Perseus
- Session duration: `12h`
- Service Auth: none
- Managed OAuth: off

Reuse the existing Perseus identity provider and its current instant-authentication mode. Do not toggle instant authentication merely to make a header test easier.

Before rollout, inspect a known protected Perseus route and set an uncommitted shell regex that matches the actual unauthenticated Access redirect for this tenant:

```bash
export ACCESS_REDIRECT_RE='<regex matching this tenant\'s Access redirect Location>'
```

For a tenant using the normal Cloudflare Access login page, a suitable value is:

```bash
export ACCESS_REDIRECT_RE='^location: https://[^/]+\.cloudflareaccess\.com/cdn-cgi/access/'
```

If Perseus uses instant authentication, set the regex to the known direct IdP redirect shape observed from that existing protected route. Keep one redirect mode for the whole DTXWeb rollout.

Never commit the operator email, device serial numbers, tenant-specific cookies/tokens, or other credentials.

## Header Verification Helpers

Use unauthenticated requests with no Access cookies. A request that fails DNS, connection, TLS, or timeout checks MUST fail the assertion instead of being interpreted as an unprotected route.

```bash
http_headers() {
  url="$1"
  raw="$(curl -sS --max-time 15 -o /dev/null -D - "$url")" || {
    echo "FAIL: no HTTP response from $url" >&2
    return 1
  }

  headers="$(printf '%s\n' "$raw" | tr -d '\r')"
  printf '%s\n' "$headers" | grep -Eq '^HTTP/[0-9.]+ [0-9]{3}' || {
    echo "FAIL: no HTTP status line from $url" >&2
    return 1
  }

  printf '%s\n' "$headers"
}

assert_access_redirect() {
  url="$1"
  : "${ACCESS_REDIRECT_RE:?set ACCESS_REDIRECT_RE from the current Perseus Access flow}"
  headers="$(http_headers "$url")" || return 1
  printf '%s\n' "$headers" | sed -n '1p;/^location:/Ip'
  printf '%s\n' "$headers" | grep -Eiq "$ACCESS_REDIRECT_RE" || {
    echo "FAIL: Access did not intercept $url" >&2
    return 1
  }
}

assert_no_access_redirect() {
  url="$1"
  : "${ACCESS_REDIRECT_RE:?set ACCESS_REDIRECT_RE from the current Perseus Access flow}"
  headers="$(http_headers "$url")" || return 1
  printf '%s\n' "$headers" | sed -n '1p;/^location:/Ip'
  if printf '%s\n' "$headers" | grep -Eiq "$ACCESS_REDIRECT_RE"; then
    echo "FAIL: Access unexpectedly intercepted $url" >&2
    return 1
  fi
}
```

Dry-run the harness before changing DTXWeb:

- `assert_access_redirect` against a known protected Perseus URL must pass.
- `assert_no_access_redirect https://dtx.hapadona.com/` must pass before production Access exists.
- `http_headers https://this-host-does-not-exist-zzz.hapadona.com/` must fail non-zero.

Do not proceed until the invalid-host check fails loudly.

## Rollout Order

1. Confirm the Perseus IdP, instant-auth mode, operator identity, and serial posture rule.
2. Dry-run the header helpers.
3. Create and verify `DTXWeb Pre-prod`.
4. Prove pre-production password login, Google OAuth, posture denial, and API non-interception.
5. Stop and roll back if any required pre-production check fails.
6. Create `DTXWeb Production App` with only `/app` and `/app/*`.
7. Run the complete production matrix.
8. Prove the Access identity selector and posture selector independently.
9. Run production browser and desktop-login checks.
10. Characterize expired Access behavior during SvelteKit client-side navigation.
11. Record final non-sensitive results and deferred limitations.

## Pre-production Configuration

Create `DTXWeb Pre-prod` as **Self-hosted and private** for the entire public hostname:

```text
pre-prod.dtx.hapadona.com
```

Set session duration to `12h`, attach the operator `Allow` policy with the serial-number posture requirement, and use the same IdP/instant-auth mode as Perseus. Do not add `api.pre-prod.dtx.hapadona.com`, Service Auth, Managed OAuth, or service tokens.

## Pre-production Verification Matrix

Run the following with no Access session:

```bash
assert_access_redirect https://pre-prod.dtx.hapadona.com/
assert_access_redirect https://pre-prod.dtx.hapadona.com/login
assert_access_redirect https://pre-prod.dtx.hapadona.com/auth/callback
assert_access_redirect https://pre-prod.dtx.hapadona.com/blog
assert_access_redirect https://pre-prod.dtx.hapadona.com/preview/1
assert_access_redirect https://pre-prod.dtx.hapadona.com/editor
assert_access_redirect https://pre-prod.dtx.hapadona.com/tool/dtx-to-midi
assert_access_redirect https://pre-prod.dtx.hapadona.com/game
assert_access_redirect https://pre-prod.dtx.hapadona.com/app
assert_access_redirect https://pre-prod.dtx.hapadona.com/app/
assert_access_redirect https://pre-prod.dtx.hapadona.com/app/score
assert_access_redirect https://pre-prod.dtx.hapadona.com/app/__data.json
assert_no_access_redirect https://api.pre-prod.dtx.hapadona.com/
```

Every command must exit `0`. If one fails, disable/delete `DTXWeb Pre-prod` and stop before production.

On the trusted operator device, complete both password login and Google OAuth behind the hostname-wide Access session and confirm an API-backed `/app` page works normally.

From a device that fails the serial posture rule, confirm pre-production is denied before DTXWeb loads.

## Production Configuration

Only after all required pre-production checks pass, create `DTXWeb Production App` as **Self-hosted and private** with exactly:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

Set session duration to `12h`, attach the same operator `Allow` policy and serial posture requirement, and preserve the Perseus IdP/instant-auth mode. Do not add a hostname-wide production destination, public routes, Service Auth, Managed OAuth, or service tokens.

## Production Header Matrix

Run with no Access session:

```bash
assert_access_redirect https://dtx.hapadona.com/app
assert_access_redirect https://dtx.hapadona.com/app/
assert_access_redirect https://dtx.hapadona.com/app/score
assert_access_redirect https://dtx.hapadona.com/app/__data.json

assert_no_access_redirect https://dtx.hapadona.com/
assert_no_access_redirect https://dtx.hapadona.com/blog
assert_no_access_redirect https://dtx.hapadona.com/preview/1
assert_no_access_redirect https://dtx.hapadona.com/editor
assert_no_access_redirect https://dtx.hapadona.com/tool/dtx-to-midi
assert_no_access_redirect https://dtx.hapadona.com/game
assert_no_access_redirect https://dtx.hapadona.com/login
assert_no_access_redirect https://dtx.hapadona.com/auth/callback
assert_no_access_redirect https://api.dtx.hapadona.com/
assert_no_access_redirect https://api.pre-prod.dtx.hapadona.com/
```

Every command must exit `0`. `/app/` is an explicit path-semantics probe; do not assume its behavior from the dashboard string alone. `/app/__data.json` proves SvelteKit data requests are inside the Access boundary. `/preview/1` exercises the real dynamic preview route instead of a 404 prefix.

If any public route or API is intercepted, disable the production application, correct the destinations, and rerun this entire matrix before continuing.

## Production Identity And Posture Verification

Verify the two Access policy clauses independently:

1. Configured operator identity on the trusted device: allowed.
2. On that same trusted device, use a fresh browser profile/session and authenticate to Access with a second IdP identity that is NOT in the `Include` list: denied by Access.
3. Configured operator identity from a device that fails the serial posture rule: denied by Access.

A second Supabase account is not a substitute for check 2; the Access identity selector and Supabase session are separate gates.

Do not claim the identity selector verified if no non-allowed IdP identity was actually exercised.

## Trusted Production Browser Verification

On the trusted operator device:

1. Open `/app` and pass Access.
2. With no Supabase session, confirm DTXWeb redirects to public `/login`.
3. Complete Supabase login and confirm return to protected `/app` succeeds under the existing Access session.
4. Sign out of Supabase and confirm `/app` remains Access-protected.

Characterize the non-operator dead end separately:

1. Use a Supabase account that does not correspond to the allowed Access identity.
2. Authenticate on public `/login` and confirm the return to `/app` is denied by Access.
3. Confirm revisiting `/login` with that Supabase session redirects back to `/app` and no public sign-out UI is reachable.
4. Recover by clearing the production Drumery/Supabase cookies.

Record this as a known limitation. Do not widen Access to make the non-operator account work.

## Access Session Expiry / Client-side Navigation Check

The root server layout has a server `load`, so client-side navigation uses SvelteKit data requests under paths such as `/app/__data.json`.

On the trusted operator device with a valid Supabase session:

1. Keep a browser tab on a public production page.
2. End the Access session using the tenant's normal Access logout/session-clearing procedure so a new protected request requires Access again.
3. Trigger a SvelteKit client-side navigation into `/app` without first doing a full-page protected navigation.
4. Record what the UI shows when the framework data request encounters Access reauthentication.
5. Navigate directly/reload `/app` and confirm the browser can complete Access reauthentication and recover.

If client-side navigation shows an opaque fetch error but a direct `/app` reload recovers, document that UX as a deferred follow-up. Do not add a bypass. If the operator cannot recover with a direct browser navigation, disable the production Access application and investigate before acceptance.

## Production Desktop Login Verification

This is required because standalone desktop development against a deployed web environment also traverses the protected production `/app` handoff in the current operator setup.

### Bundled desktop

On the trusted operator device:

1. Start desktop login and confirm public `/login?redirect=desktop&desktop_callback=...` loads without Access interception.
2. Complete password login and confirm the return through protected `/app?redirect=desktop...` succeeds.
3. Confirm the generated magic link reaches `dtx://auth-callback` and the desktop session authenticates.
4. Repeat with Google login.

### Standalone `tauri dev`

Using the current standalone desktop-development setup:

1. Start `bun run dev:desktop` and confirm the browser login target is the expected deployed production web hostname.
2. Keep the login flow in the same browser tab so `/login` can preserve `desktop_callback` in `sessionStorage`.
3. Complete password login and confirm protected `/app?redirect=desktop...` passes Access.
4. Confirm the magic link reaches `http://127.0.0.1:<configured-port>/auth-callback`.
5. Repeat with Google login.

This check is required when the current `.env` points standalone desktop development at production. If the local operator configuration has deliberately changed, record the actual target and still verify the deployed-environment loopback flow before accepting production Access.

The full local-stack `bun run dev` path is not an Access test: it uses `dev:local-web` and localhost intentionally.

## Rollback

Pre-production:

- Disable/delete `DTXWeb Pre-prod` if the hostname-wide gate fails a required check.

Production:

- Disable/delete `DTXWeb Production App` if the trusted operator cannot use `/app`, cannot recover after Access reauthentication, or cannot complete required desktop login.
- If a public route or API is intercepted, disable the production application, restore exactly `/app` and `/app/*`, and rerun the entire Production Header Matrix.

Do not introduce service tokens, API Access, route bypasses, or policy widening as an emergency workaround.

No Worker rollback or code deployment is required for these dashboard-only changes.

## References

- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/
- https://developers.cloudflare.com/learning-paths/clientless-access/customize-ux/login-page/
