# Pulumi-Managed Cloudflare Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing DTXWeb Pulumi stacks from Access-only ownership to D1, R2 bucket, KV, and Worker custom-domain ownership while keeping Wrangler as the Worker release engine and making checked-in Wrangler configuration local-safe.

**Architecture:** A closed two-stack definition owns permanent names plus every remote non-secret release setting. Pulumi adds only persistent data resources and `WorkersCustomDomain`; it does not manage Worker identity/settings or R2 public-domain/CORS resources. A renderer combines the closed definition with Pulumi-generated D1/KV IDs and writes complete remote Wrangler configs beside each app's checked-in config so relative paths remain valid.

**Tech Stack:** Bun 1.3.9, TypeScript 5.8, Vitest 3, Bash, Pulumi Cloud, `@pulumi/pulumi` 3.258.0, locked `@pulumi/cloudflare` 6.19.0, Wrangler 4.123.0, GitHub Actions OIDC, Cloudflare Workers/D1/R2/KV/Access.

**Spec:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md`

## Global Constraints

- One implementation ticket, one branch/worktree, one implementation pull request.
- Preserve Pulumi stacks `cwchanap/dtxweb-infrastructure/pre-prod` and `cwchanap/dtxweb-infrastructure/production`.
- Preserve the current Access logical names, destinations, policy, operator identity, Perseus posture requirement, and `12h` default session.
- Do not import or create `cloudflare.Worker`, `R2BucketCors`, `R2ManagedDomain`, or `R2CustomDomain` resources.
- Pulumi owns exactly one D1, one R2 bucket, one active rate-limit KV namespace, and two `WorkersCustomDomain` resources per stack in addition to Access.
- D1/R2 use `{ protect: true, retainOnDelete: true }`; KV/custom domains use `{ protect: true }`.
- Wrangler keeps Worker code/assets, observability, compatibility settings, variables/bindings, secrets, Workflows, Containers, Durable Object migrations, and D1 schema migrations.
- Remote release settings come from the closed stack table, never by copying local Wrangler vars.
- Generated remote configs live at the application package root, not under `packages/infrastructure` or nested `.wrangler/generated/` directories.
- `pre-prod-prod-data` is deleted without a compatibility branch; production D1/R2 are never deleted by its cleanup.
- Checked-in local API config has no `remote: true` and root `bun run dev` no longer selects remote pre-production bindings.
- Disable the current Access-only GitHub Actions workflow before the first Pulumi import and keep it disabled until this implementation PR merges.
- Adopt and validate pre-production before production.
- A D1/R2 replacement/delete is always a hard stop. A pre-production custom-domain `service` change from an alias Worker to its permanent Worker is the only expected adoption update.
- Do not detach or recreate `chart.hapadona.com`.
- Do not add automatic Worker deploys, preview stacks, a dynamic provider, a generic component framework, automatic rollback, or automatic destroy.
- Never print/commit Cloudflare tokens, Access email, posture-rule IDs, stack exports, D1 exports, or secret values.
- Use focused TDD: RED, minimum implementation, GREEN, then package-level verification.

---

## Task 1: Define the closed infrastructure and release contract

**Files:**
- Create: `packages/infrastructure/src/config.ts`
- Create: `packages/infrastructure/src/config.test.ts`
- Modify: `packages/infrastructure/Pulumi.pre-prod.yaml`
- Modify: `packages/infrastructure/Pulumi.production.yaml`

**Interfaces:**

```typescript
export type StackName = 'pre-prod' | 'production';

export interface ApiReleaseSettings {
	workflowName: string;
	vars: {
		BETTER_AUTH_URL: string;
		DTX_WEB_URL: string;
		GOOGLE_AUTH_CLIENT_ID: string;
		AUTH_COOKIE_DOMAIN: string;
		AUTH_COOKIE_PREFIX: string;
		RATE_LIMIT_ENV: 'prod' | 'pre-prod';
		GRAPHIQL: 'true' | 'false';
		CORS_ALLOWED_ORIGINS: string;
		PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false';
		PUBLIC_SIMFILE_BUCKET_URL: string;
		BGM_M4A_GENERATION_ENABLED: 'true';
	};
}

