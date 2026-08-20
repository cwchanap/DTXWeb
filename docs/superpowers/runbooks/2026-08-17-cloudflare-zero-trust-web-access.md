# Cloudflare Zero Trust Web Access Runbook (operator-executed)

This runbook owns live DTXWeb Cloudflare Access rollout, verification, and rollback.

Steps that mutate Cloudflare (`pulumi up`, `pulumi destroy`, dashboard disable/delete), require interactive identity login, require a trusted/untrusted physical device, or require visual browser/desktop observation are run by a human operator, not by an implementation agent.

## Scope And Invariants

DTXWeb Pulumi owns exactly one Access application per stack:

| Stack | Application | Protected destination |
| --- | --- | --- |
| `pre-prod` | `DTXWeb Pre-prod` | entire `pre-prod.dtx.hapadona.com` hostname |
| `production` | `DTXWeb Production App` | `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` |

Wrangler continues to own Workers/API/runtime infrastructure.

Production `/app` and deployed-environment desktop login are intentionally operator-only. Supabase remains the inner application-authentication gate.

Production private routes must live at exact `/app` or below `/app/`. The current SvelteKit guard uses the slightly broader `pathname.startsWith('/app')`; do not rely on that string-prefix quirk for new private sibling routes.

Production `/login` and `/auth/*` remain public because desktop/password/Google flows return through those routes before the protected `/app` handoff.

Both API hostnames remain outside Access:

- `api.dtx.hapadona.com`
- `api.pre-prod.dtx.hapadona.com`

Do not create service tokens, Service Auth policies, bypass policies, API Access applications, or wider production destinations as troubleshooting shortcuts.

## Shared Posture Ownership

Perseus owns the trusted-device serial list and device-posture rule. DTXWeb stores only the existing Cloudflare posture-rule resource ID as Pulumi config.

If Perseus replaces that posture rule with a new Cloudflare resource, update DTXWeb `devicePostureRuleId` in both stacks before the next DTXWeb preview/apply.

DTXWeb must never create its own serial list or posture rule in this slice.

## Pulumi Backend And Secret Handling

DTXWeb follows the current Perseus local-backend operating model.

```bash
cd packages/infrastructure
pulumi login --local
```

`pulumi login --local` uses a filesystem backend rooted at the operator's home directory; default state is stored under `~/.pulumi`.

The repository ignores `Pulumi.*.yaml`, `.pulumi/`, build output, dependencies, and local env files. Do not commit:

- operator email;
- Cloudflare API token;
- device serials;
- Access cookies/JWTs;
- Pulumi stack config files;
- Pulumi state exports;
- screenshots containing security identifiers.

Use `accessEmail` as Pulumi secret config. `devicePostureRuleId` is a non-secret Cloudflare resource ID.

## Cloudflare API Credential

Set `CLOUDFLARE_API_TOKEN` in the operator shell using a token scoped to the DTXWeb Cloudflare account with the least privilege needed for these resources.

For Access application creation/update/delete, the required Cloudflare permission is:

```text
Access: Apps and Policies Write
```

Do not use a Global API Key for this workflow.

## Establish The Shared Config Values

Before configuring DTXWeb, obtain these values without committing or printing them into PR comments/logs:

- Cloudflare account ID;
- operator Access email;
- current Perseus `adminAccessDevicePostureRuleId` output.

When already logged into the correct Perseus backend/production stack, the posture ID can be read with:

```bash
pulumi stack output adminAccessDevicePostureRuleId
```

Store the resulting value only in the local DTXWeb Pulumi stack configs.

## Initialize Or Select DTXWeb Stacks

From `packages/infrastructure`:

```bash
pulumi stack select pre-prod || pulumi stack init pre-prod
pulumi stack select production || pulumi stack init production
```

Configure both stacks using shell variables populated locally by the operator:

