# Pulumi-Managed Cloudflare Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before claiming the pull request is ready.

**Goal:** Expand the two existing DTXWeb Pulumi Cloud stacks from Access-only ownership to all permanent DTXWeb-owned Cloudflare infrastructure, while keeping Wrangler as the Worker code/release engine and preserving every live stateful resource.

**Architecture:** Pulumi imports and protects D1, R2, KV, Worker identity/settings, Worker custom domains, Access, and bucket-level public settings. A small tested renderer reads one secret-free Pulumi output and creates ignored remote Wrangler configurations containing version-coupled bindings and variables. Local Wrangler configuration stays Pulumi-independent. The draft pull request remains open while pre-production and production resources are adopted into the existing stacks.

**Tech Stack:** Bun 1.3.9, TypeScript 5.8, Vitest 3, Bash, Pulumi Cloud, `@pulumi/pulumi` 3.258.0, locked `@pulumi/cloudflare` 6.19.0, Wrangler 4.123.0, GitHub Actions OIDC, Cloudflare Workers/D1/R2/KV/Access.

**Validated against:** `DTXWeb main@6de9cb1aa32245f7ab7b37c8a53fc4755a3a332c` and official Cloudflare/Pulumi documentation current on 2026-08-28.

**Spec:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md`

## Global constraints

- Implement the entire ticket in one isolated branch/worktree and one pull request. Do not split infrastructure declarations, imports, Wrangler rendering, or cleanup across dependent PRs.
- Keep the pull request draft until both Pulumi stacks are adopted and the live validation gates pass.
- Never implement or run this work directly on `main`.
- Use TDD: observe a focused RED, implement the minimum, then observe focused GREEN before broader checks.
- Preserve the two Pulumi Cloud stack identities exactly:
  - `cwchanap/dtxweb-infrastructure/pre-prod`
  - `cwchanap/dtxweb-infrastructure/production`
- Preserve the existing Access application logical names, destinations, policy, posture rule, and `12h` session default.
- Pre-production is always imported, updated, deployed, and verified before production.
- Any preview containing a D1/R2/Worker/custom-domain replacement or delete is a hard stop.
- Every permanent resource uses `protect: true`. D1 and R2 additionally use `retainOnDelete: true`.
- Do not hand-edit Pulumi state. A mistaken import is removed with `pulumi state delete` only after confirming the live resource will not be deleted.
- Do not print or commit Cloudflare tokens, Access email, posture-rule IDs, Pulumi ciphertext, stack exports, D1 exports, or private Cloudflare API responses.
- Do not export secrets through Pulumi outputs or generated Wrangler files.
- Keep Worker code/assets, D1 schema migrations, version bindings/variables, Workflow/Container/Durable Object declarations, and Worker releases in Wrangler.
- Do not add Pulumi Worker versions/deployments, a dynamic provider, a component framework, a YAML parser, a second CI orchestrator, preview stacks, or automatic Worker application deployment.
- Use the already locked `@pulumi/cloudflare` 6.19.0 provider. Do not upgrade dependencies unless a reproduced provider defect blocks an item in this plan.
- Reuse GitHub Environments `dtx-access-pre-prod` and `dtx-access-production` so Pulumi Cloud OIDC subjects remain unchanged.
- Replace the environment secret with `CLOUDFLARE_INFRA_API_TOKEN`; expose it only as `CLOUDFLARE_API_TOKEN` during provider/API operations.
- `pre-prod-prod-data` is removed without a compatibility path. Its production D1/R2 targets are never deleted.
- No automatic `pulumi destroy`, automatic rollback, or destructive fallback is permitted.
- Do not run the monorepo-wide build. Run the focused package checks listed in each task plus the final repository lint/format gates.
- All external Cloudflare/Pulumi mutations require the operator gate described in the relevant task. Code-only agents stop before those commands and report the exact next command.

## Final file map

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
- `docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md`
- `docs/superpowers/plans/2026-08-25-cloudflare-workflow-m4a-generation.md`
- `docs/superpowers/specs/2026-08-20-cloudflare-access-automation-design.md`
- `docs/superpowers/plans/2026-08-20-cloudflare-access-automation.md`
- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

### Delete

- `.github/workflows/deploy-cloudflare-access.yml`

### Intentionally unchanged

- D1 migration SQL and application schema
- Worker source code and GraphQL schema
- authored/generated R2 objects
- Access application behavior
- BGM Workflow/Container implementation
- Pulumi Cloud organization/project/stack names
- GitHub Environment names and Pulumi OIDC subjects

---

## Task 1: Capture the live contract and add the closed stack definition

**Files:** create `config.ts/test.ts`; modify both Pulumi stack files.

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

### Step 1.1: Read-only live inventory

Create a private temporary directory outside the repository:

```bash
rtk bash -c 'set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set a read-capable Cloudflare token}"
PRIVATE_DIR="$(mktemp -d)"
chmod 700 "$PRIVATE_DIR"
printf "%s" "$PRIVATE_DIR" > /tmp/dtxweb-cloudflare-inventory-dir
'
```

Read the account/zone IDs from existing stack/runtime configuration without printing them, then capture the current Worker domains and R2 settings:

```bash
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
ACCOUNT_ID="$(cd packages/infrastructure && pulumi config get cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/pre-prod)"
ZONE_ID="${CLOUDFLARE_ZONE_ID:?set the existing hapadona.com zone ID}"

curl --fail-with-body --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  > "$PRIVATE_DIR/worker-domains.json"