export interface WebReleaseSettings {
	vars: {
		PUBLIC_DTX_API_URL: string;
		PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false';
	};
}

export interface InfrastructureDefinition {
	stackName: StackName;
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	rateLimitKvTitle: string;
	apiRelease: ApiReleaseSettings;
	webRelease: WebReleaseSettings;
}

export const getInfrastructureDefinition = (stackName: string): InfrastructureDefinition;
```

- [ ] **Step 1: Capture the remaining live non-secret constants read-only**

Use the current Cloudflare credential without mutating resources:

```bash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set a read-capable Cloudflare token}"
ACCOUNT_ID="$(cd packages/infrastructure && pulumi config get cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/pre-prod)"
PRIVATE_DIR="$(mktemp -d)"
chmod 700 "$PRIVATE_DIR"

curl --fail-with-body --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  > "$PRIVATE_DIR/workers-domains.json"

bunx wrangler kv namespace list > "$PRIVATE_DIR/kv.txt"
bunx wrangler d1 list --json > "$PRIVATE_DIR/d1.json"
```

Record only these values into `config.ts`: the exact active KV title per permanent stack and the existing pre-production public `r2.dev` URL already present in `packages/dtx-api/wrangler.jsonc`. Do not commit the private inventory.

- [ ] **Step 2: Write RED closed-table tests**

Pin the full permanent release contract, including values that differ between stacks:

```typescript
it('defines production release settings', () => {
	const definition = getInfrastructureDefinition('production');
	expect(definition.apiWorkerName).toBe('dtx-api');
	expect(definition.apiRelease.workflowName).toBe('dtx-api-bgm-m4a');
	expect(definition.apiRelease.vars.AUTH_COOKIE_PREFIX).toBe('dtx');
	expect(definition.apiRelease.vars.RATE_LIMIT_ENV).toBe('prod');
	expect(definition.apiRelease.vars.GRAPHIQL).toBe('false');
	expect(definition.apiRelease.vars.CORS_ALLOWED_ORIGINS).toBe('https://dtx.hapadona.com');
	expect(definition.apiRelease.vars.PUBLIC_SIMFILE_BUCKET_URL).toBe(
		'https://chart.hapadona.com'
	);
	expect(definition.webRelease.vars.PUBLIC_DTX_API_URL).toBe('https://api.dtx.hapadona.com');
});

it('defines pre-production release settings', () => {
	const definition = getInfrastructureDefinition('pre-prod');
	expect(definition.apiWorkerName).toBe('dtx-api-pre-prod');
	expect(definition.apiRelease.workflowName).toBe('dtx-api-bgm-m4a-preprod');
	expect(definition.apiRelease.vars.AUTH_COOKIE_PREFIX).toBe('dtx-preprod');
	expect(definition.apiRelease.vars.RATE_LIMIT_ENV).toBe('pre-prod');
	expect(definition.apiRelease.vars.GRAPHIQL).toBe('true');
	expect(definition.apiRelease.vars.CORS_ALLOWED_ORIGINS).toContain(
		'https://pre-prod.dtx.hapadona.com'
	);
	expect(definition.apiRelease.vars.CORS_ALLOWED_ORIGINS).toContain('http://localhost:5173');
	expect(definition.webRelease.vars.PUBLIC_DTX_API_URL).toBe(
		'https://api.pre-prod.dtx.hapadona.com'
	);
});

it.each(['pre-prod-prod-data', 'preview', 'local', ''])('rejects %j', (stack) => {
	expect(() => getInfrastructureDefinition(stack)).toThrow(
		/Unsupported DTXWeb infrastructure stack/
	);
});
```

Run:

```bash
bun run --filter=@dtx/infrastructure test -- src/config.test.ts
```

Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 3: Implement one closed table**

Implement one `Record<StackName, InfrastructureDefinition>`. Keep the shared Google client ID in one constant and make all final per-stack vars visible in the definition. Do not reconstruct cookie/CORS/Workflow values later in the renderer.

- [ ] **Step 4: Add only zone ID to stack config**

Set `cloudflareZoneId` on both existing stacks. Do not add KV title or public R2 URL to Pulumi config.

```bash
cd packages/infrastructure
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/production
```

Verify both stack files still use `secretsprovider: default`, retain encrypted `accessEmail`, and contain no `encryptionsalt`.

- [ ] **Step 5: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test -- src/config.test.ts
bun run --filter=@dtx/infrastructure check
bunx prettier --check packages/infrastructure/src/config.ts packages/infrastructure/src/config.test.ts

git add packages/infrastructure/src/config.ts packages/infrastructure/src/config.test.ts \
  packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml
git commit -m "feat(infrastructure): define Cloudflare stack contracts"
```

