# Pulumi-Managed Cloudflare Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing DTXWeb Pulumi stacks from Access-only ownership to D1, R2 bucket, active KV namespace, and Worker custom-domain ownership while keeping Wrangler environments as the Worker release configuration and making normal local development fully local.

**Architecture:** Extend the existing two-stack table in `access.ts`; do not add a second config table or a Wrangler renderer. Wrangler keeps checked-in `production` and `pre-prod` environments with their current IDs/vars, while the top level becomes local Miniflare configuration. Before finalizing Pulumi declarations, disable the old Access-only workflow and use CLI-first import to generate the live resource input shape. Pulumi then manages Access + D1 + R2 + KV + two Worker custom domains per stack.

**Tech Stack:** Bun 1.3.9, TypeScript 5.8, Vitest 3, Bash, Pulumi Cloud, `@pulumi/pulumi` 3.258.0, locked `@pulumi/cloudflare` 6.19.0, Wrangler 4.123.0, GitHub Actions OIDC, Cloudflare Workers/D1/R2/KV/Access.

**Spec:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md`

## Global Constraints

- One implementation ticket, one implementation branch/worktree, one implementation pull request.
- Keep the pull request draft through all import/cutover/soak gates.
- Preserve Pulumi stacks `cwchanap/dtxweb-infrastructure/pre-prod` and `cwchanap/dtxweb-infrastructure/production`.
- Preserve the existing Access logical names, destinations, operator identity, Perseus posture requirement, and `12h` default.
- Extend the existing closed stack table in `packages/infrastructure/src/access.ts`; do not create `config.ts`.
- Do not add a Wrangler config renderer, generated Wrangler files, or a Pulumi Cloud dependency to Worker deploy/rollback commands.
- Do not import/create `cloudflare.Worker`, `R2BucketCors`, `R2ManagedDomain`, or `R2CustomDomain` resources.
- Pulumi owns exactly one D1, one R2 bucket, one active rate-limit KV namespace, and two `WorkersCustomDomain` resources per stack in addition to Access.
- D1/R2 use `{ protect: true, retainOnDelete: true }`; KV/custom domains use `{ protect: true }`.
- Wrangler keeps Worker code/assets, observability, compatibility settings, bindings/vars, secrets, Workflows, Containers, Durable Object migrations, and D1 schema migrations.
- Keep D1/KV IDs checked into Wrangler remote env blocks. They are non-secret references and are not regenerated from Pulumi.
- Top-level Wrangler config is local-only; production/pre-production are explicit named envs.
- `pre-prod-prod-data` is removed without a compatibility branch. Production D1/R2 are never deleted by alias cleanup.
- Disable the Access-only GitHub Actions workflow before the first new Pulumi import and keep it disabled until the implementation PR merges.
- Adopt and validate pre-production before production.
- Any D1/R2/KV replacement or delete is a hard stop. A pre-production custom-domain `service` change from an alias Worker to the permanent Worker is the only expected adoption update.
- Never detach/recreate `chart.hapadona.com`.
- Keep alias Workers alive for at least 24 hours after the successful pre-production hostname remap.
- Never print/commit Cloudflare tokens, Access email, posture-rule IDs, Pulumi stack exports, private API responses, or secret values.
- Historical dated specs/plans are not rewritten; update only current operational docs named below.

---

## Task 1: Make local development local before any Pulumi mutation

**Files:**
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `package.json`

**Interfaces:**
- Top-level API/web Wrangler config becomes local/default.
- `env.production` preserves the current production Worker contract and exact Worker name.
- `env.pre-prod` preserves the current pre-production Worker contract and exact Worker name.
- `dtx-api#migrate:local` applies tracked D1 migrations to `.wrangler/state` without wiping local data.
- root `dev:seed` reuses `packages/e2e-web/setup/prepare-stack.ts` for a deterministic reset/seed.

- [ ] **Step 1: Write RED topology assertions**

Update `packages/dtx-desktop/src/devTopology.test.ts` so the local contract is explicit:

