# DTXWeb Pulumi Cloudflare Infrastructure Runbook

This is the current operator completion manual for the DTXWeb Cloudflare ownership migration.
Do not print or record tokens, email addresses, cookies, account/application/posture identifiers,
Pulumi ciphertext, stack exports, or private API responses.

## Ownership boundary

| Owner                          | Owns                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pulumi (`@dtx/infrastructure`) | Cloudflare Access applications/policies, the permanent D1 databases, the permanent R2 buckets, the active rate-limit KV namespaces, and two Worker custom domains per stack |
| Wrangler                       | Worker release/configuration, bindings/vars/secrets, D1 schema migrations, Workflows, Containers, Durable Object definitions/migrations, and runtime rollback               |

Pulumi owns resource identity and lifecycle, not Worker release configuration. D1 and R2 use
`protect: true` and `retainOnDelete: true`; KV, Access, and custom domains use `protect: true`.
The four permanent data resources are `dtx-web-preprod`, `dtx-web`, `simfile-dtx-preprod`, and
`simfile-dtx`. A preview proposing a D1/R2 create, replacement, or delete is a hard stop.
Never run `pulumi destroy` for either stack.

The stacks are:

- `cwchanap/dtxweb-infrastructure/pre-prod`: Access covers the whole
  `pre-prod.dtx.hapadona.com` hostname; the API hostname remains public.
- `cwchanap/dtxweb-infrastructure/production`: Access covers only
  `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`; public production paths and the API
  hostname remain outside Access.

## Current execution state

As of the 2026-08-29 execution:

- **DONE, live:** the Access-only workflow record `Deploy Cloudflare Access` is disabled and stays
  disabled until merge.
- **DONE, live:** pre-production Access, D1, R2, KV, and both Worker custom domains were imported
  and adopted through a no-op Pulumi update. Wrangler routes were removed, `workers_dev: false`
  was set for both pre-production Workers, both Workers were redeployed, and the pre-production
  boundary verifier is green.
- **Soak clock:** started at `2026-08-29T21:55:04Z`; the 24-hour alias soak deadline is about
  `2026-08-30T21:55:04Z`. The operator owns the clock and must not delete aliases before the gate.
- **DONE, code-only:** production imports and the earlier targeted non-Access preview are complete.
  A fresh preview from this worktree is blocked because its Cloudflare credential cannot refresh
  provider resources. Production Pulumi apply, production API/web deploys, and the post-deploy
  production verifier remain manual gates below. Production route removal and `workers_dev: false`
  take effect at that deploy.

## Local development

The top-level Wrangler configuration is local-only. Do not select a remote pre-production
environment for normal development.

```bash
# Normal development: applies pending local D1 migrations, then starts local API/web/desktop.
bun run dev

# Deterministic reset path: wipes local Miniflare state, reapplies migrations, records migration
# history, seeds local D1 rows, and puts the local R2 fixtures.
bun run dev:seed
bun run dev
```

The direct migration command is:

```bash
bun run migrate:api:local
```

It targets `.wrangler/state` only. `bun run dev:seed` is the explicit reset path; it is not a
production or pre-production operation.

## Workflow disable, import, and recovery

The authoritative deployment workflow is
`.github/workflows/deploy-cloudflare-infrastructure.yml`. It runs on relevant `main` changes or
`workflow_dispatch` from `main`, checks/builds/tests each stack, updates pre-production first,
verifies it, then updates production and verifies it. The job environments remain
`dtx-access-pre-prod` and `dtx-access-production`.

Before any new import or state mutation, verify that the old Access-only workflow is disabled:

```bash
gh workflow disable deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
gh workflow list --repo cwchanap/DTXWeb --all | grep -F 'Deploy Cloudflare Access'
```

The matching row must report `disabled_manually`. Do not import or apply while it is enabled.
The old workflow file is absent from this branch because it was renamed; its disabled GitHub
workflow record is intentionally retained until merge.

For a fresh adoption, capture D1 IDs, KV IDs/titles, R2 bucket names/jurisdictions, custom-domain
IDs/service targets, and zone/account identifiers in a private directory outside the repository.
Use placeholders from that inventory only; never paste the values into a commit or report. Set
`CLOUDFLARE_API_TOKEN` through secure environment injection for Pulumi operations; never echo it:

```bash
umask 077
PRIVATE_DIR="$(mktemp -d)"
: "${ACCOUNT_ID:?set from the private inventory}"
: "${PREPROD_D1_ID:?set from the private inventory}"
: "${PREPROD_KV_ID:?set from the private inventory}"
: "${PREPROD_WEB_DOMAIN_ID:?set from the private inventory}"
: "${PREPROD_API_DOMAIN_ID:?set from the private inventory}"
: "${PRODUCTION_D1_ID:?set from the private inventory}"
: "${PRODUCTION_KV_ID:?set from the private inventory}"
: "${PRODUCTION_WEB_DOMAIN_ID:?set from the private inventory}"
: "${PRODUCTION_API_DOMAIN_ID:?set from the private inventory}"
```

Run the five imports for pre-production, then the five imports for production. The R2 import ID
must include the jurisdiction segment (`default` for these buckets):

```bash
cd packages/infrastructure

pulumi import cloudflare:index/d1Database:D1Database dtxweb-pre-prod-d1 \
  "$ACCOUNT_ID/$PREPROD_D1_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-d1.ts"
pulumi import cloudflare:index/r2Bucket:R2Bucket dtxweb-pre-prod-r2 \
  "$ACCOUNT_ID/simfile-dtx-preprod/default" --yes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-r2.ts"
pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace dtxweb-pre-prod-rate-limit-kv \
  "$ACCOUNT_ID/$PREPROD_KV_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-kv.ts"
pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-pre-prod-web-domain \
  "$ACCOUNT_ID/$PREPROD_WEB_DOMAIN_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-web-domain.ts"
pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-pre-prod-api-domain \
  "$ACCOUNT_ID/$PREPROD_API_DOMAIN_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-api-domain.ts"

pulumi import cloudflare:index/d1Database:D1Database dtxweb-production-d1 \
  "$ACCOUNT_ID/$PRODUCTION_D1_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-d1.ts"
pulumi import cloudflare:index/r2Bucket:R2Bucket dtxweb-production-r2 \
  "$ACCOUNT_ID/simfile-dtx/default" --yes \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-r2.ts"
pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace dtxweb-production-rate-limit-kv \
  "$ACCOUNT_ID/$PRODUCTION_KV_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-kv.ts"
pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-production-web-domain \
  "$ACCOUNT_ID/$PRODUCTION_WEB_DOMAIN_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-web-domain.ts"
pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-production-api-domain \
  "$ACCOUNT_ID/$PRODUCTION_API_DOMAIN_ID" --yes \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-api-domain.ts"
```

Do not run `pulumi up` until each import-generated input has been reconciled with the shared
builders and the targeted preview is clean. If the migration is abandoned before the expanded
program matches state, restore the pre-expansion Access-only program first, list the stack URNs,
then remove **only the newly imported URNs from state**. State removal does not delete the live
Cloudflare resources. Re-run the Access-only preview before re-enabling the old workflow:

```bash
pulumi stack --show-urns --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi state delete --force --yes --stack cwchanap/dtxweb-infrastructure/pre-prod '<newly-imported-urn>'
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod
gh workflow enable deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
```

Repeat the state-only recovery for production only if production imports were also made. Never use
`pulumi destroy` as recovery and never delete/recreate a D1 or R2 resource to repair state.

## Pre-production before production

The required order is: pre-production import/adoption, pre-production boundary verification,
route-free pre-production deploy, 24-hour soak, then production full-scope refresh and cutover.
The pre-production live gate is already complete. If it must be revalidated before production:

```bash
cd packages/infrastructure
pulumi up --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod
cd ../..
packages/infrastructure/scripts/verify-access.sh pre-prod
bun run deploy:api:preprod
bun run deploy:web:preprod
packages/infrastructure/scripts/verify-access.sh pre-prod
```

The pre-production route blocks are gone and both permanent Worker environments have
`workers_dev: false`; do not restore route ownership to Wrangler.

## 24-hour alias soak and deletion gate

The aliases are the rollback window, not permanent environments. Do not delete them until all of
these are true:

1. The current time is at or after `2026-08-30T21:55:04Z` (24 hours after the route-free
   pre-production deploy).
