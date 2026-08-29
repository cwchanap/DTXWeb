# Pulumi-Managed Cloudflare Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the two existing DTXWeb Pulumi Cloud stacks from Access-only ownership to all permanent DTXWeb-owned Cloudflare infrastructure while retaining Wrangler as the Worker release engine and preserving every live stateful resource.

**Architecture:** Pulumi imports and protects D1, R2, KV, Worker identity/settings, Worker custom domains, Access, and bucket-level public settings. A small tested renderer reads one non-secret Pulumi output and writes ignored Wrangler deployment files containing version-coupled bindings and variables. Checked-in Wrangler configuration remains local-first, so routine development and Web E2E never require Pulumi Cloud.

**Tech Stack:** Bun 1.3.9, TypeScript 5.8, Vitest 3, Bash, Pulumi Cloud, `@pulumi/pulumi` 3.258.0, locked `@pulumi/cloudflare` 6.19.0, Wrangler 4.123.0, GitHub Actions OIDC, Cloudflare Workers/D1/R2/KV/Access.

**Spec:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md`

## Global constraints

- Implement this ticket in one isolated worktree, one branch, and one pull request.
- Keep the pull request draft until both Pulumi stacks, both generated Worker releases, and all live verification gates pass.
- Preserve these stack identities exactly:
  - `cwchanap/dtxweb-infrastructure/pre-prod`
  - `cwchanap/dtxweb-infrastructure/production`
- Preserve the current Access logical names, destinations, policy, configured identity, Perseus posture rule, and `12h` session default.
- Adopt and verify pre-production before mutating production.
- Any D1, R2, Worker, or Worker-domain replacement/delete in a preview is a hard stop.
- Every permanent resource uses `protect: true`; D1 and R2 additionally use `retainOnDelete: true`.
- Never hand-edit Pulumi state. Never commit or print stack exports, D1 exports, Cloudflare API responses, tokens, Access email, posture-rule ID, or Pulumi ciphertext.
- Do not export secrets through Pulumi outputs or generated Wrangler files.
- Keep Worker code/assets, compatibility metadata, version bindings/variables, Workflow/Container/Durable Object declarations, D1 migrations, and Worker releases in Wrangler.
- Do not add Pulumi Worker versions/deployments, a dynamic provider, a component framework, preview stacks, automatic Worker release CI, automatic rollback, or automatic destroy.
- Use the already locked Cloudflare provider. Upgrade only after reproducing a provider defect that blocks this plan.
- Reuse GitHub Environments `dtx-access-pre-prod` and `dtx-access-production`, preserving the existing Pulumi OIDC subjects.
- Replace the environment secret with `CLOUDFLARE_INFRA_API_TOKEN`; expose it only as `CLOUDFLARE_API_TOKEN` during provider/API operations.
- Remove `pre-prod-prod-data` without a compatibility branch. Never delete or mutate the production D1/R2 resources it referenced.
- Use TDD for behavior changes: focused RED, minimal implementation, focused GREEN, then the broader package gate.
- External Cloudflare/Pulumi mutations are operator gates. A code-only executor stops before the command and reports the exact next step.

## File map

### Create

- `packages/infrastructure/src/config.ts`
- `packages/infrastructure/src/config.test.ts`
- `packages/infrastructure/src/data.ts`
- `packages/infrastructure/src/data.test.ts`
- `packages/infrastructure/src/workers.ts`
- `packages/infrastructure/src/workers.test.ts`
- `packages/infrastructure/src/r2-public.ts`
- `packages/infrastructure/src/r2-public.test.ts`
- `packages/infrastructure/src/wrangler.ts`
- `packages/infrastructure/src/wrangler.test.ts`
- `packages/infrastructure/scripts/render-wrangler-config.ts`
- `packages/infrastructure/scripts/verify-infrastructure.sh`
- `packages/infrastructure/scripts/verify-infrastructure.test.sh`
- `.github/workflows/deploy-cloudflare-infrastructure.yml`
- `docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md`

### Modify

- `packages/infrastructure/src/index.ts`
- `packages/infrastructure/src/index.test.ts`
- `packages/infrastructure/src/deploy-workflow.test.ts`
- `packages/infrastructure/package.json`
- `packages/infrastructure/README.md`
- `packages/infrastructure/Pulumi.pre-prod.yaml`
- `packages/infrastructure/Pulumi.production.yaml`
- `packages/infrastructure/.gitignore`
- `packages/dtx-api/wrangler.jsonc`
- `packages/dtx-api/package.json`
- `packages/dtx-api/src/env.ts`
- `packages/dtx-api/src/index.test.ts`
- `packages/dtx-web/wrangler.jsonc`
- `packages/dtx-web/package.json`
- `packages/dtx-desktop/src/devTopology.test.ts`
- `package.json`
- `CLAUDE.md`
- current Cloudflare Access/M4A specs, plans, and runbooks that describe superseded ownership or `pre-prod-prod-data`

### Delete

- `.github/workflows/deploy-cloudflare-access.yml`

---

## Task 1: Capture the live contract and define the two permanent stacks

**Files:**

- Create: `packages/infrastructure/src/config.ts`
- Create: `packages/infrastructure/src/config.test.ts`
- Modify: `packages/infrastructure/Pulumi.pre-prod.yaml`
- Modify: `packages/infrastructure/Pulumi.production.yaml`

**Interfaces:**

```typescript
export type StackName = 'pre-prod' | 'production';