---

## Task 2: Declare protected data resources and Worker custom domains

**Files:**
- Create: `packages/infrastructure/src/data.ts`
- Create: `packages/infrastructure/src/data.test.ts`
- Create: `packages/infrastructure/src/domains.ts`
- Create: `packages/infrastructure/src/domains.test.ts`

**Interfaces:**

```typescript
export interface DataResourceArgs {
	accountId: pulumi.Input<string>;
	definition: InfrastructureDefinition;
}

export interface DataResources {
	database: cloudflare.D1Database;
	bucket: cloudflare.R2Bucket;
	rateLimitKv: cloudflare.WorkersKvNamespace;
}

export interface DomainResourceArgs {
	accountId: pulumi.Input<string>;
	zoneId: pulumi.Input<string>;
	definition: InfrastructureDefinition;
}

export interface DomainResources {
	web: cloudflare.WorkersCustomDomain;
	api: cloudflare.WorkersCustomDomain;
}

export const createDataResources = (args: DataResourceArgs): DataResources;
export const createDomainResources = (args: DomainResourceArgs): DomainResources;
```

- [ ] **Step 1: Write RED data-resource tests**

Use hoisted provider constructor spies. Pin exact names and options:

```typescript
expect(d1DatabaseMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-d1',
	expect.objectContaining({ accountId: 'account-id', name: 'dtx-web-preprod' }),
	{ protect: true, retainOnDelete: true }
);
expect(r2BucketMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-r2',
	expect.objectContaining({ accountId: 'account-id', name: 'simfile-dtx-preprod' }),
	{ protect: true, retainOnDelete: true }
);
expect(kvNamespaceMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-rate-limit-kv',
	expect.objectContaining({
		accountId: 'account-id',
		title: getInfrastructureDefinition('pre-prod').rateLimitKvTitle
	}),
	{ protect: true }
);
```

Run and observe RED:

```bash
bun run --filter=@dtx/infrastructure test -- src/data.test.ts
```

- [ ] **Step 2: Implement minimal data declarations**

Declare only captured live non-default D1/R2 fields. Do not add placement, jurisdiction, storage class, or read-replication settings unless the inventory proves they are already configured and required for zero drift.

- [ ] **Step 3: Write RED custom-domain tests**

```typescript
expect(buildWebDomainArgs(args)).toEqual({
	accountId: 'account-id',
	zoneId: 'zone-id',
	hostname: 'pre-prod.dtx.hapadona.com',
	service: 'dtx-web-pre-prod'
});
expect(buildApiDomainArgs(args)).toEqual({
	accountId: 'account-id',
	zoneId: 'zone-id',
	hostname: 'api.pre-prod.dtx.hapadona.com',
	service: 'dtx-api-pre-prod'
});
```

Assert both constructors receive `{ protect: true }` and that the module never constructs `cloudflare.Worker`.

- [ ] **Step 4: Implement `WorkersCustomDomain` only**

Do not declare Worker identity/settings, R2 CORS, managed R2 domains, or R2 custom domains.

- [ ] **Step 5: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test -- src/data.test.ts src/domains.test.ts
bun run --filter=@dtx/infrastructure check

git add packages/infrastructure/src/data.ts packages/infrastructure/src/data.test.ts \
  packages/infrastructure/src/domains.ts packages/infrastructure/src/domains.test.ts
git commit -m "feat(infrastructure): declare Cloudflare data and domains"
```

---

## Task 3: Compose the stack and export only live deployment IDs

**Files:**
- Modify: `packages/infrastructure/src/index.ts`
- Modify: `packages/infrastructure/src/index.test.ts`

**Interfaces:**

```typescript
export interface WorkerDeploymentIds {
	stack: StackName;
	databaseId: string;
	rateLimitKvNamespaceId: string;
}