2. No incident during the window required restoring an alias domain or alias Worker.
3. Both boundary verifications pass.
4. A read-only dependency inventory confirms each alias Worker has no custom domain, route,
   cron/schedule, service-binding consumer, or remaining operator use.
5. The alias-only KV namespace is not the permanent pre-production or production namespace.

Check the deadline and boundary before inventory:

```bash
python3 - <<'PY'
from datetime import datetime, timezone

deadline = datetime.fromisoformat('2026-08-30T21:55:04+00:00')
now = datetime.now(timezone.utc)
if now < deadline:
    raise SystemExit(f'alias soak incomplete until {deadline.isoformat()}')
print(f'alias soak deadline passed: {now.isoformat()}')
PY

packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

Inventory the aliases without changing them:

```bash
bunx wrangler deployments list --name dtx-api-pre-prod-prod-data
bunx wrangler deployments list --name dtx-web-pre-prod-prod-data
bunx wrangler kv namespace list
```

In the Cloudflare dashboard, inspect each alias Worker under **Workers & Pages → Settings →
Domains & Routes**, **Triggers**, and **Bindings**. Confirm no custom domain, route, cron/schedule,
or service-binding consumer. Compare the alias KV namespace from the private inventory with both
permanent namespace identities. Check active repository configuration with:

```bash
git grep -nE 'dtx-(api|web)-pre-prod-prod-data|deploy:([^ ]+:)?preprod:prod-data|deploy:preview' \
  -- ':!docs/superpowers/**'
```

No active configuration match is expected. After every inventory check passes, set the alias KV
identity and delete only the aliases and alias-only KV. The commands prompt for confirmation; do
not skip the confirmation unless the inventory has been independently signed off:

```bash
: "${ALIAS_KV_NAMESPACE_ID:?set from the private inventory; do not use a permanent namespace ID}"
bunx wrangler delete dtx-api-pre-prod-prod-data
bunx wrangler delete dtx-web-pre-prod-prod-data
bunx wrangler kv namespace delete --namespace-id "$ALIAS_KV_NAMESPACE_ID"
```

**Hard invariant:** this cleanup may not delete, mutate, reset, truncate, replace, or repurpose
`dtx-web`, `dtx-web-preprod`, `simfile-dtx`, or `simfile-dtx-preprod`. If the KV identity is
ambiguous, or any Pulumi preview shows a D1/R2 operation, stop. The alias deletion closes the fast
alias rollback path.

## Production Worker rollback

If a production Worker release regresses, roll back the affected Worker version with Wrangler.
Do not roll back Pulumi state or touch D1/R2/domain resources:

```bash
cd packages/dtx-api
bunx wrangler deployments list --name dtx-api
bunx wrangler rollback --name dtx-api

cd ../dtx-web
bunx wrangler deployments list --name dtx-web
bunx wrangler rollback --name dtx-web
```

Use the `production` Worker names exactly. If only one Worker regressed, roll back only that
Worker. Re-run the relevant production smoke/boundary checks after rollback.

## Final drift checks

The authoritative check is a full-scope refreshed preview using a Cloudflare credential that can
read the Access application. Run it from `packages/infrastructure`:

```bash
pulumi preview --refresh --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi preview --refresh --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
```

The credential available in this worktree was insufficient for Cloudflare provider refresh: the
fresh run returned authentication errors for the resource reads, including Access. Use a
dashboard-minted `CLOUDFLARE_API_TOKEN` with the documented non-Access permissions for the
targeted fallback, and the Access Apps/Policies read permission for the full-scope run. The final
full-scope refresh belongs in CI or the first workflow run after the environment token is
provisioned.

If only the non-Access permissions are available, use a targeted refresh/preview of the five
non-Access resources per stack. Get each stack's non-Access URN from `pulumi stack --show-urns`,
pass them with repeated `--target` flags, and retain `--refresh --expect-no-changes`. A targeted
result is not proof that Access is drift-free.

Inspect the output, not only the exit code: it must report zero operations and `Resources: ...
unchanged`. Any D1/R2 create, replace, delete, or unexpected domain/KV operation is a hard stop.
Then run both boundary verifiers:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

## Pending operator gates

These are the remaining gates from this execution. Do not mark the migration complete until each
one is closed.

### 1. Production cutover — PENDING OPERATOR

Production imports and the targeted preview are done, but the live Pulumi update and Worker
deploys are not. First run a full-scope refreshed preview with a credential that can read Access;
the current worktree credential is insufficient. Stop on any stateful operation, especially D1/R2:

```bash
cd packages/infrastructure
pulumi preview --refresh --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
pulumi up --refresh --stack cwchanap/dtxweb-infrastructure/production
cd ../..
bun run deploy:api
bun run deploy:web
packages/infrastructure/scripts/verify-access.sh production
```

The production Wrangler route removal and `workers_dev: false` take effect at those deploys. Record
that the full-scope refresh was run in CI/operator context; do not treat the local targeted result
as an Access drift proof.

### 2. Trusted-device Access admission — PENDING OPERATOR

Run the boundary verifier, then perform the human check that automation cannot perform:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
```