export interface InfrastructureDefinition {
	stackName: StackName;
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	publicSimfileBaseUrl: 'managed-r2' | 'https://chart.hapadona.com';
}

export const getInfrastructureDefinition = (stackName: string): InfrastructureDefinition;
```

- [ ] **Step 1: Capture read-only live settings privately**

Create a private directory outside the repository and record its path without printing resource payloads:

```bash
rtk bash -c 'set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set a read-capable Cloudflare token}"
PRIVATE_DIR="$(mktemp -d)"
chmod 700 "$PRIVATE_DIR"
printf "%s" "$PRIVATE_DIR" > /tmp/dtxweb-cloudflare-inventory-dir
'
```

Use the Cloudflare API/Wrangler to capture:

```text
Worker identities and custom domains
D1 IDs/names/settings
R2 bucket settings, CORS, managed domain, custom domains
KV namespace IDs and exact live titles
Worker observability, tags, tail consumers, and subdomain state
```

Write JSON only under the private directory. Validate, without printing IDs, that the permanent matrix is:

```text
pre-prod:   dtx-web-pre-prod, dtx-api-pre-prod, dtx-web-preprod, simfile-dtx-preprod
production: dtx-web,          dtx-api,          dtx-web,         simfile-dtx
```

Stop on duplicate hostnames, wrong Worker service targets, an unknown R2 public domain, or account/zone mismatch.

- [ ] **Step 2: Write the failing closed-table test**

```typescript
import { describe, expect, it } from 'vitest';
import { getInfrastructureDefinition } from './config.js';

describe('getInfrastructureDefinition', () => {
	it('defines pre-production', () => {
		expect(getInfrastructureDefinition('pre-prod')).toEqual({
			stackName: 'pre-prod',
			webWorkerName: 'dtx-web-pre-prod',
			apiWorkerName: 'dtx-api-pre-prod',
			webHostname: 'pre-prod.dtx.hapadona.com',
			apiHostname: 'api.pre-prod.dtx.hapadona.com',
			databaseName: 'dtx-web-preprod',
			bucketName: 'simfile-dtx-preprod',
			publicSimfileBaseUrl: 'managed-r2'
		});
	});

	it('defines production', () => {
		expect(getInfrastructureDefinition('production')).toEqual({
			stackName: 'production',
			webWorkerName: 'dtx-web',
			apiWorkerName: 'dtx-api',
			webHostname: 'dtx.hapadona.com',
			apiHostname: 'api.dtx.hapadona.com',
			databaseName: 'dtx-web',
			bucketName: 'simfile-dtx',
			publicSimfileBaseUrl: 'https://chart.hapadona.com'
		});
	});

	it.each(['pre-prod-prod-data', 'preview', 'development', ''])('rejects %j', (stack) => {
		expect(() => getInfrastructureDefinition(stack)).toThrow(
			/Unsupported DTXWeb infrastructure stack/
		);
	});
});
```

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/config.test.ts
```

Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 3: Implement the closed table**

Use one `Record<StackName, InfrastructureDefinition>` and a narrow runtime guard. Do not make resource names or hostnames arbitrary Pulumi config.

- [ ] **Step 4: Add stack-specific zone/KV config**

Set `cloudflareZoneId` and the exact captured active KV title on both remote stacks. Keep `cloudflareAccountId`, encrypted `accessEmail`, and `devicePostureRuleId` unchanged. Verify both files retain `secretsprovider: default`, contain no `encryptionsalt`, and do not expose the email.