export const workerDeploymentIds: pulumi.Output<WorkerDeploymentIds>;
```

- [ ] **Step 1: Write RED stack-registration tests**

For `production`, Pulumi runtime mocks must capture exactly:

```text
1 ZeroTrustAccessApplication
1 D1Database
1 R2Bucket
1 WorkersKvNamespace
2 WorkersCustomDomain
```

Assert no resource type contains:

```text
:worker:Worker
r2BucketCors
r2ManagedDomain
r2CustomDomain
```

Resolve `workerDeploymentIds` and assert only stack + D1 ID + KV ID are exported.

- [ ] **Step 2: Compose the complete program**

Load `cloudflareAccountId`, `cloudflareZoneId`, Access config, and the closed definition. Create Access/data/domains and export the two provider-generated IDs.

- [ ] **Step 3: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test -- src/index.test.ts
bun run --filter=@dtx/infrastructure check

git add packages/infrastructure/src/index.ts packages/infrastructure/src/index.test.ts
git commit -m "feat(infrastructure): compose persistent Cloudflare stack"
```

---

## Task 4: Make Wrangler local-first and render complete remote configs

**Files:**
- Create: `packages/infrastructure/src/wrangler.ts`
- Create: `packages/infrastructure/src/wrangler.test.ts`
- Create: `packages/infrastructure/scripts/render-wrangler-config.ts`
- Modify: `packages/infrastructure/package.json`
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-web/.gitignore`
- Modify: `.gitignore`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `package.json`

**Interfaces:**

```typescript
export const renderApiRemoteConfig = (
	localConfig: ApiWranglerConfig,
	definition: InfrastructureDefinition,
	ids: WorkerDeploymentIds
): ApiWranglerConfig;

export const renderWebRemoteConfig = (
	localConfig: WebWranglerConfig,
	definition: InfrastructureDefinition
): WebWranglerConfig;
```

Generated paths:

```text
packages/dtx-api/wrangler.remote.pre-prod.generated.jsonc
packages/dtx-api/wrangler.remote.production.generated.jsonc
packages/dtx-web/wrangler.remote.pre-prod.generated.jsonc
packages/dtx-web/wrangler.remote.production.generated.jsonc
```

- [ ] **Step 1: Write RED renderer tests**

Start from a local-safe fixture and assert remote production/pre-production configs replace rather than inherit remote-sensitive values:

```typescript
const rendered = renderApiRemoteConfig(localApiConfig, definition, ids);

expect(rendered.name).toBe(definition.apiWorkerName);
expect(rendered.route).toBeUndefined();
expect(rendered.routes).toBeUndefined();
expect(rendered.env).toBeUndefined();
expect(rendered.workers_dev).toBe(false);
expect(rendered.preview_urls).toBe(false);
expect(rendered.vars).toEqual(definition.apiRelease.vars);
expect(rendered.workflows?.[0]?.name).toBe(definition.apiRelease.workflowName);
expect(rendered.d1_databases?.[0]).toMatchObject({
	binding: 'DB',
	database_name: definition.databaseName,
	database_id: ids.databaseId
});
expect(rendered.kv_namespaces?.[0]).toMatchObject({
	binding: 'RATE_LIMIT_API',
	id: ids.rateLimitKvNamespaceId
});
expect(rendered.r2_buckets?.[0]).toMatchObject({
	binding: 'DTXFILE_BUCKET',
	bucket_name: definition.bucketName
});
```

Also assert a pre-production remote config cannot contain:

```text
AUTH_COOKIE_PREFIX=dtx-local
RATE_LIMIT_ENV=local
localhost-only CORS in place of the closed release value
local Workflow name
pre-prod-prod-data
```

For web, assert exact service target and `PUBLIC_DTX_API_URL` from the definition.

- [ ] **Step 2: Rewrite checked-in API config as local-safe defaults**

Keep local D1 name `dtx-web`. Use schema-valid local-only IDs where Wrangler requires an ID, for example:

```jsonc
"kv_namespaces": [{ "binding": "RATE_LIMIT_API", "id": "00000000000000000000000000000000" }],
"d1_databases": [{
  "binding": "DB",
  "database_name": "dtx-web",
  "database_id": "00000000-0000-0000-0000-000000000000",
  "migrations_dir": "d1-migrations"
}],
"r2_buckets": [{ "binding": "DTXFILE_BUCKET", "bucket_name": "simfile-dtx" }]
```

Set local-safe vars:

```jsonc
"BETTER_AUTH_URL": "http://localhost:8787",
"DTX_WEB_URL": "http://localhost:5173",
"AUTH_COOKIE_PREFIX": "dtx-local",
"RATE_LIMIT_ENV": "local",
"GRAPHIQL": "true",
"CORS_ALLOWED_ORIGINS": "http://localhost:5173",
"BGM_M4A_GENERATION_ENABLED": "false"
```

Remove `route`, all `env` blocks, and every `remote: true`. Extend `Env['RATE_LIMIT_ENV']` to `'local' | 'prod' | 'pre-prod'`.

- [ ] **Step 3: Rewrite checked-in web config as local-safe defaults**

Remove `route` and `env`. Keep `main`, assets, and service binding shape. Set `PUBLIC_DTX_API_URL` to `http://localhost:8787`.

