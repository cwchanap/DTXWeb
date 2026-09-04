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

### Local R2 bucket serving

`dev:seed` writes chart objects into the local Miniflare `DTXFILE_BUCKET`, and catalog/preview
URLs are built as `PUBLIC_SIMFILE_BUCKET_URL/<key>`. The local `PUBLIC_SIMFILE_BUCKET_URL` is
`http://localhost:8787/local-r2`, served by a local-only R2 passthrough route in `dtx-api` that
streams objects from the bound `DTXFILE_BUCKET`. The route is registered **only** when
`RATE_LIMIT_ENV === 'local'`, so it is never reachable in production or pre-production.

`dev:local` pins the value with `--var PUBLIC_SIMFILE_BUCKET_URL:http://localhost:8787/local-r2`
because it loads `../../.env` and Wrangler lets env-file values override configured vars;
`.env.example` ships the same local value so the web client (which reads the workspace-root `.env`
via Vite `envDir`) also resolves local chart URLs correctly. Without this endpoint, every seeded
or newly uploaded local-only object would resolve to a URL on the remote pre-prod public bucket
where it does not exist (404).

## Retention probes

Before any Pulumi import/apply or Worker cutover, create a baseline for each environment in a
private directory outside the repository. Use read-only access and `umask 077`; never print the
captured values. Record the D1 database ID and a representative existing row identifier, plus the
R2 bucket name, jurisdiction, object key, and stable object metadata such as size, content type,
and checksum or ETag. Keep the baseline private and do not copy any of it into a commit or report.

After each Pulumi apply and again after the related Worker deploys, probe the same environment. It
must show the same D1 ID and that the captured row still exists, the same R2 bucket and jurisdiction,
and the captured object still exists with its recorded metadata. Stop immediately on any mismatch;
do not continue to another deploy, delete, repair, or alias cleanup until the discrepancy is
investigated.

## Workflow disable, import, and recovery

The authoritative deployment workflow is
`.github/workflows/deploy-cloudflare-infrastructure.yml`. It runs on relevant `main` changes or
`workflow_dispatch` from `main`, checks/builds/tests each stack, updates pre-production first,
verifies it, then updates production and verifies it. The job environments remain
`dtx-access-pre-prod` and `dtx-access-production`.

### Drift-fail-closed automation

After the checks and Pulumi authentication, each job runs a preview-only refresh gate, then a
fail-closed source preview gate, before its update, then verifies the boundary:

```text
pulumi refresh --preview-only --expect-no-changes --stack <stack>
scripts/preview-gate.sh <stack>           # source preview: reject D1/R2 stateful ops
pulumi up --stack <stack>                 # never add --refresh
packages/infrastructure/scripts/verify-access.sh <environment>
```

`--expect-no-changes` makes live drift fail the job before the source preview; the workflow does
not auto-remediate drift. The source preview gate runs `pulumi preview --json` and rejects any
`cloudflare:index/d1Database:D1Database` or `cloudflare:index/r2Bucket:R2Bucket` stateful
operation proposed by the checked-in program. This closes the gap that the drift refresh and
`protect: true` cannot: the drift refresh only proves live provider state matches recorded Pulumi
state (it says nothing about source-introduced changes), `protect` blocks D1/R2 delete/replace but
not a new create, and `pulumi/actions` runs `pulumi up --yes --skip-preview`, so without the gate a
source change that adds a new D1/R2 resource could pass drift detection and apply immediately. The
gate does **not** use `--expect-no-changes` because legitimate non-D1/R2 changes (e.g. an alias ->
permanent `WorkersCustomDomain.service` update) must be allowed to proceed to `pulumi up`.

Resolve drift or a D1/R2 gate rejection through a separately reviewed operator change, then rerun
the gates. The pre-production job must complete before the production job starts.

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
pulumi refresh --preview-only --expect-no-changes --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi up --stack cwchanap/dtxweb-infrastructure/pre-prod
# Complete the pre-production retention probe immediately after the Pulumi apply.
cd ../..
packages/infrastructure/scripts/verify-access.sh pre-prod
cd packages/dtx-api && bunx wrangler deploy --env pre-prod --no-x-provision
cd ../dtx-web
PUBLIC_SIMFILE_BUCKET_URL=https://pub-69ca40bf7a284843b562ff39a68b2e6e.r2.dev bun run build
bunx wrangler deploy --env pre-prod --no-x-provision
cd ../..
packages/infrastructure/scripts/verify-access.sh pre-prod
# Repeat the pre-production retention probe after both Worker deploys.
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