```typescript
expect(apiPackage.scripts['dev:local']).not.toContain('--env pre-prod');
expect(apiWrangler.env?.['pre-prod']?.d1_databases?.[0]).toMatchObject({
	binding: 'DB',
	database_name: 'dtx-web-preprod',
	database_id: '6fedd126-9dcf-419f-bc2e-eaf8c23d9510'
});
expect(apiWrangler.env?.['pre-prod']?.d1_databases?.[0]).not.toHaveProperty('remote');
expect(apiWrangler.d1_databases?.[0]).toMatchObject({
	binding: 'DB',
	database_name: 'dtx-web'
});
expect(apiWrangler.d1_databases?.[0]).not.toHaveProperty('remote');
expect(apiWrangler.r2_buckets?.[0]).not.toHaveProperty('remote');
expect(rootPackage.scripts['dev:seed']).toContain('packages/e2e-web/setup/prepare-stack.ts');
```

Extend the local Wrangler test shape type to expose top-level `d1_databases`, `r2_buckets`, and named `production`/`pre-prod` envs.

Run:

```bash
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
```

Expected: FAIL because `dev:local` still selects remote pre-production and no root `dev:seed` exists.

- [ ] **Step 2: Restructure API Wrangler environments without changing remote values**

Make top-level API config local-safe:

```jsonc
{
	"name": "dtx-api-local",
	"main": "src/index.ts",
	"d1_databases": [
		{ "binding": "DB", "database_name": "dtx-web", "migrations_dir": "d1-migrations" }
	],
	"r2_buckets": [{ "binding": "DTXFILE_BUCKET", "bucket_name": "simfile-dtx" }],
	"kv_namespaces": [{ "binding": "RATE_LIMIT_API" }],
	"vars": {
		"BETTER_AUTH_URL": "http://localhost:8787",
		"DTX_WEB_URL": "http://localhost:5173",
		"AUTH_COOKIE_PREFIX": "dtx-local",
		"RATE_LIMIT_ENV": "local",
		"GRAPHIQL": "true",
		"CORS_ALLOWED_ORIGINS": "http://localhost:5173,http://localhost:8788",
		"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false",
		"PUBLIC_SIMFILE_BUCKET_URL": "http://localhost:5173",
		"BGM_M4A_GENERATION_ENABLED": "false"
	}
}
```

Keep the existing alias, compatibility flags, `dev.enable_containers=false`, and local Workflow/Container/DO declaration shape required for type generation. Secrets continue to come from `.env`/`--env-file`.

Move today's top-level production remote values into `env.production` and set `name: "dtx-api"`. Keep `env.pre-prod` with `name: "dtx-api-pre-prod"`. Copy every non-inheritable binding/var/Workflow/Container/DO setting needed by each remote environment; do not depend on implicit inheritance for fields Wrangler documents as non-inheritable.

For this task only, keep the existing production/pre-production `route` entries. Pulumi does not own those domains yet.

- [ ] **Step 3: Restructure web Wrangler environments**

Make the top-level web config local-safe and add explicit remote names:

```jsonc
"env": {
	"production": {
		"name": "dtx-web"
	},
	"pre-prod": {
		"name": "dtx-web-pre-prod"
	}
}
```

Preserve the current production/pre-production vars/service targets in those env blocks and keep their `route` entries until domain adoption.

- [ ] **Step 4: Update local/remote scripts**

API scripts:

```json
"dev:local": "wrangler dev --env-file ../../.env --port 8787 --var AUTH_COOKIE_DOMAIN: --var BGM_M4A_GENERATION_ENABLED:false",
"migrate:local": "wrangler d1 migrations apply dtx-web --local --persist-to .wrangler/state",
"migrate:prod": "wrangler d1 migrations apply dtx-web --remote --env production",
"deploy:prod": "bun run migrate:prod && wrangler deploy --env production"
```

Keep pre-production scripts on `--env pre-prod`. Do not remove `pre-prod-prod-data` yet; its live Worker remains the rollback path until Task 6.

Root scripts:

```json
"dev": "bun run migrate:api:local && turbo run dtx-api#dev:local dtx-web#dev:local-api dtx-desktop#dev:local-web",
"dev:all": "bun run migrate:api:local && turbo run dtx-api#dev:local dtx-web#dev:local-api dtx-desktop#dev:local-web @dtx/common#dev",
"dev:seed": "bun run packages/e2e-web/setup/prepare-stack.ts",
"migrate:api:local": "bun run --filter=dtx-api migrate:local"
```