- [ ] **Step 4: Implement the renderer and package-root writer**

`render-wrangler-config.ts` takes exactly:

```text
pre-prod api
pre-prod web
production api
production web
```

It resolves repository/application paths from `import.meta.url`, reads the appropriate checked-in config, runs `pulumi stack output workerDeploymentIds --json` for API rendering, validates `output.stack === requestedStack`, then writes the package-root generated filename.

Do not put the generated config under `packages/infrastructure` or nested `.wrangler/`; relative `main`, alias, Container, and asset paths must remain relative to the application package.

- [ ] **Step 5: Replace deployment scripts and remove the alias**

Preserve root names:

```text
deploy:api
deploy:api:preprod
deploy:web
deploy:web:preprod
```

Remove every `preprod:prod-data` deploy/migration/build/typegen script.

Each remote deploy renders first, then uses the generated package-root config with Wrangler. API still applies D1 migrations immediately before `wrangler deploy`.

- [ ] **Step 6: Update local topology tests**

`devTopology.test.ts` must assert:

```text
root dev uses dtx-api#dev:local without --env pre-prod
checked-in API D1 name is dtx-web
no API R2/D1 binding has remote: true
AUTH cookie prefix is dtx-local
CORS contains localhost:5173
pre-prod-prod-data is absent
```

Update API Wrangler contract tests that currently assert the old alias Workflow behavior.

- [ ] **Step 7: Verify generated configs with Wrangler dry runs**

With valid Pulumi outputs available, render each stack and run from each application package:

```bash
cd packages/dtx-api
bunx wrangler deploy --dry-run --config wrangler.remote.pre-prod.generated.jsonc --containers-rollout=none
bunx wrangler deploy --dry-run --config wrangler.remote.production.generated.jsonc --containers-rollout=none

cd ../dtx-web
bun run build
bunx wrangler deploy --dry-run --config wrangler.remote.pre-prod.generated.jsonc
bunx wrangler deploy --dry-run --config wrangler.remote.production.generated.jsonc
```

Expected: all relative `main`, alias, Container, and assets paths resolve from the app package; no route/env warning indicates remote environment inheritance.

- [ ] **Step 8: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test -- src/wrangler.test.ts
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=dtx-api test -- src/index.test.ts
bun run --filter=dtx-api check
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
bun run --filter=dtx-web check

git add packages/infrastructure packages/dtx-api packages/dtx-web \
  packages/dtx-desktop/src/devTopology.test.ts package.json .gitignore
