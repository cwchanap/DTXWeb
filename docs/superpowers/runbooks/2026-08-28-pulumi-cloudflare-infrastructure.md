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

Pre-production import/adoption, boundary verification, route-free deployment, and `workers_dev: false`
are prerequisites for production and are already complete. The 24-hour alias soak does **not** block
production cutover; it only gates alias dependency inventory and deletion after production is live.
Follow [Pending operator gates](#pending-operator-gates) for the canonical remaining order. If the
pre-production gate must be revalidated before production:

```bash
set -euo pipefail

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

The aliases are the rollback window, not permanent environments. Evaluate this gate after production
cutover; it does not delay production cutover. Do not delete them until all of these are true:

1. The current time is at or after `2026-08-30T21:55:04Z` (24 hours after the route-free
   pre-production deploy).
2. No incident during the window required restoring an alias domain or alias Worker.
3. Both boundary verifications pass.
4. A read-only dependency inventory confirms each alias Worker has no custom domain, route,
   cron/schedule, service-binding consumer, or remaining operator use.
5. The alias-only KV namespace is not the permanent pre-production or production namespace.

Check the deadline and boundary before inventory:

```bash
set -euo pipefail

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
set -euo pipefail

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
set -euo pipefail

: "${ALIAS_KV_NAMESPACE_ID:?set from the private inventory; do not use a permanent namespace ID}"
: "${ALIAS_DEPENDENCY_INVENTORY_CONFIRMED:?set to yes only after the two Worker and KV dependency checks pass}"
[ "$ALIAS_DEPENDENCY_INVENTORY_CONFIRMED" = yes ]
: "${PERMANENT_PREPROD_KV_NAMESPACE_ID:?set from the private inventory; never print it}"
: "${PERMANENT_PRODUCTION_KV_NAMESPACE_ID:?set from the private inventory; never print it}"
[ "$ALIAS_KV_NAMESPACE_ID" != "$PERMANENT_PREPROD_KV_NAMESPACE_ID" ]
[ "$ALIAS_KV_NAMESPACE_ID" != "$PERMANENT_PRODUCTION_KV_NAMESPACE_ID" ]
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

Complete the remaining gates in this order. Provisioning the infrastructure credential and completing
the trusted-device check may happen any time before merge, but both must be complete before production
cutover. The soak gates alias deletion only; it does not gate production cutover.

### 1. Infrastructure credential and trusted-device admission — PENDING OPERATOR

Before production cutover, mint a dashboard Cloudflare token with only Access Apps/Policies, D1, R2
bucket identity, Workers KV namespace, and Workers custom-domain permissions. Add it to both existing
GitHub Environments without printing the value. `set -euo pipefail` makes the secret-list checks gate
the rest of this block:

```bash
set -euo pipefail

gh secret set CLOUDFLARE_INFRA_API_TOKEN --env dtx-access-pre-prod --repo cwchanap/DTXWeb
gh secret set CLOUDFLARE_INFRA_API_TOKEN --env dtx-access-production --repo cwchanap/DTXWeb
gh secret list --env dtx-access-pre-prod --repo cwchanap/DTXWeb | grep -F 'CLOUDFLARE_INFRA_API_TOKEN'
gh secret list --env dtx-access-production --repo cwchanap/DTXWeb | grep -F 'CLOUDFLARE_INFRA_API_TOKEN'
```

Keep `CLOUDFLARE_ACCESS_API_TOKEN` in both environments until the post-merge gate in section 4.
Run the pre-production boundary check, then perform the human admission check on a trusted device:

```bash
set -euo pipefail

packages/infrastructure/scripts/verify-access.sh pre-prod
```

On a trusted device, enter the protected pre-production application, complete the current Google
login/OAuth flow, open `/app`, and confirm API use works. From a device that fails the shared posture
rule, request the same protected surface and confirm Access denies the request before DTXWeb loads.
Do not record cookies, headers, email addresses, device identifiers, or screenshots containing
security identifiers.

### 2. Production cutover — PENDING OPERATOR

Production imports and the earlier targeted preview are done, but the live Pulumi update and Worker
deploys are not. Use the provisioned infrastructure token for the full-scope refresh. The preview must
exit successfully with no operations before `pulumi up`; stop on any stateful operation, especially
D1/R2. `set -euo pipefail` gates every later deployment and verifier on the preceding command:

```bash
set -euo pipefail

cd packages/infrastructure
pulumi preview --refresh --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
pulumi up --refresh --stack cwchanap/dtxweb-infrastructure/production
cd ../..
bun run deploy:api
bun run deploy:web
packages/infrastructure/scripts/verify-access.sh production
```

This is the production cutover sequence: full-scope refresh, `pulumi up --refresh`, API deploy, web
deploy, then the explicit production boundary verifier. The production Wrangler route removal and
`workers_dev: false` take effect at those deploys. Record that the full-scope refresh ran in
CI/operator context; do not treat the local targeted result as an Access drift proof.

After this cutover, repeat the trusted-device `/app` and failing-posture checks against production,
with the explicit automated boundary command:

```bash
set -euo pipefail

packages/infrastructure/scripts/verify-access.sh production
```

### 3. Soak completion, dependency inventory, and alias cleanup — PENDING OPERATOR

After production cutover and a green production verifier, wait until at least
`2026-08-30T21:55:04Z`. Confirm no incident during the window required restoring an alias domain or
alias Worker. Before deletion, independently inventory **both** alias Workers:

- `dtx-api-pre-prod-prod-data`
- `dtx-web-pre-prod-prod-data`

For each Worker, confirm in **Workers & Pages → Settings → Domains & Routes**, **Triggers**, and
**Bindings** that there is no custom domain, route, cron/schedule, or service-binding consumer, and
confirm there is no remaining operator use. Confirm from the private inventory that the alias-only KV
namespace is neither the production nor permanent pre-production namespace. Do not record the IDs.

Set `ALIAS_DEPENDENCY_INVENTORY_CONFIRMED=yes` only after all those read-only checks are complete.
The following block then re-checks the deadline and both boundaries, lists both alias Workers and the
KV namespaces, verifies the private KV identities are distinct, and only then reaches the deletion
commands:

```bash
set -euo pipefail

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
bunx wrangler deployments list --name dtx-api-pre-prod-prod-data
bunx wrangler deployments list --name dtx-web-pre-prod-prod-data
bunx wrangler kv namespace list

: "${ALIAS_DEPENDENCY_INVENTORY_CONFIRMED:?set to yes only after the two Worker and KV dependency checks above pass}"
[ "$ALIAS_DEPENDENCY_INVENTORY_CONFIRMED" = yes ]
: "${ALIAS_KV_NAMESPACE_ID:?set from the private inventory; do not use a permanent namespace ID}"
: "${PERMANENT_PREPROD_KV_NAMESPACE_ID:?set from the private inventory; never print it}"
: "${PERMANENT_PRODUCTION_KV_NAMESPACE_ID:?set from the private inventory; never print it}"
[ "$ALIAS_KV_NAMESPACE_ID" != "$PERMANENT_PREPROD_KV_NAMESPACE_ID" ]
[ "$ALIAS_KV_NAMESPACE_ID" != "$PERMANENT_PRODUCTION_KV_NAMESPACE_ID" ]

bunx wrangler delete dtx-api-pre-prod-prod-data
bunx wrangler delete dtx-web-pre-prod-prod-data
bunx wrangler kv namespace delete --namespace-id "$ALIAS_KV_NAMESPACE_ID"
```

**Hard invariant:** this cleanup may not delete, mutate, reset, truncate, replace, or repurpose
production D1 `dtx-web` or R2 `simfile-dtx`, nor the permanent pre-production D1/R2 resources. If
any Worker dependency check, KV identity comparison, or Pulumi preview is ambiguous, stop. Alias
deletion closes the fast alias rollback path.

### 4. Merge transition and old-secret removal — PENDING OPERATOR

Before merge, keep the old Access-only workflow disabled and confirm the generalized workflow file is
present. After merge, choose the specific **post-merge** `main` run of the generalized workflow; do
not use a pre-merge or merely latest-existing run. The old secret may be removed only after that run
is explicitly completed and successful and `gh run view` shows both serial jobs green:
`deploy-pre-prod=completed/success` and `deploy-production=completed/success`.

```bash
set -euo pipefail

gh workflow list --repo cwchanap/DTXWeb --all | grep -F 'Deploy Cloudflare Access' | grep -F 'disabled_manually'
gh run list --workflow deploy-cloudflare-infrastructure.yml --branch main --limit 20 --repo cwchanap/DTXWeb \
  --json databaseId,createdAt,status,conclusion,headBranch
: "${POST_MERGE_MAIN_RUN_ID:?set to the completed successful post-merge main run ID after reviewing the list above}"

run_status="$(gh run view "$POST_MERGE_MAIN_RUN_ID" --repo cwchanap/DTXWeb \
  --json workflowName,headBranch,status,conclusion \
  --jq '"\(.workflowName)|\(.headBranch)|\(.status)|\(.conclusion)"')"
printf '%s\n' "$run_status"
[ "$run_status" = 'Deploy Cloudflare Infrastructure|main|completed|success' ]

job_statuses="$(gh run view "$POST_MERGE_MAIN_RUN_ID" --repo cwchanap/DTXWeb \
  --json jobs \
  --jq '.jobs[] | select(.name == "deploy-pre-prod" or .name == "deploy-production") | "\(.name)=\(.status)/\(.conclusion)"')"
printf '%s\n' "$job_statuses"
case "$job_statuses" in
  *'deploy-pre-prod=completed/success'*) ;;
  *) printf '%s\n' 'deploy-pre-prod is not green' >&2; exit 1 ;;
esac
case "$job_statuses" in
  *'deploy-production=completed/success'*) ;;
  *) printf '%s\n' 'deploy-production is not green' >&2; exit 1 ;;
esac

gh secret delete CLOUDFLARE_ACCESS_API_TOKEN --env dtx-access-pre-prod --repo cwchanap/DTXWeb
gh secret delete CLOUDFLARE_ACCESS_API_TOKEN --env dtx-access-production --repo cwchanap/DTXWeb
```

## Merge-transition checklist

- [x] Old `Deploy Cloudflare Access` workflow is disabled (`gh workflow list --all` reports
      `disabled_manually`) and remains disabled until merge.
- [x] `.github/workflows/deploy-cloudflare-infrastructure.yml` is present on this branch.
- [ ] `CLOUDFLARE_INFRA_API_TOKEN` is provisioned in both GitHub Environments.
- [ ] Pre-production trusted-device allow and failing-posture denial checks are complete.
- [ ] Production full-scope refresh, Pulumi update, Worker deploys, and explicit production verifier
      have completed.
- [ ] The 24-hour soak has completed after production cutover and both verifiers are green.
- [ ] Both alias Worker dependencies and the alias-only KV dependency inventory are complete.
- [ ] Both alias Workers and only the alias-only KV have been deleted.
- [ ] The first successful post-merge `main` run of the generalized workflow is explicitly verified
      with both serial jobs green.
- [ ] `CLOUDFLARE_ACCESS_API_TOKEN` is removed only after that verified successful run.

The canonical sequence is: provision the infrastructure token and complete trusted-device checks;
perform production cutover; wait for soak completion and re-run both verifiers; inventory and delete
only the aliases; complete merge-transition checks; then remove the old Access-only Environment
secret.