The authoritative check is a full-scope preview-only refresh followed by a source preview, using a
Cloudflare credential that can read the Access application. Run it from `packages/infrastructure`:

```bash
set -euo pipefail

pulumi refresh --preview-only --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi preview --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi refresh --preview-only --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
pulumi preview --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
```

The credential available in this worktree was insufficient for Cloudflare provider refresh: the
fresh run returned authentication errors for the resource reads, including Access. Use a
dashboard-minted `CLOUDFLARE_API_TOKEN` with the documented non-Access permissions for the
targeted fallback, and the Access Apps/Policies read permission for the full-scope run. The final
full-scope refresh belongs in CI or the first workflow run after the environment token is
provisioned.

If only the non-Access permissions are available, use a targeted refresh/preview of the five
non-Access resources per stack. Get each stack's non-Access URN from `pulumi stack --show-urns`,
pass them with repeated `--target` flags, and retain `--preview-only --expect-no-changes` for the
refresh gate and `--expect-no-changes` for the source preview. A targeted result is not proof that
Access is drift-free.

Inspect the output, not only the exit code: it must report zero operations and `Resources: ...
unchanged`. Any D1/R2 create, replace, delete, or unexpected domain/KV operation is a hard stop.
Then run both boundary verifiers:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

Before declaring the final gates green, run [Retention probes](#retention-probes) for both
pre-production and production from their private baselines. Both probes must pass; a missing row,
changed D1 ID, changed R2 bucket or jurisdiction, missing object, or metadata mismatch blocks merge.

## Pending operator gates

Complete the remaining gates in this order. Provisioning the infrastructure credential and completing
the trusted-device check may happen any time before merge, but both must be complete before production
cutover. The soak gates alias deletion only; it does not gate production cutover.

### 1. Infrastructure credential and trusted-device admission — PENDING OPERATOR

Before production cutover, mint a dashboard Cloudflare token with only Access Apps/Policies, D1, R2
bucket identity, Workers KV namespace, and Workers custom-domain permissions. Add it to both existing
GitHub Environments without printing the value. `set -euo pipefail` makes the secret-list checks gate
the rest of this block:

The token must be **account-scoped to the single DTXWeb account** (never "All accounts") and carry
only these Cloudflare permission groups. Cloudflare exposes no "identity-only" permission for D1/R2/KV
or for Worker custom domains, so most of these groups inherently grant broader mutation rights than
the Pulumi ownership boundary intends; the compensating controls below constrain that overshoot so
the boundary still holds operationally.

| Pulumi-managed resource      | Permission group (Account scope) | Boundary overshoot                                                | Compensating control                                                                                                                                             |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access applications/policies | `Access: Apps and Policies Edit` | None — matches the boundary                                       | `protect: true`; drift-fail-closed preview                                                                                                                       |
| D1 database identity         | `D1 Edit`                        | Also permits D1 schema/data writes                                | Pulumi declares only `D1Database` identity (name/region), never schema; migrations stay in Wrangler; `protect: true` + `retainOnDelete: true`                    |
| R2 bucket identity           | `Workers R2 Storage Edit`        | Also permits R2 **object** read/write/delete                      | Pulumi declares only `R2Bucket` identity (name/jurisdiction), never objects; `protect: true` + `retainOnDelete: true`; retention probes before/after every apply |
| Workers KV namespace         | `Workers KV Storage Edit`        | Also permits KV **value** read/write/delete                       | Pulumi declares only namespace identity, never values; `protect: true`; drift-fail-closed preview                                                                |
| Worker custom domains        | `Workers Scripts Edit`           | Also permits Worker **script/release** mutations (Wrangler-owned) | Pulumi declares only `WorkersCustomDomain`, never `cloudflare.Worker`; `protect: true`; Wrangler stays the release source of truth                               |

`Workers Scripts Edit` is required because the Workers Custom Domains API
(`/accounts/{account_id}/workers/domains`) gates attach/update/delete on the Workers Scripts write
permission — there is no narrower custom-domain-only group. The same drift-fail-closed automation
(`pulumi refresh --preview-only --expect-no-changes` before every `pulumi up`) and the
`protect: true` / `retainOnDelete: true` flags on every permanent D1/R2 resource are what prevent the
overshoot from touching data or releases. Do not add `Workers Routes`, DNS, SSL/Certificates, or any
Zone-scoped permission: Pulumi owns no zone resources on this stack.

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
deploys are not. First capture the production retention baseline using [Retention probes](#retention-probes)
in the private directory. Use the provisioned infrastructure token for the full-scope refresh gate.
It must exit successfully with no drift before the source preview; stop on any unreviewed stateful
operation, especially D1/R2. `set -euo pipefail` gates every later deployment and verifier on the
preceding command:

```bash
set -euo pipefail

cd packages/infrastructure
pulumi refresh --preview-only --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
pulumi preview --expect-no-changes --suppress-outputs --stack cwchanap/dtxweb-infrastructure/production
pulumi up --stack cwchanap/dtxweb-infrastructure/production
# Complete the production retention probe immediately after the Pulumi apply; stop on mismatch.
cd ../..
cd packages/dtx-api && bunx wrangler deploy --env production --no-x-provision
cd ../dtx-web
# PUBLIC_SIMFILE_BUCKET_URL is baked into the client bundle at build time ($env/static/public) — omitting it breaks all preview images.
PUBLIC_SIMFILE_BUCKET_URL=https://chart.hapadona.com bun run build
bunx wrangler deploy --env production --no-x-provision
cd ../..
packages/infrastructure/scripts/verify-access.sh production
# Repeat the production retention probe after both Worker deploys.
```

This is the production cutover sequence: preview-only full-scope refresh gate, fail-closed
source preview (`--expect-no-changes` — any proposed change, especially D1/R2, stops before
`pulumi up`), plain `pulumi up`, production retention probe, direct no-migration API deploy, web
build and direct no-migration deploy, explicit production boundary verifier, and a repeated
retention probe. The production Wrangler route removal and `workers_dev: false` take effect at
those deploys. Record that the full-scope refresh ran in CI/operator context; do not treat the
local targeted result as an Access drift proof.

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
  --json databaseId,createdAt,status,conclusion,headBranch,headSha
: "${POST_MERGE_MAIN_RUN_ID:?set to the completed successful post-merge main run ID after reviewing the list above}"
: "${MERGE_COMMIT_SHA:?set to the merged main commit SHA (e.g. from gh pr view --json mergeCommit); the run must be for this commit}"

# Bind the run to the merge commit so a stale pre-merge main run cannot satisfy the gate.
run_status="$(gh run view "$POST_MERGE_MAIN_RUN_ID" --repo cwchanap/DTXWeb \
  --json workflowName,headBranch,headSha,status,conclusion \
  --jq '"\(.workflowName)|\(.headBranch)|\(.headSha)|\(.status)|\(.conclusion)"')"
printf '%s\n' "$run_status"
[ "$run_status" = "Deploy Cloudflare Infrastructure|main|$MERGE_COMMIT_SHA|completed|success" ]

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

# Complete Retention probes for pre-production and production from the private baselines.
# Do not remove the old secret unless both probes pass.
: "${RETENTION_PROBES_CONFIRMED:?set to yes only after both pre-production and production retention probes pass from the private baselines; never print probe values}"
[ "$RETENTION_PROBES_CONFIRMED" = yes ]
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
- [ ] Retention probes pass for both environments from the private baselines.
- [ ] The 24-hour soak has completed after production cutover and both verifiers are green.
- [ ] Both alias Worker dependencies and the alias-only KV dependency inventory are complete.
- [ ] Both alias Workers and only the alias-only KV have been deleted.
- [ ] The first successful post-merge `main` run of the generalized workflow is explicitly verified
      with both serial jobs green.
- [ ] `CLOUDFLARE_ACCESS_API_TOKEN` is removed only after that verified successful run.

The canonical sequence is: provision the infrastructure token and complete trusted-device checks;
perform production cutover with its retention probes; wait for soak completion and re-run both
verifiers; inventory and delete only the aliases; pass the final retention probes and
merge-transition checks; then remove the old Access-only Environment secret.