git commit -m "refactor(cloudflare): render remote Wrangler releases"
```

---

## Task 5: Replace Access-only automation and reconcile documentation

**Files:**
- Create: `.github/workflows/deploy-cloudflare-infrastructure.yml`
- Create: `packages/infrastructure/scripts/verify-infrastructure.sh`
- Create: `packages/infrastructure/scripts/verify-infrastructure.test.sh`
- Modify: `packages/infrastructure/src/deploy-workflow.test.ts`
- Modify: `packages/infrastructure/package.json`
- Modify: `packages/infrastructure/README.md`
- Delete: `.github/workflows/deploy-cloudflare-access.yml`
- Create: `docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md`
- Modify: current Access/M4A docs that describe Access-only ownership or active `pre-prod-prod-data`

- [ ] **Step 1: Write RED workflow-contract tests**

Require:

```text
workflow name: Deploy Cloudflare Infrastructure
pre-prod job before production
production needs deploy-pre-prod
same dtx-access-pre-prod / dtx-access-production GitHub Environments
Pulumi Cloud OIDC actions remain SHA-pinned
pulumi up has refresh: true and suppress-outputs: true
CLOUDFLARE_API_TOKEN comes from CLOUDFLARE_INFRA_API_TOKEN
no Worker deploy command exists in this workflow
Access verifier runs after each stack update
infrastructure verifier runs after each stack update
old deploy-cloudflare-access.yml no longer exists
```

- [ ] **Step 2: Implement the generalized Pulumi workflow**

Keep the existing push/dispatch, concurrency, main-ref guard, build/test, OIDC, stack names, and serial ordering. Broaden only the Cloudflare credential and post-update verification.

- [ ] **Step 3: Add fail-closed live infrastructure verification**

`verify-infrastructure.sh <pre-prod|production>` checks without printing IDs:

```text
expected web hostname responds
expected API /healthz responds 200
Access boundary verifier passes
```

Do not make the script enumerate or echo stack outputs.

- [ ] **Step 4: Reconcile docs**

Update documentation so it no longer says:

```text
Pulumi manages Access only
pre-prod-prod-data remains active
R2 public domains are moving to Pulumi in this ticket
Worker identity/settings are Pulumi-owned
```

The runbook owns the workflow-disable/import/remap/cleanup sequence from Tasks 6-7.

- [ ] **Step 5: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bunx prettier --check .github/workflows/deploy-cloudflare-infrastructure.yml \
  packages/infrastructure docs/superpowers

git add .github packages/infrastructure docs/superpowers
git commit -m "ci(infrastructure): generalize Cloudflare Pulumi deployment"
```

---

## Task 6: Disable the old workflow and adopt pre-production

**External mutation gate:** do not begin until Tasks 1-5 are reviewed in the implementation PR and the branch passes all code-only checks.

- [ ] **Step 1: Disable the currently deployed Access-only workflow before any import**

From a trusted operator checkout/account:

```bash
gh workflow disable deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
gh workflow view deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
```

Expected: GitHub reports the workflow disabled. Keep it disabled until this implementation PR merges.

Do not rely on `protect` alone; the main-branch Access-only program must not run against expanded stack state.

- [ ] **Step 2: Capture pre-production import IDs privately**

Resolve without printing into chat/log artifacts:

```text
D1 database ID for dtx-web-preprod
R2 jurisdiction for simfile-dtx-preprod
active pre-production rate-limit KV namespace ID
web custom-domain ID for pre-prod.dtx.hapadona.com
API custom-domain ID for api.pre-prod.dtx.hapadona.com
current service target of both custom domains
```

If a domain currently targets `*-pre-prod-prod-data`, record that as `alias-active`; do not fail inventory.

- [ ] **Step 3: Import the five resources**

From `packages/infrastructure` on the implementation branch:

```bash
pulumi import cloudflare:index/d1Database:D1Database \
  dtxweb-pre-prod-d1 "$CF_ACCOUNT_ID/$PREPROD_D1_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --protect

pulumi import cloudflare:index/r2Bucket:R2Bucket \
  dtxweb-pre-prod-r2 "$CF_ACCOUNT_ID/simfile-dtx-preprod/$PREPROD_R2_JURISDICTION" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --protect

pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace \
  dtxweb-pre-prod-rate-limit-kv "$CF_ACCOUNT_ID/$PREPROD_KV_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --protect

pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain \
  dtxweb-pre-prod-web-domain "$CF_ACCOUNT_ID/$PREPROD_WEB_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --protect

pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain \
  dtxweb-pre-prod-api-domain "$CF_ACCOUNT_ID/$PREPROD_API_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --protect
```

Expected: imports are protected by state and match source logical names.

- [ ] **Step 4: Preview with one allowed alias-remap exception**

```bash
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod --diff
```

