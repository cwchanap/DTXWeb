# Cloudflare Zero Trust Web Access Runbook (operator-executed)

This is the live operator procedure for DTXWeb Cloudflare Access. Steps that mutate Cloudflare, require interactive identity/device checks, or require browser observation are performed by a human operator, not by an implementation agent.

## Scope

| Stack | Application | Protection scope |
| --- | --- | --- |
| `pre-prod` | `DTXWeb Pre-prod` | entire `pre-prod.dtx.hapadona.com` hostname |
| `production` | `DTXWeb Production App` | `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` only |

Wrangler continues to own Worker/API/runtime infrastructure. Both API hostnames remain outside Access.

DTXWeb reuses the Perseus-managed device-posture rule by Cloudflare resource ID. Do not create another serial list/posture rule, service token, Service Auth policy, API Access app, bypass policy, or wider production destination.

## Production Hold — Better Auth/D1 Cutover

**Do not run `pulumi up --stack production` yet.**

The queued Better Auth/D1 migration removes the current desktop callback/magic-link flow, adds Device Authorization approval at `/app/desktop-auth`, and explicitly schedules reconciliation of PR #221's Zero Trust documents.

Pre-production Access may be applied and verified now. Production preview may be used as a non-mutating scope check. Production live apply remains blocked until the Better Auth cutover has landed and this runbook has been reconciled with the final Device Authorization/browser acceptance flow.

Removing this hold requires a later reviewed update to this runbook; do not treat the absence of technical errors from `pulumi preview --stack production` as permission to apply.

## Pulumi Backend And Secrets

From `packages/infrastructure`:

```bash
pulumi login --local
```

The default local filesystem backend is under the operator's home directory (`~/.pulumi`). The repository also ignores project-local `.pulumi/` defensively.

Never commit or paste into PRs/logs:

- operator email;
- Cloudflare API token;
- device serials;
- Access cookies/JWTs;
- `Pulumi.<stack>.yaml` files;
- Pulumi state exports;
- screenshots containing security identifiers.

Use `accessEmail` as Pulumi secret config. `devicePostureRuleId` is a non-secret Cloudflare resource ID.

## Cloudflare API Credential

Set `CLOUDFLARE_API_TOKEN` in the operator shell with the least privilege needed for the Access application lifecycle. Use the Cloudflare Access apps/policies write permission required by the selected provider/API; do not use a Global API Key.

## Initialize Or Select Stacks

```bash
cd packages/infrastructure
pulumi stack select pre-prod || pulumi stack init pre-prod
pulumi stack select production || pulumi stack init production
```

Configure both stacks from local shell variables:

```bash
pulumi config set cloudflareAccountId "$DTX_CLOUDFLARE_ACCOUNT_ID" --stack pre-prod
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack pre-prod
pulumi config set devicePostureRuleId "$DTX_DEVICE_POSTURE_RULE_ID" --stack pre-prod

pulumi config set cloudflareAccountId "$DTX_CLOUDFLARE_ACCOUNT_ID" --stack production
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack production
pulumi config set devicePostureRuleId "$DTX_DEVICE_POSTURE_RULE_ID" --stack production
```

Optional explicit session duration:

```bash
pulumi config set accessSessionDuration 12h --stack pre-prod
pulumi config set accessSessionDuration 12h --stack production
```

Hostnames and production destinations are code-owned; do not add them as config.

## Preflight — Shared Posture Rule Must Match Perseus

This check replaces the old "remember to update the ID" instruction.

Set `PERSEUS_INFRA_DIR` to the local Perseus `packages/infrastructure` directory. Ensure that directory is logged into the correct Pulumi backend and has the production Perseus stack selected, then run from the DTXWeb infrastructure directory:

```bash
: "${PERSEUS_INFRA_DIR:?set PERSEUS_INFRA_DIR to Perseus packages/infrastructure}"

PERSEUS_POSTURE_RULE_ID="$(
  cd "$PERSEUS_INFRA_DIR" &&
    pulumi stack output adminAccessDevicePostureRuleId
)" || exit 1

test -n "$PERSEUS_POSTURE_RULE_ID" || {
  echo 'FAIL: Perseus posture-rule output is empty' >&2
  exit 1
}

for stack in pre-prod production; do
  configured="$(pulumi config get devicePostureRuleId --stack "$stack")" || exit 1
  if [ "$configured" != "$PERSEUS_POSTURE_RULE_ID" ]; then
    echo "FAIL: $stack devicePostureRuleId does not match current Perseus rule" >&2
    exit 1
  fi
done

unset configured PERSEUS_POSTURE_RULE_ID
```

Any mismatch is a hard stop before preview or apply.

## Preflight — Repository Gates And Build

Run from the DTXWeb repository root before every rollout session:

```bash
bun install --frozen-lockfile
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure build
.github/scripts/ci-affected-scope.test.sh
bun run lint
bunx prettier --check .
```

