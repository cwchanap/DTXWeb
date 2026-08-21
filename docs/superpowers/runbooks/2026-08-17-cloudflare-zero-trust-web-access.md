# Cloudflare Zero Trust Web Access Runbook

This runbook describes the active Pulumi Cloud deployment path for DTXWeb Cloudflare Access and
the human checks that automation cannot perform. Pulumi updates and unauthenticated boundary
checks are automatic; trusted-device admission, denied-device rejection, and emergency dashboard
operations remain human procedures.

## Scope

| Stack        | Application             | Protection scope                                         |
| ------------ | ----------------------- | -------------------------------------------------------- |
| `pre-prod`   | `DTXWeb Pre-prod`       | entire `pre-prod.dtx.hapadona.com` hostname              |
| `production` | `DTXWeb Production App` | `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` only |

Wrangler continues to own Worker, API, D1, R2, and other runtime infrastructure. Both API
hostnames remain outside Access. DTXWeb reuses the Perseus-managed device-posture rule; do not
create another posture rule, serial list, service token, Service Auth policy, bypass policy, API
Access application, or wider production destination.

## Current deployment ownership

The migration to Pulumi Cloud is complete. The live applications are managed by these exact
remote stacks:

- `cwchanap/dtxweb-infrastructure/pre-prod`
- `cwchanap/dtxweb-infrastructure/production`

The committed `packages/infrastructure/Pulumi.pre-prod.yaml` and
`packages/infrastructure/Pulumi.production.yaml` files use Pulumi Cloud's `default` secrets
provider. They contain encrypted `accessEmail` configuration and non-secret
`devicePostureRuleId` and `cloudflareAccountId` configuration. The application names,
destinations, policy shape, session duration, and browser flags remain code-owned.

Local passphrase state is retired. CI does not set or use `PULUMI_CONFIG_PASSPHRASE`, and there is
no local-backend apply path. Do not initialize replacement stacks or pass runtime config that
would replace the committed settings. The repository's existing `CLOUDFLARE_ACCOUNT_ID` variable
remains available to workflows that already use it; the Access workflow reads the committed
account configuration instead. `PULUMI_ORG` is the repository variable used for Pulumi Cloud
authentication.

Each job uses its own GitHub Environment, with only the dedicated secret
`CLOUDFLARE_ACCESS_API_TOKEN`:

- `dtx-access-pre-prod`
- `dtx-access-production`

The secret is exposed to the Pulumi provider only as `CLOUDFLARE_API_TOKEN`. It must have only
account-level Cloudflare `Access: Apps and Policies Edit` for the target account, with no Workers,
DNS, D1, R2, token-management, or Global API Key privileges. Never print or record the token,
operator email, posture-rule ID, account ID, application ID, ciphertext, cookies, or Pulumi stack
state.

## Automatic deployment paths

`.github/workflows/deploy-cloudflare-access.yml` runs on either:

1. a push to `main` that changes `packages/infrastructure/**`, `bun.lock`, the root `package.json`,
   `tsconfig.base.json`, or the deployment workflow itself; or
2. `workflow_dispatch` from `main` for a recovery rerun.

Both paths run the same serial sequence:

```text
deploy-pre-prod: check -> test:coverage -> build -> verify dist/index.js -> Pulumi up --refresh -> boundary verifier
deploy-production: check -> test:coverage -> build -> verify dist/index.js -> Pulumi up --refresh -> boundary verifier
```

The production job has `needs: deploy-pre-prod`, so a pre-production check, update, or boundary
failure prevents production from starting. Each job authenticates to Pulumi Cloud through GitHub
OIDC with `id-token: write`, runs one `pulumi/actions` `up` with `refresh: true`, suppresses stack
outputs, and then invokes the committed verifier. The workflow uses no pull-request deploy,
standalone recurring preview, automatic rollback, or automatic destroy. A dispatch from a ref
other than `main` is not an automatic deployment because both jobs guard the `main` ref. Its
workflow/ref concurrency uses `cancel-in-progress: false`, so a newer run waits for an active
deployment instead of interrupting it.

Pulumi Cloud trusts only the workflow's configured organization and the two exact GitHub
Environment subjects, with audience `urn:pulumi:org:cwchanap`:

- `repo:cwchanap/DTXWeb:environment:dtx-access-pre-prod`
- `repo:cwchanap/DTXWeb:environment:dtx-access-production`

`pulumi/auth-actions` exchanges the job's GitHub OIDC identity for a runtime Pulumi Cloud access
token, exports it as `PULUMI_ACCESS_TOKEN` for the following `pulumi/actions` step, and requires
no stored long-lived secret. The requested token type (personal) and `user:cwchanap` scope
describe that runtime exchange, not a stored credential.

During migration, both live named applications were reverified against their intended scopes,
refreshed, protected in Pulumi Cloud state, and checked with the complete boundary matrices. That
baseline does not replace the boundary verification after each automatic update or the human
admission checks after security-policy changes.