- [ ] **Step 5: Extend the API environment type**

Change:

```typescript
RATE_LIMIT_ENV: 'local' | 'prod' | 'pre-prod' | 'pre-prod-prod-data';
```

Keep `pre-prod-prod-data` until Task 6 removes that remote mode.

- [ ] **Step 6: Prove the local data path**

Run:

```bash
bun run dev:seed
cd packages/dtx-api
bunx wrangler d1 execute dtx-web --local --persist-to .wrangler/state \
  --command 'SELECT COUNT(*) AS count FROM simfiles;'
```

Expected: command exits 0 and the count is greater than zero.

Then start the local API and verify health without selecting a remote env:

```bash
set -euo pipefail
bun run dev:local > /tmp/dtx-api-local.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  if curl --fail --silent http://localhost:8787/healthz >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://localhost:8787/healthz | grep '"ok":true'
```

Expected: local API returns `{"ok":true}` and no command uses `--env pre-prod`.

- [ ] **Step 7: GREEN and commit**

```bash
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
bun run --filter=dtx-api test -- src/index.test.ts
bun run --filter=dtx-api check
bun run --filter=dtx-web check

git add package.json packages/dtx-api packages/dtx-web packages/dtx-desktop/src/devTopology.test.ts
git commit -m "fix(dev): keep local API data local"
```

---

## Task 2: Disable old automation and use import-generated declarations

**Files:**
- Modify: `packages/infrastructure/src/access.ts`
- Modify: `packages/infrastructure/src/access.test.ts`
- Create: `packages/infrastructure/src/data.ts`
- Create: `packages/infrastructure/src/data.test.ts`
- Create: `packages/infrastructure/src/domains.ts`
- Create: `packages/infrastructure/src/domains.test.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Modify: `packages/infrastructure/src/index.test.ts`
- Modify: `packages/infrastructure/Pulumi.pre-prod.yaml`
- Modify: `packages/infrastructure/Pulumi.production.yaml`

**Interfaces:**

```typescript
export type StackName = 'pre-prod' | 'production';

export interface InfrastructureStackDefinition {
	stackName: StackName;
	applicationName: string;
	accessDomain: string;
	accessDestinations: AccessDestination[];
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	rateLimitKvTitle: string;
}
```

- [ ] **Step 1: Disable the Access-only workflow before import**

Operator gate:

```bash
gh workflow disable deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
gh workflow list --repo cwchanap/DTXWeb | grep 'Deploy Cloudflare Access'
```

Expected: workflow is disabled. Do not import anything while it remains enabled.

If this implementation is abandoned before the expanded program matches state, the recovery sequence is: `pulumi state delete` only the newly imported URNs, prove the Access-only preview is clean, then re-enable the workflow.

- [ ] **Step 2: Capture one private inventory**

Create a private directory outside the repository and save, without logging values:

```text
pre-prod + production D1 IDs
pre-prod + production KV IDs and titles
R2 bucket names + live jurisdictions
four Workers custom-domain IDs + current service targets
zone/account IDs
```

The checked-in IDs currently used by Wrangler are:

```text
pre-prod D1: 6fedd126-9dcf-419f-bc2e-eaf8c23d9510
pre-prod KV: 449636182e7440e48a4361ed19822f6e
production D1: 19376000-d389-4e0e-a5a8-00d9e31a9ffb
production KV: b5ff0ae92972479a9e607818f05e15f8
```

Verify the live API returns those same identities before importing. Record custom-domain IDs and R2 jurisdictions only in the private directory.

- [ ] **Step 3: Add `cloudflareZoneId` to both existing stack configs**

```bash
cd packages/infrastructure
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/production
```

Verify `secretsprovider: default`, encrypted `accessEmail`, and no `encryptionsalt` remain true.

- [ ] **Step 4: Import pre-production resources and capture generated code**

With `PRIVATE_DIR`, `ACCOUNT_ID`, `PREPROD_R2_IMPORT_ID`, `PREPROD_WEB_DOMAIN_ID`, and `PREPROD_API_DOMAIN_ID` populated from the private inventory:

```bash
cd packages/infrastructure
pulumi import cloudflare:index/d1Database:D1Database dtxweb-pre-prod-d1 \
  "$ACCOUNT_ID/6fedd126-9dcf-419f-bc2e-eaf8c23d9510" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-d1.ts"

