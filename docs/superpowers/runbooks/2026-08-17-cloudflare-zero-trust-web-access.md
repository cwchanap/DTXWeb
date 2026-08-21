# Cloudflare Zero Trust Web Access Runbook (operator-executed)

This is the live operator procedure for DTXWeb Cloudflare Access. Steps that mutate Cloudflare, require interactive identity/device checks, or require browser observation are performed by a human operator, not by an implementation agent.

## Scope

| Stack        | Application             | Protection scope                                         |
| ------------ | ----------------------- | -------------------------------------------------------- |
| `pre-prod`   | `DTXWeb Pre-prod`       | entire `pre-prod.dtx.hapadona.com` hostname              |
| `production` | `DTXWeb Production App` | `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` only |

Wrangler continues to own Worker/API/runtime infrastructure. Both API hostnames remain outside Access.

DTXWeb reuses the Perseus-managed device-posture rule by Cloudflare resource ID. Do not create another serial list/posture rule, service token, Service Auth policy, API Access app, bypass policy, or wider production destination.

## Production State — Live, Local Pulumi Backend

Both DTXWeb Access applications are already live. Their state remains managed by the local Pulumi backend until the remote-state migration gate; no Pulumi Cloud or GitHub Actions deployment automation is enabled in PR A.

Until that migration gate is complete, use only the manual, operator-reviewed Pulumi apply path in this runbook. Do not use an automatic workflow before remote state migration.

The queued Better Auth/D1 migration removes the current desktop callback/magic-link flow, adds Device Authorization approval at `/app/desktop-auth`, and explicitly schedules reconciliation of PR #221's Zero Trust documents. Re-run the relevant identity, posture, browser, session, and desktop acceptance checks after that migration.

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

Set `CLOUDFLARE_API_TOKEN` in the operator shell to an account-scoped token whose only permission is account-level `Access: Apps and Policies Edit` for the target account. The token must not carry Workers, DNS, D1, R2, or API-token-management permissions, and a Global API Key must never be used.

## Select Existing Stacks And Verify Live IDs

```bash
cd packages/infrastructure
pulumi stack select pre-prod || {
  echo 'FAIL: expected the existing local pre-prod stack; refusing to initialize a new stack' >&2
  exit 1
}
pulumi stack select production || {
  echo 'FAIL: expected the existing local production stack; refusing to initialize a new stack' >&2
  exit 1
}

for stack in pre-prod production; do
  access_application_id="$(pulumi stack output accessApplicationId --stack "$stack")" || exit 1
  if [ -z "$access_application_id" ]; then
    echo "FAIL: $stack has no accessApplicationId output; refusing preview/apply" >&2
    exit 1
  fi
done
unset access_application_id stack
```

Both stack selections must succeed because these applications already exist. The output check
proves each existing local stack exposes a non-empty `accessApplicationId` before any preview or
apply; the identifier is captured for the check and is not printed in evidence. Never replace a
failed selection with `pulumi stack init`.

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

## Committed Boundary Verifier

Use unauthenticated requests with no Access cookies. Run the version-controlled verifier from the repository root:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

The script accepts only the two supported environments, requests each environment's exact protected and public route matrix, recognizes only an HTTPS `3xx` redirect matching `^https://([[:alnum:]-]+\.)+cloudflareaccess\.com(:[0-9]+)?([/?#]|$)` or HTTP `403` with both `cf-access-aud` and `cf-access-domain`, and fails closed on DNS, TLS, connection, timeout, malformed-response, and unsupported-environment errors. It prints status and header/redirect presence with values redacted; never record header values.

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

Pre-production Access is already applied. For a reviewed operator-only change while the state remains local, use:

```bash
pulumi up --stack pre-prod
```

Review the interactive Pulumi confirmation. Approve only the expected `DTXWeb Pre-prod` Access application change.

## 3. Pre-production Boundary Verification

With no Access session, run the committed verifier from the repository root:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
```

It checks the complete pre-production protected-route matrix and confirms that `https://api.pre-prod.dtx.hapadona.com/` is outside Access. The command must exit `0`.

## 4. Pre-production Human Checks

On the trusted device with the configured operator identity:

1. enter the pre-production hostname through Access;
2. complete the current web login flow;
3. confirm `/app` works behind Access and can use the API;
4. complete the current Google login/OAuth flow;
5. from a device that fails the shared posture rule, confirm the hostname is denied before DTXWeb loads.

The application auth mechanism will change during the queued Better Auth cutover; re-run the relevant pre-production auth acceptance after that migration. The Access hostname-wide boundary itself does not change.

If required Access/header/device checks fail, use the rollback section below.

# Phase 2 — Production (Live, Local Backend)

Production Access is already applied and managed from the local Pulumi backend. Its live scope is exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`; public production routes and the API hostname remain outside Access.

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

For a reviewed operator-only change while the state remains local, use the manual apply command:

```bash
pulumi up --stack production
```

Do not use an automatic workflow before remote state migration. The Better Auth/D1 cutover must still be reconciled with this runbook's final `/app/desktop-auth` Device Authorization flow before its browser and desktop acceptance checks are considered current.

Verify the live production boundary with the committed script:

```bash
packages/infrastructure/scripts/verify-access.sh production
```

# Rollback — Pre-production

Destroying pre-production Access returns `pre-prod.dtx.hapadona.com` to its prior public state.

Before destroy, determine which Wrangler environment currently serves the pre-production hostname. In particular, `pre-prod-prod-data` binds the same pre-production hostname to an API environment using production D1/R2 resources. If that mode is active, removing Access can make a production-data-backed web surface public.

If public exposure is not acceptable, keep Access in place while repairing the rollout or first move the pre-production deployment away from production-backed data. Do not treat Access destroy as a neutral cleanup.

There is no automatic rollback. Because the Access application resource is registered with
`{ protect: true }`, a normal destroy path fails closed rather than deleting it:

```bash
pulumi preview --destroy --stack pre-prod
```

If that separately reviewed rollback is explicitly approved, unprotect only the exact pre-production
Access resource immediately before rerunning the preview:

```bash
pulumi state unprotect 'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication::dtxweb-pre-prod-access' --stack pre-prod
pulumi preview --destroy --stack pre-prod
```

Confirm the only deletion is `DTXWeb Pre-prod`, then:

```bash
pulumi destroy --stack pre-prod --yes
```

Unprotecting and destroying is a separately reviewed, one-time exception to the normal deletion
guard. The source program still declares this application, so a later `pulumi up` will recreate it
unless the desired source and Pulumi state are deliberately reconciled first. Do not turn this
exception into an automated rollback.

# Emergency Fallback — Pulumi Backend/State Unavailable

If immediate Access removal is required but the local Pulumi backend/state cannot be accessed:

1. open **Zero Trust > Access controls > Applications**;
2. locate exactly `DTXWeb Pre-prod` or `DTXWeb Production App`;
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
Production Access live boundary: PASS (already applied; local Pulumi backend)
Production Access changes: manual operator apply only until remote state migration
```

Never paste secrets, identities, device serials, Access tokens/cookies/JWTs, or sensitive screenshots.

# References

- Design: `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md`
- Operator precedent: `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`
- queued Better Auth/D1 migration plan: Task 9 and Task 14
- Perseus Access implementation: `packages/infrastructure/src/admin-access.ts` in the Perseus repository