All commands must pass. `build` is mandatory because `Pulumi.yaml` executes `dist/index.js`; do not preview stale or missing compiled output.

If any infrastructure source changes after this block, rebuild before the next preview.

## Header Verification Helpers

Use unauthenticated requests with no Access cookies. DNS, connection, TLS, and timeout failures must fail loudly rather than count as public/unprotected success.

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

Before applying DTXWeb Access:

- if the tenant uses redirect-based Access interception, set an uncommitted `ACCESS_REDIRECT_RE` matching the known Perseus flow;
- prove `assert_access_intercepted` passes against a known protected Perseus URL;
- prove `assert_no_access_interception https://dtx.hapadona.com/` passes before production Access exists;
- prove `http_headers https://this-host-does-not-exist-zzz.hapadona.com/` exits non-zero.

Do not continue if the invalid-host check succeeds.

# Phase 1 — Pre-production

## 1. Preview Pre-production

From `packages/infrastructure`, after the build/preflight:

```bash
pulumi preview --stack pre-prod
```

The preview must contain only the DTXWeb pre-production Access application with:

- name `DTXWeb Pre-prod`;
- self-hosted type;
- hostname-wide destination `pre-prod.dtx.hapadona.com`;
- one allow policy using configured email Include + existing posture Require;
- no API hostname;
- no posture/list/service-token/Worker/storage resource.

Any extra resource or different scope is a hard stop.

## 2. Apply Pre-production — Operator Only

```bash
pulumi up --stack pre-prod
```

Review the interactive Pulumi confirmation. Approve only the expected `DTXWeb Pre-prod` Access application change.

## 3. Pre-production Header Matrix

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

On the trusted device with the configured operator identity:

1. enter the pre-production hostname through Access;
2. complete the current web login flow;
3. confirm `/app` works behind Access and can use the API;
4. complete the current Google login/OAuth flow;
5. from a device that fails the shared posture rule, confirm the hostname is denied before DTXWeb loads.

The application auth mechanism will change during the queued Better Auth cutover; re-run the relevant pre-production auth acceptance after that migration. The Access hostname-wide boundary itself does not change.

If required Access/header/device checks fail, use the rollback section below.

# Phase 2 — Production (BLOCKED)

Production Access is intentionally not applied in this version of the runbook.

A non-mutating preview is allowed after the normal build/preflight:

```bash
pulumi preview --stack production
```

It must show exactly one `DTXWeb Production App` with only:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

Hard stops include hostname-wide production Access, API/public destinations, posture/list/token resources, or runtime infrastructure.

**Do not run `pulumi up --stack production`.**

Before production apply is allowed, the Better Auth/D1 cutover must land and Task 14 must reconcile this runbook with the final `/app/desktop-auth` Device Authorization flow. That reconciliation must restore the production route matrix plus independent identity/posture, browser, session-expiry, and desktop acceptance checks for the new auth system.

# Rollback — Pre-production

Destroying pre-production Access returns `pre-prod.dtx.hapadona.com` to its prior public state.

Before destroy, determine which Wrangler environment currently serves the pre-production hostname. In particular, `pre-prod-prod-data` binds the same pre-production hostname to an API environment using production D1/R2 resources. If that mode is active, removing Access can make a production-data-backed web surface public.

If public exposure is not acceptable, keep Access in place while repairing the rollout or first move the pre-production deployment away from production-backed data. Do not treat Access destroy as a neutral cleanup.

When public rollback is explicitly acceptable:

```bash
pulumi preview --destroy --stack pre-prod
```

Confirm the only deletion is `DTXWeb Pre-prod`, then:

```bash
pulumi destroy --stack pre-prod --yes
```

# Emergency Fallback — Pulumi Backend/State Unavailable

If immediate Access removal is required but the local Pulumi backend/state cannot be accessed:

1. open **Zero Trust > Access controls > Applications**;
2. locate exactly `DTXWeb Pre-prod` (or, after the future production hold is removed, `DTXWeb Production App`);
3. disable/delete only that DTXWeb application;
4. do not alter Perseus posture resources or unrelated Access applications;
5. do not create a bypass/service token/wider application.

When Pulumi state is available again, reconcile the provider-side change before any later `pulumi up`.

# Final Non-sensitive Record

Record only outcomes, for example:

```text
Infrastructure unit/coverage checks: PASS
Affected-scope CI contract: PASS
Private-route boundary test: PASS
Perseus posture-rule ID matches both DTXWeb stack configs: PASS
Pre-prod Pulumi preview: PASS
Pre-prod Access apply + verification: PASS
Production Pulumi preview: PASS or NOT RUN
Production Access apply: BLOCKED pending Better Auth reconciliation
```

Never paste secrets, identities, device serials, Access tokens/cookies/JWTs, or sensitive screenshots.

# References

- Design: `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md`
- Operator precedent: `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`
- queued Better Auth/D1 migration plan: Task 9 and Task 14
- Perseus Access implementation: `packages/infrastructure/src/admin-access.ts` in the Perseus repository