On a trusted device, enter the protected pre-production application, complete the current Google
login/OAuth flow, open `/app`, and confirm API use works. After production cutover, repeat the
equivalent `/app` browser/API check in production. From a device that fails the shared posture
rule, request the same protected surface and confirm Access denies the request before DTXWeb loads.
Do not record cookies, headers, email addresses, device identifiers, or screenshots containing
security identifiers.

### 3. Soak completion and alias cleanup — PENDING OPERATOR

After the deadline and the criteria in [24-hour alias soak and deletion gate](#24-hour-alias-soak-and-deletion-gate),
run the two verifiers, complete the dependency inventory, and delete only:

```text
dtx-api-pre-prod-prod-data
the alias-only rate-limit KV namespace
```

Never delete or mutate the permanent production D1 `dtx-web` or R2 `simfile-dtx`; the same
invariant also protects the permanent pre-production D1/R2 resources.

### 4. GitHub Environment credentials — PENDING OPERATOR

Before merge, mint a dashboard Cloudflare token with only Access Apps/Policies, D1, R2 bucket
identity, Workers KV, and Workers custom-domain permissions. Add it to both existing GitHub
Environments without printing the value:

```bash
gh secret set CLOUDFLARE_INFRA_API_TOKEN --env dtx-access-pre-prod --repo cwchanap/DTXWeb
gh secret set CLOUDFLARE_INFRA_API_TOKEN --env dtx-access-production --repo cwchanap/DTXWeb
gh secret list --env dtx-access-pre-prod --repo cwchanap/DTXWeb | grep -F 'CLOUDFLARE_INFRA_API_TOKEN'
gh secret list --env dtx-access-production --repo cwchanap/DTXWeb | grep -F 'CLOUDFLARE_INFRA_API_TOKEN'
```

Keep `CLOUDFLARE_ACCESS_API_TOKEN` in both environments until the renamed workflow's first
successful `main` run completes both serial jobs. Verify that run, then and only then remove the
obsolete secret:

```bash
gh run list --workflow deploy-cloudflare-infrastructure.yml --branch main --limit 1 --repo cwchanap/DTXWeb
gh secret delete CLOUDFLARE_ACCESS_API_TOKEN --env dtx-access-pre-prod --repo cwchanap/DTXWeb
gh secret delete CLOUDFLARE_ACCESS_API_TOKEN --env dtx-access-production --repo cwchanap/DTXWeb
```

## Merge-transition checklist

- [x] Old `Deploy Cloudflare Access` workflow is disabled (`gh workflow list --all` reports
      `disabled_manually`).
- [x] `.github/workflows/deploy-cloudflare-infrastructure.yml` is present on this branch.
- [ ] Both Pulumi stacks have a fresh authenticated full-scope no-op preview; the worktree
      credential currently cannot refresh Cloudflare resources.
- [ ] `CLOUDFLARE_INFRA_API_TOKEN` is provisioned in both GitHub Environments.
- [ ] The alias soak has completed and the dependency inventory plus alias-only cleanup has been
      performed.
- [ ] Production full-scope refresh, Pulumi update, Worker deploys, and production verifier have
      completed.

After merge, the generalized workflow's first `main` run must be an ordinary refreshed update with
no imports or replacements. Only after that run succeeds may the obsolete Access-only Environment
secret be removed.