```bash
pulumi config set cloudflareAccountId "$DTX_CLOUDFLARE_ACCOUNT_ID" --stack pre-prod
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack pre-prod
pulumi config set devicePostureRuleId "$DTX_DEVICE_POSTURE_RULE_ID" --stack pre-prod

pulumi config set cloudflareAccountId "$DTX_CLOUDFLARE_ACCOUNT_ID" --stack production
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack production
pulumi config set devicePostureRuleId "$DTX_DEVICE_POSTURE_RULE_ID" --stack production
```

The optional session override is:

```bash
pulumi config set accessSessionDuration 12h --stack pre-prod
pulumi config set accessSessionDuration 12h --stack production
```

Omit it to use the code default of `12h`.

Hostnames and production destinations are not config values.

## Preflight Repository Checks

Before any preview:

```bash
bun install --frozen-lockfile
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
.github/scripts/ci-affected-scope.test.sh
```

All commands must pass.

## Header Verification Helpers

Use unauthenticated requests with no Access cookies. A DNS, connection, TLS, or timeout failure must fail loudly rather than count as an unprotected route.

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

has_access_interception() {
  headers="$1"

  if [ -n "${ACCESS_REDIRECT_RE:-}" ] &&
    printf '%s\n' "$headers" | grep -Eiq "$ACCESS_REDIRECT_RE"; then
    return 0
  fi

  if printf '%s\n' "$headers" | grep -Eq '^HTTP/[0-9.]+ 403' &&
    printf '%s\n' "$headers" | grep -Eiq '^cf-access-aud:' &&
    printf '%s\n' "$headers" | grep -Eiq '^cf-access-domain:'; then
    return 0
  fi

  return 1
}

assert_access_intercepted() {
  url="$1"
  headers="$(http_headers "$url")" || return 1
  printf '%s\n' "$headers" | sed -n '1p;/^location:/Ip;/^cf-access-\(aud\|domain\):/Ip'
  has_access_interception "$headers" || {
    echo "FAIL: Access did not intercept $url" >&2
    return 1
  }
}

assert_no_access_interception() {
  url="$1"
  headers="$(http_headers "$url")" || return 1
  printf '%s\n' "$headers" | sed -n '1p;/^location:/Ip;/^cf-access-\(aud\|domain\):/Ip'
  if has_access_interception "$headers"; then
    echo "FAIL: Access unexpectedly intercepted $url" >&2
    return 1
  fi
}
```

Before changing DTXWeb Access:

- configure `ACCESS_REDIRECT_RE` only when the tenant's known Perseus flow uses a redirect signal;
- prove `assert_access_intercepted` passes on a known protected Perseus URL;
- prove `assert_no_access_interception https://dtx.hapadona.com/` passes before production Access exists;
- prove `http_headers https://this-host-does-not-exist-zzz.hapadona.com/` exits non-zero.

Do not continue if the invalid-host test returns success.

# Phase 1 — Pre-production

Production must not be applied until this entire phase is green.

## 1. Preview Pre-production

Run:

```bash
pulumi preview --stack pre-prod
```

The preview must create/update only the DTXWeb pre-production Access application.

Expected security shape:

- name: `DTXWeb Pre-prod`;
- type: self-hosted;
- hostname-wide destination: `pre-prod.dtx.hapadona.com`;
- one `allow` policy containing the configured email `Include` and existing posture-rule `Require`;
- no API hostname;
- no serial list;
- no posture rule;
- no service token;
- no Worker/storage/runtime resource.

If the preview differs, stop. Do not apply.

## 2. Apply Pre-production — Operator Only

Run only after manually reviewing the preview:

```bash
pulumi up --stack pre-prod
```

Review the interactive Pulumi confirmation and approve only the expected pre-production Access application change.

## 3. Pre-production Verification Matrix

With no Access session:

```bash
assert_access_intercepted https://pre-prod.dtx.hapadona.com/
assert_access_intercepted https://pre-prod.dtx.hapadona.com/login
assert_access_intercepted https://pre-prod.dtx.hapadona.com/auth/callback
assert_access_intercepted https://pre-prod.dtx.hapadona.com/blog
assert_access_intercepted https://pre-prod.dtx.hapadona.com/preview/1
assert_access_intercepted https://pre-prod.dtx.hapadona.com/editor
assert_access_intercepted https://pre-prod.dtx.hapadona.com/tool/dtx-to-midi
assert_access_intercepted https://pre-prod.dtx.hapadona.com/game
assert_access_intercepted https://pre-prod.dtx.hapadona.com/app
assert_access_intercepted https://pre-prod.dtx.hapadona.com/app/
assert_access_intercepted https://pre-prod.dtx.hapadona.com/app/score
assert_access_intercepted https://pre-prod.dtx.hapadona.com/app/__data.json
assert_no_access_interception https://api.pre-prod.dtx.hapadona.com/
```

Every command must exit `0`.

## 4. Pre-production Human Checks

On the trusted WARP/Cloudflare One device with the configured operator identity:

1. Enter the pre-production hostname through Access.
2. Complete password login.
3. Confirm `/app` works behind Access and can use the API.
4. Log out of Supabase while keeping Access.
5. Complete Google OAuth and confirm callback/login still succeeds.

From a device that fails the Perseus serial posture rule, confirm the pre-production hostname is denied before DTXWeb loads.

If any required check fails, execute **Rollback — Pre-production** below and do not proceed to production.

# Phase 2 — Production

Start only after Phase 1 is fully green.

## 5. Preview Production

Run:

```bash
pulumi preview --stack production
```

The preview must create/update only `DTXWeb Production App` with exactly these destinations:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

Hard stops:

- hostname-wide `dtx.hapadona.com` destination;
- any API destination;
- any public route destination;
- new serial list/posture rule;
- service token/Service Auth;
- Worker/storage/runtime resource.

## 6. Apply Production — Operator Only

After manually reviewing the production preview:

```bash
pulumi up --stack production
```

Approve only the expected production Access application change.

## 7. Production Header Matrix

With no Access session:

```bash
assert_access_intercepted https://dtx.hapadona.com/app
assert_access_intercepted https://dtx.hapadona.com/app/
assert_access_intercepted https://dtx.hapadona.com/app/score
assert_access_intercepted https://dtx.hapadona.com/app/__data.json

assert_no_access_interception https://dtx.hapadona.com/
assert_no_access_interception https://dtx.hapadona.com/blog
assert_no_access_interception https://dtx.hapadona.com/preview/1
assert_no_access_interception https://dtx.hapadona.com/editor
assert_no_access_interception https://dtx.hapadona.com/tool/dtx-to-midi
assert_no_access_interception https://dtx.hapadona.com/game
assert_no_access_interception https://dtx.hapadona.com/login
assert_no_access_interception https://dtx.hapadona.com/auth/callback
assert_no_access_interception https://api.dtx.hapadona.com/
assert_no_access_interception https://api.pre-prod.dtx.hapadona.com/
```

Every command must exit `0`.

`/app/` is an explicit path-semantics probe. `/app/__data.json` proves framework data requests are inside the gate. `/preview/1` exercises a real public preview route.

## 8. Production Identity And Posture Checks

Prove the policy clauses independently:

1. Allowed operator identity + trusted device: allowed.
2. Same trusted device + fresh browser profile + a second IdP identity not in the policy `Include`: denied by Access.
3. Allowed operator identity + device that fails posture: denied by Access.

A second Supabase identity is not a substitute for check 2.

## 9. Trusted Production Browser Check

On the trusted operator device:

1. Open `/app` and pass Access.
2. With no Supabase session, confirm DTXWeb redirects to public `/login`.
3. Complete Supabase login and return to protected `/app`.
4. Sign out of Supabase and confirm `/app` remains Access-protected.

Characterize the expected non-operator dead end separately:

1. Sign in on public `/login` with a Supabase account that does not correspond to the allowed Access identity.
2. Confirm the `/app` return is denied.
3. Confirm revisiting `/login` while that Supabase session exists redirects back to denied `/app` and no public sign-out UI is reachable.
4. Recover by clearing the production Drumery/Supabase cookies.

Do not widen Access to make the non-operator account work.

## 10. Access Session Expiry / Client-side Navigation

On the trusted operator device with a valid Supabase session:

1. Keep a tab on a public production page.
2. End the Access session using the tenant's normal Access logout/session-clearing procedure.
3. Trigger SvelteKit client-side navigation into `/app`.
4. Record what the UI displays when the protected data request requires Access again.
5. Directly navigate/reload `/app` and confirm the operator can reauthenticate and recover.

An opaque client-navigation error with successful direct reload is a documented UX follow-up. Failure to recover on direct `/app` navigation is a production acceptance failure.

## 11. Production Desktop Login

### Bundled desktop

1. Start desktop login and confirm the browser opens public `/login?redirect=desktop&desktop_callback=...` without Access interception.
2. Complete password login and confirm protected `/app?redirect=desktop...` succeeds.
3. Confirm `dtx://auth-callback` authenticates the desktop app.
4. Repeat with Google login.

### Standalone `tauri dev`

Using the current standalone development setup targeting deployed production:

1. Start `bun run dev:desktop`.
2. Keep login/callback in the same browser tab.
3. Complete password login and pass protected `/app`.
4. Confirm the callback reaches `http://127.0.0.1:<configured-port>/auth-callback`.
5. Repeat with Google login.

The full local-stack `bun run dev` path is not an Access acceptance test because it intentionally uses localhost.

# Rollback

## Rollback — Pre-production

Normal state-aware rollback:

```bash
pulumi preview --destroy --stack pre-prod
```

Confirm the destroy preview deletes **only** `DTXWeb Pre-prod`, then run:

```bash
pulumi destroy --stack pre-prod --yes
```

Do not touch production.

## Rollback — Production

Normal state-aware rollback:

```bash
pulumi preview --destroy --stack production
```

Confirm the destroy preview deletes **only** `DTXWeb Production App`, then run:

```bash
pulumi destroy --stack production --yes
```

Do not destroy pre-production merely because production failed.

## Emergency Fallback — Pulumi State/Backend Unavailable

If immediate Access removal is necessary but the local Pulumi backend/state cannot be accessed, use the Cloudflare Zero Trust dashboard as the emergency provider-side recovery path:

1. Open **Zero Trust > Access controls > Applications**.
2. Locate exactly `DTXWeb Pre-prod` or `DTXWeb Production App`.
3. Disable/delete only the affected DTXWeb application.
4. Do not alter Perseus posture resources or any other Access application.
5. Do not create a temporary bypass/service token/wider application.

When Pulumi state becomes available again, reconcile the provider-side deletion before the next `pulumi up`; do not apply stale state blindly.

# Final Non-sensitive Record

Record only outcomes such as:

```text
Infrastructure unit/coverage checks: PASS
Affected-scope CI contract: PASS
Pre-prod Pulumi preview: PASS
Pre-prod Access apply + verification: PASS
Production Pulumi preview: PASS
Production public/protected route matrix: PASS
Production Access identity selector: PASS
Production posture selector: PASS
Production operator browser auth: PASS
Production expired-session recovery characterized: PASS
Production bundled desktop login: PASS
Production standalone tauri-dev login: PASS
```

Never paste secrets, identities, device serials, Access tokens/cookies/JWTs, or sensitive screenshots into the record.

# References

- Design: `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md`
- Operator precedent: `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`
- Perseus Access implementation: `packages/infrastructure/src/admin-access.ts` in the Perseus repository
- Cloudflare Access application API: https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/
- Pulumi DIY/local backend: https://www.pulumi.com/docs/iac/operations/stack-management/using-a-diy-backend/
- Pulumi destroy troubleshooting: https://www.pulumi.com/docs/iac/operations/troubleshooting/destroy-failures/