- [ ] **Step 5: Verify and commit**

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/config.test.ts
rtk bun run --filter=@dtx/infrastructure check
rtk bunx prettier --check packages/infrastructure/src/config.ts packages/infrastructure/src/config.test.ts packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml
rtk git add packages/infrastructure/src/config.ts packages/infrastructure/src/config.test.ts packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml
rtk git commit -m "feat(infrastructure): define permanent Cloudflare stacks"
```

---

## Task 2: Declare protected D1, R2, and KV resources

**Files:**

- Create: `packages/infrastructure/src/data.ts`
- Create: `packages/infrastructure/src/data.test.ts`

**Interfaces:**

```typescript
export interface DataResourceArgs {
	accountId: pulumi.Input<string>;
	definition: InfrastructureDefinition;
	rateLimitKvTitle: pulumi.Input<string>;
}

export interface DataResources {
	database: cloudflare.D1Database;
	bucket: cloudflare.R2Bucket;
	rateLimitKv: cloudflare.WorkersKvNamespace;
}

export const createDataResources = (args: DataResourceArgs): DataResources;
```

- [ ] **Step 1: Write failing argument and resource-option tests**

Use hoisted Vitest constructor spies and assert both stacks map to the exact names. Pin these options at the constructor seam:

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
	expect.objectContaining({ accountId: 'account-id', title: 'pre-prod-rate-limit-title' }),
	{ protect: true }
);
```

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/data.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement minimal builders and creators**

Export and reuse:

```typescript
export const STATEFUL_RESOURCE_OPTIONS = {
	protect: true,
	retainOnDelete: true
} as const;

export const PERSISTENT_RESOURCE_OPTIONS = {
	protect: true
} as const;
```

Include only captured non-default D1/R2 settings needed for a zero-diff import. Do not invent jurisdiction, placement, storage class, or read-replication settings.

- [ ] **Step 3: Verify and commit**

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/data.test.ts
rtk bun run --filter=@dtx/infrastructure check
rtk git add packages/infrastructure/src/data.ts packages/infrastructure/src/data.test.ts
rtk git commit -m "feat(infrastructure): declare Cloudflare data resources"
```

---

## Task 3: Declare Worker identities, custom domains, and R2 public settings

**Files:**

- Create: `packages/infrastructure/src/workers.ts`
- Create: `packages/infrastructure/src/workers.test.ts`
- Create: `packages/infrastructure/src/r2-public.ts`
- Create: `packages/infrastructure/src/r2-public.test.ts`

**Interfaces:**

```typescript
export interface WorkerInfrastructureArgs {
	accountId: pulumi.Input<string>;
	zoneId: pulumi.Input<string>;
	definition: InfrastructureDefinition;
}

export interface WorkerInfrastructure {
	webWorker: cloudflare.Worker;
	apiWorker: cloudflare.Worker;
	webDomain: cloudflare.WorkersCustomDomain;
	apiDomain: cloudflare.WorkersCustomDomain;
}

export interface R2PublicSettings {
	cors?: cloudflare.R2BucketCors;
	publicDomain: cloudflare.R2ManagedDomain | cloudflare.R2CustomDomain;
	publicBaseUrl: pulumi.Output<string>;
}
```

- [ ] **Step 1: Write failing Worker tests**

Pin exact Worker names, captured observability/subdomain settings, exact custom-domain host/service/zone mappings, omission of deprecated `environment`, and `{ protect: true }` on all four resources.

```typescript
expect(buildCustomDomainArgs('api', args)).toEqual({
	accountId: 'account-id',
	hostname: 'api.pre-prod.dtx.hapadona.com',
	service: 'dtx-api-pre-prod',
	zoneId: 'zone-id'
});
```

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/workers.test.ts
```

- [ ] **Step 2: Implement Worker resources**

Use `cloudflare.Worker` for stable Worker identity/settings and `cloudflare.WorkersCustomDomain` for hostname mappings. Mirror live observability, tags, tail consumers, and subdomain settings exactly; do not add new logging features.

- [ ] **Step 3: Write failing R2 public-setting tests**

Convert only the captured live CORS rules into typed constants. When a bucket has no CORS policy, omit `R2BucketCors` and test that absence explicitly.

Pre-production creates a protected enabled `R2ManagedDomain`. Production creates a protected enabled `R2CustomDomain` for `chart.hapadona.com`, preserving captured zone/TLS/cipher settings.

- [ ] **Step 4: Implement R2 public settings**