## Resource protection and intentional changes

Both Access resources are declared with `protect: true`, and the protection bit is persisted in
Pulumi Cloud state. Normal in-place updates are allowed, but Pulumi refuses deletion or
replacement. The automatic workflow never unprotects, destroys, or rolls back a resource.

An intentional replacement or deletion requires a separately reviewed, one-time unprotect
operation on the exact resource, followed by a fresh preview and explicit approval. Do not weaken
the resource protection or turn this exception into an automated workflow step.

## Pulumi posture preflight

The committed `devicePostureRuleId` values must continue to match the current Perseus production
`adminAccessDevicePostureRuleId` output. Before applying a change to identity, posture, policy, or
tenant settings, use an authenticated Pulumi Cloud CLI session and explicitly query the canonical
`cwchanap/perseus-infrastructure/production` stack while comparing both remote stacks without
printing either value:

```bash
: "${PERSEUS_INFRA_DIR:?set PERSEUS_INFRA_DIR to Perseus packages/infrastructure}"

PERSEUS_POSTURE_RULE_ID="$({
  cd "$PERSEUS_INFRA_DIR" &&
    pulumi stack output adminAccessDevicePostureRuleId \
      --stack cwchanap/perseus-infrastructure/production
})" || exit 1

test -n "$PERSEUS_POSTURE_RULE_ID" || {
  echo 'FAIL: Perseus posture-rule output is empty' >&2
  exit 1
}

for stack in \
  cwchanap/dtxweb-infrastructure/pre-prod \
  cwchanap/dtxweb-infrastructure/production; do
  configured="$(pulumi config get devicePostureRuleId --stack "$stack" -C packages/infrastructure)" || exit 1
  if [ "$configured" != "$PERSEUS_POSTURE_RULE_ID" ]; then
    echo "FAIL: $stack devicePostureRuleId does not match current Perseus rule" >&2
    exit 1
  fi
done

unset configured stack PERSEUS_POSTURE_RULE_ID
```

Any mismatch is a hard stop. Do not add a cross-repository `StackReference` or a CI checkout of
Perseus to bypass this human preflight.

## Version-controlled boundary verifier

Run the committed verifier from the repository root with no Access cookies:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

The script accepts only `pre-prod` and `production`, fails closed on DNS, TLS, connection,
timeout, malformed-response, and unsupported-environment errors, and prints only redacted status,
redirect, and Access-header presence. It recognizes only the strict HTTPS `3xx`
`cloudflareaccess.com` redirect or HTTP `403` with both `cf-access-aud` and `cf-access-domain`.
Never record header values, cookies, or redirect values.

The script owns these exact matrices. Do not replace it with an ad hoc route check:

- Pre-production protects `/`, `/login`, `/auth/callback`, `/blog`, `/preview/1`, `/editor`,
  `/tool/dtx-to-midi`, `/game`, `/app`, `/app/`, `/app/score`, and `/app/__data.json` on
  `pre-prod.dtx.hapadona.com`; `https://api.pre-prod.dtx.hapadona.com/` remains public.
- Production protects `/app`, `/app/`, and `/app/score` on `dtx.hapadona.com`; `/`, `/login`,
  `/auth/callback`, `/blog`, `/preview/1`, `/editor`, `/tool/dtx-to-midi`, and `/game` on that
  host remain public, as does `https://api.dtx.hapadona.com/`.

The production matrix is intentionally `/app`-only. A response outside that boundary must not be
treated as an Access success.

## Human admission checks

An unauthenticated runner cannot satisfy the operator identity and shared WARP posture rule. After
any change to `accessEmail`, `devicePostureRuleId`, the Access policy, or relevant Cloudflare
identity/posture settings:

1. Run the relevant version-controlled verifier.
2. On the configured identity and a trusted device, enter the protected application through
   Access and confirm the current browser login, `/app`, and API use work.
3. From a device that fails the shared posture rule, request the same protected surface and confirm
   Access denies the request before DTXWeb loads.

For pre-production, also complete the current Google login/OAuth flow. For production, confirm the
current `/app` browser flow and API use after the serial deployment completes. These checks are
manual admission evidence; the boundary script does not prove them.

The queued Better Auth/D1 migration is a future acceptance gate. It must add the `/app/desktop-auth`
Device Authorization flow and then restore separate desktop approval, browser login, identity and
posture, and session-expiry checks. Re-run those desktop/browser/session-expiry checks after that
migration and whenever its auth contract changes. The current repository and boundary matrices do
not claim to verify that future flow.

## Phase 1 — Pre-production

The `deploy-pre-prod` job is the first half of every normal deployment and every recovery
dispatch. It runs the infrastructure checks, coverage suite, build, Pulumi Cloud update with live
provider refresh, and the complete pre-production verifier before production can start.

The desired pre-production shape is:

- `DTXWeb Pre-prod` with a hostname-wide `pre-prod.dtx.hapadona.com` destination;
- one allow policy with the configured email in `Include` and the existing Perseus posture rule in
  `Require`;
- no API hostname, production destination, extra posture/list/token resource, or runtime resource.

If the job fails, repair the source or configuration and rerun the same serial path from `main`.
There is no automatic rollback or production bypass.

## Phase 2 — Production

Production starts only after `deploy-pre-prod` succeeds. The `deploy-production` job repeats the
checks, builds the Pulumi entrypoint, runs one refreshed update against
`cwchanap/dtxweb-infrastructure/production`, and verifies the production boundary.

The desired production shape is exactly:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

Public production routes and `https://api.dtx.hapadona.com/` remain outside Access. Any
hostname-wide production protection, API/public destination, extra policy/resource, or runtime
change is a hard stop. A production boundary failure may mean the desired configuration is already
live; correct the source/configuration and rerun the serial deployment rather than using a
provider-side rollback.

## Rollback — Pre-production

Removing pre-production Access returns `pre-prod.dtx.hapadona.com` to its prior public state.
Before any separately reviewed rollback, determine which Wrangler environment serves the
pre-production hostname. In particular, `pre-prod-prod-data` binds the same hostname to an API
environment using production D1/R2 resources. Removing Access can therefore expose
production-data-backed content. If that exposure is not acceptable, keep Access in place while
repairing the deployment or first move pre-production away from production-backed data.

The normal automatic path never destroys or rolls back a protected application. If an intentional
pre-production deletion is separately reviewed and approved, authenticate to Pulumi Cloud,
unprotect only the exact resource, inspect the destroy preview, and then perform the one-time
destroy:

```bash
pulumi state unprotect \
  'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication::dtxweb-pre-prod-access' \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi preview --destroy --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi destroy --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
```

Confirm the preview contains only `DTXWeb Pre-prod` before the destroy. If the preview is
rejected, or the destroy is cancelled or fails while the application still exists in Pulumi state,
re-protect the exact resource and confirm the protection bit before exiting:

```bash
pulumi state protect \
  'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication::dtxweb-pre-prod-access' \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Unprotecting and deleting
is a separately reviewed exception to the normal protection guard. The source program still
declares the application, so a later automatic update will reconcile the desired declaration;
reconcile source and Pulumi state deliberately before any future deployment.

## Emergency fallback — Pulumi Cloud/state unavailable

If immediate Access removal is required but Pulumi Cloud or its state cannot be accessed:

1. Open **Zero Trust > Access controls > Applications**.
2. Locate exactly `DTXWeb Pre-prod` or `DTXWeb Production App`.
3. Disable only that named DTXWeb application; delete it only if disabling is insufficient.
4. Do not alter Perseus posture resources or unrelated Access applications.
5. Do not create a bypass, service token, or wider application.

This dashboard procedure is an emergency exception, not a deployment path, and disablement and
deletion reconcile differently:

- A dashboard-disabled application is not reconciled by the automatic workflow, because the
  program does not manage the disabled flag. Re-enable that exact application through the Zero
  Trust dashboard or the Cloudflare Access API, then re-run the version-controlled verifier for
  the affected environment before closing the incident.
- A dashboard-deleted application is recreated by the next `pulumi up`, because every workflow
  update uses `refresh: true` and queries the live provider. Before the next automated run,
  reconcile the provider-side change into the Pulumi program and commit the intended source
  change; reconciling only a Pulumi checkpoint is not sufficient.

Do not record dashboard screenshots or responses containing security identifiers.

## Final non-sensitive record

Record outcomes without values, for example:

```text
Pulumi Cloud stack migration and protected state: PASS
Pre-production automatic job: PASS or NOT RUN
Pre-production boundary matrix: PASS or NOT RUN
Production automatic job: PASS or NOT RUN
Production boundary matrix: PASS or NOT RUN
Trusted-device admission: PASS or NOT RUN
Denied-device rejection: PASS or NOT RUN
Future Better Auth desktop/browser/session-expiry gate: NOT RUN until migration lands
Emergency dashboard reconciliation: NOT RUN unless invoked
```

Never paste secrets, identities, device serials, account IDs, application IDs, posture-rule IDs,
Pulumi ciphertext, stack-state contents, Access tokens/cookies/JWTs, or sensitive screenshots.

## References

- Current automation design: `docs/superpowers/specs/2026-08-20-cloudflare-access-automation-design.md`
- Automation implementation plan: `docs/superpowers/plans/2026-08-20-cloudflare-access-automation.md`
- Version-controlled verifier: `packages/infrastructure/scripts/verify-access.sh`
- Historical Zero Trust design: `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`
- Queued Better Auth/D1 migration plan: Task 9 and Task 14
- Perseus Access implementation: `packages/infrastructure/src/admin-access.ts` in the Perseus repository