for bucket in simfile-dtx-preprod simfile-dtx; do
  curl --fail-with-body --silent --show-error \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/$bucket/cors" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    > "$PRIVATE_DIR/$bucket-cors.json"
  curl --fail-with-body --silent --show-error \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/$bucket/domains/managed" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    > "$PRIVATE_DIR/$bucket-managed-domain.json"
  curl --fail-with-body --silent --show-error \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/$bucket/domains/custom" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    > "$PRIVATE_DIR/$bucket-custom-domains.json"
done

jq -e --arg zone "$ZONE_ID" ".result | map(select(.zone_id == \$zone)) | length >= 4" \
  "$PRIVATE_DIR/worker-domains.json" >/dev/null
'
```

Also capture the exact active KV namespace titles from Cloudflare/`wrangler kv namespace list`; do not infer titles from binding names. Confirm the live matrix is exactly:

```text
pre-prod:   dtx-web-pre-prod, dtx-api-pre-prod, dtx-web-preprod, simfile-dtx-preprod
production: dtx-web,          dtx-api,          dtx-web,         simfile-dtx
```

Stop on duplicate Worker domains, wrong service targets, unknown public R2 domains, or mismatched account/zone IDs.

### Step 1.2: Write RED stack-definition tests

`config.test.ts` must pin both complete definitions and reject all other strings, including `pre-prod-prod-data`:

```typescript
import { describe, expect, it } from 'vitest';
import { getInfrastructureDefinition } from './config.js';