For pre-production, derive `publicBaseUrl` from the managed-domain output. Production uses `https://chart.hapadona.com`. Never hard-code the generated `r2.dev` hostname.

- [ ] **Step 5: Verify and commit**

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/workers.test.ts src/r2-public.test.ts
rtk bun run --filter=@dtx/infrastructure check
rtk git add packages/infrastructure/src/workers.ts packages/infrastructure/src/workers.test.ts packages/infrastructure/src/r2-public.ts packages/infrastructure/src/r2-public.test.ts
rtk git commit -m "feat(infrastructure): declare Worker and R2 public resources"
```

---

## Task 4: Compose the complete stack and export one deployment contract

**Files:**

- Modify: `packages/infrastructure/src/index.ts`
- Modify: `packages/infrastructure/src/index.test.ts`

**Produces:**

```typescript
export interface WorkerDeploymentConfig {
	stack: StackName;
	web: {
		workerName: string;
		hostname: string;
		apiServiceName: string;
	};
	api: {
		workerName: string;
		hostname: string;
		databaseId: string;
		databaseName: string;
		bucketName: string;
		rateLimitKvNamespaceId: string;
		publicSimfileBucketUrl: string;
	};
}

export const workerDeploymentConfig: pulumi.Output<WorkerDeploymentConfig>;
```

- [ ] **Step 1: Replace the one-resource runtime-mock test with a stack matrix**

For each stack, set all five config keys and assert exact resource types/logical names:

```text
1 ZeroTrustAccessApplication
1 D1Database
1 R2Bucket
1 WorkersKvNamespace
2 Worker
2 WorkersCustomDomain
0 or 1 R2BucketCors according to captured policy
1 R2ManagedDomain or R2CustomDomain
```

Resolve `workerDeploymentConfig` and assert the complete non-secret object. Assert its serialized form excludes Access email, posture rule, token/secret/ciphertext markers, and Access application ID.

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/index.test.ts
```

Expected: FAIL against the Access-only composition root.

- [ ] **Step 2: Compose resources and output**

Load `cloudflareAccountId`, `cloudflareZoneId`, `rateLimitKvTitle`, and the existing Access config. Create each module once and construct `workerDeploymentConfig` with `pulumi.all`.

Remove `accessApplicationId` when repository search finds no consumer; otherwise retain it temporarily and document the consumer.

- [ ] **Step 3: Verify package and commit**

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure test:coverage
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk test -f packages/infrastructure/dist/index.js
rtk git add packages/infrastructure/src/index.ts packages/infrastructure/src/index.test.ts
rtk git commit -m "feat(infrastructure): compose Cloudflare stack outputs"
```

Do not run `pulumi up` yet; live resources are not imported.

---

## Task 5: Adopt the complete pre-production stack

**Files:** none unless a zero-diff correction is required. This is an operator gate from the draft PR branch.

- [ ] **Step 1: Back up pre-production D1 privately**

Use the still-existing remote Wrangler environment:

```bash
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
cd packages/dtx-api
bunx wrangler d1 export dtx-web-preprod --remote --env pre-prod \
  --output "$PRIVATE_DIR/dtx-web-preprod.sql"