pulumi import cloudflare:index/r2Bucket:R2Bucket dtxweb-pre-prod-r2 \
  "$PREPROD_R2_IMPORT_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-r2.ts"

pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace dtxweb-pre-prod-rate-limit-kv \
  "$ACCOUNT_ID/449636182e7440e48a4361ed19822f6e" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-kv.ts"

pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-pre-prod-web-domain \
  "$ACCOUNT_ID/$PREPROD_WEB_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-web-domain.ts"

pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-pre-prod-api-domain \
  "$ACCOUNT_ID/$PREPROD_API_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --out "$PRIVATE_DIR/preprod-api-domain.ts"
```

Pulumi import protects resources by default. Do not run `pulumi up` yet.

- [ ] **Step 5: Write RED infrastructure tests from the imported contract**

Extend the existing stack test instead of creating `config.ts`:

```typescript
expect(getInfrastructureStackDefinition('pre-prod')).toMatchObject({
	stackName: 'pre-prod',
	webWorkerName: 'dtx-web-pre-prod',
	apiWorkerName: 'dtx-api-pre-prod',
	webHostname: 'pre-prod.dtx.hapadona.com',
	apiHostname: 'api.pre-prod.dtx.hapadona.com',
	databaseName: 'dtx-web-preprod',
	bucketName: 'simfile-dtx-preprod'
});
expect(() => getInfrastructureStackDefinition('pre-prod-prod-data')).toThrow(
	/Unsupported DTXWeb infrastructure stack/
);
```

Constructor tests must pin:

```typescript
expect(d1DatabaseMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-d1',
	expect.objectContaining({ name: 'dtx-web-preprod' }),
	{ protect: true, retainOnDelete: true }
);
expect(r2BucketMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-r2',
	expect.objectContaining({ name: 'simfile-dtx-preprod' }),
	{ protect: true, retainOnDelete: true }
);
expect(kvNamespaceMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-rate-limit-kv',
	expect.objectContaining({ title: expect.any(String) }),
	{ protect: true }
);
```

Domain tests assert exactly two `WorkersCustomDomain` resources and no `cloudflare.Worker`.

Run:

```bash
bun run --filter=@dtx/infrastructure test
```

Expected: FAIL until the imported resource declarations are added.

- [ ] **Step 6: Implement the imported shape, not guessed inputs**

Use the generated files in `PRIVATE_DIR` to determine live constructor inputs. Copy only provider **inputs** needed to reproduce the live resource; do not copy computed outputs.

Extend the existing closed table in `access.ts`; do not add another stack table. Put the exact imported KV titles there. If imported D1/R2 non-default inputs differ by stack, represent them in this same stack definition or in one builder keyed by `stackName`; do not add a parallel release table.

`data.ts` owns D1/R2/KV. `domains.ts` owns only `WorkersCustomDomain`. `index.ts` composes Access + data + domains.

- [ ] **Step 7: Assert exact stack registration**

`index.test.ts` must capture exactly:

```text
1 ZeroTrustAccessApplication
1 D1Database
1 R2Bucket
1 WorkersKvNamespace
2 WorkersCustomDomain
```

and assert no resource type contains `worker:Worker`, `r2BucketCors`, `r2ManagedDomain`, or `r2CustomDomain`.

- [ ] **Step 8: GREEN and preview without apply**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
cd packages/infrastructure
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Expected: no D1/R2/KV create/replace/delete. The only permitted diff is a `WorkersCustomDomain.service` change from an alias Worker to the permanent pre-production Worker when inventory showed the alias currently owns the hostname.

- [ ] **Step 9: Commit the program**

```bash
git add packages/infrastructure
git commit -m "feat(infrastructure): adopt Cloudflare data and domains"
```

---

## Task 3: Cut pre-production custom-domain ownership to Pulumi

**Files:**
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/infrastructure/scripts/verify-access.sh`
- Modify: `packages/infrastructure/scripts/verify-access.test.sh`

- [ ] **Step 1: Extend RED live-boundary tests**

Add shell-fixture cases proving the existing verifier checks:

```text
pre-prod API /healthz is public and returns 200
production API /healthz is public and returns 200
web hostname retains existing Access matrix
network failure remains fail-closed
```