describe('getInfrastructureDefinition', () => {
	it('defines permanent pre-production infrastructure', () => {
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

	it('defines permanent production infrastructure', () => {
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
		expect(() => getInfrastructureDefinition(stack)).toThrow(/Unsupported DTXWeb infrastructure stack/);
	});
});
```

Run and observe RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/config.test.ts
```

Expected: failure because `config.ts` does not exist.

### Step 1.3: Implement the closed table

Implement `config.ts` with one `Record<StackName, InfrastructureDefinition>` and a narrow runtime guard. Do not make hostnames or resource names arbitrary Pulumi config.

### Step 1.4: Add non-secret stack config

Set the exact zone ID and live KV title in each remote stack, then commit the resulting settings files:

```bash
rtk bash -c 'set -euo pipefail
: "${CLOUDFLARE_ZONE_ID:?}"
: "${PREPROD_RATE_LIMIT_KV_TITLE:?}"
: "${PRODUCTION_RATE_LIMIT_KV_TITLE:?}"
cd packages/infrastructure
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi config set rateLimitKvTitle "$PREPROD_RATE_LIMIT_KV_TITLE" --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/production
pulumi config set rateLimitKvTitle "$PRODUCTION_RATE_LIMIT_KV_TITLE" --stack cwchanap/dtxweb-infrastructure/production
'
```

Verify both files retain `secretsprovider: default`, encrypted `accessEmail`, and no `encryptionsalt` or plaintext email.

### Step 1.5: GREEN and commit

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/config.test.ts
rtk bun run --filter=@dtx/infrastructure check
rtk bunx prettier --check packages/infrastructure/src/config.ts packages/infrastructure/src/config.test.ts packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml
rtk git add packages/infrastructure/src/config.ts packages/infrastructure/src/config.test.ts packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml
rtk git commit -m "feat(infrastructure): define permanent Cloudflare stacks"
```

Expected: all commands exit 0.

---

## Task 2: Declare protected D1, R2, and KV resources

**Files:** create `data.ts/test.ts`; modify `index.ts/index.test.ts` later in Task 4 only.

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

export const buildD1DatabaseArgs(args: DataResourceArgs): cloudflare.D1DatabaseArgs;
export const buildR2BucketArgs(args: DataResourceArgs): cloudflare.R2BucketArgs;
export const buildRateLimitKvArgs(args: DataResourceArgs): cloudflare.WorkersKvNamespaceArgs;
export const createDataResources(args: DataResourceArgs): DataResources;
```

### Step 2.1: RED argument and constructor-option tests

Use hoisted Vitest constructor spies, preserving the real provider's types/other exports. Cover both stacks and assert:

```typescript
expect(buildD1DatabaseArgs(preProdArgs)).toMatchObject({
	accountId: 'account-id',
	name: 'dtx-web-preprod'
});
expect(buildR2BucketArgs(preProdArgs)).toMatchObject({
	accountId: 'account-id',
	name: 'simfile-dtx-preprod'
});
expect(buildRateLimitKvArgs(preProdArgs)).toEqual({
	accountId: 'account-id',
	title: 'pre-prod-rate-limit-title'
});
```

Constructor expectations:

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
	expect.objectContaining({ title: 'pre-prod-rate-limit-title' }),
	{ protect: true }
);
```

Run RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/data.test.ts
```

### Step 2.2: Implement minimal resource builders

Do not set D1 jurisdiction/location/read replication or R2 location/storage class until the read-only inventory proves the live values. For imported resources, include only live non-default settings required to produce a zero-diff refresh.

Use constants:

```typescript
export const STATEFUL_RESOURCE_OPTIONS = { protect: true, retainOnDelete: true } as const;
export const PERSISTENT_RESOURCE_OPTIONS = { protect: true } as const;
```

### Step 2.3: GREEN and commit

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/data.test.ts
rtk bun run --filter=@dtx/infrastructure check
rtk bunx prettier --check packages/infrastructure/src/data.ts packages/infrastructure/src/data.test.ts
rtk git add packages/infrastructure/src/data.ts packages/infrastructure/src/data.test.ts
rtk git commit -m "feat(infrastructure): declare Cloudflare data resources"
```

---

## Task 3: Declare Worker identities, custom domains, and R2 public settings

**Files:** create `workers.ts/test.ts`, `r2-public.ts/test.ts`.

### Step 3.1: RED Worker tests

Interfaces:

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
```

Pin the exact names and the route/subdomain contract:

```typescript
expect(buildWorkerArgs('web', args)).toMatchObject({
	accountId: 'account-id',
	name: 'dtx-web-pre-prod',
	observability: expect.objectContaining({ enabled: true }),
	subdomain: { enabled: false, previewsEnabled: false }
});
expect(buildCustomDomainArgs('api', args)).toEqual({
	accountId: 'account-id',
	hostname: 'api.pre-prod.dtx.hapadona.com',
	service: 'dtx-api-pre-prod',
	zoneId: 'zone-id'
});
```

Assert all four constructors use `{ protect: true }` and logical names:

```text
dtxweb-<stack>-web-worker
dtxweb-<stack>-api-worker
dtxweb-<stack>-web-domain
dtxweb-<stack>-api-domain
```

Do not set the deprecated custom-domain `environment` field.

Run RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/workers.test.ts
```

### Step 3.2: Implement Worker infrastructure

Mirror current live observability settings from the inventory/provider refresh. Do not invent log destinations, sampling, tags, tail consumers, or logpush settings.

Use `cloudflare.WorkersCustomDomain`, not deprecated `WorkerDomain`.

### Step 3.3: RED R2 public-setting tests

Define:

```typescript
export interface R2PublicSettingsArgs {
	accountId: pulumi.Input<string>;
	zoneId: pulumi.Input<string>;
	definition: InfrastructureDefinition;
	corsRules: cloudflare.types.input.R2BucketCorsRule[];
}

export interface R2PublicSettings {
	cors: cloudflare.R2BucketCors;
	publicDomain: cloudflare.R2ManagedDomain | cloudflare.R2CustomDomain;
	publicBaseUrl: pulumi.Output<string>;
}
```

Convert the private inventory's current CORS responses into exact constants in `r2-public.ts`. Tests must pin each origin, method, allowed/exposed header, rule ID, max age, production TLS minimum, and cipher list. Do not commit the inventory response or account IDs.

Pre-production expectation:

```typescript
expect(r2ManagedDomainMock).toHaveBeenCalledWith(
	'dtxweb-pre-prod-r2-managed-domain',
	{ accountId: 'account-id', bucketName: 'simfile-dtx-preprod', enabled: true },
	{ protect: true }
);
```

Production expectation:

```typescript
expect(r2CustomDomainMock).toHaveBeenCalledWith(
	'dtxweb-production-r2-custom-domain',
	expect.objectContaining({
		accountId: 'account-id',
		bucketName: 'simfile-dtx',
		domain: 'chart.hapadona.com',
		enabled: true,
		zoneId: 'zone-id'
	}),
	{ protect: true }
);
```

Every stack creates one protected CORS resource. When the live GET reports no policy, codify `rules: []` and test that empty policy explicitly rather than omitting ownership.

Run RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/r2-public.test.ts
```

### Step 3.4: Implement and verify

For the managed domain, derive `publicBaseUrl` from the provider's domain output. For production, return `pulumi.output('https://chart.hapadona.com')`.

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/workers.test.ts src/r2-public.test.ts
rtk bun run --filter=@dtx/infrastructure check
rtk bunx prettier --check packages/infrastructure/src/workers.ts packages/infrastructure/src/workers.test.ts packages/infrastructure/src/r2-public.ts packages/infrastructure/src/r2-public.test.ts
rtk git add packages/infrastructure/src/workers.ts packages/infrastructure/src/workers.test.ts packages/infrastructure/src/r2-public.ts packages/infrastructure/src/r2-public.test.ts
rtk git commit -m "feat(infrastructure): declare Worker and R2 public resources"
```

---

## Task 4: Compose the complete stack and export the deployment contract

**Files:** modify `index.ts/index.test.ts`.

### Step 4.1: RED runtime-mock matrix

Replace the current one-resource assertion with table-driven pre-production and production runtime-mock cases. Configure:

```typescript
pulumi.runtime.setAllConfig(
	{
		'dtxweb-infrastructure:cloudflareAccountId': 'account-id',
		'dtxweb-infrastructure:cloudflareZoneId': 'zone-id',
		'dtxweb-infrastructure:rateLimitKvTitle': 'rate-limit-title',
		'dtxweb-infrastructure:accessEmail': 'operator@example.com',
		'dtxweb-infrastructure:devicePostureRuleId': 'posture-rule-id'
	},
	['dtxweb-infrastructure:accessEmail']
);
```

For each stack, assert exactly ten Cloudflare resources:

```text
1 ZeroTrustAccessApplication
1 D1Database
1 R2Bucket
1 WorkersKvNamespace
2 Worker
2 WorkersCustomDomain
1 R2BucketCors
1 R2ManagedDomain or R2CustomDomain
```

Assert exact logical names and provider types; do not duplicate field-level tests owned by the resource modules.

Resolve and assert `workerDeploymentConfig`:

```typescript
expect(await resolveOutput(workerDeploymentConfig)).toEqual({
	stack: 'pre-prod',
	web: {
		workerName: 'dtx-web-pre-prod',
		hostname: 'pre-prod.dtx.hapadona.com',
		apiServiceName: 'dtx-api-pre-prod'
	},
	api: {
		workerName: 'dtx-api-pre-prod',
		hostname: 'api.pre-prod.dtx.hapadona.com',
		databaseId: 'dtxweb-pre-prod-d1-id',
		databaseName: 'dtx-web-preprod',
		bucketName: 'simfile-dtx-preprod',
		rateLimitKvNamespaceId: 'dtxweb-pre-prod-rate-limit-kv-id',
		publicSimfileBucketUrl: expect.stringMatching(/^https:\/\//)
	}
});
```

Also prove the serialized output contains no Access email, posture ID, `secure`, token, secret, ciphertext, or Access application ID.

Run RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/index.test.ts
```

### Step 4.2: Compose resources

`index.ts` loads all required config, creates the Access/data/Worker/R2-public modules, and exports only `workerDeploymentConfig`. Keep `accessApplicationId` temporarily only when an existing consumer is found; otherwise remove it and update tests/documentation in this task.

Use `pulumi.all` to construct the output; no JSON string output and no secret application.

### Step 4.3: Package gate and commit

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure test:coverage
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk test -f packages/infrastructure/dist/index.js
rtk git add packages/infrastructure/src/index.ts packages/infrastructure/src/index.test.ts
rtk git commit -m "feat(infrastructure): compose Cloudflare stack outputs"
```

At this point do **not** run `pulumi up`; the live resources are not yet imported.

---

## Task 5: Adopt the complete pre-production stack

**Files:** no source changes unless a zero-diff correction is required. This is an operator gate executed from the draft PR branch.

### Step 5.1: Back up pre-production D1

The old Wrangler config still contains the remote pre-production binding at this point:

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

### Step 5.2: Resolve live import IDs without printing

```bash
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
export CF_ACCOUNT_ID="$(cd packages/infrastructure && pulumi config get cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/pre-prod)"
export PREPROD_D1_ID="$(jq -er ".env[\"pre-prod\"].d1_databases[0].database_id" packages/dtx-api/wrangler.jsonc)"
export PREPROD_KV_ID="$(jq -er ".env[\"pre-prod\"].kv_namespaces[0].id" packages/dtx-api/wrangler.jsonc)"
export PREPROD_WEB_DOMAIN_ID="$(jq -er ".result[] | select(.hostname == \"pre-prod.dtx.hapadona.com\" and .service == \"dtx-web-pre-prod\") | .id" "$PRIVATE_DIR/worker-domains.json")"
export PREPROD_API_DOMAIN_ID="$(jq -er ".result[] | select(.hostname == \"api.pre-prod.dtx.hapadona.com\" and .service == \"dtx-api-pre-prod\") | .id" "$PRIVATE_DIR/worker-domains.json")"
for value in CF_ACCOUNT_ID PREPROD_D1_ID PREPROD_KV_ID PREPROD_WEB_DOMAIN_ID PREPROD_API_DOMAIN_ID; do
  test -n "${!value}"
done
'
```

Keep these variables in the same secure operator shell used for imports.

### Step 5.3: Import supported resources

From `packages/infrastructure`:

```bash
rtk pulumi import cloudflare:index/d1Database:D1Database \
  dtxweb-pre-prod-d1 "$CF_ACCOUNT_ID/$PREPROD_D1_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
rtk pulumi import cloudflare:index/r2Bucket:R2Bucket \
  dtxweb-pre-prod-r2 "$CF_ACCOUNT_ID/simfile-dtx-preprod/default" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
rtk pulumi import cloudflare:index/workersKvNamespace:WorkersKvNamespace \
  dtxweb-pre-prod-rate-limit-kv "$CF_ACCOUNT_ID/$PREPROD_KV_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
rtk pulumi import cloudflare:index/worker:Worker \
  dtxweb-pre-prod-web-worker "$CF_ACCOUNT_ID/dtx-web-pre-prod" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
rtk pulumi import cloudflare:index/worker:Worker \
  dtxweb-pre-prod-api-worker "$CF_ACCOUNT_ID/dtx-api-pre-prod" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
rtk pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain \
  dtxweb-pre-prod-web-domain "$CF_ACCOUNT_ID/$PREPROD_WEB_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
rtk pulumi import cloudflare:index/workersCustomDomain:WorkersCustomDomain \
  dtxweb-pre-prod-api-domain "$CF_ACCOUNT_ID/$PREPROD_API_DOMAIN_ID" \
  --stack cwchanap/dtxweb-infrastructure/pre-prod --yes
```

After each import, verify name/hostname/service through `pulumi stack --show-urns`; never print full state.

### Step 5.4: Protect imported URNs immediately

```bash
rtk bash -c 'set -euo pipefail
STACK="cwchanap/dtxweb-infrastructure/pre-prod"
for logical_name in \
  dtxweb-pre-prod-d1 \
  dtxweb-pre-prod-r2 \
  dtxweb-pre-prod-rate-limit-kv \
  dtxweb-pre-prod-web-worker \
  dtxweb-pre-prod-api-worker \
  dtxweb-pre-prod-web-domain \
  dtxweb-pre-prod-api-domain; do
  urn="$(pulumi stack --stack "$STACK" --show-urns | awk -v name="$logical_name" '$0 ~ name {print $NF; exit}')"
  test -n "$urn"
  pulumi state protect "$urn" --stack "$STACK"
done
'
```

### Step 5.5: Adopt CORS and `r2.dev`

Use the exact captured pre-production CORS and managed-domain values. First run targeted preview:

```bash
rtk pulumi preview --refresh \
  --stack cwchanap/dtxweb-infrastructure/pre-prod \
  --target 'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/r2BucketCors:R2BucketCors::dtxweb-pre-prod-r2-cors' \
  --target 'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/r2ManagedDomain:R2ManagedDomain::dtxweb-pre-prod-r2-managed-domain'
```

Expected: only the two state additions; no bucket update/replacement/delete.

Apply the two targets:

```bash
rtk pulumi up --refresh --yes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod \
  --target 'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/r2BucketCors:R2BucketCors::dtxweb-pre-prod-r2-cors' \
  --target 'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/r2ManagedDomain:R2ManagedDomain::dtxweb-pre-prod-r2-managed-domain'
```

If either API rejects the idempotent PUT, stop. Restore from the private captured JSON, delete only that singleton CORS/managed-domain setting via the documented Cloudflare API, and immediately rerun the same targeted update. Do not modify/delete the bucket.

### Step 5.6: Require a clean stack

```bash
rtk pulumi preview --refresh --expect-no-changes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi up --refresh --yes --suppress-outputs \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi preview --refresh --expect-no-changes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
```

The middle update persists source-level protection/retention metadata. Expected: no provider CRUD.

Run the existing boundary check and API/R2 probes:

```bash
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
rtk curl --fail --silent --show-error https://api.pre-prod.dtx.hapadona.com/healthz >/dev/null
```

Do not continue if pre-production differs from the spec.

---

## Task 6: Render remote Wrangler configs and retire `pre-prod-prod-data`

**Files:** create `wrangler.ts/test.ts`, renderer script; modify API/web/root package configs, `env.ts`, tests, infrastructure `.gitignore`.

### Step 6.1: RED pure-renderer tests

Define narrow input types rather than accepting arbitrary provider objects:

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

export const buildApiWranglerConfig = (
	localConfig: Record<string, unknown>,
	deployment: WorkerDeploymentConfig
): Record<string, unknown>;

export const buildWebWranglerConfig = (
	localConfig: Record<string, unknown>,
	deployment: WorkerDeploymentConfig
): Record<string, unknown>;
```

Fixture tests must prove generated pre-production and production configs:

- set exact Worker names;
- contain no `env` block;
- contain no `route`/`routes`;
- set `workers_dev: false` and `preview_urls: false`;
- inject D1 ID/name, R2 name, KV ID, service target, and public R2 URL;
- preserve compatibility settings, API aliases, vars, Workflow, Container, Durable Object, migration, web assets, and `keep_vars`;
- preserve `BGM_M4A_GENERATION_ENABLED: 'true'` remotely;
- never contain Access email, posture ID, API token, `secure`, or stack ciphertext;
- reject unsupported stacks, empty IDs/names/URLs, unknown top-level configuration keys that would be silently discarded, and mismatched production/pre-production Worker names.

Run RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/wrangler.test.ts
```

### Step 6.2: Implement the pure renderer

Use object cloning and explicit allowlists. Do not add `jsonc-parser`; both committed files are strict JSON despite the `.jsonc` extension.

Remote API config keeps:

```text
main, alias, compatibility_date, compatibility_flags, vars, keep_vars,
observability omitted, workflows, containers, durable_objects, migrations
```

Remote web config keeps:

```text
main, compatibility_date, compatibility_flags, assets, vars, keep_vars
```

Pulumi owns observability and both custom domains, so renderer output omits those fields.

### Step 6.3: Add the CLI renderer

`render-wrangler-config.ts` accepts exactly one stack argument (`pre-prod` or `production`), runs:

```text
pulumi stack output workerDeploymentConfig --json --stack cwchanap/dtxweb-infrastructure/<stack>
```

It validates the output, reads both local configs, and atomically writes:

```text
.wrangler/generated/<stack>/api.jsonc
.wrangler/generated/<stack>/web.jsonc
```

Write temp files in the destination directory and rename only after both configs serialize. On any failure, remove temp files and leave previous generated files unchanged.

Add package scripts:

```json
"render:preprod": "bun scripts/render-wrangler-config.ts pre-prod",
"render:production": "bun scripts/render-wrangler-config.ts production"
```

Ignore exactly `.wrangler/generated/` from `packages/infrastructure/.gitignore` or the root ignore location used by the script.

### Step 6.4: Convert committed Wrangler configs to local-first

`packages/dtx-api/wrangler.jsonc` keeps local resource names and binding names but removes:

```text
route
d1_databases[*].database_id
kv_namespaces[*].id
remote: true
observability
env.pre-prod
env.pre-prod-prod-data
```

Top-level local bindings remain:

```json
"r2_buckets": [{ "binding": "DTXFILE_BUCKET", "bucket_name": "simfile-dtx" }],
"kv_namespaces": [{ "binding": "RATE_LIMIT_API", "id": "local-rate-limit-api" }],
"d1_databases": [{
  "binding": "DB",
  "database_name": "dtx-web",
  "database_id": "local-dtx-web",
  "migrations_dir": "d1-migrations"
}]
```

Use deterministic local-only IDs accepted by Wrangler/Miniflare; never reuse a remote ID.

`packages/dtx-web/wrangler.jsonc` removes remote routes/environments/observability and keeps local assets/service-binding shape.

Update API local development to stop selecting `--env pre-prod`:

```json
"dev:local": "wrangler dev --env-file ../../.env --var AUTH_COOKIE_DOMAIN: --port 8787 --var BGM_M4A_GENERATION_ENABLED:false"
```

Web E2E remains on the same top-level local D1/R2 names.

### Step 6.5: Replace remote scripts with generated-config scripts

API package:

```json
"migrate:generated": "wrangler d1 migrations apply DB --remote --config ../../.wrangler/generated/$DTX_INFRA_STACK/api.jsonc",
"deploy:generated": "wrangler deploy --config ../../.wrangler/generated/$DTX_INFRA_STACK/api.jsonc"
```

Use small Bun wrapper scripts instead of shell-only `$DTX_INFRA_STACK` interpolation when cross-platform execution requires it. Root scripts remain the public interface and sequence render -> migrate -> deploy:

```text
bun run deploy:api
bun run deploy:api:preprod
bun run deploy:web
bun run deploy:web:preprod
```

Delete every `*:preprod:prod-data` deploy/migrate script.

### Step 6.6: Remove the alias from code/tests/docs

Change `RATE_LIMIT_ENV` to:

```typescript
RATE_LIMIT_ENV: 'prod' | 'pre-prod';
```

Remove active alias assertions from:

- `packages/dtx-api/src/index.test.ts`;
- `packages/dtx-desktop/src/devTopology.test.ts`;
- current M4A design/plan.

Historical docs should say the alias was retired by this infrastructure migration; do not rewrite unrelated M4A decisions.

Add a repository contract test (in `wrangler.test.ts` or a dedicated test) that searches active code/config/package files and requires zero `pre-prod-prod-data` occurrences. Exclude the migration design/plan and historical explanation by an explicit allowlist, not a broad docs exclusion.

### Step 6.7: GREEN, dry-run, and commit

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=dtx-api test -- src/index.test.ts
rtk bun run --filter=dtx-api check
rtk bun run --filter=dtx-desktop test -- src/devTopology.test.ts
rtk bun run --filter=dtx-web check
rtk bun run --filter=@dtx/infrastructure render:preprod
rtk bash -c 'cd packages/dtx-api && bunx wrangler deploy --dry-run --config ../../.wrangler/generated/pre-prod/api.jsonc --outdir dist-infra-preprod --containers-rollout=none'
rtk bash -c 'cd packages/dtx-web && bun run build && bunx wrangler deploy --dry-run --config ../../.wrangler/generated/pre-prod/web.jsonc --outdir dist-infra-preprod'
rtk git status --short --ignored | grep -F '.wrangler/generated/'
```

Expected: tests/checks/dry-runs pass; generated files are ignored; no remote ID remains in committed Wrangler files.

Commit:

```bash
rtk git add packages/infrastructure/src/wrangler.ts packages/infrastructure/src/wrangler.test.ts packages/infrastructure/scripts/render-wrangler-config.ts packages/infrastructure/package.json packages/infrastructure/.gitignore packages/dtx-api/wrangler.jsonc packages/dtx-api/package.json packages/dtx-api/src/env.ts packages/dtx-api/src/index.test.ts packages/dtx-web/wrangler.jsonc packages/dtx-web/package.json packages/dtx-desktop/src/devTopology.test.ts package.json docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md docs/superpowers/plans/2026-08-25-cloudflare-workflow-m4a-generation.md
rtk git commit -m "refactor(cloudflare): render Wrangler releases from Pulumi"
```

---

## Task 7: Deploy and verify pre-production through generated config

**Files:** no source changes unless validation finds a contract bug. Operator gate.

### Step 7.1: Apply D1 migrations and API release

Run the retained root command:

```bash
rtk bun run deploy:api:preprod
```

Expected sequence:

```text
render pre-prod output
apply migrations to DB from generated API config
deploy dtx-api-pre-prod
no Worker-domain mutation
no Container destructive rollout outside Wrangler's declared release
```

Verify:

```bash
rtk curl --fail --silent --show-error https://api.pre-prod.dtx.hapadona.com/healthz | jq -e '.ok == true' >/dev/null
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
```

Run one authenticated API smoke, one D1 read, one R2 read/write/delete under a disposable prefix, one KV rate-limit flow, and the existing BGM transcoder smoke/backfill check. Never use production objects.

### Step 7.2: Deploy the web Worker

```bash
rtk bun run deploy:web:preprod
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
```

Verify the web-to-API service binding through an authenticated page/API operation. Confirm `pre-prod.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` still map to the normal pre-production Workers.

### Step 7.3: Re-run clean preview

```bash
rtk pulumi preview --refresh --expect-no-changes \
  --cwd packages/infrastructure \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
```

A Wrangler release must not introduce Pulumi drift in Worker observability, subdomain, or custom domains. Fix the renderer if it does; do not ignore provider fields.

---

## Task 8: Generalize infrastructure automation and documentation

**Files:** create new workflow and verification scripts/runbook; delete old workflow; modify workflow test, README, Access docs, `CLAUDE.md`.

### Step 8.1: RED workflow contract

Update `deploy-workflow.test.ts` to expect:

```text
.github/workflows/deploy-cloudflare-infrastructure.yml
name: Deploy Cloudflare Infrastructure
existing two serial jobs and stacks
existing dtx-access-* GitHub Environments
CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_INFRA_API_TOKEN }}
verify-access.sh plus verify-infrastructure.sh
no deploy:api/deploy:web/wrangler deploy/D1 migration command
```

Keep the existing SHA-pinned checkout/Bun/Pulumi actions, OIDC token shape, `refresh: true`, suppressed outputs, main guards, and non-cancelling concurrency.

Run RED:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/deploy-workflow.test.ts
```

### Step 8.2: RED infrastructure verifier tests

`verify-infrastructure.test.sh` uses a fake `curl` and covers:

```text
pre-prod API healthz 200 with {"ok":true}
production API healthz 200 with {"ok":true}
R2 endpoint accepts 200/403/404 as reachable
R2 DNS/TLS/network failure rejects
R2 5xx rejects
wrong health body/status rejects
unsupported environment rejects before curl
secrets/response headers are never printed
```

The live script maps:

```text
pre-prod   -> api.pre-prod.dtx.hapadona.com + Pulumi publicSimfileBucketUrl
production -> api.dtx.hapadona.com          + https://chart.hapadona.com
```

It obtains the pre-production R2 URL from `pulumi stack output workerDeploymentConfig --json`; it never hard-codes the generated `r2.dev` hostname.

Run RED:

```bash
rtk bash packages/infrastructure/scripts/verify-infrastructure.test.sh
```

### Step 8.3: Implement the workflow and verifier

Rename/delete-create the workflow path. Extend triggers to include the new workflow and all infrastructure package paths. Keep documentation-only changes from automatically applying live stacks.

Each job runs:

```text
install -> infrastructure check/test:coverage/build
Pulumi OIDC -> pulumi up --refresh
verify-access.sh -> verify-infrastructure.sh
```

No Worker release occurs.

Wire shell tests into both `test` and `test:coverage` after Vitest.

### Step 8.4: Credential cutover

Before merge, create `CLOUDFLARE_INFRA_API_TOKEN` independently in both existing GitHub Environments. Scope each token only to the DTXWeb account/zone and these provider categories:

```text
Access Apps and Policies read/write
D1 read/write
Workers R2 Storage read/write
Workers KV Storage read/write
Workers Scripts read/write (and Tail read only when required by Worker reads)
zone read required by custom-domain reconciliation
```

Keep `CLOUDFLARE_ACCESS_API_TOKEN` until the first generalized workflow run on `main` succeeds; remove it afterward.

Do not change the GitHub Environment names or Pulumi Cloud OIDC trust subjects.

### Step 8.5: Update docs/runbook

`packages/infrastructure/README.md` becomes the steady-state ownership and deployment reference.

The new runbook includes:

- live inventory commands;
- D1 backup requirements;
- supported imports and exact logical names;
- non-importable R2 adoption;
- generated Wrangler commands;
- pre-production and production smoke matrices;
- alias decommission;
- recovery/state removal;
- credential rotation.

Update the old Access design/plan/runbook with a short supersession note. Do not duplicate the full new runbook.

Update `CLAUDE.md` so deployment commands state that they render Pulumi outputs and that local development does not require Pulumi login.

### Step 8.6: GREEN and commit

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure test:coverage
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk bunx prettier --check .github/workflows/deploy-cloudflare-infrastructure.yml packages/infrastructure docs/superpowers CLAUDE.md
rtk git add .github/workflows/deploy-cloudflare-infrastructure.yml .github/workflows/deploy-cloudflare-access.yml packages/infrastructure/src/deploy-workflow.test.ts packages/infrastructure/scripts/verify-infrastructure.sh packages/infrastructure/scripts/verify-infrastructure.test.sh packages/infrastructure/package.json packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md docs/superpowers/specs/2026-08-20-cloudflare-access-automation-design.md docs/superpowers/plans/2026-08-20-cloudflare-access-automation.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md CLAUDE.md
rtk git commit -m "ci(infrastructure): deploy complete Cloudflare stacks"
```

---

## Task 9: Adopt and cut over production

**Files:** no source changes unless a zero-diff correction is required. Operator gate.

### Step 9.1: Back up production D1

Before removing remote IDs from the old config, or by using the generated production config after Task 6:

```bash
rtk bash -c 'set -euo pipefail
PRIVATE_DIR="$(cat /tmp/dtxweb-cloudflare-inventory-dir)"
bun run --filter=@dtx/infrastructure render:production
cd packages/dtx-api
bunx wrangler d1 export DB --remote \
  --config ../../.wrangler/generated/production/api.jsonc \
  --output "$PRIVATE_DIR/dtx-web-production.sql"
test -s "$PRIVATE_DIR/dtx-web-production.sql"
chmod 600 "$PRIVATE_DIR/dtx-web-production.sql"
'
```

### Step 9.2: Import production D1/R2/KV/Workers/domains

Resolve production IDs from the private inventory and the pre-change config/Cloudflare API without printing. Import logical names:

```text
dtxweb-production-d1
dtxweb-production-r2
dtxweb-production-rate-limit-kv
dtxweb-production-web-worker
dtxweb-production-api-worker
dtxweb-production-web-domain
dtxweb-production-api-domain
```

Use the same provider import formats and immediate `pulumi state protect` sequence as Task 5, targeting `cwchanap/dtxweb-infrastructure/production`.

Require:

```bash
rtk pulumi preview --refresh --expect-no-changes \
  --cwd packages/infrastructure \
  --stack cwchanap/dtxweb-infrastructure/production
```

before adopting non-importable R2 settings.

### Step 9.3: Adopt production CORS

Run targeted preview/update for:

```text
urn:pulumi:production::dtxweb-infrastructure::cloudflare:index/r2BucketCors:R2BucketCors::dtxweb-production-r2-cors
```

Use the exact captured live rules. If idempotent PUT fails, restore from backup, delete only the CORS singleton, and immediately reapply through Pulumi. Purge `chart.hapadona.com` cache after the policy is re-established so cached objects expose the expected headers.

### Step 9.4: Controlled `chart.hapadona.com` adoption

Confirm the private inventory reports the domain active on `simfile-dtx`, with the exact zone/TLS/cipher values committed in `r2-public.ts`.

Remove only the R2 custom-domain attachment:

```bash
rtk bash -c 'set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
ACCOUNT_ID="$(cd packages/infrastructure && pulumi config get cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/production)"
curl --fail-with-body --silent --show-error -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/simfile-dtx/domains/custom/chart.hapadona.com" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" >/dev/null
'
```

Immediately attach it through Pulumi:

```bash
rtk pulumi up --refresh --yes \
  --cwd packages/infrastructure \
  --stack cwchanap/dtxweb-infrastructure/production \
  --target 'urn:pulumi:production::dtxweb-infrastructure::cloudflare:index/r2CustomDomain:R2CustomDomain::dtxweb-production-r2-custom-domain'
```

Poll the Cloudflare R2 domain API until both ownership and SSL are `active`. Stop on `blocked`, `error`, or timeout. Verify representative published chart URLs and an Origin-bearing CORS request before continuing.

Do not modify the R2 bucket or objects.

### Step 9.5: Persist final protection and clean preview

```bash
rtk pulumi up --refresh --yes --suppress-outputs \
  --cwd packages/infrastructure \
  --stack cwchanap/dtxweb-infrastructure/production
rtk pulumi preview --refresh --expect-no-changes \
  --cwd packages/infrastructure \
  --stack cwchanap/dtxweb-infrastructure/production
```

Expected: no provider CRUD after the completed adoption.

### Step 9.6: Deploy production through generated config

```bash
rtk bun run deploy:api
rtk curl --fail --silent --show-error https://api.dtx.hapadona.com/healthz | jq -e '.ok == true' >/dev/null
rtk bun run deploy:web
rtk packages/infrastructure/scripts/verify-access.sh production
rtk packages/infrastructure/scripts/verify-infrastructure.sh production
```

Exercise authenticated API/web, D1, R2, KV, service binding, BGM Workflow/Container, public chart download, and CORS paths.

Finish with another production `pulumi preview --refresh --expect-no-changes` to prove Wrangler did not reintroduce drift.

---

## Task 10: Decommission legacy alias resources

**Files:** runbook only if live inventory differs from the expected disposable shape. Operator gate.

### Step 10.1: Prove the alias is detached

Query Workers domains and confirm neither hostname points at:

```text
dtx-web-pre-prod-prod-data
dtx-api-pre-prod-prod-data
```

Confirm those Workers have no custom domains, routes, schedules, tail consumers, or service-binding consumers. Confirm normal pre-production is green after the generated-config deploy.

### Step 10.2: Delete disposable alias resources explicitly

Delete only:

```text
dtx-web-pre-prod-prod-data Worker
dtx-api-pre-prod-prod-data Worker
pre-prod-prod-data-only RATE_LIMIT_API KV namespace
```

Do not delete/mutate `dtx-web` D1, `simfile-dtx` R2, their objects, Workflows attached to normal production/pre-production Workers, or any normal environment namespace.

Record redacted success/failure outcomes in the PR checklist, not resource IDs.

### Step 10.3: Prove no leftovers

```bash
rtk git grep -n 'pre-prod-prod-data' -- ':!docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md' ':!docs/superpowers/plans/2026-08-28-pulumi-cloudflare-infrastructure.md' ':!docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md'
```

Expected: no active code/config result. Cloudflare inventory shows only the two permanent Worker pairs and two active rate-limit namespaces.

---

## Task 11: Final verification and PR readiness

### Step 11.1: Focused repository checks

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
rtk .github/scripts/ci-affected-scope.test.sh
rtk bun run lint
rtk bunx prettier --check .
```

Expected: all exit 0.

### Step 11.2: Generated config final gate

```bash
rtk bun run --filter=@dtx/infrastructure render:preprod
rtk bun run --filter=@dtx/infrastructure render:production
rtk bash -c 'cd packages/dtx-api && bunx wrangler deploy --dry-run --config ../../.wrangler/generated/pre-prod/api.jsonc --outdir dist-final-preprod --containers-rollout=none'
rtk bash -c 'cd packages/dtx-api && bunx wrangler deploy --dry-run --config ../../.wrangler/generated/production/api.jsonc --outdir dist-final-production --containers-rollout=none'
rtk bash -c 'cd packages/dtx-web && bun run build && bunx wrangler deploy --dry-run --config ../../.wrangler/generated/pre-prod/web.jsonc --outdir dist-final-preprod'
rtk bash -c 'cd packages/dtx-web && bunx wrangler deploy --dry-run --config ../../.wrangler/generated/production/web.jsonc --outdir dist-final-production'
rtk git status --short --ignored | grep -F '.wrangler/generated/'
rtk git diff --check
```

Expected: four dry-runs pass, generated files remain ignored, no whitespace errors.

### Step 11.3: Pulumi/live final gate

```bash
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi preview --refresh --expect-no-changes --cwd packages/infrastructure --stack cwchanap/dtxweb-infrastructure/production
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
rtk packages/infrastructure/scripts/verify-infrastructure.sh pre-prod
rtk packages/infrastructure/scripts/verify-access.sh production
rtk packages/infrastructure/scripts/verify-infrastructure.sh production
```

Expected: both stacks are clean and every public boundary passes.

### Step 11.4: Self-review

Review the final diff for:

- accidental IDs/secrets/backups/inventory files;
- resource logical-name consistency with imported URNs;
- D1/R2 protection and retention;
- exactly two permanent stack definitions;
- no remote routes/IDs in committed Wrangler configs;
- no active alias scripts/config/types;
- no Worker deployment in the Pulumi workflow;
- documentation matching actual commands and GitHub Environment names.

Run:

```bash
rtk git status --short
rtk git diff --stat main...HEAD
rtk git log --oneline main..HEAD
```

Expected: only intended files, logical commits, no untracked private artifacts.

### Step 11.5: Mark the single PR ready

The PR can leave draft only after all code gates, both clean Pulumi previews, both live matrices, and alias decommission succeed. The first generalized workflow run occurs after merge to `main`; retain the old Access token until that run succeeds, then remove it from both existing GitHub Environments.