test -s "$PRIVATE_DIR/dtx-web-preprod.sql"
chmod 600 "$PRIVATE_DIR/dtx-web-preprod.sql"
'
```

Never attach this export to the PR or CI artifacts.

- [ ] **Step 2: Persist resolved import IDs in a private shell file**

Resolve IDs from the private inventory and current committed config, then write shell-escaped assignments:

```bash
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
CF_ACCOUNT_ID="$(cd packages/infrastructure && pulumi config get cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/pre-prod)"
PREPROD_D1_ID="$(jq -er ".env[\"pre-prod\"].d1_databases[0].database_id" packages/dtx-api/wrangler.jsonc)"
PREPROD_KV_ID="$(jq -er ".env[\"pre-prod\"].kv_namespaces[0].id" packages/dtx-api/wrangler.jsonc)"
PREPROD_WEB_DOMAIN_ID="$(jq -er ".result[] | select(.hostname == \"pre-prod.dtx.hapadona.com\" and .service == \"dtx-web-pre-prod\") | .id" "$PRIVATE_DIR/worker-domains.json")"
PREPROD_API_DOMAIN_ID="$(jq -er ".result[] | select(.hostname == \"api.pre-prod.dtx.hapadona.com\" and .service == \"dtx-api-pre-prod\") | .id" "$PRIVATE_DIR/worker-domains.json")"
umask 077
{
  printf "CF_ACCOUNT_ID=%q\n" "$CF_ACCOUNT_ID"
  printf "PREPROD_D1_ID=%q\n" "$PREPROD_D1_ID"
  printf "PREPROD_KV_ID=%q\n" "$PREPROD_KV_ID"
  printf "PREPROD_WEB_DOMAIN_ID=%q\n" "$PREPROD_WEB_DOMAIN_ID"
  printf "PREPROD_API_DOMAIN_ID=%q\n" "$PREPROD_API_DOMAIN_ID"
} > "$PRIVATE_DIR/pre-prod-import.env"
'
```

- [ ] **Step 3: Import supported resources**

In one shell, source the private assignments and import these exact logical names:

```bash
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
source "$PRIVATE_DIR/pre-prod-import.env"
cd packages/infrastructure
STACK="cwchanap/dtxweb-infrastructure/pre-prod"
pulumi import cloudflare:index/d1Database:D1Database dtxweb-pre-prod-d1 "$CF_ACCOUNT_ID/$PREPROD_D1_ID" --stack "$STACK" --yes
pulumi import cloudflare:index/r2Bucket:R2Bucket dtxweb-pre-prod-r2 "$CF_ACCOUNT_ID/simfile-dtx-preprod/default" --stack "$STACK" --yes
pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace dtxweb-pre-prod-rate-limit-kv "$CF_ACCOUNT_ID/$PREPROD_KV_ID" --stack "$STACK" --yes
pulumi import cloudflare:index/worker:Worker dtxweb-pre-prod-web-worker "$CF_ACCOUNT_ID/dtx-web-pre-prod" --stack "$STACK" --yes
pulumi import cloudflare:index/worker:Worker dtxweb-pre-prod-api-worker "$CF_ACCOUNT_ID/dtx-api-pre-prod" --stack "$STACK" --yes
pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-pre-prod-web-domain "$CF_ACCOUNT_ID/$PREPROD_WEB_DOMAIN_ID" --stack "$STACK" --yes
pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain dtxweb-pre-prod-api-domain "$CF_ACCOUNT_ID/$PREPROD_API_DOMAIN_ID" --stack "$STACK" --yes
'
```

After each import, verify provider type/name/hostname/service without printing full state.

- [ ] **Step 4: Protect the imported URNs explicitly**

Do not parse human-formatted `pulumi stack` output. Protect exact URNs:

```bash
rtk bash -c 'set -euo pipefail
cd packages/infrastructure
STACK="cwchanap/dtxweb-infrastructure/pre-prod"
for urn in \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/d1Database:D1Database::dtxweb-pre-prod-d1" \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/r2Bucket:R2Bucket::dtxweb-pre-prod-r2" \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/workersKvNamespace:WorkersKvNamespace::dtxweb-pre-prod-rate-limit-kv" \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/worker:Worker::dtxweb-pre-prod-web-worker" \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/worker:Worker::dtxweb-pre-prod-api-worker" \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::dtxweb-pre-prod-web-domain" \
  "urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/workersCustomDomain:WorkersCustomDomain::dtxweb-pre-prod-api-domain"; do
  pulumi state protect "$urn" --stack "$STACK"
done
'
```

- [ ] **Step 5: Adopt non-importable R2 settings**

Run targeted previews for the captured CORS resource when present and the managed `r2.dev` resource. Expected changes are state additions only; no bucket update/replacement/delete.

Apply the exact captured values. When Cloudflare rejects an idempotent singleton PUT, restore the captured response, delete only that singleton setting through the documented API, and immediately rerun the targeted Pulumi update. Never modify/delete the bucket.

- [ ] **Step 6: Require a clean pre-production stack**

```bash
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi up --refresh --yes --suppress-outputs --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
rtk curl --fail --silent --show-error https://api.pre-prod.dtx.hapadona.com/healthz >/dev/null
```

The update persists source-level protection/retention metadata. Stop on provider CRUD after adoption.

---

## Task 6: Render remote Wrangler configs and remove `pre-prod-prod-data`

**Files:**

- Create: `packages/infrastructure/src/wrangler.ts`
- Create: `packages/infrastructure/src/wrangler.test.ts`
- Create: `packages/infrastructure/scripts/render-wrangler-config.ts`
- Modify: infrastructure/API/web/root package files, both Wrangler files, API env/tests, desktop topology test, current M4A docs, and `packages/infrastructure/.gitignore`

**Interfaces:**

```typescript
export const buildApiWranglerConfig = (
	localConfig: Record<string, unknown>,
	deployment: WorkerDeploymentConfig
): Record<string, unknown>;