Run:

```bash
bash packages/infrastructure/scripts/verify-access.test.sh
```

Expected: FAIL until health checks are implemented.

- [ ] **Step 2: Extend `verify-access.sh`, do not add a second script**

Add `assert_health()` using `curl --fail --silent --show-error --max-time 15` and call it for each API hostname after the existing Access/public checks.

Do not print response bodies containing sensitive headers/cookies.

- [ ] **Step 3: Apply the pre-production Pulumi update**

```bash
cd packages/infrastructure
pulumi up --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Expected: imported data resources remain unchanged. If the custom domain was on an alias Worker, only the expected service target changes.

- [ ] **Step 4: Verify the live pre-production boundary**

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
```

Perform the existing trusted-device positive admission check as documented by the Access runbook.

If hostname/API verification fails while alias Workers still exist, restore the domain to the previously captured alias service, verify recovery, and stop.

- [ ] **Step 5: Remove Wrangler route ownership and dry-run pre-production**

Remove `route` from `env.pre-prod` in both Wrangler configs. Keep all other pre-production bindings/vars/workflow/container settings unchanged.

Run:

```bash
bun run --filter=dtx-api build:preprod
bun run --filter=dtx-web build
cd packages/dtx-web && bunx wrangler deploy --dry-run --env pre-prod
```

Expected: both dry runs resolve the permanent pre-production Worker names and contain no route/custom-domain declaration.

- [ ] **Step 6: Deploy pre-production without route ownership**

```bash
bun run deploy:api:preprod
bun run deploy:web:preprod
packages/infrastructure/scripts/verify-access.sh pre-prod
```

Expected: domain mappings remain Pulumi-owned and live behavior is unchanged.

- [ ] **Step 7: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=dtx-api check
bun run --filter=dtx-web check

git add packages/dtx-api/wrangler.jsonc packages/dtx-web/wrangler.jsonc \
  packages/infrastructure/scripts/verify-access.sh \
  packages/infrastructure/scripts/verify-access.test.sh
git commit -m "feat(infrastructure): cut pre-prod domains to Pulumi"
```

Start the minimum 24-hour pre-production soak clock after this gate. Keep alias Workers/KV alive.

---

## Task 4: Import and cut over production

**Files:**
- Modify: `packages/infrastructure/src/access.ts` / `data.ts` only if production import-generated inputs prove a real stack difference.
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-web/wrangler.jsonc`

- [ ] **Step 1: Import production resources with generated code captured privately**

Using the production domain IDs/R2 import ID captured in Task 2:

```bash
cd packages/infrastructure
pulumi import cloudflare:index/d1Database:D1Database dtxweb-production-d1 \
  "$ACCOUNT_ID/19376000-d389-4e0e-a5a8-00d9e31a9ffb" \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-d1.ts"

pulumi import cloudflare:index/r2Bucket:R2Bucket dtxweb-production-r2 \
  "$PRODUCTION_R2_IMPORT_ID" \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-r2.ts"

pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace dtxweb-production-rate-limit-kv \
  "$ACCOUNT_ID/b5ff0ae92972479a9e607818f05e15f8" \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-kv.ts"

pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-production-web-domain \
  "$ACCOUNT_ID/$PRODUCTION_WEB_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-web-domain.ts"

pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-production-api-domain \
  "$ACCOUNT_ID/$PRODUCTION_API_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/production --out "$PRIVATE_DIR/production-api-domain.ts"
```

- [ ] **Step 2: Reconcile any real production input differences**

Compare generated production constructor inputs with the current shared builders. If the provider exposes a real non-default input difference, add the smallest stack-specific field to the existing stack definition and a focused test. Do not copy provider-computed outputs.