Allowed outcomes:

```text
Access unchanged
D1 unchanged
R2 unchanged
KV unchanged
each custom domain unchanged OR only service: alias Worker -> permanent pre-prod Worker
```

Any D1/R2 replacement/delete, hostname change, or unrelated field change is a hard stop.

- [ ] **Step 5: Apply the expected pre-production domain remap**

```bash
pulumi up --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Then require a second preview with zero changes.

- [ ] **Step 6: Exercise generated pre-production Worker releases**

```bash
bun run deploy:api:preprod
bun run deploy:web:preprod
```

Verify:

```bash
curl --fail --silent https://api.pre-prod.dtx.hapadona.com/healthz >/dev/null
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-infrastructure.sh pre-prod
```

Also exercise one D1-backed API read, one R2-backed file read, one rate-limit path, and the BGM Workflow/Container path used by the existing M4A smoke/reconciliation tooling.

- [ ] **Step 7: Record the gate outcome in the implementation PR**

Post only pass/fail summaries and resource names. Do not paste IDs, API payloads, cookies, or stack state.

---

## Task 7: Adopt production and remove the alias

- [ ] **Step 1: Import production D1/R2/KV/custom domains**

Use the same documented import formats and logical names:

```text
dtxweb-production-d1
dtxweb-production-r2
dtxweb-production-rate-limit-kv
dtxweb-production-web-domain
dtxweb-production-api-domain
```

Do not create/import `cloudflare.Worker` or any R2 public-domain/CORS resource.

- [ ] **Step 2: Require production zero drift**

```bash
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/production --diff
```

Expected: zero changes. `chart.hapadona.com` is outside the Pulumi program and therefore cannot be detached or replaced by this update.

- [ ] **Step 3: Exercise generated production Worker releases**

```bash
bun run deploy:api
bun run deploy:web
curl --fail --silent https://api.dtx.hapadona.com/healthz >/dev/null
packages/infrastructure/scripts/verify-access.sh production
packages/infrastructure/scripts/verify-infrastructure.sh production
```

Verify the same representative D1/R2/KV/BGM paths as pre-production.

- [ ] **Step 4: Prove alias Workers are unused**

Before deletion, confirm both alias Workers have:

```text
no custom domains
no routes
no schedules
no service consumers
no Workflow/Container traffic required by permanent pre-production
```

Confirm the alias-only KV namespace is not the namespace now bound by `dtx-api-pre-prod`.

- [ ] **Step 5: Delete only alias resources**

Delete:

```text
dtx-api-pre-prod-prod-data Worker
dtx-web-pre-prod-prod-data Worker
alias-only rate-limit KV namespace
```

Do not delete or mutate production `dtx-web` D1 or `simfile-dtx` R2.

- [ ] **Step 6: Re-run pre-production verification after cleanup**

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-infrastructure.sh pre-prod
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod --expect-no-changes
```

---

## Task 8: Final verification and merge handoff

- [ ] **Step 1: Run code gates**

```bash
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
bun run lint
bunx prettier --check .
```

- [ ] **Step 2: Run both Pulumi no-change gates**

```bash
cd packages/infrastructure
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/pre-prod --expect-no-changes
pulumi preview --refresh --stack cwchanap/dtxweb-infrastructure/production --expect-no-changes
```

- [ ] **Step 3: Confirm the old workflow is still disabled before merge**

```bash
gh workflow view deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
```

Do not re-enable it. The implementation PR deletes that file.

- [ ] **Step 4: Merge the single implementation PR**

At this point live stack state matches the program being merged. The merged commit introduces `.github/workflows/deploy-cloudflare-infrastructure.yml` and removes the disabled Access-only workflow.

- [ ] **Step 5: Verify the generalized workflow immediately after merge**

If the merge push does not start it automatically, dispatch it from `main`. Require:

```text
pre-production Pulumi up --refresh succeeds
pre-production Access/infrastructure verification succeeds
production starts only after pre-production succeeds
production Pulumi up --refresh succeeds
production Access/infrastructure verification succeeds
```

- [ ] **Step 6: Final completion statement**

Report the implementation complete only after the post-merge workflow succeeds and both Pulumi previews remain clean. Keep all credential/ID values out of the report.