export const buildWebWranglerConfig = (
	localConfig: Record<string, unknown>,
	deployment: WorkerDeploymentConfig
): Record<string, unknown>;
```

- [ ] **Step 1: Write failing renderer tests**

For pre-production and production, prove generated configs:

```text
set exact Worker names
contain no env, route, or routes
set workers_dev=false and preview_urls=false
inject D1 ID/name, R2 name, KV ID, service target, and public R2 URL
preserve compatibility, aliases, vars, assets, Workflow, Container, Durable Object, and migrations
omit Pulumi-owned observability
contain no Access identity, token, secure value, or ciphertext
reject unsupported stacks, empty fields, and mismatched resource names
```

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/wrangler.test.ts
```

- [ ] **Step 2: Implement the pure renderer and atomic CLI**

The CLI accepts exactly `pre-prod` or `production`, reads:

```bash
pulumi stack output workerDeploymentConfig --json --stack cwchanap/dtxweb-infrastructure/<stack>
```

and atomically writes under:

```text
packages/infrastructure/.wrangler/generated/pre-prod/api.jsonc
packages/infrastructure/.wrangler/generated/pre-prod/web.jsonc
packages/infrastructure/.wrangler/generated/production/api.jsonc
packages/infrastructure/.wrangler/generated/production/web.jsonc
```

Ignore exactly `.wrangler/generated/` in `packages/infrastructure/.gitignore`.

- [ ] **Step 3: Make checked-in Wrangler files local-first**

Remove remote routes, observability, remote IDs, `remote: true`, environment blocks, and `pre-prod-prod-data`.

Use unmistakably local but schema-valid identifiers:

```json
"kv_namespaces": [{
  "binding": "RATE_LIMIT_API",
  "id": "00000000000000000000000000000001"
}],
"d1_databases": [{
  "binding": "DB",
  "database_name": "dtx-web",
  "database_id": "00000000-0000-4000-8000-000000000001",
  "migrations_dir": "d1-migrations"
}]
```

Keep local R2 names, binding names, web assets/service binding, API Workflow/Container/Durable Object declarations, and local-safe variables.

Change API local development to stop selecting `--env pre-prod`.

- [ ] **Step 4: Add explicit cross-platform remote scripts**

Avoid environment-variable path interpolation. Add explicit scripts such as:

```json
"migrate:generated:preprod": "wrangler d1 migrations apply DB --remote --config ../infrastructure/.wrangler/generated/pre-prod/api.jsonc",
"migrate:generated:production": "wrangler d1 migrations apply DB --remote --config ../infrastructure/.wrangler/generated/production/api.jsonc",
"deploy:generated:preprod": "wrangler deploy --config ../infrastructure/.wrangler/generated/pre-prod/api.jsonc",
"deploy:generated:production": "wrangler deploy --config ../infrastructure/.wrangler/generated/production/api.jsonc"
```

Use the correct relative path from each package. Preserve root public commands by sequencing render -> migration (API only) -> deploy. Delete every `*:preprod:prod-data` script.

- [ ] **Step 5: Remove the alias from active code/tests/docs**

Narrow:

```typescript
RATE_LIMIT_ENV: 'prod' | 'pre-prod';
```

Remove alias configuration/assertions from API/web/desktop tests and update the current M4A docs to state that the alias was retired by this migration.

Add a repository contract test requiring zero active `pre-prod-prod-data` references outside the migration spec/plan/runbook and explicit historical supersession notes.