- [ ] **Step 3: Require a safe production preview**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure build
cd packages/infrastructure
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/production
```

Expected: no create/replace/delete for imported D1/R2/KV/domains and no Access behavior diff.

- [ ] **Step 4: Apply production Pulumi state**

```bash
pulumi up --refresh --stack cwchanap/dtxweb-infrastructure/production
```

Expected: no stateful replacement/delete.

- [ ] **Step 5: Remove production Wrangler route ownership**

Remove `route` from `env.production` in both Wrangler files. Keep checked-in IDs, variables, service binding, Workflow, Container, DO, compatibility, and observability settings unchanged.

- [ ] **Step 6: Dry-run and deploy production**

```bash
bun run --filter=dtx-api build
cd packages/dtx-web && bun run build && bunx wrangler deploy --dry-run --env production
cd ../..
bun run deploy:api
bun run deploy:web
packages/infrastructure/scripts/verify-access.sh production
```

If a Worker deployment regresses independently of Pulumi resources, use:

```bash
cd packages/dtx-api && bunx wrangler rollback --name dtx-api
cd ../dtx-web && bunx wrangler rollback --name dtx-web
```

This ticket does not change D1 schema, so it adds no schema rollback dependency.

- [ ] **Step 7: Commit production cutover**

```bash
git add packages/infrastructure/src packages/dtx-api/wrangler.jsonc packages/dtx-web/wrangler.jsonc
git commit -m "feat(infrastructure): cut production domains to Pulumi"
```

---

## Task 5: Generalize automatic Pulumi deployment

**Files:**
- Rename: `.github/workflows/deploy-cloudflare-access.yml` -> `.github/workflows/deploy-cloudflare-infrastructure.yml`
- Modify: `packages/infrastructure/src/deploy-workflow.test.ts`
- Modify: `packages/infrastructure/README.md`

- [ ] **Step 1: Write RED workflow-contract expectations**

Update `deploy-workflow.test.ts` to require:

```text
workflow name: Deploy Cloudflare Infrastructure
same two serial jobs: pre-prod then production
same stack names and Pulumi OIDC actions
refresh: true
CLOUDFLARE_API_TOKEN sourced from CLOUDFLARE_INFRA_API_TOKEN
same verify-access.sh calls
no PULUMI_ACCESS_TOKEN / PULUMI_CONFIG_PASSPHRASE / destroy
```

Run:

```bash
bun run --filter=@dtx/infrastructure test -- src/deploy-workflow.test.ts
```

Expected: FAIL against the Access-only workflow.

- [ ] **Step 2: Rename/generalize the workflow**

Preserve the existing pre-prod -> production dependency, concurrency, OIDC, locked actions, package checks, `pulumi up --refresh`, and live verifier. Change only ownership naming/path references and the Cloudflare secret input.

- [ ] **Step 3: Prepare GitHub Environment credentials before merge**

In both existing GitHub Environments (`dtx-access-pre-prod`, `dtx-access-production`), add `CLOUDFLARE_INFRA_API_TOKEN` with the minimum permissions required for:

```text
Access Apps/Policies
D1
R2 bucket identity
Workers KV namespaces
Workers custom domains
```

Keep Environment names/OIDC subjects unchanged. Do not remove the old Access-only secret until the new workflow has run successfully after merge.

- [ ] **Step 4: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check

git add .github/workflows packages/infrastructure/src/deploy-workflow.test.ts packages/infrastructure/README.md
git commit -m "ci(infrastructure): deploy full Pulumi stacks"
```

Do not re-enable the old workflow; it remains disabled until merge, when the renamed workflow on `main` becomes authoritative.

---

## Task 6: Retire `pre-prod-prod-data` after the soak

**Files:**
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Require the 24-hour pre-production soak gate**

Before deleting alias resources, confirm at least 24 hours have elapsed since Task 3's successful pre-production route-free deployment and that no regression required restoring an alias domain.

Re-run:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

- [ ] **Step 2: Write RED cleanup assertions**

Tests must require:

```typescript
expect(apiWrangler.env).not.toHaveProperty('pre-prod-prod-data');
expect(webWrangler.env).not.toHaveProperty('pre-prod-prod-data');
expect(apiPackage.scripts).not.toHaveProperty('deploy:preprod:prod-data');
expect(webPackage.scripts).not.toHaveProperty('deploy:preprod:prod-data');
expect(webPackage.scripts).not.toHaveProperty('deploy:preview');
expect(rootPackage.scripts).not.toHaveProperty('deploy:api:preprod:prod-data');
expect(rootPackage.scripts).not.toHaveProperty('deploy:web:preprod:prod-data');
```

Update `RATE_LIMIT_ENV` expectation to only `'local' | 'prod' | 'pre-prod'`.

- [ ] **Step 3: Remove alias config/scripts and the dead preview script**

Delete `pre-prod-prod-data` env blocks and all related build/migrate/deploy/typegen scripts. Remove `packages/dtx-web`'s `deploy:preview` because no `preview` Wrangler env exists.

- [ ] **Step 4: Inventory alias dependencies immediately before deletion**

Confirm both alias Workers have:

```text
no Worker custom domain
no route
no cron/schedule
no service binding consumer
no remaining operator use
```

Confirm the alias-only KV namespace is not the production or permanent pre-production namespace.

- [ ] **Step 5: Delete only alias Workers and alias-only KV**

Delete:

```text
dtx-api-pre-prod-prod-data
dtx-web-pre-prod-prod-data
alias-only rate-limit KV namespace
```

Never delete or mutate production D1 `dtx-web` or R2 `simfile-dtx` during this cleanup.

This is the point where the fast alias rollback path closes; do it only after the soak and dependency inventory pass.

- [ ] **Step 6: GREEN and commit**

```bash
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-web check
bun run --filter=dtx-desktop test -- src/devTopology.test.ts

git add package.json packages/dtx-api packages/dtx-web packages/dtx-desktop/src/devTopology.test.ts
git commit -m "chore(cloudflare): retire pre-prod prod-data alias"
```

---

## Task 7: Bound documentation and run the final gates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `packages/infrastructure/README.md`
- Create: `docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md`
- Keep unchanged: older dated specs/plans/runbooks except this plan/spec.

- [ ] **Step 1: Write the current operator runbook**

Document:

```text
Pulumi ownership: Access + D1 + R2 + KV + Worker custom domains
Wrangler ownership: Worker release/config + migrations + Workflow/Container/DO
local dev: migrate:local + dev:seed reset path
workflow disable/import/recovery procedure
pre-prod-before-production cutover
24-hour alias soak/deletion gate
production Worker rollback commands
final drift checks
```

- [ ] **Step 2: Update only current docs**

Update `CLAUDE.md` commands/environment description and `packages/infrastructure/README.md`. Do not rewrite the 2026-08-20 Access design/plan or the 2026-08-24/25 M4A design/plan; they remain historical records.

- [ ] **Step 3: Final Pulumi drift gate**

```bash
cd packages/infrastructure
pulumi preview --refresh --expect-no-changes --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi preview --refresh --expect-no-changes --stack cwchanap/dtxweb-infrastructure/production
```

Expected: both exit 0 with no changes.

- [ ] **Step 4: Final application/infra validation**

```bash
cd ../../
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
bun run lint
bunx prettier --check .
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

- [ ] **Step 5: Verify the merge transition**

Before merge:

```text
old Access-only workflow is disabled
new generalized workflow file is present in the PR
both stacks already match the branch program
both GitHub Environments contain CLOUDFLARE_INFRA_API_TOKEN
alias resources have passed soak and cleanup
```

After merge, the generalized workflow's first `main` run must be an ordinary refreshed update with no imports/replacements. Only after that succeeds may the obsolete Access-only Environment secret be removed.

- [ ] **Step 6: Commit documentation**

```bash
git add CLAUDE.md packages/infrastructure/README.md \
  docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md
git commit -m "docs(infrastructure): document Pulumi Cloudflare ownership"
```

---

## Review findings disposition

- Local development using remote pre-production: **accepted**, moved to Task 1 and given a real migration/seed path.
- Wrangler renderer/generated configs: **accepted removal**; native Wrangler environments remain the release source of truth.
- Release vars in infrastructure table: **accepted removal**; only persistent resource identity extends the existing stack table.
- Local empty-database regression: **accepted**; normal dev migrates local D1 and `dev:seed` reuses existing E2E reset/seed.
- Resource declarations before import: **accepted**; workflow disable + import-generated code now precede final declarations.
- Missing risk/rollback: **accepted** in the design; plan includes explicit recovery, Worker rollback, and 24-hour soak gates.
- Split into three PRs: **not adopted** because the project-level constraint is one PR per ticket/task unless explicitly approved. The single PR is sequenced into independent commits/operator gates instead.
- Unbounded historical doc rewriting: **accepted removal**; only `CLAUDE.md`, infrastructure README, and the new runbook are current-doc targets.
- Dead `deploy:preview`: **accepted** and removed with alias cleanup.