- [ ] **Step 6: Verify, dry-run, and commit**

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=dtx-api test -- src/index.test.ts
rtk bun run --filter=dtx-api check
rtk bun run --filter=dtx-desktop test -- src/devTopology.test.ts
rtk bun run --filter=dtx-web check
rtk bun run --filter=@dtx/infrastructure render:preprod
rtk bash -c 'cd packages/dtx-api && bunx wrangler deploy --dry-run --config ../infrastructure/.wrangler/generated/pre-prod/api.jsonc --outdir dist-infra-preprod --containers-rollout=none'
rtk bash -c 'cd packages/dtx-web && bun run build && bunx wrangler deploy --dry-run --config ../infrastructure/.wrangler/generated/pre-prod/web.jsonc --outdir dist-infra-preprod'
rtk git status --short --ignored | grep -F 'packages/infrastructure/.wrangler/generated/'
rtk git add packages/infrastructure packages/dtx-api packages/dtx-web packages/dtx-desktop/src/devTopology.test.ts package.json docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md docs/superpowers/plans/2026-08-25-cloudflare-workflow-m4a-generation.md
rtk git commit -m "refactor(cloudflare): render Wrangler releases from Pulumi"
```

---

## Task 7: Deploy and verify pre-production through generated config

**Files:** none unless validation exposes a contract bug. Operator gate.

- [ ] **Step 1: Deploy API through the retained root command**

```bash
rtk bun run deploy:api:preprod
rtk curl --fail --silent --show-error https://api.pre-prod.dtx.hapadona.com/healthz | jq -e '.ok == true' >/dev/null
```

Exercise one authenticated API operation, one D1 read, one disposable-prefix R2 write/read/delete, one KV rate-limit path, and the existing BGM Workflow/Container smoke. Never use production objects.

- [ ] **Step 2: Deploy web and verify service binding/Access**

```bash
rtk bun run deploy:web:preprod
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
```

Verify a web request reaches the normal pre-production API service binding.

- [ ] **Step 3: Prove Wrangler did not reintroduce Pulumi drift**

```bash
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Fix the renderer rather than ignoring Worker/domain/subdomain/observability drift.

---

## Task 8: Generalize infrastructure automation and documentation

**Files:**

- Create: `.github/workflows/deploy-cloudflare-infrastructure.yml`
- Create: `packages/infrastructure/scripts/verify-infrastructure.sh`
- Create: `packages/infrastructure/scripts/verify-infrastructure.test.sh`
- Create: `docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md`
- Modify: workflow contract test, infrastructure package/README, `CLAUDE.md`, old Access docs
- Delete: `.github/workflows/deploy-cloudflare-access.yml`

- [ ] **Step 1: Write the failing workflow contract**

Expect the renamed workflow, existing two serial jobs/stacks/environments/OIDC subjects, `CLOUDFLARE_INFRA_API_TOKEN`, `pulumi up` with refresh, both verifiers, and no Wrangler/D1 migration/Worker deployment command.

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/deploy-workflow.test.ts
```

- [ ] **Step 2: Write the failing infrastructure-verifier shell suite**

Fake `curl` and Pulumi output. Cover valid/invalid API health, reachable R2 responses, DNS/TLS/network failure, R2 5xx, unsupported environment, and redacted output.

```bash
rtk bash packages/infrastructure/scripts/verify-infrastructure.test.sh
```

- [ ] **Step 3: Implement the workflow and verifier**

Each job performs:

```text
install -> infrastructure check/test:coverage/build
Pulumi OIDC -> pulumi up --refresh
verify-access.sh -> verify-infrastructure.sh
```

The verifier reads pre-production's generated R2 URL from `workerDeploymentConfig`; it never hard-codes `r2.dev`.

- [ ] **Step 4: Provision the broader environment tokens**

Create independent `CLOUDFLARE_INFRA_API_TOKEN` secrets in the existing two GitHub Environments. Limit permissions to the DTXWeb account/zone operations required for Access, D1, R2, KV, Worker identity/settings, and Worker custom domains. Retain the old Access token until the first generalized post-merge workflow succeeds.

- [ ] **Step 5: Update steady-state and recovery documentation**

Document ownership, import formats/logical names, D1 backup, non-importable R2 adoption, generated Wrangler commands, live smoke matrices, alias cleanup, state-only recovery, and credential rotation. Add short supersession notes to the old Access docs rather than duplicating the runbook.

- [ ] **Step 6: Verify and commit**

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure test:coverage
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk bunx prettier --check .github/workflows/deploy-cloudflare-infrastructure.yml packages/infrastructure docs/superpowers CLAUDE.md
rtk git add .github/workflows packages/infrastructure docs/superpowers CLAUDE.md
rtk git commit -m "ci(infrastructure): deploy complete Cloudflare stacks"
```

---

## Task 9: Adopt and cut over production

**Files:** none unless a zero-diff correction is required. Operator gate.

- [ ] **Step 1: Render production config and export D1 privately**

```bash
rtk bun run --filter=@dtx/infrastructure render:production
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
cd packages/dtx-api
bunx wrangler d1 export DB --remote \
  --config ../infrastructure/.wrangler/generated/production/api.jsonc \
  --output "$PRIVATE_DIR/dtx-web-production.sql"
test -s "$PRIVATE_DIR/dtx-web-production.sql"
chmod 600 "$PRIVATE_DIR/dtx-web-production.sql"
'
```

- [ ] **Step 2: Import and protect production resources**

Repeat Task 5's private env-file pattern for production IDs. Import/protect exact logical names:

```text
dtxweb-production-d1
dtxweb-production-r2
dtxweb-production-rate-limit-kv
dtxweb-production-web-worker
dtxweb-production-api-worker
dtxweb-production-web-domain
dtxweb-production-api-domain
```

Use exact production URNs rather than parsing CLI output. Require a zero-unexpected-change refresh preview before R2 singleton adoption.

- [ ] **Step 3: Adopt production CORS and custom domain**

Apply the captured CORS policy. For `chart.hapadona.com`, capture current domain/TLS/cipher/health values, detach only the bucket-domain attachment, immediately create the protected Pulumi `R2CustomDomain`, poll until ownership and SSL are active, then verify representative chart downloads and CORS. Never modify the bucket or its objects.

- [ ] **Step 4: Persist protection and require a clean stack**

```bash
rtk pulumi up --refresh --yes --suppress-outputs --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/production
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/production
```

- [ ] **Step 5: Deploy production API/web through generated config**

```bash
rtk bun run deploy:api
rtk curl --fail --silent --show-error https://api.dtx.hapadona.com/healthz | jq -e '.ok == true' >/dev/null
rtk bun run deploy:web
rtk packages/infrastructure/scripts/verify-access.sh production
rtk packages/infrastructure/scripts/verify-infrastructure.sh production
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/production
```

Exercise authenticated API/web, D1, R2, KV, service binding, BGM Workflow/Container, public chart download, and CORS paths.

---

## Task 10: Decommission the detached alias resources

**Files:** runbook only when live inventory differs from the expected disposable shape. Operator gate.

- [ ] **Step 1: Prove alias Workers are detached**

Confirm neither pre-production hostname, route, schedule, tail consumer, nor service binding references:

```text
dtx-web-pre-prod-prod-data
dtx-api-pre-prod-prod-data
```

- [ ] **Step 2: Delete only disposable alias resources**

Delete the two detached alias Worker identities and the alias-only KV namespace. Do not delete/mutate production D1/R2, normal environment Workers/KV, Workflows, or objects.

- [ ] **Step 3: Prove no active references remain**

```bash
rtk git grep -n 'pre-prod-prod-data' -- \
  ':!docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md' \
  ':!docs/superpowers/plans/2026-08-28-pulumi-cloudflare-infrastructure.md' \
  ':!docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md'
```

Expected: only explicit historical supersession notes allowed by the repository contract test; Cloudflare inventory contains only the two permanent Worker pairs and active KV namespaces.

---

## Task 11: Final verification and PR readiness

- [ ] **Step 1: Run focused repository gates**

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure test:coverage
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk bun run --filter=dtx-api test
rtk bun run --filter=dtx-api check
rtk bun run --filter=dtx-web test
rtk bun run --filter=dtx-web check
rtk bun run --filter=dtx-desktop test -- src/devTopology.test.ts
rtk bash .github/scripts/ci-affected-scope.test.sh
rtk bun run lint
rtk bunx prettier --check .
```

- [ ] **Step 2: Run generated-config gates**

Render both stacks and run API/web Wrangler dry-runs for both generated configs. Confirm generated files remain ignored and secret-free, then run `git diff --check`.

- [ ] **Step 3: Run final Pulumi/live gates**

```bash
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/production
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
rtk packages/infrastructure/scripts/verify-infrastructure.sh pre-prod
rtk packages/infrastructure/scripts/verify-access.sh production
rtk packages/infrastructure/scripts/verify-infrastructure.sh production
```

- [ ] **Step 4: Review for sensitive or destructive mistakes**

Confirm:

```text
no tokens, stack exports, D1 exports, inventory JSON, or generated Wrangler files are tracked
D1/R2 use protection plus retention
all other permanent resources are protected
exactly two permanent stack definitions exist
committed Wrangler files contain no remote IDs or routes
no active pre-prod-prod-data path remains
Pulumi CI does not deploy Worker code
runbook commands match actual scripts and GitHub Environment names
```

- [ ] **Step 5: Mark this single pull request ready**

Leave draft only after all code gates, both clean Pulumi previews, both live matrices, generated Worker releases, and alias decommission succeed. After the first generalized workflow succeeds on `main`, remove the superseded Access-only token from both existing GitHub Environments.
